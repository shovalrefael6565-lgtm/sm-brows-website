interface Props {
  title: string
  titleHighlight?: string
  description?: string
}

/**
 * Hero section for secondary pages.
 * Server Component — no framer-motion, heading is LCP element.
 * No kicker/tag above the heading (craft-floor: eyebrows banned).
 */
export default function PageHero({ title, titleHighlight, description }: Props) {
  return (
    <section
      aria-label="כותרת עמוד"
      className="relative pt-36 pb-16 sm:pt-44 sm:pb-20 bg-brand-cream text-center overflow-hidden"
    >
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-[0.06]"
          style={{ backgroundImage: "url('/page-hero-bg.webp')" }}
        />
        <div className="absolute top-0 inset-x-0 h-px bg-gold-gradient opacity-40" />
        <div className="absolute bottom-0 inset-x-0 h-px bg-gold-gradient opacity-20" />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6">
        <div className="w-8 h-px bg-brand-gold mx-auto mb-8" aria-hidden="true" />
        <h1 className="font-serif text-5xl sm:text-6xl lg:text-[4.5rem] font-medium text-brand-dark leading-[1.1] mb-6">
          {title}
          {titleHighlight && (
            <>
              {' '}
              <span className="text-brand-rose-text">{titleHighlight}</span>
            </>
          )}
        </h1>
        {description && (
          <p className="text-brand-medium text-base sm:text-lg leading-relaxed max-w-lg mx-auto">
            {description}
          </p>
        )}
      </div>
    </section>
  )
}
