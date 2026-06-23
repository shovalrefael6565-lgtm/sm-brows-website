import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    // Tree-shake framer-motion and lucide-react — only bundle what's actually imported
    optimizePackageImports: ['framer-motion', 'lucide-react'],
  },
  // Host canonicalisation (www / vercel.app → smbrows.co.il) is configured in
  // the Vercel Domains dashboard, not here: Vercel's domain layer resolves the
  // host before Next.js `has: host` redirects run, so a next.config redirect is
  // never reached on Vercel. The canonical/OG tags (pinned in lib/utils.ts)
  // already point every host at the apex for SEO.
}

export default nextConfig
