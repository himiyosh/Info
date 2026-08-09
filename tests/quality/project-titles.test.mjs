import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

// Extracted from the retired project-directory contract. These two tests are
// about projects.json itself, not about how the catalogue is laid out, so they
// outlive the directory component they used to travel with.

const repoRoot = process.cwd();
const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

function assertUniqueLocalizedProjectTitles(projects) {
  for (const language of ["ja", "en"]) {
    const entriesByTitle = new Map();
    projects.forEach((project, index) => {
      const title = project.title[language];
      const entries = entriesByTitle.get(title) ?? [];
      entries.push(`projects[${index}] (${project.slug})`);
      entriesByTitle.set(title, entries);
    });

    for (const [title, entries] of entriesByTitle) {
      if (entries.length > 1) {
        assert.fail(
          `Duplicate project title.${language} ${JSON.stringify(title)} in ${entries.join(", ")}.`
        );
      }
    }
  }
}

test("canonical project titles are unique within each language", async () => {
  const projects = JSON.parse(await readUtf8("projects.json"));
  assertUniqueLocalizedProjectTitles(projects);
});

test("localized project title uniqueness reports the language, value, and entries", () => {
  const crossLocaleMatch = [
    { slug: "alpha", title: { ja: "共通", en: "Alpha" } },
    { slug: "beta", title: { ja: "ベータ", en: "共通" } }
  ];
  assert.doesNotThrow(() => assertUniqueLocalizedProjectTitles(crossLocaleMatch));

  const duplicateJapaneseTitle = [
    { slug: "alpha", title: { ja: "重複", en: "Alpha" } },
    { slug: "beta", title: { ja: "重複", en: "Beta" } }
  ];
  assert.throws(
    () => assertUniqueLocalizedProjectTitles(duplicateJapaneseTitle),
    /Duplicate project title\.ja "重複" in projects\[0\] \(alpha\), projects\[1\] \(beta\)\./
  );

  const duplicateEnglishTitle = [
    { slug: "alpha", title: { ja: "アルファ", en: "Duplicate" } },
    { slug: "beta", title: { ja: "ベータ", en: "Duplicate" } }
  ];
  assert.throws(
    () => assertUniqueLocalizedProjectTitles(duplicateEnglishTitle),
    /Duplicate project title\.en "Duplicate" in projects\[0\] \(alpha\), projects\[1\] \(beta\)\./
  );
});
