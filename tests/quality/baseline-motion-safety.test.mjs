import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();

const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

test("hero image has no entrance animation and decorative keyframes are removed", async () => {
  const stylesSource = await readUtf8("styles.css");
  assert.doesNotMatch(
    stylesSource,
    /\.motion-ready\s+\.hero-visual\s+img\s*\{[^}]*animation:/,
    "Hero visual img must not have an entrance animation (delays LCP under throttling)"
  );
  assert.doesNotMatch(
    stylesSource,
    /@keyframes\s+photo-/,
    "No photo-* keyframe animation must exist for the hero image"
  );
  assert.doesNotMatch(
    stylesSource,
    /@keyframes\s+brand-marker/,
    "brand-marker keyframes must be removed (decorative GPU animation)"
  );
});

test("contact link hover transitions do not animate layout properties", async () => {
  const stylesSource = await readUtf8("styles.css");
  const contactLinkRule = stylesSource.match(/\.contact-links a\s*\{([^}]*)\}/s)?.[1];
  const contactHoverRule = stylesSource.match(/\.contact-links a:hover\s*\{([^}]*)\}/s)?.[1];
  const layoutPropertyPattern = /\b(?:padding|margin|width|height|inset|top|right|bottom|left)(?:-[a-z]+)?\b/;

  assert.ok(contactLinkRule, "Contact links must keep their base styling");
  assert.ok(contactHoverRule, "Contact links must keep a pointer hover state");
  assert.doesNotMatch(
    contactLinkRule.match(/transition\s*:[^;]+;/s)?.[0] ?? "",
    layoutPropertyPattern,
    "Contact link transitions must not animate layout properties"
  );
  assert.doesNotMatch(
    contactHoverRule,
    layoutPropertyPattern,
    "Contact link hover must not change layout properties"
  );
  assert.match(
    contactHoverRule,
    /\bbackground(?:-color)?\s*:/,
    "Contact link hover must retain a restrained color signal"
  );
});

test("project rows stay visible by default and reveal machinery is bounded and safe", async () => {
  const stylesSource = await readUtf8("styles.css");
  const scriptSource = await readUtf8("script.js");

  // Base state: every row is visible with zero JS dependency. No rule
  // outside a .js-enabled + no-preference guard may set opacity/transform
  // on .project-row.
  assert.match(
    stylesSource,
    /\.project-row\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*none;/s,
    ".project-row base rule must default to fully visible with no transform"
  );

  const primingRule = stylesSource.match(
    /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{\s*\.js-enabled\s+\.project-row\s*\{([^}]*)\}\s*\.js-enabled\s+\.project-row\.is-priming\s*\{([^}]*)\}/s
  );
  assert.ok(
    primingRule,
    "The priming/reveal transition must be scoped to .js-enabled AND prefers-reduced-motion: no-preference"
  );
  assert.match(
    primingRule[1],
    /--row-index/,
    "The reveal transition delay must derive from a per-row --row-index custom property"
  );
  assert.match(
    primingRule[1],
    /min\(var\(--row-index,\s*0\),\s*9\)/,
    "The stagger must be capped (min() clamp) rather than growing unbounded with row count"
  );
  assert.match(
    primingRule[2],
    /transition:\s*none/,
    "Entering the primed (hidden) state must be instant, never itself an animated hide"
  );

  // script.js: only ever primes a row when JS + IntersectionObserver +
  // no motion preference are all present (re-evaluated on every render
  // via a function, not captured once, so a runtime preference change
  // takes effect for the next render), always with a one-time observer
  // (unobserve on reveal) and a hard timeout safety net.
  assert.match(
    scriptSource,
    /function shouldAnimateProjectReveal\(\)\s*\{\s*return\s*!prefersReducedMotion\s*&&\s*supportsIntersectionObserver;/,
    "Reveal priming must be gated on both reduced-motion and IntersectionObserver support, re-evaluated per render"
  );
  assert.match(
    scriptSource,
    /const animateReveal = shouldAnimateProjectReveal\(\);/,
    "renderProjects must re-read the live reveal gate on every call, not a value captured once at load"
  );
  assert.match(
    scriptSource,
    /classList\.add\("is-priming"\)/,
    "script.js must prime rows for the bounded reveal"
  );
  assert.match(
    scriptSource,
    /observer\.unobserve\(entry\.target\)/,
    "Each row's reveal must be one-time (unobserve after it fires)"
  );
  assert.match(
    scriptSource,
    /setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?classList\.remove\("is-priming"\)/,
    "script.js must include a timeout safety net that clears any stuck priming class"
  );
  assert.match(
    scriptSource,
    /function disarmProjectReveal\(\)\s*\{[\s\S]*?projectRevealObserver\?\.disconnect\(\);[\s\S]*?classList\.remove\("is-priming"\)/,
    "A runtime switch to reduced motion must disconnect the observer and clear any stale priming class"
  );
  assert.doesNotMatch(
    scriptSource,
    /\bprojectObserver\b|\bsetupProjectMotion\b|--project-index/,
    "script.js must not restore the old rejected reveal symbol names"
  );
});

