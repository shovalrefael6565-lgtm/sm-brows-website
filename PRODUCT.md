# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary — treatment clients:** Women in Ashkelon and the surrounding area who want precise, natural-looking eyebrow results. They arrive wanting to fix uneven, sparse, or over-shaped brows — and often having had disappointing experiences elsewhere. The visit is personal and trust-based; they are not buying a commodity service, they are putting their face in Shoval's hands.

**Secondary — course students:** Aspiring or working eyebrow designers who want professional methodology, not just technique. Includes complete beginners and existing beauticians who currently work "by feel" and want a structured, repeatable approach. Most are Israeli women building or expanding a beauty practice.

## Product Purpose

S.M BROWS is a boutique eyebrow studio in Ashkelon operated solely by Shoval Meira. Every treatment — natural brow design, brow lifting, microblading — is delivered personally by Shoval. The product makes it possible for clients to get brows that look and feel like their own: precisely shaped, soft, natural, and suited to their individual face. The professional course extends Shoval's methodology to other practitioners.

## Positioning

Shoval performs every treatment personally — the client is never passed to staff. Before touching anything, she reads the client's face, existing brow structure, preferences, and expectations. The goal is never a generic "perfect brow" or an obviously treated look; it is brows that fit the specific face, look soft and natural, and still feel like the client herself. This combination — solo practitioner, professional face-reading eye, specialization in natural results, and careful expectation-setting — is the core of the brand. No nearby competitor can truthfully copy all four together.

## Operating Context

- **Booking:** appointment-based. Natural design and brow lifting are booked online via OTP phone authentication. Microblading and course enrollment go through WhatsApp only.
- **Location:** הכורמים, אשקלון
- **Hours:** Sun–Thu 9:00–11:00 and 15:00–19:00; closed Friday/Saturday (Shabbat-aware)
- **Reminders:** SMS/WhatsApp reminders sent automatically via QStash ~24–48 hours before appointment
- **Admin:** Shoval manages her schedule through an internal admin panel with Google Calendar sync
- **Course format:** 2 days in-person, small groups, Ashkelon — day 1 theory, day 2 practical on a live model

## Capabilities and Constraints

**Bookable online (OTP auth):**
- עיצוב גבות טבעיות — from ₪70 (includes mustache), 15–30 min
- עיצוב גבות + צביעה — ₪85, ~20 min
- שעווה לכל הפנים — ₪40
- הרמת גבות — ₪250, 45 min

**WhatsApp-only (no online booking):**
- מיקרובליידינג — ~₪1,800, 2–3 hours; includes a touch-up session at 6 weeks
- ייעוץ מיקרובליידינג — duration set by Shoval per client
- קורס עיצוב גבות טבעיות — price discussed privately; never display a number

**Technical constraints:**
- RTL Hebrew throughout; lang="he" dir="rtl"
- PWA-capable (installable to home screen on iOS and Android)
- Privacy-compliant: data retention policies, GDPR-aware, consent banner
- Stack: Next.js 14 (App Router), Tailwind CSS, Supabase (production), Vercel deployment, QStash for scheduled jobs, SMS via 019

## Brand Commitments

- **Name:** S.M BROWS
- **Owner / voice:** שובל מאירה (Shoval Meira). Voice is warm, direct, feminine — she addresses clients as "את" and speaks in first person.
- **Logo:** /public/logo.png — must never be replaced without explicit approval
- **Core palette:** cream `#FAF7F5`, rose `#C4847A`, gold `#C9A96E`, dark `#2C1810` — must be preserved unless Shoval explicitly approves a change
- **Typography:** Rubik (Hebrew sans-serif body), Dancing Script (display / decorative Latin), Noto Serif Hebrew (editorial Hebrew)
- **Social handles:** Instagram @shovalmeira · Facebook: shovalvahdy · TikTok @shovalbrows

## Evidence on Hand

Real assets that must never be substituted with stock or AI-generated imagery:

- **Before/after client photos:** `/public/ba-new-*.{jpg,webp}`, `/public/microblading-*.webp`, `/public/natural-*.webp`, `/public/lifting-*.webp`
- **Client WhatsApp review screenshots:** `/public/wa-review-*.{png,webp}` — 15 real reviews; no fabricated testimonials
- **Treatment videos:** `/public/micro-*.mp4`, `/public/tizer-1.mp4`
- **Logo:** `/public/logo.png`

Absences to respect: course price is intentionally not published. Do not display a number or invent one.

## Product Principles

1. **Every brow is designed for the face in front of you.** No template fits all clients; the right brow is always derived from this person's face structure, existing brows, and expectations.
2. **Natural first.** The goal is results that look and feel like the client herself — not "done," not overdone, not generic.
3. **Trust through presence.** Every client gets Shoval. There are no substitutes. Expectation-setting is part of the service, not a formality.
4. **Methodology over feel.** Precise mapping, face-reading, and a structured approach produce consistent, repeatable results — not luck or intuition.
5. **Honesty over performance.** Real work, real results, real reviews. Nothing fabricated, nothing implied that isn't true.

## Accessibility & Inclusion

- WCAG 2.1 AA minimum; all interactive elements keyboard-navigable and screen-reader friendly
- RTL layout throughout; accessible contrast ratios confirmed in the design token set
- Hebrew-language primary with no English-language fallback for content
