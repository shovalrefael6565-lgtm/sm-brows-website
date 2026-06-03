import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** כתובת בסיס לאתר — משמשת ל-SEO, sitemap, canonical, OG */
/** תקשורת חברתית — עדכון אחרון: 2026-05-20 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://smbrows.co.il'

export const WHATSAPP_URL = `https://wa.me/9720547261564?text=${encodeURIComponent('היי שובל 🤍 רציתי לקבוע תור')}`
export const PHONE_NUMBER = '054-726-1564'
export const PHONE_RAW = '0547261564'
export const LOCATION = 'הכורמים, אשקלון'
export const EMAIL = 'shoval3654579@gmail.com'
export const INSTAGRAM_URL = 'https://www.instagram.com/shovalmeira/'
export const FACEBOOK_URL = 'https://www.facebook.com/shovalvahdy'
export const TIKTOK_URL = 'https://www.tiktok.com/@shovalbrows?_r=1&_t=ZS-96W3SJ62zyc'
