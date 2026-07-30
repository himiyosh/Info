import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();

const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

test("reduced motion nulls every new spatial transform, disables non-essential motion, and keeps the wordmark-mark rotation invariant", async () => {
  const stylesSource = await readUtf8("styles.css");
  const modernSource = await readUtf8("modern.css");

  const reducedBlock = stylesSource.match(
    /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\}\s*@media \(forced-colors: active\)/
  )?.[1];
  assert.ok(reducedBlock, "Expected a prefers-reduced-motion: reduce block before the forced-colors block");

  assert.match(
    reducedBlock,
    /\.hero h1 span,\s*\n\s*\.hero-support > \*,\s*\n\s*\.project-row,\s*\n\s*\.project-media\s*\{\s*transform:\s*none\s*!important;/,
    "Reduced motion must null transform on every new PR 2 spatial motion surface"
  );

  // Regression: the wordmark-mark's static rotate(12deg) predates PR 2.
  // Nulling it to "none" only in the .is-compact state (while the
  // resting state keeps rotate(12deg)) creates a visible, scroll-
  // triggered rotation under reduced motion every time is-compact
  // toggles. Both states must keep the identical static rotation, and
  // the transition itself must be removed (not just capped to 150ms).
  assert.doesNotMatch(
    reducedBlock,
    /\.site-header\.is-compact \.wordmark-mark\s*\{\s*transform:\s*none/,
    "Reduced motion must not null the wordmark-mark's static rotation in the compact state alone"
  );
  const wordmarkRule = reducedBlock.match(
    /\.wordmark-mark,\s*\n\s*\.site-header\.is-compact \.wordmark-mark\s*\{([^}]*)\}/
  )?.[1];
  assert.ok(
    wordmarkRule,
    "Reduced motion must define one combined rule for .wordmark-mark and .site-header.is-compact .wordmark-mark"
  );
  assert.match(
    wordmarkRule,
    /transform:\s*rotate\(12deg\)\s*!important;/,
    "Both the resting and compact wordmark-mark states must keep the identical static rotate(12deg) under reduced motion"
  );
  assert.match(
    wordmarkRule,
    /transition:\s*none\s*!important;/,
    "The wordmark-mark transition must be fully removed under reduced motion, not merely shortened"
  );

  assert.match(
    reducedBlock,
    /\.scroll-progress\s*\{\s*display:\s*none;\s*\}/,
    "The scroll progress bar must be hidden outright under reduced motion"
  );
  assert.match(
    reducedBlock,
    /\.footer-marquee-set\s*\{\s*animation:\s*none\s*!important;/,
    "The marquee animation must be fully disabled under reduced motion"
  );
  assert.match(
    modernSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.hero-sticky,\s*\.project-content,\s*\.project-media\s*\{\s*opacity:\s*1\s*!important;\s*transform:\s*none\s*!important;/,
    "The modern layer must null every scene-derived spatial transform and restore full visibility"
  );
});

test("reduced motion preference is live: a runtime change arms/disarms motion without duplicate observers", async () => {
  const scriptSource = await readUtf8("script.js");

  assert.match(
    scriptSource,
    /const motionQuery = window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\);/,
    "script.js must keep a live MediaQueryList for prefers-reduced-motion, not just read .matches once"
  );
  assert.match(
    scriptSource,
    /let prefersReducedMotion = motionQuery\.matches;/,
    "prefersReducedMotion must be reassignable (let), updated by the change listener"
  );

  const changeHandler = scriptSource.match(
    /function handleMotionPreferenceChange\(event\)\s*\{([\s\S]*?)\n\s*\}/
  )?.[1];
  assert.ok(changeHandler, "Expected a handleMotionPreferenceChange function");
  assert.match(
    changeHandler,
    /prefersReducedMotion = event\.matches;/,
    "The change handler must update the live prefersReducedMotion flag from the event"
  );
  assert.match(
    changeHandler,
    /disarmScrollMotion\(\);[\s\S]*disarmProjectReveal\(\);/,
    "Switching to reduced motion must immediately disarm scene motion and any priming project rows"
  );
  assert.match(
    changeHandler,
    /armScrollMotion\(\);/,
    "Switching back to no-preference must re-arm the shared scene lifecycle"
  );

  assert.match(
    scriptSource,
    /motionQuery\.addEventListener\("change",\s*handleMotionPreferenceChange\)/,
    "script.js must subscribe to live prefers-reduced-motion changes"
  );

  // Idempotency: repeated arm calls must not attach duplicate listeners
  // or create duplicate observers.
  assert.match(
    scriptSource,
    /function armScrollMotion\(\)\s*\{\s*if\s*\(scrollMotionArmed\)\s*\{\s*return;/,
    "armScrollMotion must guard against being armed twice"
  );
  assert.match(
    scriptSource,
    /function disarmScrollMotion\(\)[\s\S]*?cancelAnimationFrame\(scrollMotionFrame\)[\s\S]*?clearScrollMotionStyles\(\);/,
    "disarmScrollMotion must cancel pending work and clear all derived scene styles"
  );
});
