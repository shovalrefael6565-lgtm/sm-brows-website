import type { Metadata, Viewport } from 'next'
import { Rubik, Dancing_Script, Noto_Serif_Hebrew } from 'next/font/google'
import './globals.css'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import Providers from '@/components/layout/Providers'
import WhatsAppButton from '@/components/ui/WhatsAppButton'
import AccessibilityWidget from '@/components/ui/AccessibilityWidget'
import FloatingSocialButtons from '@/components/ui/FloatingSocialButtons'
import ScrollToTop from '@/components/ui/ScrollToTop'
import NavigationProgress from '@/components/ui/NavigationProgress'
import {
  SITE_URL, PHONE_NUMBER, EMAIL, LOCATION,
  INSTAGRAM_URL, FACEBOOK_URL, TIKTOK_URL,
} from '@/lib/utils'

// weight 300 (light) removed — no font-light class used in the codebase
const rubik = Rubik({
  subsets: ['latin', 'hebrew'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-rubik',
  display: 'swap',
})

const notoSerifHebrew = Noto_Serif_Hebrew({
  subsets: ['hebrew'],
  weight: ['400', '500', '700'],
  variable: '--font-frank',
  display: 'swap',
})

// weight 600 (semibold) removed — no font-serif + font-semibold combination in codebase
const dancingScript = Dancing_Script({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-dancing',
  display: 'swap',
})

// Playfair Display removed — --font-playfair was loaded but never referenced
// in the Tailwind font stack or any component class

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#faf7f5',
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
  title: {
    default: 'S.M BROWS | עיצוב גבות מקצועי באשקלון',
    template: '%s | S.M BROWS',
  },
  description:
    'קליניקה מקצועית לעיצוב גבות באשקלון. מיקרובליידינג, עיצוב גבות טבעי, הרמת גבות. קבעי תור בוואצאפ.',
  keywords: [
    'מיקרובליידינג', 'עיצוב גבות', 'הרמת גבות', 'גבות', 'גבות באשקלון',
    'עיצוב גבות באשקלון', 'מיקרובליידינג אשקלון', 'הרמת גבות אשקלון',
    'גבות טבעיות', 'גבות מושלמות', 'קליניקת גבות', 'S.M BROWS',
  ],
  authors: [{ name: 'S.M BROWS' }],
  creator: 'S.M BROWS',
  publisher: 'S.M BROWS',
  openGraph: {
    title: "S.M BROWS | IT'S ALL ABOUT YOUR EYEBROWS",
    description: 'קליניקה מקצועית לעיצוב גבות באשקלון – מיקרובליידינג, עיצוב טבעי, הרמת גבות',
    url: SITE_URL,
    type: 'website',
    locale: 'he_IL',
    siteName: 'S.M BROWS',
    images: [
      { url: '/hero.webp', width: 1200, height: 630, alt: 'S.M BROWS — עיצוב גבות מקצועי באשקלון' },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'S.M BROWS | עיצוב גבות מקצועי',
    description: 'קליניקה מקצועית לעיצוב גבות באשקלון',
    images: ['/hero.webp'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  alternates: {
    canonical: '/',
  },
  category: 'beauty',
}

/** JSON-LD: BeautySalon — מופיע בכל עמוד דרך ה-Root Layout */
const localBusinessJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BeautySalon',
  name: 'S.M BROWS',
  alternateName: "S.M BROWS — IT'S ALL ABOUT YOUR EYEBROWS",
  description: 'קליניקה מקצועית לעיצוב גבות באשקלון — מיקרובליידינג, עיצוב גבות טבעי, הרמת גבות וקורסים.',
  url: SITE_URL,
  telephone: PHONE_NUMBER,
  email: EMAIL,
  image: `${SITE_URL}/hero.webp`,
  logo: `${SITE_URL}/logo.png`,
  priceRange: '₪₪',
  address: {
    '@type': 'PostalAddress',
    streetAddress: 'הכורמים',
    addressLocality: 'אשקלון',
    addressCountry: 'IL',
  },
  areaServed: { '@type': 'City', name: 'אשקלון' },
  openingHoursSpecification: [
    {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'],
      opens: '10:00',
      closes: '19:00',
    },
  ],
  sameAs: [INSTAGRAM_URL, FACEBOOK_URL, TIKTOK_URL],
  hasOfferCatalog: {
    '@type': 'OfferCatalog',
    name: 'שירותי עיצוב גבות',
    itemListElement: [
      { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'מיקרובליידינג' }, priceCurrency: 'ILS', price: '1800' },
      { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'עיצוב גבות טבעי' }, priceCurrency: 'ILS', price: '70' },
      { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'הרמת גבות' }, priceCurrency: 'ILS', price: '250' },
    ],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${rubik.variable} ${dancingScript.variable} ${notoSerifHebrew.variable}`}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="preload" href="/hero.webp" as="image" fetchPriority="high" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }}
        />
      </head>
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
        <NavigationProgress />
        <FloatingSocialButtons />
        <WhatsAppButton />
        <ScrollToTop />
        <AccessibilityWidget />
      </body>
    </html>
  )
}
