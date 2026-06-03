export interface Service {
  id: string
  name: string
  tagline: string
  description: string
  homeDescription?: string   // short 1-2 line version shown on homepage
  suitableFor?: string[]     // "למי מתאים?" bullet list
  price: string
  duration: string
  image: string
  images: string[]
  homeImages?: string[]
  imagePositions?: string[]
  homeImagePositions?: string[]
  features: string[]
}

export interface GalleryItem {
  id: string
  category: 'microblading' | 'natural' | 'lifting'
  type: 'before-after' | 'portrait' | 'process'
  beforeImage?: string
  afterImage?: string
  image?: string
  alt: string
  caption?: string
  objectPosition?: string
  flipX?: boolean
  imageTransform?: string
  leftObjectPosition?: string
  rightObjectPosition?: string
  rightScale?: number
}

export interface BlogPost {
  id: string
  slug: string
  title: string
  excerpt: string
  content: string
  category: string
  date: string
  image: string
  readTime: number
}

export interface Product {
  id: string
  name: string
  description: string
  price: number
  image: string
  category: string
  badge?: string
  isDigital?: boolean
  isPremium?: boolean
  includes?: string[]
}

// ── Services ──────────────────────────────────────────────────────────────────

export const services: Service[] = [
  {
    id: 'microblading',
    name: 'מיקרובליידינג',
    tagline: 'גבות מושלמות עד שנה',
    description:
      'טכניקת הדמיית שערה עדינה המיועדת למילוי אזורים דלילים ולעיצוב הגבות במראה טבעי. הטיפול מותאם באופן אישי למבנה הפנים ולצורת הגבה הרצויה.',
    homeDescription: 'פתרון לאזורים דלילים באמצעות הדמיית שערה עדינה וטבעית.',
    suitableFor: [
      'גבות דלילות או לא אחידות',
      'אזורים חסרים בגבה',
      'מי שמעוניינת במראה טבעי ומסודר יותר',
    ],
    price: '',
    duration: '2–3 שעות',
    image: '/microblading-2.webp',
    images: [
      '/microblading-2.webp',
      '/microblading-9.webp',
    ],
    homeImages: [
      '/microblading-8.webp',
      '/microblading-5.webp',
      '/microblading-9.webp',
    ],
    homeImagePositions: [
      '50% 35%',
      '50% 35%',
      '50% 25%',
    ],
    features: [
      'מראה טבעי ועדין',
      'התאמה אישית לכל לקוחה',
      'מתאים לגבות דלילות או לא סימטריות',
      'כולל טיפול חיזוק לאחר 6 שבועות',
    ],
  },
  {
    id: 'natural-design',
    name: 'עיצוב גבות טבעיות',
    tagline: 'ההגדרה המושלמת',
    description:
      'עיצוב גבות מדויק ומקצועי המדגיש את יופי הפנים הטבעי. הגדרה מותאמת אישית לצורת הפנים ולמבנה הגבה הטבעי שלך.',
    homeDescription: 'התאמת צורת הגבה למבנה הפנים לקבלת מראה טבעי ומחמיא.',
    price: '₪70',
    duration: '15–30 דקות',
    image: '/natural-1.webp',
    images: [
      '/1222.webp',
      '/natural-10.webp',
      '/natural-1.webp',
      '/natural-2.webp',
      '/natural-8.webp',
      '/natural-4.webp',
      '/natural-5.webp',
      '/natural-6.webp',
      '/natural-7.webp',
      '/natural-9.webp',
    ],
    imagePositions: [
      '50% 30%',
      '50% 40%',
      '50% 15%',
      '50% 5%',
      '50% 18%',
      '50% 25%',
      '50% 25%',
      '50% 20%',
      '50% 20%',
      '50% 35%',
    ],
    homeImagePositions: [
      '50% 30%',
      '50% 40%',
      '50% 15%',
      '50% 5%',
      '50% 18%',
      '50% 25%',
      '50% 25%',
      '50% 20%',
      '50% 20%',
      '50% 35%',
    ],
    features: [
      'תוצאה מיידית ומדויקת',
      'מראה מלוטש ומוגדר',
      'שמירה על הצורה הטבעית',
    ],
  },
  {
    id: 'brow-lifting',
    name: 'הרמת גבות',
    tagline: 'הרמה ללא ניתוח',
    description:
      'טיפול מתקדם להרמה ועיצוב הגבות ללא פולשנות. מעניק מראה מורם ופתוח לעיניים, גבות מוגדרות ומאורגנות לתוצאה דרמטית ורעננה.',
    homeDescription: 'עיצוב והרמה למראה מסודר, מלא ומודגש יותר.',
    price: '₪250',
    duration: '45 דקות',
    image: '/lifting-1.webp',
    images: [
      '/123.webp',
      '/lifting-1.webp',
      '/lifting-2.webp',
      '/lifting-3.webp',
      '/lifting-4.webp',
      '/lifting-5.webp',
    ],
    imagePositions: [
      '50% 30%',
      '65% 50%',
      '50% 0%',
      '50% 0%',
      '50% 0%',
      '50% 20%',
    ],
    homeImages: [
      '/123.webp',
      '/lifting-1.webp',
      '/lifting-2.webp',
      '/lifting-3.webp',
      '/lifting-4.webp',
      '/lifting-5.webp',
    ],
    homeImagePositions: [
      '50% 30%',
      '65% 55%',
      '50% 22%',
      '50% 15%',
      '50% 20%',
      '50% 25%',
    ],
    features: [
      'אפקט הרמה מיידי',
      'תוצאות ל-6–8 שבועות',
      'ללא כאב וללא החלמה',
      'מתאים לכל סוגי הגבות',
    ],
  },
]

