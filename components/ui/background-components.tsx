'use client'

export function GlowBackground({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {/* Yellow warm glow – top */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        aria-hidden="true"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 80% 55% at 50% -5%, #FFF991 0%, transparent 70%)',
          opacity: 0.22,
          mixBlendMode: 'screen',
        }}
      />
      {/* Orange glow – bottom */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        aria-hidden="true"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 70% 45% at 50% 105%, #FF7112 0%, transparent 70%)',
          opacity: 0.18,
          mixBlendMode: 'screen',
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  )
}
