import type { Metadata, Viewport } from 'next'
import { Rubik, Dancing_Script, Noto_Serif_Hebrew } from 'next/font/google'
import './globals.css'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import Providers from '@/components/layout/Providers'
import DeferredWidgets from '@/components/layout/DeferredWidgets'
import WhatsAppTracker from '@/components/analytics/WhatsAppTracker'
import { ConsentProvider } from '@/lib/consentContext'
import { isNewBookingSystemEnabled } from '@/lib/featureFlags'
import {
  SITE_URL, PHONE_NUMBER, EMAIL, LOCATION,
  INSTAGRAM_URL, FACEBOOK_URL, TIKTOK_URL,
} from '@/lib/utils'
import { APPLE_SPLASH, splashSrc, splashMedia } from '@/lib/pwa'

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
  /*
    ⚡ ה-favicon הצביע על /logo.png המלא — 294×288, 15KB — והדפדפן מושך
    אותו ב-priority גבוה בדיוק בחלון שבו נמדד ה-FCP, בכל עמוד באתר.
    favicon-64.png הוא אותו לוגו ב-64px (3KB): זהה לחלוטין בעין, כי
    ה-favicon מוצג ממילא ב-16–32px.
  */
  /*
    🔒 שלב 9 — apple-touch-icon הופרד מ-/logo.png לקובץ ייעודי 180×180
    אטום (public/apple-touch-icon.png). iOS לא מכבד שקיפות ומדביק את
    האייקון על רקע שחור, ו-logo.png שקוף ב-294×288 — כלומר מונוגרם כהה
    על ריבוע שחור במסך הבית. הקובץ החדש הוא אותו מונוגרם על רקע
    brand-cream, ונמשך רק בהוספה למסך הבית — לא בטעינת עמוד.
  */
  icons: {
    icon: '/favicon-64.png',
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    // מסכי הפתיחה של iOS — iOS בוחר לפי התאמה מדויקת של שאילתת המדיה,
    // וכשאין התאמה הוא נופל למסך ריק בצבע background_color של המניפסט.
    other: APPLE_SPLASH.map((s) => ({
      rel: 'apple-touch-startup-image',
      url: splashSrc(s),
      media: splashMedia(s),
    })),
  },
  /*
    שלב 9 — התנהגות iOS ב-Add to Home Screen. `capable` מפעיל את מצב
    ה-standalone (בלי סרגל Safari), ו-statusBarStyle 'default' משאיר שעון
    ואייקונים כהים — הרקע העליון של האתר הוא brand-cream בהיר, ו-'black'
    היה מייצר טקסט לבן על קרם.
  */
  appleWebApp: {
    capable: true,
    title: 'S.M BROWS',
    statusBarStyle: 'default',
  },
  applicationName: 'S.M BROWS',
  /*
    Next.js 16 פולט רק את התקן החדש <meta name="mobile-web-app-capable">,
    ש-WebKit מכיר מ-iOS 15.4 בלבד. אייפונים ישנים יותר (iOS 14/15.0) מכירים
    אך ורק את הווריאנט של אפל, וללא התגית הזו הוספה למסך הבית שם נפתחת
    בתוך Safari עם סרגל כתובת — לא standalone. שתי התגיות יכולות לחיות זו
    לצד זו; הדפדפן קורא את זו שהוא מכיר.
  */
  other: {
    'apple-mobile-web-app-capable': 'yes',
  },
  title: {
    default: 'S.M BROWS | עיצוב גבות מקצועי באשקלון',
    template: '%s | S.M BROWS',
  },
  description:
    'קליניקה מקצועית לעיצוב גבות באשקלון. מיקרובליידינג, עיצוב גבות טבעיות, הרמת גבות. קבעי תור בוואצאפ.',
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
  description: 'קליניקה מקצועית לעיצוב גבות באשקלון — מיקרובליידינג, עיצוב גבות טבעיות, הרמת גבות וקורסים.',
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
      opens: '09:00',
      closes: '11:00',
    },
    {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'],
      opens: '15:00',
      closes: '19:00',
    },
  ],
  sameAs: [INSTAGRAM_URL, FACEBOOK_URL, TIKTOK_URL],
  hasOfferCatalog: {
    '@type': 'OfferCatalog',
    name: 'שירותי עיצוב גבות',
    itemListElement: [
      { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'מיקרובליידינג' }, priceCurrency: 'ILS', price: '1800' },
      { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'עיצוב גבות טבעיות' }, priceCurrency: 'ILS', price: '70' },
      { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'הרמת גבות' }, priceCurrency: 'ILS', price: '250' },
    ],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${rubik.variable} ${dancingScript.variable} ${notoSerifHebrew.variable}`}
      data-scroll-behavior="smooth"
    >
      <head>
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
        <ConsentProvider>
        <Providers>
        {/*
          🔒 שלב 15D — הדגל נקרא כאן, בשרת, ומועבר כ-prop. lib/featureFlags
          מסומן 'server-only' ואינו יכול להגיע לקוד לקוח. כשהוא כבוי,
          /login מחזיר 404 ולכן הקישור אינו מוצג כלל.
        */}
        <Navbar newBookingSystemEnabled={isNewBookingSystemEnabled()} />
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <Footer />
        </Providers>
        <DeferredWidgets>
          <WhatsAppTracker />
        </DeferredWidgets>
        </ConsentProvider>
      </body>
    </html>
  )
}
