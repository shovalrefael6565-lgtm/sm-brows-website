import 'server-only'
import { randomUUID } from 'crypto'
import { areNotificationsEnabled, isNewBookingSystemEnabled } from '@/lib/featureFlags'
import { isDispatchable, resolveNotificationProvider, type ReminderProvider } from './provider'
import {
  isAwaitingApprovedTemplate,
  requiresContext,
  smsBodyFor,
  smsBodyWithContext,
} from '@/lib/messageTemplates'
import { formatDateTimeCompactIL } from '@/lib/admin/format'
import {
  NOTIFICATION_MAX_ATTEMPTS,
  claimNotification,
  finishNotificationAttempt,
  loadNotificationContext,
  loadNotificationRecipient,
  skipNotification,
  type NotificationRow,
} from '@/lib/db/notifications'

/**
 * שלב 15F — ניקוז ההתראות של תור אחד.
 *
 * ═══ 🔒 ההבטחה שאסור לשבור ═══
 *
 * **כשל SMS לעולם אינו מבטל פעולה עסקית שכבר הצליחה.**
 *
 * `dispatchNow` נקראת **אחרי ה-COMMIT** של הפעולה, ועטופה ב-try/catch
 * שאינו מחזיר שגיאה למעלה. אישור תור שהצליח ב-DB נשאר מאושר גם אם 019
 * למטה, גם אם הטלפון פסול, וגם אם משהו כאן זרק. ⚠️ ה-route מחזיר 200 בכל
 * ארבעת מצבי הספק — התוצאה נרשמת בשורת ההתראה, לא בתשובת ה-HTTP.
 *
 * ═══ למה appointmentId ולא notificationId ═══
 *
 * שורות ההתראה נוצרות ע"י טריגר ב-DB (0025), בתוך אותה טרנזקציה. הקוד
 * שקרא לפעולה העסקית יודע **באיזה תור נגע**, ולעולם אינו רואה את המזהים
 * שהטריגר ייצר. ניקוז לפי תור הוא לכן הממשק היחיד שאינו מחייב את
 * האפליקציה לנחש מה ה-DB עשה.
 *
 * זה גם מטפל בחינם ב-`booking_cancelled`, שמייצר **שתי** שורות (ללקוחה
 * ולשובל): הלולאה מנקזת עד שאין מה לתפוס.
 *
 * ═══ waitUntil ═══
 *
 * ⚠️ ב-Next 14.2 אין `unstable_after`, ו-Promise שלא ממתינים לו ב-
 * serverless function **נקטע ברגע שהתשובה נשלחת** — ההתראה פשוט לא הייתה
 * יוצאת, בשקט. ה-routes עוטפים את הקריאה ב-`waitUntil` מ-
 * `@vercel/functions`. ראה את ההערה בכל route.
 */

/** תקרת בטיחות ללולאה. בפועל מנוקזות 1–2 שורות לכל תור. */
const MAX_PER_RUN = 8

export interface DispatchStats {
  enabled: boolean
  provider: string
  dispatchable: boolean
  claimed: number
  sent: number
  simulated: number
  retrying: number
  failed: number
  deliveryUnknown: number
  /**
   * ⚠️ מופרד מ-failed בכוונה: skipped אינו תקלה אלא "אין למי לשלוח" או
   * "אין נוסח מאושר". מונה משותף היה מסתיר איזה מהם קרה, ושניהם דורשים
   * פעולה אנושית שונה לחלוטין.
   */
  skipped: number
}

function emptyStats(enabled: boolean, provider: string, dispatchable: boolean): DispatchStats {
  return {
    enabled, provider, dispatchable,
    claimed: 0, sent: 0, simulated: 0, retrying: 0,
    failed: 0, deliveryUnknown: 0, skipped: 0,
  }
}

/**
 * גישות ה-DB, מוזרקות.
 *
 * ⚠️ אינן פיגום לבדיקות. הכלל "כשהמערכת כבויה אין **שום** כתיבה" אינו
 * ניתן לאכיפה ע"י טיפוסים ואי אפשר להוכיח אותו בלי לספור קריאות בפועל.
 * אותו שיקול בדיוק כמו ב-`ReminderDb` וב-`SyncDeps`.
 */
