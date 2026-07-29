import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

const repoRoot = process.cwd();
const translatedStaticAttributes = [
  ["data-i18n-content", "content"],
  ["data-i18n-alt", "alt"],
  ["data-i18n-aria-label", "aria-label"]
];
const namedHtmlEntities = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", "\u00a0"],
  ["quot", "\""]
]);

const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

function flattenStringLeafKeys(value, prefix = "") {
  if (typeof value === "string") {
    return [prefix];
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return flattenStringLeafKeys(child, nextPrefix);
  });
}

function getByPath(value, keyPath) {
  return keyPath.split(".").reduce((current, key) => current?.[key], value);
}

function extractObjectLiteral(sourceText, declarationPrefix) {
  const declarationIndex = sourceText.indexOf(declarationPrefix);
  if (declarationIndex === -1) {
    throw new Error(`Could not find declaration prefix: ${declarationPrefix}`);
  }

  const objectStart = sourceText.indexOf("{", declarationIndex);
  if (objectStart === -1) {
    throw new Error(`Could not find object literal for declaration: ${declarationPrefix}`);
  }

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = objectStart; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    const next = sourceText[index + 1];
    const previous = sourceText[index - 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (previous === "*" && char === "/") {
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingle && !inDouble && !inTemplate) {
      if (char === "/" && next === "/") {
        inLineComment = true;
        index += 1;
        continue;
      }
      if (char === "/" && next === "*") {
        inBlockComment = true;
        index += 1;
        continue;
      }
    }

    if (inSingle) {
      if (char === "'" && previous !== "\\") {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      if (char === '"' && previous !== "\\") {
        inDouble = false;
      }
      continue;
    }

    if (inTemplate) {
      if (char === "`" && previous !== "\\") {
        inTemplate = false;
      }
      continue;
    }

    if (char === "'") {
      inSingle = true;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      continue;
    }

    if (char === "`") {
      inTemplate = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return sourceText.slice(objectStart, index + 1);
      }
    }
  }

  throw new Error(`Could not close object literal for declaration: ${declarationPrefix}`);
}

