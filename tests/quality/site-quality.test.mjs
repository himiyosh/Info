import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import {
  attributeValue,
  parseSrcsetEntries
} from "../helpers/asset-reference-parsing.mjs";

const repoRoot = process.cwd();

const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

test("JavaScript files are parseable", async () => {
  const javascriptFiles = ["i18n.js", "script.js"];
  for (const filePath of javascriptFiles) {
    const sourceText = await readUtf8(filePath);
    assert.doesNotThrow(() => {
      new vm.Script(sourceText, { filename: filePath });
    });
  }
});

test("rejected continuous curiosity field recovery remains absent", async () => {
  const productionPaths = ["index.html", "i18n.js", "styles.css", "modern.css", "script.js"];
  const rejectedPatterns = [
    /curiosity-field/i,
    /initializeCuriosityField/,
    /requestAnimationFrame\s*\(\s*renderField\s*\)/
  ];

  for (const sourcePath of productionPaths) {
    const sourceText = await readUtf8(sourcePath);
    for (const rejectedPattern of rejectedPatterns) {
      assert.doesNotMatch(
        sourceText,
        rejectedPattern,
        `${sourcePath} must not restore the rejected continuous curiosity field`
      );
    }
  }
});

test("new-tab links include bilingual accessibility announcement text", async () => {
  const indexHtml = await readUtf8("index.html");
  const scriptSource = await readUtf8("script.js");

  assert.match(
    indexHtml,
    /<a href="https:\/\/github\.com\/himiyosh" target="_blank"[\s\S]*data-i18n="accessibility\.opensInNewTab"/,
    "GitHub contact link must announce new-tab behavior via i18n text"
  );
  assert.match(
    scriptSource,
    /window\.siteI18n\.t\("accessibility\.opensInNewTab"\)/,
    "Generated project links must include localized new-tab announcement text"
  );
});

test("AdSense loader only runs when a real ad slot is present", async () => {
  const scriptSource = await readUtf8("script.js");
  assert.match(
    scriptSource,
    /ins\.adsbygoogle,\s*\[data-adsbygoogle-slot\],\s*\[data-ad-client\]/,
    "AdSense loader must detect explicit ad slots before loading third-party script"
  );
  assert.match(scriptSource, /!hasAdSlot/, "AdSense loader must short-circuit when no ad slot exists");
});

test("index.html IDs are unique and internal anchors are valid", async () => {
  const indexHtml = await readUtf8("index.html");
  const ids = [...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, "All id attributes in index.html must be unique");

  const internalAnchors = [...indexHtml.matchAll(/\bhref="#([^"]+)"/g)].map((match) => match[1]);
  for (const anchorTarget of internalAnchors) {
    assert.ok(uniqueIds.has(anchorTarget), `Anchor target "#${anchorTarget}" does not exist`);
  }
});

test("Japanese hero keeps each supplied phrase intact before the narrow emergency override", async () => {
  const stylesSource = await readUtf8("styles.css");
  assert.match(
    stylesSource,
    /html:lang\(ja\)\s+\.hero h1\s*\{[^}]*font-size:\s*clamp\(2\.5rem,\s*6\.5vw,\s*5rem\)/s,
    "Japanese hero sizing must fit both supplied phrases across supported viewports"
  );
  assert.match(
    stylesSource,
    /html:lang\(ja\)\s+\.hero h1 span\s*\{[^}]*white-space:\s*nowrap/s,
    "The default Japanese hero must preserve each intentionally supplied phrase"
  );
});

test("static redesign defers hero tilt runtime work to PR 2", async () => {
  const scriptSource = await readUtf8("script.js");
  const stylesSource = await readUtf8("styles.css");

  for (const deferredTiltPattern of [
    /flushTilt/,
    /resetHeroTilt/,
    /updateHeroTilt/,
    /--tilt-[xy]/,
    /--back-[xy]/,
    /\bis-tilting\b/,
    /pointermove/
  ]) {
    assert.doesNotMatch(
      scriptSource,
      deferredTiltPattern,
      `PR 1 must not retain deferred hero tilt runtime work: ${deferredTiltPattern}`
    );
    assert.doesNotMatch(
      stylesSource,
      deferredTiltPattern,
      `PR 1 styles must not retain deferred hero tilt hooks: ${deferredTiltPattern}`
    );
  }
});