export interface NotificationDb {
  claimNotification: typeof claimNotification
  finishNotificationAttempt: typeof finishNotificationAttempt
  skipNotification: typeof skipNotification
  loadNotificationRecipient: typeof loadNotificationRecipient
  loadNotificationContext: typeof loadNotificationContext
}

export interface DispatchDeps {
  provider: ReminderProvider
  maxAttempts: number
  db: NotificationDb
}

function defaultDeps(): DispatchDeps {
  return {
    provider: resolveNotificationProvider(),
    maxAttempts: NOTIFICATION_MAX_ATTEMPTS,
    db: {
      claimNotification,
      finishNotificationAttempt,
      skipNotification,
      loadNotificationRecipient,
      loadNotificationContext,
    },
  }
}

/**
 * 🔒 ההחלטה היחידה שקובעת אם המערכת נוגעת בהתראות בכלל.
 *
 * פונקציה טהורה בכוונה — זהו הכלל שאסור שיישבר בשקט, ובדיקה שלו לא צריכה
 * להיות תלויה ב-DB, בשעון או ברשת.
 */
export function shouldDispatch(enabled: boolean, provider: ReminderProvider): boolean {
  return enabled && isDispatchable(provider)
}

/**
 * מנקזת את ההתראות הממתינות של תור אחד.
 *
 * 🔒 **לעולם אינה זורקת.** כל מסלול היציאה מחזיר סטטיסטיקה.
 *
 * מחזירה ספירות בלבד — לעולם לא מזהי התראות, טלפונים או גוף הודעה.
 */
export async function dispatchNow(
  appointmentId: string,
  deps: Partial<DispatchDeps> = {},
): Promise<DispatchStats> {
  const d: DispatchDeps = { ...defaultDeps(), ...deps }

  // ⚠️ שני הדגלים, לא אחד. ההתראות הן חלק ממערכת ההזמנות החדשה — אם היא
  // כבויה, אין התראות.
  const enabled = areNotificationsEnabled() && isNewBookingSystemEnabled()
  const dispatchable = isDispatchable(d.provider)
  const stats = emptyStats(enabled, d.provider.name, dispatchable)

  // 🔒 השער. כל מה שלפניו הוא קריאת הגדרות בלבד — אפס כתיבות ל-DB.
  //
  // ⚠️ שורה שלא נוקזה נשארת queued וממתינה. היא **אינה** נשרפת: אילו
  // הייתה נתפסת ומסומנת כשהספק כבוי, ההפעלה הבאה הייתה מוצאת ערימת
  // התראות "מטופלות" ולא יכולה לשלוח אף אחת. אותו לקח בדיוק מ-0011.
  if (!shouldDispatch(enabled, d.provider)) return stats

  try {
    for (let i = 0; i < MAX_PER_RUN; i++) {
      const leaseToken = randomUUID()
      const claimed = await d.db.claimNotification(appointmentId, leaseToken, d.provider.name)
      if (!claimed) return stats
      stats.claimed++

      await processOne(claimed, leaseToken, d, stats)
    }
  } catch (err) {
    // 🔒 **הנקודה שבה ההבטחה מתקיימת.** הפעולה העסקית כבר עשתה COMMIT,
    // ושום דבר שקרה כאן אינו יכול להחזיר אותה אחורה. הכשל נרשם בלוג
    // ונבלע — ⚠️ בלי מזהים, בלי טלפון ובלי גוף הודעה.
    console.error(
      '[notifications] dispatch threw',
      err instanceof Error ? err.message : String(err),
    )
  }

  return stats
}

