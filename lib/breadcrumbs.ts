import { SITE_URL } from './utils'

/**
 * BreadcrumbList JSON-LD.
 *
 * ⚠️ רק לעמודים שיש בהם היררכיה אמיתית שהמבקרת באמת עוברת דרכה.
 * אין breadcrumb לדף הבית — הוא השורש, ו-"בית ← בית" הוא סימון מלאכותי.
 * גם לעמודי שירות (התחברות, אזור אישי) אין: הם noindex ממילא.
 *
 * הפריט האחרון הוא העמוד הנוכחי, ולפי המפרט הוא עדיין מקבל `item`
 * עם ה-URL של עצמו — כך ש-@id של כל שלב הוא כתובת אמיתית שמחזירה 200.
 */
export interface Crumb {
  name: string
  path: string
}

export function breadcrumbJsonLd(trail: Crumb[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { name: 'בית', path: '/' },
      ...trail,
    ].map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: crumb.path === '/' ? SITE_URL : `${SITE_URL}${crumb.path}`,
    })),
  }
}
