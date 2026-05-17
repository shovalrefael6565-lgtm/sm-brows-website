import type { Metadata } from 'next'
import { Heebo, Dancing_Script } from 'next/font/google'
import './globals.css'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import Providers from '@/components/layout/Providers'
import WhatsAppButton from '@/components/ui/WhatsAppButton'
import AccessibilityWidget from '@/components/ui/AccessibilityWidget'
import FloatingSocialButtons from '@/components/ui/FloatingSocialButtons'

const heebo = Heebo({
  subsets: ['latin', 'hebrew'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-heebo',
  display: 'swap',
})

const dancing = Dancing_Script({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dancing',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'S.M BROWS | עיצוב גבות מקצועי באשקלון',
  description:
    'סטודיו מקצועי לעיצוב גבות באשקלון. מיקרובליידינג, עיצוב גבות טבעי, הרמת גבות. קבעי תור בוואצאפ.',
  keywords: ['מיקרובליידינג', 'עיצוב גבות', 'הרמת גבות', 'אשקלון', 'גבות', 'S.M BROWS'],
  openGraph: {
    title: "S.M BROWS | IT'S ALL ABOUT YOUR EYEBROWS",
    description: 'סטודיו מקצועי לעיצוב גבות באשקלון – מיקרובליידינג, עיצוב טבעי, הרמת גבות',
    type: 'website',
    locale: 'he_IL',
    siteName: 'S.M BROWS',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'S.M BROWS | עיצוב גבות מקצועי',
    description: 'סטודיו מקצועי לעיצוב גבות באשקלון',
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: '/',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} ${dancing.variable}`}>
      <body className="font-sans bg-brand-cream text-brand-dark antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:right-4 focus:z-[9999] focus:bg-brand-gold focus:text-brand-dark focus:px-4 focus:py-2 focus:rounded-lg focus:font-semibold"
        >
          דלגי לתוכן הראשי
        </a>
        <Providers>
        <Navbar />
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <Footer />
        </Providers>
        <FloatingSocialButtons />
        <WhatsAppButton />
        <AccessibilityWidget />
      </body>
    </html>
  )
}
