'use client'

import { motion } from 'framer-motion'

/**
 * template.tsx re-mounts on every navigation (unlike layout.tsx which persists).
 * This gives us smooth page-to-page transitions in the App Router.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}
