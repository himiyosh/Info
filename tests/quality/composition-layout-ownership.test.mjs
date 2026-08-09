import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

// The prototype composition reuses class names that the previous scene-era
// design also styled: .about, .about-copy, .projects-intro, .contact-panel.
// When the structure was replaced, those old layout declarations stayed
// behind and kept winning at desktop widths, which squeezed About's grid
// into one 263px track, put an empty screen above Projects, and split the
// centred Contact into two columns. Every contract stayed green because
// they all read CSS as text and none of them asked which element a rule
// actually lands on.
//
// This file pins ownership instead of appearance: the section shells carry
// no layout of their own, and the containers the prototype introduced are
// the ones that do. That is the property whose absence produced the defect.

const repoRoot = process.cwd();
const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

// A minimal rule walker. The stylesheets use no CSS nesting, so tracking
// at-rule preludes on a stack is enough to report where a rule lives.
function parseRules(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const atRules = [];
  let prelude = "";

  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];

    if (character === "{") {
      const heading = prelude.trim();
      prelude = "";
      if (heading.startsWith("@")) {
        atRules.push(heading);
        continue;
      }

      let depth = 1;
      let body = "";
      index += 1;
      while (index < css.length) {
        if (css[index] === "{") {
          depth += 1;
        } else if (css[index] === "}") {
          depth -= 1;
          if (depth === 0) {
            break;
          }
        }
        body += css[index];
        index += 1;
      }
      rules.push({
        body,
        context: atRules.join(" "),
        selectors: heading.split(",").map((selector) => selector.trim())
      });
      continue;
    }

    if (character === "}") {
      atRules.pop();
      prelude = "";
      continue;
    }

    prelude += character;
  }

  return rules;
}

// A shell is allowed to *cancel* layout — print and reduced-motion both
// flatten the page that way, and those resets are pinned by other
// contracts. What it may never do is *impose* a track, a height, or a
// sticky offset of its own. Only imposing values are violations.
const NEUTRALIZING = new Set([
  "0",
  "0px",
  "auto",
  "initial",
  "none",
  "normal",
  "revert",
  "static",
  "unset"
]);

function imposes({ value }) {
  const normalized = value.replace(/\s*!important\s*$/i, "").trim().toLowerCase();
  return !NEUTRALIZING.has(normalized);
}

function declarations(rules, selector, property) {
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "gi");
  return rules
    .filter((rule) => rule.selectors.includes(selector))
    .flatMap((rule) =>
      [...rule.body.matchAll(pattern)].map((match) => ({
        context: rule.context || "(top level)",
        value: match[1].trim()
      }))
    );
}

async function compositionRules() {
  const [styles, modern] = await Promise.all([readUtf8("styles.css"), readUtf8("modern.css")]);
  return [
    ...parseRules(styles).map((rule) => ({ ...rule, sheet: "styles.css" })),
    ...parseRules(modern).map((rule) => ({ ...rule, sheet: "modern.css" }))
  ];
}

test("section shells impose no layout of their own", async () => {
  const rules = await compositionRules();

  // Each entry is a shell whose children own the layout, paired with the
  // properties that must therefore never appear on the shell itself.
  const shells = [
    { selector: ".about", forbidden: ["grid-template-columns", "min-height"] },
    { selector: ".projects-intro", forbidden: ["grid-template-columns", "min-height", "align-content"] },
    { selector: ".contact-panel", forbidden: ["grid-template-columns"] }
  ];

  const violations = shells.flatMap(({ selector, forbidden }) =>
    forbidden.flatMap((property) =>
      declarations(rules, selector, property)
        .filter(imposes)
        .map(({ context, value }) => `${selector} { ${property}: ${value} } in ${context}`)
    )
  );

  assert.deepEqual(
    violations,
    [],
    "Layout belongs to .about-grid, .section-head, and the centred contact column"
  );
});

test("viewport-height scene padding is gone from the composition", async () => {
  const rules = await compositionRules();

  // 38svh of copy padding and a 165svh section were the scene machinery's
  // way of pacing a scroll story. The prototype paces itself with normal
  // block spacing, so any surviving svh sizing on these elements is the
  // old system leaking back in.
  const scenePaced = [".about", ".about-copy", ".projects-intro", ".contact-panel", ".section-head"];
  const properties = ["min-height", "padding-block", "padding-top", "padding-bottom", "height"];

  const violations = scenePaced.flatMap((selector) =>
    properties.flatMap((property) =>
      declarations(rules, selector, property)
        .filter(({ value }) => /\d(?:svh|vh|dvh|lvh)\b/.test(value))
        .map(({ context, value }) => `${selector} { ${property}: ${value} } in ${context}`)
    )
  );

  assert.deepEqual(violations, [], "The prototype composition must not be paced in viewport heights");
});

test("the About grid and its sticky heading own their own behaviour", async () => {
  const rules = await compositionRules();

  const gridColumns = declarations(rules, ".about-grid", "grid-template-columns");
  assert.ok(gridColumns.length >= 2, "Expected a base and a widened .about-grid track definition");
  assert.ok(
    gridColumns.some(({ value }) => value === "1fr"),
    "The narrow About grid must stack into one column"
  );
  const widened = gridColumns.find(({ value }) => /^1fr\s+1fr$/.test(value));
  assert.ok(widened, "The wide About grid must split into two equal columns");
  assert.match(
    widened.context,
    /min-width:\s*60rem/,
    "The two-column About grid must be introduced at the prototype's 60rem breakpoint"
  );

  const sticky = declarations(rules, ".about-sticky", "position");
  assert.ok(
    sticky.some(({ value }) => value === "sticky"),
    "The About heading sticks through .about-sticky, not through .about .section-heading"
  );
  assert.deepEqual(
    declarations(rules, ".about .section-heading", "position").filter(imposes),
    [],
    "The retired scene selector must not position the heading any more"
  );
});

test("both generated routes render the containers that own the layout", async () => {
  for (const outputPath of ["index.html", "en/index.html"]) {
    const html = await readUtf8(outputPath);
    for (const marker of [
      'class="about-grid"',
      'class="section-heading about-sticky"',
      'class="section-head"',
      'class="contact-panel"'
    ]) {
      assert.ok(
        html.includes(marker),
        `${outputPath} must render ${marker} for the layout contracts above to apply`
      );
    }
  }
});
