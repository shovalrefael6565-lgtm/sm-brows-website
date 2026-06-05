import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    // Tree-shake framer-motion and lucide-react — only bundle what's actually imported
    optimizePackageImports: ['framer-motion', 'lucide-react'],
  },
}

export default nextConfig
