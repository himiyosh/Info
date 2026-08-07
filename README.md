## Info
- Site: https://himiyosh.github.io/Info/

## Development
- Run `python3 -m http.server 8000` from the repository root, then open the Japanese route at http://localhost:8000/ or the English route at http://localhost:8000/en/.
- `templates/index.html` is the canonical home-page structure, `templates/share.html` is the canonical localized project-share structure, `templates/404.html` is the canonical bilingual recovery-page structure, and `i18n.js` is the shared Japanese/English copy catalogue used by both the browser and the dependency-free generator. After changing these sources or `projects.json`, run `npm run generate:pages` to refresh the checked-in home, share, and recovery pages; do not edit generated pages directly.
- Stable language URLs are `/` for Japanese and `/en/` for English. The language control navigates between them while preserving fragments, and legacy `?lang=ja` / `?lang=en` bookmarks are normalized client-side to the matching stable route without overriding an explicitly visited route from stored preferences.
- Portfolio entries declare a 960x540 JPEG fallback in `image`, a desktop 960x540 AVIF in `desktopImageAvif`, and a mobile 720x405 AVIF in `mobileImageAvif`; verified public repositories can add paired `sourceAction` (`ja`/`en`) and HTTPS `sourceLink` fields for a secondary source action. Source-backed project facts use paired localized `proof` and `proofLink` fields; citations must be HTTPS GitHub blob URLs pinned to a 40-character commit SHA with bounded line anchors and must match a public repository action already exposed by that card.
- Every portfolio entry declares a unique lowercase kebab-case `slug`; its stable same-page URL is `#project-${slug}` and remains unchanged across Japanese and English rendering.
- Every portfolio share control targets a generated localized referral helper at `/share/${slug}/` or `/en/share/${slug}/`. These noindex pages expose project-specific social metadata and a complete no-JavaScript fallback while linking back to the unchanged language-specific `#project-${slug}` portfolio fragment.
- After project data loads, the Projects introduction renders one compact localized directory from those same slugs and canonical titles. Each 44px row reserves its one visible line for project identity below 48rem, restores the secondary localized kind at 48rem, keeps two columns from 48rem until 67rem, then advances to three shrinkable columns whose titles remain constrained by the existing ellipsis boundary. A focus-revealed localized bypass link precedes the directory and reaches the existing Contact target without traversing project controls. No-JavaScript, blocked-runtime, early-initialization-failure, and persistent-error states retain the bypass plus nine generated localized summaries with stable project fragments, descriptions, primary actions, and available stack, source, and public-evidence context from `projects.json`.
- Project AVIF previews use a consistent `sips` quality setting: desktop `sips -s format avif -s formatOptions 70 -z 540 960 assets/name-preview.jpg --out assets/name-preview-960w.avif`; mobile `sips -s format avif -s formatOptions 70 -z 405 720 assets/name-preview.jpg --out assets/name-preview-720w.avif`.
- The nine desktop AVIFs total 173,550 bytes versus 524,923 bytes for the JPEG fallbacks, saving 351,373 bytes (66.9%).

| Project preview | JPEG bytes | Desktop AVIF bytes | Savings |
| --- | ---: | ---: | ---: |
| `portfolio-preview` | 52,476 | 23,597 | 55.0% |
| `techdb-preview` | 131,203 | 48,704 | 62.9% |
| `jojo-aiagent-preview` | 78,218 | 25,011 | 68.0% |
| `jojo-git-preview` | 55,239 | 18,481 | 66.5% |
| `ucfitness-preview` | 67,559 | 24,380 | 63.9% |
| `encode-decode-preview` | 36,393 | 6,474 | 82.2% |
| `network-plus-preview` | 45,463 | 11,759 | 74.1% |
| `url-decoder-preview` | 37,955 | 9,316 | 75.5% |
| `image-resizer-preview` | 20,417 | 5,828 | 71.5% |
- `tokens.css` is the design-token source of truth and carries the canonical 夜藍 (dark) palette in strict `--color-*: oklch(L% C H)` form; the 白妙 (light) and hidden 暁 palettes override the same slots from the theme layer at the end of `modern.css`, keyed by `html[data-theme]` or the OS color scheme when no explicit choice is stored.
- The header theme toggle cycles 夜藍 ⇄ 白妙 (a 3-second hold wakes 暁), persists the choice under the `info-theme` localStorage key at the same layer as language normalization, syncs the `theme-color` meta per palette, and falls back to instant switching when View Transitions are unavailable or reduced motion is requested.
- Typography uses self-hostable rounded-gothic stacks (`Zen Maru Gothic` / `M PLUS Rounded 1c` / `IBM Plex Mono` named first, with system Maru Gothic fallbacks) so no runtime font provider is loaded; the Latin display font remains bundled under `assets/fonts/` with its `OFL.txt` license. Subsetted woff2 files for the maru families can be dropped into `assets/fonts/` later without markup changes.
- `robots.txt` and `sitemap.xml` expose both canonical language routes with reciprocal `ja`, `en`, and `x-default` alternates.
- Root `404.html` is a generated, bilingual, no-JavaScript recovery page with `noindex` metadata and `/Info/`-absolute links so GitHub Pages can serve it at arbitrarily deep missing routes without creating a soft redirect.
- The site uses local HTML, CSS, JavaScript, and imagery for its initial render. AdSense is deferred to production so core content remains fast and resilient.

