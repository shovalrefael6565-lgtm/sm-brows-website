'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, X, Check, BellRing } from 'lucide-react'
import { cn, WHATSAPP_URL } from '@/lib/utils'
import { useDialogA11y } from '@/lib/useDialogA11y'
import { normalizePhone } from '@/lib/phone'
import { type ProductShade } from '@/lib/data'
import {
  PRIVACY_PATH, PRIVACY_NOTICE_VERSION, PRIVACY_ACK_LABEL,
  PRODUCT_INTEREST_PRIVACY_NOTICE, PRODUCT_INTEREST_ACK_ERROR,
  splitPrivacyLink, splitNoticeLinks,
} from '@/lib/privacyNotice'

/**
 * הרשמה לעדכון על מוצר "בקרוב".
 *
 * ═══ ⚠️ זו אינה רכישה ואינה הזמנה ═══
 *
 * הנוסחים כאן חייבים לשקף את זה בכל מסך, כולל מסך ההצלחה — בדיוק מאותה
 * סיבה ש-WaitlistDialog חוזר על "זו אינה קביעת תור": לקוחה שתקרא "נרשמת"
 * ותצפה שהמוצר מגיע אליה היא התקלה שהפיצ'ר הזה חייב למנוע.
 *
 * ═══ 🔒 מה נשלח לשרת ═══
 *
 * טלפון מנורמל, ה-slug של המוצר, גוון (רשות), מקור ההרשמה, ואישור
 * הפרטיות עם הגרסה. **אין מייל ואין שם** — ראה למטה.
 *
 * ⚠️ **אין שדה שם, וזו החלטת מוצר עם מחיר בצד השרת.** הטלפון הוא אמצעי
 * הקשר היחיד בשלב הזה. 🔴 המשמעות ל-Backend: `link_or_create_customer_by_phone`
 * (0018) דורשת שם, ו-`customers.full_name` הוא `not null` עם CHECK על
 * אורך 2–80 (0001). כלומר מסלול ההרשמה הזה **אינו יכול** ליצור כרטיס
 * לקוחה דרך אותה פונקציה, ושכבת ה-DB חייבת להיבנות לכך במפורש: או טבלה
 * שמחזיקה את הטלפון בעצמה, או קישור ל-`customers` רק כשכרטיס כבר קיים.
 * אין לפתור את זה בשם ממלא מקום — זה היה מזהם את ה-CRM.
 *
 * ⚠️ הגוון נשלח כ-id ולא כשם תצוגה, והשרת מסנן אותו מול רשימת הגוונים
 * של המוצר. קלט שאינו ברשימה אינו נשמר — ראה ProductShade ב-lib/data.ts.
 * (למוצר הנוכחי אין גוונים, ולכן הבורר כלל אינו מרונדר.)
 *
 * ⚠️ הולידציה כאן היא **נוחות בלבד**. הבדיקה המחייבת היא בשרת: טלפון
 * מנורמל, גוון מול הרשימה, ואישור הפרטיות — אותה דוקטרינה כמו
 * /api/waitlist.
 */

interface Props {
  productSlug: string
  productName: string
  shades?: ProductShade[]
  /** מהיכן הגיעה ההרשמה — נשמר על השורה. */
  source: string
  onClose: () => void
}

type Field = 'phone'

