# Design — Info

Locked design system for the rich redesign program. Future page changes read this file before introducing new visual language.

## System

- Genre · editorial brand register with playful, technical, confident art direction
- Marketing macrostructure · Marquee Hero
- Theme · Graphite Blue
- Axes · dark graphite paper / display-heavy / restrained cool blue
- Navigation · N7 solid slab with the existing accessible disclosure behavior
- Footer · Ft8 marquee composition; continuous animation is reserved for PR 2

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

## Motion boundary

PR 1 establishes static hierarchy with only short transform/color interaction feedback. PR 2 may add scroll/view timelines, progress storytelling, micro-parallax, and runtime navigation morphing after preserving these contracts.

## Exports

This static site uses `tokens.css` directly. `assets/fonts/OFL.txt` contains the SIL Open Font License 1.1 for the locally bundled display font.
