import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();

const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

function getAttribute(openingTag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attributeMatch = openingTag.match(
    new RegExp(`\\s${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "i")
  );
  return attributeMatch?.[2] ?? null;
}

function getElementsById(sourceText) {
  const elementsById = new Map();
  for (const match of sourceText.matchAll(/<([a-z][\w-]*)\b[^>]*>/gi)) {
    const [openingTag, tagName] = match;
    const id = getAttribute(openingTag, "id");
    if (id) {
      elementsById.set(id, { openingTag, tagName: tagName.toLowerCase() });
    }
  }
  return elementsById;
}

test("same-page anchor destinations are programmatically focusable", async () => {
  const indexHtml = await readUtf8("index.html");
  const elementsById = getElementsById(indexHtml);
  const anchorTargets = new Set(
    [...indexHtml.matchAll(/<a\b[^>]*\bhref=(["'])#([^"']+)\1[^>]*>/gi)].map(
      (match) => match[2]
    )
  );

  assert.ok(anchorTargets.has("main-content"), "Skip link must target the main landmark");
  assert.ok(anchorTargets.size > 1, "Expected same-page navigation links in index.html");

  for (const targetId of anchorTargets) {
    const target = elementsById.get(targetId);
    assert.ok(target, `Anchor target "#${targetId}" must exist`);
    assert.equal(
      getAttribute(target.openingTag, "tabindex"),
      "-1",
      `Anchor target "#${targetId}" must accept programmatic focus`
    );
  }

  const mainContent = elementsById.get("main-content");
  assert.equal(mainContent?.tagName, "main", "Skip link target must remain the main landmark");

  const sectionTargets = [...indexHtml.matchAll(/<section\b[^>]*\bid=(["'])([^"']+)\1[^>]*>/gi)];
  assert.ok(sectionTargets.length > 0, "Expected anchored content sections in index.html");
  for (const [openingTag, , sectionId] of sectionTargets) {
    assert.equal(
      getAttribute(openingTag, "tabindex"),
      "-1",
      `Section "#${sectionId}" must accept native fragment-navigation focus`
    );
  }
});
