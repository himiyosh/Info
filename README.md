## Info
- Site: https://himiyosh.github.io/Info/

## Development
- Run `python3 -m http.server 8000` from the repository root, then open http://localhost:8000/.
- Portfolio entries and their local preview assets are declared in `projects.json`; Japanese and English interface copy lives in `i18n.js`.
- `tokens.css` is the design-token source of truth. The Latin display font is bundled under `assets/fonts/` with its `OFL.txt` license, so no runtime font provider is required.
- `robots.txt` and `sitemap.xml` expose the public page to search crawlers.
- The site uses local HTML, CSS, JavaScript, and imagery for its initial render. AdSense is deferred to production so core content remains fast and resilient.

## Deployment
- GitHub Pages is deployed by `.github/workflows/pages.yml` on pushes to `main` and manual `workflow_dispatch`.
- The workflow publishes only the production artifact paths listed in `.github/pages-artifact-whitelist.txt` (site root files plus `assets/`) and does not publish repository-internal paths such as tests, workflows, or docs.
- Workflow actions are pinned to immutable Node.js-24-compatible SHAs to avoid deprecated runtime warnings from GitHub-managed actions.

## Quality checks
- `npm run check:js`: parse validation for `i18n.js` and `script.js`.
- `npm run test:quality`: dependency-free regression suite for production content integrity.
- `npm test`: full quality baseline (`check:js` + `test:quality`) including workflow pinning, least-privilege Pages permissions, and artifact whitelist coverage checks.

## Copilot
- Primary project agent: `InfoAgent`
- Session workflow: [InfoAgent policy](.github/agents/InfoAgent.agent.md) defines coordinator, task-session, recovery, and cleanup practices.
- UI work uses the vendored [Hallmark 1.1.0 skill](.github/skills/hallmark/SKILL.md).
- Upstream pin, parity scope, and license: [UPSTREAM.md](.github/skills/hallmark/UPSTREAM.md)
