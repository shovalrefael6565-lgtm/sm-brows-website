# מדיניות שמירה וניקוי נתונים — smbrows.co.il

**סוג מסמך:** תיעוד תפעולי (שלב 9B — יישום ליבה). אינו ייעוץ משפטי.
**מקור:** מיישם את התכנון שאושר בשלבים 9A/9A-מתוקן, בהתבסס על migration
`supabase/migrations/0032_privacy_retention.sql`.
**תאריך:** 2026-08-16
**Checkpoint:** `103b14e` (שלב 8).

**אין במסמך זה נתוני לקוחות אמיתיים** — כל דוגמה, אם קיימת, היא סינתטית.

---

## 1. סטטוס הפעלה — קרא לפני הכול

🔴 **נכון לרגע כתיבת מסמך זה, מנגנון הניקוי האוטומטי אינו פועל בפרודקשן.**

- ה-route הפנימי (`app/api/internal/privacy-retention/route.ts`) קיים בקוד אך
  **אינו מחובר לשום scheduler** — לא Vercel Cron, לא QStash. אין `vercel.json`
  בריפו.
- Migration `0032` **טרם הופעלה** על שום מסד נתונים (dev/prod).
- אסור לפרסם או לעדכן מדיניות פרטיות ציבורית (`components/privacy/PrivacyContent.tsx`)
  כאילו ניקוי אוטומטי פעיל, לפני שה-scheduler חובר בפועל, נבדק, ואומת
  שהוא רץ בתדירות הנדרשת (ר' סעיף 7 להלן ו-`docs/privacy-rights-procedure.md`).
- עד לחיבור scheduler, יש להריץ את ה-route **ידנית** (למשל דרך `curl` עם
  ה-secret) בתדירות סבירה — ראה סעיף 6.

---

## 2. התקופות המאושרות (החלטת בעלים)

| קטגוריה | תקופה | בסיס חישוב |
|---|---|---|
| `otp_attempts` | מחיקה לאחר 7 ימים | `created_at` |
| `app_sessions` שפגו/בוטלו | מחיקה לאחר 30 ימים | `COALESCE(revoked_at, expires_at)` |
| ניסיוני SMS/תזכורות/התראות | מחיקה לאחר 90 ימים | `finished_at` (attempts בלבד) |
| `appointments.notes` | איפוס ל-NULL לאחר 90 יום ממועד התור | `starts_at` |
| בקשות `rejected` | **ללא פעולה ייעודית** — נשארות במסלול הרשומה המינימלית (7 שנים, זמני). רק ה-`notes` שלהן מתאפסת לפי הכלל הכללי | — |
| `customer_notes` + `customer_crm_activity` | 24 חודש מתור אחרון — **report-only בלבד** | תור אחרון של הלקוחה |
| כרטיס לקוחה לא פעיל | 24 חודש — **report-only בלבד**, אין מחיקה/אנונימיזציה אוטומטית | תור אחרון (או `created_at`/`updated_at` ללקוחה בלי תורים) |
| רשומת תור מינימלית + היסטוריית סטטוסים | 7 שנים, **זמני** עד אישור עורך דין — אין מנגנון טכני עדיין | — |
| תיעוד קריאת הודעת פרטיות | נגרר אוטומטית עם שורת התור | — |

אלה תקופות תפעוליות זמניות עד בדיקת עורך דין, לא קביעה משפטית סופית.

---

## 3. מה אוטומטי ומה report-only

### אוטומטי (3 פונקציות `execute`, service_role בלבד)

| פונקציה | מה היא עושה | מה היא **לא** נוגעת בו |
|---|---|---|
| `privacy_retention_purge_otp_sessions` | מוחקת `otp_attempts` (7+ ימים) ו-`app_sessions` שפגו/בוטלו (30+ יום) | session חי — לעולם לא נבחר |
| `privacy_retention_purge_notification_attempts` | מוחקת `appointment_notification_attempts` **"סגורים" בהגדרה מדויקת** (ר' תת-סעיף למטה), 90+ יום | `appointment_notifications` (ההורה), `appointment_reminder_attempts` |
| `privacy_retention_reset_old_notes` | מאפסת `appointments.notes` ל-NULL (90+ יום מ-`starts_at`) | התור עצמו, `appointment_history`, אישור מדיניות הפרטיות; **מדלגת על לקוחות עם `retention_hold=true`** |

כל שלוש: `p_now`/`p_batch_limit` עם ברירת מחדל, batch מוגבל ל-1–5000,
סדר דטרמיניסטי (cutoff ואז id), `FOR UPDATE SKIP LOCKED`, מחזירות ספירות
בלבד.

#### הגדרה מדויקת: מתי `appointment_notification_attempts` "סגור" (9B.2)

🔴 **תוקן ב-9B.2.** הגרסה הקודמת (9B/9B.1) קבעה eligibility לפי ה-`outcome`
של הניסיון הבודד — `outcome <> 'retryable_error'` — והחריגה `retryable_
error` **לצמיתות**, גם אחרי שה-notification ההורה כבר הגיע למצב סופי
אמיתי (למשל: ניסיון ראשון נכשל זמנית, ניסיון שני הצליח וההורה עבר ל-
`'sent'` — הניסיון הראשון היה נשאר תקוע ב-DB לנצח בלי הצדקה). זה תוקן.

שורה נחשבת בת-מחיקה **רק** כאשר **שלושת** התנאים מתקיימים יחד:

1. `att.finished_at is not null` — הניסיון עצמו הסתיים. שורה עם
   `finished_at is null` היא ניסיון **pending/in-progress** (lease פעיל
   או ממתין) — לעולם לא נמחקת, לא משנה כמה היא "ישנה".
2. `att.finished_at < p_now - interval '90 days'`.
3. **ה-`appointment_notifications` ההורה במצב סופי אמיתי** — נבדק דרך
   `public.notification_is_terminal(n.status)`, פונקציית helper משותפת
   ל-dry-run ול-execute (0032, "חלק 4"), כדי ששתיהן לעולם לא יסטו זו מזו.

**רשימת הסטטוסים הסופיים המדויקת, ומקורה:**

| סטטוס | סופי? | מקור |
|---|---|---|
| `sent` | ✅ | `finish_notification_attempt`, מיפוי `v_status` (0025) |
| `simulated` | ✅ | שם |
| `delivery_unknown` | ✅ | שם, מתועד גם ב-0025 כ-"סופי, לעולם לא retrying" |
| `failed` | ✅ | שם |
| `skipped` | ✅ | `skip_notification` (0025) — "לא תקלה, פשוט אין נמען" |
| `queued` | ❌ | ערך התחלתי, `enqueue_appointment_notification` (0025) |
| `sending` | ❌ | `claim_appointment_notification` (0025) — יש lease פעיל, כולל recovery של worker שנקטע |
| `retrying` | ❌ | `finish_notification_attempt`, ענף `retryable_error` (0025) — ממתין לניסיון הבא |

**הקובע הוא מצב ההורה, לא ה-outcome של הניסיון הבודד:** ניסיון בודד עם
`outcome='retryable_error'` או `'lease_expired'` הוא רק תיעוד תקין של מה
שקרה *בניסיון ההוא* — הוא לא קובע לבד אם ה-notification כולו עדיין פעיל.
ברגע שההורה הגיע למצב סופי (כולל דרך ענף ה"מוצו הניסיונות" של
`retryable_error → failed`), **כל** ה-attempts הישנים שלו — כולל אלה
עם `retryable_error`/`lease_expired` — ברי-מחיקה לפי גילם. כל עוד ההורה
`queued`/`sending`/`retrying`, אף attempt שלו לא נמחק, לא משנה כמה הוא ישן.

#### ⚠️ `execute` אינה טרנזקציה אטומית אחת

הקריאה מ-`app/api/internal/privacy-retention` למצב `execute` מפעילה את
שלוש הפונקציות **במקביל** (`Promise.all`), כל אחת RPC נפרד עם ה-
transaction הפנימית שלה ב-Postgres — **לא** עטופות בטרנזקציה חיצונית
משותפת. כשל באמצע (למשל timeout רשת בין ה-route ל-Postgres באחת
הקריאות) עלול להשאיר **ביצוע חלקי**: חלק מהשלוש הצליחו וחלק לא.

זה **בטוח להרצה חוזרת**: כל שלוש הפונקציות idempotent — batch שכבר נוקה
מוחזר כ-0 בקריאה הבאה, ואין דרך לשכפל מחיקה/איפוס. הפעולה הנכונה אחרי
כשל חלקי היא פשוט לקרוא ל-`execute` שוב (usually מה-scheduler עצמו,
בהרצה הבאה) — לא נדרשת התערבות ידנית לתיקון מצב ביניים.

### Report-only (בתוך `privacy_retention_dry_run` בלבד, ללא execute)

- `customer_notes_review` / `customer_crm_activity_review` — הערות/פעילות
  CRM ללקוחה שהתור האחרון שלה ישן מ-24 חודש.
- `inactive_customers_with_appointments` — לקוחה עם תור אחרון ישן מ-24
  חודש, בלי תור פעיל עתידי.
- `inactive_customers_without_appointments` — לקוחה שמעולם לא הזמינה תור,
  בלי חשבון login, בת 24+ חודש (`created_at`/`updated_at`).

לאף אחת מהקטגוריות האלה **אין** פונקציית execute. הן קיימות כדי לתת
לבעלת העסק תמונת מצב (ספירה בלבד, ללא שמות/טלפונים) — כל פעולה על סמך
הספירות היא **ידנית**, דרך ממשק הניהול הקיים (`/admin/customers`).

### לא נכלל בכלל — מוסבר

- **בקשות `rejected`:** לא נמחקות ולא מאונמזות ב-v1. הכרעה בין "12 חודש"
  (כפי שנשקל בתחילת שלב 9) ל"7 שנים" (מסלול הרשומה המינימלית) לא בוצעה —
  הבעלים החליטו לשמור אותן במסלול הארוך. שדה ה-`notes` שלהן עדיין מתנקה
  לפי הכלל הכללי (90 יום מ-`starts_at`).
- **`appointment_reminder_attempts`:** מוגנות בטריגר append-only
  (`reject_reminder_attempt_mutation`, 0011/0012) שחוסם DELETE ישיר ללא
  תנאי כל עוד ה-`appointment_reminders` ההורה קיים — ללא כל חריג לפי
  role/secret/GUC. שינוי הטריגר עצמו הוא פעולה על מנגנון הגנתי קיים,
  ודורש בדיקת אבטחה נפרדת משלו. ב-v1: לא מנוקות. אם וכאשר יוחלט לטפל
  בכך, זו migration עתידית נפרדת שמתמקדת אך ורק בטריגר הזה.
- **`appointment_reminders`/`appointment_notifications` (השורות הראשיות):**
  לא נמחקות — רק ה-attempts הסגורים שלהן.

---

## 4. Retention Hold — השהיית ניקוי הערות תורים ברמת לקוחה

עמודות `customers.retention_hold` / `retention_hold_updated_at` /
`retention_hold_updated_by` (0032). מטרתה: למנוע איפוס אוטומטי של הערות
תור הקשורות למחלוקת או צורך משפטי.

🔴 **9B.1 — היקף מדויק, לאחר תיקון:** ה-hold חוסם **אך ורק** את
`privacy_retention_reset_old_notes`. הוא **אינו** עוצר ניקוי
`otp_attempts`/`app_sessions`/`appointment_notification_attempts`, ו**אינו**
משפיע על ארבע קטגוריות ה-report-only ב-`privacy_retention_dry_run`
(`customer_notes_review`, `customer_crm_activity_review`,
`inactive_customers_with_appointments`, `inactive_customers_without_appointments`)
— אלה ספירות בלבד שאינן מבצעות שום mutation, והסתרת לקוחה תחת hold מדוח
"מועמדת לבדיקה" הייתה הפוכה מהכוונה: hold מסמן בדיוק לקוחה שדורשת תשומת
לב ידנית.

- **מה נחסם:** איפוס `appointments.notes` בלבד.
- **מה *לא* נחסם:** ניקוי `otp_attempts`/`app_sessions`/
  `appointment_notification_attempts` — טכניים גרידא, ללא קשר אמין/מוצק
  ללקוחה ספציפית (אין FK ל-`customers` על `otp_attempts`, ו-`app_sessions`
  תלוי ב-`auth_user_id` לא ב-`customer_id`). לא נמצאה הצדקה לכלול אותם
  ב-hold. גם ארבע קטגוריות ה-report-only (ר' למעלה) אינן מושפעות.
- **הפעלה/ביטול:** RPC `set_customer_retention_hold` (0032), אך ורק
  `service_role`, מאמת admin מול טבלת `admins`. idempotent — ערך זהה לא
  כותב שורת activity נוספת. `old_value`/`new_value` הם `'true'`/`'false'`
  בלבד — **אין שדה סיבה חופשי**.
- **UI:** כרטיס הלקוחה בממשק הניהול (`/admin/customers/[id]`) — מתג
  "השהיית ניקוי הערות תורים". הפעלה מיידית; ביטול דורש אישור מפורש
  (`window.confirm`). אין עדכון אופטימי — התצוגה נגזרת מהשרת בלבד, ולכן
  כשל ב-API אינו "מזיז" את המתג כלל (אין ממה לחזור); הודעת שגיאה
  מסוננת מוצגת דרך `role="alert"`.
- **הגנה מפני עדכון ישיר ע"י לקוחה:** שלוש העמודות מוגנות ע"י `revoke
  update on public.customers from anon, authenticated` הקיים כבר מ-0010
  (סוגר עדכון UPDATE על **כל הטבלה**, לא רק על עמודות ה-retention) —
  לא נוסף revoke חדש, ורק אומת מחדש שהוא עדיין בתוקף (0032, חלק 8).

---

## 5. מבנה Dry-run / Execute

- `privacy_retention_dry_run(p_now, p_batch_limit)` — ספירות בלבד. לכל
  קטגוריה בעלת execute: `{total_eligible, next_batch_count}`. לקטגוריות
  report-only: `{total_eligible}` בלבד.
- שלוש פונקציות ה-execute מחזירות רק את מספר הרשומות שבוצעו בפועל
  (`otp_deleted`/`sessions_deleted`/`notification_attempts_deleted`/`notes_reset`).
- תנאי ה-cutoff/חריגים זהים מילה במילה בין dry-run ל-execute המקביל.
- סדר batch דטרמיניסטי: עמודת ה-cutoff ואז `id`.
- **אין PII, IDs, טלפון, notes או event IDs בשום תוצאה** — נבדק ב-
  `scripts/test-privacy-retention.mjs`.

---

## 6. Scheduler — מצב נוכחי והמלצה

ר' `app/api/internal/privacy-retention/route.ts` לחוזה המלא. **לא חובר
כרגע לשום scheduler.** עד לחיבור:

- הרצה ידנית (curl/Postman) עם `Authorization: Bearer <PRIVACY_RETENTION_SECRET>`,
  בתדירות **יומית או שבועית לכל היותר** — הרצה חודשית אינה תואמת מדיניות
  7-ימים ל-OTP.
- ברירת מחדל = `mode: "dry_run"`. `mode: "execute"` דורש גם
  `confirm: "APPLY_RETENTION_V1"`.
- **חיבור עתידי:** QStash (POST + חתימת Upstash, מומלץ) או Vercel Cron
  (GET + `CRON_SECRET` שמסופק אוטומטית ע"י Vercel — יש לתעד במפורש שזו
  קריאת GET מאומתת שמבצעת mutation אמיתי, לא endpoint "תמים"). כל אחת
  מהאפשרויות דורשת אימות חיצוני בפועל (חשבון Upstash/הגדרת Vercel Cron)
  לפני שהיא נחשבת "פעילה" — לא להניח שקיימת.

---

## 7. בדיקה שנתית

מומלץ לבעלת העסק: פעם בשנה, לעבור על `privacy_retention_dry_run` ועל
דוחות ה-report-only, ולבדוק ידנית האם יש לקוחות/הערות/תורים שמצטברים
ללא הצדקה עסקית ברורה — במיוחד קטגוריית "רשומת תור מינימלית 7 שנים",
שכרגע אין לה מנגנון אוטומטי כלל.

---

## 8א. ניקוי טלפון היסטורי מ-Google Calendar (9C) — מסמך נפרד

מסמך זה מכסה שמירה/ניקוי ב-Supabase בלבד. ניקוי טלפון (ובחלק מהמקרים
הערות חופשיות) מתיאורי אירועים היסטוריים ב-Google Calendar הוא נושא
נפרד, עם כלים, סדר הרצה ותנאי סף משלו — ר' `docs/calendar-phone-cleanup-runbook.md`.
🔴 נכון לרגע כתיבת שורות אלה, הכלים שם **טרם הורצו**.

---

## 8. הערה משפטית

התקופות בסעיף 2 הן החלטות תפעוליות זמניות של בעלת העסק, לא מסקנה משפטית.
נדרשת בדיקה משפטית סופית (ר' `docs/privacy-data-audit.md` סעיף 11 ו-
`docs/privacy-rights-procedure.md`) לפני שמדיניות הפרטיות הציבורית
מעודכנת בהתאם.
