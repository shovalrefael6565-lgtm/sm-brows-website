interface Props {
  tag?: string
  title: string
  titleHighlight?: string
  description?: string
}

/**
 * שרת בלבד — בלי framer-motion. הכותרת היא לרוב אלמנט ה-LCP של עמודי
 * המשנה, ולכן חייבת להיות גלויה בציור הראשון ולא ממתינה ל-hydration.
 */
export default function PageHero({ tag, title, titleHighlight, description }: Props) {
  return (
    <section
      aria-label="כותרת עמוד"
      className="relative pt-36 pb-16 sm:pt-44 sm:pb-20 bg-hero-gradient text-center overflow-hidden"
    >
      {/* Background image at 50% opacity */}
      <div
        className="absolute inset-0 bg-cover bg-center pointer-events-none"
        style={{ backgroundImage: "url('/page-hero-bg.webp')", opacity: 0.5 }}
        aria-hidden="true"
      />
      <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6">
        {tag && (
          <p className="text-xs sm:text-sm tracking-[0.2em] text-brand-gold-text font-semibold uppercase mb-3">
            {tag}
          </p>
        )}
        <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-bold text-brand-dark mb-4">
          {title}
          {titleHighlight && (
            <>
              {' '}
              <span className="text-brand-rose-text">{titleHighlight}</span>
            </>
          )}
        </h1>
        {description && (
          <p className="text-brand-medium text-base sm:text-lg leading-relaxed">
            {description}
          </p>
        )}
      </div>
    </section>
  )
}