export default function ProductNotifyDialog({
  productSlug, productName, shades, source, onClose,
}: Props) {
  const [phone, setPhone] = useState('')
  const [shadeId, setShadeId] = useState('')
  const [ack, setAck] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<Field | 'ack', string>>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showWhatsApp, setShowWhatsApp] = useState(false)
  const [done, setDone] = useState<'joined' | 'already' | null>(null)

  const dialogRef = useDialogA11y<HTMLDivElement>({
    open: true,
    onClose: saving ? undefined : onClose,
    lockScroll: true,
  })

  /**
   * 🔒 `normalizePhone` הוא מקור האמת היחיד לפורמט — אותה פונקציה שהשרת
   * וה-CHECK ב-DB משתמשים בה. היא מחזירה null לכל קלט שאינו נייד ישראלי
   * תקין, ולכן היא גם הוולידציה וגם הנרמול בקריאה אחת.
   */
  const normalizedPhone = normalizePhone(phone)

  const validate = () => {
    const next: Partial<Record<Field | 'ack', string>> = {}
    if (!normalizedPhone) next.phone = 'יש להזין מספר נייד ישראלי תקין'
    if (!ack) next.ack = PRODUCT_INTEREST_ACK_ERROR
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const submit = async () => {
    if (saving) return
    if (!validate()) return

    setSaving(true)
    setError(null)
    setShowWhatsApp(false)
    try {
      const res = await fetch('/api/product-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productSlug,
          shade: shadeId || null,
          // ⚠️ נשלח מנורמל, אבל השרת **חייב** לנרמל שוב: קלט מהדפדפן
          // אינו ראיה לכלום.
          phone: normalizedPhone,
          source,
          privacyNoticeAcknowledged: true,
          privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        }),
      })
      const data = await res.json().catch(() => null)
      /*
       * ⚠️ `alreadyRegistered` הוא **הצלחה**, לא שגיאה: הטלפון כבר ברשימה
       * למוצר הזה, וזו בדיוק התוצאה שהלקוחה ביקשה. ה-API מחזיר 200 במקום
       * 201, ושני המקרים מציגים מסך הצלחה.
       */
      if (res.ok && data?.saved) {
        setDone(data.alreadyRegistered ? 'already' : 'joined')
        return
      }
      setError(data?.message ?? 'לא הצלחנו לשמור את ההרשמה.')
      /*
       * ⚠️ `data === null` = התשובה כלל אינה JSON — שגיאת פלטפורמה, עמוד
       * שגיאה של השרת, או endpoint חסר. במקרה כזה אין `whatsappFallback`
       * בתשובה, והלקוחה הייתה מקבלת כישלון **בלי שום דרך פעולה**. תשובה
       * שבורה היא בדיוק המקרה שבו הנפילה לוואטסאפ נחוצה יותר מכל.
       */
      setShowWhatsApp(data ? Boolean(data.whatsappFallback) : true)
    } catch {
      /*
       * 🔒 fail-closed, כמו בכל טופס אחר באתר: אם לא קיבלנו תשובה, אנחנו
       * **לא** מציגים הצלחה. ההנחה "כנראה נשמר" היא בדיוק מה שמייצר
       * לקוחה שמחכה לעדכון שלא יגיע.
       */
      setError('לא הצלחנו לשמור את ההרשמה כרגע.')
      setShowWhatsApp(true)
    } finally {
      setSaving(false)
    }
  }

  const inputClass = (hasError: boolean) =>
    cn(
      'w-full px-4 py-3.5 rounded-2xl border bg-white text-brand-dark placeholder:text-brand-muted',
      'text-base sm:text-sm transition-colors outline-none focus:ring-2 focus:ring-brand-gold focus:border-brand-gold',
      hasError ? 'border-red-400' : 'border-brand-cream-dark hover:border-brand-gold/50',
    )

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-brand-dark/50 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notify-title"
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-xl max-h-[92vh] sm:max-h-[85vh] overflow-y-auto"
      >
        {/* ידית גרירה ויזואלית — מסמנת גיליון תחתון במובייל */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center" aria-hidden="true">
          <span className="w-10 h-1 rounded-full bg-brand-cream-dark" />
        </div>

        <div className="sticky top-0 bg-white/95 backdrop-blur px-5 pt-3 pb-3 border-b border-brand-cream-dark flex items-start justify-between gap-3 z-10">
          <div>
            <h2
              id="notify-title"
              className="font-serif text-lg font-bold text-brand-dark flex items-center gap-1.5"
            >
              <BellRing className="w-4 h-4 text-brand-rose" aria-hidden="true" />
              עדכנו אותי
            </h2>
            <p className="text-xs text-brand-muted mt-0.5">{productName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="סגירה"
            className="p-1.5 -m-1.5 rounded-lg text-brand-muted hover:bg-brand-cream transition-colors disabled:opacity-40 cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {done ? (
          <div className="px-5 py-10 text-center">
            <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-brand-rose-bg mb-4">
              <Check className="w-7 h-7 text-brand-rose-text" aria-hidden="true" />
            </span>
            <h3 className="font-serif text-xl font-bold text-brand-dark mb-2">
              {done === 'already' ? 'את כבר ברשימה 🤎' : 'את ברשימה 🤎'}
            </h3>
            {/* ⚠️ גם במסך ההצלחה: זו אינה רכישה ואינה הזמנה. */}
            <p className="text-sm text-brand-medium leading-relaxed max-w-xs mx-auto">
              נעדכן אותך כשהמוצר עולה לאתר. לא ביצעת רכישה ואין כאן הזמנה.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 h-12 px-8 rounded-xl bg-brand-dark text-white text-sm font-semibold cursor-pointer"
            >
              סגירה
            </button>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* ⚠️ "המוצר" ולא שם קשיח — הדיאלוג משרת כל מוצר coming_soon,
                ושם המוצר ממילא מופיע בכותרת שמעל. */}
            <p className="text-xs text-brand-medium bg-brand-cream rounded-xl p-3 leading-relaxed">
              השאירי מספר טלפון ונעדכן אותך כשהמוצר עולה לאתר. ההרשמה אינה
              רכישה, אינה הזמנה ואינה מחייבת בדבר.
            </p>

            {/* ── טלפון — אמצעי הקשר היחיד בשלב הזה ── */}
            <div>
              <label
                htmlFor="notify-phone"
                className="block text-sm font-semibold text-brand-dark mb-1.5"
              >
                מספר טלפון <span className="text-brand-rose" aria-hidden="true">*</span>
              </label>
              <input
                id="notify-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value)
                  setErrors((p) => ({ ...p, phone: undefined }))
                }}
                placeholder="05X-XXXXXXX"
                autoComplete="tel"
                dir="ltr"
                aria-required="true"
                aria-invalid={!!errors.phone}
                aria-describedby={errors.phone ? 'notify-err-phone' : undefined}
                className={cn(inputClass(!!errors.phone), 'text-left')}
              />
              {errors.phone && (
                <p id="notify-err-phone" role="alert" className="text-brand-rose-text text-xs mt-1">
                  {errors.phone}
                </p>
              )}
            </div>

            {/* ── גוון (רשות) ──
                ⚠️ "בלי העדפה" הוא ערך אמיתי ולא placeholder מושבת: גוון
                הוא רשות, וצריכה להיות דרך מפורשת להשאיר אותו ריק. */}
            {shades && shades.length > 0 && (
              <div>
                <p className="block text-sm font-semibold text-brand-dark mb-2">
                  גוון מועדף <span className="text-brand-muted font-normal">(רשות)</span>
                </p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="בחירת גוון מועדף">
                  <button
                    type="button"
                    onClick={() => setShadeId('')}
                    aria-pressed={shadeId === ''}
                    className={cn(
                      'px-3 py-2 rounded-xl text-sm font-semibold border transition-colors cursor-pointer',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                      shadeId === ''
                        ? 'bg-brand-rose text-white border-brand-rose'
                        : 'bg-white text-brand-dark border-brand-cream-dark hover:border-brand-rose',
                    )}
                  >
                    בלי העדפה
                  </button>
                  {shades.map((shade) => (
                    <button
                      key={shade.id}
                      type="button"
                      onClick={() => setShadeId(shade.id)}
                      aria-pressed={shadeId === shade.id}
                      className={cn(
                        'inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border transition-colors cursor-pointer',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
                        shadeId === shade.id
                          ? 'bg-brand-rose text-white border-brand-rose'
                          : 'bg-white text-brand-dark border-brand-cream-dark hover:border-brand-rose',
                      )}
                    >
                      {shade.hex && (
                        <span
                          aria-hidden="true"
                          className="w-3.5 h-3.5 rounded-full border border-black/10"
                          style={{ backgroundColor: shade.hex }}
                        />
                      )}
                      {shade.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 🔒 יידוע האיסוף — אותה תבנית בדיוק כמו בטופס ההזמנה. */}
            <p className="text-brand-muted text-xs leading-relaxed">
              {splitNoticeLinks(PRODUCT_INTEREST_PRIVACY_NOTICE).map((seg, i) =>
                seg.href ? (
                  <Link
                    key={i}
                    href={seg.href}
                    target="_blank"
                    className="font-semibold text-brand-rose-text underline hover:text-brand-rose-text/80"
                  >
                    {seg.text}
                  </Link>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )}
            </p>

            {/* 🔒 אישור חובה — אין מסלול עוקף, והשרת אוכף שוב. */}
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => {
                  setAck(e.target.checked)
                  setErrors((p) => ({ ...p, ack: undefined }))
                }}
                aria-required="true"
                aria-invalid={!!errors.ack}
                className="sr-only peer"
              />
              <span
                aria-hidden="true"
                className={cn(
                  'flex items-center justify-center w-5 h-5 rounded-md border-2 flex-shrink-0 mt-0.5 transition-colors',
                  'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-gold peer-focus-visible:ring-offset-2',
                  ack ? 'border-brand-rose bg-brand-rose' : 'border-brand-cream-dark bg-white',
                )}
              >
                {ack && <Check className="w-3 h-3 text-white" />}
              </span>
              <span className="text-xs text-brand-dark leading-relaxed">
                {(() => {
                  const { before, linkText, after } = splitPrivacyLink(PRIVACY_ACK_LABEL)
                  return (
                    <>
                      {before}
                      <Link
                        href={PRIVACY_PATH}
                        target="_blank"
                        onClick={(ev) => ev.stopPropagation()}
                        className="font-semibold text-brand-rose-text underline"
                      >
                        {linkText}
                      </Link>
                      {after}
                    </>
                  )
                })()}
              </span>
            </label>
            {errors.ack && (
              <p className="text-brand-rose-text text-xs -mt-2" role="alert">
                {errors.ack}
              </p>
            )}

            {error && (
              <div className="bg-brand-rose-bg border border-brand-rose/30 rounded-xl p-3" role="alert">
                <p className="text-sm text-brand-rose-text">{error}</p>
                {showWhatsApp && (
                  <a
                    href={WHATSAPP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 text-xs font-semibold text-brand-rose-text underline"
                  >
                    לפנייה בוואטסאפ
                  </a>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className={cn(
                'w-full h-12 rounded-xl text-sm font-semibold transition-colors cursor-pointer',
                'flex items-center justify-center gap-2',
                saving
                  ? 'bg-brand-cream-dark text-brand-muted cursor-not-allowed'
                  : 'bg-brand-dark text-white hover:bg-brand-dark/90',
              )}
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              {saving ? 'שומרת...' : 'עדכנו אותי בהשקה'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
