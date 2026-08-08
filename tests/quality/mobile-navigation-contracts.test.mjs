import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();

const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

test("mobile navigation enhancement is progressive and keeps no-JS links usable", async () => {
  const indexHtml = await readUtf8("index.html");
  const scriptSource = await readUtf8("script.js");
  const stylesSource = await readUtf8("styles.css");

  const enhancementScriptPattern =
    /<script>\s*document\.documentElement\.classList\.add\("js-enabled"\);\s*<\/script>/;
  assert.match(
    indexHtml,
    enhancementScriptPattern,
    "index.html must set js-enabled synchronously in head to avoid no-JS flash"
  );
  const enhancementScriptIndex = indexHtml.search(enhancementScriptPattern);
  const stylesheetIndex = indexHtml.indexOf('<link rel="stylesheet" href="styles.css" />');
  assert.ok(enhancementScriptIndex !== -1, "Head enhancement script must exist");
  assert.ok(stylesheetIndex !== -1, "Stylesheet link must exist");
  assert.ok(
    enhancementScriptIndex < stylesheetIndex,
    "Head enhancement script must appear before styles.css"
  );
  assert.doesNotMatch(
    scriptSource,
    /classList\.add\("js-enabled"\)/,
    "script.js should not be responsible for late js-enabled class mutation"
  );
  assert.match(
    stylesSource,
    /html:not\(\.js-enabled\)\s+\.nav-menu/,
    "styles.css must define no-JS nav menu behavior"
  );
  assert.match(
    stylesSource,
    /@media\s*\(min-width:\s*48rem\)[\s\S]*\.js-enabled\s+\.nav-menu/,
    "styles.css must provide desktop reset with js-enabled selector specificity"
  );
  assert.match(
    stylesSource,
    /\.js-enabled\s+\.nav-menu\s*\{[\s\S]*?visibility:\s*hidden[\s\S]*?visibility\s+0s\s+linear\s+var\(--dur-short\)/,
    "Closed enhanced navigation must become hidden after its exit animation"
  );
  assert.match(
    stylesSource,
    /\.js-enabled\s+\.nav-menu\.active\s*\{[\s\S]*?visibility:\s*visible[\s\S]*?transition-delay:\s*0s/,
    "Opened enhanced navigation must become immediately visible before it receives focus"
  );
  const desktopNavOverride = stylesSource.match(
    /@media\s*\(min-width:\s*48rem\)\s*\{[\s\S]*?\.js-enabled\s+\.nav-menu,\s*\.nav-menu\s*\{([^}]*)\}/
  )?.[1];
  assert.ok(desktopNavOverride, "Desktop navigation override must exist");
  assert.match(
    desktopNavOverride,
    /visibility:\s*visible/,
    "Desktop navigation override must reset mobile disclosure visibility"
  );
  assert.ok(
    /<nav[\s\S]*id="nav-menu"[\s\S]*?<a href="#about"[\s\S]*?<a href="#projects"[\s\S]*?<a href="#contact"/i.test(
      indexHtml
    ),
    "Primary nav links must be present directly in markup"
  );
});

test("open mobile navigation wraps keyboard focus at its disclosure boundaries", async () => {
  const scriptSource = await readUtf8("script.js");

  assert.match(
    scriptSource,
    /function isMobileMenuActive\(\)\s*\{[\s\S]*mobileNavigation\.matches[\s\S]*navMenu\.classList\.contains\("active"\)[\s\S]*hamburgerMenu\.getAttribute\("aria-expanded"\)\s*===\s*"true"/,
    "Focus containment must be limited to the active, expanded mobile navigation"
  );
  assert.match(
    scriptSource,
    /if\s*\(event\.key\s*!==\s*"Tab"\s*\|\|\s*!isMobileMenuActive\(\)\)\s*\{\s*return;/,
    "Non-Tab keys and inactive or desktop navigation must bypass focus containment"
  );
  assert.match(
    scriptSource,
    /navMenu\.querySelectorAll\(menuFocusableSelector\)/,
    "Focus containment must derive enabled menu controls in DOM order"
  );
  assert.match(
    scriptSource,
    /!element\.matches\(":disabled"\)[\s\S]*element\.getAttribute\("aria-disabled"\)\s*!==\s*"true"/,
    "Native-disabled and aria-disabled menu controls must be excluded from the focus cycle"
  );
  assert.match(
    scriptSource,
    /event\.shiftKey\s*&&\s*document\.activeElement\s*===\s*hamburgerMenu[\s\S]*event\.preventDefault\(\);[\s\S]*lastMenuControl\.focus\(\);/,
    "Shift+Tab from the disclosure toggle must wrap to the last menu control"
  );
  assert.match(
    scriptSource,
    /!event\.shiftKey\s*&&\s*document\.activeElement\s*===\s*lastMenuControl[\s\S]*event\.preventDefault\(\);[\s\S]*hamburgerMenu\.focus\(\);/,
    "Tab from the last menu control must wrap to the disclosure toggle"
  );
});

test("modern mobile navigation stays scroll-contained in short safe-area viewports", async () => {
  const modernSource = await readUtf8("modern.css");
  const mobileRule = modernSource.match(/\.js-enabled \.nav-menu\s*\{([^}]*)\}/s)?.[1];
  const desktopBlock = modernSource.match(
    /@media \(min-width: 48rem\) \{([\s\S]*?)\}\s*@media \(prefers-reduced-motion: reduce\)/
  )?.[1];

  assert.ok(mobileRule, "modern.css must define the enhanced mobile navigation");
  assert.match(
    mobileRule,
    /inset-inline:\s*max\(var\(--space-sm\),\s*env\(safe-area-inset-left\)\)\s*max\(var\(--space-sm\),\s*env\(safe-area-inset-right\)\)/,
    "The disclosure must keep both landscape safe areas clear"
  );
  assert.match(
    mobileRule,
    /max-block-size:\s*max\([\s\S]*?100dvh[\s\S]*?env\(safe-area-inset-bottom\)[\s\S]*?\);/,
    "The disclosure must be bounded by the dynamic viewport and bottom safe area"
  );
  assert.match(mobileRule, /overflow-y:\s*auto;/, "Short disclosures must scroll internally");
  assert.match(
    mobileRule,
    /overscroll-behavior:\s*contain;/,
    "Menu scrolling must not chain into the page"
  );
  assert.match(
    mobileRule,
    /scroll-padding-block:\s*var\(--space-xs\);/,
    "Keyboard focus scrolling must reserve room for the offset ring"
  );
  assert.match(
    modernSource,
    /\.js-enabled \.nav-menu :where\(a, button\)\s*\{\s*scroll-margin-block:\s*var\(--space-xs\);/,
    "Each menu control must request focus-ring clearance when scrolled"
  );

  assert.ok(desktopBlock, "modern.css must define the desktop navigation reset");
  assert.match(
    desktopBlock,
    /\.js-enabled \.nav-menu,\s*\.nav-menu\s*\{[^}]*max-block-size:\s*none;[^}]*overflow-y:\s*visible;[^}]*overscroll-behavior:\s*auto;/s,
    "Desktop navigation must reset mobile containment"
  );
});
