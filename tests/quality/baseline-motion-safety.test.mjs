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

test("reveal targets stay visible by default and reveal machinery is bounded and safe", async () => {
  const modernSource = await readUtf8("modern.css");
  const scriptSource = await readUtf8("script.js");

  // Priming (the hidden pre-reveal state) may exist ONLY behind the
  // .js-enabled AND prefers-reduced-motion: no-preference double guard,
  // so no-JS visitors and reduced-motion visitors always see content.
  const primingRule = modernSource.match(
    /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{\s*\.js-enabled\s+\.is-priming\s*\{([^}]*)\}/s
  );
  assert.ok(
    primingRule,
    "The priming state must be scoped to .js-enabled AND prefers-reduced-motion: no-preference"
  );
  assert.match(primingRule[1], /opacity:\s*0/);
  const primingSelectors = [...modernSource.matchAll(/[^{}]*\.is-priming[^{}]*\{/g)];
  for (const [selector] of primingSelectors) {
    assert.match(
      selector,
      /\.js-enabled/,
      `Every .is-priming selector must require .js-enabled: ${selector.trim()}`
    );
  }

  // script.js: priming is armed only when JS + IntersectionObserver + no
  // motion preference are all present, re-evaluated live; every reveal is
  // one-time; and a hard timeout clears any stuck priming class.
  assert.match(
    scriptSource,
    /function shouldAnimateReveal\(\)\s*\{\s*return !prefersReducedMotion && supportsIntersectionObserver;/,
    "Reveal priming must be gated on both reduced-motion and IntersectionObserver support"
  );
  assert.match(
    scriptSource,
    /if \(!shouldAnimateReveal\(\) \|\| revealObserver !== null\)/,
    "Arming must re-read the live gate and stay idempotent"
  );
  assert.match(
    scriptSource,
    /classList\.add\("is-priming"\)/,
    "script.js must prime targets for the bounded reveal"
  );
  assert.match(
    scriptSource,
    /observer\.unobserve\(entry\.target\)/,
    "Each target's reveal must be one-time (unobserve after it fires)"
  );
  assert.match(
    scriptSource,
    /revealBackstopTimer = window\.setTimeout\(disarmReveal, 2500\)/,
    "script.js must include a timeout safety net that clears any stuck priming class"
  );
  assert.match(
    scriptSource,
    /function disarmReveal\(\)\s*\{[\s\S]*?revealObserver\?\.disconnect\(\);[\s\S]*?classList\.remove\("is-priming"\)/,
    "A runtime switch to reduced motion must disconnect the observer and clear any stale priming class"
  );
  assert.doesNotMatch(
    scriptSource,
    /\bprojectObserver\b|\bsetupProjectMotion\b|--project-index/,
    "script.js must not restore the old rejected reveal symbol names"
  );
});
