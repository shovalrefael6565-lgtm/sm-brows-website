import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    // Tree-shake framer-motion and lucide-react — only bundle what's actually imported
    optimizePackageImports: ['framer-motion', 'lucide-react'],
  },
  // Canonical-domain redirects (permanent / 308 — Google treats it like a 301).
  // Anything reaching the www subdomain or the raw vercel.app deployment URL is
  // sent to the single canonical apex https://smbrows.co.il, preventing
  // duplicate-content across hosts.
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.smbrows.co.il' }],
        destination: 'https://smbrows.co.il/:path*',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'sm-brows-website.vercel.app' }],
        destination: 'https://smbrows.co.il/:path*',
        permanent: true,
      },
    ]
  },
}

export default nextConfig