// ── Course ────────────────────────────────────────────────────────────────────

export const courseService = {
  name: 'קורס עיצוב גבות מקצועי',
  tagline: 'הפכי את התשוקה למקצוע',
  description:
    'קורס פרימיום אינטנסיבי ב-2 מפגשים שיהפוך אותך לאמנית גבות מקצועית. תלמדי את כל הטכניקות המתקדמות, תקבלי ערכת כלים מקצועית, ותצאי עם הסמכה וביטחון מלא להתחיל לעבוד.',
  price: '₪2,500',
  sessions: '2 מפגשים',
  format: 'פרונטלי או אונליין',
  image:
    'https://images.unsplash.com/photo-1560869713-7d0a29430803?w=800&h=500&q=80&auto=format&fit=crop',
  features: [
    'תיאוריה ופרקטיקה מלאה',
    'ערכת כלים מקצועית כלולה',
    'הסמכה מוכרת בתום הקורס',
    'ליווי וייעוץ גם לאחר הקורס',
    'מספר מקומות מוגבל לחוויה אישית',
    'מתאים למתחילות ולמי שרוצה להתקדם',
  ],
}

// ── Gallery ───────────────────────────────────────────────────────────────────

export const galleryItems: GalleryItem[] = [
  // ── מיקרובליידינג ──
  {
    id: 'g31',
    category: 'microblading',
    type: 'before-after',
    beforeImage: '/natural-before-1.webp',
    afterImage: '/natural-after-1.webp',
    alt: 'לפני ואחרי מיקרובליידינג – שינוי מרהיב',
    leftObjectPosition: '50% 32%',
    rightObjectPosition: '50% 50%',
  },
  {
    id: 'g1',
    category: 'microblading',
    type: 'before-after',
    beforeImage: '/microblading-3.webp',
    afterImage: '/microblading-4.webp',
    alt: 'השוואת זוויות מיקרובליידינג – גבות מלאות ומוגדרות',
    leftObjectPosition: '50% 10%',
    rightObjectPosition: '50% 15%',
  },
  {
    id: 'g9',
    category: 'microblading',
    type: 'portrait',
    image: '/microblading-2.webp',
    alt: 'לקוחה מרוצה לאחר מיקרובליידינג',
    caption: 'תוצאות מדהימות',
    objectPosition: '50% 20%',
  },
  {
    id: 'g21',
    category: 'microblading',
    type: 'portrait',
    image: '/microblading-9.webp',
    alt: 'מיקרובליידינג – תוצאה טבעית ומוגדרת',
    caption: 'מיקרובליידינג – תוצאה מרהיבה',
    objectPosition: '50% 25%',
  },
  {
    id: 'g28',
    category: 'lifting',
    type: 'portrait',
    image: '/lifting-1.webp',
    alt: 'לקוחה לאחר הרמת גבות – גבות מורמות וסדורות',
    caption: 'הרמת גבות – תוצאה מושלמת',
    objectPosition: '65% 55%',
  },
  {
    id: 'g17',
    category: 'microblading',
    type: 'before-after',
    beforeImage: '/microblading-7.webp',
    afterImage: '/microblading-5.webp',
    alt: 'לפני ואחרי מיקרובליידינג – שינוי מרהיב',
    leftObjectPosition: '50% 20%',
    rightObjectPosition: '50% 20%',
  },
  {
    id: 'g22',
    category: 'microblading',
    type: 'before-after',
    beforeImage: '/microblading-10.webp',
    afterImage: '/microblading-11.webp',
    alt: 'לפני ואחרי מיקרובליידינג',
    leftObjectPosition: '50% 30%',
    rightObjectPosition: '50% 30%',
  },
  {
    id: 'g23',
    category: 'microblading',
    type: 'before-after',
    beforeImage: '/microblading-12.webp',
    afterImage: '/microblading-13.webp',
    alt: 'לפני ואחרי מיקרובליידינג',
    leftObjectPosition: '50% 25%',
    rightObjectPosition: '50% 25%',
  },
  {
    id: 'g24',
    category: 'microblading',
    type: 'before-after',
    beforeImage: '/microblading-14.webp',
    afterImage: '/microblading-15.webp',
    alt: 'לפני ואחרי מיקרובליידינג',
    leftObjectPosition: '50% 25%',
    rightObjectPosition: '50% 25%',
  },
  {
    id: 'g25',
    category: 'microblading',
    type: 'before-after',
    beforeImage: '/microblading-16.webp',
    afterImage: '/microblading-17.webp',
    alt: 'לפני ואחרי מיקרובליידינג',
    leftObjectPosition: '50% 25%',
    rightObjectPosition: '50% 25%',
  },
  {
    id: 'g26',
    category: 'microblading',
    type: 'before-after',
    beforeImage: '/microblading-18.webp',
    afterImage: '/microblading-19.webp',
    alt: 'לפני ואחרי מיקרובליידינג',
    leftObjectPosition: '50% 25%',
    rightObjectPosition: '50% 25%',
  },
  // ── עיצוב גבות טבעי ──
  {
    id: 'g29',
    category: 'natural',
    type: 'portrait',
    image: '/natural-10.webp',
    alt: 'לקוחה עם עיצוב גבות טבעי – גבות מושלמות',
    caption: 'עיצוב טבעי – תוצאה מדהימה',
    objectPosition: '50% 40%',
  },
  {
    id: 'g3',
    category: 'natural',
    type: 'portrait',
    image: '/natural-1.webp',
    alt: 'לקוחה עם עיצוב גבות טבעי',
    caption: 'עיצוב טבעי – הגדרה מושלמת',
    objectPosition: '50% 8%',
  },
  {
    id: 'g3b',
    category: 'natural',
    type: 'portrait',
    image: '/natural-2.webp',
    alt: 'לקוחה עם עיצוב גבות טבעי',
    caption: 'עיצוב טבעי – תוצאה טבעית',
    objectPosition: '50% 5%',
  },
  {
    id: 'g8',
    category: 'natural',
    type: 'portrait',
    image: '/natural-4.webp',
    alt: 'עיצוב גבות טבעי – תוצאה מרהיבה',
    caption: 'עיצוב טבעי – תוצאה מרהיבה',
    objectPosition: '50% 18%',
  },
  {
    id: 'g11',
    category: 'natural',
    type: 'portrait',
    image: '/natural-5.webp',
    alt: 'לקוחה עם עיצוב גבות טבעי',
    caption: 'עיצוב טבעי – חיוך מושלם',
    objectPosition: '50% 28%',
  },
  {
    id: 'g13',
    category: 'natural',
    type: 'portrait',
    image: '/natural-7.webp',
    alt: 'עיצוב גבות טבעי – גבות מוגדרות',
    caption: 'עיצוב טבעי – גבות מוגדרות',
    objectPosition: '50% 5%',
  },
  {
    id: 'g19',
    category: 'natural',
    type: 'portrait',
    image: '/natural-6.webp',
    alt: 'עיצוב גבות טבעי – גבות מוגדרות',
    caption: 'עיצוב טבעי – גבות מוגדרות',
    objectPosition: '50% 30%',
  },
  {
    id: 'g18',
    category: 'natural',
    type: 'portrait',
    image: '/natural-9.webp',
    alt: 'עיצוב גבות טבעי – גבות מוגדרות ועיניים ירוקות',
    caption: 'עיצוב טבעי – תוצאה מרהיבה',
    objectPosition: '50% 35%',
  },
  {
    id: 'g27',
    category: 'natural',
    type: 'portrait',
    image: '/natural-8.webp',
    alt: 'עיצוב גבות טבעי – גבות מושלמות ועדינות',
    caption: 'עיצוב טבעי – הגדרה עדינה',
    objectPosition: '50% 18%',
  },
  // ── הרמת גבות ──
  {
    id: 'g20',
    category: 'lifting',
    type: 'portrait',
    image: '/lifting-3.webp',
    alt: 'לקוחה לאחר הרמת גבות – תוצאה מרהיבה',
    caption: 'הרמת גבות – תוצאה מרהיבה',
    objectPosition: '50% 15%',
  },
  {
    id: 'g13',
    category: 'lifting',
    type: 'portrait',
    image: '/lifting-2.webp',
    alt: 'לקוחה לאחר הרמת גבות – גבות מורמות',
    caption: 'הרמת גבות – תוצאה טבעית',
    objectPosition: '50% 22%',
  },
  {
    id: 'g32',
    category: 'lifting',
    type: 'portrait',
    image: '/lifting-4.webp',
    alt: 'לקוחה לאחר הרמת גבות – גבות מוגדרות ומורמות',
    caption: 'הרמת גבות – תוצאה מדהימה',
    objectPosition: '50% 20%',
  },
  {
    id: 'g33',
    category: 'lifting',
    type: 'portrait',
    image: '/lifting-5.webp',
    alt: 'לקוחה לאחר הרמת גבות – גבות מורמות וסדורות',
    caption: 'הרמת גבות – תוצאה טבעית',
    objectPosition: '50% 25%',
  },
]

