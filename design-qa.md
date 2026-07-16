# Aleksi Workbench total refinement — design QA

Date: 2026-07-16

## Final finding

- No actionable P0, P1, or P2 visual, interaction, responsive, or accessibility finding remains.
- The last P2 found during screenshot review was a missing `recent-card-row` layout after the CSS responsibility split. It was restored in `src/features/cards/cards.css`, then the targeted UI suite and the complete Playwright journey were rerun and the card screenshot was reopened.
- Environment-only limitation: Windows denied creation of one test symlink with `EPERM`; the suite reports that case as an explicit skip. This does not hide a visual or product failure.

## Reference comparison

- Reference: `artifacts/total-refinement-incoming/current-flywheel-real-screenshot.png`
- Same-state implementation: `artifacts/total-refinement-screenshots/graph-reference-viewport-1456x1092.png`
- One-input comparison: `artifacts/total-refinement-screenshots/reference-vs-implementation.png`
- Comparison viewport: 1456 × 1092; reduced motion enabled.

The implementation retains the reference's warm paper palette, quiet serif hierarchy, five numbered stage cards, 3+2 loop, directional return to Concept, and subordinate detail surface. It deliberately uses real Workbench state instead of reference percentages: structural coverage, learning status, and evidence confidence remain separate.

## Reviewed surfaces

- Reader: one dominant manuscript column, drawer-based materials/import/excerpt basket, measured three-action selection toolbar, and five-type card submenu.
- Card Studio: four explicit learning sections, five save states, editable post-save state, and a readable recent-card list.
- Topic Flywheel: five stages, 3+2 layout, no invented percentages, direct grounded Reader action, and narrow sticky detail sheet.
- Launch and recovery: bounded one-launch splash, missing-motion fallback, reduced motion, and backend-unavailable recovery.
- Accessibility: semantic controls, visible focus, keyboard-selectable stages/actions, at least 44 × 44 px stage targets, and state conveyed by copy/icon/border rather than color alone.
- Tokens: semantic tokens only; no active legacy aliases, `.claude-card`, or `!important` hot patches.

## Responsive evidence

| Viewport | Artifact | Result |
| --- | --- | --- |
| 1920 × 1080 | `graph-desktop-1920x1080.png` | bounded desktop composition; no over-expansion |
| 1440 × 900 | `graph-desktop-1440x900.png` | primary desktop 3+2 loop and detail panel passed |
| 1366 × 768 | `graph-desktop-1366x768.png` | full learning controls remain reachable |
| 720 × 900 | `graph-split-screen-720x900.png` | narrow sticky detail sheet and vertical loop passed |
| 768 × 1024 | `graph-tablet-768x1024.png` | tablet-like flow passed |

Every required viewport asserts `documentElement.scrollWidth <= clientWidth + 1` before capture.

## Supporting screenshots

- `today-desktop-1440x900.png`
- `reader-desktop-1440x900.png`
- `cards-desktop-1440x900.png`
- `reference-vs-implementation.png`

## Verification evidence

- `npm.cmd run test:browser`: 4/4 Playwright journeys passed with empty console/page error collection.
- Real ε-N path covered local-library initialization, Markdown/KaTeX/table rendering, excerpt basket, exact three selection actions, five card types, four card sections, Concept and Example cards, Topic Flywheel action, second structural dimension, due review, Diagnosis, immutable verification evidence, and persisted files.
- Post-fix targeted UI regression: 16/16 passed.
- Full repository gate: 37/37 files, 376 passed, 1 explicit OS-permission skip; production build passed.

final result: passed
