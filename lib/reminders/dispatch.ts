import 'server-only'
import { randomUUID } from 'crypto'
import { areRemindersEnabled, isNewBookingSystemEnabled } from '@/lib/featureFlags'
import { isDispatchable, resolveReminderProvider } from './provider'
import { normalizeEnvFlag } from '@/lib/envFlag'
import type { ReminderProvider } from './types'
import { reminderBodyFor } from './templates'
import { treatmentLabel } from '@/lib/admin/format'
import {
  REMINDER_MAX_ATTEMPTS,
  type ClaimedReminder,
  type PrecheckReason,
  abortReminderAttempt,
  claimDueReminder,
  finishReminderAttempt,
  loadReminderRecipient,
  reminderPrecheck,
  sweepExpiredReminders,
} from '@/lib/db/reminders'

/**
 * שלב 11 — מנוע שליחת התזכורות.
 *
 * ═══ הכלל שאסור לשבור ═══
 *
 * **כשאין ספק אמיתי, לא נוגעים בתזכורות.**
 *
 * לא claim, לא ניסיון, לא attempt_count, לא סטטוס, ולא provider. תזכורת
 * נשארת scheduled/retrying וממתינה.
 *
 * הסיבה אינה סגנונית. אילו כל תזכורת הייתה נתפסת ומסומנת כשהספק כבוי,
 * שלב 12 היה מוצא ערימה של תזכורות "מטופלות" ולא היה יכול לשלוח אף אחת —
 * כולל כאלה שחלון השליחה שלהן פתוח לגמרי. המערכת הייתה שורפת בשקט בדיוק
 * את מה שהיא נבנתה כדי לשלוח.
 *
 * ⚠️ **אין יוצא מן הכלל, גם לא ה-sweep.** גם הוא כותב ל-DB, ולכן גם הוא
 * נמצא אחרי השער. הסדר הוא: gate → sweep → claim.
 *
 * תזכורת שחלונה נסגר בזמן שהמערכת הייתה כבויה אינה "אבודה" ואינה עלולה
 * להישלח באיחור: בהרצה הפעילה הראשונה ה-sweep רץ לפני ה-claim ומסמן אותה
 * skipped, כך שאיש לא יוכל לתפוס אותה.
 *
 * ═══ שלוש שכבות מניעת שליחה כפולה ═══
 *
 *   1. lease — רק worker אחד מחזיק תזכורת, ורק הוא רשאי לסגור אותה.
 *   2. unique על ה-snapshot — אותו (תור, סוג, מועד) קיים פעם אחת.
 *   3. unique על (reminder_id, attempt_number) — כל ניסיון נרשם פעם אחת.
 *
 * ובנוסף: delivery_unknown לעולם אינו נכנס ל-retry אוטומטי.
 */

/** תקציב זמן לריצה, מתחת ל-lease. ריצה שנעצרת כאן ממשיכה בהרצה הבאה. */
const RUN_BUDGET_MS = 60 * 1000

/**
 * 🔒 חסם הרעננות של `two_hours_before` — כמה זמן אחרי `scheduled_for`
 * עדיין מותר לומר "בעוד שעתיים".
 *
 * ⚠️ זו אינה החמרה של החלון, אלא אכיפה של **הנוסח**. `expires_at` של
 * two_hours_before הוא `starts_at - 15m` (0011), כלומר החלון פתוח עד רבע
 * שעה לפני התור. הנוסח המאושר אומר "התור שלך בעוד שעתיים" — טענה על
 * מרחק בזמן — ושליחתו שעה וחצי אחרי `scheduled_for` היא פשוט שקר
 * ללקוחה. בלי החסם הזה, scheduler שנפל לשעתיים היה מתעורר ושולח את
 * ההודעה הלא-נכונה במקום לוותר עליה.
 *
 * ⚠️ **ולא לצמצם את `expires_at` ב-DB במקום זה.** צמצום כזה הוא migration
 * ממוספרת חדשה, ואינו נחוץ: `scheduled_for` כבר נמצא בשורה שנתפסה, ו-
 * `abort_reminder_attempt` כבר יודעת לסמן `expired_before_send` →
 * `skipped`. הכלל נאכף בקוד, בלי שינוי סכמה.
 *
 * ⚠️ הערך **גדול בהרבה** מתדירות ה-scheduler (5 דקות) בכוונה: הדרישה היא
 * שריצה שהתעכבה תשלים תזכורת שהפכה due ולא תפספס אותה. חצי שעה מכסה
 * scheduler שדילג על חמש-שש הרצות, ועדיין משאירה את ההודעה נכונה — היא
 * תצא בין שעתיים לשעה וחצי לפני התור. איחור גדול מזה כבר אינו "עיכוב"
 * אלא הודעה אחרת.
 *
 * ⚠️ הכלל חל על **רגע ה-claim בפועל**, ולכן הוא מכסה גם retry: ניסיון
 * חוזר עם backoff שחורג מחצי השעה מסתיים ב-skipped ולא בהודעה שגויה.
 */
