'use client'

import { useState } from 'react'
import { BellRing, Sparkles } from 'lucide-react'
import { type ProductShade } from '@/lib/data'
import ProductNotifyDialog from './ProductNotifyDialog'

interface Props {
  productSlug: string
  productName: string
  /** השם כפי שהוא נקרא בתוך משפט. ראה Product.shortName. */
  shortName: string
  shades?: ProductShade[]
  source: string
}

/**
 * הבלוק שמחזיק את מצב הפתיחה של דיאלוג ההרשמה.
 *
 * ⚠️ קיים כי עמוד המוצר (app/shop/[slug]/page.tsx) הוא Server Component
 * ואינו יכול להחזיק state — בדיוק אותה סיבה שבגללה DeferredWidgets עוטף
 * את קריאות ה-dynamic של הפריסה. הדיאלוג עצמו נשאר רכיב טהור שמקבל
 * onClose, כמו WaitlistDialog.
 */
export default function ProductNotifySection({
  productSlug, productName, shortName, shades, source,
}: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-10 bg-white border border-brand-cream-dark rounded-3xl p-6 shadow-soft">
      <p className="font-serif text-xl font-bold text-brand-dark mb-2 flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-brand-gold" aria-hidden="true" />
        רוצה להיות הראשונה לדעת?
      </p>
      <p className="text-sm text-brand-medium leading-relaxed mb-5">
        השאירי מספר טלפון ונעדכן אותך כשה-{shortName} עולה לאתר.
      </p>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-brand-dark text-white font-semibold text-sm px-7 h-12 rounded-xl hover:bg-brand-dark/90 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-dark focus-visible:ring-offset-2"
      >
        <BellRing className="w-4 h-4" aria-hidden="true" />
        עדכנו אותי בהשקה
      </button>

      {/* ⚠️ אין כאן מחיר ואין "הוסף לסל" — ראה Product.status ב-lib/data.ts. */}
      <p className="text-xs text-brand-muted mt-4">
        ההרשמה אינה רכישה ואינה מחייבת בשום דבר.
      </p>

      {open && (
        <ProductNotifyDialog
          productSlug={productSlug}
          productName={productName}
          shades={shades}
          source={source}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
