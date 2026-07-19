## Info
- Site: https://himiyosh.github.io/Info/

## Development
- Run `python3 -m http.server 8000` from the repository root, then open
  http://localhost:8000/.
- Portfolio entries live in `projects.json`; Japanese and English copy lives in
  `i18n.js`.
- The site uses local HTML, CSS, JavaScript, and imagery for its initial render.
  AdSense is deferred to production so core content remains fast and resilient.

## Copilot
- Primary project agent: `InfoAgent`
- UI work uses the vendored [Hallmark 1.1.0 skill](.github/skills/hallmark/SKILL.md).
- Upstream pin, parity scope, and license: [UPSTREAM.md](.github/skills/hallmark/UPSTREAM.md)