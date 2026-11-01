# The Stem Array — Ren’Py visual novel

This integration contains the source data, Ren’Py generators, compact runtime art and a Web build script. The Vue bridge is in `src/components/TechnosutraStudio.vue` at the repository root. `.github/workflows/renpy-ci.yml` builds and smoke-tests the game without publishing or uploading the bundle.

## Compact assets and quality checks

The runtime needs 56 chapter backgrounds, one independent opening background and 54 transparent static sprites. The chapter backgrounds are quality-controlled 1920×1080 JPEG derivatives (q85, 4:4:4): 59,750,485 bytes total, 19.29% smaller than the previous 56-JPEG set. Comparing against resized original PNGs produced PSNR values from 30.34 to 35.02 dB, above the 30 dB gate. The opening JPEG is 963,067 bytes. The 54 600×800 RGBA sprites total 15,689,414 bytes and remain byte-identical to the manifest-pinned captures. Total runtime image payload is 72.86 MiB.

Original background PNGs and the previous root-level JPEG set are preserved in the local worktree but omitted from the compact checkout. `game/images/optimized/manifest.json` records source/output hashes, dimensions, byte sizes and PSNR. The sprite and capture manifests retain their upstream repository, commit and file mapping. Ren’Py Web emits the full-size runtime art as progressive-download files beside `game.zip`; the ZIP contains compiled scripts, the remote-file map, provenance manifests and generated low-resolution placeholders. The validator checks ZIP integrity, all 111 full-size runtime images and hashes, placeholder/download mappings, and excludes duplicate capture PNGs, caches and previews.

## Build and CI

The workflow installs Python 3.12, Pillow 12.3.0, Playwright 1.62.0 and the official Ren’Py 8.5.3 SDK/Web support verified by SHA-256. It runs Ren’Py lint and a WebAssembly build, validates progressive assets, then serves the complete Web output to Chromium to check the game canvas, runtime resources, keyboard input and browser errors. The smoke test also verifies HTTP 200 for all 111 progressive images. Output remains in the ignored local build directory on the runner; there is no artifact upload, deployment or change to `public/technosutra-vn/`.

GitHub Actions runs on pushes to `main` or `develop` that touch the Ren’Py inputs, on pull requests to `main` that touch them, and by manual dispatch. For local instructions, see [`BUILD-CI.md`](BUILD-CI.md), then run:

```sh
RENPY_SDK=/tmp/renpy-8.5.3-sdk BUILD_ID=local-check-001 \
  bash integrations/renpy-technosutra/build_web.sh
```

The build refuses to overwrite an existing `BUILD_ID`. The `game.zip` file alone is not the complete Web game: use the whole Web output directory (or a full Web archive made from it), because progressive image files are served alongside the ZIP. Legacy files under `build/output/`, `build/provisional-output/` and `public/technosutra-vn/` are not reused or overwritten by this CI workflow.

## Source and permissions

[*The Stem Array* (Gaṇḍavyūha), Toh 44–45](https://84000.co/translation/toh44-45) is published by 84000 under CC BY-NC-ND 4.0. The project owner has explicitly confirmed public-distribution authorization for the adapted Ren’Py script and included game assets. Separately, the owner has authorized public distribution of the 54 GLB-derived sprite renders. Preserve attribution, the capture manifest and every runtime SHA-256 record. This permission does not mean a build has been published: CI only validates and does not deploy.

The upstream Technosutra README and LICENSE contain conflicting license signals; the owner’s authorization for this game build is recorded in the manifests. The sprites remain marked provisional, with no mouth/posture variants or lip-sync. Chapters 43 and 52 have no sprite.

The opening scene uses an independent original environment. A separate supplied JPEG with unconfirmed origin is excluded. No Google Street View imagery or derivatives are included. The Studio PDF picker records metadata only; PDF extraction and voice output are not connected.
