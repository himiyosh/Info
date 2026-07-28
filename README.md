## Info
- Site: https://himiyosh.github.io/Info/

## Development
- Run `python3 -m http.server 8000` from the repository root, then open the Japanese route at http://localhost:8000/ or the English route at http://localhost:8000/en/.
- `templates/index.html` is the canonical home-page structure, `templates/404.html` is the canonical bilingual recovery-page structure, and `i18n.js` is the shared Japanese/English copy catalogue used by both the browser and the dependency-free generator. After changing these sources, run `npm run generate:pages` to refresh the checked-in `index.html`, `en/index.html`, and root `404.html`; do not edit the generated pages directly.
- Stable language URLs are `/` for Japanese and `/en/` for English. The language control navigates between them while preserving fragments, and legacy `?lang=ja` / `?lang=en` bookmarks are normalized client-side to the matching stable route without overriding an explicitly visited route from stored preferences.
- Portfolio entries declare a 960x540 JPEG fallback in `image`, a desktop 960x540 AVIF in `desktopImageAvif`, and a mobile 720x405 AVIF in `mobileImageAvif`; verified public repositories can add paired `sourceAction` (`ja`/`en`) and HTTPS `sourceLink` fields for a secondary source action. Source-backed project facts use paired localized `proof` and `proofLink` fields; citations must be HTTPS GitHub blob URLs pinned to a 40-character commit SHA with bounded line anchors and must match a public repository action already exposed by that card.
- Every portfolio entry declares a unique lowercase kebab-case `slug`; its stable same-page URL is `#project-${slug}` and remains unchanged across Japanese and English rendering.
- After project data loads, the Projects introduction renders one compact localized directory from those same slugs and canonical titles. Each 44px row reserves its one visible line for project identity below 48rem, restores the secondary localized kind at 48rem, keeps two columns from 48rem until 67rem, then advances to three content-sized columns only after both locales fit without clipping. A focus-revealed localized bypass link precedes the directory and reaches the existing Contact target without traversing project controls. No-JavaScript, blocked-runtime, early-initialization-failure, and persistent-error states retain the bypass plus nine generated localized summaries with stable project fragments, descriptions, primary actions, and available stack, source, and public-evidence context from `projects.json`.
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
- Root `404.html` is a generated, bilingual, no-JavaScript recovery page with `noindex` metadata and `/Info/`-absolute links so GitHub Pages can serve it at arbitrarily deep missing routes without creating a soft redirect.
- The site uses local HTML, CSS, JavaScript, and imagery for its initial render. AdSense is deferred to production so core content remains fast and resilient.

## Deployment
- GitHub Pages is deployed by `.github/workflows/pages.yml` on pushes to `main` and manual `workflow_dispatch`.
- Canonical project destinations are checked by `.github/workflows/external-link-health.yml` every Wednesday at a non-round UTC minute and on manual `workflow_dispatch`; the read-only job uses no secrets and does not run on pull requests.
- The workflow verifies generated-page drift, then publishes only the production artifact paths listed in `.github/pages-artifact-whitelist.txt` (the root page, custom `404.html`, `en/`, shared site files, and `assets/`). Repository-internal templates, generator scripts, tests, workflows, and docs are not published.
- Workflow actions are pinned to immutable Node.js-24-compatible SHAs to avoid deprecated runtime warnings from GitHub-managed actions.

## Quality checks
- `npm run generate:pages`: deterministically render both checked-in language routes and the bilingual root `404.html` from canonical templates and the shared locale catalogue.
- `npm run check:generated`: fail when either generated route differs from the canonical inputs.
- `npm run check:js`: parse validation for `i18n.js`, `script.js`, the static-page generator, and the dependency-free command-line checkers.
- `npm run check:links`: live validation of every `link`, `sourceLink`, and `proofLink` in `projects.json`, with bounded concurrency, timeouts, fallback requests, and one transient retry.
- `npm run test:quality`: dependency-free regression suite for production content integrity.
- `npm test`: offline full quality baseline (`check:js` + `test:quality`) including workflow pinning, least-privilege permissions, external link workflow wiring, and artifact whitelist coverage checks; it never runs the live network check.
- `node scripts/check-independent-review.mjs --head <40-character-head>`: collect every standalone `independent-review head=<40-character-head> verdict=pass` or `verdict=fail` marker across piped reviews and comments. Pass-only evidence exits 0, missing/legacy evidence exits 1, malformed input exits 2, and any fail evidence exits 3.
- `node scripts/check-merge-gate.mjs --head <40-character-head>`: validate a piped pull-request snapshot for OPEN/non-draft state, exact head identity, MERGEABLE/CLEAN state, at least one reported check, successful terminal status for every reported check, and a pass-only exact-head independent-review verdict across reviews and comments.

