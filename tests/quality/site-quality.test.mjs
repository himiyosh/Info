import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

const repoRoot = process.cwd();
const retiredPortfolioPreviewSha256 =
  "34ef4fb416975ff4e3e4b0a766e922d49f4679b16dc96b3413d155a99508d095";
const qualityWorkflowPath = ".github/workflows/quality-baseline.yml";
const pagesWorkflowPath = ".github/workflows/pages.yml";
const pagesWhitelistPath = ".github/pages-artifact-whitelist.txt";
const projectPreviewAvifBaselineBytes = 554_001;
const projectPreviewAvifMaximumBytes = 200_000;
const projectPreviewMinimumSavingsRatio = 0.6;
const projectPreviewDesktopJpegBaselineBytes = 551_363;
const projectPreviewDesktopAvifMaximumRatio = 0.5;
const projectPreviewDesktopMedia = "(min-width: 48rem)";
const projectPreviewMobileMedia = "(max-width: 47.999rem)";
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

function attributeValue(tag, attributeName) {
  return tag.match(new RegExp(`\\b${attributeName}="([^"]*)"`))?.[1];
}

function parseSrcsetEntries(srcset) {
  return srcset.split(",").map((entry) => {
    const match = entry.trim().match(/^(\S+)\s+(\d+)w$/);
    assert.ok(match, `srcset entry must use a width descriptor: ${entry}`);
    return { source: match[1], width: Number(match[2]) };
  });
}

function jpegDimensions(buffer) {
  assert.equal(buffer.readUInt16BE(0), 0xffd8, "JPEG asset must start with an SOI marker");

  let offset = 2;
  while (offset < buffer.length) {
    while (buffer[offset] === 0xff) {
      offset += 1;
    }

    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3)
      };
    }
    offset += segmentLength;
  }

  assert.fail("JPEG asset must contain a Start of Frame marker");
}

