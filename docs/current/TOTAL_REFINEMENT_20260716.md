# Aleksi Workbench total refinement delivery record

Date: 2026-07-16  
Scope: `Aleksi-Workbench-Codex-Total-Refinement-Delivery.zip` applied to the verified Aleksi Learning Workbench source baseline.

## Delivered outcome

The existing Today → Reader → Card/Diagnosis → Review/Graph → local Markdown library architecture is preserved. The refinement removes demo production data, makes persistence and runtime identity explicit, deepens the Reader/Card/Flywheel learning loop, and replaces CSS compatibility layering with owned semantic styles.

## Architecture decisions

1. **Stable HTTP failures.** Route handlers use one async boundary and one error mapper. Client-visible responses expose stable error codes/messages without absolute library paths or raw stack details.
2. **One persistence boundary.** Library resolution, Markdown value validation, atomic writes, save receipts, and projection files now have dedicated modules. Failed content or projection work restores the original Markdown bytes.
3. **Card Markdown v2 with v1 compatibility.** Unversioned v1 cards remain readable with explicit compatibility defaults. A successful edit writes canonical `schemaVersion: 2`, appends revision history, preserves the stable card identity, and updates `nextReview` from the current save time. New Concept, Example, Boundary, Process, and Mistake cards are v2.
4. **Authoritative Markdown, disposable projections.** Index, review queue, and flywheel graph are derived caches with source fingerprints. Invalid projection JSON is renamed as a timestamped corrupt artifact and rebuilt; Markdown remains authoritative.
5. **Runtime build identity and lifecycle.** Health responses identify version/build, launch state carries a nonce, same-build launches reuse the listener, stale/different builds are rejected, and explicit exit performs safe shutdown.
6. **Learning-first UI.** Reader owns a single manuscript surface plus tool drawers; selected text exposes exactly three top-level actions and five primary card types. Card Studio exposes four learning sections and five save states. Topic Flywheel keeps the 3+2 loop while separating coverage, learning status, and evidence confidence.
7. **Empty production library.** Initialization creates only the required folder tree and metadata. Legacy definition/counterexample/proof directories remain readable when present but are not pre-seeded or pre-created.
8. **Semantic CSS ownership.** `tokens.css` contains semantic values; primitives, Reader, Cards, and Flywheel own their selectors. No active legacy token aliases, `.claude-card`, or `!important` hot patches remain.

## v1 → v2 behavior

| Operation | Result |
| --- | --- |
| Read an unversioned v1 card | Parsed as schema v1 with compatibility metadata; file bytes are not rewritten |
| Rebuild index/graph from v1 | Card remains discoverable and contributes through its compatible card type |
| Edit and save a v1 card | Canonical v2 Markdown is written atomically, stable ID/path are preserved, and a revision entry is appended |
| Create a primary card | Canonical v2 Markdown with typed fields and save receipt |
| Write/index failure | Original card bytes and path are restored |

## Data-safety matrix

| Matrix item | Evidence |
| --- | --- |
| Empty Chinese-path library | `tests/api/vault.test.ts` initializes `学习资料/数列极限知识库`, checks the required tree, and confirms empty reading/five primary card folders |
| Existing library copy/migration | Vault migration tests preserve source data, require confirmation, reject overlaps/non-empty targets, and clean failed destinations |
| Five primary card types | Card API tests create and index Concept, Example, Boundary, Process, and Mistake v2 Markdown |
| v1 read then v2 write | Markdown codec and Card API tests confirm no read-time rewrite, followed by stable-ID v2 update |
| Reopen/reload | Playwright explicitly reloads the Verification page, re-reads persisted verdict state, then confirms two Flywheel dimensions |
| Projection rebuild/recovery | Index/graph tests cover stable fingerprints, no-op fresh reads, corrupt-cache rename, and rebuild from Markdown |
| Tables and math | Real browser flow renders GFM table, checkbox, deletion, external link, inline math, and KaTeX display math |
| Atomic-write failures | File-safety, Reading, and Card tests inject write/index failures and assert cleanup or exact original-byte restoration |

## Verification record

| Gate | Result |
| --- | --- |
| `npm.cmd run verify` | TypeScript, full Vitest suite, and Vite production build passed on the pre-delivery tree; final rerun is recorded in the external verification artifact |
| `npm.cmd run test:browser` | 4/4 passed; full ε-N loop, reload persistence, five required widths, and empty console/page error collection |
| `npm.cmd run verify:clean-base` | Source ZIP extracted, typechecked, built, fully tested, health-checked, repacked idempotently, and audited |
| `npm.cmd run verify:runtime` | Runtime archive audited; real listener start, identity/health, same-build reuse, stale-build rejection, launch nonce, diagnostics, explicit exit, and shutdown passed |
| Visual review | Reference-vs-implementation input plus Today/Reader/Card and five responsive Flywheel captures reviewed; `design-qa.md` ends `final result: passed` |