## Deployment
- GitHub Pages is deployed by `.github/workflows/pages.yml` on pushes to `main` and manual `workflow_dispatch`.
- Canonical project destinations are checked by `.github/workflows/external-link-health.yml` every Wednesday at a non-round UTC minute and on manual `workflow_dispatch`; the read-only job uses no secrets and does not run on pull requests.
- The workflow verifies generated-page drift, then publishes only the production artifact paths listed in `.github/pages-artifact-whitelist.txt` (the home pages, custom `404.html`, exact generated share routes, shared site files, and `assets/`). Repository-internal templates, generator scripts, tests, workflows, and docs are not published.
- Workflow actions are pinned to immutable Node.js-24-compatible SHAs to avoid deprecated runtime warnings from GitHub-managed actions.

## Quality checks
- `npm run generate:pages`: deterministically render both checked-in language routes, every localized project-share route, and the bilingual root `404.html` from canonical templates, `projects.json`, and the shared locale catalogue.
- `npm run check:generated`: fail when either generated route differs from the canonical inputs.
- `npm run check:js`: syntax-only parse validation for `i18n.js`, `script.js`, the static-page generator, and the dependency-free command-line checkers; it does not execute the independent-review policy.
- `npm run check:independent-review -- --repo <owner/name> --pr <number> --head <40-character-head>`: fetch the named pull request, its reviews, and its issue comments through three bounded GitHub REST requests, then execute the independent-review guard for that exact head. An OPEN exact-head pass exits 0, missing/malformed/stale evidence exits 1, malformed arguments or an unusable snapshot exits 2, and any same-head fail exits 3. A valid closed snapshot is skipped with exit 0 because historical merged or closed pull requests are outside this CI gate.
- `npm run check:links`: live validation of every `link`, `sourceLink`, and `proofLink` in `projects.json`, with bounded concurrency, timeouts, fallback requests, and one transient retry.
- `npm run test:quality`: dependency-free regression suite for production content integrity.
- `npm test`: offline full quality baseline (`check:js` + `test:quality`) including workflow pinning, least-privilege permissions, external link workflow wiring, and artifact whitelist coverage checks; it never runs the live network check.
- `INFO_QUALITY_SPAWN_TIMEOUT_MS`: override the shared millisecond budget (default 300000) that `tests/helpers/quality-spawn.mjs` applies to every nested quality-suite spawn; an unusable value fails closed instead of silently reverting to the default.
- `tests/quality/quality-spawn-timeout.test.mjs`: hold an authoritative inventory of every module that spawns a nested `node --test` run, keep them all on that shared budget, reject hardcoded per-file timeouts and opaque `assert.ifError` spawn reporting, and verify the default still fits inside the `.github/workflows/quality-baseline.yml` job budget; `tests/quality/quality-spawn-timeout-mutations.test.mjs` runs that guard against mutated fixture roots to prove it rejects requoted, spaced, concealed, unlisted, and dropped spawners.
- `node scripts/check-independent-review.mjs --head <40-character-head>`: offline mode that collects every review or comment line whose trimmed content exactly matches `independent-review head=<40-character-head> verdict=pass|fail by=<full lowercase UUID>` and that is outside Markdown fenced code blocks. Pass-only evidence exits 0, missing/legacy evidence exits 1, malformed input exits 2, and any fail evidence exits 3.
- `node scripts/check-merge-gate.mjs --head <40-character-head>`: validate a piped pull-request snapshot for OPEN/non-draft state, exact head identity, MERGEABLE/CLEAN state, at least one reported check, successful terminal status for every reported check, and a pass-only exact-head independent-review verdict across reviews and comments.