async function processOne(
  row: NotificationRow,
  leaseToken: string,
  d: DispatchDeps,
  stats: DispatchStats,
): Promise<void> {
  // ── הנוסח ─────────────────────────────────────────────────────────────
  //
  // ⚠️ נבדק **לפני** טעינת הנמען. אין שום סיבה לשלוף מספר טלפון של לקוחה
  // עבור הודעה שלא נשלח לה נוסח.
  let body = smsBodyFor(row.event, row.recipient_role)

  /*
   * שני נוסחי ה-admin הדינמיים — הם היחידים שדורשים נתוני לקוחה.
   *
   * ⚠️ הטעינה מותנית ב-`requiresContext` ולא נעשית תמיד. זה מה ששומר על
   * הכלל של 15F: להודעות שנמענן הוא הלקוחה נטען **טלפון בלבד**, ואף שם,
   * מועד או טיפול אינם נשלפים מה-DB עבורן.
   */
  if (requiresContext(row.event, row.recipient_role)) {
    const ctx = await d.db.loadNotificationContext(row.appointment_id)
    if (!ctx) {
      // ⚠️ בלי הקשר אין הודעה — ואין לשלוח נוסח חלקי שחסר בו מי או מתי.
      await d.db.skipNotification(row.id, leaseToken, 'context_unavailable')
      stats.skipped++
      return
    }
    // 🔒 מועד **התור**, לא רגע הביטול. ראה loadNotificationContext.
    const { date, time } = formatDateTimeCompactIL(ctx.startsAt)
    body = smsBodyWithContext(row.event, row.recipient_role, {
      customerName: ctx.customerName,
      appointmentDate: date,
      appointmentTime: time,
    })
  }

  if (body === null) {
    // ⚠️ שתי עובדות שונות שנראות זהות: אירוע שממתין לאישור נוסח הוא פער
    // ידוע שדורש החלטה עסקית, ואילו זוג ללא נוסח הוא באג בחיווט שדורש
    // תחקיר. קוד נפרד לכל אחד.
    const reason = isAwaitingApprovedTemplate(row.event)
      ? 'awaiting_approved_template'
      : 'no_template_for_event'
    await d.db.skipNotification(row.id, leaseToken, reason)
    stats.skipped++
    return
  }

  // ── הנמען ─────────────────────────────────────────────────────────────
  const phone = await d.db.loadNotificationRecipient(row.appointment_id, row.recipient_role)
  if (!phone) {
    // ⚠️ 'admin_phone_unset' הוא המצב שבו 0024 הותקנה אבל המספר טרם נקבע
    // ידנית בפרודקשן. הוא **חייב** להיראות ברשימת "דורש טיפול" ולא
    // להיבלע — אחרת המערכת נראית עובדת ושותקת בדיוק כשבקשה חדשה מגיעה.
    const reason = row.recipient_role === 'admin' ? 'admin_phone_unset' : 'customer_phone_missing'
    await d.db.skipNotification(row.id, leaseToken, reason)
    stats.skipped++
    return
  }

  let result
  try {
    result = await d.provider.send({
      to: phone,
      body,
      // ⚠️ מזהה ההתראה — יציב בכל retry, ולעולם לא מספר ניסיון, חותמת זמן
      // או מזהה worker. אצל 019 הוא נשלח כ-external_id, שהוא client
      // reference ל-DLR בלבד ואינו מבטיח idempotency (ראה sms019Mapping).
      idempotencyKey: row.id,
    })
  } catch {
    // ⚠️ חריגה שנזרקה **אחרי** שהבקשה יצאה אינה ניתנת להבחנה מחריגה
    // שנזרקה לפניה. delivery_unknown הוא התיאור הנכון, ו-retry אוטומטי
    // עליו היה הימור על SMS שני על חשבון הלקוחה.
    console.error('[notifications] provider threw')
    await d.db.finishNotificationAttempt({
      notificationId: row.id, leaseToken, outcome: 'delivery_unknown',
      errorCode: 'provider_threw', providerMessageId: null, provider: d.provider.name,
    })
    stats.deliveryUnknown++
    return
  }

  const finished = await d.db.finishNotificationAttempt({
    notificationId: row.id,
    leaseToken,
    outcome: result.outcome,
    errorCode: result.outcome === 'accepted' ? null : result.errorCode,
    providerMessageId: result.outcome === 'accepted' ? result.providerMessageId ?? null : null,
    provider: d.provider.name,
  })

  switch (finished?.status) {
    case 'sent':             stats.sent++; break
    case 'simulated':        stats.simulated++; break
    case 'retrying':         stats.retrying++; break
    case 'failed':           stats.failed++; break
    case 'delivery_unknown': stats.deliveryUnknown++; break
    case 'skipped':          stats.skipped++; break
    default: break
  }
}