export const TWO_HOURS_FRESHNESS_MS = 30 * 60 * 1000

/**
 * האם עדיין מותר לשלוח את התזכורת שנתפסה, לפי הנוסח שלה.
 *
 * 🔒 פונקציה טהורה בכוונה — זהו כלל תוכן שאסור שיישבר בשקט, והוכחתו לא
 * צריכה להיות תלויה ב-DB, בשעון או ברשת (בדיוק כמו shouldDispatch).
 *
 * ⚠️ `day_before` ו-`manual` מוחזרים כתקפים תמיד. day_before מוגן ע"י
 * הסכמה עצמה (ראה lib/reminders/templates.ts), ו-manual נושא תאריך ושעה
 * מפורשים ולכן אינו טוען דבר על מרחק בזמן.
 */
export function isReminderStillTruthful(
  kind: 'day_before' | 'two_hours_before' | 'manual',
  scheduledForMs: number,
  nowMs: number,
): boolean {
  if (kind !== 'two_hours_before') return true
  if (!Number.isFinite(scheduledForMs)) return true
  return nowMs - scheduledForMs <= TWO_HOURS_FRESHNESS_MS
}

/**
 * הסיבות שמעידות על **שינוי אמיתי בתור** ולא על מעבר זמן.
 *
 * ⚠️ 'appointment_started' ו-'expired_before_send' אינם כאן בכוונה: תור
 * שהתחיל בזמן שהספק עיבד לא "שונה" — הזמן פשוט עבר. סימון כזה כשינוי היה
 * מייצר התראה על לא כלום.
 */
const REAL_CHANGE_REASONS: ReadonlySet<PrecheckReason> = new Set<PrecheckReason>([
  'starts_at_changed',
  'appointment_not_confirmed',
  'cancel_requested',
  'appointment_missing',
])

/**
 * 🔒 ההחלטה היחידה שקובעת אם המערכת נוגעת בתזכורות בכלל.
 *
 * מופרדת לפונקציה טהורה בכוונה: זהו הכלל שאסור שיישבר בשקט, ובדיקה שלו
 * לא צריכה להיות תלויה ב-DB, בשעון או ברשת.
 */
export function shouldDispatch(enabled: boolean, provider: ReminderProvider): boolean {
  return enabled && isDispatchable(provider)
}

export interface DispatchStats {
  enabled: boolean
  provider: string
  dispatchable: boolean
  sweptExpired: number
  sweptCancelled: number
  claimed: number
  sent: number
  simulated: number
  retrying: number
  failed: number
  deliveryUnknown: number
  /**
   * ⚠️ שלושת אלה מפורטים ולא מאוחדים ל-"aborted" אחד: הפסקה לפני שליחה
   * יכולה לנבוע מביטול התור, משינוי מועד או מחלון שנסגר — ואלה שלושה
   * סיפורים תפעוליים שונים לגמרי. מונה אחד היה מסתיר איזה מהם קרה.
   */
  cancelled: number
  superseded: number
  skipped: number
  timedOut: boolean
}

function emptyStats(enabled: boolean, provider: string, dispatchable: boolean): DispatchStats {
  return {
    enabled, provider, dispatchable,
    sweptExpired: 0, sweptCancelled: 0, claimed: 0,
    sent: 0, simulated: 0, retrying: 0, failed: 0,
    deliveryUnknown: 0, cancelled: 0, superseded: 0, skipped: 0,
    timedOut: false,
  }
}

/**
 * גישות ה-DB, מוזרקות.
 *
 * ⚠️ זה אינו פיגום לבדיקות. הכלל "כשהמערכת כבויה אין **שום** כתיבה" אינו
 * ניתן לאכיפה ע"י טיפוסים, ואי אפשר להוכיח אותו בלי לספור את הקריאות
 * בפועל. הזרקה כאן היא מה שהופך את ההוכחה לאפשרית — בדיוק כמו
 * SyncDeps ב-runCalendarSync.
 */
export interface ReminderDb {
  sweepExpiredReminders: typeof sweepExpiredReminders
  claimDueReminder: typeof claimDueReminder
  reminderPrecheck: typeof reminderPrecheck
  loadReminderRecipient: typeof loadReminderRecipient
  finishReminderAttempt: typeof finishReminderAttempt
  abortReminderAttempt: typeof abortReminderAttempt
}

export interface DispatchDeps {
  provider: ReminderProvider
  now: () => number
  /** נדרס בבדיקות כדי לא לתלות אותן בשעון */
  maxAttempts: number
  db: ReminderDb
}

