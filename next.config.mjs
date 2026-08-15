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
    // Next.js 16 requires local image query strings to be allow-listed
    // explicitly (anti-enumeration). These are pre-existing cache-busting
    // versions on two before/after images (components/home/BeforeAfterSection.tsx).
    localPatterns: [
      { pathname: '/ba-new-1.webp', search: '?v=3' },
      { pathname: '/ba-new-6.webp', search: '?v=4' },
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
