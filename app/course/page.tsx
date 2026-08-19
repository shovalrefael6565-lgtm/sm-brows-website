import type { Metadata } from 'next'
import CourseHero from '@/components/course/CourseHero'
import CoursePhilosophy from '@/components/course/CoursePhilosophy'
import CourseAudience from '@/components/course/CourseAudience'
import CourseProgram from '@/components/course/CourseProgram'
import CourseFaq from '@/components/course/CourseFaq'
import CourseClosing from '@/components/course/CourseClosing'
import { course, courseFaq, courseOutcomes } from '@/lib/course'
import { SITE_URL } from '@/lib/utils'

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
    images: [{ url: `${SITE_URL}${course.image}` }],
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
    provider: {
      '@type': 'Organization',
      name: 'S.M BROWS',
      url: SITE_URL,
    },
    teaches: [...courseOutcomes],
    hasCourseInstance: {
      '@type': 'CourseInstance',
      courseMode: 'onsite',
      courseWorkload: 'P2D',
      location: { '@type': 'Place', name: course.location },
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

      <CourseHero />
      <CoursePhilosophy />
      <CourseAudience />
      <CourseProgram />
      <CourseFaq />
      <CourseClosing />
    </>
  )
}
