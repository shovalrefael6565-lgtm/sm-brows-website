import type { Metadata } from 'next'
import { Heebo, Playfair_Display } from 'next/font/google'
import './globals.css'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import WhatsAppButton from '@/components/ui/WhatsAppButton'
import AccessibilityWidget from '@/components/ui/AccessibilityWidget'
import FloatingSocialButtons from '@/components/ui/FloatingSocialButtons'

const heebo = Heebo({
  subsets: ['latin', 'hebrew'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-heebo',
  display: 'swap',
})

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-playfair',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'S.M BROWS | עיצוב גבות מקצועי באשדוד',
  description:
    'סטודיו מקצועי לעיצוב גבות באשדוד. מיקרובליידינג, עיצוב גבות טבעי, הרמת גבות. קבעי תור בוואצאפ.',
  keywords: ['מיקרובליידינג', 'עיצוב גבות', 'הרמת גבות', 'אשדוד', 'גבות', 'S.M BROWS'],
  openGraph: {
    title: "S.M BROWS | IT'S ALL ABOUT YOUR EYEBROWS",
    description: 'סטודיו מקצועי לעיצוב גבות באשדוד – מיקרובליידינג, עיצוב טבעי, הרמת גבות',
    type: 'website',
    locale: 'he_IL',
    siteName: 'S.M BROWS',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'S.M BROWS | עיצוב גבות מקצועי',
    description: 'סטודיו מקצועי לעיצוב גבות באשדוד',
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
    <html lang="he" dir="rtl" className={`${heebo.variable} ${playfair.variable}`}>
      <body className="font-sans bg-brand-cream text-brand-dark antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:right-4 focus:z-[9999] focus:bg-brand-gold focus:text-brand-dark focus:px-4 focus:py-2 focus:rounded-lg focus:font-semibold"
        >
          דלגי לתוכן הראשי
        </a>
        <Navbar />
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <Footer />
        <FloatingSocialButtons />
        <WhatsAppButton />
        <AccessibilityWidget />
      </body>
    </html>
  )
}
