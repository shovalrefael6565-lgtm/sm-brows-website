'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Archive, ArchiveRestore } from 'lucide-react'

/**
 * הסרה מרשימת הלקוחות / החזרה אליה — פעולה בשורת הרשימה עצמה.
 *
 * ═══ מה הפעולה הזו עושה, ומה היא לעולם לא ═══════════════════════════════
 *
 * ✅ מסמנת `archived_at` + `archived_by` (0028). הכרטיס יוצא מהרשימה הפעילה
 *    ומהדיוור, וזהו.
 * 🔴 **אינה מוחקת דבר.** התורים, ההיסטוריה, ההערות, יומן ה-CRM, הסכמת
 *    הדיוור, ההסרה מדיוור והקמפיינים נשארים בדיוק כפי שהם. המחיקה
 *    (delete_customer_if_safe) היא פעולה אחרת לגמרי, והיא חיה רק בכרטיס.
 *
 * ⚠️ ההסרה חסומה כשיש ללקוחה תור פעיל בעתיד — ה-RPC מחזיר 409, וההודעה
 * מוצגת כאן. ארכוב לא היה מבטל את התור, והתוצאה הייתה תור חי ביומן ששייך
 * לכרטיס שנעלם מהמסך, כולל תזכורות שממשיכות לצאת.
 *
 * ⚠️ ההחזרה אינה מבקשת אישור: היא אינה הרסנית, ומחזירה בדיוק למצב הקודם.
 */

/** 🔒 הנוסח שמוצג לפני ההסרה. מקור אחד — גם הכרטיס וגם השורה משתמשים בו. */
export const ARCHIVE_CONFIRM_TEXT =
  'הלקוחה תוסר מהרשימה הפעילה אך היסטוריית התורים והפעילות שלה תישמר.'

export const ARCHIVE_ACTION_LABEL = 'הסרה מרשימת הלקוחות'
export const RESTORE_ACTION_LABEL = 'החזרה לרשימת הלקוחות'

export function confirmArchive(fullName: string): boolean {
  return window.confirm(`להסיר את ${fullName} מרשימת הלקוחות?\n\n${ARCHIVE_CONFIRM_TEXT}`)
}

export default function CustomerArchiveButton({
  customerId, fullName, archivedAt, className,
}: {
  customerId: string
  fullName: string
  archivedAt: string | null
  className?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isArchived = archivedAt !== null

  const run = async () => {
    if (!isArchived && !confirmArchive(fullName)) return

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/archive`, {
        method: isArchived ? 'DELETE' : 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError((data.message as string) ?? 'הפעולה נכשלה. נסי שוב.')
        setBusy(false)
        return
      }
    } catch {
      setError('אין חיבור לאינטרנט. נסי שוב.')
      setBusy(false)
      return
    }

    setBusy(false)
    router.refresh()
  }

  return (
    <span className={className}>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-dark
                   border border-brand-linen-dark hover:border-brand-rose px-2.5 py-1 rounded-full
                   disabled:opacity-60 cursor-pointer transition-colors focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-brand-gold whitespace-nowrap"
      >
        {busy ? (
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
        ) : isArchived ? (
          <ArchiveRestore className="w-3 h-3" aria-hidden="true" />
        ) : (
          <Archive className="w-3 h-3" aria-hidden="true" />
        )}
        {isArchived ? RESTORE_ACTION_LABEL : ARCHIVE_ACTION_LABEL}
      </button>
      {error && (
        <span role="alert" className="block text-[11px] text-brand-rose-text mt-1 max-w-[16rem]">
          {error}
        </span>
      )}
    </span>
  )
}
