# The Stem Array — Comprehensive Visual Novel Enhancement Schedule & Specification

> **Scope**: Full UI/UX modernization, Gaṇḍavyūha Sūtra textual fidelity, dialogue pacing, reflective contemplative choices, and pedagogical quiz/minigame architecture.
> **Integration**: `integrations/renpy-technosutra/` and CyberManju OS shell bridge `src/components/TechnosutraStudio.vue`.

---

## 1. Executive Summary & Vision

*The Stem Array* (Gaṇḍavyūha Sūtra, Toh 44–45) chronicles the spiritual pilgrimage of the youth Sudhana as he visits 52 spiritual benefactors (*kalyāṇamitra*) across ancient India, culminating in the vision of Maitreya's cosmic tower and the all-pervading vow of Samantabhadra.

This specification details a multi-phase engineering and design schedule to elevate the visual novel adaptation into an exemplary interactive literary experience within CyberManju OS, adhering strictly to the **Impeccable UI/UX design framework** (anti-slop heuristics, typography hierarchy, WCAG contrast standards, responsive touch targets) and scholarly sutra fidelity.

---

## 2. Work Breakdown Schedule (WBS)

### Phase 1: Foundation & UI/UX Design System Modernization
- **Milestone 1.1: Visual Hierarchy & Design Tokens**
  - Implement dual-finish velvet & glass design token architecture in `screens.rpy`.
  - Establish a unified typographic hierarchy using DejaVu Sans with proportional line height (1.35x), kerning rules, and reader-controlled type scaling (`PADRÃO`, `MAIOR`, `MUITO MAIOR`).
  - Strict compliance with WCAG 2.1 AA (≥ 4.5:1 text-to-surface contrast).
- **Milestone 1.2: Dialogue & Nameplate Presentation (`say` screen)**
  - Redesign dialogue panel with generous internal margins (24px/32px padding) to prevent text clipping across all display dimensions.
  - Distinct speaker badges with luminous accents (`#55edff` and gold accents) and speaker role categorization (Narrator, Kalyāṇamitra, Celestial, Seeker).
  - Explicit keyboard/mouse and touch affordance indicators (`CLIQUE / ENTER · AVANÇAR` vs `TOQUE · AVANÇAR`).
- **Milestone 1.3: Responsive Layout & Mobile Touch Ergonomics**
  - Ensure all interactable elements maintain ≥ 48×48 px minimum tap targets on mobile/touch viewports (`stem_compact_layout`).
  - Mobile bottom quick navigation bar with high-contrast button styling.

### Phase 2: Shell Integration & OS Theme Bridge (`TechnosutraStudio.vue`)
- **Milestone 2.1: PostMessage Theme Synchronization**
  - Real-time forwarding of CyberManju OS theme properties (mode, accent color, glass/flat texture finish) to the Ren'Py Web iframe.
  - Fallback handling for offline/embedded mode.
- **Milestone 2.2: Immersive Surface & Accessibility**
  - Fullscreen gesture capture surface for mobile browser activation constraints.
  - Floating traffic light controls (close, minimize, fullscreen) with accessible keyboard navigation and ARIA labels.
  - Orientation locking support for landscape-optimized reading.

### Phase 3: Gaṇḍavyūha Sūtra Story & Dialogue Deepening
- **Milestone 3.1: Canonical Kalyāṇamitra Structure**
  - Ground all 56 chapters in the official 84000 Toh 44–45 translation by Peter Alan Roberts and Emily Bower.
  - Expand dialogue beats for key turning points:
    - Chapter 1: The Assembly in Jetavana (Vairocanapraṇidhānanābhiraśmiprabha and the 10 directions).
    - Chapter 3: Mañjuśrī's instruction to Sudhana in the Great Grove of Dhanyākara.
    - Chapter 4–10: The early monastic and lay masters (Meghaśrī, Sāgaramegha, Supratiṣṭhita, Megha, Muktaka).
    - Chapter 27: The courtesan Vasumitrā's teaching on detachment through compassion.
    - Chapter 53: Maitreya's Kūṭāgāra (the multi-storied tower of cosmic interpenetration).
    - Chapter 54–56: Mañjuśrī Kumārabhūta and Samantabhadra's concluding verses.
- **Milestone 3.2: Pacing & Text Segmentation**
  - Automate sentence and clause paging in `tools/generate_renpy_script.py` (290 chars narration limit, 250 chars dialogue limit) to prevent wall-of-text fatigue.
  - Ellipsis pacing cues (`…`) on multi-page speeches.

### Phase 4: Quizzes, Minigames & Reflective Choices
- **Milestone 4.1: Distinct UI Presentation for Choices vs Quizzes**
  - Render contemplative reflection choices (`REFLEXÃO CONTEMPLATIVA`) with turquoise accents and open, non-punitive re-convergence.
  - Render quiz challenges (`QUIZ MINIGAME · DESAFIO DE SABEDORIA`) with dedicated badge styling, clear instructions, and immediate contextual feedback.
- **Milestone 4.2: Doctrinal Context Feedback**
  - Enrich all 56 chapter quizzes with detailed explanatory feedback on both correct answers and retries, transforming each quiz into a meaningful pedagogical moment.

### Phase 5: Verification, CI Automation & Quality Gates
- **Milestone 5.1: Asset & Metadata Verification**
  - Automated hashing and manifest tracking in `tools/validate_optimized_assets.py` and `tools/ci_runtime_metadata.py`.
  - Service worker precaching determinism in `tools/stamp_service_worker.py`.
- **Milestone 5.2: Automated Smoke Tests**
  - CI Playwright headless browser smoke test (`tools/smoke_web_build.py` and `tests/python/test_post_deploy_smoke.py`).
  - Unit test suite coverage in `tests/python/test_renpy_ci_metadata.py` and frontend Vitest integration.

---

## 3. Implementation Matrix

| Module / Component | Target File | Core Improvement |
|---|---|---|
| Ren'Py Screen UI | `integrations/renpy-technosutra/game/screens.rpy` | Velvet/glass token refinement, clear quiz badges, mobile button metrics |
| Ren'Py Script Generator | `integrations/renpy-technosutra/tools/generate_renpy_script.py` | Quiz badge tagging, multi-page segmentation, speaker mapping |
| Story & Quiz Manifest | `integrations/renpy-technosutra/chapters.json` | Deepened sutra reflections, detailed doctrinal feedback |
| Web Studio Bridge | `src/components/TechnosutraStudio.vue` | Theme sync, fullscreen gesture handling, accessible controls |
| CI Verification Suite | `tests/python/test_renpy_ci_metadata.py` | Metadata contract assertions, service worker precache validation |

---

## 4. Maintenance and Ethical Attribution Notice

- All narrative content is adapted from *The Stem Array* (Gaṇḍavyūha, Toh 44–45), translated from the Tibetan by Peter Alan Roberts under CC BY-NC-ND 4.0.
- Dialogues are original dramatizations designed for interactive visual novel pedagogical reading, explicitly maintaining separation from canonical scriptural quotations.
