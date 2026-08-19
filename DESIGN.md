---
name: S.M BROWS
description: Boutique eyebrow studio in Ashkelon — precise, natural, personal
colors:
  cream: "#FAF7F5"
  cream-dark: "#F2E8E4"
  rose: "#C4847A"
  rose-text: "#96534A"
  rose-light: "#EDD5D0"
  rose-bg: "#FAF0EE"
  gold: "#C9A96E"
  gold-light: "#EAD8B5"
  gold-dark: "#A07840"
  gold-text: "#725417"
  linen: "#EDE8DF"
  linen-dark: "#DDD6CB"
  dark: "#2C1810"
  medium: "#6B4545"
  muted: "#6B5252"
typography:
  display:
    fontFamily: "Dancing Script, Noto Serif Hebrew, Georgia, serif"
    fontSize: "clamp(3rem, 8vw, 5rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "0.03em"
  headline:
    fontFamily: "Dancing Script, Noto Serif Hebrew, Georgia, serif"
    fontSize: "clamp(2.25rem, 6vw, 3.75rem)"
    fontWeight: 700
    lineHeight: 1.1
  title:
    fontFamily: "Dancing Script, Noto Serif Hebrew, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.2em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  "2xl": "24px"
  "3xl": "32px"
  pill: "9999px"
spacing:
  section: "80px"
  section-lg: "112px"
  card: "24px"
  gap: "24px"
  gap-lg: "32px"
components:
  button-primary:
    backgroundColor: "{colors.linen}"
    textColor: "{colors.dark}"
    rounded: "{rounded.pill}"
    padding: "16px 32px"
  button-primary-hover:
    backgroundColor: "{colors.linen-dark}"
  button-cta:
    backgroundColor: "{colors.dark}"
    textColor: "{colors.gold}"
    rounded: "{rounded.pill}"
    padding: "16px 24px"
  button-cta-hover:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.dark}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.dark}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  button-ghost-hover:
    backgroundColor: "{colors.rose-bg}"
---

# Design System: S.M BROWS

## Overview

**Creative North Star: "The Warm Atelier"**

S.M BROWS is a single-practitioner studio, and the design system carries that fact structurally. Every surface is warm without being soft, precise without being clinical. There is no corporate polish here — this is a skilled artisan's space, and the interface is its interior: hand-chosen materials, warm light, nothing extraneous. The brand's warmth is not decorative tone applied over a neutral template; it comes from the palette, the corner language, the typefaces, and the weight of every element working together.

The system lives at a quiet intersection of intimacy and professionalism. Sections breathe with generous vertical rhythm. Cards feel weighted and considered. The typography pairs an expressive Hebrew/Latin serif (Dancing Script + Noto Serif Hebrew) with a clean, highly legible sans-serif (Rubik), creating a pairing that is simultaneously personal and credible. The result is a design that does not look like a beauty template — it looks like Shoval.

