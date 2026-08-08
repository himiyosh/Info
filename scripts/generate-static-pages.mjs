#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { translations } = require("../i18n.js");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(repoRoot, "templates/index.html");
const notFoundTemplatePath = path.join(repoRoot, "templates/404.html");
const projectsPath = path.join(repoRoot, "projects.json");
const canonicalProjects = JSON.parse(await readFile(projectsPath, "utf8"));
const checkOnly = process.argv.includes("--check");
const canonicalRoot = "https://himiyosh.github.io/Info/";
const projectSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const projectImagePattern = /^assets\/[a-z0-9]+(?:-[a-z0-9]+)*\.jpg$/;
const reservedProjectSlugs = new Set(["top", "about", "works", "stack", "contact", "main-content"]);

// The first FEATURED_COUNT entries of projects.json render as featured
// cards (the first of them wide); the rest render as panel rows. Layout is
// a consequence of file order, so reordering projects.json is the whole
// editorial interface.
const FEATURED_COUNT = 3;

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
export const notFoundPage = {
  outputPath: "404.html"
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function projectString(project, index, field) {
  const value = project?.[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Missing project ${field} at index ${index}.`);
  }
  return value;
}

function localizedProjectString(project, index, field, language) {
  const value = project?.[field]?.[language];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Missing ${language} project ${field} at index ${index}.`);
  }
  return value;
}

function projectUrl(project, index, field, { httpsOnly = false } = {}) {
  const value = projectString(project, index, field);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`Project ${field} at index ${index} must be an absolute URL.`);
  }

  const allowedProtocols = httpsOnly ? ["https:"] : ["http:", "https:"];
  if (!allowedProtocols.includes(url.protocol)) {
    throw new TypeError(`Project ${field} at index ${index} uses an unsupported protocol.`);
  }
  return value;
}

function optionalProjectPair(project, index, localizedField, urlField, language) {
  const hasLocalizedField = Object.hasOwn(project, localizedField);
  const hasUrlField = Object.hasOwn(project, urlField);
  if (hasLocalizedField !== hasUrlField) {
    throw new TypeError(
      `Project ${localizedField} and ${urlField} at index ${index} must be provided together.`
    );
  }
  if (!hasLocalizedField) {
    return null;
  }
  return {
    text: localizedProjectString(project, index, localizedField, language),
    url: projectUrl(project, index, urlField, { httpsOnly: true })
  };
}

function projectImage(project, index) {
  const value = projectString(project, index, "image");
  if (!projectImagePattern.test(value)) {
    throw new TypeError(
      `Project image at index ${index} must be a root-relative assets JPEG path.`
    );
  }
  return value;
}

function projectStack(project, index) {
  if (!Array.isArray(project.stack) || project.stack.length === 0) {
    throw new TypeError(`Project stack at index ${index} must be a non-empty array.`);
  }
  const seen = new Set();
  return project.stack.map((item, stackIndex) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new TypeError(
        `Project stack item ${stackIndex} at index ${index} must be a non-empty string.`
      );
    }
    const normalized = item.trim().toLocaleLowerCase("en-US");
    if (seen.has(normalized)) {
      throw new TypeError(`Duplicate project stack item at index ${index}: ${item}`);
    }
    seen.add(normalized);
    return item;
  });
}

function projectTargetId(project, index, seenSlugs) {
  const slug = projectString(project, index, "slug");
  if (!projectSlugPattern.test(slug)) {
    throw new TypeError(`Project slug at index ${index} must use lowercase kebab-case.`);
  }
  if (reservedProjectSlugs.has(slug)) {
    throw new TypeError(`Project slug at index ${index} is reserved.`);
  }
  if (seenSlugs.has(slug)) {
    throw new TypeError(`Duplicate project slug: ${slug}`);
  }
  seenSlugs.add(slug);
  return `project-${slug}`;
}

function localizedTranslation(language, key, replacements = {}) {
  let value = key
    .split(".")
    .reduce((result, part) => result?.[part], translations[language]);
  if (typeof value !== "string") {
    throw new TypeError(`Missing ${language} translation for project key: ${key}`);
  }
  for (const [placeholder, replacement] of Object.entries(replacements)) {
    value = value.replaceAll(`{${placeholder}}`, replacement);
  }
  return value;
}

