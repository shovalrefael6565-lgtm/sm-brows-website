/**
 * אזור "המעגן" התחתון — מתחת ל-1440px בלבד. שקוף לחלוטין (החלטה מ-24.11.2026).
 *
 * הכפתורים (וואטסאפ, נגישות, חזרה-למעלה) ממוקמים בשורה אחת בתחתית המסך, בגובה
 * --dock-h (4rem + safe-area, app/globals.css). האלמנט הזה כבר לא מצייר רצועה —
 * בלי רקע, טשטוש, צל או מסגרת — והוא רק מסמן את האזור (גובה, ובדיקות).
 *
 * 🔒 pointer-events-none: רק הכפתורים עצמם תופסים לחיצות; השטח השקוף ביניהם
 * מעביר לחיצות לתוכן שמתחתיו, כרגיל (הקישורים שם גלויים — אין רצועה שמסתירה).
 * ה-padding של ה-body וה-scroll-padding-bottom נשארים: סוף העמוד עדיין ניתן
 * לגלילה אל מעל הכפתורים, ופוקוס מקלדת לא נוחת מתחתם.
 * aria-hidden: אין כאן תוכן.
 */
export default function MobileDock() {
  return (
    <div
      aria-hidden="true"
      className="mobile-dock fixed inset-x-0 bottom-0 z-30 min-[1440px]:hidden pointer-events-none"
    />
  )
}