// ── Blog Posts ────────────────────────────────────────────────────────────────

export const blogPosts: BlogPost[] = [
  {
    id: '1',
    slug: 'aftercare-microblading',
    title: 'מדריך החלמה לאחר מיקרובליידינג',
    excerpt:
      'עשית מיקרובליידינג? קודם כל, מזל טוב 🤍 כדי לשמור על התוצאה בצורה הטובה ביותר, חשוב להקפיד על הוראות הטיפול בימים ובשבועות שלאחר הטיפול.',
    image:
      'https://images.unsplash.com/photo-1616394584738-fc6e612e71b9?w=800&h=450&q=80&auto=format&fit=crop',
    category: 'מיקרובליידינג',
    date: '2024-03-15',
    readTime: 5,
    content: `
עשית מיקרובליידינג? קודם כל, מזל טוב 🤍

כדי לשמור על התוצאה בצורה הטובה ביותר ולאפשר לעור להחלים בצורה תקינה, חשוב להקפיד על הוראות הטיפול בימים ובשבועות שלאחר הטיפול.

מיקרובליידינג הוא טיפול לעיצוב ומילוי גבות במראה טבעי באמצעות הדמיית שערות עדינה. תהליך ההחלמה משפיע באופן ישיר על איכות התוצאה ועל עמידות הפיגמנט לאורך זמן.

## 7 כללים חשובים לאחר הטיפול

### 1. הימנעי מהרטבת הגבות בשבוע הראשון

בשבוע הראשון חשוב להימנע מהרטבת הגבות כדי לאפשר לאזור להחלים בצורה תקינה.

מומלץ להימנע מ:

- שטיפת פנים ישירה באזור הגבות
- ים, בריכה או ג'קוזי
- סאונה וחדרי אדים
- פעילות גופנית מאומצת הגורמת להזעה מרובה

### 2. שמרי על לחות בהתאם להנחיות

לאחר 24 השעות הראשונות יש למרוח שכבה דקה של הקרם שהומלץ לך לאחר הטיפול.

אין צורך בכמות גדולה – שכבה דקה מספיקה בהחלט.

### 3. אל תגרדי ואל תקלפי

בימים שלאחר הטיפול ייתכן שיופיע קילוף עדין של העור.

זהו חלק טבעי מתהליך ההחלמה.

חשוב לא לגרד, לקלף או להסיר את העור באופן ידני כדי לא לפגוע בתוצאה.

### 4. הגני על הגבות מפני השמש

חשיפה ממושכת לשמש עלולה להשפיע על עמידות הפיגמנט.

במהלך החודש הראשון מומלץ:

- להימנע מחשיפה ישירה לשמש
- להשתמש בכובע בעת הצורך
- לאחר ההחלמה להשתמש במקדם הגנה באזור

### 5. הימנעי ממוצרי טיפוח פעילים באזור הגבות

במהלך תקופת ההחלמה מומלץ להימנע משימוש ב:

- רטינול
- פילינגים
- חומצות AHA / BHA
- מוצרים המכילים אלכוהול באזור הגבות

### 6. אל תוותרי על טיפול החיזוק

טיפול החיזוק מתבצע בדרך כלל לאחר 6–8 שבועות.

במהלך הטיפול ניתן לחזק את הפיגמנט, לבצע תיקונים קטנים במידת הצורך ולהשלים אזורים שבהם הצבע נקלט בצורה חלשה יותר.

### 7. התאזרי בסבלנות

תהליך ההחלמה משתנה מעט בין אחת לשנייה.

בימים הראשונים הגבות עשויות להיראות כהות יותר מהתוצאה הסופית, ובהמשך אף בהירות יותר באופן זמני.

זהו חלק טבעי מהתהליך.

התוצאה הסופית מתקבלת לאחר שהעור מסיים את תהליך ההחלמה והצבע מתייצב.

## מה צפוי במהלך ההחלמה?

### ימים 1–3

הגבות נראות כהות ומודגשות יותר מהתוצאה הסופית. ייתכן אודם קל באזור.

### ימים 4–7

מתחיל קילוף עדין של העור כחלק מתהליך ההחלמה.

### ימים 7–14

הגבות עשויות להיראות בהירות יותר באופן זמני. זהו שלב תקין בתהליך.

### שבועות 3–4

הצבע מתייצב בהדרגה וניתן לראות את התוצאה הסופית בצורה ברורה יותר.

## מתי כדאי ליצור קשר?

אם מופיעים כאבים חריגים, נפיחות משמעותית או כל דבר שמדאיג אותך, מומלץ ליצור קשר בהקדם.

גם אם יש לך שאלה קטנה או שאת לא בטוחה אם מה שאת רואה הוא חלק מתהליך ההחלמה – תמיד אפשר לפנות אליי ואשמח לעזור 🤍
    `,
  },
  {
    id: '2',
    slug: 'natural-brow-tips',
    title: '7 טיפים לעיצוב גבות טבעי שישדרגו את המראה שלך',
    excerpt:
      'הגבות הן מסגרת הפנים – ועיצוב נכון יכול לשנות הכל. הנה 7 טיפים מקצועיים שיעזרו לך להשיג גבות טבעיות ומוגדרות שמחמיאות לפנים שלך.',
    image: '/mamar-tevi.webp',
    category: 'עיצוב גבות',
    date: '2024-02-20',
    readTime: 4,
    content: `
## הגבות הן הכוכבות של הפנים

לא מאמינות כמה גבות יכולות לשנות מראה? גבות מוגדרות ומעוצבות נכון יכולות לגרום לעיניים להיראות גדולות יותר, לפנים להיראות סימטריות יותר, ולמראה הכולל להיות מרוכז ומלוטש.

## 7 הטיפים שחייבות לדעת

### 1. הכירי את צורת הפנים שלך
לכל צורת פנים יש גבה מושלמת:
- **פנים אובאליות** – כמעט כל צורת גבה תתאים
- **פנים עגולות** – גבות מקושתות גבוהות יאריכו את הפנים
- **פנים מרובעות** – קשת עדינה מקזזת את הקשיחות
- **פנים לבביות** – גבות עם קשת נמוכה ישוו את הפרצוף

### 2. השתמשי בכלי הנכון למדידה
שיטת המדידה הקלאסית:
- **תחילת הגבה** – ישר מעל הנחיר הפנימי
- **שיא הגבה** – ישר מעל האישון, מעט לכיוון החוץ
- **קצה הגבה** – מהנחיר החיצוני לפינת העין החיצונית

### 3. פחות זה יותר
הטעות הנפוצה ביותר היא עיצוב יתר. גבות שנראות כמצוירות עם פלסטלינה מזיקות יותר מגבות לא מעוצבות. עדיפי מינימום!

### 4. בחרי צבע נכון
כלל האצבע: הגבות צריכות להיות גוון אחד או שניים כהה יותר מהשיער. לבלונדיות – גוון אפרפר חם. לכהות – גוון חום. אל תלכי על שחור מוחלט אם את לא בטוחה.

### 5. מלאי פערים, אל תצבעי שטח
השתמשי בעיפרון קשה לשיטות גבות, ומלאי רק את הפערים בין השיערות הקיימות. אל תמלאי שטחים רחבים – זה יראה מלאכותי.

### 6. הגדירי את התחתית, לא רק את העליון
רוב הנשים מקדישות תשומת לב לגבול העליון, אבל דווקא הקו התחתון הוא מה שנותן את ההגדרה האמיתית.

### 7. חתמי עם ג'ל
ג'ל שקוף לגבות ישמור על כל מה שעשית ויפסיק שיערות פורחות. שים ג'ל תמיד בתנועה כלפי מעלה וכלפי חוץ.

## הסוד האמיתי? טיפול מקצועי

הטיפים האלה מצוינים לתחזוקה יומיומית, אבל לתוצאה המושלמת? טיפול מקצועי אחת ל-4–6 שבועות הוא ההשקעה הטובה ביותר שתעשי לגבות שלך. צרי קשר לקביעת תור!
    `,
  },
  {
    id: '3',
    slug: 'brow-lifting-faq',
    title: 'שאלות נפוצות על הרמת גבות – כל מה שרצית לדעת',
    excerpt:
      'הרמת גבות הפכה לאחד הטיפולים הפופולריים ביותר בעולם. אבל מה זה בדיוק? כואב? כמה זמן זה מחזיק? ריכזתי תשובות לכל השאלות שלך.',
    image: '/mamar.webp',
    category: 'הרמת גבות',
    date: '2024-01-10',
    readTime: 6,
    content: `
## הרמת גבות – המדריך המלא לשאלות ותשובות

### מה זה בדיוק הרמת גבות?

הרמת גבות (Brow Lamination) היא טיפול קוסמטי שמיישר ומרים את שיערות הגבה. בדומה לפן לשיער, הטיפול "מלמד" את השיערות לגדול בכיוון הרצוי – כלפי מעלה וכלפי חוץ. התוצאה: גבות מרומות, מסודרות, ומלאות יותר.

### האם זה כואב?

ממש לא! הרמת גבות היא אחד הטיפולים הנוחים ביותר. לא מדובר בעקירה, לא בקעקוע, ולא בכל פרוצדורה כואבת. תרגישי קצת לחות ותחושת חום קלה – זהו.

### כמה זמן הטיפול אורך?

הטיפול אורך בין 60 ל-90 דקות:
- **הכנה וייעוץ** – 15 דקות
- **הרמה ועיצוב** – 45 דקות
- **תיקונים סופיים** – 15–30 דקות

### כמה זמן התוצאות מחזיקות?

בממוצע 6–8 שבועות, תלוי בסוג השיער ובטיפול. כדי לשמור על התוצאה כמה שיותר:
- הימנעי מלחות ב-24 שעות הראשונות
- מרחי שמן קסטור כל לילה
- אל תמשמשי בגבות בתכיפות

### מי מתאימה לטיפול?

הטיפול מתאים לכמעט כולן, אבל במיוחד למי שיש לה:
- גבות עם שיערות לא מסודרות
- גבות שגדלות "נגד הכיוון"
- גבות דלילות שרוצות להיראות מלאות יותר
- מי שרוצה מראה "clean girl" טרנדי

### מי לא מתאימה?

- נשים בהיריון או הנקה (בגלל הכימיקלים)
- עור עם פצעים פעילים באזור הגבות
- אלרגיה לאחד מרכיבי הטיפול (בדיקת רגישות תמיד מומלצת)

### האם צריך טיפול מיוחד אחרי?

כן, ה-24 שעות הראשונות חשובות:
- **אין מים** על הגבות
- **אין מוצרי טיפוח** על האזור
- **אין לישון עם הפנים כלפי מטה**
- מותר (ואף מומלץ!) להשתמש בג'ל גבות

### האם יש תוצאות לפני ואחרי דרמטיות?

בהחלט! הטיפול יכול לשנות לחלוטין את מראה הפנים. גבות שנראו "ישנות" ולא מוגדרות הופכות לגבות עפות ומרחפות. אם את רוצה לראות דוגמאות – בקרי בגלריה שלי.

### כמה זה עולה?

ב-S.M BROWS הרמת גבות עולה ₪250. המחיר תלוי בסוג הטיפול ובתוספות.

### איך קובעים תור?

שלחי לי הודעה בוואצאפ ואחזור אלייך בהקדם לקביעת מועד מתאים!
    `,
  },
]

