import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const WHATSAPP_URL = 'https://wa.me/9720547261564'
export const PHONE_NUMBER = '054-726-1564'
export const PHONE_RAW = '0547261564'
export const LOCATION = 'אשקלון'
export const INSTAGRAM_URL = 'https://www.instagram.com/shovalmeira/'
export const FACEBOOK_URL = 'https://www.facebook.com/shovalvahdy'
export const TIKTOK_URL = 'https://www.tiktok.com/@smbrows'
