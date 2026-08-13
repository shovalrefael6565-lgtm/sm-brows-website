/**
 * שערי בקרה לצד הלקוח של טופס ה-OTP (components/account/LoginForm.tsx).
 *
 * פונקציות טהורות, בלי תלות ב-React ובלי 'server-only' — הקובץ *חייב*
 * לרוץ בדפדפן, ולכן הוא נבדק ישירות (scripts/test-otp-form-guards.mjs)
 * בלי לרנדר את הקומפוננטה.
 */

/**
 * שער "בקשה אחת בכל רגע", משותף בין sendCode ל-verifyCode בטופס.
 *
 * ⚠️ משתנה רגיל בסגירה (closure), לא React state: עדכוני state נצברים
 * (batched) ואסינכרוניים, ולכן שתי קריאות שנורות באותו tick ממש (למשל
 * Enter שנלחץ פעמיים לפני שהכפתור המנוטרל נצבע מחדש) היו שתיהן קוראות
 * את אותו ערך ישן של "לא בעיצומה". משתנה רגיל נקרא ונכתב באופן סינכרוני,
 * ולכן הקריאה השנייה רואה מיד את התוצאה של הקריאה הראשונה.
 */
export function createInFlightGuard() {
  let active = false
  return {
    /** true ומסמנת "בעיצומה" אם מותר להמשיך; false אם כבר יש בקשה פעילה. */
    tryStart(): boolean {
      if (active) return false
      active = true
      return true
    },
    finish(): void {
      active = false
    },
  }
}

export type InFlightGuard = ReturnType<typeof createInFlightGuard>

/**
 * מחליטה אם ערך קוד OTP חדש שנצפה צריך להפעיל אימות אוטומטי.
 *
 * מתעניינת רק במחרוזת התוצאה — ולכן הקלדה, הדבקה, ו-AutoFill של iOS
 * (autocomplete="one-time-code") עוברים דרך אותה בדיקה בדיוק: כולם רק
 * משנים את ה-state של הקוד, וזה כל מה שהשער רואה.
 *
 * נורית **לכל היותר פעם אחת** לכל ערך בן 6 ספרות מובחן: הגעה חוזרת ל-6
 * ספרות עם **אותו** קוד (למשל רינדור כפול של React StrictMode) לא
 * מפעילה שוב, אבל עריכת הקוד — ולו בספרה אחת — מנקה את הזיכרון, כך
 * שקוד מתוקן אחרי ניסיון כושל יכול להפעיל שוב.
 */
export function createOtpAutoSubmitGate() {
  let lastFiredCode: string | null = null
  return {
    shouldFire(code: string): boolean {
      if (code.length !== 6) {
        lastFiredCode = null
        return false
      }
      if (code === lastFiredCode) return false
      lastFiredCode = code
      return true
    },
    /** איפוס מפורש — בשימוש כשהטופס עצמו מתאפס (שליחה חוזרת, חזרה לשלב הטלפון). */
    reset(): void {
      lastFiredCode = null
    },
  }
}

export type OtpAutoSubmitGate = ReturnType<typeof createOtpAutoSubmitGate>
