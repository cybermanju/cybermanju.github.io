# The Stem Array — Ren’Py visual novel

This working-tree folder contains the Ren’Py source project, chapter data, asset-preparation tools and a Web build script. The Vue bridge lives at `src/components/TechnosutraStudio.vue` in the repository root. The public push intentionally omits generated builds and the book-derived script/chapter data until public-distribution rights and a current runtime build are cleared.

## Current state

The current source describes 56 chapters, 246 scenes, 540 newly written VN dialogue lines, 56 reconvergent choices and 56 chapter quizzes. The 56 PNG chapter backgrounds and 30 cyberpunk variants are present. The owner approved provisional use of 54 transparent 600×800 front renders as static sprites; slots 43 and 52 are absent from the upstream model set. No mouth/posture variants or lip-sync are available.

The Ren’Py lint passed on an earlier source revision, but the latest packaging attempt stopped with exit code 143 during progressive download. The latest `game.zip` files are not validated and may not match the current script. A prior build opened in a browser, but the current package has not passed a smoke test inside the Cybermanju OS panel. Treat `public/technosutra-vn/` as a local, unvalidated artifact, not a playable release.

## Continue the build

Use the official Ren’Py SDK 8.5 with Web Platform Support. In this sandbox it was located at `/tmp/renpy-sdk/renpy-8.5.3-sdk`; elsewhere, set `RENPY_SDK` to the SDK path.

1. Check `game/script.rpy`, `game/options.rpy`, `chapters.json`, the source page references and both sprite manifests for consistency.
2. Run `bash -n integrations/renpy-technosutra/build_web.sh`, then inspect the script before executing it. Do not overwrite or delete the previous artifact until the new lint/build succeeds.
3. Build to a fresh staging directory, check the archive and hashes, then open that exact output in the panel and test start, chapter navigation, dialogue, choices, quiz, and return to OS.
4. Only replace the public path after a successful smoke test. Keep the package small; current generated archives are several hundred MB to multiple GB and must not be committed to GitHub.

The Studio `.pdf` picker records metadata only; PDF extraction and voice output are not connected. It can add owner-provided route coordinates, but it does not ingest Street View pixels. Do not download or transform Google Street View images; use owner-provided/licensed photos or original art.

## Sources and rights

*The Stem Array* (Gaṇḍavyūha), Toh 44–45, is available from [84000](https://84000.co/translation/toh44-45). The PDF states CC BY-NC-ND 4.0. The owner separately authorized adaptation to this Agent; that does not establish general permission for public distribution. Confirm distribution rights before publishing or pushing a built game. This authorization is separate from the owner’s permission for the two Mandarin-course PDFs.

The public upstream Technosutra repository has inconsistent license signals (its README says MIT while the published LICENSE contains conflict markers/GPLv3 text). The temporary permission to use raw renders does not resolve redistribution rights. Do not publish them in a game build until this is clarified.

## Provisional sprites

The owner approved temporary use of available raw renders, clearly marked provisional. Preserve their source hashes and mapping in `game/images/masters/sprites/manifest.json`. They are static front views without animation or lip-sync. The current inventory is 54 files, mapped to existing model/chapter IDs; models 43 and 52 are absent. Model 14 was captured after the Meshopt adjustment, and model 56 corresponds to chapter 56, not a cover.
