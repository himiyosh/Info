import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();

const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

// OKLCH -> linear sRGB -> WCAG relative luminance, used to compute real
// contrast ratios for token pairs below (not string-only checks).
function parseOklchTokens(tokensSource) {
  const tokens = new Map();
  const tokenPattern = /(--color-[a-z0-9-]+):\s*oklch\((\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\)/g;
  for (const match of tokensSource.matchAll(tokenPattern)) {
    const [, name, l, c, h] = match;
    tokens.set(name, [Number(l) / 100, Number(c), Number(h)]);
  }
  return tokens;
}

function relativeLuminanceFromOklch([L, C, Hdeg]) {
  const hRad = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(bl);
}

function oklchContrastRatio(tokenA, tokenB) {
  const la = relativeLuminanceFromOklch(tokenA);
  const lb = relativeLuminanceFromOklch(tokenB);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

test("final modern focus-ring overrides match the actual project and contact surfaces", async () => {
  const stylesSource = await readUtf8("styles.css");
  const modernSource = await readUtf8("modern.css");

  const finalFocusRule = modernSource.match(
    /\.projects-list \.project-row :where\(a, button\):focus-visible,\s*\.contact-panel :where\(a, button\):focus-visible\s*\{\s*outline-color:\s*var\(--color-focus\);\s*\}/
  );
  assert.ok(
    finalFocusRule,
    "modern.css must override both project and contact focus rings with --color-focus"
  );

  assert.match(
    stylesSource,
    /\.js-enabled \.nav-menu :focus-visible:not\(\.language-toggle\)/,
    "on-dark override must keep excluding .language-toggle so it falls through to the default focus ring"
  );
});

test("focus-ring / backdrop token pairings meet WCAG 1.4.11 non-text contrast (>= 3:1)", async () => {
  const tokensSource = await readUtf8("tokens.css");
  const tokens = parseOklchTokens(tokensSource);

  const required = [
    "--color-focus",
    "--color-accent-ink",
    "--color-on-dark",
    "--color-paper",
    "--color-paper-2",
    "--color-paper-3",
    "--color-surface",
    "--color-scene-hero",
    "--color-scene-projects",
    "--color-project-a",
    "--color-project-b",
    "--color-accent",
    "--color-accent-2"
  ];
  for (const name of required) {
    assert.ok(tokens.has(name), `Expected ${name} to be defined as oklch(...) in tokens.css`);
  }

  // Final ring/backdrop pairings after modern.css overrides the legacy
  // surface system. These use the ancestor under the 3px offset ring, not
  // the control's own fill.
  const pairings = [
    { label: ".menu-toggle ring vs resting header", ring: "--color-focus", backdrop: "--color-paper-2" },
    { label: ".menu-toggle ring vs compact header", ring: "--color-focus", backdrop: "--color-surface" },
    { label: ".button-primary ring vs hero scene", ring: "--color-focus", backdrop: "--color-scene-hero" },
    { label: ".retry-button ring vs projects scene", ring: "--color-focus", backdrop: "--color-scene-projects" },
    { label: ".language-toggle ring vs mobile nav", ring: "--color-focus", backdrop: "--color-paper-2" },
    { label: ".language-toggle ring vs compact desktop header", ring: "--color-focus", backdrop: "--color-surface" },
    { label: ".nav link ring vs mobile nav", ring: "--color-on-dark", backdrop: "--color-paper-2" },
    { label: ".nav link ring vs compact desktop header", ring: "--color-on-dark", backdrop: "--color-surface" },
    { label: ".project-row odd ring vs final project-a", ring: "--color-focus", backdrop: "--color-project-a" },
    { label: ".project-row even ring vs final project-b", ring: "--color-focus", backdrop: "--color-project-b" },
    { label: ".contact-panel ring vs final surface", ring: "--color-focus", backdrop: "--color-surface" }
  ];

  for (const { label, ring, backdrop } of pairings) {
    const ratio = oklchContrastRatio(tokens.get(ring), tokens.get(backdrop));
    assert.ok(
      ratio >= 3,
      `${label} must meet >= 3:1 non-text contrast, got ${ratio.toFixed(2)}:1`
    );
  }
});

test("increased contrast strengthens muted roles and UI boundaries without changing the base theme", async () => {
  const [tokensSource, modernSource] = await Promise.all([
    readUtf8("tokens.css"),
    readUtf8("modern.css")
  ]);
  const mediaMarker = "@media screen and (prefers-contrast: more)";
  const mediaIndex = tokensSource.indexOf(mediaMarker);
  assert.notEqual(
    mediaIndex,
    -1,
    "tokens.css must define a screen-only prefers-contrast: more contract"
  );

  const normalTokens = parseOklchTokens(tokensSource.slice(0, mediaIndex));
  const contrastTokens = parseOklchTokens(tokensSource.slice(mediaIndex));
  for (const name of [
    "--color-ink-2",
    "--color-muted",
    "--color-rule",
    "--color-focus"
  ]) {
    assert.ok(normalTokens.has(name), `Expected base token ${name}`);
    assert.ok(contrastTokens.has(name), `Expected contrast override ${name}`);
  }

  const pairings = [
    {
      label: "directory kinds",
      foreground: "--color-muted",
      background: "--color-scene-projects",
      minimum: 4.5
    },
    {
      label: "captions",
      foreground: "--color-ink-2",
      background: "--color-surface",
      minimum: 4.5
    },
    {
      label: "proof labels and evidence links",
      foreground: "--color-ink-2",
      background: "--color-project-a",
      minimum: 4.5
    },
    {
      label: "secondary project links",
      foreground: "--color-ink-2",
      background: "--color-project-b",
      minimum: 4.5
    },
    {
      label: "rules and control boundaries",
      foreground: "--color-rule",
      background: "--color-surface",
      minimum: 3
    },
    {
      label: "directory rules",
      foreground: "--color-rule",
      background: "--color-scene-projects",
      minimum: 3
    },
    {
      label: "focus boundaries",
      foreground: "--color-focus",
      background: "--color-scene-projects",
      minimum: 3
    }
  ];

  for (const { label, foreground, background, minimum } of pairings) {
    const normal = oklchContrastRatio(
      normalTokens.get(foreground),
      normalTokens.get(background)
    );
    const increased = oklchContrastRatio(
      contrastTokens.get(foreground),
      normalTokens.get(background)
    );
    assert.ok(
      increased >= minimum,
      `${label} must reach ${minimum}:1, got ${increased.toFixed(2)}:1`
    );
    assert.ok(
      increased >= normal + 0.25,
      `${label} must improve by at least 0.25, got ${normal.toFixed(2)}:1 -> ${increased.toFixed(2)}:1`
    );
  }

  assert.match(
    modernSource,
    /\.project-directory-kind\s*\{[^}]*color:\s*var\(--color-muted\)/s
  );
  assert.match(
    modernSource,
    /\.project-proof-label,\s*\.project-link--evidence\s*\{[^}]*color:\s*var\(--color-ink-2\)/s
  );
  assert.match(
    modernSource,
    /\.projects-list \.project-row :where\(a, button\):focus-visible,[^}]*outline-color:\s*var\(--color-focus\)/s
  );
});
