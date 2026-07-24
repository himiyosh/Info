## Info
- Site: https://himiyosh.github.io/Info/

## Development
- Run `python3 -m http.server 8000` from the repository root, then open http://localhost:8000/.
- Portfolio entries and their local preview assets are declared in `projects.json`; Japanese and English interface copy lives in `i18n.js`.
- `robots.txt` and `sitemap.xml` expose the public page to search crawlers.
- The site uses local HTML, CSS, JavaScript, and imagery for its initial render. AdSense is deferred to production so core content remains fast and resilient.

## Quality checks
- `npm run check:js`: parse validation for `i18n.js` and `script.js`.
- `npm run test:quality`: dependency-free regression suite for production content integrity.
- `npm test`: full quality baseline (`check:js` + `test:quality`).

## Copilot
- Primary project agent: `InfoAgent`
- UI work uses the vendored [Hallmark 1.1.0 skill](.github/skills/hallmark/SKILL.md).
- Upstream pin, parity scope, and license: [UPSTREAM.md](.github/skills/hallmark/UPSTREAM.md)