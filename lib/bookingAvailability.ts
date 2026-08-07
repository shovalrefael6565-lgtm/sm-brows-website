import 'server-only'

/**
 * שלב 13 — פתרון הזמינות ל-`GET /api/bookings/slots`.
 *
 * ═══ למה זה קובץ נפרד ═══
 *
 * ה-route עצמו הוא מטמון + כותרות HTTP. ההחלטה **אילו מקורות נדרשים ומה
 * קורה כשאחד מהם נופל** היא ההחלטה המסוכנת כאן, והיא זו שחייבת להיבדק —
 * מה שאי אפשר לעשות על handler של Next שקורא ישירות ל-Supabase ול-Google.
 * הפונקציה מקבלת את שני המקורות כפרמטרים, בדיוק כמו `runReminderDispatch`
 * ו-`resolveSmsProvider`.
 *
 * ═══ 🔒 האינווריאנטה היחידה שאסור לשבור ═══
 *
 * **רשימת "תפוס" ריקה אינה "היום פנוי" — היא "אין לי תשובה".**
 *
 * ⚠️ עד שלב 13 ה-route מיזג DB ויומן בתוך `Promise.all` אחד, כשרק לצד
 * היומן היה `.catch`. משתנה Supabase חסר גרם ל-`createSupabaseAdminClient`
 * לזרוק, ה-`Promise.all` נדחה, ה-catch הכללי החזיר `busy: []` — והלוח
 * הציג את **כל היום כפנוי**, כולל שעות שהיומן ידע שהן תפוסות. בשקט, בלי
 * שגיאה גלויה, ועם דלת פתוחה ל-double booking.
 *
 * מכאן: כשל של מקור אמת **נדרש** מחזיר כישלון מפורש. הוא לעולם לא מתחזה
 * ליום ריק.
 *
 * ═══ שני המצבים ═══
 *
 * `NEW_BOOKING_SYSTEM_ENABLED=false` — האתר מתנהג **בדיוק** כמו לפני
 * המערכת החדשה: מקור אחד, Google Calendar. 🔒 `dbBusy` **אינו נקרא**, ולכן
 * שורת Supabase שגויה או חסרה אינה יכולה להשפיע על העמוד הפומבי בשום צורה.
 * זהו החוזה שמאפשר להעלות את כל המערכת החדשה לאוויר כשהיא כבויה.
 *
 * `NEW_BOOKING_SYSTEM_ENABLED=true` — **שני המקורות נדרשים.** היומן משקף
 * אירועים אמיתיים, ה-DB משקף בקשות pending/confirmed שהמערכת יצרה ושעדיין
 * לא הגיעו ליומן. חוסר של כל אחד מהם מסתיר תפוסה אמיתית, ולכן שניהם
 * fail-closed — כולל היומן, שלפני שלב 13 היה בולע שגיאות ומחזיר [].
 */

export interface BusyRange {
  start: string
  end: string
}

export interface AvailabilitySources {
  /** Google Calendar — מקור אמת בשני המצבים. */
  calendarBusy: (isoDate: string) => Promise<BusyRange[]>
  /**
   * Supabase — מקור אמת **רק** כשהמערכת החדשה דלוקה.
   * 🔒 כשהיא כבויה הפונקציה הזו אינה נקראת. אף פעם.
   */
  dbBusy: (isoDate: string) => Promise<BusyRange[]>
  newBookingSystemEnabled: () => boolean
  /** ⚠️ מקבל את השגיאה בלבד. אין כאן טלפון, שם לקוחה או מזהה תור. */
  log?: (message: string, err: unknown) => void
}

export type AvailabilityResult =
  /** שני המקורות הנדרשים ענו. `busy` ניתן להצגה ולשמירה במטמון. */
  | { ok: true; busy: BusyRange[] }
  /**
   * המערכת החדשה כבויה והיומן לא ענה. ⚠️ זו ההתנהגות **הישנה** של האתר,
   * והיא נשמרת כלשונה: ה-route ייפול למטמון ישן, ואם אין — יחזיר רשימה
   * ריקה. לא הוחמר בכוונה — שינוי כאן היה משנה את חוויית הלקוחות בדיוק
   * ב-deployment שכל מטרתו היא לא לשנות אותה.
   */
  | { ok: false; reason: 'legacy_calendar_unavailable' }
  /**
   * המערכת החדשה דלוקה ולפחות מקור אחד נדרש לא ענה.
   * 🔒 ה-route חייב להחזיר 503 ו**לא** רשימה ריקה.
   */
  | { ok: false; reason: 'source_unavailable' }

export async function resolveAvailability(
  isoDate: string,
  sources: AvailabilitySources,
): Promise<AvailabilityResult> {
  const log = sources.log ?? ((message, err) => console.error(message, err))

  if (!sources.newBookingSystemEnabled()) {
    // ═══ מסלול ישן — מקור אחד, בלי שום נגיעה ב-Supabase ═══
    try {
      return { ok: true, busy: await sources.calendarBusy(isoDate) }
    } catch (err) {
      log('[slots] calendar unavailable (legacy path)', err)
      return { ok: false, reason: 'legacy_calendar_unavailable' }
    }
  }

  // ═══ מערכת חדשה — שני המקורות נדרשים, שניהם fail-closed ═══
  //
  // ⚠️ אין כאן `.catch` פנימי על אף אחד מהשניים. `Promise.all` נדחה על
  // הראשון שנופל, וזו התוצאה הרצויה: תשובה חלקית מסתירה תפוסה אמיתית.
  //
  // ⚠️ `allSettled` נשקל ונדחה — הוא היה מאפשר להמשיך עם מקור אחד, כלומר
  // בדיוק הבאג שהקובץ הזה נכתב כדי לסגור.
  try {
    const [calendarBusy, dbBusy] = await Promise.all([
      sources.calendarBusy(isoDate),
      sources.dbBusy(isoDate),
    ])
    return { ok: true, busy: [...calendarBusy, ...dbBusy] }
  } catch (err) {
    log('[slots] availability source unavailable', err)
    return { ok: false, reason: 'source_unavailable' }
  }
}
