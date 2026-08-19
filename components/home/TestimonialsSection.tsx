'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import Image from 'next/image'

const REVIEWS = [
  '/wa-review-1.webp',
  '/wa-review-2.webp',
  '/wa-review-3.webp',
  '/wa-review-4.webp',
  '/wa-review-5.webp',
  '/wa-review-6.webp',
  '/wa-review-7.webp',
  '/wa-review-8.webp',
  '/wa-review-9.webp',
  '/wa-review-10.webp',
  '/wa-review-11.webp',
  '/wa-review-12.webp',
  '/wa-review-13.webp',
  '/wa-review-14.webp',
  '/wa-review-15.webp',
]

/** משך ה-crossfade. חייב להיות זהה ל-transition ב-faceStyle. */
const FADE_MS = 900
/** קצב ה-autoplay. */
const AUTOPLAY_MS = 3000
/**
 * ⚠️ תקרה להמתנה לפענוח תמונה. רשת איטית לא תנעל את הקרוסלה: אחרי
 * התקרה המעבר יוצא בכל מקרה, במקרה הגרוע עם הבהוב אחד — בדיוק ההתנהגות
 * שהייתה קודם תמיד.
 */
const DECODE_TIMEOUT_MS = 2000

/** מקדים-טוען תמונה **מחוץ ל-DOM**. לעולם אינו נכשל ולעולם אינו תוקע. */
function warm(src: string): Promise<void> {
  return new Promise<void>(resolve => {
    if (typeof window === 'undefined') { resolve(); return }
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    const timer = setTimeout(finish, DECODE_TIMEOUT_MS)
    const img = new window.Image()
    const end = () => { clearTimeout(timer); finish() }
    img.onload = end
    img.onerror = end
    img.src = src
    // תמונה שכבר במטמון עשויה להיות complete עוד לפני שה-handlers נרשמו.
    if (img.complete) end()
  })
}

/** ממתין ל-commit של React לפני ההיפוך. rAF **עם נפילה ל-timer**: בטאב
 *  מוסתר rAF אינו נורה כלל, ובלעדי ה-timer המעבר היה נתקע לנצח. */
function nextFrame(): Promise<void> {
  return new Promise<void>(resolve => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    const timer = setTimeout(finish, 60)
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); finish() }))
    }
  })
}

const delay = (ms: number) => new Promise<void>(r => { setTimeout(r, ms) })

/**
 * Double-buffer crossfade: 2 stable <img> elements (face-a / face-b) swap
 * front/back roles on each navigation.  Only 2 images ever exist in the DOM
 * instead of the original 15 — eliminates ~13 unnecessary image downloads.
 *
 * CSS transitions fire because the elements never unmount (stable keys).
 *
 * ═══ מה מבטיח שהמעבר חלק ודטרמיניסטי ═══
 *
 *   1. **ה-src של פנים נכנס משתנה רק כשהן שקופות לגמרי.** קודם ה-preload
 *      של התמונה הבאה נכתב לפנים האחוריות **בזמן ה-fade**, כלומר בדיוק
 *      כשהן עדיין נראות — ולכן נראתה תמונה שלישית מהבהבת באמצע המעבר.
 *      עכשיו ההקדמה נעשית מחוץ ל-DOM (`warm`), ולא נוגעת באף פנים.
 *
 *   2. **התמונה מפוענחת לפני ההיפוך.** קודם ההיפוך קרה אחרי שני frames —
 *      זמן שאין בו שום קשר לטעינה — ולכן תמונה שלא הייתה במטמון "נכנסה"
 *      ריקה. זה מה שנראה כמו היתקעות בין מצבים.
 *
 *   3. **הנעילה משוחררת בטיימר ולא ב-rAF.** rAF אינו נורה בטאב מוסתר;
 *      הדגל `navigating` הישן נשאר דלוק לנצח והקרוסלה מתה עד רענון.
 *
 *   4. **לחיצות מהירות מתמזגות ליעד האחרון** (`pendingRef`) במקום להיבלע
 *      בשקט. הלחיצה האחרונה תמיד מנצחת, בכל קצב לחיצה.
 */
