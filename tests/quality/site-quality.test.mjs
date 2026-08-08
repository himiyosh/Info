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
  const generatorSource = await readUtf8("scripts/generate-static-pages.mjs");
  assert.match(
    generatorSource,
    /accessibility\.opensInNewTab/,
    "Baked project links must include localized new-tab announcement text"
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
    "The progress indicator must stay decorative (aria-hidden)"
  );
  assert.match(
    stylesSource,
    /\.scroll-progress-fill\s*\{[^}]*transform:\s*scaleX\(var\(--scroll-progress,\s*0\)\)/s,
    "The fill must be transform-driven from one custom property"
  );
  assert.doesNotMatch(
    stylesSource,
    /\.scroll-progress-fill\s*\{[^}]*width:\s*var\(--scroll-progress/s,
    "The fill must never animate layout via width"
  );
  assert.match(
    stylesSource,
    /@supports\s*\(animation-timeline:\s*scroll\(\)\)/,
    "Scroll-timeline support must upgrade the indicator without script"
  );
  assert.match(
    stylesSource,
    /animation-timeline:\s*scroll\(root\)/,
    "The upgraded indicator must bind to the root scroller"
  );

  // Where scroll-timelines are missing, exactly one passive listener feeds
  // the same custom property through a batched animation frame.
  assert.match(
    scriptSource,
    /if \(!CSS\.supports\("animation-timeline: scroll\(\)"\)\)/,
    "The script fallback must yield entirely to native scroll-timelines"
  );
  const passiveScrollListeners = [
    ...scriptSource.matchAll(/addEventListener\("scroll",/g)
  ];
  assert.equal(
    passiveScrollListeners.length,
    1,
    "Exactly one scroll listener may exist: the progress fallback"
  );
  assert.match(
    scriptSource,
    /addEventListener\("scroll", requestScrollProgressUpdate, \{ passive: true \}\)/,
    "The fallback listener must be passive"
  );
  assert.match(
    scriptSource,
    /if \(scrollProgressFrame === null\)\s*\{\s*scrollProgressFrame = window\.requestAnimationFrame\(updateScrollProgress\);/,
    "The fallback must batch through one pending frame"
  );

  const zIndexValues = new Map(
    [...tokensSource.matchAll(/(--z-[a-z]+):\s*(\d+);/g)].map(([, name, value]) => [
      name,
      Number(value)
    ])
  );
  for (const tokenName of ["--z-base", "--z-raised", "--z-dropdown", "--z-sticky", "--z-progress", "--z-modal"]) {
    assert.ok(zIndexValues.has(tokenName), `tokens.css must define ${tokenName}`);
  }
  assert.ok(
    zIndexValues.get("--z-progress") > zIndexValues.get("--z-sticky"),
    "The progress bar must stack above the sticky header"
  );
  assert.notEqual(
    zIndexValues.get("--z-progress"),
    zIndexValues.get("--z-modal"),
    "The progress bar must not collide with modal stacking"
  );
  assert.match(
    stylesSource,
    /\.scroll-progress\s*\{[^}]*z-index:\s*var\(--z-progress\)/s,
    "The progress bar must use the token, not a literal"
  );
  assert.match(
    stylesSource,
    /\.site-header\s*\{[^}]*z-index:\s*var\(--z-sticky\)/s,
    "The header must use the sticky token, not a literal"
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
  assert.doesNotMatch(
    modernSource,
    /footer-marquee/,
    "The legacy footer marquee must stay fully retired from the modern layer"
  );
  assert.doesNotMatch(
    stylesSource,
    /footer-marquee/,
    "The legacy footer marquee must stay fully retired from the foundation layer"
  );
  await Promise.all([
    stat(path.join(repoRoot, "assets/fonts/BigShouldersDisplay-latin-variable.woff2")),
    stat(path.join(repoRoot, "assets/fonts/OFL.txt"))
  ]);
});

test("footer renders the clock, the statement, and the recovery link once each", async () => {
  const indexHtml = await readUtf8("index.html");
  const scriptSource = await readUtf8("script.js");

  const footer = indexHtml.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/)?.[1];
  assert.ok(footer, "index.html must keep one site footer");
  assert.match(
    footer,
    /<p\b[^>]*id="footer-clock"[^>]*>--:--:-- JST<\/p>/,
    "The clock must ship a static placeholder so no-JS and print footers still read as a clock"
  );
  assert.match(
    footer,
    /class="footer-statement" data-i18n="about\.statement"/,
    "The footer must carry the single truthful statement"
  );
  assert.equal(
    [...footer.matchAll(/data-i18n="about\.statement"/g)].length,
    1,
    "The statement must appear exactly once in the footer"
  );
  assert.match(footer, /<a[^>]*href="#top"[^>]*data-i18n="footer\.backToTop"/);
  assert.match(footer, /class="footer-disclaimer"/);

  assert.match(
    scriptSource,
    /timeZone: "Asia\/Tokyo"/,
    "The clock must render Japan Standard Time regardless of the visitor's zone"
  );
  assert.match(
    scriptSource,
    /window\.addEventListener\("pagehide", \(\) => \{\s*window\.clearInterval\(footerClockTimer\);/,
    "The clock interval must tear down on pagehide"
  );
  assert.doesNotMatch(
    scriptSource,
    /footerMarquee|armFooterMarquee|disarmFooterMarquee|syncFooterMarqueeActive|visibilitychange/,
    "Retired footer marquee machinery must stay retired"
  );
});
test("panel rows keep the prototype's fixed column order with no nth-child reordering", async () => {
  const stylesSource = await readUtf8("styles.css");
  const modernSource = await readUtf8("modern.css");
  const projects = JSON.parse(await readUtf8("projects.json"));

  // The scene-era two-column rows are retired for good: their selectors
  // must not creep back into either stylesheet and silently restyle the
  // panel rows that reuse project ids.
  for (const source of [stylesSource, modernSource]) {
    assert.doesNotMatch(
      source,
      /\.project-row|\.project-media|\.project-content/,
      "Retired scene-row selectors must not return to the shipped stylesheets"
    );
  }

  assert.match(
    modernSource,
    /\.row\s*\{[^}]*grid-template-columns:\s*5\.2rem 1\.15fr 0\.8fr 1\.2fr auto;/s,
    "Panel rows must keep the prototype's fixed five-column grid: status, name, type, stack, go"
  );
  assert.doesNotMatch(
    modernSource,
    /\.row:nth-child\([^)]*\)[^{]*\{[^}]*(?:grid-column|grid-row|order:)/s,
    "No nth-child rule may reorder panel-row columns"
  );

  assert.ok(projects.length >= 2, "Expected at least two projects to validate row order against");
});

test("headings wrap intentionally: safety-net overflow-wrap, language-aware breaking, balance retained", async () => {
  const stylesSource = await readUtf8("styles.css");

  const headingSelectors = [
    /\.hero h1\s*\{([^}]*)\}/s,
    /\.section-heading h2,\s*\n\.projects-intro h2,\s*\n\.contact h2\s*\{([^}]*)\}/s
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
    /html:lang\(ja\)\s+:where\(\.section-heading h2,\s*\.projects-intro h2,\s*\.contact h2\)\s*\{\s*word-break:\s*keep-all;/,
    "Non-hero Japanese display headings must use word-break: keep-all so words don't split mid-character-group"
  );
  assert.match(
    stylesSource,
    /:where\(\.section-heading h2,\s*\.projects-intro h2,\s*\.contact h2\)\s*\{\s*hyphens:\s*auto;/,
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
  // The scroll-driven parallax was retired with the scene lifecycle. The
  // cap token remains the documented ceiling for any future revival, and
  // no script may quietly reintroduce the machinery.
  const tokensSource = await readUtf8("tokens.css");
  const scriptSource = await readUtf8("script.js");
  const stylesSource = await readUtf8("styles.css");

  assert.match(
    tokensSource,
    /--parallax-distance:\s*5px/,
    "The parallax cap token must stay at the reviewed 5px ceiling"
  );
  assert.doesNotMatch(
    scriptSource,
    /--parallax-y|--media-depth|--hero-depth|updateScrollMotion|armScrollMotion/,
    "script.js must not reintroduce scroll-driven depth machinery"
  );
  assert.doesNotMatch(
    stylesSource,
    /\.project-media img\s*\{[^}]*--parallax-y/s,
    "Media images must never translate on scroll"
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

test("the prototype composition is complete, ordered, and documented by the locked system", async () => {
  const indexHtml = await readUtf8("index.html");
  const designSource = await readUtf8("design.md");

  assert.match(
    indexHtml,
    /tokens\.css" \/>\s*<link rel="stylesheet" href="styles\.css" \/>\s*<link rel="stylesheet" href="modern\.css"/,
    "The stylesheet cascade must stay tokens -> styles -> modern"
  );

  // Section order is the prototype's: hero, marquee band, about, projects
  // (cards then panel), toolbox, contact.
  const order = [
    /<section class="hero" id="top"/,
    /<div class="hero-marquee"/,
    /<section class="about section-shell" id="about"/,
    /<section class="projects" id="projects"/,
    /<article\b[^>]*class="card wide"/,
    /class="panel"/,
    /<section class="stack section-shell" id="stack"/,
    /<section class="contact section-shell" id="contact"/
  ];
  let cursor = 0;
  for (const pattern of order) {
    const match = indexHtml.slice(cursor).search(pattern);
    assert.ok(match > -1, `Missing or out of order: ${pattern}`);
    cursor += match;
  }

  assert.match(
    designSource,
    /Marketing macrostructure · Feature Stack/,
    "design.md must keep the locked macrostructure record"
  );
  assert.match(
    designSource,
    /Footer · Ft5 statement composition/,
    "design.md must keep the locked footer record"
  );
});
test("scroll work is IntersectionObserver-driven with one batched fallback listener", async () => {
  const scriptSource = await readUtf8("script.js");

  // The retired scene lifecycle must not creep back in.
  assert.doesNotMatch(
    scriptSource,
    /data-scene|is-active-scene|refreshScrollScenes|setActiveScene|clearScrollMotionStyles/,
    "The viewport-scene lifecycle stays retired"
  );

  // Everything that reacts to position uses IntersectionObserver.
  const observers = [...scriptSource.matchAll(/new IntersectionObserver\(/g)];
  assert.ok(
    observers.length >= 3,
    "Scroll spy, reveal, and the compact header must each observe intersections"
  );

  // And the only scroll listener is the batched progress fallback.
  assert.equal(
    [...scriptSource.matchAll(/addEventListener\("scroll",/g)].length,
    1,
    "No per-element scroll listeners beyond the progress fallback"
  );
});
test("cards and panel keep the prototype grid at every breakpoint", async () => {
  const modernSource = await readUtf8("modern.css");
  const generatorSource = await readUtf8("scripts/generate-static-pages.mjs");

  // Card media precedes copy in source order, so mobile reads media-first.
  const cardsBody = generatorSource.slice(
    generatorSource.indexOf("export function renderProjectFeaturedCards")
  );
  assert.ok(
    cardsBody.indexOf('class="thumb"') < cardsBody.indexOf('class="body"'),
    "Card thumbs must precede card copy in source order"
  );

  assert.match(
    modernSource,
    /\.featured\s*\{[^}]*grid-template-columns:\s*1fr;/s,
    "Featured cards must stack in one column by default"
  );
  assert.match(
    modernSource,
    /@media \(min-width: 60rem\)\s*\{[\s\S]*?\.featured\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
    "Featured cards must advance to two columns on desktop"
  );
  assert.match(
    modernSource,
    /\.card\.wide\s*\{\s*grid-column:\s*1 \/ -1;/,
    "The wide card must span the featured grid"
  );
  assert.match(
    modernSource,
    /\.row\s*\{[^}]*grid-template-columns:\s*5\.2rem 1\.15fr 0\.8fr 1\.2fr auto;/s,
    "Panel rows must keep the prototype's five-column rhythm"
  );
  assert.match(
    modernSource,
    /@media \(max-width: 60rem\)\s*\{[\s\S]*?\.row\s*\{[^}]*grid-template-columns:\s*4\.6rem 1fr auto;/,
    "Rows must collapse type and stack below 60rem"
  );
  assert.match(
    modernSource,
    /@media \(max-width: 35rem\)\s*\{[\s\S]*?\.row\s*\{[^}]*grid-template-columns:\s*1fr auto;/,
    "Rows must drop the status column on narrow phones"
  );
});
test("modern typography preserves natural language wrapping and stable no-JS/reduced-motion flow", async () => {
  const modernSource = await readUtf8("modern.css");

  for (const selector of [".hero h1"]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rule = modernSource.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s"))?.[1];
    assert.ok(rule, `Expected modern heading rule for ${selector}`);
    assert.match(rule, /overflow-wrap:\s*break-word/);
    assert.match(rule, /text-wrap:\s*balance/);
    assert.doesNotMatch(rule, /overflow-wrap:\s*anywhere/);
  }
  // The scene machinery is gone: the resting layout is normal flow in every
  // mode, so no oversized chapter heights may exist to collapse. The hero is
  // the single full-viewport section, exactly as in the prototype.
  assert.doesNotMatch(
    modernSource,
    /min-height:\s*(?!100svh)[0-9]+svh/,
    "No cinematic chapter heights may exist — the resting layout is normal flow"
  );
  assert.match(
    modernSource,
    /\.hero\s*\{[^}]*min-height:\s*100svh;/s,
    "The hero must stay the one full-viewport section, as in the prototype"
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
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.button-primary\s*\{\s*transform:\s*none\s*!important;/,
    "Decorative CTA transforms must be removed under reduced motion"
  );
});

test("Ft5 footer is one truthful static statement with no active marquee lifecycle", async () => {
  const indexHtml = await readUtf8("index.html");
  const scriptSource = await readUtf8("script.js");

  assert.equal(
    [...indexHtml.matchAll(/<span class="footer-marquee-set"/g)].length,
    0,
    "The duplicated compatibility marquee markup is retired"
  );
  const footer = indexHtml.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/)?.[1] ?? "";
  assert.equal(
    [...footer.matchAll(/data-i18n="about\.statement"/g)].length,
    1,
    "The footer statement must be exactly one truthful line"
  );
  assert.doesNotMatch(
    scriptSource,
    /footerMarquee|armFooterMarquee|disarmFooterMarquee|syncFooterMarqueeActive|visibilitychange/,
    "No footer marquee lifecycle may exist in script.js"
  );

  // The hero marquee band is the one allowed continuous ribbon, and it must
  // freeze under reduced motion.
  const modernSource = await readUtf8("modern.css");
  assert.match(
    modernSource,
    /\.hero-marquee-track\s*\{[^}]*animation:\s*hero-marquee-slide/s,
    "The hero band carries the prototype's marquee"
  );
  assert.match(
    modernSource,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.hero-marquee-track\s*\{\s*animation:\s*none !important;/,
    "The hero marquee must freeze under reduced motion"
  );
});
