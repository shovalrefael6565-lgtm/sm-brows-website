import type { Metadata } from 'next'
import { Rubik, Dancing_Script, Playfair_Display, Noto_Serif_Hebrew } from 'next/font/google'
import './globals.css'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import Providers from '@/components/layout/Providers'
import WhatsAppButton from '@/components/ui/WhatsAppButton'
import AccessibilityWidget from '@/components/ui/AccessibilityWidget'
import FloatingSocialButtons from '@/components/ui/FloatingSocialButtons'

const rubik = Rubik({
  subsets: ['latin', 'hebrew'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-rubik',
  display: 'swap',
})

const notoSerifHebrew = Noto_Serif_Hebrew({
  subsets: ['hebrew'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-frank',
  display: 'swap',
})

const dancingScript = Dancing_Script({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dancing',
  display: 'swap',
})

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-playfair',
  display: 'swap',
})

export const metadata: Metadata = {
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
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
    <html lang="he" dir="rtl" className={`${rubik.variable} ${dancingScript.variable} ${playfair.variable} ${notoSerifHebrew.variable}`}>
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