Color is warm throughout, with no cold neutrals. Depth is conveyed through tonal layering — warm ivory body → linen → white — rather than dramatic shadows. Shadows exist and are warm-toned (based on #2C1810, not neutral grey), but they are diffuse and ambient; they reveal on interaction, not at rest. The UI is RTL (Hebrew-first), and the spatial logic — reading direction, text alignment, directional icons — flows from right to left.

**Key Characteristics:**
- Warm ivory body with linen and rose-tinted layering; no cold greys or blues
- RTL (Hebrew) spatial logic throughout all surfaces
- Pillow-edged cards (24–32px radius) and pill-shaped primary CTAs; secondary surfaces use 12–16px corners
- Serif headings (Dancing Script / Noto Serif Hebrew) over Rubik body; expressive but readable
- Tonal depth rather than structural shadows; shadows are warm and appear primarily on hover
- Motion is spring-like and purposeful: cubic-bezier(0.22, 1, 0.36, 1), 0.55–0.7s, respects prefers-reduced-motion
- Gold focus rings; accessible rose/gold color pairs confirmed to WCAG AA

## Redesign Freedom

This section defines what is protected and what is open to significant redesign. The documented design system is a starting point — an accurate record of the current implementation — not a specification to preserve. The goal is not to maintain the existing UI. The goal is to evolve it into a significantly more premium, polished, modern, and intentional experience while remaining recognizably S.M BROWS.

### Locked — preserve unless explicitly approved by Shoval

- **Brand identity:** The name "S.M BROWS", the tagline "IT'S ALL ABOUT YOUR EYEBROWS", and Shoval's personal voice and authorship throughout
- **Core color palette:** The documented tokens (Warm Ivory, Dusty Petal Rose, Soft Champagne Gold, Deep Espresso, and their supporting variants) are the palette. No new colors may be introduced without approval.
- **Font families:** Dancing Script + Noto Serif Hebrew (display/heading stack) and Rubik (body/label stack). Font families are locked; sizes, weights, and hierarchy are open.
- **Logo:** `/public/logo.png` — exact asset, not replaced or modified
- **Authentic client media:** All before/after photos, testimonial screenshots, and treatment videos in `/public` are real. They may be reframed, repositioned, or presented in new layouts; their content and authenticity may not be altered.
- **Factual content and business information:** Pricing, service names, booking rules, contact details, location, hours, legal text, and the prohibition on displaying a course price
- **Hebrew-first RTL behavior:** The site is in Hebrew, reads right to left, and is designed for Israeli mobile users. This is not negotiable.

### Open — may be significantly redesigned

Card and card composition, section layouts and visual hierarchy, spacing rhythm and density, typography scale and weight while keeping the documented font families, border and radius usage (within the warm visual language), shadow intensity and elevation approach, button shapes and interactive surface design, navigation presentation and structure, CTA presentation and placement, responsive breakpoints and behavior, media containers and their aspect ratios, image framing and cropping decisions, video presentation, before/after comparison surface, testimonial presentation format, course promotional surface, treatment/service card composition, booking UI presentation and step flow, customer-area UI presentation, and all micro-interactions and transitions.

### The design direction

The existing UI is correct in identity but conservative in execution. The redesign should amplify what is already true — precision, warmth, personal craft — and eliminate the generic or safe. A premium boutique studio should feel like one in every detail, from the section rhythm to the way a before/after image is framed to the moment a button responds to a touch.

## Colors

A warm, monochromatic-adjacent palette anchored in Warm Ivory. Two accents — Dusty Petal Rose and Soft Champagne Gold — provide all the color the system needs. No cold hues are ever introduced.

### Primary

- **Dusty Petal Rose** (`#C4847A`): The emotional center of the brand. Used for scrollbar accents, decorative blobs, image overlay gradients, active nav underlines, badge fills, and any moment of warmth or focus that is not a functional CTA.
- **Rose Text** (`#96534A`): The accessible expression of Dusty Petal Rose for body text and interactive labels — 5.8:1 on white, 4.7:1 on linen. Use this for rose-colored links, active nav states, and price highlights.

### Secondary

- **Soft Champagne Gold** (`#C9A96E`): Premium accent for focus rings, eyebrow labels (uppercase small text), divider lines, and the dark-background CTA text. Warm and refined; never metallic or flashy.
- **Gold Text** (`#725417`): Accessible gold for small text on light surfaces — 7:1 on white/cream. Use for gold eyebrow labels and any small gold text that must pass WCAG AA small-text contrast.
- **Gold Light** (`#EAD8B5`): Selection highlight background, gradient terminus, and soft gold accents in section dividers.
- **Gold Dark** (`#A07840`): The deep note in the gold shimmer animation; not used as a standalone token.

### Neutral

- **Warm Ivory** (`#FAF7F5`): The canvas. Body background, primary surface, card background in dark-background sections. Never cold, never pure white.
- **Cream Dark** (`#F2E8E4`): Card borders, input borders, divider lines, light-hover backgrounds inside dropdowns.
- **Linen** (`#EDE8DF`): The primary button fill and any surface one step warmer/denser than the body. The system's "linen napkin" — natural, not synthetic.
- **Linen Dark** (`#DDD6CB`): Linen button hover state. One step denser than linen.
- **Rose Light** (`#EDD5D0`): Dividers, soft rose-tinted separator lines, mobile nav active border. The faintest echo of the primary accent.
- **Rose Bg** (`#FAF0EE`): Hover-state background for secondary and ghost interactive elements; mobile nav active fill.
- **Deep Espresso** (`#2C1810`): Primary text and heading color. A warm near-black with red undertone — never neutral charcoal.
- **Rose Bark Medium** (`#6B4545`): Body text for descriptions, supporting copy, and prose. Warm and readable without the full weight of Espresso.
- **Faded Rose Muted** (`#6B5252`): Labels, placeholders, meta information, secondary supporting copy. 7:1 on white — confirmed accessible.

### Named Rules

**The Warm-Only Rule.** No cold greys, blues, or neutral tones are introduced anywhere in the system. Every neutral carries red or yellow warmth. When in doubt, test: the new color's undertone must be warm.

**The Two-Accent Rule.** Rose and Gold are the only accents. Rose governs emotion, warmth, and interactive hover states. Gold governs prestige, focus, and precision. They do not overlap in function.

## Typography

**Display / Heading Font:** Dancing Script (Latin display) + Noto Serif Hebrew (Hebrew headings), Georgia fallback
**Body Font:** Rubik (Hebrew + Latin), system-ui fallback
**Label / Eyebrow Font:** Rubik, semibold, uppercase, wide-tracked

**Character:** The serif pairing is expressive and personal — Dancing Script carries Shoval's handwriting energy in Latin characters, while Noto Serif Hebrew delivers weight and authority in Hebrew. Rubik is clean, highly legible in both scripts, and modern without being cold. The combination reads as a skilled person who writes with a distinctive hand but communicates clearly.

### Hierarchy

Font families are locked. All size, weight, and scale values below reflect the current baseline implementation and are open to redesign.

- **Display** (bold, 700, `clamp(3rem, 8vw, 5rem)`, leading 1.05, tracking 0.03em): The hero brand name `S.M BROWS`. One occurrence per page. Expressed in serif (Dancing Script for Latin, Noto Serif Hebrew for Hebrew headings).
- **Headline** (bold, 700, `clamp(2.25rem, 6vw, 3.75rem)`, leading 1.1): Section headings — "הטיפולים שלי", "לפני ואחרי". Always serif. Never more than one per section.
- **Title** (bold, 700, `1.5rem`, leading 1.2): Card headings — service name, blog post title, course pillar titles. Serif.
- **Body** (regular, 400, `1rem`–`1.125rem`, leading 1.625): All prose, descriptions, and paragraph text. Rubik. Max comfortable line length: 65ch. Color: Rose Bark Medium (#6B4545).
- **Label** (semibold, 600, `0.75rem`–`0.875rem`, tracking 0.2em, uppercase): Eyebrow tags, section labels, category chips. Rubik. Color: Gold Text (#725417) for gold variants, Rose Text (#96534A) for rose variants.

### Named Rules

**The Script-Serif Rule.** All headings and price displays use the serif stack. Rubik is body only. A heading set in Rubik is incorrect regardless of weight.

**The Eyebrow Rule.** Category labels above headings are always uppercase, tracked at 0.2em, and set in Rubik semibold at 12–14px. They orient the reader; they are never bold enough to compete with the headline.

## Layout

**Direction:** RTL (`dir="rtl"`, `lang="he"`). All directional logic — flex start/end, text alignment, icon arrows — flows right to left.

**Container:** `max-w-7xl` (1280px) centered, with `px-4` padding on mobile and `px-6` on `sm+`. Inner content (text-heavy sections) uses a narrower `max-w-3xl` container.

**Section rhythm (baseline):** The `.section-padding` utility applies `80px` vertical padding on mobile and `112px` on `md+`. The overall rhythm and density are open to redesign — a more premium execution may call for different breathing, tighter or looser section cadence, or distinct rhythm per section type.

**Grid (baseline):** Service cards use a `grid-cols-1 md:grid-cols-3` three-column grid with `gap-6`/`gap-8`. Grid structure, column counts, and gap values are open to redesign.

**Navigation (baseline):** Fixed, full-width, transparent at top. Transitions to frosted-white on scroll. The navigation presentation — structure, density, layout approach — is open to redesign.

**Responsive breakpoints:** `sm` 640px, `md` 768px, `lg` 1024px. Mobile-first.

## Elevation & Depth

The system is tonal-first. Depth is communicated through the stacked palette — Warm Ivory body sits beneath Linen card surfaces which sit beneath White dropdown surfaces — rather than through structural shadow. This creates a warm, layered feeling without heaviness.

Shadows exist and are always warm-toned, derived from Deep Espresso (#2C1810) rather than neutral black. The intensity and vocabulary of shadows is open to redesign within the warm visual language.

### Shadow Vocabulary (baseline)

- **soft** (`0 4px 24px -4px rgba(44, 24, 16, 0.08)`): Cards and contained surfaces at rest.
- **soft-lg** (`0 8px 48px -8px rgba(44, 24, 16, 0.12)`): Card hover state and hero image container.
- **rose-glow** (`0 4px 24px -4px rgba(196, 132, 122, 0.25)`): Optional warm rose halo for featured accent elements.
- **gold-glow** (`0 4px 24px -4px rgba(201, 169, 110, 0.3)`): Optional warm gold halo for premium or featured surfaces.
- **menu** (`0 8px 40px -8px rgba(44, 24, 16, 0.18)`): Dropdown menus, modal overlays.

### Named Rules

**The Flat-at-Rest Rule.** Cards and interactive surfaces carry minimal shadow at rest. The shadow grows on hover. Depth is earned through interaction, not baked in at full intensity from the start.

**The Warm Shadow Rule.** All box shadows are derived from Deep Espresso (#2C1810), not neutral black. A neutral black shadow on a warm-toned surface reads as dirty; the warm base shadow disappears into the palette.

## Shapes

The form language is soft but not playful. Corners are generous and consistent, with a clear hierarchy: the more important or dominant the surface, the rounder its corners. Corner radius values and the overall approach are open to redesign within this principle.

- **Pill** (9999px): Primary CTAs, badges, section dots, tag chips.
- **Extra-large** (32px): Hero image frame. The single most prominent image container.
- **3XL** (24px): Card standard. Pillow-soft.
- **2XL** (16px): Dropdown menus, search result panels.
- **XL** (12px): Secondary buttons, input fields, mobile nav items.
- **MD** (8px): Nav icon buttons.
- **SM** (4px): Focus outline border-radius.

**Glass surfaces** use the system's corner language but add `backdrop-blur(12px)` and a `rgba(201, 169, 110, 0.2)` gold-tinted border.

### Named Rules

**The Radius Hierarchy Rule.** Corners loosen with surface dominance. Hero image: largest. Cards: large. Menus: medium. Inputs: smaller. Icon buttons: smallest. Never assign a tighter radius to a more dominant element.

## Components

> **All component descriptions below are BASELINE REFERENCES.** They document the current implementation as a starting point for redesign — not a final design to preserve. Card composition, section layout, button shape, image treatment, and every other visual decision are open to significant evolution. What cannot change is the brand identity, palette, font families, and authentic content documented in the Redesign Freedom section.

### Buttons (baseline)

Refined, precise, and inviting. Clean and premium with excellent touch feedback. Never playful or rounded beyond the pill for CTAs; secondary actions use 12px corners.

- **Primary (Linen Pill):** Warm linen fill (#EDE8DF), Deep Espresso text (#2C1810), pill shape (9999px). Semibold–bold. Hover: linen-dark fill, small vertical lift, 200ms ease. Focus: 2px solid gold ring.
- **CTA (Dark-Gold Pill):** Deep Espresso fill, Soft Champagne Gold text, gold border. Hover: inverts to gold fill with Espresso text. Used for the course CTA.
- **Ghost (Outline):** Transparent fill, Deep Espresso text, 12px corner radius, rose-light border. Hover: Rose Bg fill.
- **Text link:** Rose Text (#96534A), semibold, arrow icon inline. Used for "לכל הטיפולים →" navigation.

### Cards and Containers (baseline)

- **Corner style:** 24px standard; 32px for hero image frame.
- **Background:** White on cream-background sections; Warm Ivory for cards on white.
- **Shadow strategy:** Soft ambient shadow at rest, deeper on hover with slight lift.
- **Border:** Cream Dark at reduced opacity — enough to separate from background without a harsh line.
- **Internal padding:** 24px.
- **Image region:** Top-mounted, full-width, fixed height, `object-cover`.

### Inputs and Fields (baseline)

- **Style:** Warm Ivory fill, Cream Dark border, 12px radius for standard; pill for search.
- **Focus:** 2px solid gold (#C9A96E) outline, 3px offset.
- **Placeholder:** Faded Rose Muted (#6B5252). Text: Deep Espresso, right-aligned (RTL).

### Navigation (baseline)

- **Desktop at rest:** Transparent background, Rubik semibold 14px links.
- **Desktop scrolled:** Frosted white, compact height, soft warm shadow.
- **Link states:** Default Espresso, hover Rose Text, active Rose Text with animated underline.
- **Mobile:** See **Mobile Navigation** below for the full baseline specification and redesign governance.

### Dropdown Menus (baseline)

White surface, 16px radius, warm ambient shadow, cream-dark border. Items divided by soft horizontal rules. Icon containers with tinted backgrounds per function (rose, gold, whatsapp).

### Page Hero (baseline)

Full-width masthead with hero gradient background, centered text stack: eyebrow label → serif H1 → body description. A background texture image overlays at 50% opacity.

### Image and Media Containers

Media treatment is one of the most important aspects of this brand. The before/after results, treatment videos, and portrait photography are the product — they must be handled with the same precision that Shoval applies to brows.

**Core principles — these are not open to compromise:**

- **Never stretch or distort media.** `object-fit: cover` or `object-fit: contain`, never `fill` without explicit intent.
- **Use deliberate aspect ratios.** Container height must be determined by a meaningful aspect ratio (4/3, 3/4, 1/1, 16/9) or a content-aware decision, not by an arbitrary fixed pixel value inherited from a utility class.
- **`object-position` must be chosen per image.** Faces, brows, and treatment results are always the subject. The framing decision is not a default — it is a design decision made for each image.
- **Faces and brows must never be unintentionally cropped.** The eyebrows are the entire point. A portrait that cuts off brows or foreheads is a failed presentation of the product.
- **Media must remain sharp and properly framed across breakpoints.** Framing decisions made at desktop must be verified at mobile; the subject must remain correctly framed at all sizes.
- **A source image may be visually reframed or repositioned.** Cropping to better frame the subject, adjusting object-position, or choosing a tighter aspect ratio are all valid design decisions. They do not alter authenticity.
- **Avoid tiny letterboxed images.** An image compressed into an oversized container, surrounded by bands of background color, is worse than no image.
- **Video presentation must feel intentional and premium.** Videos should have deliberate poster frames, considered aspect ratios, and presentation contexts that signal craft — not raw embedded media elements dropped into a layout.

### Before/After Comparison Surface

The before/after images (`/public/ba-new-*.webp`, `/public/microblading-*.webp`) are the most persuasive content on the site. Their presentation must match their power.

**Design principles:**
- The comparison format (side-by-side, slider, or sequential) should make the transformation immediately legible without explanation.
- Images must be framed so both brows are visible in both states. Never crop to mid-forehead.
- Both sides must share the same framing, aspect ratio, and object-position treatment so the transformation reads clearly.
- The surface should be wide enough that the before/after detail is visible at a glance; cramped thumbnails underserve the result.
- A label ("לפני" / "אחרי") should be present but not dominant — the imagery leads.
- On mobile, the comparison must remain legible; a stacked or slider format is preferable to a side-by-side that forces both images below comfortable viewing size.

### Video and Media Card

The treatment teaser videos (`/public/micro-*.mp4`, `/public/tizer-1.mp4`) demonstrate craft and process. Their container is part of the message.

**Design principles:**
- Video containers must use a deliberate aspect ratio — 9/16 (portrait) for close-up treatment footage, 16/9 for wider process shots.
- Poster frames must be chosen for maximum impact: the moment of clearest result, not the first frame.
- Playback controls should recede until hovered or tapped. Autoplay (muted, looped) is appropriate for ambient teaser contexts; explicit play controls are required for longer documentary-style content.
- Video containers should feel like a deliberate editorial choice — a cinematic frame — not like a video element dropped into a grid.
- On mobile, portrait-ratio video fills well. Avoid constraining portrait video into a landscape container.

### Testimonial and Review Card

The real WhatsApp review screenshots (`/public/wa-review-*.webp`) are the social proof layer. They are authentic, and their authenticity is the point — but their current presentation can be made significantly more compelling.

**Design principles:**
- Screenshots may be cropped, scaled, or repositioned within a card container to improve readability. Their content (the actual text and sender) must not be altered.
- The presentation format — individual cards, a carousel, a masonry grid, an overlapping stack — is open to redesign.
- Each review card should feel curated, not dumped. White space, shadow, and framing should signal that these are real and valued responses, not an afterthought.
- The visual container should not distract from the review text. The screenshot is the content; the card is its frame.
- A carousel or scrollable surface is appropriate when showing many reviews; a featured single-review hero format is appropriate when leading with a specific testimonial.

### Booking Form and Booking Steps

The booking flow is an `Operate`-mode surface embedded inside a `Persuade`-mode site. It must be frictionless, trustworthy, and clearly step-sequential.

**Design principles:**
- The booking interface should feel calm and confident, not busy. A step-by-step progression (service selection → date/time → details → OTP confirmation) should be spatially clear at each stage.
- Service selection cards should make the choice feel easy: name, duration, price, and a short description. The visual weight should help the user decide, not overwhelm.
- The date/time picker must be legible at the sizes used on Israeli mobile devices. The current UI should be considered a starting point, not a final design.
- OTP and phone-entry steps are trust-critical. The UI must signal safety and forward progress. An error state must be unambiguous without being alarming.
- The booking confirmation state is a positive moment — it should feel like a small celebration, not a receipt.
- The brand identity (warm palette, serif headings) should be present in the booking flow, but the density and component style can be tuned to favor clarity over expressiveness in this mode.

### Course Card and Promotional Surface

The professional course ("קורס עיצוב גבות טבעיות") is Shoval's second product. Its presentation should feel like a premium offer — aspirational, clear in its value, and distinct in tone from the treatment booking flow.

**Design principles:**
- The course promotion should establish its premium status before any other content. The eyebrow label "קורס פרימיום · שובל מאירה" sets the tone; the visual framing should match it.
- Price is intentionally absent. The CTA should lead to WhatsApp without implying a specific price. Do not add a placeholder or "מחיר לפי פנייה" text unless Shoval approves.
- The course surface should communicate the promise ("ללמוד לראות, לא רק לעצב") and the three pillars (professional eye, personal customization, working confidence) as a designed hierarchy, not a bullet list.
- The two-day format (theory + practical) is a key differentiator; the visual presentation should give each day its own identity.
- Course imagery: `/public/natural-2.webp` is the current course image. The image treatment should feel studious and focused, not glamorous.

### Treatment and Service Card

Service cards appear on the homepage preview and on the dedicated `/services` page. They are both persuasive (leading to a booking) and informative (explaining what the treatment does).

**Design principles:**
- The card composition is open to complete redesign. The current top-image / body-text / CTA structure is one valid approach; other compositions (editorial, feature-led, split-layout) are equally valid.
- Each treatment has a distinct character: microblading is semi-permanent and personal; natural design is precise and quick; brow lifting is structural and visible. The card should feel appropriate to its treatment, not generic.
- Pricing is a decision signal. Where price is known (₪70, ₪250), it should be easy to read. Where price is discussed privately (microblading), the CTA should guide to WhatsApp without an empty price slot.
- Duration is an orientation signal, not a headline. It belongs in the body, not the card header.
- The image region is the emotional hook. It must be framed so the treatment result is immediately visible and appealing.

### CTA Section

The booking CTA (WhatsApp or calendar) appears across multiple page contexts. The section that hosts it should feel like a considered design element, not a button dropped at the bottom of a page.

**Design principles:**
- A CTA section can carry urgency, warmth, or a closing thought ("הגבות שחלמת עליהן מחכות לך"). The copy and the visual context should reinforce each other.
- The WhatsApp CTA and the online booking CTA are different offers for different client types. When both appear together, the UI should make the choice between them feel natural and clear, not like a confusing fork.
- The CTA section background can be dark (Deep Espresso) for contrast and emphasis, or warm-gradient for a continuation of the page's tone. Either is valid; the choice should be deliberate.
- On mobile, the CTA area must be immediately reachable and tappable. Minimum 48px touch target for any booking action.

### Mobile Navigation

The mobile navigation is the primary navigation surface for most real users of this site. It must work perfectly.

**Design principles (baseline):** Slide-in drawer from the left edge, 288px wide, white background, spring-motion entrance. Logo at top, nav links as block items, social icons and CTA buttons at the bottom.

**What is open to redesign:** The drawer width, the entry direction, the layout of links (stacked list vs. grid), the treatment of the booking CTA within the drawer, the presentation of social links, and the overall density and visual weight of the mobile menu.

**What is not open:** RTL layout direction, the presence of WhatsApp booking as a reachable action within 2 taps, keyboard-trap-safe focus management, and Escape-to-close behavior.

### Loading, Disabled, Success, and Error States

These states are underspecified in the current implementation. Any redesign must define them explicitly.

**Loading:** An action that is processing (booking submission, OTP verification) must communicate progress. A skeleton loader, a spinner anchored to the active element, or a progress indicator are all valid approaches within the warm visual language. The loading state must never feel broken or stalled.

**Disabled:** A form control or button that is not yet actionable must be visually distinct from its active state. Reduced opacity (0.5) on the element with `cursor: not-allowed` is the baseline. The treatment should not conflict with the palette's warmth — do not go grey; use the warm palette at reduced opacity.

**Success:** A completed booking, a verified OTP, or a submitted form should feel like a resolved moment. A confirmation should be visually distinct, calm, and warm. Not a bare paragraph of green text — a considered state with appropriate visual weight.

**Error:** An invalid OTP, a fully booked slot, or a form validation error must be communicated clearly and without alarm. Rose Text (#96534A) is the natural error color in this system; it carries urgency without hostility. The error must name what went wrong and what to do next. A red that clashes with the warm palette is wrong.

## Do's and Don'ts

### Do:
- **Do** use the serif stack (Dancing Script + Noto Serif Hebrew) for every heading level — display, headline, title. Rubik is body only.
- **Do** set all layout from RTL (`dir="rtl"`). Use logical properties (`ps`, `pe`, `ms`, `me`) instead of `pl/pr/ml/mr` in new code.
- **Do** use warm-toned shadows derived from `rgba(44, 24, 16, ...)` for all depth effects. Never use `rgba(0, 0, 0, ...)`.
- **Do** use `gold` (#C9A96E) for all focus rings (`outline: 2px solid #C9A96E; outline-offset: 3px`).
- **Do** source new before/after images and testimonials only from real client work. The authenticity is core to the brand.
- **Do** choose deliberate aspect ratios for every image and video container. A pixel height pulled from a utility class is not a framing decision.
- **Do** set `object-position` deliberately for every portrait or treatment image. The brows must always be visible.
- **Do** verify media framing at mobile sizes, not just desktop. The subject must remain correctly framed after the container reflows.
- **Do** treat video poster frames as editorial choices — the frame that best represents the content and result.

### Don't:
- **Don't** introduce any cold grey, blue, or neutral tone. Every surface must carry warm undertone.
- **Don't** display or invent a price for the course — it is discussed privately via WhatsApp and must remain undisclosed in the UI.
- **Don't** fabricate or write testimonials, review text, or before/after descriptions. Only real WhatsApp screenshots from `/public` may be used.
- **Don't** apply shadows in neutral black. All shadow colors must be warm (espresso-based or rose-based).
- **Don't** set headings in Rubik. The serif stack is non-negotiable for brand voice.
- **Don't** introduce a second accent color. Rose and Gold are the entire accent vocabulary.
- **Don't** stretch, distort, or letterbox media. An image compressed into an oversized container is worse than no image.
- **Don't** crop a portrait at the forehead or mid-brow. The eyebrows are the product — they must always be visible and properly framed.
- **Don't** treat the existing component shapes, card layouts, section structures, or spacing rhythm as final. This documentation records where the design is, not where it must stay.
