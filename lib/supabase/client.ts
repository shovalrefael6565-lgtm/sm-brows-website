'use client'

import { createBrowserClient } from '@supabase/ssr'

/**
 * לקוח Supabase לדפדפן — anon key בלבד, כפוף ל-RLS.
 *
 * משמש את מסכי האזור האישי לקריאת התורים של הלקוחה המחוברת. גם אם מישהי
 * תשנה את השאילתה בקונסול, ה-RLS יחזיר לה רק את השורות שלה.
 *
 * כתיבות (הזזה, ביטול) לא מתבצעות דרכו אלא דרך ה-API בשרת, כדי שאכיפת
 * המדיניות והכתיבה להיסטוריה יקרו במקום אחד שלא ניתן לעקוף.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
