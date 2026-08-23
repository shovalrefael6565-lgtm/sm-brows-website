import type { Metadata } from 'next'
import CourseHero from '@/components/course/CourseHero'
import CoursePhilosophy from '@/components/course/CoursePhilosophy'
import CourseAudience from '@/components/course/CourseAudience'
import CourseProgram from '@/components/course/CourseProgram'
import CourseFaq from '@/components/course/CourseFaq'
import CourseClosing from '@/components/course/CourseClosing'
import { course, courseFaq, courseOutcomes } from '@/lib/course'
import { SITE_URL, BUSINESS_ID, PERSON_ID, absoluteUrl } from '@/lib/utils'
import { breadcrumbJsonLd } from '@/lib/breadcrumbs'

export const metadata: Metadata = {
  title: 'קורס עיצוב גבות טבעיות',
  description:
    'קורס עיצוב גבות טבעיות של שובל — יומיים, יום עיוני ויום מעשי על מודליסטית. לא רק טכניקה: פיתוח עין מקצועית, התאמה למבנה הפנים, mapping, שיקום, שעווה, חוט, פינצטה וצביעה.',
  alternates: { canonical: '/course' },
  openGraph: {
    title: 'קורס עיצוב גבות טבעיות | S.M BROWS',
    description:
      'יומיים שבהם את מפתחת עין מקצועית ולומדת להתאים גבה נכונה לכל לקוחה — ולא לעבוד לפי תבנית אחת.',
    url: `${SITE_URL}/course`,
    type: 'website',
    // course.image יחסי כיום, כך שהשרשור עבד — אבל זה בדיוק הדפוס
    // ששבר את ה-BlogPosting. absoluteUrl נכון בשני המקרים.
    locale: 'he_IL',
    siteName: 'S.M BROWS',
    images: [{ url: absoluteUrl(course.image), width: 1200, height: 630, alt: 'S.M BROWS — קורס עיצוב גבות טבעיות' }],
  },
}

/**
 * ⚠️ Server Component במלואו. האינטראקטיביות היחידה בעמוד היא חשיפה
 * בגלילה (components/course/Reveal.tsx) ואקורדיון details/summary מקורי —
 * כך שתוכן הקורס כולו מגיע כ-HTML לסריקה ול-LCP מהיר.
 */
export default function CoursePage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: course.name,
    description: course.promise,
    inLanguage: 'he',
    url: `${SITE_URL}/course`,
    // ⚠️ הפניה ל-@id של הישות היחידה שמוגדרת ב-app/layout.tsx, ולא
    // Organization משוכפל. עד לפאס ה-SEO היה כאן צומת נפרד בשם
    // "S.M BROWS" — שני עסקים שונים בעיני מנוע, באותו שם.
    provider: { '@id': BUSINESS_ID },
    // ⚠️ העסק נשאר ה-provider; שובל היא ה-instructor. זו החלוקה הנכונה
    // לפי Schema.org — הגוף שמעמיד את הקורס מול האדם שמעביר אותו — ושתי
    // ההפניות הן ל-@id של ישויות שכבר מוגדרות ב-app/layout.tsx.
    instructor: { '@id': PERSON_ID },
    teaches: [...courseOutcomes],
    hasCourseInstance: {
      '@type': 'CourseInstance',
      courseMode: 'onsite',
      courseWorkload: 'P2D',
      /*
        הקורס מתקיים פיזית בקליניקה באשקלון. course.location הוא הנוסח
        הגלוי בעמוד ("עיר היין, אשקלון"), וה-address מוסיף את העיר בשדה
        המובנה כדי שהמיקום יהיה קריא למכונה — בלי רחוב, בדיוק כמו
        בישות העסקית.
      */
      location: {
        '@type': 'Place',
        name: course.location,
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'אשקלון',
          addressCountry: 'IL',
        },
      },
    },
  }

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: courseFaq.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbJsonLd([{ name: 'קורס עיצוב גבות טבעיות', path: '/course' }]),
          ),
        }}
      />

      <CourseHero />
      <CoursePhilosophy />
      <CourseAudience />
      <CourseProgram />
      <CourseFaq />
      <CourseClosing />
    </>
  )
}
