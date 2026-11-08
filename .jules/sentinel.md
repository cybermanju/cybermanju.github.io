# Sentinel Journal — Critical Security Learnings

## 2026-10-27 - Protocol-relative URL bypass in markdown link sanitization
**Vulnerability:** In `src/utils/markdown.ts`, the link validator `safeHref` allowed any URL starting with `/` under `/^(https?:\/\/|mailto:|#|\/)/i`. This allowed protocol-relative URLs (`//evil.com` or `/\evil.com`) to be rendered as clickable anchor tags, enabling open-redirect and origin-confusion vulnerabilities in agent transcripts and notes.
**Learning:** A naive prefix check for relative path (`/`) without ensuring the second character is not another slash or backslash (`/^\/[/\\]/`) will treat protocol-relative URLs as relative web paths, while browsers and webviews resolve `//` to the current protocol with an external host.
**Prevention:** In custom markdown and link sanitizers, always explicitly reject URLs matching `/^\/[/\\]/` before permitting rooted relative paths (`/path`), or use strict URL parsing that disallows protocol-relative destinations.