function defaultDeps(): DispatchDeps {
  return {
    provider: resolveReminderProvider(),
    now: () => Date.now(),
    maxAttempts: REMINDER_MAX_ATTEMPTS,
    db: {
      sweepExpiredReminders,
      claimDueReminder,
      reminderPrecheck,
      loadReminderRecipient,
      finishReminderAttempt,
      abortReminderAttempt,
    },
  }
}

/**
 * ריצת שליחה אחת.
 *
 * מחזירה ספירות בלבד — לעולם לא מזהי תזכורות, שמות, טלפונים או גוף הודעה.
 */
export async function runReminderDispatch(
  deps: Partial<DispatchDeps> = {},
): Promise<DispatchStats> {
  const d: DispatchDeps = { ...defaultDeps(), ...deps }
  // ⚠️ שני הדגלים, לא אחד. תזכורות הן חלק ממערכת ההזמנות החדשה — אם היא
  // כבויה, אין תזכורות. זה גם מה שמאפשר ל-endpoint להחזיר 200 עם
  // enabled:false במקום 403, כי מצב כבוי אינו כשל הרשאה.
  const enabled = areRemindersEnabled() && isNewBookingSystemEnabled()
  const dispatchable = isDispatchable(d.provider)
  const stats = emptyStats(enabled, d.provider.name, dispatchable)

  // 🔒 השער, וכל מה שלפניו הוא קריאת הגדרות בלבד.
  //
  // ⚠️ גם ה-sweep נמצא **אחרי** השער. הוא כותב ל-DB (מסמן תזכורות
  // skipped/cancelled), ולכן הרצתו כשהמערכת כבויה הייתה מפירה את הכלל
  // "כבוי = אפס כתיבות" — ובפועל שורפת בשקט תזכורות שאיש לא ביקש לעבד.
  //
  // אין בכך סיכון שתזכורת שפג תוקפה תישלח אחרי הפעלת 019: בהרצה הפעילה
  // הראשונה ה-sweep רץ לפני ה-claim, ומסמן אותן skipped לפני שמישהו יוכל
  // לתפוס אותן. הסדר הוא gate → sweep → claim.
  if (!shouldDispatch(enabled, d.provider)) {
    /*
      ⚠️ **מצב כבוי חייב להשמיע קול.** זו התקלה האמיתית שנחשפה כאן: מנוע
      התזכורות היה כבוי בפרודקשן שבועות, ה-scheduler דפק על ה-route כל חמש
      דקות והכול החזיר 200 — ואף שורה בלוג לא אמרה למה אף תזכורת לא יצאה.
      "כבוי הוא מצב תפעולי תקין" נכון, אבל תקין אינו שקוף.

      🔒 מודפסים **דגלים בלבד, אחרי נרמול**. שלושת אלה אינם סודות
      (`true` / `sms_019`), ואין כאן token, טלפון, שם או גוף הודעה. הגזימה
      ל-32 תווים היא הגנה מפני משתנה שהוגדר בטעות לערך ארוך — לא ידלוף
      ממנו יותר מהתחלה קצרה.
    */
    const shown = (raw: string | undefined) => normalizeEnvFlag(raw).slice(0, 32)
    console.error(
      '[reminders] dispatch gate closed — ' +
      `remindersEnabled=${areRemindersEnabled()} ` +
      `newBookingSystem=${isNewBookingSystemEnabled()} ` +
      `provider=${d.provider.name} ` +
      `REMINDERS_ENABLED="${shown(process.env.REMINDERS_ENABLED)}" ` +
      `REMINDER_PROVIDER="${shown(process.env.REMINDER_PROVIDER)}"`,
    )
    return stats
  }

  const swept = await d.db.sweepExpiredReminders()
  stats.sweptExpired = swept.expired
  stats.sweptCancelled = swept.cancelled

  const deadline = d.now() + RUN_BUDGET_MS

  while (d.now() < deadline) {
    const leaseToken = randomUUID()
    const claimed = await d.db.claimDueReminder(leaseToken, d.provider.name, d.maxAttempts)
    if (!claimed) return stats
    stats.claimed++

    await processOne(claimed, leaseToken, d, stats)
  }

  stats.timedOut = true
  return stats
}

/** התוצאה האמיתית של הפסקה לפני שליחה, לפי הסטטוס שה-DB קבע. */
function tallyAbort(stats: DispatchStats, status: string | undefined): void {
  if (status === 'cancelled') stats.cancelled++
  else if (status === 'superseded') stats.superseded++
  else stats.skipped++
}