function templateTranslation(language, key, templateName) {
  const value = key
    .split(".")
    .reduce((result, part) => result?.[part], translations[language]);
  if (typeof value !== "string") {
    throw new TypeError(`Missing ${language} translation for ${templateName} key: ${key}`);
  }
  return value;
}

function projectIsSourceHosted(project, index) {
  return new URL(projectUrl(project, index, "link")).hostname === "github.com";
}

// Every entry is fully validated at build time regardless of which section
// renders it, so malformed data cannot ship just because the field it broke
// is not visible in that entry's layout.
export function validateProjects(projects) {
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new TypeError("projects.json must contain a non-empty array.");
  }

  const seenSlugs = new Set();
  projects.forEach((project, index) => {
    projectTargetId(project, index, seenSlugs);
    for (const language of ["ja", "en"]) {
      localizedProjectString(project, index, "title", language);
      localizedProjectString(project, index, "kind", language);
      localizedProjectString(project, index, "description", language);
      localizedProjectString(project, index, "imageAlt", language);
      localizedProjectString(project, index, "action", language);
      optionalProjectPair(project, index, "sourceAction", "sourceLink", language);
      optionalProjectPair(project, index, "proof", "proofLink", language);
    }
    projectUrl(project, index, "link");
    projectStack(project, index);
    const image = projectImage(project, index);
    const expectedDesktop = image.replace(/\.jpg$/, "-960w.avif");
    const expectedMobile = image.replace(/\.jpg$/, "-720w.avif");
    if (projectString(project, index, "desktopImageAvif") !== expectedDesktop) {
      throw new TypeError(`Project desktopImageAvif at index ${index} must be ${expectedDesktop}.`);
    }
    if (projectString(project, index, "mobileImageAvif") !== expectedMobile) {
      throw new TypeError(`Project mobileImageAvif at index ${index} must be ${expectedMobile}.`);
    }
  });
}

function externalLinkMarkup(href, label, language, indentation) {
  return [
    `${indentation}<a class="link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">`,
    `${indentation}  ${escapeHtml(label)}`,
    `${indentation}  <span class="sr-only">${escapeHtml(localizedTranslation(language, "accessibility.opensInNewTab"))}</span>`,
    `${indentation}  <span class="ext" aria-hidden="true">↗</span>`,
    `${indentation}</a>`
  ].join("\n");
}

export function renderProjectFeaturedCards(projects, page, indentation = "") {
  const { language, siteRoot } = page;
  const previewLabel = localizedTranslation(language, "projects.previewLabel");

  return projects.slice(0, FEATURED_COUNT).map((project, index) => {
    const slug = projectString(project, index, "slug");
    const title = localizedProjectString(project, index, "title", language);
    const kind = localizedProjectString(project, index, "kind", language);
    const description = localizedProjectString(project, index, "description", language);
    const action = localizedProjectString(project, index, "action", language);
    const imageAlt = localizedProjectString(project, index, "imageAlt", language);
    const image = projectImage(project, index);
    const link = projectUrl(project, index, "link");
    const source = optionalProjectPair(project, index, "sourceAction", "sourceLink", language);
    const stack = projectStack(project, index);
    const initial = localizedProjectString(project, index, "title", "en")
      .charAt(0)
      .toLocaleUpperCase("en-US");

    const card = [
      `${indentation}<article class="card${index === 0 ? " wide" : ""}" id="project-${slug}">`,
      `${indentation}  <div class="thumb" data-initial="${escapeHtml(initial)}" data-label="${escapeHtml(previewLabel)}">`,
      `${indentation}    <span class="badge">${escapeHtml(kind)}</span>`,
      `${indentation}    <picture>`,
      `${indentation}      <source type="image/avif" srcset="${escapeHtml(`${siteRoot}${project.desktopImageAvif}`)}" />`,
      `${indentation}      <img src="${escapeHtml(`${siteRoot}${image}`)}" alt="${escapeHtml(imageAlt)}" width="960" height="540" loading="lazy" decoding="async" />`,
      `${indentation}    </picture>`,
      `${indentation}  </div>`,
      `${indentation}  <div class="body">`,
      `${indentation}    <h3>${escapeHtml(title)}</h3>`,
      `${indentation}    <p>${escapeHtml(description)}</p>`,
      `${indentation}    <div class="tags">${stack.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`,
      `${indentation}    <div class="links">`,
      externalLinkMarkup(link, action, language, `${indentation}      `)
    ];
    if (source) {
      card.push(externalLinkMarkup(source.url, source.text, language, `${indentation}      `));
    }
    card.push(
      `${indentation}    </div>`,
      `${indentation}  </div>`,
      `${indentation}</article>`
    );
    return card.join("\n");
  }).join("\n");
}

