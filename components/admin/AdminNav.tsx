import Link from 'next/link'
import LogoutButton from '@/components/account/LogoutButton'

const LINKS = [
  { href: '/admin', label: 'בקשות ממתינות' },
  { href: '/admin/appointments', label: 'כל התורים' },
  { href: '/admin/customers', label: 'לקוחות' },
  { href: '/admin/reminders', label: 'תזכורות' },
  { href: '/admin/appointments/new', label: 'תור חדש' },
  { href: '/admin/campaigns', label: 'הודעות ללקוחות' },
]

export default function AdminNav() {
  return (
    <header className="border-b border-brand-linen-dark bg-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        {/*
          ⚠️ aria-label נחוץ: הניווט הציבורי (components/layout/Navbar.tsx)
          מוצג גם מעל אזור הניהול, כך שבעמוד יש שני <nav>. בלי שם, קורא
          מסך מציג שתי רשימות "ניווט" זהות ואי אפשר להבדיל ביניהן.
        */}
        <nav aria-label="ניווט ניהול" className="flex flex-wrap items-center gap-5 text-sm font-medium">
          {LINKS.map(l => (
            <Link key={l.href} href={l.href} className="text-brand-dark hover:text-brand-rose transition-colors">
              {l.label}
            </Link>
          ))}
        </nav>
        <LogoutButton />
      </div>
    </header>
  )
}