async function processOne(
  claimed: ClaimedReminder,
  leaseToken: string,
  d: DispatchDeps,
  stats: DispatchStats,
): Promise<void> {
  const { reminder } = claimed

  // ── אימות מחדש, ממש לפני השליחה ──────────────────────────────────────
  // התור עדיין confirmed, המועד עדיין תואם ל-snapshot, לא התבקש ביטול,
  // והחלון עדיין פתוח. ראה reminder_precheck ב-0011.
  const before = await d.db.reminderPrecheck(reminder.id, leaseToken)
  if (!before.ok) {
    const row = await d.db.abortReminderAttempt(reminder.id, leaseToken, before.reason)
    tallyAbort(stats, row?.status)
    return
  }

  // ── חסם הרעננות של הנוסח ─────────────────────────────────────────────
  // ⚠️ **אחרי ה-precheck ולפני טעינת הנמענת**, ובכוונה: זהו כלל תוכן ולא
  // כלל הרשאה, ואין שום סיבה לשלוף טלפון של לקוחה בשביל הודעה שכבר
  // הוחלט לא לשלוח. הסימון הוא expired_before_send → skipped (0011,
  // abort_reminder_attempt), כלומר בדיוק אותה עקבה נראית שיש לתזכורת
  // שחלונה נסגר — וזה התיאור הנכון: חלון ה*נוסח* שלה נסגר.
  if (
    !isReminderStillTruthful(
      reminder.reminder_kind,
      Date.parse(reminder.scheduled_for),
      d.now(),
    )
  ) {
    const row = await d.db.abortReminderAttempt(reminder.id, leaseToken, 'expired_before_send')
    tallyAbort(stats, row?.status)
    return
  }

  // ── פרטי הנמענת ───────────────────────────────────────────────────────
  // נטענים רק כאן, נכנסים לגוף ההודעה, ונזרקים. לא נכתבים לשום טבלה של
  // תזכורות ולא ללוג.
  const recipient = await d.db.loadReminderRecipient(reminder.appointment_id)
  if (!recipient) {
    const row = await d.db.abortReminderAttempt(reminder.id, leaseToken, 'appointment_missing')
    tallyAbort(stats, row?.status)
    return
  }

  // ⚠️ המועד בגוף ההודעה הוא ה-snapshot של התזכורת, לא starts_at טרי.
  // ה-precheck כבר הוכיח שהם זהים; שימוש ב-snapshot מבטיח שגם אם משהו
  // ישתנה ברגע הזה, ההודעה תתאר בדיוק את מה שהתזכורת נקבעה עבורו.
  const body = reminderBodyFor(reminder.reminder_kind, {
    treatment: treatmentLabel({
      service_key: recipient.serviceKey,
      variants: recipient.variants,
    }),
    startsAt: new Date(reminder.appointment_starts_at),
  })

  let result
  try {
    result = await d.provider.send({
      to: recipient.phoneE164,
      body,
      // ⚠️ מפתח יציב בכל retry — reminder.id, לעולם לא מזהה/מספר ניסיון,
      // חותמת זמן או מזהה worker.
      idempotencyKey: reminder.id,
    })
  } catch {
    // ⚠️ חריגה שנזרקה **אחרי** שהבקשה כבר יצאה אינה ניתנת להבחנה מחריגה
    // שנזרקה לפניה. delivery_unknown הוא התיאור הנכון, ו-retry אוטומטי
    // עליו היה הימור על חשבון הלקוחה.
    console.error('[reminders] provider threw')
    await d.db.finishReminderAttempt({
      reminderId: reminder.id, leaseToken, outcome: 'delivery_unknown',
      errorCode: 'provider_threw', providerMessageId: null,
      provider: d.provider.name, appointmentChanged: false,
      maxAttempts: d.maxAttempts,
    })
    stats.deliveryUnknown++
    return
  }

  // ── האם התור השתנה בזמן שהספק עיבד ────────────────────────────────────
  // ההודעה כבר יצאה. אי אפשר לבטל SMS שנשלח, ולכן התוצאה האמיתית נרשמת
  // ומסומנת sent_after_appointment_change — לא כביטול, ולא נמחקת.
  let appointmentChanged = false
  if (result.outcome === 'accepted') {
    const after = await d.db.reminderPrecheck(reminder.id, leaseToken)
    appointmentChanged = !after.ok && REAL_CHANGE_REASONS.has(after.reason)
  }

  const row = await d.db.finishReminderAttempt({
    reminderId: reminder.id,
    leaseToken,
    outcome: result.outcome,
    errorCode: result.outcome === 'accepted' ? null : result.errorCode,
    providerMessageId: result.outcome === 'accepted' ? result.providerMessageId ?? null : null,
    provider: d.provider.name,
    appointmentChanged,
    maxAttempts: d.maxAttempts,
  })

  switch (row?.status) {
    case 'sent':             stats.sent++; break
    case 'simulated':        stats.simulated++; break
    case 'retrying':         stats.retrying++; break
    case 'failed':           stats.failed++; break
    case 'delivery_unknown': stats.deliveryUnknown++; break
    default: break
  }
}