One test is explicitly skipped only when Windows denies test symlink creation with `EPERM`. All non-symlink path containment and mutation-safety cases run normally.

## Exact implementation inventory

### New responsibility modules

```text
server/http/async-route.ts
server/http/error-mapper.ts
server/http/error-response.ts
server/lib/atomic-write.ts
server/lib/error-code.ts
server/persistence/library-context.ts
server/persistence/markdown-value.ts
server/persistence/save-receipt.ts
server/projections/projection-file.ts
server/runtime/build-identity.ts
server/runtime/lifecycle.ts
src/features/cards/card-save-state.ts
src/features/cards/CardSectionNav.tsx
src/features/reader/ReaderToolsDrawer.tsx
src/features/reader/SelectionActions.tsx
src/features/reader/reader-selection-transfer.ts
src/features/reader/reader.css
src/features/cards/cards.css
src/features/graph/flywheel.css
src/styles/primitives.css
```

### Modified product/runtime files

```text
README.md
package.json
design-qa.md
docs/DATA_SCHEMA.md
docs/current/PROJECT_MAP.md
server/app.ts
server/config/app-settings.ts
server/domain/schemas.ts
server/domain/types.ts
server/lib/filename.ts
server/lib/markdown-codec.ts
server/routes/cards.ts
server/routes/codex.ts
server/routes/diagnoses.ts
server/routes/graph.ts
server/routes/index-rebuild.ts
server/routes/readings.ts
server/routes/review.ts
server/routes/runtime.ts
server/routes/today.ts
server/routes/vault.ts
server/routes/verification.ts
server/services/card-service.ts
server/services/codex-task-service.ts
server/services/diagnosis-service.ts
server/services/graph-service.ts
server/services/index-service.ts
server/services/reading-service.ts
server/services/review-service.ts
server/services/today-service.ts
server/services/vault-service.ts
server/services/verification-store.ts
server/start-server.ts
scripts/audit-runtime.mjs
scripts/package-runtime.mjs
scripts/runtime-package-rules.mjs
scripts/verify-desktop-package.ps1
scripts/verify-runtime.mjs
src/app/App.tsx
src/app/routes.tsx
src/features/cards/card-draft.ts
src/features/cards/CardEditor.tsx
src/features/cards/CardStudioPage.tsx
src/features/diagnosis/DiagnosisPage.tsx
src/features/entrance/LaunchSplash.tsx
src/features/entrance/launch-token.ts
src/features/graph/FlywheelGraph.tsx
src/features/graph/flywheel-state.ts
src/features/graph/WheelGraphPage.tsx
src/features/reader/ReaderPage.tsx
src/features/reader/selection.ts
src/features/review/ReviewPage.tsx
src/features/settings/SettingsDialog.tsx
src/features/verification/VerificationPage.tsx
src/markdown/MarkdownTheme.css
src/styles/base.css
src/styles/components.css
src/styles/fonts.css
src/styles/tokens.css
src/styles/workbench.css
```

### Updated proof surface

```text
tests/api/cards.test.ts
tests/api/graph.test.ts
tests/api/index-rebuild.test.ts
tests/api/readings.test.ts
tests/api/review.test.ts
tests/api/vault.test.ts
tests/browser/entrance-overview.spec.ts
tests/browser/epsilon-n-flow.spec.ts
tests/scripts/delivery-scripts.test.ts
tests/server/app-smoke.test.ts
tests/server/graph-service.test.ts
tests/server/http-errors.test.ts
tests/server/index-service.test.ts
tests/server/markdown-codec.test.ts
tests/server/persistence-boundaries.test.ts
tests/server/runtime-lifecycle.test.ts
tests/server/today-service.test.ts
tests/ui/app-shell.test.tsx
tests/ui/card-diagnosis.test.tsx
tests/ui/flywheel-state.test.ts
tests/ui/launch-splash.test.tsx
tests/ui/reader.test.tsx
tests/ui/review-graph.test.tsx
tests/ui/safety-accessibility.test.tsx
tests/ui/today-settings.test.tsx
```

The generated source manifest and source/runtime/screenshot archives are intentionally not treated as hand-edited implementation files.

## Final deliverables

```text
outputs/AleksiWorkbench-Total-Refinement-Source-20260716.zip
outputs/AleksiWorkbench-Total-Refinement-Preview-win-x64-20260716.zip
outputs/AleksiWorkbench-Total-Refinement-Screenshots-20260716.zip
outputs/AleksiWorkbench-Total-Refinement-Verification-20260716.md
outputs/AleksiWorkbench-Total-Refinement-SHA256-20260716.txt
```