## Copilot
- Primary project agent: `InfoAgent`
- Session workflow: [InfoAgent policy](.github/agents/InfoAgent.agent.md) defines coordinator, task-session, recovery, and cleanup practices.
- `.github/workflows/quality-baseline.yml` runs `npm test` on pushes to `main` and pull requests, then runs `npm run check:independent-review` only when the current event is an OPEN pull request. The pull request number and head come from that event, the fetched REST snapshot must still report the same open head, and valid closed snapshots are skipped so reruns cannot retroactively fail merged pull requests. After an independent reviewer posts or edits the exact-head marker, rerun the failed Quality baseline job against the unchanged head.
- Current-PR guard example (set `PR` to the open pull request number):
  ```sh
  PR=61
  head_sha=$(gh pr view "$PR" --json headRefOid --jq .headRefOid) &&
    npm run check:independent-review -- --repo himiyosh/Info --pr "$PR" --head "$head_sha"
  ```
- Coordinator machine-verifiable merge gate (set `PR` to the pull request number; any nonzero exit blocks merge):
  ```sh
  PR=49
  head_sha=$(gh pr view "$PR" --json headRefOid --jq .headRefOid) &&
    gh pr view "$PR" --json state,isDraft,headRefOid,mergeable,mergeStateStatus,statusCheckRollup,reviews,comments |
    node scripts/check-merge-gate.mjs --head "$head_sha"
  ```
- Review evidence must use one exact trimmed marker line outside Markdown fenced code blocks: after trimming leading and trailing whitespace, the complete line must exactly equal `independent-review head=<40-character-head> verdict=pass by=<full lowercase UUID>` for clearance or the same line with `verdict=fail` for a blocker. Prose may appear before or after the marker on separate lines in the same body; the entire body need not contain only the marker. Negations, prohibitions, questions, list or table examples, inline code, fenced code, and lines with any same-line prefix, suffix, punctuation, or prose do not satisfy the gate. The `by` value records the independent reviewer's full lowercase session UUID; an absent, shortened, uppercase, braced, or otherwise invalid UUID never satisfies the gate. The coordinator must confirm that `by` names the assigned independent reviewer and not the coordinator or implementation child. Each active marker must express exactly one verdict. Both helpers collect all exact-head matches across reviews and comments; fail wins over pass regardless of order or surface, and the aggregate merge gate also returns exit 3 when fail evidence is present.
- Treat the exact marker line's `verdict=pass` or `verdict=fail` as the complete review outcome itself. Do not append punctuation or continuation prose to the marker line. Put explanatory text on another line beginning with a descriptive phrase, label, Markdown formatting, or a non-bare word, such as `Review complete.`, `Reason: ...`, `**Blocker:** ...`, or `failure details ...`. A later continuation that begins with a bare lowercase `pass` or `fail` token, whether reached through whitespace, optional English `or`, or one of the symbolic separators `|`, `/`, `,`, `、`, `;`, and `；`, is treated as a potential second decision and returns missing (exit 1), which can turn an intended blocking `verdict=fail` result (exit 3) into an operational deadlock. This preserves parser safety without mis-clearing ambiguous evidence.
- To retract an incorrect verdict, edit its original comment marker to `RETRACTED-independent-review head=<40-character-head> verdict=<pass|fail> by=<full lowercase UUID>` and retain a retraction reason in that comment. Do not merely add an opposite verdict because an active fail marker still wins.
- Reviewers pin the full head SHA at review start and re-fetch `headRefOid` immediately before posting; it must still equal the pinned head. If it changed, do not post the stale verdict: inspect the compare delta and review the new head. Only a compare-proven generated-only delta with identical relevant implementation blob SHAs may reuse the earlier implementation analysis, and the marker must name the new head.
- The merge-gate helper is dependency-free, offline, and snapshot-only: it does not call GitHub or merge anything. A successful exit verifies only the supplied machine-readable state and a pass-only verdict set; it does not inspect the review's reasoning or scope.
- The coordinator still evaluates production deployment, secrets, permissions, billing, public-scope suitability, documentation completeness, and unresolved review findings. Re-fetch the full snapshot and rerun the command immediately before merge; never authorize a merge from cached output.
- UI work uses the vendored [Hallmark 1.1.0 skill](.github/skills/hallmark/SKILL.md).
- Upstream pin, parity scope, and license: [UPSTREAM.md](.github/skills/hallmark/UPSTREAM.md)
