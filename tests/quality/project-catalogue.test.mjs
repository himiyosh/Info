import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

const repoRoot = process.cwd();
const pagesWhitelistPath = ".github/pages-artifact-whitelist.txt";
const projectPreviewAvifBaselineBytes = 554_001;
const projectPreviewAvifMaximumBytes = 200_000;
const projectPreviewMinimumSavingsRatio = 0.6;
const projectPreviewDesktopJpegBaselineBytes = 524_923;
const projectPreviewDesktopAvifMaximumRatio = 0.5;
const projectPreviewDesktopMedia = "(min-width: 48rem)";
const projectPreviewMobileMedia = "(max-width: 47.999rem)";

const readUtf8 = (relativePath) => readFile(path.join(repoRoot, relativePath), "utf8");

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

function githubRepositoryKey(url) {
  if (
    url.protocol !== "https:" ||
    url.hostname.toLocaleLowerCase("en-US") !== "github.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  const pathSegments = url.pathname.split("/").filter(Boolean);
  if (pathSegments.length !== 2) {
    return null;
  }
  return `${pathSegments[0]}/${pathSegments[1].replace(/\.git$/i, "")}`
    .toLocaleLowerCase("en-US");
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

test("projects.json schema, localization, links, and preview assets are valid", async () => {
  const projects = JSON.parse(await readUtf8("projects.json"));
  const whitelistSet = new Set(
    parseWhitelistEntries(await readUtf8(pagesWhitelistPath))
  );
  assert.ok(Array.isArray(projects), "projects.json must be an array");
  assert.ok(projects.length > 0, "projects.json must contain at least one project");

  const localizedFields = ["title", "kind", "description", "action", "imageAlt"];
  const requiredStringFields = [
    "slug",
    "link",
    "image",
    "desktopImageAvif",
    "mobileImageAvif"
  ];
  const projectSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const reservedProjectSlugs = new Set([
    "top",
    "about",
    "projects",
    "contact",
    "main-content"
  ]);
  const seenSlugs = new Set();
  const seenLinks = new Set();
  const seenAssets = new Set();
  const seenProofTexts = new Set();

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

    assert.match(
      project.slug,
      projectSlugPattern,
      `Project ${index + 1} slug must use lowercase kebab-case`
    );
    assert.ok(
      !reservedProjectSlugs.has(project.slug),
      `Project ${index + 1} slug must not use a reserved top-level ID`
    );
    assert.ok(!seenSlugs.has(project.slug), `Duplicate project slug found: ${project.slug}`);
    seenSlugs.add(project.slug);

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

    const hasProof = Object.hasOwn(project, "proof");
    const hasProofLink = Object.hasOwn(project, "proofLink");
    assert.equal(
      hasProof,
      hasProofLink,
      `Project ${index + 1} proof and proofLink must be provided together`
    );
    if (hasProof) {
      assert.equal(typeof project.proof, "object", `Project ${index + 1} proof must be localized`);
      assert.ok(project.proof, `Project ${index + 1} proof must exist`);
      for (const language of ["ja", "en"]) {
        const proofText = project.proof[language];
        assert.equal(
          typeof proofText,
          "string",
          `Project ${index + 1} field "proof.${language}" must be a string`
        );
        assert.notEqual(
          proofText.trim(),
          "",
          `Project ${index + 1} field "proof.${language}" must not be empty`
        );
        const normalizedProofText = proofText.trim().toLocaleLowerCase(language);
        const comparisonFields = [
          ...localizedFields,
          ...(hasSourceAction ? ["sourceAction"] : [])
        ];
        assert.ok(
          comparisonFields.every(
            (fieldName) =>
              project[fieldName][language].trim().toLocaleLowerCase(language) !==
              normalizedProofText
          ) &&
            (!Array.isArray(project.stack) ||
              project.stack.every(
                (stackItem) =>
                  stackItem.trim().toLocaleLowerCase(language) !== normalizedProofText
              )),
          `Project ${index + 1} proof must add information beyond existing card copy in ${language}`
        );
        const proofTextKey = `${language}:${normalizedProofText}`;
        assert.ok(
          !seenProofTexts.has(proofTextKey),
          `Project ${index + 1} proof text must be unique in ${language}`
        );
        seenProofTexts.add(proofTextKey);
      }

      assert.equal(
        typeof project.proofLink,
        "string",
        `Project ${index + 1} proofLink must be a string`
      );
      const proofUrl = new URL(project.proofLink);
      const blobMatch = proofUrl.pathname.match(
        /^\/([^/]+)\/([^/]+)\/blob\/([0-9a-f]{40})\/.+$/i
      );
      const lineMatch = proofUrl.hash.match(/^#L(\d+)(?:-L(\d+))?$/);
      assert.equal(proofUrl.protocol, "https:", `Project ${index + 1} proofLink must use HTTPS`);
      assert.equal(proofUrl.hostname, "github.com", `Project ${index + 1} proofLink must use GitHub`);
      assert.equal(proofUrl.username, "", `Project ${index + 1} proofLink must not include a username`);
      assert.equal(proofUrl.password, "", `Project ${index + 1} proofLink must not include a password`);
      assert.equal(proofUrl.port, "", `Project ${index + 1} proofLink must not include a port`);
      assert.equal(proofUrl.search, "", `Project ${index + 1} proofLink must not include a query`);
      assert.ok(blobMatch, `Project ${index + 1} proofLink must pin a 40-character commit SHA`);
      assert.ok(lineMatch, `Project ${index + 1} proofLink must include a bounded line anchor`);
      assert.ok(
        !lineMatch?.[2] || Number(lineMatch[2]) >= Number(lineMatch[1]),
        `Project ${index + 1} proofLink line range must be ordered`
      );
      const proofRepositoryKey = `${blobMatch[1]}/${blobMatch[2].replace(/\.git$/i, "")}`
        .toLocaleLowerCase("en-US");
      const publicRepositoryKeys = new Set(
        [githubRepositoryKey(linkUrl), hasSourceLink ? githubRepositoryKey(new URL(project.sourceLink)) : null]
          .filter(Boolean)
      );
      assert.ok(
        publicRepositoryKeys.has(proofRepositoryKey),
        `Project ${index + 1} proofLink must match an exposed public repository action`
      );
      const normalizedProofLink = proofUrl.toString();
      assert.ok(
        !seenLinks.has(normalizedProofLink),
        `Duplicate project proof link found: ${project.proofLink}`
      );
      seenLinks.add(normalizedProofLink);
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

test("exactly eight public projects expose reviewed immutable proof citations", async () => {
  const projects = JSON.parse(await readUtf8("projects.json"));
  const expectedProofs = new Map([
    [
      "Portfolio",
      {
        ja: "公開成果物は許可リストに限定し、テスト・ワークフロー・内部ドキュメントを配信対象から除外しています。",
        en: "The deployed artifact is allowlisted so tests, workflows, and internal docs are excluded from publication.",
        link: "https://github.com/himiyosh/Info/blob/a1e0e2bb1e2acefce7e9795b08a4486776ddb3bb/README.md#L25-L33"
      }
    ],
    [
      "TechDB",
      {
        ja: "自動収集データは、秘密情報検査・型検査・ユニットテスト・Web build・ブラウザーE2Eを通過した場合だけ公開用コミットへ進みます。",
        en: "Collected data advances to a publication commit only after secret scanning, type checks, unit tests, the web build, and browser E2E pass.",
        link: "https://github.com/himiyosh/tech-dashboard/blob/6fde819e689fb8f19a238b1877484d8db596c59b/.github/workflows/publisher.yml#L71-L89"
      }
    ],
    [
      "AI Agents: What Is Happening Right Now?",
      {
        ja: "Reader は見出し・本文・全タブ状態・発表者ノート・出典を横断検索し、目次から任意のスライドへ直接移動できます。",
        en: "Reader searches headings, body text, every tab state, speaker notes, and citations, with direct navigation from its slide index.",
        link: "https://github.com/himiyosh/JoJo-AIAgent/blob/95e404c45bc9cd8a4c0ccbf637acc29021c8e437/README.md#L34-L40"
      }
    ],
    [
      "Git, Not Scary",
      {
        ja: "Reader はスライド本文・実レンダリング・公開登壇者ノートからビルド時に生成され、本文を二重管理しません。",
        en: "Reader is generated at build time from the slide source, rendered presentation, and public speaker notes without duplicate body copy.",
        link: "https://github.com/himiyosh/JoJo-Git/blob/c62e726c212551ac91a3c245167e0a0fc9877bb4/README.md#L31-L40"
      }
    ],
    [
      "Encode / Decode Tool",
      {
        ja: "テキスト変換とQR画像処理はブラウザー内で完結し、入力テキスト・生成QR・選択画像をアップロードしません。",
        en: "Text transforms and QR image processing stay in the browser; entered text, generated QR codes, and selected images are not uploaded.",
        link: "https://github.com/himiyosh/encode-decode-tool/blob/a1e40092f538f85f34a935188e67ef5aa657481f/README.md#L33-L35"
      }
    ],
    [
      "Network+",
      {
        ja: "コピーとHAR出力は既定で認証情報・Cookie・クエリ値・本文をサニタイズし、完全出力は警告確認後の1回だけ有効です。",
        en: "Clipboard and HAR exports sanitize credentials, cookies, query values, and bodies by default; full output requires one-time confirmation.",
        link: "https://github.com/himiyosh/network-plus-extension/blob/f1d53ce821c6b7ca8cf11b7101f800087ab19ac4/README.md#L128-L140"
      }
    ],
    [
      "URLDecoder",
      {
        ja: "入力を encodeURIComponent / decodeURIComponent で処理し、変換結果または失敗理由を出力欄に表示します。",
        en: "Input is processed with encodeURIComponent or decodeURIComponent, and the output field shows either the result or the failure reason.",
        link: "https://github.com/himiyosh/URLDecoder/blob/fa686afa5196dd7dc9432c7ab916d5376dc69954/index.html#L108-L126"
      }
    ],
    [
      "ImageResizer",
      {
        ja: "選択画像をブラウザー内で読み込み、192px と 32px の canvas に描画して PNG ダウンロードリンクを生成します。",
        en: "The selected image is read in-browser, drawn to 192px and 32px canvases, and exposed as PNG download links.",
        link: "https://github.com/himiyosh/ImageResizer/blob/f79765b06964bc1918dad7222f1c657d5d0312ca/index.html#L48-L84"
      }
    ]
  ]);
  const projectsWithProof = projects.filter((project) => Object.hasOwn(project, "proof"));

  assert.equal(projectsWithProof.length, expectedProofs.size);
  for (const project of projectsWithProof) {
    const expected = expectedProofs.get(project.title.en);
    assert.ok(expected, `Unexpected proof-bearing project: ${project.title.en}`);
    assert.deepEqual(project.proof, { ja: expected.ja, en: expected.en });
    assert.equal(project.proofLink, expected.link);
  }
  for (const project of projects.filter((entry) => !expectedProofs.has(entry.title.en))) {
    assert.equal(Object.hasOwn(project, "proof"), false);
    assert.equal(Object.hasOwn(project, "proofLink"), false);
  }
});

test("project runtime rejects incomplete, malformed, duplicate, and primary-equal source actions", async () => {
  const scriptSource = await readUtf8("scripts/generate-static-pages.mjs");
  const projects = JSON.parse(await readUtf8("projects.json"));
  const validatorDeclarations = [
    "requireNonEmptyString",
    "validateStableSlug",
    "githubRepositoryKey",
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
      projectSlugPattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      reservedProjectSlugs: new Set([
        "top",
        "about",
        "works",
        "stack",
        "contact",
        "main-content"
      ])
    },
    { timeout: 1000 }
  );
  const cloneProjects = () => JSON.parse(JSON.stringify(projects));
  const validateCatalogue = (catalogue) => {
    const seenSlugs = new Set();
    const seenLinks = new Set();
    const seenAssets = new Set();
    const seenProofTexts = new Set();
    catalogue.forEach((project, index) =>
      validateProject(
        project,
        index,
        seenSlugs,
        seenLinks,
        seenAssets,
        seenProofTexts
      )
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

  const missingProofLink = cloneProjects();
  delete missingProofLink[0].proofLink;
  assert.throws(() => validateCatalogue(missingProofLink), /must be provided together/);

  const incompleteProof = cloneProjects();
  delete incompleteProof[0].proof.en;
  assert.throws(() => validateCatalogue(incompleteProof), /proof\.en.*non-empty string/);

  const matchingProof = cloneProjects();
  matchingProof[0].proof = { ...matchingProof[0].description };
  assert.throws(() => validateCatalogue(matchingProof), /must add information beyond existing card copy/);

  const duplicateProof = cloneProjects();
  duplicateProof[2].proof.ja = duplicateProof[1].proof.ja;
  assert.throws(() => validateCatalogue(duplicateProof), /Duplicate project proof text detected/);

  const mutableProofLink = cloneProjects();
  mutableProofLink[0].proofLink =
    "https://github.com/himiyosh/Info/blob/main/README.md#L25-L33";
  assert.throws(() => validateCatalogue(mutableProofLink), /immutable GitHub blob HTTPS URL/);

  const unboundedProofLink = cloneProjects();
  unboundedProofLink[0].proofLink =
    "https://github.com/himiyosh/Info/blob/a1e0e2bb1e2acefce7e9795b08a4486776ddb3bb/README.md";
  assert.throws(() => validateCatalogue(unboundedProofLink), /immutable GitHub blob HTTPS URL/);

  // Anchored by slug, not position: tech-dashboard is only "foreign" to a
  // project that is not TechDB, and display order is free to change.
  const foreignProofLink = cloneProjects();
  const foreignTarget = foreignProofLink.find((entry) => entry.slug !== "techdb");
  foreignTarget.proofLink =
    "https://github.com/himiyosh/tech-dashboard/blob/6fde819e689fb8f19a238b1877484d8db596c59b/.github/workflows/publisher.yml#L71-L89";
  assert.throws(() => validateCatalogue(foreignProofLink), /must match an existing public GitHub repository action/);

  const invalidLineRange = cloneProjects();
  invalidLineRange[0].proofLink =
    "https://github.com/himiyosh/Info/blob/a1e0e2bb1e2acefce7e9795b08a4486776ddb3bb/README.md#L33-L25";
  assert.throws(() => validateCatalogue(invalidLineRange), /invalid line range/);

  const privateEntryProof = cloneProjects();
  privateEntryProof[4].proof = { ...privateEntryProof[0].proof };
  privateEntryProof[4].proof.ja += " 追加";
  privateEntryProof[4].proof.en += " Additional.";
  privateEntryProof[4].proofLink = privateEntryProof[0].proofLink;
  assert.throws(
    () => validateCatalogue(privateEntryProof),
    /must match an existing public GitHub repository action/
  );

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
  const generatorSource = await readUtf8("scripts/generate-static-pages.mjs");
  const stylesSource = await readUtf8("styles.css");
  const modernSource = await readUtf8("modern.css");
  const indexHtml = await readUtf8("index.html");
  const cardsBody = extractObjectLiteral(generatorSource, "export function renderProjectFeaturedCards");
  const rowsBody = extractObjectLiteral(generatorSource, "export function renderProjectPanelRows");
  const linkBody = extractObjectLiteral(generatorSource, "function externalLinkMarkup");

  // Every baked external action opens safely and announces the new tab.
  assert.match(linkBody, /target="_blank" rel="noopener noreferrer"/);
  assert.match(linkBody, /accessibility\.opensInNewTab/);
  assert.match(linkBody, /aria-hidden="true"/);
  assert.match(rowsBody, /target="_blank" rel="noopener noreferrer"/);
  assert.match(rowsBody, /accessibility\.opensInNewTab/);

  // Primary before source inside every card's links group.
  const primaryFirst = cardsBody.indexOf("externalLinkMarkup(link, action, language");
  const sourceSecond = cardsBody.indexOf("externalLinkMarkup(source.url, source.text, language");
  assert.ok(
    primaryFirst > -1 && sourceSecond > primaryFirst,
    "Primary live action must precede the secondary source action in DOM and focus order"
  );

  // Rendered output: no unsafe external anchors anywhere in the catalogue.
  for (const anchor of indexHtml.matchAll(/<a\b[^>]*href="https?:[^"]+"[^>]*>/gi)) {
    assert.match(anchor[0], /rel="(?:me )?noopener noreferrer"/, anchor[0]);
    assert.match(anchor[0], /target="_blank"/, anchor[0]);
  }

  assert.match(
    modernSource,
    /\.link\s*\{[^}]*display:\s*inline-flex;[^}]*gap:\s*0\.45rem;/s,
    "Card actions must keep their inline-flex row with the arrow"
  );
  assert.match(
    stylesSource,
    /:where\(a, button\):focus-visible\s*\{\s*outline:\s*3px solid var\(--color-focus\);/,
    "Project actions must inherit the visible global focus ring"
  );
  assert.match(
    modernSource,
    /\.row-link\s*\{[^}]*outline-offset:\s*-3px;/s,
    "The stretched row link must ride its focus ring inside the row"
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
  const generatorSource = await readUtf8("scripts/generate-static-pages.mjs");
  const validateAssetBody = extractObjectLiteral(
    generatorSource,
    "function validateLocalProjectAsset"
  );
  const validateProjectBody = extractObjectLiteral(generatorSource, "function validateProject");
  const validateProjectsBody = extractObjectLiteral(
    generatorSource,
    "export function validateProjects"
  );

  assert.match(validateAssetBody, /requireNonEmptyString\(\s*project\[fieldName\]/);
  assert.match(validateAssetBody, /assetUrl\.origin !==/);
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
  assert.match(validateProjectsBody, /const seenAssets = new Set\(\)/);
  assert.match(
    validateProjectsBody,
    /validateProject\(project, index, seenSlugs, seenLinks, seenAssets, seenProofTexts\)/,
    "JPEG and AVIF paths must share one uniqueness set so cross-field collisions are rejected"
  );
  // The build additionally pins the responsive naming convention.
  assert.match(validateProjectsBody, /-960w\.avif/);
  assert.match(validateProjectsBody, /-720w\.avif/);
});
test("project rendering emits mutually exclusive AVIF sources before lazy JPEG fallbacks", async () => {
  const indexHtml = await readUtf8("index.html");
  const cardBlocks = [...indexHtml.matchAll(
    /<article\b[^>]*\bclass="card[^"]*"[^>]*>[\s\S]*?<\/article>/gi
  )].map(([block]) => block);
  assert.equal(cardBlocks.length, 3);

  for (const block of cardBlocks) {
    const sourceIndex = block.search(/<source type="image\/avif" srcset="[^"]+-960w\.avif"/);
    const imgIndex = block.search(/<img src="[^"]+\.jpg"[^>]*loading="lazy"[^>]*decoding="async"/);
    assert.ok(sourceIndex > -1, "Every card must offer its AVIF source");
    assert.ok(imgIndex > sourceIndex, "The AVIF source must precede the lazy JPEG fallback");
    assert.match(block, /<img[^>]*width="960" height="540"/);
  }
});
