# Poko review assets

These files are local review assets for the Poko cameo in Info. They are copied
from the user's `himiyosh/poko-animation` repository, branch
`feat/poko-character-reference-v1`, commit
`5a704faf1cd33a5a772c2852e51512fdc5436b9c`.

The source file is `poko_canonical_front_v1.png` from the upstream review
candidate. The source and derived files are intentionally not treated as
approved final canon; replace them only after the upstream design is approved.

- `poko-review-v0.2.0-front.png`: upstream RGB source, 880x1168,
  SHA-256 `942ac1f11786f157b74de6a396a8ddae93df9fe8c108b53494914bec9c6daada`
- `poko-review-v0.2.0-front-transparent.png`: local RGBA derivative with the
  warm source background keyed transparent,
  SHA-256 `24ac1acd162ef0c8d9b76af87ec6aa927b17b66fe6c701e29208fe65ee4cba21`

## Updating

When the upstream candidate changes, copy the approved review source into this
directory, regenerate the transparent derivative with the same background-key
process, update the source commit and checksums above, and run the portfolio
quality checks before opening a new review.
