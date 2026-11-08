# The Stem Array — documentation folder

This folder holds the Ren'Py reference material for the VN plus the project's own
feature map.

| Path | What it is |
|---|---|
| [`RENPY.md`](RENPY.md) | Which Ren'Py features the VN uses, where they live, and how they work. **Start here.** |
| [`renpy-docs/index.html`](renpy-docs/index.html) | Full offline copy of the official Ren'Py documentation (HTML, images, CSS and search index). |
| [`renpy-docs/genindex.html`](renpy-docs/genindex.html) | Alphabetical index of every documented name. |
| [`renpy-docs/search.html`](renpy-docs/search.html) | Offline full-text search (`searchindex.js` included). |

## Documentation snapshot

- **Source:** <https://www.renpy.org/doc/html/> (the live "latest" documentation).
- **Snapshot date:** 2026-11-08.
- **Version:** the mirrored changelog tops out at **Ren'Py 8.5.3**, matching the
  SDK pinned by [`../tools/install_renpy_sdk.sh`](../tools/install_renpy_sdk.sh)
  and `project.json` (`compactBuild.renpyVersion`).
- **Extent:** 106 HTML pages, 60 reference images, 11 JS assets (Sphinx theme +
  search) and the CSS/fonts needed to read them offline — about 24 MB.
- **Entry point:** open [`renpy-docs/index.html`](renpy-docs/index.html) directly;
  all links were rewritten to relative paths and the Sphinx `?v=` asset query
  strings were stripped so the copy works from disk and from a static server.

The pages are vendored upstream content. They are intentionally excluded from
the repository's top-file header gate (`scripts/check-file-headers.sh`); do not
add project headers to them. Ren'Py's MIT license text is mirrored at
[`renpy-docs/license.html`](renpy-docs/license.html).

## Refreshing the mirror

From `integrations/renpy-technosutra/docs/` (remove the old copy first; the
`--cut-dirs=2` strips the site's `/doc/html/` prefix so the tree lands directly
in `renpy-docs/`):

```sh
rm -rf renpy-docs
wget --recursive --level=inf --page-requisites --adjust-extension \
  --convert-links --no-parent --no-host-directories --cut-dirs=2 \
  --directory-prefix=renpy-docs \
  https://www.renpy.org/doc/html/index.html
curl -o renpy-docs/searchindex.js https://www.renpy.org/doc/html/searchindex.js
```

`wget` saves Sphinx assets as `file.js?v=hash`; rename them to drop the query
suffix and strip the escaped `%3Fv=hash` / `%3Fhash` references from the HTML,
CSS and JS before committing. Then check links and record the new snapshot date
and changelog version above.
