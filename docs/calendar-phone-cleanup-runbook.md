# Runbook — ניקוי טלפון היסטורי מ-Google Calendar (9C)

**סוג מסמך:** תיעוד תפעולי (שלב 9C.2 — כלים בלבד). אינו ייעוץ משפטי.
**תאריך כתיבה:** 2026-08-17
**Checkpoint שממנו נבנה:** `1fdf471` (9B).

**אין במסמך זה נתוני לקוחות אמיתיים** — כל דוגמה, אם קיימת, היא סינתטית.

---

## 0. סטטוס — קרא לפני הכול

🔴 **הכלים המתוארים במסמך הזה נכתבו ונבדקו (מוקים בלבד, בלי DB/רשת). הם
טרם הורצו ולו פעם אחת מול Google Calendar או Supabase האמיתיים — לא
dry-run, לא audit, לא execute.** שום ניקוי לא בוצע. אל תעדכני מסמך זה
כך שישתמע אחרת עד שהרצה אמיתית אכן קרתה, ותעדכני אז את התוצאה בפועל
(counts, תאריך, מי הריץ) — לא לפני.

---

## 1. שני פורמטים היסטוריים — למה הכלים שונים

| | Format B | Format A |
|---|---|---|
| נוצר ע"י | `createAppointmentEvent` (אישור מנהלת) | `createBookingEvent` (הנתיב הציבורי הישן, `POST /api/bookings`) |
| תקופה חיה בפועל | `50ac783`–`103b14e` (2026-08-04 עד 2026-08-16) | 2026-05-17–2026-08-04 17:33 דרך ה-UI; נשאר ציבורי בלי caller עד `1bc601d` (2026-08-15) |
| קישור ל-DB | `appointments.google_event_id` + `extendedProperties.private` | **אין** — אין שורת DB, אין extendedProperties |
| הוכחת בעלות אוטומטית | כן — source קבוע + appointment_id תואם | **לא קיימת** |
| כלי | `scripts/cleanup-calendar-phone.mjs` — dry-run/execute, PATCH על description בלבד | `scripts/audit-legacy-calendar-descriptions.mjs` — read-only, ספירות בלבד, **אין PATCH בשום מצב** |

⚠️ **אין cutoff תאריכי בשום כלי.** לא לפי `created_at`, לא לפי זמן commit.
כלי Format B סורק את *כל* השורות עם `google_event_id IS NOT NULL`
ומסתמך על ה-sanitizer (לא על תאריך) כדי לדעת אם יש מה לנקות. כלי
Format A סורק את *כל* היומן, כולל אירועים עתידיים, בלי `timeMin`/`timeMax`.

---

## 2. Format B — סדר ההרצה המחייב

```
1. deploy   — הקוד שכבר לא כותב טלפון ל-description (מ-103b14e ומעלה)
              נפרס בפועל לפרודקשן (Vercel) — לא רק committed מקומית.
2. verify   — אימות בפועל שגרסת הפרודקשן החיה אכן לא כותבת טלפון,
              למשל ע"י אישור תור בדיקה ובדיקת ה-description שנוצר.
              *מחוץ להיקף 9C* — תנאי סף חיצוני, לא שלב בכלי עצמו.
3. dry-run  — npx tsx scripts/cleanup-calendar-phone.mjs \
                --deployment-confirm=PHONE_FREE_CREATION_DEPLOYED_V1
              (ברירת המחדל — לעולם לא PATCH)
4. אישור    — בעלת העסק סוקרת את ה-counts מה-dry-run.
5. execute  — npx tsx scripts/cleanup-calendar-phone.mjs \
                --deployment-confirm=PHONE_FREE_CREATION_DEPLOYED_V1 \
                --execute --confirm=REMOVE_LINKED_CALENDAR_PHONE_V1
```

**למה השלב הזה קריטי:** אם ה-deploy+verify לא הושלמו, אירועים חדשים
שנוצרים *אחרי* ה-execute עדיין יכולים לצאת עם טלפון, כי הקוד שיוצר אותם
בפרודקשן עדיין ישן. ניקוי במצב כזה מטעה — נראה כאילו הבעיה נפתרה כשהיא
ממשיכה לקרות. הדגל `--deployment-confirm` הוא רק תזכורת קשה-לטעות; הוא
**לא** בודק בפועל את מצב הפריסה — זו אחריות המפעילה.

הכלי idempotent: הרצה חוזרת (אחרי הפרעה/קריסה) בטוחה — אירועים שכבר
נוקו מוחזרים כ-`already_clean` בלי PATCH נוסף. פרטים מלאים על dry-
run/execute/retry/ETag: התיעוד בראש `lib/calendarPhoneCleanup.ts` ובראש
`scripts/cleanup-calendar-phone.mjs`.

---

## 3. Format A — למה אין ניקוי אוטומטי, ומה כן

Format A מכיל **גם** טלפון וגם, כשקיימות, **הערות חופשיות** (`📝 הערות:`) —
טקסט שהלקוחה הקלידה בטופס, שעלול לשאת מידע רגיש יותר מטלפון. אבל
לאירועים האלה **אין** `extendedProperties` ואין שורת DB — שום דרך קיימת
בקוד להוכיח בעלות אוטומטית ברמה מספקת ל-PATCH (ניתוח מלא: 9C.1 סעיף 3,
ו-`lib/legacyCalendarAudit.ts`). **המסקנה המפורשת: Format A אינו מתאים
למחיקה/עדכון אוטומטי.**

הטיפול:

1. **`scripts/audit-legacy-calendar-descriptions.mjs`** — read-only,
   סופר "מועמדים" (summary+description תואמים בדיוק לתבנית ההיסטורית)
   בלי לחשוף שם/טלפון/הערה/event ID, ובלי לגעת ביומן בשום צורה. מריצים
   אותו כדי לדעת בערך כמה אירועים כאלה קיימים, לא כדי לנקות.
2. **ניקוי ידני בלבד**, ע"י בעלת העסק, בממשק Google Calendar:
   - לחפש בכל היומן — **כולל אירועים עתידיים**, לא רק עבר — לפי הביטוי
     המדויק `📞 טלפון:` (ואז, לכל תוצאה, לבדוק גם `📝 הערות:`).
   - לאמת כל תוצאה בעין (תאריך/שם/הקשר) לפני עריכה — הביטוי לבדו אינו
     הוכחת בעלות.
   - להסיר **גם את שורת הטלפון וגם את שורת ההערות** (אם קיימת) מאירוע
     שאומת, ידנית, אירוע אחר אירוע. אין קיצור דרך אוטומטי לזה.

---

## 4. שאלות נפוצות

**האם retention_hold (9B) רלוונטי כאן?** לא. הוא מוגדר במפורש לחסום רק
`privacy_retention_reset_old_notes` (איפוס `appointments.notes` ב-DB) —
מנגנון DB בלבד, לא קשור ל-Google Calendar. ר' `docs/data-retention-policy.md` סעיף 4.

**מה קורה לאירוע שכבר נמחק (בוטל/הוזז)?** `not_found_or_gone` — תוצאה
תקינה ולא-כושלת, לא כישלון. אין מה לנקות באירוע שכבר לא קיים.

**מה אם אירוע נערך ידנית ע"י בעלת העסק במקביל להרצה?** בדיקת ETag
(`If-Match`) על ה-PATCH תופסת את זה — 412, `etag_conflict`, בלי דריסה
ובלי retry אוטומטי.
