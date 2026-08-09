# Product

## Register

brand

## Users

Visitors, peers, and potential collaborators who want a quick, trustworthy view
of himiyosh's engineering interests, selected projects, and contact paths.

## Product Purpose

Present a concise bilingual personal portfolio that makes the owner, current
work, and ways to connect understandable without implying endorsement by an
employer. Success means visitors can orient themselves, inspect real projects,
and reach the owner quickly on any device.

## Brand Personality

Curious, capable, and approachable. The experience should feel technical
without becoming corporate, and personal without becoming casual or unclear.

## Anti-references

- Employer-branded or corporate marketing pages that blur the personal disclaimer.
- Generic AI/SaaS templates built from ornamental glass cards and gradient text.
- Portfolio theatrics that hide content, overstate project claims, or slow access
  to the actual work.
- Imported 3D set pieces — floating abstract shapes, stock scenes — that carry no
  meaning specific to this person.

## Design Principles

- Put identity, work, and contact paths ahead of decoration.
- Keep Japanese and English experiences equally understandable.
- Let motion enrich content that is already visible and usable.
- Prefer a fast, resilient static implementation over unnecessary dependencies.
- Express a personal point of view without inventing claims or employer affiliation.

## Dimensional Direction

The hero carries a real-time 3D centerpiece: a procedural mountain ridge drawn as
a topographic wireframe. It is dimensional, not decorative — it continues motifs
the site already owns (the topographic background, the mountain wordmark, the
valley photograph) into depth, so the scene could not be lifted onto another
person's site without becoming meaningless.

Constraints that direction has to survive:

- **Meaning before spectacle.** A 3D element earns its place by extending an
  existing motif. If it could be swapped for a generic object without loss, it
  fails the anti-reference above.
- **Copy wins every collision.** The scene is masked away from the headline
  column and yields the moment it would contest a word for legibility. Contrast
  budgets belong to the text, never to the scene.
- **No dependency for the scene.** The renderer is hand-written WebGL in one
  file. A 3D library would ship more bytes for the hero alone than the entire
  current site, which the performance stance above does not accept.
- **Every layer optional.** No WebGL, no GPU, a driver failure, or reduced motion
  each degrade to the composition that shipped before the scene existed. The
  hero must never depend on the scene to make sense.
- **Complexity scales down.** Coarse pointers and low-memory devices get the same
  scene at a lower sample count, and the loop parks when the hero is off-screen
  or the tab is hidden.

## Accessibility & Inclusion

Aim for WCAG 2.2 AA. Preserve keyboard navigation, visible focus, 44px touch
targets, responsive layouts, sufficient contrast, meaningful semantics, and a
complete reduced-motion experience.

The motion layer inherits this without exception. Pointer-driven effects
(magnetic controls, cursor presence) are additive only: the native cursor is
never hidden, hit targets never move out from under a pointer, and nothing in
the layer is reachable by keyboard, so no focus path can be altered by it.
Reduced motion removes decorative motion outright rather than shortening it, and
the 3D scene resolves to a single static frame rather than disappearing.
