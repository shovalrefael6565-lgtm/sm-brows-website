/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // AVIF first — ~50% smaller than WebP at same quality
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 31536000,
    deviceSizes: [390, 640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
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
      // Hashed JS/CSS chunks — safe to cache forever (Next.js content-hashes filenames)
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
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
