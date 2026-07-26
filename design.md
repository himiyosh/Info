# Design — Info

Locked design system for the rich redesign program. Future page changes read this file before introducing new visual language.

## System

- Genre · modern-minimal portfolio register with quiet-luxury restraint, technical confidence, and editorial pacing
- Marketing macrostructure · Feature Stack
- Theme · Graphite Blue
- Axes · deep graphite paper / condensed display / restrained cool blue
- Navigation · quiet floating navigation with the existing accessible disclosure, focus-containment, and active-location behavior
- Footer · Ft5 statement composition; one truthful static closing line with the existing copyright, disclaimer, and back-to-top link

## Canonical tokens

`tokens.css` is the source of truth. All colors use semantic OKLCH tokens, and all type stacks use named font tokens.

- Display · local Big Shoulders Display variable font for Latin, then robust Japanese/system fallbacks
- Body · robust system Japanese and UI sans-serif fallbacks
- Accent use · a single low-saturation blue accent for text and colored-scene fills; a darker navy shade of the same hue (`--color-accent-2`) exists only as an on-dark fill role, never as a competing hue
- Spacing · named 4-point scale from `--space-3xs` through `--space-4xl`
- Shape · restrained soft radii, hairline rules, and one cinematic shadow token; no glass layer or decorative glow

## Content and accessibility

- Preserve current Japanese and English content, translation keys, `projects.json` data, URLs, and personal-site disclaimer.
- Preserve no-JavaScript navigation and project-link fallback, keyboard disclosure behavior, 44px controls, visible focus, source-order hero preload, and project fetch/retry status.
- All content is visible without animation. Reduced motion remains a complete, stable presentation.

## Motion system

Apple's public MacBook Pro page informed broad design DNA only: quiet hierarchy, sticky pacing, composed typography, media-led transitions, and negative space. No content, asset, code, metric, or product treatment was copied. The implementation is one coherent Feature Stack scene lifecycle, not a series of unrelated fade-ups.

- **Layered viewport stage** — fixed, decorative, `aria-hidden` color planes use only Graphite Blue scene tokens. `body[data-scene]` selects the active plane; transitions are opacity-only.
- **Root scroll progress** — the existing fixed, `aria-hidden` indicator remains transform-based and non-essential. It is hidden under reduced motion.
- **Sticky hero** — desktop holds `.hero-sticky` while the containing chapter advances. One shared rAF calculation drives bounded `--hero-opacity`, `--hero-depth`, and `--hero-scale` values. The LCP image is never entrance-animated.
- **Pinned About pacing** — desktop pins the heading while the existing narrative moves through generous reading space. Mobile, no-JS, and reduced-motion presentations use normal flow.
- **Project chapters** — each project is a viewport-height chapter on desktop, always media-left and text-right. Mobile keeps the existing media-first DOM order. Shared custom properties coordinate copy focus, media depth, and a media translation capped at ±5px.
- **Active scene state** — the same rAF pass chooses the scene nearest the viewport center, updates `body.dataset.scene`, and applies one `.is-active-scene` class. There are no per-element scroll listeners and no scroll hijacking.
- **Project-row reveal** — the existing bounded, one-time IntersectionObserver reveal remains a progressive enhancement with a timeout safety net, but the modern layer keeps text at full opacity and limits the entrance to the existing 14px transform.
- **Static statement footer** — the legacy duplicated marquee markup remains compatible and accessible, but the modern layer renders one truthful Ft5 closing statement and disables its animation.
- **Live reduced motion** — a runtime preference change cancels the pending frame, removes listeners, clears scene state and every scroll-derived custom property, disconnects project reveals, hides progress, and leaves all content visible in normal flow. Re-enabling motion re-arms the single lifecycle idempotently.
- **No-JS** — all content, navigation, project fallbacks, and links remain visible and functional. Cinematic spacing collapses to ordinary document flow.

Bans: no bounce/elastic easing, no scroll hijacking, no pinned horizontal rail, no infinite decorative motion, no Lottie/GSAP/Lenis or other motion dependency, no per-element scroll listener, no CLS.

## Exports

This static site uses `tokens.css` directly. `assets/fonts/OFL.txt` contains the SIL Open Font License 1.1 for the locally bundled display font.