export function renderProjectPanelRows(projects, page, indentation = "") {
  const { language } = page;

  return projects.slice(FEATURED_COUNT).map((project, offset) => {
    const index = FEATURED_COUNT + offset;
    const slug = projectString(project, index, "slug");
    const title = localizedProjectString(project, index, "title", language);
    const kind = localizedProjectString(project, index, "kind", language);
    const link = projectUrl(project, index, "link");
    const stack = projectStack(project, index);
    const sourceHosted = projectIsSourceHosted(project, index);
    const status = localizedTranslation(
      language,
      sourceHosted ? "projects.statusSource" : "projects.statusLive"
    );
    const go = localizedTranslation(
      language,
      sourceHosted ? "projects.goCode" : "projects.goOpen"
    );

    return [
      `${indentation}<div class="row" role="listitem" id="project-${slug}">`,
      `${indentation}  <span class="status${sourceHosted ? " src" : ""}" aria-hidden="true">${escapeHtml(status)}</span>`,
      `${indentation}  <a class="row-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">`,
      `${indentation}    <span class="name">${escapeHtml(title)}</span>`,
      `${indentation}    <span class="sr-only">${escapeHtml(localizedTranslation(language, "accessibility.opensInNewTab"))}</span>`,
      `${indentation}  </a>`,
      `${indentation}  <span class="type">${escapeHtml(kind)}</span>`,
      `${indentation}  <span class="stack">${stack.map(escapeHtml).join(" · ")}</span>`,
      `${indentation}  <span class="go" aria-hidden="true">${escapeHtml(go)}</span>`,
      `${indentation}</div>`
    ].join("\n");
  }).join("\n");
}

export function renderPage(template, page, projects = canonicalProjects) {
  validateProjects(projects);

  let output = template.replace(/\{\{t:([a-zA-Z0-9.]+)\}\}/g, (_match, key) => {
    return escapeHtml(templateTranslation(page.language, key, "home template"));
  });

  output = output.replace(
    /^([ \t]*)\{\{projectFeaturedCards\}\}[ \t]*$/m,
    (_match, indentation) => renderProjectFeaturedCards(projects, page, indentation)
  );
  output = output.replace(
    /^([ \t]*)\{\{projectPanelRows\}\}[ \t]*$/m,
    (_match, indentation) => renderProjectPanelRows(projects, page, indentation)
  );

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
    "<!DOCTYPE html>\n<!-- Generated from templates/index.html, i18n.js, and projects.json. Run npm run generate:pages. -->"
  );
}

export function renderNotFoundPage(template) {
  let output = template.replace(
    /\{\{t:(ja|en):([a-zA-Z0-9.]+)\}\}/g,
    (_match, language, key) =>
      escapeHtml(templateTranslation(language, key, "404 template"))
  );

  const unresolved = [...output.matchAll(/\{\{([^}]+)\}\}/g)].map((match) => match[1]);
  if (unresolved.length > 0) {
    throw new Error(
      `Unresolved template values for ${notFoundPage.outputPath}: ${[...new Set(unresolved)].join(", ")}`
    );
  }

  return output.replace(
    "<!DOCTYPE html>",
    "<!DOCTYPE html>\n<!-- Generated from templates/404.html and i18n.js. Run npm run generate:pages. -->"
  );
}

export async function main() {
  if (!translations?.ja || !translations?.en) {
    throw new Error("i18n.js must export Japanese and English translations.");
  }

  const [template, notFoundTemplate] = await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(notFoundTemplatePath, "utf8")
  ]);
  const staleOutputs = [];
  const outputs = [
    ...pages.map((page) => ({
      outputPath: page.outputPath,
      expected: renderPage(template, page)
    })),
    {
      outputPath: notFoundPage.outputPath,
      expected: renderNotFoundPage(notFoundTemplate)
    }
  ];

  for (const output of outputs) {
    const outputPath = path.join(repoRoot, output.outputPath);

    if (checkOnly) {
      const actual = await readFile(outputPath, "utf8").catch((error) => {
        if (error.code === "ENOENT") {
          return null;
        }
        throw error;
      });
      if (actual !== output.expected) {
        staleOutputs.push(output.outputPath);
      }
      continue;
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output.expected, "utf8");
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