test("scroll-progress is transform-based, progressive, non-essential, and stacks above the sticky header", async () => {
  const indexHtml = await readUtf8("index.html");
  const stylesSource = await readUtf8("styles.css");
  const scriptSource = await readUtf8("script.js");
  const tokensSource = await readUtf8("tokens.css");

  assert.match(
    indexHtml,
    /<div class="scroll-progress" aria-hidden="true">/,
    "index.html must contain the aria-hidden scroll-progress markup"
  );

  // Dedicated semantic z-index layer above --z-sticky (not borrowed
  // modal/toast semantics), so the progress bar reliably paints above
  // the sticky header regardless of DOM/source order — two elements
  // with an EQUAL z-index stack by DOM order, and the header (later in
  // the DOM than .scroll-progress) would otherwise always win and fully
  // occlude the bar.
  const zIndexOrder = ["--z-base", "--z-raised", "--z-dropdown", "--z-sticky", "--z-progress", "--z-modal"];
  const zIndexValues = new Map();
  for (const match of tokensSource.matchAll(/(--z-[a-z]+):\s*(\d+);/g)) {
    zIndexValues.set(match[1], Number(match[2]));
  }
  for (const tokenName of zIndexOrder) {
    assert.ok(zIndexValues.has(tokenName), `tokens.css must define ${tokenName}`);
  }
  assert.ok(
    zIndexValues.get("--z-progress") > zIndexValues.get("--z-sticky"),
    "--z-progress must be greater than --z-sticky so the progress bar paints above the sticky header"
  );
  assert.notEqual(
    zIndexValues.get("--z-progress"),
    zIndexValues.get("--z-modal"),
    "--z-progress must be its own dedicated token, not an alias for --z-modal semantics"
  );

  const scrollProgressRule = stylesSource.match(/\.scroll-progress\s*\{([^}]*)\}/)?.[1];
  assert.ok(scrollProgressRule, "styles.css must define .scroll-progress");
  assert.match(
    scrollProgressRule,
    /z-index:\s*var\(--z-progress\)/,
    ".scroll-progress must use the dedicated --z-progress token, not --z-sticky"
  );

  const siteHeaderRule = stylesSource.match(/\.site-header\s*\{([^}]*)\}/)?.[1];
  assert.ok(siteHeaderRule, "styles.css must define .site-header");
  assert.match(
    siteHeaderRule,
    /z-index:\s*var\(--z-sticky\)/,
    ".site-header must keep using --z-sticky (lower than --z-progress)"
  );

  const fillRule = stylesSource.match(/\.scroll-progress-fill\s*\{([^}]*)\}/s)?.[1];
  assert.ok(fillRule, "styles.css must define .scroll-progress-fill");
  assert.match(
    fillRule,
    /transform:\s*scaleX\(var\(--scroll-progress,\s*0\)\)/,
    "Scroll progress must be communicated via transform: scaleX, never width"
  );
  assert.doesNotMatch(
    fillRule,
    /\bwidth\s*:\s*var\(--scroll-progress/,
    "Scroll progress must never animate width (layout-triggering)"
  );

  assert.match(
    stylesSource,
    /@supports\s*\(animation-timeline:\s*scroll\(\)\)\s*\{[\s\S]*?animation-timeline:\s*scroll\(root\)/,
    "A CSS scroll-timeline enhancement must be layered on top of the JS fallback"
  );
  assert.match(
    stylesSource,
    /\.scroll-progress\s*\{\s*display:\s*none;\s*\}/,
    "The progress bar must be treated as non-essential and hidden under reduced motion"
  );

  assert.match(
    scriptSource,
    /function armScrollMotion\(\)\s*\{\s*if\s*\(scrollMotionArmed\)\s*\{\s*return;/,
    "The shared scroll-scene lifecycle must be idempotent"
  );
  assert.doesNotMatch(
    scriptSource,
    /supportsScrollDrivenAnimations/,
    "Native scroll timelines must not suppress the shared lifecycle required for scene coordination"
  );
  assert.match(
    scriptSource,
    /if\s*\(!prefersReducedMotion\)\s*\{\s*armScrollMotion\(\);/,
    "Scroll motion must only be armed at load when the user has no reduced-motion preference"
  );
  assert.match(
    scriptSource,
    /requestAnimationFrame\(updateScrollMotion\)/,
    "Progress updates must be batched through requestAnimationFrame, not run directly on the scroll event"
  );
  assert.match(
    scriptSource,
    /addEventListener\("scroll",\s*requestScrollMotionUpdate,\s*\{\s*passive:\s*true\s*\}\)/,
    "The scroll listener must be passive"
  );
});

test("hero image preload in head matches the rendered AVIF picture source", async () => {
  const indexHtml = await readUtf8("index.html");

  const imagePreloads = [...indexHtml.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter(
      (tag) =>
        attributeValue(tag, "rel") === "preload" &&
        attributeValue(tag, "as") === "image"
    );
  assert.equal(
    imagePreloads.length,
    1,
    "index.html must include exactly one hero image preload"
  );
  const [preloadTag] = imagePreloads;

  const preloadSrcset = attributeValue(preloadTag, "imagesrcset");
  const preloadSizes  = attributeValue(preloadTag, "imagesizes");
  const preloadHref   = attributeValue(preloadTag, "href");
  const preloadType   = attributeValue(preloadTag, "type");
  const preloadFP     = /fetchpriority="high"/.test(preloadTag);

  assert.ok(preloadSrcset, "preload link must have imagesrcset attribute");
  assert.ok(preloadSizes,  "preload link must have imagesizes attribute");
  assert.ok(preloadHref,   "preload link must have href fallback");
  assert.equal(preloadType, "image/avif", "preload link must declare its AVIF type");
  assert.ok(preloadFP,     "preload link must have fetchpriority=high");

  const pictureTag = indexHtml.match(/<picture>[\s\S]*?<\/picture>/)?.[0];
  const sourceTag = pictureTag?.match(/<source[^>]*type="image\/avif"[^>]*>/)?.[0];
  assert.ok(sourceTag, "Hero picture must include an AVIF source");
  const sourceSrcset = attributeValue(sourceTag, "srcset");
  const sourceSizes = attributeValue(sourceTag, "sizes");
  assert.ok(sourceSrcset, "Hero AVIF source must include srcset");
  assert.ok(sourceSizes, "Hero AVIF source must include sizes");

  assert.equal(
    preloadSrcset,
    sourceSrcset,
    "preload imagesrcset must exactly match the rendered AVIF source srcset"
  );
  assert.equal(
    preloadSizes,
    sourceSizes,
    "preload imagesizes must exactly match the rendered AVIF source sizes"
  );

  const srcsetSources = parseSrcsetEntries(sourceSrcset).map(({ source }) => source);
  assert.ok(
    srcsetSources.includes(preloadHref),
    `preload href (${preloadHref}) must be one of the srcset sources to avoid a duplicate fetch`
  );

  const preloadPos    = indexHtml.indexOf(preloadTag);
  const stylesheetPos = indexHtml.indexOf('<link rel="stylesheet"');
  assert.ok(
    preloadPos < stylesheetPos,
    "preload link must appear before the stylesheet link in <head>"
  );
  assert.ok(
    indexHtml.indexOf(sourceTag) < indexHtml.indexOf("<img", indexHtml.indexOf("<picture>")),
    "AVIF source must precede the JPEG img fallback in source order"
  );
});

test("rich redesign foundation uses local tokens and layers the modern system last", async () => {
  const indexHtml = await readUtf8("index.html");
  const tokensSource = await readUtf8("tokens.css");
  const stylesSource = await readUtf8("styles.css");
  const modernSource = await readUtf8("modern.css");

  assert.match(
    indexHtml,
    /<link rel="stylesheet" href="tokens\.css" \/>\s*<link rel="stylesheet" href="styles\.css" \/>\s*<link rel="stylesheet" href="modern\.css" \/>/,
    "Token and tested foundation stylesheets must load before the additive modern layer"
  );
  assert.doesNotMatch(
    indexHtml,
    /https?:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//,
    "The design must not load a runtime third-party font"
  );
  assert.match(
    tokensSource,
    /@font-face[\s\S]*Big Shoulders Display[\s\S]*assets\/fonts\/BigShouldersDisplay-latin-variable\.woff2/,
    "The Latin display font must be served from the local artifact"
  );
  assert.match(
    tokensSource,
    /--color-accent:\s*oklch\(/,
    "Canonical design colors must be defined in tokens.css"
  );
  assert.match(
    stylesSource,
    /Hallmark · macrostructure: Marquee Hero[\s\S]*theme: Graphite Blue/,
    "The tested foundation CSS must retain its original design record"
  );
  assert.match(
    modernSource,
    /Hallmark · genre: modern-minimal · macrostructure: Feature Stack[\s\S]*theme: Graphite Blue/,
    "The additive layer must record the restored Feature Stack and locked Graphite Blue system"
  );
  assert.match(
    modernSource,
    /\.footer-marquee-set\s*\{[^}]*animation:\s*none;/s,
    "The modern Ft5 footer must explicitly disable the legacy marquee animation"
  );
  await Promise.all([
    stat(path.join(repoRoot, "assets/fonts/BigShouldersDisplay-latin-variable.woff2")),
    stat(path.join(repoRoot, "assets/fonts/OFL.txt"))
  ]);
});

test("footer keeps accessible compatibility markup while the modern layer renders one static statement", async () => {
  const indexHtml = await readUtf8("index.html");
  const modernSource = await readUtf8("modern.css");
  const scriptSource = await readUtf8("script.js");

  const marqueeSets = [...indexHtml.matchAll(/<span class="footer-marquee-set"[^>]*>/g)];
  assert.equal(
    marqueeSets.length,
    2,
    "The marquee track must contain exactly two duplicate sets for a seamless -100% loop"
  );
  assert.match(
    indexHtml,
    /<p class="sr-only" data-i18n="about\.statement">/,
    "A single static sr-only equivalent must remain outside the aria-hidden track"
  );
  assert.match(
    indexHtml,
    /<div class="footer-marquee-track" aria-hidden="true">/,
    "The duplicated track must stay aria-hidden from assistive technology"
  );

  assert.match(
    modernSource,
    /\.footer-marquee-set\s*\{[^}]*animation:\s*none;[^}]*transform:\s*none;/s,
    "The modern statement footer must stay static"
  );
  assert.match(
    modernSource,
    /\.footer-marquee-set:not\(:first-child\),\s*\.footer-marquee-set:first-child > :not\(:first-child\)\s*\{\s*display:\s*none;/,
    "Only the first truthful visual statement may render"
  );
  assert.doesNotMatch(
    scriptSource,
    /footerMarquee|armFooterMarquee|disarmFooterMarquee|syncFooterMarqueeActive/,
    "Dead marquee observation lifecycle must be removed once the footer is statically rendered"
  );
});

test("every desktop project row keeps the image on the left, in DOM order", async () => {
  const stylesSource = await readUtf8("styles.css");
  const projects = JSON.parse(await readUtf8("projects.json"));

  const desktopBlock = stylesSource.match(
    /@media\s*\(min-width:\s*48rem\)\s*\{([\s\S]*)\}\s*@media\s*\(prefers-reduced-motion:\s*reduce\)/
  )?.[1];
  assert.ok(desktopBlock, "Expected a min-width: 48rem media query block");

  assert.doesNotMatch(
    desktopBlock,
    /\.project-row:nth-child\((?:even|odd)\)\s+\.project-media/,
    "No nth-child rule may move .project-media to a different grid column/row on desktop"
  );
  assert.doesNotMatch(
    desktopBlock,
    /\.project-row:nth-child\((?:even|odd)\)\s+\.project-content/,
    "No nth-child rule may move .project-content to a different grid column/row on desktop"
  );
  assert.match(
    desktopBlock,
    /\.project-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*0\.9fr\)\s*minmax\(0,\s*1\.1fr\);/s,
    "Desktop rows must use a fixed two-column grid: media first (left), content second (right)"
  );

  // The odd/even accent-color scene variation must still be present and
  // untouched — only the column swap is removed.
  assert.match(
    stylesSource,
    /\.project-row:nth-child\(odd\)\s*\{\s*background:\s*var\(--color-accent\);/,
    "Odd-row accent color variation must still exist"
  );
  assert.match(
    stylesSource,
    /\.project-row:nth-child\(even\)\s*\{\s*background:\s*var\(--color-accent-2\);/,
    "Even-row accent-2 color variation must still exist"
  );

  assert.ok(projects.length >= 2, "Expected at least two projects to validate row order against");
});

test("headings wrap intentionally: safety-net overflow-wrap, language-aware breaking, balance retained", async () => {
  const stylesSource = await readUtf8("styles.css");

  const headingSelectors = [
    /\.hero h1\s*\{([^}]*)\}/s,
    /\.section-heading h2,\s*\n\.projects-intro h2,\s*\n\.contact h2\s*\{([^}]*)\}/s,
    /\.project-heading h3\s*\{([^}]*)\}/s
  ];

  for (const selectorPattern of headingSelectors) {
    const ruleBody = stylesSource.match(selectorPattern)?.[1];
    assert.ok(ruleBody, `Expected to find heading rule for pattern: ${selectorPattern}`);
    assert.doesNotMatch(
      ruleBody,
      /overflow-wrap:\s*anywhere/,
      "overflow-wrap: anywhere must not be the primary wrapping behavior on display headings"
    );
    assert.match(
      ruleBody,
      /overflow-wrap:\s*break-word/,
      "Headings must keep overflow-wrap: break-word as a true-overflow safety net"
    );
    assert.match(
      ruleBody,
      /text-wrap:\s*balance/,
      "Headings must keep text-wrap: balance for even line lengths"
    );
  }

  assert.match(
    stylesSource,
    /html:lang\(ja\)\s+:where\(\.project-heading h3,\s*\.section-heading h2,\s*\.projects-intro h2,\s*\.contact h2\)\s*\{\s*word-break:\s*keep-all;/,
    "Non-hero Japanese display headings must use word-break: keep-all so words don't split mid-character-group"
  );
  assert.match(
    stylesSource,
    /:where\(\.project-heading h3,\s*\.section-heading h2,\s*\.projects-intro h2,\s*\.contact h2\)\s*\{\s*hyphens:\s*auto;/,
    "Non-hero headings must have a hyphens: auto safety net for long Latin words"
  );
});

test("hero entrance runs from .js-enabled alone with no script.js dependency, and LCP image stays untouched", async () => {
  const stylesSource = await readUtf8("styles.css");
  const tokensSource = await readUtf8("tokens.css");

  const entranceRule = stylesSource.match(
    /\.js-enabled \.hero h1 span,\s*\n\.js-enabled \.hero-support > \*\s*\{([^}]*)\}/
  )?.[1];
  assert.ok(entranceRule, "Expected a combined .js-enabled hero entrance rule");
  assert.match(entranceRule, /opacity:\s*0;/, "Hero entrance must start from opacity: 0");
  assert.match(
    entranceRule,
    /transform:\s*translateY\(var\(--reveal-offset\)\)/,
    "Hero entrance must use a transform, not a layout property, for its offset"
  );
  assert.match(
    entranceRule,
    /animation:\s*hero-reveal\s+var\(--dur-long\)\s+var\(--ease-out\)\s+forwards/,
    "Hero entrance must be driven by a forwards-filling CSS animation"
  );

  // Total choreography must land in the 500-800ms window: last delay
  // (280ms) + duration (--dur-long, 420ms) = 700ms.
  assert.match(tokensSource, /--dur-long:\s*420ms/, "dur-long token must still be 420ms");
  assert.match(
    stylesSource,
    /\.js-enabled \.hero-support > \*:nth-child\(3\)\s*\{\s*animation-delay:\s*280ms;\s*\}/,
    "The last staggered hero element must land within the 500-800ms budget"
  );

  assert.doesNotMatch(
    stylesSource,
    /\.hero-visual(?:\s+img)?\s*\{[^}]*animation:/,
    "The hero visual frame/img must never carry an entrance animation (protects LCP)"
  );
});

test("nav compact morph is paint-only and never shifts header layout or touch targets", async () => {
  const stylesSource = await readUtf8("styles.css");
  const scriptSource = await readUtf8("script.js");

  const compactRule = stylesSource.match(/\.site-header\.is-compact\s*\{([^}]*)\}/)?.[1];
  assert.ok(compactRule, "Expected a .site-header.is-compact rule");
  assert.doesNotMatch(
    compactRule,
    /\b(?:min-height|height|padding|margin|border-width)\s*:/,
    "Compact nav state must not touch box-model properties that would shift layout"
  );
  assert.match(compactRule, /background-color:/, "Compact state must be signalled via background-color");

  const wordmarkCompactRule = stylesSource.match(
    /\.site-header\.is-compact \.wordmark-mark\s*\{([^}]*)\}/
  )?.[1];
  assert.ok(wordmarkCompactRule, "Expected a compact wordmark-mark transform rule");
  assert.match(wordmarkCompactRule, /transform:/, "Compact wordmark-mark treatment must use transform only");

  // The clickable wordmark link itself must never be scaled (44px target).
  assert.doesNotMatch(
    stylesSource,
    /\.site-header\.is-compact \.wordmark\s*\{[^}]*transform:/,
    "The wordmark link (the 44px touch target) must never be transformed by the compact state"
  );

  assert.match(
    scriptSource,
    /heroObserver\.observe\(heroSection\)/,
    "script.js must observe the hero section to drive the compact morph"
  );
  assert.match(
    scriptSource,
    /siteHeader\.classList\.toggle\("is-compact",\s*!entry\.isIntersecting\)/,
    "The compact class must toggle based on the hero's intersection state"
  );
});

test("micro-parallax is capped at +/-5px, applied to the frame not the img, and disabled under reduced motion", async () => {
  const stylesSource = await readUtf8("styles.css");
  const modernSource = await readUtf8("modern.css");
  const scriptSource = await readUtf8("script.js");
  const tokensSource = await readUtf8("tokens.css");

  assert.match(
    tokensSource,
    /--parallax-distance:\s*5px;/,
    "tokens.css must cap parallax distance at 5px"
  );

  assert.match(
    modernSource,
    /\.project-media\s*\{[^}]*transform:\s*translateY\(var\(--media-translate-y,\s*0\)\)\s*scale\(var\(--media-depth,\s*1\)\)/s,
    "The modern media frame must consume the shared depth and bounded translation properties"
  );
  assert.match(
    modernSource,
    /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.js-enabled \.project-row\.is-priming\s*\{\s*opacity:\s*1;/,
    "The bounded row entrance must never fade project text below accessible contrast"
  );

  assert.doesNotMatch(
    stylesSource,
    /\.project-media img\s*\{[^}]*--parallax-y/,
    "Parallax must never apply to .project-media img (would collide with its own hover scale)"
  );

  assert.match(
    stylesSource,
    /@supports \(animation-timeline: view\(\)\)\s*\{[\s\S]*?animation-timeline:\s*view\(\);/,
    "A compositor-driven view-timeline enhancement must be layered on top of the JS fallback"
  );

  assert.match(
    scriptSource,
    /--media-translate-y/,
    "The shared rAF lifecycle must drive the modern media translation property"
  );
  assert.doesNotMatch(
    scriptSource,
    /--parallax-y/,
    "The old standalone parallax property must not survive the shared scene lifecycle"
  );
  assert.doesNotMatch(
    scriptSource,
    /querySelectorAll\(["']\.project-media["']\)[\s\S]{0,80}addEventListener\(\s*["']scroll["']/,
    "Parallax must not attach a per-element scroll listener"
  );
});

test("color-scheme metadata matches the shipped dark-only theme", async () => {
  const indexHtml = await readUtf8("index.html");

  assert.match(
    indexHtml,
    /<meta name="color-scheme" content="dark" \/>/,
    'color-scheme metadata must declare "dark" to match the single dark Graphite Blue theme'
  );
  assert.doesNotMatch(
    indexHtml,
    /<meta name="color-scheme" content="(?:light|dark light|light dark)" \/>/,
    "color-scheme must not claim a light variant while none is shipped"
  );
});

test("Feature Stack restoration is additive, scene-marked, and documented by the locked system", async () => {
  const indexHtml = await readUtf8("index.html");
  const modernSource = await readUtf8("modern.css");
  const tokensSource = await readUtf8("tokens.css");
  const designSource = await readUtf8("design.md");

  assert.match(
    indexHtml,
    /tokens\.css" \/>\s*<link rel="stylesheet" href="styles\.css" \/>\s*<link rel="stylesheet" href="modern\.css"/,
    "modern.css must remain an additive layer after tokens.css and styles.css"
  );
  assert.match(
    indexHtml,
    /<div class="viewport-stage" aria-hidden="true">[\s\S]*viewport-stage-layer-hero[\s\S]*viewport-stage-layer-contact/,
    "The decorative viewport stage must be aria-hidden and expose the layered scene planes"
  );
  assert.match(indexHtml, /<section class="hero"[^>]*data-scene="hero">[\s\S]*class="hero-sticky"/);
  for (const scene of ["about", "projects", "contact"]) {
    assert.match(indexHtml, new RegExp(`<section[^>]*data-scene="${scene}"`));
  }
  assert.match(modernSource, /macrostructure: Feature Stack[\s\S]*theme: Graphite Blue/);
  assert.match(designSource, /Marketing macrostructure · Feature Stack/);
  assert.match(designSource, /Footer · Ft5 statement composition/);
  for (const token of [
    "--color-scene-hero",
    "--color-scene-about",
    "--color-scene-projects",
    "--color-scene-contact",
    "--shadow-cinematic",
    "--depth-project-max",
    "--header-height"
  ]) {
    assert.match(tokensSource, new RegExp(`${token}:`), `tokens.css must define ${token}`);
  }
});

test("one shared rAF lifecycle coordinates active scene, hero, project copy, and media depth", async () => {
  const scriptSource = await readUtf8("script.js");

  const passiveScrollListeners = [
    ...scriptSource.matchAll(
      /addEventListener\("scroll",\s*requestScrollMotionUpdate,\s*\{\s*passive:\s*true\s*\}\)/g
    )
  ];
  assert.equal(passiveScrollListeners.length, 1, "Exactly one passive scroll listener may coordinate scenes");
  assert.match(scriptSource, /requestAnimationFrame\(updateScrollMotion\)/);
  assert.match(scriptSource, /document\.body\.dataset\.scene = activeSceneElement\.dataset\.scene/);
  assert.match(scriptSource, /classList\.add\("is-active-scene"\)/);
  assert.match(
    scriptSource,
    /"--project-opacity",\s*\(0\.92 \+ focus \* 0\.08\)\.toFixed\(4\)/,
    "Off-scene project copy must stay within the accessible 92-100% opacity range"
  );
  assert.match(
    scriptSource,
    /if\s*\(documentBottom <= 2\)\s*\{\s*setActiveScene\(scrollSceneElements\.at\(-1\)\);/,
    "The footer must become the final active scene at the document boundary"
  );
  for (const property of [
    "--hero-opacity",
    "--hero-depth",
    "--hero-scale",
    "--project-opacity",
    "--project-depth",
    "--media-depth",
    "--media-translate-y"
  ]) {
    assert.match(
      scriptSource,
      new RegExp(`setProperty\\(\\s*"${property}"`),
      `The shared lifecycle must set ${property}`
    );
    assert.match(
      scriptSource,
      new RegExp(`removeProperty\\("${property}"`),
      `Reduced-motion cleanup must remove ${property}`
    );
  }
  assert.match(scriptSource, /cancelAnimationFrame\(scrollMotionFrame\)/);
  assert.match(scriptSource, /document\.body\.removeAttribute\("data-scene"\)/);
});

test("Feature Stack chapters preserve desktop image-left and mobile media-first ordering", async () => {
  const modernSource = await readUtf8("modern.css");
  const scriptSource = await readUtf8("script.js");

  assert.match(
    scriptSource,
    /article\.append\(media,\s*content\)/,
    "Rendered project DOM must keep media before copy for the mobile source order"
  );
  const desktopBlock = modernSource.match(/@media \(min-width: 48rem\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(desktopBlock, "modern.css must define the desktop Feature Stack breakpoint");
  assert.match(
    desktopBlock,
    /\.project-row\s*\{[^}]*min-height:\s*100svh;[^}]*grid-template-columns:\s*minmax\(0,\s*1\.08fr\)\s*minmax\(0,\s*0\.72fr\);/s,
    "Desktop project chapters must be viewport-height, media-left, and use overflow-safe tracks"
  );
  assert.doesNotMatch(
    modernSource,
    /\.project-row:nth-child\((?:odd|even)\)\s+\.project-(?:media|content)\s*\{[^}]*grid-/,
    "Scene color alternation must never reverse project media/content order"
  );
  assert.doesNotMatch(modernSource, /\bwidth:\s*100vw\b/, "The modern layer must not introduce 100vw overflow");
  assert.match(
    desktopBlock,
    /\.js-enabled \.nav-menu,\s*\.nav-menu\s*\{[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s,
    "Desktop navigation must not inherit a nested mobile disclosure frame"
  );
});

test("modern typography preserves natural language wrapping and stable no-JS/reduced-motion flow", async () => {
  const modernSource = await readUtf8("modern.css");

  for (const selector of [".hero h1", ".project-heading h3"]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rule = modernSource.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s"))?.[1];
    assert.ok(rule, `Expected modern heading rule for ${selector}`);
    assert.match(rule, /overflow-wrap:\s*break-word/);
    assert.match(rule, /text-wrap:\s*balance/);
    assert.doesNotMatch(rule, /overflow-wrap:\s*anywhere/);
  }
  assert.match(
    modernSource,
    /html:not\(\.js-enabled\) \.hero,\s*html:not\(\.js-enabled\) \.about,\s*html:not\(\.js-enabled\) \.project-row\s*\{\s*min-height:\s*auto;/,
    "No-JS mode must collapse cinematic chapter heights to normal flow"
  );
  assert.match(
    modernSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.hero,\s*\.about,\s*\.project-row\s*\{\s*min-height:\s*auto;/,
    "Reduced motion must collapse cinematic chapter heights to normal flow"
  );
  assert.match(modernSource, /html,\s*body\s*\{\s*overflow-x:\s*clip;/);
  assert.match(
    modernSource,
    /@media \(max-width: 30rem\)[\s\S]*?overflow-wrap:\s*anywhere;/,
    "Narrow and enlarged-text layouts must retain an anywhere emergency wrap"
  );
  assert.match(
    modernSource,
    /@media \(max-width: 30rem\)[\s\S]*?html:lang\(ja\) \.hero h1 span\s*\{\s*white-space:\s*normal;\s*line-break:\s*strict;\s*word-break:\s*normal;/,
    "The final narrow cascade must release inherited nowrap and restore strict Japanese breaking"
  );
  assert.match(
    modernSource,
    /@media \(max-width: 30rem\)[\s\S]*?html:lang\(ja\) \.hero h1\s*\{\s*font-size:\s*min\(2\.5rem,\s*18vw\);/,
    "The Japanese display size must cap against the viewport when rem-based text is enlarged"
  );
  assert.match(
    modernSource,
    /@supports \(word-break: auto-phrase\)[\s\S]*?html:lang\(ja\) \.hero h1 span\s*\{\s*word-break:\s*auto-phrase;/,
    "Phrase-aware Japanese breaking must remain the progressive narrow-layout enhancement"
  );
  assert.match(
    modernSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.button-primary,\s*\.project-link\s*\{\s*transform:\s*none\s*!important;/,
    "Decorative CTA and project-link transforms must be removed under reduced motion"
  );
});

test("Ft5 footer is one truthful static statement with no active marquee lifecycle", async () => {
  const indexHtml = await readUtf8("index.html");
  const modernSource = await readUtf8("modern.css");
  const scriptSource = await readUtf8("script.js");

  assert.equal(
    [...indexHtml.matchAll(/<span class="footer-marquee-set">/g)].length,
    2,
    "Compatibility markup must retain the two existing aria-hidden sets"
  );
  assert.match(indexHtml, /<p class="sr-only" data-i18n="about\.statement">/);
  assert.match(
    modernSource,
    /\.footer-marquee-set:not\(:first-child\),\s*\.footer-marquee-set:first-child > :not\(:first-child\)\s*\{\s*display:\s*none;/,
    "Only the first visual statement may remain"
  );
  assert.match(modernSource, /\.footer-marquee-set\s*\{[^}]*animation:\s*none;/s);
  assert.doesNotMatch(scriptSource, /footerMarquee|visibilitychange/);
});