// ── Products ──────────────────────────────────────────────────────────────────

export const products: Product[] = [
  {
    id: 'p1',
    name: 'סרום לצמיחת גבות',
    description: 'סרום מרכז עם ביוטין ויטמין E לחיזוק וצמיחת שיערות הגבה',
    price: 129,
    image:
      'https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?w=400&h=400&q=80&auto=format&fit=crop',
    category: 'סרומים',
    badge: 'בסטסלר',
  },
  {
    id: 'p2',
    name: 'עיפרון גבות מקצועי',
    description: 'עיפרון דו-צדדי לציור שיערות ומילוי פערים בגבה',
    price: 79,
    image:
      'https://images.unsplash.com/photo-1512361436605-a484bdb34b5f?w=400&h=400&q=80&auto=format&fit=crop',
    category: 'כלים',
  },
  {
    id: 'p3',
    name: "ג'ל גבות ללא צבע",
    description: "ג'ל שקוף לעיצוב וקיבוע שיערות הגבה כל היום",
    price: 65,
    image:
      'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&h=400&q=80&auto=format&fit=crop',
    category: 'כלים',
  },
  {
    id: 'p4',
    name: 'ערכת עיצוב גבות מלאה',
    description: 'ערכה מקצועית הכוללת עיפרון, ג׳ל, מסרק וספייסר',
    price: 199,
    image:
      'https://images.unsplash.com/photo-1607990281513-2c110a25bd8c?w=400&h=400&q=80&auto=format&fit=crop',
    category: 'ערכות',
    badge: 'חדש',
  },
  {
    id: 'p5',
    name: 'קרם טיפוח לאחר מיקרובליידינג',
    description: 'קרם מרגיע ומזין לשלב ההחלמה לאחר טיפולי קוסמטיקה',
    price: 89,
    image:
      'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&q=80&auto=format&fit=crop',
    category: 'טיפוח',
  },
  {
    id: 'p6',
    name: 'שמן קסטור טהור לגבות',
    description: 'שמן קסטור אורגני 100% לחיזוק ועיבוי שיערות הגבה',
    price: 55,
    image:
      'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=400&h=400&q=80&auto=format&fit=crop',
    category: 'סרומים',
  },
  {
    id: 'p7',
    name: 'חוברת קורס עיצוב גבות',
    description: 'חוברת PDF מקצועית עם כל החומר התיאורטי והפרקטי של קורס עיצוב גבות – להורדה מיידית',
    price: 0,
    image:
      'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&h=400&q=80&auto=format&fit=crop',
    category: 'קורסים',
    badge: 'PDF',
    isDigital: true,
  },
  {
    id: 'p8',
    name: 'קורס עיצוב גבות טבעיות מקצועי',
    description: 'קורס אונליין מקצועי למעצבות גבות שרוצות להתמקצע בעיצוב טבעי. רכשי מיומנויות מתקדמות ועבדי עם לקוחות בביטחון.',
    price: 150,
    image: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&h=600&q=80&auto=format&fit=crop',
    category: 'קורסים',
    badge: 'אונליין',
    isDigital: true,
    isPremium: true,
    includes: ['חוברת מקצועית דיגיטלית', 'פגישת זום אישית', 'תמיכה לאחר הקורס'],
  },
]