export default function TestimonialsSection() {
  const [slotA, setSlotA] = useState(0)       // index shown in face-a
  const [slotB, setSlotB] = useState(1)       // index shown in face-b
  const [aIsFront, setAIsFront] = useState(true)
  const [displayIdx, setDisplayIdx] = useState(0)

  const aIsFrontRef   = useRef(true)
  const displayIdxRef = useRef(0)
  const pausedRef     = useRef(false)
  const pauseTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** נעילה למשך המעבר בפועל — לא דגל שמישהו צריך לזכור לכבות. */
  const busyRef       = useRef(false)
  /** היעד שנלחץ בזמן מעבר. האחרון קובע. */
  const pendingRef    = useRef<number | null>(null)
  /**
   * ⚠️ היעד שאליו הקרוסלה **בדרך**, ולא מה שמוצג כרגע. `next`/`prev`
   * נגזרים ממנו ולא מ-`displayIdx`: חמש לחיצות מהירות על "הבאה" מתקדמות
   * חמישה צעדים ונוחתות במעבר חלק אחד, במקום להתפרש כולן כ"אחד קדימה"
   * מאותה ביקורת ולהיבלע.
   */
  const targetRef     = useRef(0)
  const aliveRef      = useRef(true)

  /*
    ⚠️ `aliveRef` **מוחזר ל-true בגוף האפקט**, לא רק מאופס ב-cleanup.
    ב-StrictMode של הפיתוח האפקטים רצים mount → unmount → mount; ref
    שרק ה-cleanup נוגע בו נשאר false אחרי ההרכבה השנייה, וכל מעבר היה
    נוטש בשקט. הקרוסלה פשוט לא זזה, בלי שגיאה אחת.
  */
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      if (pauseTimer.current) clearTimeout(pauseTimer.current)
    }
  }, [])

  const runRef = useRef<(target: number) => void>(() => {})

  const run = useCallback(async (target: number) => {
    busyRef.current = true
    targetRef.current = target
    /*
      🔒 `finally` ולא שחרור בסוף הגוף: **כל** יציאה משחררת את הנעילה —
      גם ניתוק הרכיב וגם חריגה בלתי צפויה. דגל שנשאר דלוק הוא בדיוק
      התקלה שהייתה כאן (`navigating` שרק rAF כיבה), ואסור להחליף אותה
      בגרסה חדשה של עצמה.
    */
    try {
      // 1. התמונה נטענת ומפוענחת מחוץ ל-DOM, לפני שנוגעים במשהו נראה.
      await warm(REVIEWS[target])
      if (!aliveRef.current) return

      // 2. נכתבת לפנים האחוריות — שקופות לחלוטין ברגע הזה.
      const backIsA = !aIsFrontRef.current
      if (backIsA) setSlotA(target)
      else         setSlotB(target)

      // 3. אחרי ה-commit של React — היפוך.
      await nextFrame()
      if (!aliveRef.current) return
      aIsFrontRef.current = backIsA
      displayIdxRef.current = target
      setAIsFront(backIsA)
      setDisplayIdx(target)

      // 4. הנעילה מוחזקת עד סוף ה-fade, כדי שה-src של הפנים היוצאות
      //    לא ישתנה בזמן שהן עדיין נראות.
      await delay(FADE_MS)
    } finally {
      busyRef.current = false
    }
    if (!aliveRef.current) return

    // 5. מקדימים את הבאה בתור — מחוץ ל-DOM.
    void warm(REVIEWS[(target + 1) % REVIEWS.length])

    const queued = pendingRef.current
    pendingRef.current = null
    if (queued !== null && queued !== displayIdxRef.current) runRef.current(queued)
  }, [])

  useEffect(() => { runRef.current = t => { void run(t) } }, [run])

  const navigate = useCallback((nextIdx: number) => {
    if (nextIdx === targetRef.current && !busyRef.current) return
    targetRef.current = nextIdx
    if (busyRef.current) { pendingRef.current = nextIdx; return }
    void run(nextIdx)
  }, [run])

  const next = useCallback(() => navigate((targetRef.current + 1) % REVIEWS.length), [navigate])
  const prev = useCallback(() => navigate((targetRef.current - 1 + REVIEWS.length) % REVIEWS.length), [navigate])

  const goManual = useCallback((fn: () => void) => {
    pausedRef.current = true
    fn()
    if (pauseTimer.current) clearTimeout(pauseTimer.current)
    pauseTimer.current = setTimeout(() => { pausedRef.current = false }, 6000)
  }, [])

  /*
    ⚡ ה-autoplay רץ קודם מרגע ה-mount, גם כשהסקשן רחוק מתחת לקפל: כל 3
    שניות הוא החליף ביקורת ומשך צילום מסך נוסף (wa-review-N.webp). התוצאה
    בפועל — הרשת לא נרגעה אף פעם, מדידת Lighthouse בנייד הראתה תמונות
    שממשיכות להיטען עד ~18 שניות ו-Time to Interactive של 16.8 שניות, וכל
    מבקרת שילמה על גלישה בתמונות שלא ראתה. עכשיו הקרוסלה מתחילה להתקדם רק
    כשהסקשן באמת במסך, ונעצרת כשיוצאים ממנו — אותה חוויה בדיוק, בלי
    להתחרות על רוחב הפס עם הטעינה הראשונית.
  */
  /*
    ⚠️ ה-observer נרשם רק אחרי אירוע load, ולא ב-mount. בזמן ההידרציה
    הסקשנים הנדחים (DeferredSections, ssr:false) עדיין ריקים והמסמך קצר
    בהרבה מגובהו הסופי — אומת: הסקשן הזה יושב ב-top≈2983px בפריסה הסופית,
    אבל observer שנרשם מוקדם מדווח "בתוך המסך" ומפעיל את ה-autoplay מיד.
  */
  const sectionRef = useRef<HTMLElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    let io: IntersectionObserver | undefined
    const start = () => {
      io = new IntersectionObserver(
        ([entry]) => setInView(entry.isIntersecting),
        { rootMargin: '200px' },
      )
      io.observe(el)
    }
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })
    return () => { io?.disconnect(); window.removeEventListener('load', start) }
  }, [])

  /*
    ⚠️ טיק אוטומטי **אינו** נכנס לתור כשמעבר כבר רץ (`busyRef`): תור
    שנבנה מטיקים אוטומטיים היה גורם לקרוסלה "להדביק פערים" בקפיצה אחת
    אחרי כל האטה — למשל חזרה לטאב שהדפדפן חנק את הטיימרים שלו. לחיצה של
    אדם כן נכנסת לתור, וזה ההבדל: היא בקשה מפורשת.

    ⚠️ **אין כאן בדיקת `document.hidden`.** היא נשקלה ונדחתה: יש סביבות
    שמדווחות hidden בזמן שהסקשן גלוי בפועל, ובהן ה-autoplay היה מת בשקט —
    בדיוק סוג התקלה שהתיקון הזה בא לסגור. ההאטה בטאב מוסתר כבר מטופלת
    ע"י חניקת הטיימרים של הדפדפן ועל ידי ה-IntersectionObserver למעלה.
  */
  useEffect(() => {
    if (!inView) return
    const timer = setInterval(() => {
      if (pausedRef.current || busyRef.current) return
      next()
    }, AUTOPLAY_MS)
    return () => clearInterval(timer)
  }, [inView, next])

  const faceStyle = (isFront: boolean): React.CSSProperties => ({
    gridColumn: 1,
    gridRow: 1,
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
    borderRadius: '1rem',
    opacity: isFront ? 1 : 0,
    transition: `opacity ${FADE_MS}ms ease-in-out`,
  })

  return (
    <section
      ref={sectionRef}
      id="testimonials"
      aria-labelledby="testimonials-heading"
      className="section-padding bg-brand-rose-bg relative overflow-hidden"
    >
      {/*
        ⚡ רקע הכלים היה background-image ב-CSS: 47KB של WebP גולמי שנטענו
        מיד עם רינדור הסקשן, בלי לעבור דרך /_next/image ובלי אפשרות
        ל-lazy-loading (לרקעי CSS אין loading="lazy"). כ-<Image> הוא עובר
        המרה ל-AVIF בגודל המתאים למסך ונטען רק כשמגיעים לכאן. object-cover
        + opacity-40 משחזרים בדיוק את bg-cover bg-center ו-opacity: 0.4.
      */}
      <div className="absolute inset-0 pointer-events-none opacity-40" aria-hidden="true">
        {inView && (
          /*
            loading="eager": ה-inView הוא מנגנון הדחייה. תמונה שנוספת ל-DOM
            אחרי ההידרציה עם loading="lazy" לא נמשכת מיד ועלולה להישאר ריקה.
            rootMargin של 200px ב-observer מבטיח שהרקע כבר כאן כשמגיעים.
          */
          <Image
            src="/tools-bg.webp"
            alt=""
            fill
            sizes="100vw"
            quality={75}
            loading="eager"
            className="object-cover object-center"
          />
        )}
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <p className="text-xs tracking-[0.25em] text-brand-gold-text font-semibold uppercase mb-3">
            מה אומרות עלינו
          </p>
          <h2
            id="testimonials-heading"
            className="font-serif text-4xl sm:text-5xl font-bold text-brand-dark mb-4"
          >
            לקוחות <span className="text-brand-rose-text">ממליצות</span>
          </h2>
          <div className="flex items-center justify-center gap-3">
            <div className="w-10 h-px bg-brand-gold/50" />
            <span className="text-brand-gold font-serif text-2xl select-none" aria-hidden="true">✦</span>
            <div className="w-10 h-px bg-brand-gold/50" />
          </div>
        </div>

        <div className="flex flex-col items-center gap-5">
          {/* Double-buffer: 2 images total, crossfade via CSS opacity transition.
              Fixed height (not auto) so the wildly varying screenshot aspect
              ratios (279px–1043px tall) don't jump the layout on every slide. */}
          <div className="w-full max-w-sm h-[420px] sm:h-[480px]" style={{ display: 'grid' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={REVIEWS[slotA]}
              alt={aIsFront ? `ביקורת לקוחה ${displayIdx + 1}` : ''}
              aria-hidden={!aIsFront}
              width={384}
              height={480}
              style={faceStyle(aIsFront)}
              loading="lazy"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={REVIEWS[slotB]}
              alt={!aIsFront ? `ביקורת לקוחה ${displayIdx + 1}` : ''}
              aria-hidden={aIsFront}
              width={384}
              height={480}
              style={faceStyle(!aIsFront)}
              loading="lazy"
            />
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => goManual(prev)}
              aria-label="ביקורת קודמת"
              className="w-8 h-8 rounded-full bg-white/70 border border-brand-rose-light text-brand-rose hover:bg-white hover:border-brand-rose transition-all duration-200 flex items-center justify-center shadow-sm cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" aria-hidden="true">
                <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <div className="flex items-center gap-1.5" role="tablist" aria-label="ביקורות">
              {REVIEWS.map((_, i) => (
                <button
                  key={i}
                  role="tab"
                  aria-selected={i === displayIdx}
                  aria-label={`ביקורת ${i + 1}`}
                  onClick={() => goManual(() => navigate(i))}
                  className="p-2 cursor-pointer flex items-center justify-center"
                >
                  <span className={`block rounded-full transition-colors duration-300 ${
                    i === displayIdx ? 'w-4 h-2 bg-brand-rose' : 'w-2 h-2 bg-brand-rose-light hover:bg-brand-rose/50'
                  }`} />
                </button>
              ))}
            </div>

            <button
              onClick={() => goManual(next)}
              aria-label="ביקורת הבאה"
              className="w-8 h-8 rounded-full bg-white/70 border border-brand-rose-light text-brand-rose hover:bg-white hover:border-brand-rose transition-all duration-200 flex items-center justify-center shadow-sm cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
