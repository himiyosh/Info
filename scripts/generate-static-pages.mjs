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
const reservedProjectSlugs = new Set(["top", "about", "projects", "contact", "main-content"]);
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
    throw new TypeError(`Missing ${language} translation for project fallback key: ${key}`);
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

function fallbackActionMarkup(href, label, variant, language, indentation) {
  return [
    `${indentation}<a class="project-link project-link--${variant} projects-fallback-action" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">`,
    `${indentation}  <span>${escapeHtml(label)}</span>`,
    `${indentation}  <span class="sr-only">${escapeHtml(localizedTranslation(language, "accessibility.opensInNewTab"))}</span>`,
    `${indentation}  <span class="project-link-arrow" aria-hidden="true">↗</span>`,
    `${indentation}</a>`
  ].join("\n");
}

export function renderProjectFallbackSummaries(projects, language, indentation = "") {
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new TypeError("projects.json must contain a non-empty array.");
  }

  const seenSlugs = new Set();
  return projects
    .map((project, index) => {
      const targetId = projectTargetId(project, index, seenSlugs);
      const titleId = `${targetId}-fallback-title`;
      const title = localizedProjectString(project, index, "title", language);
      const kind = localizedProjectString(project, index, "kind", language);
      const description = localizedProjectString(project, index, "description", language);
      const action = localizedProjectString(project, index, "action", language);
      const link = projectUrl(project, index, "link");
      const hasSourceAction = Object.hasOwn(project, "sourceAction");
      const hasSourceLink = Object.hasOwn(project, "sourceLink");
      const hasProof = Object.hasOwn(project, "proof");
      const hasProofLink = Object.hasOwn(project, "proofLink");
      if (hasSourceAction !== hasSourceLink) {
        throw new TypeError(
          `Project sourceAction and sourceLink at index ${index} must be provided together.`
        );
      }
      if (hasProof !== hasProofLink) {
        throw new TypeError(
          `Project proof and proofLink at index ${index} must be provided together.`
        );
      }

      const summary = [
        `${indentation}<li>`,
        `${indentation}  <article class="projects-fallback-card" id="${targetId}" tabindex="-1" aria-labelledby="${titleId}">`,
        `${indentation}    <header class="projects-fallback-heading">`,
        `${indentation}      <h3 class="projects-fallback-title" id="${titleId}">${escapeHtml(title)}</h3>`,
        `${indentation}      <a class="project-permalink projects-fallback-permalink" href="#${targetId}" aria-label="${escapeHtml(localizedTranslation(language, "projects.permalinkLabel", { title }))}">${escapeHtml(localizedTranslation(language, "projects.permalinkAction"))}</a>`,
        `${indentation}      <p class="project-kind projects-fallback-kind">${escapeHtml(kind)}</p>`,
        `${indentation}    </header>`,
        `${indentation}    <p class="project-description projects-fallback-description">${escapeHtml(description)}</p>`
      ];

      if (Object.hasOwn(project, "stack")) {
        if (!Array.isArray(project.stack) || project.stack.length === 0) {
          throw new TypeError(`Project stack at index ${index} must be a non-empty array.`);
        }
        const stack = project.stack.map((item, stackIndex) => {
          if (typeof item !== "string" || item.trim().length === 0) {
            throw new TypeError(
              `Project stack item ${stackIndex} at index ${index} must be a non-empty string.`
            );
          }
          return item;
        });
        summary.push(
          `${indentation}    <p class="project-stack projects-fallback-stack">${stack.map(escapeHtml).join(" · ")}</p>`
        );
      }

      summary.push(
        `${indentation}    <p class="project-actions projects-fallback-actions" role="group" aria-labelledby="${titleId}">`,
        fallbackActionMarkup(link, action, "primary", language, `${indentation}      `)
      );
      if (hasSourceAction) {
        summary.push(
          fallbackActionMarkup(
            projectUrl(project, index, "sourceLink", { httpsOnly: true }),
            localizedProjectString(project, index, "sourceAction", language),
            "secondary",
            language,
            `${indentation}      `
          )
        );
      }
      summary.push(`${indentation}    </p>`);

      if (hasProof) {
        summary.push(
          `${indentation}    <section class="project-proof projects-fallback-proof">`,
          `${indentation}      <p class="project-proof-text">`,
          `${indentation}        <span class="project-proof-label">${escapeHtml(localizedTranslation(language, "projects.proofLabel"))}</span>`,
          `${indentation}        <span>${escapeHtml(localizedProjectString(project, index, "proof", language))}</span>`,
          `${indentation}      </p>`,
          fallbackActionMarkup(
            projectUrl(project, index, "proofLink", { httpsOnly: true }),
            localizedTranslation(language, "projects.proofAction"),
            "evidence",
            language,
            `${indentation}      `
          ),
          `${indentation}    </section>`
        );
      }

      summary.push(
        `${indentation}  </article>`,
        `${indentation}</li>`
      );
      return summary.join("\n");
    })
    .join("\n");
}

export function renderPage(template, page, projects = canonicalProjects) {
  let output = template.replace(/\{\{t:([a-zA-Z0-9.]+)\}\}/g, (_match, key) => {
    return escapeHtml(templateTranslation(page.language, key, "home template"));
  });

  output = output.replace(
    /^([ \t]*)\{\{projectFallbackSummaries\}\}[ \t]*$/m,
    (_match, indentation) =>
      renderProjectFallbackSummaries(projects, page.language, indentation)
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