function parseTranslations(sourceText) {
  const translationLiteral = extractObjectLiteral(sourceText, "const translations =");
  return vm.runInNewContext(`(${translationLiteral})`, Object.create(null), {
    timeout: 1000
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readHtmlAttribute(tag, attribute) {
  const attributePattern = new RegExp(
    `\\s${escapeRegExp(attribute)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i"
  );
  const match = tag.match(attributePattern);
  return match ? match[1] ?? match[2] : undefined;
}

function decodeHtmlEntities(value) {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (entity, decimal, hexadecimal, named) => {
      if (named) {
        return namedHtmlEntities.get(named.toLowerCase()) ?? entity;
      }

      const codePoint = Number.parseInt(
        decimal ?? hexadecimal,
        decimal === undefined ? 16 : 10
      );
      return codePoint <= 0x10ffff &&
        (codePoint < 0xd800 || codePoint > 0xdfff)
        ? String.fromCodePoint(codePoint)
        : entity;
    }
  );
}

function normalizeHtmlWhitespace(value) {
  return value
    .replace(/[\t\n\f\r ]+/g, " ")
    .replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
}

function normalizeStaticFallback(value) {
  return normalizeHtmlWhitespace(decodeHtmlEntities(value.replace(/<[^>]*>/g, "")));
}

function extractStaticI18nFallbacks(sourceText) {
  const fallbacks = [];

  for (const openingTagMatch of sourceText.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)) {
    const [openingTag, tagName] = openingTagMatch;
    const textKey = readHtmlAttribute(openingTag, "data-i18n");
    if (textKey !== undefined) {
      const contentStart = openingTagMatch.index + openingTag.length;
      const closingTagPattern = new RegExp(`</${escapeRegExp(tagName)}\\s*>`, "gi");
      closingTagPattern.lastIndex = contentStart;
      const closingTagMatch = closingTagPattern.exec(sourceText);
      fallbacks.push({
        marker: "data-i18n",
        target: "text content",
        key: textKey,
        value: closingTagMatch
          ? sourceText.slice(contentStart, closingTagMatch.index)
          : undefined
      });
    }

    for (const [marker, target] of translatedStaticAttributes) {
      const key = readHtmlAttribute(openingTag, marker);
      if (key !== undefined) {
        fallbacks.push({
          marker,
          target,
          key,
          value: readHtmlAttribute(openingTag, target)
        });
      }
    }
  }

  return fallbacks;
}

test("i18n key parity, references, and Japanese static fallbacks are complete", async () => {
  const i18nSource = await readUtf8("i18n.js");
  const translations = parseTranslations(i18nSource);

  const jaKeys = new Set(flattenStringLeafKeys(translations.ja));
  const enKeys = new Set(flattenStringLeafKeys(translations.en));

  assert.deepEqual(
    [...jaKeys].sort(),
    [...enKeys].sort(),
    "Japanese and English translation key sets must match"
  );

  const indexHtml = await readUtf8("index.html");
  const attributePatterns = [
    /data-i18n="([^"]+)"/g,
    /data-i18n-content="([^"]+)"/g,
    /data-i18n-alt="([^"]+)"/g,
    /data-i18n-aria-label="([^"]+)"/g
  ];

  const referencedKeys = new Set();
  for (const pattern of attributePatterns) {
    for (const match of indexHtml.matchAll(pattern)) {
      referencedKeys.add(match[1]);
    }
  }

  for (const key of referencedKeys) {
    assert.equal(typeof getByPath(translations.ja, key), "string", `Missing ja translation for "${key}"`);
    assert.equal(typeof getByPath(translations.en, key), "string", `Missing en translation for "${key}"`);
  }

  const staticFallbacks = extractStaticI18nFallbacks(indexHtml);
  const requiredMarkers = [
    "data-i18n",
    "data-i18n-content",
    "data-i18n-alt",
    "data-i18n-aria-label"
  ];
  for (const marker of requiredMarkers) {
    assert.ok(
      staticFallbacks.some((fallback) => fallback.marker === marker),
      `index.html must contain a ${marker} fallback`
    );
  }

  for (const { key, marker, target, value } of staticFallbacks) {
    const japaneseTranslation = getByPath(translations.ja, key);
    assert.equal(
      typeof japaneseTranslation,
      "string",
      `Missing ja translation for static ${marker} key "${key}"`
    );
    assert.notEqual(
      value,
      undefined,
      `Static ${target} fallback for "${key}" must be present`
    );
    assert.equal(
      normalizeStaticFallback(value),
      normalizeHtmlWhitespace(japaneseTranslation),
      `Static ${target} fallback for "${key}" must match its Japanese translation`
    );
  }
});

test("Japanese running prose uses progressive phrase-aware line breaking", async () => {
  const stylesSource = await readUtf8("styles.css");
  const fallbackRule = stylesSource.match(
    /html:lang\(ja\)\s+:where\(\s*\.hero-lede,[\s\S]*?\.footer-disclaimer\s*\)\s*\{([^}]*)\}/
  );

  assert.ok(fallbackRule, "Japanese running prose must have an explicit fallback rule");
  assert.match(
    fallbackRule[1],
    /line-break:\s*strict/,
    "Japanese running prose must use strict Japanese line-breaking rules"
  );
  assert.match(
    fallbackRule[1],
    /word-break:\s*normal/,
    "Japanese running prose must retain a safe word-break fallback"
  );
  assert.match(
    stylesSource,
    /@supports\s*\(word-break:\s*auto-phrase\)\s*\{[\s\S]*?html:lang\(ja\)\s+:where\([\s\S]*?\.footer-disclaimer\s*\)\s*\{[^}]*word-break:\s*auto-phrase/,
    "Japanese running prose must progressively enable auto-phrase where supported"
  );
  assert.doesNotMatch(
    fallbackRule[0],
    /(?:^|[\s,.])(a|button|h[1-6]|code|\.project-stack)(?:[\s,.)]|$)/,
    "Phrase-aware wrapping must not target links, controls, headings, code, or stack text"
  );
});

test("protected Japanese phrase boundaries match between static and translated copy", async () => {
  const indexHtml = await readUtf8("index.html");
  const i18nSource = await readUtf8("i18n.js");
  const translations = parseTranslations(i18nSource);
  const expectedHero =
    "課題を解き、学びを分かち合う。好奇心を実用へつなぐ、himiyosh\u00a0のポートフォリオです。";
  const expectedAbout =
    "某グローバルIT企業で、テクノロジー領域の課題解決に取り組\u2060んでいます。役に立つ知識や技術を見つけ、試し、分かりやすい形にすることが好きです。";

  assert.ok(
    indexHtml.includes(expectedHero),
    "Static hero copy must protect the himiyosh の boundary with an NBSP"
  );
  assert.ok(
    indexHtml.includes(expectedAbout),
    "Static About copy must protect the observed Japanese phrase boundary with a word joiner"
  );
  assert.equal(
    translations.ja.hero.lede,
    expectedHero,
    "Translated hero copy must match the rendered static copy"
  );
  assert.equal(
    translations.ja.about.content,
    expectedAbout,
    "Translated About copy must match the rendered static copy"
  );
});
