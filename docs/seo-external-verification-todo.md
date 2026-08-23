# TODO — אימות SEO חיצוני (שלב אחרון)

נפתח 2026-08-23, בסיום ROUND A1. **עדיין לא בוצע.**

כל מה שאומת עד כה נבדק מהצד שלנו — HTML מרונדר, JSON-LD שעובר parsing,
קודי סטטוס. אף אחד מאלה אינו מוכיח מה גוגל ומנועי ה-AI *באמת* רואים.
הסעיפים כאן הם היחידים שיכולים להוכיח את זה, וכולם דורשים גישה לכלים
חיצוניים (Search Console / Bing Webmaster) שאין לסוכן.

---

## 1. Google Search Console — Live URL Inspection

להריץ **Live Test** (לא את הנתונים מהאינדקס — הם ישנים מהתיקונים):

| URL | מה חייב להופיע ב-Rendered HTML |
|---|---|
| `/faq` | 17 שאלות **ו-17 תשובות**. זה עיקר ROUND A1 |
| `/services` | 7 תשובות האקורדיון |
| `/` | `<h1>` **אחד**, והטקסט "גבות שמדברות בעד עצמן" עם רווחים |
| `/course` | תוכן הקורס + `Course` schema |
| `/blog/aftercare-microblading` | `BlogPosting` + `BreadcrumbList` |

לבדוק בכל אחד: **Coverage = Indexable**, ושה-canonical שגוגל בחרה זהה
ל-canonical שהצהרנו.

## 2. Google Rich Results Test

`https://search.google.com/test/rich-results`

- `/` — `BeautySalon` + `WebSite` מזוהים, `@id` יציב, אפס שגיאות
- `/faq` — `FAQPage` עם 17 שאלות, `BreadcrumbList`
- `/course` — `Course`, `FAQPage`, `BreadcrumbList`
- `/blog/<slug>` — `BlogPosting` + `BreadcrumbList`, ו-`image` **בלי**
  הדומיין הכפול (הבאג `smbrows.co.ilhttps://` תוקן; לוודא בפועל)

⚠️ אין לצפות ל-FAQ rich results. מאז 2023 גוגל מציגה אותם כמעט רק
לאתרי ממשל ובריאות. הערך של הסימון כאן הוא הבנת ישות, לא כוכביות.

## 3. אימות שהזחלנים באמת מקבלים 200 — הסעיף הקריטי

⚠️ **הרקע:** ב-2026-08-23, אחרי ~30 בקשות ב-10 דקות מאותו IP,
smbrows.co.il החזיר `HTTP 403` עם `x-vercel-mitigated: challenge` ועמוד
"Vercel Security Checkpoint". החסימה הייתה ברמת IP ונמשכה ~20 דקות.

זה נגרם מ-burst חריג של בדיקות ולא מתעבורה רגילה, **ולכן לא שינינו את
הגדרות ה-bot protection**. אבל זחלן שנתקל ב-challenge מקבל 403 במקום את
העמוד — וזה היה מבטל את כל העבודה של ROUND A1 בלי שנדע.

חובה לאמת שכל אחד מאלה מקבל 200 ולא challenge:

| Bot | קטגוריה | איך לאמת |
|---|---|---|
| `Googlebot` | search-index | GSC → Live URL Inspection (מגיע מ-IP אמיתי של גוגל) |
| `Bingbot` | search-index | Bing Webmaster Tools → URL Inspection / Fetch as Bingbot |
| `OAI-SearchBot` | search-index (ChatGPT) | לוגים בצד השרת — ראה למטה |
| `Claude-SearchBot` | search-index | לוגים |
| `PerplexityBot` | search-index | לוגים |

**איך לאמת את שלושת האחרונים:** אין להם כלי webmaster. הדרך היחידה היא
לוגים — Vercel → Project → Logs, לסנן לפי User-Agent, ולוודא שהם מקבלים
200 ולא 403. אם הם לא מופיעים בלוגים כלל: לא זה שהם נחסמו — הם פשוט עוד
לא ביקרו.

`robots.txt` כבר מתיר את כולם (אומת דטרמיניסטית). השאלה כאן היא שכבת
ה-CDN/WAF שמעל, שאינה מושפעת מ-robots.txt.

**אם מתגלה challenge לזחלן אמיתי:** להוסיף חריגה ב-Vercel Bot Protection
לזחלנים מאומתים. לא לפני שיש ראיה — כרגע אין.

## 4. ואחרי הכל

- להגיש מחדש `sitemap.xml` ב-Search Console (השתנה: `/gallery` ירד,
  `lastmod` המומצא הוסר)
- לוודא ש-`/gallery` יורד מהאינדקס בעקבות ה-308
- לעקוב אחרי Coverage — `/faq` ו-`/services` אמורים לקבל הרבה יותר
  תוכן מאונדקס מאשר קודם

---

**קשור:** `.claude/skills/ai-visibility-optimizer/` — הסקריפט
`check_crawlers.py` בודק את `robots.txt` דטרמיניסטית, אבל מציין
במפורש שגישה מותרת ב-robots.txt אינה מוכיחה שהזחלן מקבל 200 בפועל.
זה בדיוק הפער שסעיף 3 סוגר.
