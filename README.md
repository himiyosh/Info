## Info
- Site: https://himiyosh.github.io/Info/

## Development
- Run `python3 -m http.server 8000` from the repository root, then open the Japanese route at http://localhost:8000/ or the English route at http://localhost:8000/en/.
- `templates/index.html` is the only page-structure source, and `i18n.js` is the shared Japanese/English copy catalogue used by both the browser and the dependency-free generator. After changing either file, run `npm run generate:pages` to refresh the checked-in `index.html` and `en/index.html`; do not edit the generated pages directly.
- Stable language URLs are `/` for Japanese and `/en/` for English. The language control navigates between them while preserving fragments, and legacy `?lang=ja` / `?lang=en` bookmarks are normalized client-side to the matching stable route without overriding an explicitly visited route from stored preferences.
- Portfolio entries declare a 960x540 JPEG fallback in `image`, a desktop 960x540 AVIF in `desktopImageAvif`, and a mobile 720x405 AVIF in `mobileImageAvif`; verified public repositories can add paired `sourceAction` (`ja`/`en`) and HTTPS `sourceLink` fields for a secondary source action. Source-backed project facts use paired localized `proof` and `proofLink` fields; citations must be HTTPS GitHub blob URLs pinned to a 40-character commit SHA with bounded line anchors and must match a public repository action already exposed by that card.
- Every portfolio entry declares a unique lowercase kebab-case `slug`; its stable same-page URL is `#project-${slug}` and remains unchanged across Japanese and English rendering.
- After project data loads, the Projects introduction renders one localized directory from those same slugs and titles; no-JavaScript and persistent-error states keep only the nine external fallback destinations.
- Project AVIF previews use a consistent `sips` quality setting: desktop `sips -s format avif -s formatOptions 70 -z 540 960 assets/name-preview.jpg --out assets/name-preview-960w.avif`; mobile `sips -s format avif -s formatOptions 70 -z 405 720 assets/name-preview.jpg --out assets/name-preview-720w.avif`.
- The nine desktop AVIFs total 187,587 bytes versus 551,363 bytes for the JPEG fallbacks, saving 363,776 bytes (66.0%).

| Project preview | JPEG bytes | Desktop AVIF bytes | Savings |
| --- | ---: | ---: | ---: |
| `portfolio-preview` | 78,916 | 37,634 | 52.3% |
| `techdb-preview` | 131,203 | 48,704 | 62.9% |
| `jojo-aiagent-preview` | 78,218 | 25,011 | 68.0% |
| `jojo-git-preview` | 55,239 | 18,481 | 66.5% |
| `ucfitness-preview` | 67,559 | 24,380 | 63.9% |
| `encode-decode-preview` | 36,393 | 6,474 | 82.2% |
| `network-plus-preview` | 45,463 | 11,759 | 74.1% |
| `url-decoder-preview` | 37,955 | 9,316 | 75.5% |
| `image-resizer-preview` | 20,417 | 5,828 | 71.5% |
- `tokens.css` is the design-token source of truth. The Latin display font is bundled under `assets/fonts/` with its `OFL.txt` license, so no runtime font provider is required.
- `robots.txt` and `sitemap.xml` expose both canonical language routes with reciprocal `ja`, `en`, and `x-default` alternates.
- The site uses local HTML, CSS, JavaScript, and imagery for its initial render. AdSense is deferred to production so core content remains fast and resilient.

## Deployment
- GitHub Pages is deployed by `.github/workflows/pages.yml` on pushes to `main` and manual `workflow_dispatch`.
- Canonical project destinations are checked by `.github/workflows/external-link-health.yml` every Wednesday at a non-round UTC minute and on manual `workflow_dispatch`; the read-only job uses no secrets and does not run on pull requests.
- The workflow verifies generated-page drift, then publishes only the production artifact paths listed in `.github/pages-artifact-whitelist.txt` (the root page, `en/`, shared site files, and `assets/`). Repository-internal templates, generator scripts, tests, workflows, and docs are not published.
- Workflow actions are pinned to immutable Node.js-24-compatible SHAs to avoid deprecated runtime warnings from GitHub-managed actions.

## Quality checks
- `npm run generate:pages`: deterministically render both checked-in language routes from the canonical template and shared locale catalogue.
- `npm run check:generated`: fail when either generated route differs from the canonical inputs.
- `npm run check:js`: parse validation for `i18n.js`, `script.js`, the static-page generator, and the dependency-free external link checker.
- `npm run check:links`: live validation of every `link`, `sourceLink`, and `proofLink` in `projects.json`, with bounded concurrency, timeouts, fallback requests, and one transient retry.
- `npm run test:quality`: dependency-free regression suite for production content integrity.
- `npm test`: offline full quality baseline (`check:js` + `test:quality`) including workflow pinning, least-privilege permissions, external link workflow wiring, and artifact whitelist coverage checks; it never runs the live network check.

## Copilot
- Primary project agent: `InfoAgent`
- Session workflow: [InfoAgent policy](.github/agents/InfoAgent.agent.md) defines coordinator, task-session, recovery, and cleanup practices.
- UI work uses the vendored [Hallmark 1.1.0 skill](.github/skills/hallmark/SKILL.md).
- Upstream pin, parity scope, and license: [UPSTREAM.md](.github/skills/hallmark/UPSTREAM.md)