function avifDimensions(buffer) {
  assert.equal(
    buffer.subarray(4, 8).toString("ascii"),
    "ftyp",
    "AVIF asset must start with an ISO Base Media File Type box"
  );
  const fileTypeBoxSize = buffer.readUInt32BE(0);
  const brands = [
    buffer.subarray(8, 12).toString("ascii"),
    ...Array.from(
      { length: Math.max(0, Math.floor((fileTypeBoxSize - 16) / 4)) },
      (_, index) => buffer.subarray(16 + index * 4, 20 + index * 4).toString("ascii")
    )
  ];
  assert.ok(
    brands.includes("avif") || brands.includes("avis"),
    "AVIF asset must declare the avif or avis brand"
  );

  // Odd-height AVIFs can pad ispe while clap records the displayed aperture.
  const cleanApertureBox = Buffer.from("clap");
  let typeOffset = buffer.indexOf(cleanApertureBox);

  while (typeOffset !== -1) {
    const boxOffset = typeOffset - 4;
    const boxSize = buffer.readUInt32BE(boxOffset);
    if (boxSize >= 40 && typeOffset + 36 <= buffer.length) {
      const widthNumerator = buffer.readUInt32BE(typeOffset + 4);
      const widthDenominator = buffer.readUInt32BE(typeOffset + 8);
      const heightNumerator = buffer.readUInt32BE(typeOffset + 12);
      const heightDenominator = buffer.readUInt32BE(typeOffset + 16);
      const width = widthNumerator / widthDenominator;
      const height = heightNumerator / heightDenominator;
      if (
        widthDenominator > 0 &&
        heightDenominator > 0 &&
        Number.isInteger(width) &&
        Number.isInteger(height) &&
        width > 0 &&
        height > 0
      ) {
        return { width, height };
      }
    }
    typeOffset = buffer.indexOf(cleanApertureBox, typeOffset + 4);
  }

  const spatialExtentsBox = Buffer.from("ispe");
  typeOffset = buffer.indexOf(spatialExtentsBox);

  while (typeOffset !== -1) {
    const boxOffset = typeOffset - 4;
    const boxSize = buffer.readUInt32BE(boxOffset);
    if (boxSize >= 20 && typeOffset + 16 <= buffer.length) {
      const width = buffer.readUInt32BE(typeOffset + 8);
      const height = buffer.readUInt32BE(typeOffset + 12);
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
    typeOffset = buffer.indexOf(spatialExtentsBox, typeOffset + 4);
  }

  assert.fail("AVIF asset must contain an Image Spatial Extents box");
}

async function imageDimensions(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  if (/\.avif$/i.test(relativePath)) {
    return avifDimensions(buffer);
  }
  if (/\.jpe?g$/i.test(relativePath)) {
    return jpegDimensions(buffer);
  }
  assert.fail(`Unsupported responsive image format: ${relativePath}`);
}

function parseWhitelistEntries(sourceText) {
  return sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

function topLevelPath(filePath) {
  return filePath.split("/")[0];
}

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

function localPathFromReference(reference) {
  if (
    !reference ||
    reference.startsWith("#") ||
    reference.startsWith("mailto:") ||
    reference.startsWith("tel:") ||
    reference.startsWith("data:") ||
    reference.startsWith("javascript:")
  ) {
    return null;
  }

  if (/^https?:\/\//i.test(reference)) {
    return null;
  }

  return reference.replace(/^\.\//, "");
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

function extractFunctionDeclaration(sourceText, functionName) {
  const declarationPrefix = `function ${functionName}`;
  const declarationIndex = sourceText.indexOf(declarationPrefix);
  if (declarationIndex === -1) {
    throw new Error(`Could not find function declaration: ${functionName}`);
  }
  const bodyIndex = sourceText.indexOf("{", declarationIndex);
  const body = extractObjectLiteral(sourceText, declarationPrefix);
  return `${sourceText.slice(declarationIndex, bodyIndex)}${body}`;
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

async function listFilesRecursively(rootDirectory) {
  const results = [];
  const entries = await readdir(rootDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(rootDirectory, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFilesRecursively(absolutePath);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(absolutePath);
    }
  }

  return results;
}

test("JavaScript files are parseable", async () => {
  const javascriptFiles = ["i18n.js", "script.js"];
  for (const filePath of javascriptFiles) {
    const sourceText = await readUtf8(filePath);
    assert.doesNotThrow(() => {
      new vm.Script(sourceText, { filename: filePath });
    });
  }
});

test("projects.json schema, localization, links, and preview assets are valid", async () => {
  const projects = JSON.parse(await readUtf8("projects.json"));
  const whitelistSet = new Set(
    parseWhitelistEntries(await readUtf8(pagesWhitelistPath))
  );
  assert.ok(Array.isArray(projects), "projects.json must be an array");
  assert.ok(projects.length > 0, "projects.json must contain at least one project");

  const localizedFields = ["title", "kind", "description", "action", "imageAlt"];
  const requiredStringFields = ["link", "image", "desktopImageAvif", "mobileImageAvif"];
  const seenLinks = new Set();
  const seenAssets = new Set();

  for (const [index, project] of projects.entries()) {
    assert.equal(typeof project, "object", `Project ${index + 1} must be an object`);
    assert.ok(project, `Project ${index + 1} must not be null`);

    for (const field of localizedFields) {
      const localized = project[field];
      assert.equal(typeof localized, "object", `Project ${index + 1} field "${field}" must be localized`);
      assert.ok(localized, `Project ${index + 1} field "${field}" must exist`);
      for (const language of ["ja", "en"]) {
        assert.equal(
          typeof localized[language],
          "string",
          `Project ${index + 1} field "${field}.${language}" must be a string`
        );
        assert.notEqual(
          localized[language].trim(),
          "",
          `Project ${index + 1} field "${field}.${language}" must not be empty`
        );
      }
    }

    for (const field of requiredStringFields) {
      assert.equal(typeof project[field], "string", `Project ${index + 1} field "${field}" must be a string`);
      assert.notEqual(project[field].trim(), "", `Project ${index + 1} field "${field}" must not be empty`);
    }

    const linkUrl = new URL(project.link);
    assert.ok(
      linkUrl.protocol === "http:" || linkUrl.protocol === "https:",
      `Project ${index + 1} link must use http/https`
    );
    const normalizedLink = linkUrl.toString();
    assert.ok(!seenLinks.has(normalizedLink), `Duplicate project link found: ${project.link}`);
    seenLinks.add(normalizedLink);

    const hasSourceAction = Object.hasOwn(project, "sourceAction");
    const hasSourceLink = Object.hasOwn(project, "sourceLink");
    assert.equal(
      hasSourceAction,
      hasSourceLink,
      `Project ${index + 1} sourceAction and sourceLink must be provided together`
    );
    if (hasSourceAction) {
      assert.equal(
        typeof project.sourceAction,
        "object",
        `Project ${index + 1} field "sourceAction" must be localized`
      );
      assert.ok(project.sourceAction, `Project ${index + 1} field "sourceAction" must exist`);
      for (const language of ["ja", "en"]) {
        const sourceLabel = project.sourceAction[language];
        assert.equal(
          typeof sourceLabel,
          "string",
          `Project ${index + 1} field "sourceAction.${language}" must be a string`
        );
        assert.notEqual(
          sourceLabel.trim(),
          "",
          `Project ${index + 1} field "sourceAction.${language}" must not be empty`
        );
        assert.notEqual(
          sourceLabel.trim().toLocaleLowerCase(language),
          project.action[language].trim().toLocaleLowerCase(language),
          `Project ${index + 1} source action must differ from its primary action in ${language}`
        );
      }

      assert.equal(
        typeof project.sourceLink,
        "string",
        `Project ${index + 1} field "sourceLink" must be a string`
      );
      assert.notEqual(
        project.sourceLink.trim(),
        "",
        `Project ${index + 1} field "sourceLink" must not be empty`
      );
      const sourceUrl = new URL(project.sourceLink);
      assert.equal(
        sourceUrl.protocol,
        "https:",
        `Project ${index + 1} sourceLink must use HTTPS`
      );
      const normalizedSourceLink = sourceUrl.toString();
      assert.notEqual(
        normalizedSourceLink,
        normalizedLink,
        `Project ${index + 1} sourceLink must differ from its primary link`
      );
      assert.ok(
        !seenLinks.has(normalizedSourceLink),
        `Duplicate project link found: ${project.sourceLink}`
      );
      seenLinks.add(normalizedSourceLink);
    }

    const projectAssets = [
      {
        field: "image",
        assetPath: project.image,
        extension: /\.jpg$/i,
        dimensions: { width: 960, height: 540 }
      },
      {
        field: "desktopImageAvif",
        assetPath: project.desktopImageAvif,
        extension: /\.avif$/i,
        dimensions: { width: 960, height: 540 }
      },
      {
        field: "mobileImageAvif",
        assetPath: project.mobileImageAvif,
        extension: /\.avif$/i,
        dimensions: { width: 720, height: 405 }
      }
    ];
    for (const { field, assetPath, extension, dimensions } of projectAssets) {
      const assetUrl = new URL(assetPath, "https://example.test/");
      assert.equal(
        assetUrl.origin,
        "https://example.test",
        `Project ${index + 1} field "${field}" must be same-origin`
      );
      assert.ok(
        assetPath.startsWith("assets/") &&
          path.posix.normalize(assetPath) === assetPath &&
          !assetPath.includes("..") &&
          !assetUrl.search &&
          !assetUrl.hash,
        `Project ${index + 1} field "${field}" must be a normalized local assets path`
      );
      assert.match(
        assetPath,
        extension,
        `Project ${index + 1} field "${field}" must use the expected format`
      );
      assert.ok(!seenAssets.has(assetPath), `Duplicate project asset found: ${assetPath}`);
      seenAssets.add(assetPath);

      const assetStats = await stat(path.join(repoRoot, assetPath));
      assert.ok(assetStats.isFile(), `Project asset must exist as a file: ${assetPath}`);
      assert.deepEqual(
        await imageDimensions(assetPath),
        dimensions,
        `Project asset must retain its expected dimensions: ${assetPath}`
      );
      assert.ok(
        whitelistSet.has(assetPath) || whitelistSet.has(topLevelPath(assetPath)),
        `Project asset must be included by the Pages artifact policy: ${assetPath}`
      );
    }
    assert.equal(
      new Set([project.image, project.desktopImageAvif, project.mobileImageAvif]).size,
      3,
      `Project ${index + 1} preview assets must be distinct`
    );

    if (Object.hasOwn(project, "stack")) {
      assert.ok(Array.isArray(project.stack), `Project ${index + 1} stack must be an array when present`);
      assert.ok(project.stack.length > 0, `Project ${index + 1} stack must not be empty when present`);
      const seenStackValues = new Set();
      for (const stackValue of project.stack) {
        assert.equal(typeof stackValue, "string", `Project ${index + 1} stack entries must be strings`);
        assert.notEqual(stackValue.trim(), "", `Project ${index + 1} stack entries must not be empty`);
        const normalizedStackValue = stackValue.trim().toLocaleLowerCase("en-US");
        assert.ok(
          !seenStackValues.has(normalizedStackValue),
          `Project ${index + 1} stack entries must be unique: ${stackValue}`
        );
        seenStackValues.add(normalizedStackValue);
      }
    }
  }
});

test("exactly six live projects expose verified public source actions", async () => {
  const projects = JSON.parse(await readUtf8("projects.json"));
  const indexHtml = await readUtf8("index.html");
  const scriptSource = await readUtf8("script.js");
  const expectedSources = new Map([
    ["TechDB", "https://github.com/himiyosh/tech-dashboard"],
    ["AI Agents: What Is Happening Right Now?", "https://github.com/himiyosh/JoJo-AIAgent"],
    ["Git, Not Scary", "https://github.com/himiyosh/JoJo-Git"],
    ["Encode / Decode Tool", "https://github.com/himiyosh/encode-decode-tool"],
    ["URLDecoder", "https://github.com/himiyosh/URLDecoder"],
    ["ImageResizer", "https://github.com/himiyosh/ImageResizer"]
  ]);
  const projectsWithSources = projects.filter((project) => Object.hasOwn(project, "sourceLink"));

  assert.equal(projectsWithSources.length, expectedSources.size);
  for (const project of projectsWithSources) {
    assert.equal(
      project.sourceLink,
      expectedSources.get(project.title.en),
      `Unexpected source mapping for ${project.title.en}`
    );
    assert.deepEqual(project.sourceAction, {
      ja: "GitHub でソースを見る",
      en: "View source on GitHub"
    });
  }
  assert.deepEqual(
    new Set(projectsWithSources.map((project) => project.title.en)),
    new Set(expectedSources.keys()),
    "Only the six verified live projects may expose secondary source actions"
  );

  for (const title of ["Portfolio", "UCFitness", "Network+"]) {
    const project = projects.find((entry) => entry.title.en === title);
    assert.ok(project, `Expected excluded project ${title}`);
    assert.equal(Object.hasOwn(project, "sourceAction"), false);
    assert.equal(Object.hasOwn(project, "sourceLink"), false);
  }

  const portfolio = projects.find((project) => project.title.en === "Portfolio");
  const networkPlus = projects.find((project) => project.title.en === "Network+");
  assert.match(portfolio.link, /^https:\/\/github\.com\//);
  assert.match(networkPlus.link, /^https:\/\/github\.com\//);
  assert.doesNotMatch(
    [JSON.stringify(projects), indexHtml, scriptSource].join("\n"),
    /github\.com\/himiyosh\/UCFitness/i,
    "The private UCFitness repository must never be disclosed"
  );
});

test("project runtime rejects incomplete, malformed, duplicate, and primary-equal source actions", async () => {
  const scriptSource = await readUtf8("script.js");
  const projects = JSON.parse(await readUtf8("projects.json"));
  const validatorDeclarations = [
    "requireNonEmptyString",
    "validateLocalizedField",
    "validateLocalProjectAsset",
    "validateProject"
  ]
    .map((functionName) => extractFunctionDeclaration(scriptSource, functionName))
    .join("\n");
  const validateProject = vm.runInNewContext(
    `(() => { ${validatorDeclarations}; return validateProject; })()`,
    {
      URL,
      localizedProjectFields: ["title", "description", "kind", "action", "imageAlt"],
      window: { location: new URL("https://example.test/") }
    },
    { timeout: 1000 }
  );
  const cloneProjects = () => JSON.parse(JSON.stringify(projects));
  const validateCatalogue = (catalogue) => {
    const seenLinks = new Set();
    const seenAssets = new Set();
    catalogue.forEach((project, index) =>
      validateProject(project, index, seenLinks, seenAssets)
    );
  };

  assert.doesNotThrow(() => validateCatalogue(cloneProjects()));

  const missingAction = cloneProjects();
  delete missingAction[1].sourceAction;
  assert.throws(() => validateCatalogue(missingAction), /must be provided together/);

  const incompleteLabel = cloneProjects();
  delete incompleteLabel[1].sourceAction.en;
  assert.throws(() => validateCatalogue(incompleteLabel), /sourceAction\.en.*non-empty string/);

  const matchingAction = cloneProjects();
  matchingAction[1].sourceAction = { ...matchingAction[1].action };
  assert.throws(() => validateCatalogue(matchingAction), /must differ from "action\.ja"/);

  const malformedLink = cloneProjects();
  malformedLink[1].sourceLink = "not an absolute URL";
  assert.throws(() => validateCatalogue(malformedLink), /must be an absolute HTTPS URL/);

  const insecureLink = cloneProjects();
  insecureLink[1].sourceLink = "http://github.com/himiyosh/tech-dashboard";
  assert.throws(() => validateCatalogue(insecureLink), /must be an absolute HTTPS URL/);

  const matchingLink = cloneProjects();
  matchingLink[1].sourceLink = matchingLink[1].link;
  assert.throws(() => validateCatalogue(matchingLink), /source link must differ/);

  const duplicateLink = cloneProjects();
  duplicateLink[2].sourceLink = duplicateLink[1].sourceLink;
  assert.throws(() => validateCatalogue(duplicateLink), /Duplicate project link detected/);

  const missingDesktopImage = cloneProjects();
  delete missingDesktopImage[0].desktopImageAvif;
  assert.throws(
    () => validateCatalogue(missingDesktopImage),
    /desktopImageAvif.*non-empty string/
  );

  const externalDesktopImage = cloneProjects();
  externalDesktopImage[0].desktopImageAvif = "https://example.test/project.avif";
  assert.throws(() => validateCatalogue(externalDesktopImage), /must be a local assets path/);

  const queriedDesktopImage = cloneProjects();
  queriedDesktopImage[0].desktopImageAvif += "?v=1";
  assert.throws(() => validateCatalogue(queriedDesktopImage), /must be a local assets path/);

  const hashedDesktopImage = cloneProjects();
  hashedDesktopImage[0].desktopImageAvif += "#preview";
  assert.throws(() => validateCatalogue(hashedDesktopImage), /must be a local assets path/);

  const wrongDesktopFormat = cloneProjects();
  wrongDesktopFormat[0].desktopImageAvif = wrongDesktopFormat[0].image;
  assert.throws(() => validateCatalogue(wrongDesktopFormat), /must use \.avif/);

  const duplicatePreviewAsset = cloneProjects();
  duplicatePreviewAsset[0].desktopImageAvif = duplicatePreviewAsset[0].mobileImageAvif;
  assert.throws(() => validateCatalogue(duplicatePreviewAsset), /Duplicate project asset detected/);
});

test("project action groups preserve primary-first safe localized links and responsive focus behavior", async () => {
  const scriptSource = await readUtf8("script.js");
  const stylesSource = await readUtf8("styles.css");
  const modernSource = await readUtf8("modern.css");
  const createActionBody = extractObjectLiteral(
    scriptSource,
    "function createProjectAction"
  );
  const renderProjectsBody = extractObjectLiteral(scriptSource, "function renderProjects");

  assert.match(createActionBody, /link\.target = "_blank"/);
  assert.match(createActionBody, /link\.rel = "noopener noreferrer"/);
  assert.match(createActionBody, /linkText\.textContent = localizedValue\(action\)/);
  assert.match(
    createActionBody,
    /window\.siteI18n\.t\("accessibility\.opensInNewTab"\)/
  );
  assert.match(createActionBody, /linkArrow\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(renderProjectsBody, /actions\.className = "project-actions"/);
  assert.match(renderProjectsBody, /actions\.setAttribute\("role", "group"\)/);
  assert.match(renderProjectsBody, /actions\.setAttribute\("aria-labelledby", title\.id\)/);
  assert.match(
    renderProjectsBody,
    /createProjectAction\(project\.action, project\.link, "primary"\)/
  );
  assert.match(
    renderProjectsBody,
    /createProjectAction\(\s*project\.sourceAction,\s*project\.sourceLink,\s*"secondary"/
  );
  assert.ok(
    renderProjectsBody.indexOf("actions.append(primaryLink)") <
      renderProjectsBody.indexOf("actions.append(sourceLink)"),
    "Primary live action must precede the secondary source action in DOM and focus order"
  );

  assert.match(
    stylesSource,
    /\.project-actions\s*\{[^}]*max-width:\s*100%;[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*gap:/s,
    "Action groups must wrap instead of overflowing narrow project cards"
  );
  assert.match(
    stylesSource,
    /\.project-link\s*\{[^}]*max-width:\s*100%;[^}]*min-height:\s*44px;[^}]*white-space:\s*nowrap;/s,
    "Every project action must retain a 44px single-line target"
  );
  assert.match(
    modernSource,
    /\.project-link--secondary\s*\{[^}]*color:\s*var\(--color-ink-2\);[^}]*border:\s*var\(--rule-hair\) solid currentcolor;[^}]*font-size:\s*var\(--text-sm\);/s,
    "The source action must use a quieter outlined hierarchy"
  );
  assert.match(
    stylesSource,
    /:where\(a, button\):focus-visible\s*\{\s*outline:\s*3px solid var\(--color-focus\);/,
    "Project actions must inherit the visible global focus ring"
  );
  assert.match(
    modernSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.project-link\s*\{[^}]*transform:\s*none !important;/,
    "Project action motion must remain disabled under reduced motion"
  );
  assert.match(
    stylesSource,
    /html\s*\{[^}]*overflow-x:\s*clip;/s,
    "The page root must retain horizontal overflow protection"
  );
});

test("mobile project AVIF pairs meet dimension and bandwidth budgets", async () => {
  const projects = JSON.parse(await readUtf8("projects.json"));
  assert.equal(projects.length, 9, "The current catalogue must provide all nine AVIF/JPEG pairs");

  let totalJpegBytes = 0;
  let totalAvifBytes = 0;
  for (const project of projects) {
    assert.equal(
      project.mobileImageAvif,
      project.image.replace(/\.jpg$/i, "-720w.avif"),
      `Mobile AVIF must pair with its JPEG fallback: ${project.image}`
    );

    const jpegStats = await stat(path.join(repoRoot, project.image));
    const avifStats = await stat(path.join(repoRoot, project.mobileImageAvif));
    totalJpegBytes += jpegStats.size;
    totalAvifBytes += avifStats.size;
    assert.ok(
      avifStats.size <= jpegStats.size,
      `Mobile AVIF must not exceed its JPEG fallback: ${project.mobileImageAvif}`
    );
  }

  assert.ok(
    totalAvifBytes <= projectPreviewAvifMaximumBytes,
    `Aggregate mobile AVIF bytes must not exceed ${projectPreviewAvifMaximumBytes}; received ${totalAvifBytes}`
  );
  assert.ok(
    (projectPreviewAvifBaselineBytes - totalAvifBytes) / projectPreviewAvifBaselineBytes >=
      projectPreviewMinimumSavingsRatio,
    `Mobile AVIFs must save at least 60% versus the documented ${projectPreviewAvifBaselineBytes}-byte baseline`
  );
  assert.ok(
    (totalJpegBytes - totalAvifBytes) / totalJpegBytes >= projectPreviewMinimumSavingsRatio,
    "Mobile AVIFs must save at least 60% versus the current JPEG fallbacks"
  );
});

test("desktop project AVIF pairs meet exact format, dimensions, and bandwidth budgets", async () => {
  const projects = JSON.parse(await readUtf8("projects.json"));
  assert.equal(projects.length, 9, "The current catalogue must provide all nine desktop AVIF pairs");

  let totalJpegBytes = 0;
  let totalAvifBytes = 0;
  for (const project of projects) {
    assert.equal(
      project.desktopImageAvif,
      project.image.replace(/\.jpg$/i, "-960w.avif"),
      `Desktop AVIF must pair with its JPEG fallback: ${project.image}`
    );

    const jpegStats = await stat(path.join(repoRoot, project.image));
    const avifStats = await stat(path.join(repoRoot, project.desktopImageAvif));
    totalJpegBytes += jpegStats.size;
    totalAvifBytes += avifStats.size;
    assert.deepEqual(
      await imageDimensions(project.desktopImageAvif),
      { width: 960, height: 540 },
      `Desktop AVIF must be exactly 960x540: ${project.desktopImageAvif}`
    );
    assert.ok(
      avifStats.size < jpegStats.size,
      `Desktop AVIF must be smaller than its JPEG fallback: ${project.desktopImageAvif}`
    );
  }

  assert.equal(
    totalJpegBytes,
    projectPreviewDesktopJpegBaselineBytes,
    "The reviewed desktop JPEG baseline changed; regenerate and re-review all AVIF measurements"
  );
  assert.ok(
    totalAvifBytes <= totalJpegBytes * projectPreviewDesktopAvifMaximumRatio,
    `Aggregate desktop AVIF bytes must be at most 50% of JPEG bytes; received ${totalAvifBytes}/${totalJpegBytes}`
  );
});

test("project runtime validation requires distinct local JPEG and AVIF assets", async () => {
  const scriptSource = await readUtf8("script.js");
  const validateAssetBody = extractObjectLiteral(
    scriptSource,
    "function validateLocalProjectAsset"
  );
  const validateProjectBody = extractObjectLiteral(scriptSource, "function validateProject");
  const loadProjectsBody = extractObjectLiteral(scriptSource, "async function loadProjects");

  assert.match(validateAssetBody, /requireNonEmptyString\(\s*project\[fieldName\]/);
  assert.match(validateAssetBody, /assetUrl\.origin !== window\.location\.origin/);
  assert.match(validateAssetBody, /!assetUrl\.pathname\.startsWith\(assetsUrl\.pathname\)/);
  assert.match(validateAssetBody, /assetUrl\.search/);
  assert.match(validateAssetBody, /assetUrl\.hash/);
  assert.match(validateAssetBody, /\.endsWith\(expectedExtension\)/);
  assert.match(validateAssetBody, /seenAssets\.has\(normalizedAsset\)/);
  assert.match(validateAssetBody, /seenAssets\.add\(normalizedAsset\)/);
  assert.match(
    validateProjectBody,
    /validateLocalProjectAsset\(project, index, "image", "\.jpg", seenAssets\)/
  );
  assert.match(
    validateProjectBody,
    /validateLocalProjectAsset\(project, index, "desktopImageAvif", "\.avif", seenAssets\)/
  );
  assert.match(
    validateProjectBody,
    /validateLocalProjectAsset\(project, index, "mobileImageAvif", "\.avif", seenAssets\)/
  );
  assert.match(loadProjectsBody, /const seenAssets = new Set\(\)/);
  assert.match(
    loadProjectsBody,
    /validateProject\(project, index, seenLinks, seenAssets\)/,
    "JPEG and AVIF paths must share one uniqueness set so cross-field collisions are rejected"
  );
});

test("project rendering emits mutually exclusive AVIF sources before lazy JPEG fallbacks", async () => {
  const scriptSource = await readUtf8("script.js");
  const renderProjectsBody = extractObjectLiteral(scriptSource, "function renderProjects");

  assert.match(
    scriptSource,
    new RegExp(
      `const projectPreviewDesktopMedia = \"${escapeRegExp(projectPreviewDesktopMedia)}\";`
    ),
    "Desktop AVIF media gate must match the existing desktop breakpoint"
  );
  assert.match(
    scriptSource,
    new RegExp(
      `const projectPreviewMobileMedia = \"${escapeRegExp(projectPreviewMobileMedia)}\";`
    ),
    "Project AVIF media gate must match the existing mobile breakpoint"
  );
  assert.match(renderProjectsBody, /document\.createElement\("picture"\)/);
  assert.equal(
    [...renderProjectsBody.matchAll(/document\.createElement\("source"\)/g)].length,
    2,
    "Each project picture must create exactly one desktop and one mobile source"
  );
  assert.match(renderProjectsBody, /desktopSource\.type = "image\/avif"/);
  assert.match(renderProjectsBody, /desktopSource\.media = projectPreviewDesktopMedia/);
  assert.match(
    renderProjectsBody,
    /desktopSource\.srcset = `\$\{project\.desktopImageAvif\} 960w`/
  );
  assert.match(renderProjectsBody, /desktopSource\.sizes = "60vw"/);
  assert.match(renderProjectsBody, /mobileSource\.type = "image\/avif"/);
  assert.match(renderProjectsBody, /mobileSource\.media = projectPreviewMobileMedia/);
  assert.match(
    renderProjectsBody,
    /mobileSource\.srcset = `\$\{project\.mobileImageAvif\} 720w`/
  );
  assert.match(renderProjectsBody, /mobileSource\.sizes = "100vw"/);
  assert.match(
    renderProjectsBody,
    /picture\.append\(desktopSource, mobileSource, image\)/,
    "Desktop and mobile AVIF sources must precede the JPEG img fallback inside picture"
  );
  assert.ok(
    renderProjectsBody.indexOf("picture.append(desktopSource, mobileSource, image)") <
      renderProjectsBody.indexOf("media.append(picture)"),
    "Completed picture must be appended to the project media container"
  );
  assert.ok(
    renderProjectsBody.indexOf("picture.append(desktopSource, mobileSource, image)") <
      renderProjectsBody.indexOf("image.src = project.image"),
    "Both AVIF choices must join picture before src assignment to avoid a duplicate JPEG download"
  );
  assert.ok(
    renderProjectsBody.indexOf("media.append(picture)") <
      renderProjectsBody.indexOf("image.src = project.image"),
    "The completed picture must join its disconnected media container before fallback src assignment"
  );

  assert.match(renderProjectsBody, /image\.src = project\.image/);
  assert.match(renderProjectsBody, /image\.alt = localizedValue\(project\.imageAlt\)/);
  assert.match(renderProjectsBody, /image\.width = 960/);
  assert.match(renderProjectsBody, /image\.height = 540/);
  assert.match(renderProjectsBody, /image\.loading = "lazy"/);
  assert.match(renderProjectsBody, /image\.decoding = "async"/);
  assert.doesNotMatch(
    renderProjectsBody,
    /fetchpriority|fetchPriority|loading = "eager"/,
    "Project cards must remain lazy and must not compete with the hero LCP resource"
  );
});

test("project catalogue status stays concise, atomic, and separate from rendered results", async () => {
  const indexHtml = await readUtf8("index.html");
  const i18nSource = await readUtf8("i18n.js");
  const scriptSource = await readUtf8("script.js");
  const translations = parseTranslations(i18nSource);

  const openingTags = [...indexHtml.matchAll(/<(?:div|p)\b[^>]*>/gi)].map((match) => ({
    tag: match[0],
    index: match.index
  }));
  const statusTag = openingTags.find(({ tag }) => readHtmlAttribute(tag, "id") === "projects-status");
  const resultsTag = openingTags.find(({ tag }) => readHtmlAttribute(tag, "id") === "projects-container");

  assert.ok(statusTag, "A pre-existing #projects-status element must be present");
  assert.ok(resultsTag, "A separate #projects-container element must be present");
  assert.equal(readHtmlAttribute(statusTag.tag, "role"), "status");
  assert.equal(readHtmlAttribute(statusTag.tag, "aria-atomic"), "true");
  assert.equal(readHtmlAttribute(statusTag.tag, "data-i18n"), "projects.loading");
  assert.notEqual(
    readHtmlAttribute(statusTag.tag, "data-i18n-dynamic"),
    undefined,
    "The script-managed status must avoid transient generic i18n announcements"
  );
  assert.ok(
    statusTag.index < resultsTag.index,
    "The dedicated status must be a sibling before the rendered catalogue"
  );
  assert.equal(readHtmlAttribute(resultsTag.tag, "aria-live"), undefined);
  assert.equal(readHtmlAttribute(resultsTag.tag, "role"), undefined);
  assert.equal(readHtmlAttribute(resultsTag.tag, "aria-busy"), "true");

  const statusMarkup = indexHtml.slice(
    statusTag.index,
    indexHtml.indexOf("</p>", statusTag.index) + "</p>".length
  );
  assert.match(statusMarkup, /プロジェクトを読み込んでいます。/);
  assert.doesNotMatch(statusMarkup, /projects-container|project-row/);

  for (const language of ["ja", "en"]) {
    assert.match(translations[language].projects.ready, /\{count\}/);
    for (const state of ["loading", "ready", "error"]) {
      assert.equal(
        typeof translations[language].projects[state],
        "string",
        `${language} must provide concise ${state} project status copy`
      );
    }
  }

  assert.match(
    i18nSource,
    /querySelectorAll\("\[data-i18n\]:not\(\[data-i18n-dynamic\]\)"\)/,
    "Generic translation updates must leave the stateful live status to script.js"
  );

  const statusKeys = vm.runInNewContext(
    `(${extractObjectLiteral(scriptSource, "const projectStatusKeys =")})`,
    Object.create(null),
    { timeout: 1000 }
  );
  assert.deepEqual(
    { ...statusKeys },
    {
      loading: "projects.loading",
      ready: "projects.ready",
      error: "projects.error"
    }
  );

  const updateStatusBody = extractObjectLiteral(scriptSource, "function updateProjectStatus");
  assert.match(updateStatusBody, /projectsStatus\.dataset\.i18n = translationKey/);
  assert.match(updateStatusBody, /projectsStatus\.textContent = statusMessage/);
  assert.match(updateStatusBody, /replace\("\{count\}", String\(projects\.length\)\)/);
  assert.match(
    updateStatusBody,
    /projectsContainer\.setAttribute\("aria-busy", String\(state === "loading"\)\)/
  );
  assert.match(updateStatusBody, /projectsStatus\.classList\.toggle\("sr-only", isReady\)/);
  assert.match(updateStatusBody, /projectsContainer\.classList\.toggle\("projects-list", isReady\)/);

  const renderProjectsBody = extractObjectLiteral(scriptSource, "function renderProjects");
  const renderLoadingBody = extractObjectLiteral(scriptSource, "function renderProjectLoading");
  const renderErrorBody = extractObjectLiteral(scriptSource, "function renderProjectError");
  const loadProjectsBody = extractObjectLiteral(scriptSource, "async function loadProjects");
  assert.match(renderProjectsBody, /projectsContainer\.replaceChildren\(fragment\)/);
  assert.match(renderProjectsBody, /updateProjectStatus\("ready"\)/);
  assert.match(renderLoadingBody, /updateProjectStatus\("loading"\)/);
  assert.match(renderLoadingBody, /projectsContainer\.replaceChildren\(\)/);
  assert.match(renderErrorBody, /retry\.setAttribute\("aria-describedby", "projects-status"\)/);
  assert.match(renderErrorBody, /updateProjectStatus\("error"\)/);
  assert.ok(
    loadProjectsBody.indexOf("renderProjectLoading()") < loadProjectsBody.indexOf('fetch("projects.json"'),
    "Loading status and busy state must be restored before retrying the fetch"
  );
  assert.doesNotMatch(scriptSource, /setAttribute\("role", "status"\)/);

  const languageChangeHandler = scriptSource.slice(
    scriptSource.indexOf('document.addEventListener("site-languagechange"'),
    scriptSource.indexOf("const observedSections", scriptSource.indexOf('document.addEventListener("site-languagechange"'))
  );
  assert.match(languageChangeHandler, /projectState === "ready"[\s\S]*renderProjects\(\)/);
  assert.match(languageChangeHandler, /projectState === "error"[\s\S]*renderProjectError\(\)/);
  assert.match(languageChangeHandler, /else[\s\S]*renderProjectLoading\(\)/);
});

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

  assert.match(
    indexHtml,
    /課題を解き、学びを分かち合う。好奇心を実用へつなぐ、himiyosh&nbsp;のポートフォリオです。/,
    "Static hero copy must protect the himiyosh の boundary with an NBSP"
  );
  assert.match(
    indexHtml,
    /取り組&#8288;んでいます/,
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

test("required SEO and social metadata exist and are consistent", async () => {
  const indexHtml = await readUtf8("index.html");
  const requiredPatterns = [
    /<title>[\s\S]*?<\/title>/i,
    /<meta[^>]*name="description"[^>]*>/i,
    /<meta[^>]*name="viewport"[^>]*>/i,
    /<meta[^>]*property="og:type"[^>]*>/i,
    /<meta[^>]*property="og:title"[^>]*>/i,
    /<meta[^>]*property="og:description"[^>]*>/i,
    /<meta[^>]*property="og:url"[^>]*>/i,
    /<meta[^>]*property="og:image"[^>]*>/i,
    /<meta[^>]*name="twitter:card"[^>]*>/i,
    /<meta[^>]*name="twitter:title"[^>]*>/i,
    /<meta[^>]*name="twitter:description"[^>]*>/i,
    /<meta[^>]*name="twitter:image"[^>]*>/i,
    /<link[^>]*rel="canonical"[^>]*>/i
  ];

  for (const pattern of requiredPatterns) {
    assert.ok(pattern.test(indexHtml), `Missing required metadata pattern: ${pattern}`);
  }

  const canonicalHref = indexHtml.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"[^>]*>/i)?.[1];
  const ogUrl = indexHtml.match(/<meta[^>]*property="og:url"[^>]*content="([^"]+)"[^>]*>/i)?.[1];
  assert.ok(canonicalHref, "Canonical URL must be present");
  assert.ok(ogUrl, "og:url must be present");
  assert.equal(ogUrl, canonicalHref, "Canonical URL and og:url must match");

  const alternateLinks = [...indexHtml.matchAll(
    /<link[^>]*rel="alternate"[^>]*hreflang="([^"]+)"[^>]*href="([^"]+)"[^>]*>/gi
  )];
  assert.ok(alternateLinks.length >= 3, "Expected alternate language metadata links");
  const alternateMap = new Map(alternateLinks.map(([, language, href]) => [language, href]));
  assert.equal(
    alternateMap.get("ja"),
    "https://himiyosh.github.io/Info/?lang=ja",
    'hreflang="ja" URL must match the Japanese query URL'
  );
  assert.equal(
    alternateMap.get("en"),
    "https://himiyosh.github.io/Info/?lang=en",
    'hreflang="en" URL must match the English query URL'
  );
  assert.equal(
    alternateMap.get("x-default"),
    canonicalHref,
    'hreflang="x-default" URL must match canonical URL'
  );
});

test("noscript project links provide direct access to every listed project", async () => {
  const indexHtml = await readUtf8("index.html");
  const projects = JSON.parse(await readUtf8("projects.json"));
  const noscriptContent = indexHtml.match(/<noscript>([\s\S]*?)<\/noscript>/i)?.[1];
  assert.ok(noscriptContent, "index.html must include a noscript fallback block");

  const noscriptLinks = [...noscriptContent.matchAll(/\bhref="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(noscriptLinks.length > 0, "noscript fallback must include direct project links");
  for (const project of projects) {
    assert.ok(
      noscriptLinks.includes(project.link),
      `noscript fallback must include direct link for project: ${project.title.en}`
    );
  }
});

test("JoJo deck entries stay distinct and aligned with live deck routes", async () => {
  const projects = JSON.parse(await readUtf8("projects.json"));
  const jojoProjects = projects.filter((project) =>
    [
      "https://himiyosh.github.io/JoJo-AIAgent/",
      "https://himiyosh.github.io/JoJo-Git/"
    ].includes(project.link)
  );
  assert.equal(jojoProjects.length, 2, "Expected exactly two separate JoJo project entries");

  const titles = new Set(jojoProjects.map((project) => project.title.en));
  assert.ok(
    titles.has("AI Agents: What Is Happening Right Now?"),
    "JoJo-AIAgent entry must use the truthful public deck title"
  );
  assert.ok(titles.has("Git, Not Scary"), "JoJo-Git entry must use the truthful public deck title");

  const links = new Set(jojoProjects.map((project) => project.link));
  assert.equal(links.size, 2, "JoJo project links must remain distinct");
  assert.ok(links.has("https://himiyosh.github.io/JoJo-AIAgent/"), "JoJo-AIAgent link must match live deck URL");
  assert.ok(links.has("https://himiyosh.github.io/JoJo-Git/"), "JoJo-Git link must match live deck URL");

  for (const project of jojoProjects) {
    assert.deepEqual(
      project.stack,
      ["Slidev", "Vue", "Playwright", "GitHub Pages"],
      `${project.title.en} stack must stay aligned with the deck implementation`
    );
  }
});

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
    /@media \(min-width: 48rem\) \{([\s\S]*)\}\s*html:not\(\.js-enabled\) \.hero/
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

test("all referenced local files exist", async () => {
  const indexHtml = await readUtf8("index.html");
  const scriptSource = await readUtf8("script.js");
  const projects = JSON.parse(await readUtf8("projects.json"));

  const localReferences = new Set();

  for (const match of indexHtml.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const localPath = localPathFromReference(match[1]);
    if (localPath) {
      localReferences.add(localPath);
    }
  }

  for (const match of scriptSource.matchAll(/fetch\(\s*"([^"]+)"/g)) {
    const localPath = localPathFromReference(match[1]);
    if (localPath) {
      localReferences.add(localPath);
    }
  }

  for (const project of projects) {
    localReferences.add(project.image);
    localReferences.add(project.desktopImageAvif);
    localReferences.add(project.mobileImageAvif);
  }

  for (const localReference of localReferences) {
    const fileStats = await stat(path.join(repoRoot, localReference));
    assert.ok(fileStats.isFile(), `Missing referenced local file: ${localReference}`);
  }
});

test("workflow actions are pinned to immutable Node.js-24-compatible SHAs", async () => {
  const qualityWorkflow = await readUtf8(qualityWorkflowPath);
  const pagesWorkflow = await readUtf8(pagesWorkflowPath);
  const expectedPins = new Map([
    ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
    ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
    ["actions/upload-pages-artifact", "fc324d3547104276b827a68afc52ff2a11cc49c9"],
    ["actions/configure-pages", "45bfe0192ca1faeb007ade9deae92b16b8254a0d"],
    ["actions/deploy-pages", "cd2ce8fcbc39b97be8ca5fce6e763baed58fa128"]
  ]);

  const usesPattern = /^\s*uses:\s*([a-z0-9-]+\/[a-z0-9-]+)@([a-f0-9]{40})\s*$/gim;
  const usesByAction = new Map();
  for (const workflow of [qualityWorkflow, pagesWorkflow]) {
    for (const match of workflow.matchAll(usesPattern)) {
      usesByAction.set(match[1], match[2]);
    }
  }

  for (const [actionName, expectedSha] of expectedPins) {
    assert.equal(
      usesByAction.get(actionName),
      expectedSha,
      `Expected immutable pin for ${actionName} to be ${expectedSha}`
    );
  }

  assert.doesNotMatch(
    `${qualityWorkflow}\n${pagesWorkflow}`,
    /actions\/(?:checkout|setup-node|upload-pages-artifact|configure-pages|deploy-pages)@v\d+/i,
    "Pinned actions must not use mutable version tags"
  );
});

test("workflow checkouts do not persist credentials", async () => {
  for (const [workflowName, workflowPath] of [
    ["Quality", qualityWorkflowPath],
    ["Pages", pagesWorkflowPath]
  ]) {
    const workflow = await readUtf8(workflowPath);
    assert.match(
      workflow,
      /uses:\s*actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\s*\n\s*with:\s*\n\s+persist-credentials:\s*false/,
      `${workflowName} checkout must set persist-credentials: false`
    );
  }
});

test("Pages workflow keeps least-privilege permissions and artifact-only deployment", async () => {
  const pagesWorkflow = await readUtf8(pagesWorkflowPath);
  const buildBlock = pagesWorkflow.match(/\n  build:\n([\s\S]*?)\n  deploy:\n/);
  const deployBlock = pagesWorkflow.match(/\n  deploy:\n([\s\S]*)$/);

  assert.match(
    pagesWorkflow,
    /permissions:\n\s+contents:\s+read/,
    "Workflow-level permissions must default to contents: read"
  );
  assert.ok(buildBlock, "Pages workflow must define a build job");
  assert.ok(deployBlock, "Pages workflow must define a deploy job");

  assert.match(buildBlock[1], /permissions:\n\s+contents:\s+read/, "Build job must request contents:read");
  assert.doesNotMatch(buildBlock[1], /pages:\s+write/, "Build job must not request pages:write");
  assert.doesNotMatch(buildBlock[1], /id-token:\s+write/, "Build job must not request id-token:write");
  assert.match(buildBlock[1], /timeout-minutes:\s*5/, "Build job must set a short timeout");

  assert.match(deployBlock[1], /permissions:\n\s+pages:\s+write\n\s+id-token:\s+write/, "Deploy job must request pages:write and id-token:write");
  assert.doesNotMatch(deployBlock[1], /contents:\s+write/, "Deploy job must not request contents:write");
  assert.match(deployBlock[1], /timeout-minutes:\s*5/, "Deploy job must set a short timeout");
  assert.match(
    deployBlock[1],
    /uses:\s*actions\/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d[\s\S]*uses:\s*actions\/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128/,
    "Configure Pages must run in deploy immediately before deploy-pages"
  );
  assert.doesNotMatch(
    buildBlock[1],
    /uses:\s*actions\/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d/,
    "Build job must not run configure-pages"
  );
  assert.doesNotMatch(
    buildBlock[1],
    /uses:\s*actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/,
    "Build job must not run setup-node for shell-only artifact assembly"
  );

  assert.match(
    pagesWorkflow,
    /done < \.github\/pages-artifact-whitelist\.txt/,
    "Build step must source deployment paths from the whitelist file"
  );
  assert.match(
    pagesWorkflow,
    /uses:\s*actions\/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9[\s\S]*?path:\s*_site/,
    "Pages artifact upload must publish only the _site directory"
  );
});

test("Pages artifact whitelist is strict and covers all locally referenced production files", async () => {
  const indexHtml = await readUtf8("index.html");
  const scriptSource = await readUtf8("script.js");
  const projects = JSON.parse(await readUtf8("projects.json"));
  const whitelistEntries = parseWhitelistEntries(await readUtf8(pagesWhitelistPath));
  const whitelistSet = new Set(whitelistEntries);
  const expectedWhitelist = new Set([
    "index.html",
    "tokens.css",
    "styles.css",
    "modern.css",
    "script.js",
    "i18n.js",
    "projects.json",
    "assets",
    "favicon.svg",
    "robots.txt",
    "sitemap.xml",
    "ads.txt"
  ]);

  assert.deepEqual(
    [...whitelistSet].sort(),
    [...expectedWhitelist].sort(),
    "Whitelist must contain only the approved production paths"
  );

  const localReferences = new Set();
  for (const match of indexHtml.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const localPath = localPathFromReference(match[1]);
    if (localPath) {
      localReferences.add(localPath);
    }
  }
  for (const match of scriptSource.matchAll(/fetch\(\s*"([^"]+)"/g)) {
    const localPath = localPathFromReference(match[1]);
    if (localPath) {
      localReferences.add(localPath);
    }
  }
  for (const project of projects) {
    localReferences.add(project.image);
    localReferences.add(project.desktopImageAvif);
    localReferences.add(project.mobileImageAvif);
  }
  localReferences.add("ads.txt");

  for (const localReference of localReferences) {
    const rootPath = topLevelPath(localReference);
    assert.ok(
      whitelistSet.has(localReference) || whitelistSet.has(rootPath),
      `Referenced production file must be included by whitelist: ${localReference}`
    );
  }

  const forbiddenEntries = [".github", "tests", "README.md", "PRODUCT.md", "package.json"];
  for (const forbiddenEntry of forbiddenEntries) {
    assert.ok(
      !whitelistSet.has(forbiddenEntry),
      `Whitelist must not include non-production path: ${forbiddenEntry}`
    );
  }
});

test("robots.txt and sitemap.xml are consistent", async () => {
  const robots = await readUtf8("robots.txt");
  const sitemapXml = await readUtf8("sitemap.xml");
  const indexHtml = await readUtf8("index.html");

  const canonicalHref = indexHtml.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"[^>]*>/i)?.[1];
  assert.ok(canonicalHref, "Canonical URL must be present");

  const robotsSitemapUrl = robots.match(/^\s*Sitemap:\s*(\S+)\s*$/im)?.[1];
  assert.ok(robotsSitemapUrl, "robots.txt must include a Sitemap URL");

  const expectedSitemapUrl = new URL("sitemap.xml", canonicalHref).toString();
  assert.equal(
    robotsSitemapUrl,
    expectedSitemapUrl,
    "robots.txt sitemap URL must match canonical sitemap location"
  );

  const sitemapLocs = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.ok(sitemapLocs.length > 0, "sitemap.xml must include at least one <loc>");
  assert.ok(
    sitemapLocs.includes(canonicalHref),
    "sitemap.xml must include the canonical URL listed in index.html"
  );
});

test("preview assets are not stale or orphaned", async () => {
  const projects = JSON.parse(await readUtf8("projects.json"));
  const assetRoot = path.join(repoRoot, "assets");
  const assetFiles = (await listFilesRecursively(assetRoot)).map((absolutePath) =>
    path.relative(repoRoot, absolutePath).split(path.sep).join("/")
  );

  const projectImages = projects.flatMap((project) => [
    project.image,
    project.desktopImageAvif,
    project.mobileImageAvif
  ]);
  const previewFiles = assetFiles.filter((filePath) =>
    /-preview(?:-(?:720|960)w)?\.(?:avif|jpg)$/i.test(filePath)
  );
  assert.ok(previewFiles.length > 0, "At least one preview asset must exist");

  for (const previewPath of previewFiles) {
    const usageCount = projectImages.filter((imagePath) => imagePath === previewPath).length;
    assert.equal(usageCount, 1, `Preview asset must be referenced exactly once: ${previewPath}`);
  }

  const orphanProjectImages = projectImages.filter((imagePath) => !assetFiles.includes(imagePath));
  assert.equal(
    orphanProjectImages.length,
    0,
    `All project images must exist under assets/: ${orphanProjectImages.join(", ")}`
  );

  const portfolioPreview = await readFile(path.join(repoRoot, "assets/portfolio-preview.jpg"));
  const portfolioPreviewHash = createHash("sha256").update(portfolioPreview).digest("hex");
  assert.notEqual(
    portfolioPreviewHash,
    retiredPortfolioPreviewSha256,
    "Portfolio preview must not restore the retired light-blue/orange design"
  );
  assert.deepEqual(
    jpegDimensions(portfolioPreview),
    { width: 960, height: 540 },
    "Portfolio preview must retain its 960x540 social-card dimensions"
  );
});

test("removed legacy particles file is not referenced", async () => {
  await assert.rejects(
    stat(path.join(repoRoot, "particles.json")),
    /ENOENT/,
    "particles.json should be removed from the repository root"
  );

  const sourcesToCheck = ["index.html", "script.js", "styles.css"];
  for (const sourcePath of sourcesToCheck) {
    const sourceText = await readUtf8(sourcePath);
    assert.ok(
      !/(particles\.json|particlesJS|particles\.js)/i.test(sourceText),
      `${sourcePath} must not reference legacy particles assets`
    );
  }
});

test("hero image keeps an eager JPEG fallback and responsive assets match their descriptors", async () => {
  const indexHtml = await readUtf8("index.html");
  const pictureTag = indexHtml.match(/<picture>[\s\S]*?<\/picture>/)?.[0];
  assert.ok(pictureTag, "Hero image must use a picture element for format fallback");

  const avifSourceTag = pictureTag.match(/<source[^>]*type="image\/avif"[^>]*>/)?.[0];
  const imgTag = pictureTag.match(/<img[\s\S]*?>/)?.[0];
  assert.ok(avifSourceTag, "Hero picture must include an AVIF source");
  assert.ok(imgTag, "Hero picture must include an img fallback");
  assert.equal(
    attributeValue(imgTag, "src"),
    "assets/profile.jpg",
    "Hero img must retain the full-size JPEG fallback"
  );
  assert.match(imgTag, /\bfetchpriority="high"/, "Hero img must retain fetchpriority=high");
  assert.doesNotMatch(imgTag, /\bloading="lazy"/, "Hero img must not be lazy loaded");
  assert.equal(attributeValue(imgTag, "width"), "960", "Hero img width must prevent layout shift");
  assert.equal(attributeValue(imgTag, "height"), "720", "Hero img height must prevent layout shift");
  assert.equal(
    attributeValue(imgTag, "data-i18n-alt"),
    "hero.imageAlt",
    "Hero img must retain its localized alt-text binding"
  );

  const whitelistSet = new Set(
    parseWhitelistEntries(await readUtf8(pagesWhitelistPath))
  );
  const sourceSets = [
    {
      format: "AVIF",
      srcset: attributeValue(avifSourceTag, "srcset"),
      extension: /\.avif$/i
    },
    {
      format: "JPEG",
      srcset: attributeValue(imgTag, "srcset"),
      extension: /\.jpe?g$/i
    }
  ];

  for (const { format, srcset, extension } of sourceSets) {
    assert.ok(srcset, `${format} source must include a srcset`);
    const entries = parseSrcsetEntries(srcset);
    assert.deepEqual(
      entries.map(({ width }) => width),
      [480, 720, 960],
      `${format} srcset must provide 480w, 720w, and 960w candidates`
    );

    for (const { source, width } of entries) {
      const localPath = localPathFromReference(source);
      assert.ok(localPath, `${format} srcset source must be local: ${source}`);
      assert.match(localPath, extension, `${format} srcset source must use the expected format`);
      const fileStats = await stat(path.join(repoRoot, localPath));
      assert.ok(fileStats.isFile(), `srcset source must exist as a file: ${localPath}`);
      assert.ok(
        whitelistSet.has(localPath) || whitelistSet.has(topLevelPath(localPath)),
        `srcset source must be included by the Pages artifact policy: ${localPath}`
      );

      const dimensions = await imageDimensions(localPath);
      assert.equal(dimensions.width, width, `${localPath} width must match its descriptor`);
      assert.equal(
        dimensions.width * 3,
        dimensions.height * 4,
        `${localPath} must retain the 4:3 hero aspect ratio`
      );
    }
  }
});

test("hero image has no entrance animation and decorative keyframes are removed", async () => {
  const stylesSource = await readUtf8("styles.css");
  assert.doesNotMatch(
    stylesSource,
    /\.motion-ready\s+\.hero-visual\s+img\s*\{[^}]*animation:/,
    "Hero visual img must not have an entrance animation (delays LCP under throttling)"
  );
  assert.doesNotMatch(
    stylesSource,
    /@keyframes\s+photo-/,
    "No photo-* keyframe animation must exist for the hero image"
  );
  assert.doesNotMatch(
    stylesSource,
    /@keyframes\s+brand-marker/,
    "brand-marker keyframes must be removed (decorative GPU animation)"
  );
});

test("contact link hover transitions do not animate layout properties", async () => {
  const stylesSource = await readUtf8("styles.css");
  const contactLinkRule = stylesSource.match(/\.contact-links a\s*\{([^}]*)\}/s)?.[1];
  const contactHoverRule = stylesSource.match(/\.contact-links a:hover\s*\{([^}]*)\}/s)?.[1];
  const layoutPropertyPattern = /\b(?:padding|margin|width|height|inset|top|right|bottom|left)(?:-[a-z]+)?\b/;

  assert.ok(contactLinkRule, "Contact links must keep their base styling");
  assert.ok(contactHoverRule, "Contact links must keep a pointer hover state");
  assert.doesNotMatch(
    contactLinkRule.match(/transition\s*:[^;]+;/s)?.[0] ?? "",
    layoutPropertyPattern,
    "Contact link transitions must not animate layout properties"
  );
  assert.doesNotMatch(
    contactHoverRule,
    layoutPropertyPattern,
    "Contact link hover must not change layout properties"
  );
  assert.match(
    contactHoverRule,
    /\bbackground(?:-color)?\s*:/,
    "Contact link hover must retain a restrained color signal"
  );
});

test("project rows stay visible by default and reveal machinery is bounded and safe", async () => {
  const stylesSource = await readUtf8("styles.css");
  const scriptSource = await readUtf8("script.js");

  // Base state: every row is visible with zero JS dependency. No rule
  // outside a .js-enabled + no-preference guard may set opacity/transform
  // on .project-row.
  assert.match(
    stylesSource,
    /\.project-row\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*none;/s,
    ".project-row base rule must default to fully visible with no transform"
  );

  const primingRule = stylesSource.match(
    /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{\s*\.js-enabled\s+\.project-row\s*\{([^}]*)\}\s*\.js-enabled\s+\.project-row\.is-priming\s*\{([^}]*)\}/s
  );
  assert.ok(
    primingRule,
    "The priming/reveal transition must be scoped to .js-enabled AND prefers-reduced-motion: no-preference"
  );
  assert.match(
    primingRule[1],
    /--row-index/,
    "The reveal transition delay must derive from a per-row --row-index custom property"
  );
  assert.match(
    primingRule[1],
    /min\(var\(--row-index,\s*0\),\s*9\)/,
    "The stagger must be capped (min() clamp) rather than growing unbounded with row count"
  );
  assert.match(
    primingRule[2],
    /transition:\s*none/,
    "Entering the primed (hidden) state must be instant, never itself an animated hide"
  );

  // script.js: only ever primes a row when JS + IntersectionObserver +
  // no motion preference are all present (re-evaluated on every render
  // via a function, not captured once, so a runtime preference change
  // takes effect for the next render), always with a one-time observer
  // (unobserve on reveal) and a hard timeout safety net.
  assert.match(
    scriptSource,
    /function shouldAnimateProjectReveal\(\)\s*\{\s*return\s*!prefersReducedMotion\s*&&\s*supportsIntersectionObserver;/,
    "Reveal priming must be gated on both reduced-motion and IntersectionObserver support, re-evaluated per render"
  );
  assert.match(
    scriptSource,
    /const animateReveal = shouldAnimateProjectReveal\(\);/,
    "renderProjects must re-read the live reveal gate on every call, not a value captured once at load"
  );
  assert.match(
    scriptSource,
    /classList\.add\("is-priming"\)/,
    "script.js must prime rows for the bounded reveal"
  );
  assert.match(
    scriptSource,
    /observer\.unobserve\(entry\.target\)/,
    "Each row's reveal must be one-time (unobserve after it fires)"
  );
  assert.match(
    scriptSource,
    /setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?classList\.remove\("is-priming"\)/,
    "script.js must include a timeout safety net that clears any stuck priming class"
  );
  assert.match(
    scriptSource,
    /function disarmProjectReveal\(\)\s*\{[\s\S]*?projectRevealObserver\?\.disconnect\(\);[\s\S]*?classList\.remove\("is-priming"\)/,
    "A runtime switch to reduced motion must disconnect the observer and clear any stale priming class"
  );
  assert.doesNotMatch(
    scriptSource,
    /\bprojectObserver\b|\bsetupProjectMotion\b|--project-index/,
    "script.js must not restore the old rejected reveal symbol names"
  );
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
