import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { listCrmSources } from '@/lib/db/crm'
import NewCustomerForm from '@/components/admin/NewCustomerForm'

export const dynamic = 'force-dynamic'

/**
 * יצירת לקוחה ידנית.
 *
 * הגישה מוגנת ע"י layout ה-(protected) (requireAdminPage: דגל + admins),
 * וה-route עצמו בודק שוב — כפתור מוסתר אינו הגנה.
 *
 * ⚠️ אין כאן שדה הערה: הערות נוצרות דרך מנגנון ה-notes הקיים בפרופיל,
 * אחרי שהלקוחה קיימת. אין סיבה להכניס אותן לטרנזקציית היצירה.
 */
export default async function NewCustomerPage() {
  const sources = await listCrmSources()

  return (
    <div className="max-w-2xl">
      <Link
        href="/admin/customers"
        className="inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-dark mb-4"
      >
        <ChevronRight className="w-4 h-4" aria-hidden="true" />
        חזרה לרשימת הלקוחות
      </Link>

      <h1 className="font-serif text-2xl font-bold text-brand-dark mb-1">לקוחה חדשה</h1>
      <p className="text-sm text-brand-muted mb-6">
        הלקוחה נוצרת בלי חשבון התחברות. לא נשלח קוד ולא נשלחת הודעה.
      </p>

      <NewCustomerForm sources={sources} />
    </div>
  )
}
