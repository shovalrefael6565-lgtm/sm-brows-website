/**
 * שלב 9 — מקור אמת יחיד למסכי הפתיחה של iOS.
 *
 * הרשימה משמשת גם את הסקריפט שמייצר את קבצי ה-PNG
 * (scripts/generate-pwa-assets.mjs) וגם את תגיות ה-<link
 * rel="apple-touch-startup-image"> ב-app/layout.tsx. שתי הרשימות חייבות
 * להיות זהות — אחרת iOS מקבל שאילתת מדיה שמצביעה על קובץ שאינו קיים
 * ופשוט מציג מסך לבן. scripts/test-pwa.mjs אוכף את זה.
 *
 * הערכים הם פיקסלים פיזיים; שאילתת המדיה נגזרת מהם בחלוקה ב-dpr, כי
 * device-width/height נמדדים ב-CSS px.
 */
export type AppleSplash = { w: number; h: number; dpr: number; device: string }

export const APPLE_SPLASH: AppleSplash[] = [
  { w: 1320, h: 2868, dpr: 3, device: 'iPhone 16 Pro Max / 15 Pro Max / 14 Pro Max' },
  { w: 1206, h: 2622, dpr: 3, device: 'iPhone 16 Pro / 15 Pro / 14 Pro' },
  { w: 1290, h: 2796, dpr: 3, device: 'iPhone 16 Plus / 15 Plus / 14 Plus / 13 Pro Max' },
  { w: 1179, h: 2556, dpr: 3, device: 'iPhone 16 / 15 / 14 Pro' },
  { w: 1170, h: 2532, dpr: 3, device: 'iPhone 14 / 13 / 13 Pro / 12 / 12 Pro' },
  { w: 1125, h: 2436, dpr: 3, device: 'iPhone 13 mini / 12 mini / 11 Pro / XS / X' },
  { w: 1242, h: 2688, dpr: 3, device: 'iPhone 11 Pro Max / XS Max' },
  { w: 828, h: 1792, dpr: 2, device: 'iPhone 11 / XR' },
  { w: 1242, h: 2208, dpr: 3, device: 'iPhone 8 Plus / 7 Plus / 6s Plus' },
  { w: 750, h: 1334, dpr: 2, device: 'iPhone SE (2/3) / 8 / 7 / 6s' },
]

export const splashSrc = ({ w, h }: AppleSplash) => `/icons/splash/apple-splash-${w}x${h}.png`

export const splashMedia = ({ w, h, dpr }: AppleSplash) =>
  `(device-width: ${w / dpr}px) and (device-height: ${h / dpr}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`
