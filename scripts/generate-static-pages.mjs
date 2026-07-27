#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { translations } = require("../i18n.js");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(repoRoot, "templates/index.html");
const checkOnly = process.argv.includes("--check");
const canonicalRoot = "https://himiyosh.github.io/Info/";
export const pages = [
  {
    language: "ja",
    alternateLanguage: "en",
    alternatePath: "en/",
    canonicalUrl: canonicalRoot,
    outputPath: "index.html",
    siteRoot: ""
  },
  {
    language: "en",
    alternateLanguage: "ja",
    alternatePath: "../",
    canonicalUrl: `${canonicalRoot}en/`,
    outputPath: "en/index.html",
    siteRoot: "../"
  }
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderPage(template, page) {
  let output = template.replace(/\{\{t:([a-zA-Z0-9.]+)\}\}/g, (_match, key) => {
    const value = key
      .split(".")
      .reduce((result, part) => result?.[part], translations[page.language]);
    if (typeof value !== "string") {
      throw new Error(`Missing ${page.language} translation for template key: ${key}`);
    }
    return escapeHtml(value);
  });

  for (const [key, value] of Object.entries(page)) {
    output = output.replaceAll(`{{${key}}}`, escapeHtml(value));
  }

  const unresolved = [...output.matchAll(/\{\{([^}]+)\}\}/g)].map((match) => match[1]);
  if (unresolved.length > 0) {
    throw new Error(
      `Unresolved template values for ${page.outputPath}: ${[...new Set(unresolved)].join(", ")}`
    );
  }

  return output.replace(
    "<!DOCTYPE html>",
    "<!DOCTYPE html>\n<!-- Generated from templates/index.html and i18n.js. Run npm run generate:pages. -->"
  );
}

export async function main() {
  if (!translations?.ja || !translations?.en) {
    throw new Error("i18n.js must export Japanese and English translations.");
  }

  const template = await readFile(templatePath, "utf8");
  const staleOutputs = [];

  for (const page of pages) {
    const outputPath = path.join(repoRoot, page.outputPath);
    const expected = renderPage(template, page);

    if (checkOnly) {
      const actual = await readFile(outputPath, "utf8").catch((error) => {
        if (error.code === "ENOENT") {
          return null;
        }
        throw error;
      });
      if (actual !== expected) {
        staleOutputs.push(page.outputPath);
      }
      continue;
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, expected, "utf8");
  }

  if (staleOutputs.length > 0) {
    throw new Error(
      `Generated page drift detected: ${staleOutputs.join(", ")}. Run npm run generate:pages.`
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
