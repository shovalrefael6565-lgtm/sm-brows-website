const isProd = process.env.NODE_ENV === 'production'

/**
 * שלב 5 (CSP וכותרות אבטחה) — מקורות מבוססי מיפוי בפועל של הקוד (ראה דוח
 * שלב 5): אין fetch/XHR/WebSocket/EventSource לצד שלישי (כל קריאות ה-fetch
 * בצד לקוח הן ל-/api/* של האתר עצמו), אין iframe אמיתי, אין תמונת <img>
 * חיצונית (התמונות ב-lib/data.ts דרך images.unsplash.com עוברות דרך
 * /_next/image בצד שרת — הדפדפן עצמו תמיד פונה ל-'self'), הגופנים דרך
 * next/font/google מתארחים עצמאית בבנייה, ווידאו/מדיה מקומיים בלבד.
 * GoogleAnalytics.tsx ו-MetaPixel.tsx קיימים בקוד אך אינם מיובאים משום מקום
 * (מושבתים) — לכן אין googletagmanager.com / facebook.net / facebook.com ב-CSP.
 *
 * 'unsafe-inline' ב-script-src: Next.js 16 מזריק JS מוטבע ל-hydration/RSC
 * streaming (למשל self.__next_f.push(...)) בלי מנגנון nonce/hash זמין לרינדור
 * סטטי — nonce תקין ידרוש הזרקה דינמית per-request (proxy.ts / רינדור דינמי),
 * מה שנאסר במפורש כדי לשמר SSG/ISR ומטמון CDN קיים. תגית ה-JSON-LD
 * (dangerouslySetInnerHTML, type="application/ld+json") אינה "מוכנה" ע"י
 * הדפדפן כ-script בכלל ואינה כפופה ל-script-src, כך שאינה תלויה בהתרה הזו.
 * 'unsafe-inline' ב-style-src: תכונת ה-style המוטבעת של React (style={{...}})
 * וגיליונות סגנון קריטיים שמזריק Next עצמו — ללא מקבילה תואמת-סטטי.
 */
const cspDirectives = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isProd ? '' : ` 'unsafe-eval'`}`,
  `script-src-attr 'none'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self'`,
  `font-src 'self'`,
  `connect-src 'self'`,
  `media-src 'self'`,
  `worker-src 'self'`,
  `manifest-src 'self'`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
  `frame-src 'none'`,
  ...(isProd ? [`upgrade-insecure-requests`] : []),
]
const contentSecurityPolicy = cspDirectives.join('; ')

const permissionsPolicy = [
  'camera=()', 'microphone=()', 'geolocation=()', 'gyroscope=()',
  'magnetometer=()', 'accelerometer=()', 'payment=()', 'usb=()',
  'midi=()', 'fullscreen=()', 'picture-in-picture=()', 'display-capture=()',
  'publickey-credentials-get=()', 'screen-wake-lock=()',
  'xr-spatial-tracking=()', 'interest-cohort=()',
].join(', ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: permissionsPolicy },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  { key: 'X-XSS-Protection', value: '0' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Host canonicalisation (www / vercel.app → smbrows.co.il) is configured in
  // the Vercel Domains dashboard, not here: Vercel's domain layer resolves the
  // host before Next.js `has: host` redirects run, so a next.config redirect is
  // never reached on Vercel. The canonical/OG tags (pinned in lib/utils.ts)
  // already point every host at the apex for SEO.
  images: {
    // AVIF first — ~50% smaller than WebP at same quality
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 31536000,
    deviceSizes: [390, 640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
    // Next.js 16 default is [75] only — pinned explicitly to preserve the
    // quality= values already used across the app (75/80/90).
    qualities: [75, 80, 90],
    // Next.js 16 requires local images to be allow-listed explicitly
    // (anti-enumeration). The wildcard entry covers every local image with
    // no query string (the vast majority); the exact entries below allow
    // the specific cache-busting versions used on a few images.
    localPatterns: [
      { pathname: '/**', search: '' },
      { pathname: '/ba-new-1.webp', search: '?v=3' },
      { pathname: '/ba-new-6.webp', search: '?v=4' },
      { pathname: '/hero.webp', search: '?v=2' },
    ],
  },
  compress: true,
  poweredByHeader: false,
  // Strip console.* in production (keeps console.error for debugging)
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error'] }
      : false,
  },
  experimental: {
    optimizePackageImports: ['framer-motion', 'lucide-react'],
  },
  async headers() {
    return [
      // CSP + security headers on every route — additive only (different
      // header keys than the Cache-Control rules below), so it doesn't
      // touch existing static/SSG caching behavior.
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      // Static assets — 1 year immutable cache
      {
        source: '/:path*\\.(jpg|jpeg|png|webp|avif|svg|ico|woff|woff2)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      // No explicit rule for /_next/static/:path* — Next.js 16 already serves
      // content-hashed build assets (JS/CSS/fonts) with this exact
      // `Cache-Control: public, max-age=31536000, immutable` by default.
      // Verified via production build + local `next start`: identical header
      // value on hashed JS/CSS/media, and the manual rule triggered a build
      // warning ("Setting a custom Cache-Control header can break Next.js
      // development behavior") that a redundant override no longer needs.
      // 🔒 שלב 2 (מידע פרטי) — מידע אישי/ניהולי, לעולם לא במטמון משותף.
      // מוחל ברמת next.config כדי לכסות גם תגובות שגיאה בלי לגעת בכל route
      // בנפרד. אינו נוגע ב-/api/bookings/slots או ב-/api/shabbat (ציבוריים).
      {
        source: '/api/auth/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      {
        source: '/api/appointments/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      {
        source: '/api/admin/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
    ]
  },
}

export default nextConfig
