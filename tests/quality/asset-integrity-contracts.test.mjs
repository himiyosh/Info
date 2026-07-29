import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  attributeValue,
  parseSrcsetEntries
} from "../helpers/asset-reference-parsing.mjs";

const repoRoot = process.cwd();
const retiredPortfolioPreviewSha256 =
  "34ef4fb416975ff4e3e4b0a766e922d49f4679b16dc96b3413d155a99508d095";
const pagesWhitelistPath = ".github/pages-artifact-whitelist.txt";

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
    const localPath = path.join(repoRoot, localReference);
    const fileStats = await stat(localPath);
    if (fileStats.isDirectory()) {
      const routeIndex = await stat(path.join(localPath, "index.html"));
      assert.ok(routeIndex.isFile(), `Missing route index: ${localReference}index.html`);
    } else {
      assert.ok(fileStats.isFile(), `Missing referenced local file: ${localReference}`);
    }
  }
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

