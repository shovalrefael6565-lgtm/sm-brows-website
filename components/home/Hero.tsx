'use client'

import { useRef } from 'react'
import Image from 'next/image'
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion'
import Link from 'next/link'

export default function Hero() {
  const ref = useRef<HTMLElement>(null)
  const prefersReduced = useReducedMotion()

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end start'],
  })
  const imageY = useTransform(
    scrollYProgress,
    [0, 1],
    ['0%', prefersReduced ? '0%' : '8%'],
  )

  return (
    <section
      id="hero"
      ref={ref}
      aria-label="עמוד הבית – S.M BROWS"
      className="relative overflow-hidden bg-brand-cream"
    >

      {/* ── MOBILE hero: full-viewport cinematic frame ──────────────────────
          Image fills 100svh. Shoval's face sits in the upper ~55%.
          A cream gradient rises from the bottom (brand-cream, not dark) —
          the headline and CTA live inside this gradient zone, fully legible.
          No dark overlay; no text competing with the face.
      */}
      <div className="relative min-h-[100svh] lg:hidden">
        <Image
          src="/hero.webp"
          alt="תוצאת עיצוב גבות טבעיות ב-S.M BROWS"
          fill
          priority
          sizes="100vw"
          className="object-cover"
          style={{ objectPosition: 'center 10%' }}
        />

        {/* Cream gradient — rises from bottom, preserving face in upper half */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[52%] bg-gradient-to-t from-brand-cream via-brand-cream/90 to-transparent pointer-events-none"
        />

        {/* Text anchored to bottom of viewport inside the gradient zone */}
        <div className="absolute inset-x-0 bottom-0 px-6 pb-10 flex flex-col items-start">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="font-serif text-[2.6rem] font-medium leading-[1.08] mb-3 text-brand-dark"
          >
            {/*
              ⚠️ הרווחים המפורשים אינם קישוט. JSX בולע את השורות-החדשות
              שבין טקסט לאלמנט, ולכן הטקסט המחולץ מה-HTML היה
              "גבותשמדברותבעד עצמן" — מילה אחת חסרת משמעות בדיוק בכותרת
              הראשית של האתר, וזה מה שגוגל ומנועי AI קראו.
              ה-span הוא display:block, כך שהרווחים לא נראים בעין ולא
              משנים את העיצוב כהוא זה.
            */}
            {'גבות '}
            <span className="block text-brand-rose-text">שמדברות</span>
            {' בעד עצמן'}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.22, duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            className="text-brand-medium text-sm leading-relaxed mb-6 max-w-[320px]"
          >
            מומחית לגבות טבעיות • 5 שנות ניסיון • קליניקה באשקלון
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.34, duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            className="self-stretch"
          >
            <div className="flex gap-2.5">
              <Link
                href="/booking"
                className="flex flex-1 items-center justify-center whitespace-nowrap bg-brand-dark text-white font-bold text-base px-5 py-3 rounded hover:bg-brand-dark/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-dark focus-visible:ring-offset-2 active:scale-[0.97]"
              >
                לקביעת תור
              </Link>
              <Link
                href="/login"
                className="flex flex-1 items-center justify-center whitespace-nowrap bg-brand-rose text-white font-bold text-base px-5 py-3 rounded hover:bg-brand-rose/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose focus-visible:ring-offset-2 active:scale-[0.97]"
              >
                אזור אישי
              </Link>
            </div>
            <div className="flex justify-center mt-4">
              <Link
                href="/course"
                className="text-[0.875rem] font-medium text-brand-medium/80 hover:text-brand-rose transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose focus-visible:rounded-sm whitespace-nowrap"
              >
                S.M BROWS ACADEMY · לקורסים והכשרות ←
              </Link>
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── DESKTOP hero: two-column split (text right / image left in RTL) ── */}
      <div className="hidden lg:flex flex-row min-h-[100svh]">

        {/* TEXT — 1st DOM child → right panel in RTL flex-row */}
        <div className="flex flex-col justify-center ps-16 pe-12 py-24 bg-brand-cream w-[46%] flex-shrink-0">
          <div className="w-full max-w-md">

            {/*
              ⚠️ זהו התאום של ה-<h1> שבגרסת המובייל למעלה — אותו טקסט
              בדיוק, בפריסה אחרת. כשגם הוא היה <h1> היו לעמוד שני H1
              זהים ב-HTML.

              הפתרון הוא לא להסתיר אחד מהם: כל אחד מהשניים display:none
              בברייקפוינט השני, כך שהסרת ה-h1 היחיד הייתה משאירה חצי
              מהמשתמשים בלי כותרת ראשית בעץ הנגישות. לכן ה-h1 הסמנטי
              היחיד ב-DOM הוא של המובייל (וזה גם מה שגוגל רואה, בהיותה
              mobile-first), והגרסה הזו מוכרזת כרמה 1 דרך ARIA — אותה
              משמעות לקוראות מסך, בלי תגית h1 שנייה.
            */}
            <motion.div
              role="heading"
              aria-level={1}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="font-serif text-5xl xl:text-[4.25rem] 2xl:text-[5rem] font-medium leading-[1.05] mb-4 text-brand-dark"
            >
              {'גבות '}
              <span className="block text-brand-rose-text">שמדברות</span>
              {' בעד עצמן'}
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="text-brand-medium text-base leading-relaxed mb-8"
            >
              מומחית לגבות טבעיות • 5 שנות ניסיון • קליניקה באשקלון
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.34, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="flex gap-3">
                <Link
                  href="/booking"
                  className="inline-flex items-center justify-center whitespace-nowrap bg-brand-dark text-white font-bold text-base px-6 py-3 rounded hover:bg-brand-dark/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-dark focus-visible:ring-offset-2 min-w-[9.5rem]"
                >
                  לקביעת תור
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center whitespace-nowrap bg-brand-rose text-white font-bold text-base px-6 py-3 rounded hover:bg-brand-rose/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose focus-visible:ring-offset-2 min-w-[9.5rem]"
                >
                  אזור אישי
                </Link>
              </div>
              <div className="flex justify-center mt-4">
                <Link
                  href="/course"
                  className="text-[0.875rem] font-medium text-brand-medium/70 hover:text-brand-rose transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rose focus-visible:rounded-sm whitespace-nowrap"
                >
                  S.M BROWS ACADEMY · לקורסים והכשרות ←
                </Link>
              </div>
            </motion.div>

            <motion.blockquote
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.62, duration: 0.9, ease: 'easeOut' }}
              className="mt-8 pt-7 border-t border-brand-cream-dark/60"
            >
              <p className="font-serif text-lg leading-relaxed text-brand-dark">
                &ldquo;כל טיפול הוא שילוב של דיוק, טבעיות וקלאסיות.&rdquo;
              </p>
              <footer className="mt-2">
                <cite className="not-italic text-sm font-medium text-brand-muted">— שובל מאירה</cite>
              </footer>
            </motion.blockquote>
          </div>
        </div>

        {/* IMAGE — 2nd DOM child → left panel in RTL flex-row */}
        <div className="relative flex-1 overflow-hidden">
          <motion.div
            style={{ y: imageY }}
            className="absolute inset-0"
          >
            <Image
              src="/hero.webp"
              alt="תוצאת עיצוב גבות טבעיות ב-S.M BROWS"
              fill
              priority
              sizes="55vw"
              className="object-cover"
              style={{ objectPosition: 'center 18%' }}
            />
          </motion.div>

          {/* Column hairline separator */}
          <div
            aria-hidden="true"
            className="absolute inset-y-0 end-0 w-px bg-brand-cream-dark/25 pointer-events-none"
          />
        </div>
      </div>

      {/* Scroll indicator — desktop only */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2, duration: 0.7 }}
        className="absolute bottom-7 start-[23%] hidden lg:flex flex-col items-center"
        aria-hidden="true"
      >
        <motion.div
          animate={{ y: [0, 5, 0] }}
          transition={{ repeat: Infinity, duration: 1.7, ease: 'easeInOut' }}
          className="w-5 h-8 rounded-full border border-brand-rose/30 flex items-start justify-center pt-1.5"
        >
          <div className="w-1 h-1.5 rounded-full bg-brand-rose/50" />
        </motion.div>
      </motion.div>
    </section>
  )
}
