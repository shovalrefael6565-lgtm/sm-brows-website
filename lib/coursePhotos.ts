/**
 * תמונות הבוגרות של עמוד הקורס — רשימה אחת, מקור האמת ל-Hero של /course.
 *
 * כל התמונות כאן מאושרות לפרסום ונמצאות ב-git. שמות הבוגרות טושטשו על
 * התעודות, ונתוני EXIF/GPS הוסרו מקובצי ה-WebP (המקורות שמורים מחוץ לפרויקט).
 *
 * scripts/test-image-integrity.mjs מייבא את הקובץ הזה ישירות ובודק שכל תמונה
 * קיימת, אינה חסומה ב-.gitignore ויש לה alt — לכן הקובץ נטול תלויות ונטול
 * path aliases.
 *
 * ⚠️ אין כאן next/image static import בכוונה — נתיב מחרוזת בלבד.
 */

export interface CoursePhoto {
  src: string
  width: number
  height: number
  /** ללא שמות הבוגרות — בהחלטה מפורשת */
  alt: string
  /** object-position — נבחר לכל תמונה כך שהפנים והתעודה נשארים בפריים */
  position: string
}

/** התמונה הראשית — הגדולה בקומפוזיציה ואלמנט ה-LCP של העמוד */
export const COURSE_HERO_MAIN: CoursePhoto = {
  src: '/course/graduate-1.webp',
  width: 1125,
  height: 2000,
  alt: 'שובל מאירה עם בוגרת קורס עיצוב הגבות, שמחזיקה את תעודת הסיום שלה, מול לוגו הסטודיו',
  position: '50% 22%',
}

/** התמונה המשנית העליונה (חיתוך מתון) */
export const COURSE_HERO_TOP: CoursePhoto = {
  src: '/course/graduate-2-tight.webp',
  width: 936,
  height: 1170,
  alt: 'בוגרת הקורס ושובל מחזיקות יחד את תעודת הסיום של S.M BROWS ACADEMY',
  position: '50% 40%',
}

/** התמונה המשנית התחתונה (חיתוך מתון) — אושרה לפרסום ב-24.11.2026 */
export const COURSE_HERO_BOTTOM: CoursePhoto = {
  src: '/course/graduate-3-tight.webp',
  width: 1072,
  height: 1340,
  alt: 'שובל ובוגרת הקורס עם תעודת הסיום, מול לוגו הסטודיו',
  position: '50% 45%',
}

export const ALL_COURSE_PHOTOS: readonly CoursePhoto[] = [COURSE_HERO_MAIN, COURSE_HERO_TOP, COURSE_HERO_BOTTOM]