## Copilot
- Primary project agent: `InfoAgent`
- Session workflow: [InfoAgent policy](.github/agents/InfoAgent.agent.md) defines coordinator, task-session, recovery, and cleanup practices.
- Coordinator machine-verifiable merge gate (set `PR` to the pull request number; any nonzero exit blocks merge):
  ```sh
  PR=49
  head_sha=$(gh pr view "$PR" --json headRefOid --jq .headRefOid) &&
    gh pr view "$PR" --json state,isDraft,headRefOid,mergeable,mergeStateStatus,statusCheckRollup,reviews,comments |
    node scripts/check-merge-gate.mjs --head "$head_sha"
  ```
- Review evidence must use a contiguous standalone marker: `independent-review head=<40-character-head> verdict=pass` is the only clearance form, while the same marker with `verdict=fail` records a blocker. Each active marker must express exactly one verdict. After the first verdict, a second standalone `pass` or `fail` introduced by whitespace, English `or`, or one of the symbolic separators `|`, `/`, `,`, `、`, `;`, and `；` invalidates that marker; optional spacing around symbols does not change the result. A delimiter remains valid when it begins non-verdict explanatory prose, including a Markdown table cell, rather than a second verdict. Detached prose or code that mentions verdict syntax cannot complete a legacy exact-head marker. Both helpers collect all exact-head matches across reviews and comments; fail wins over pass regardless of order or surface, and the aggregate merge gate also returns exit 3 when fail evidence is present.
- Treat the exact marker's `verdict=pass` or `verdict=fail` as the complete review outcome itself. Do not begin continuation prose after the marker—whether separated by spaces, tabs, or a new paragraph—with a bare lowercase `pass` or `fail` token: the parser conservatively treats that token as a potential second decision and returns missing (exit 1), which can turn an intended blocking `verdict=fail` result (exit 3) into an operational deadlock. Put the decision in the marker, then begin explanatory text with a descriptive phrase, label, punctuation, Markdown formatting, or a non-bare word, such as `Review complete.`, `Reason: ...`, `— Details ...`, `**Blocker:** ...`, or `failure details ...`; this preserves parser safety without mis-clearing ambiguous evidence.
- To retract an incorrect verdict, edit its original comment marker to `RETRACTED-independent-review head=<40-character-head> verdict=<pass|fail>` and retain a retraction reason in that comment. Do not merely add an opposite verdict because an active fail marker still wins.
- Reviewers pin the full head SHA at review start and re-fetch `headRefOid` immediately before posting; it must still equal the pinned head. If it changed, do not post the stale verdict: inspect the compare delta and review the new head. Only a compare-proven generated-only delta with identical relevant implementation blob SHAs may reuse the earlier implementation analysis, and the marker must name the new head.
- The merge-gate helper is dependency-free, offline, and snapshot-only: it does not call GitHub or merge anything. A successful exit verifies only the supplied machine-readable state and a pass-only verdict set; it does not inspect the review's reasoning or scope.
- The coordinator still evaluates production deployment, secrets, permissions, billing, public-scope suitability, documentation completeness, and unresolved review findings. Re-fetch the full snapshot and rerun the command immediately before merge; never authorize a merge from cached output.
- UI work uses the vendored [Hallmark 1.1.0 skill](.github/skills/hallmark/SKILL.md).
- Upstream pin, parity scope, and license: [UPSTREAM.md](.github/skills/hallmark/UPSTREAM.md)
