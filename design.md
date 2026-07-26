# Design — Info

Locked design system for the rich redesign program. Future page changes read this file before introducing new visual language.

## System

- Genre · editorial brand register with playful, technical, confident art direction
- Marketing macrostructure · Marquee Hero
- Theme · Graphite Blue
- Axes · dark graphite paper / display-heavy / restrained cool blue
- Navigation · N7 solid slab with the existing accessible disclosure behavior, plus a scroll-reactive compact morph (paint-only; see Motion system)
- Footer · Ft8 marquee composition; continuous animation runs only while the footer is in view (see Motion system)

## Canonical tokens

`tokens.css` is the source of truth. All colors use semantic OKLCH tokens, and all type stacks use named font tokens.

- Display · local Big Shoulders Display variable font for Latin, then robust Japanese/system fallbacks
- Body · robust system Japanese and UI sans-serif fallbacks
- Accent use · a single low-saturation blue accent for text and colored-scene fills; a darker navy shade of the same hue (`--color-accent-2`) exists only as an on-dark fill role, never as a competing hue
- Spacing · named 4-point scale from `--space-3xs` through `--space-4xl`
- Shape · square, 2px rules and hard-offset shadows; no soft shadow or glass layer

## Content and accessibility

- Preserve current Japanese and English content, translation keys, `projects.json` data, URLs, and personal-site disclaimer.
- Preserve no-JavaScript navigation and project-link fallback, keyboard disclosure behavior, 44px controls, visible focus, source-order hero preload, and project fetch/retry status.
- All content is visible without animation. Reduced motion remains a complete, stable presentation.

## Motion system (PR 2 — approved strong, lightweight motion)

Studied `kohimoto.com/labo/web/usability/18790/` for concepts only (public inspiration, inert design facts); no content, assets, or code were copied, and its CSS/jQuery/Slick implementation is not a dependency here. The approved system is one coherent choreography, not per-section fade-up reflex. Every piece below is `transform`/`opacity` (plus `clip`/`mask` only for the hero), CSS-first with a JS fallback that never uses per-element scroll listeners, and every piece degrades to fully visible content with JS disabled.

- **Root scroll progress** — a fixed, `aria-hidden` bar whose fill uses `transform: scaleX()`, never `width`. A single passive/rAF scroll handler is the universal path; `@supports (animation-timeline: scroll())` layers a compositor-driven enhancement on top where supported. Non-essential: hidden entirely under reduced motion.
- **Hero entrance** (~500–800ms) — the `h1` spans and `hero-support` children animate in via opacity/transform, driven by a CSS keyframe gated only on the `.js-enabled` class that the inline head script sets synchronously (no dependency on `script.js` executing). `hero-visual`/its `img` are never animated so LCP timing is untouched.
- **Nav compact morph** — an `IntersectionObserver` on the hero toggles `.site-header.is-compact`. Only paint-safe properties change (`background-color`, `box-shadow`, and a `transform: scale()` on the decorative `.wordmark-mark` square, never the wordmark link itself) so header `min-height`/padding never change: no CLS, no touch-target shrink, disclosure/focus/`aria-current` logic untouched.
- **Project-row reveal** — base CSS keeps every row fully visible with zero JS dependency. Only when `.js-enabled`, `IntersectionObserver` is supported, and the visitor has no motion preference does script.js add a one-time priming class (removed permanently once revealed, observer disconnected) with a bounded stagger (`--row-index`, capped total ≈450ms across all rows) plus a hard JS timeout that clears any stuck priming class as a safety net.
- **Micro-parallax** — capped at ±5px on `.project-media` (not the img, so it never collides with the existing hover scale). `@supports (animation-timeline: view())` is the compositor-driven default; the fallback is the same single shared rAF/passive-scroll handler used for scroll progress (never per-element listeners). Fully disabled under reduced motion.
- **Footer marquee (Ft8)** — the track is duplicated into two `aria-hidden` sets for a seamless `translateX(-100%)` loop; the single visible-to-AT equivalent stays a static `sr-only` line. `animation-play-state` defaults to `paused` and only becomes `running` while an `IntersectionObserver` reports the footer in view, and it re-pauses on `visibilitychange` (background tab).
- **Reduced motion** — on top of the existing global 150ms transition/animation cap, an explicit block nulls `transform` on every new motion surface (hero spans, project rows, `.project-media`, `.wordmark-mark`) and disables the progress bar and marquee animation outright. No spatial motion survives; only short opacity remains where a transition already existed.
- **No-JS** — every surface above renders fully visible and fully functional with JavaScript disabled; motion is additive enhancement only, never a visibility gate.

Bans carried over from PR 1: no bounce/elastic easing, no scroll hijacking, no pinned horizontal rail, no Lottie/GSAP/Lenis or other motion dependency, no long main-thread scroll handler, no CLS.

## Exports

This static site uses `tokens.css` directly. `assets/fonts/OFL.txt` contains the SIL Open Font License 1.1 for the locally bundled display font.
