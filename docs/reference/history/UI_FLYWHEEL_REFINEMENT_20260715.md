# UI flywheel refinement implementation record

> Retired from `docs/current`; retained here as historical evidence only.

Date: 2026-07-15

## Outcome

Aleksi Workbench now presents the real knowledge-graph state as a five-stage learning flywheel—概念、例子、边界、流程、错误—using the selected linear-loop reference as visual direction while preserving the existing Today → Reader → Card/Diagnosis → Review/Graph → Vault architecture.

## Implemented changes

### Knowledge flywheel

- Replaced the old ring-node graph with a responsive 3+2 five-stage loop.
- Added deterministic UI-state derivation for complete, in-progress, not-started, needs-review, trust-affected, and blocked states.
- Made every stage card keyboard-focusable and clickable, with number, icon, description, status text, card count, and progress.
- Added one supporting stage-detail panel plus collapsed gaps/relations; kept the graph API contract unchanged.

### Today, Reader, Card, and Danus

- Kept Today focused on one unique next action and collapsed supporting actions under “稍后”.
- Added `.md`, `.markdown`, and `.txt` UTF-8 file import to the existing Reader create flow.
- Added title suggestion, invalid/empty-file handling, large-file warning, and explicit keep-both/replace decisions for duplicate titles.
- Implemented atomic in-place replacement that preserves reading ID, path, and creation time, with rollback if index rebuild fails.
- Moved Card source/classification controls and candidate scaffold behind default-collapsed disclosure while keeping source → restatement → structured fields → next action primary.
- Collapsed ordinary-card Danus/trust detail while leaving the dedicated verification page unchanged.

### Windows runtime lifecycle

- Added launch lock, PID file, and runtime identity metadata.
- Reuses an existing healthy runtime only when PID, process start time, executable, command line, port, and health response all match the current package.
- Cleans stale identity without killing unrelated processes.
- Added explicit stop scripts that validate runtime identity before stopping.
- Runtime verification now launches twice, proves PID/port reuse, and exercises safe shutdown.

## Execution order, dependencies, and acceptance boundaries

1. Read the real routes, graph/reading/card contracts, shared CSS, and package scripts before changing pages.
2. Normalize the shared surface/status/spacing/radius/shadow/motion token direction before integrating the new graph composition.
3. Keep flywheel state projection in `flywheel-state.ts` and rendering in `FlywheelGraph.tsx`; retain the existing graph API as the source of truth.
4. Refine Today, Reader, Card Studio, and ordinary trust presentation only after the shared hierarchy and flywheel interaction were stable.
5. Keep browser file decoding in `reading-import.ts`, persistence/rollback in `reading-service.ts`, and the existing Reader create flow as the UI entry point.
6. Validate responsive/browser behavior before changing the portable runtime lifecycle; then prove single-instance reuse and ownership-checked stop against the packaged build.
7. Treat source packaging, extracted-source health, runtime audit, browser proof, visual comparison, and checksum verification as separate completion gates.

Acceptance boundary: no route, card type, legacy parser, review/diagnosis behavior, local-library lifecycle, Danus evidence model, or Codex task contract was removed or replaced for visual convenience. PDF/OCR/cloud ingestion remains explicitly outside this task.

## Actual modified-file list

The list below is the UI/refinement delivery set in the live source tree; generated `dist`, `artifacts`, `test-results`, dependency trees, and TypeScript build-info files are excluded.

### Product and data implementation

- `server/services/reading-service.ts`
- `src/features/cards/CardEditor.tsx`
- `src/features/cards/CardStudioPage.tsx`
- `src/features/graph/FlywheelGraph.tsx`
- `src/features/graph/flywheel-state.ts`
- `src/features/graph/WheelGraphPage.tsx`
- `src/features/reader/ReaderPage.tsx`
- `src/features/reader/ReadingForm.tsx`
- `src/features/reader/reading-import.ts`
- `src/features/today/TodayPage.tsx`

### Shared styling and package lifecycle

- `src/styles/components.css`
- `src/styles/tokens.css`
- `src/styles/workbench.css`
- `package.json`
- `package-lock.json`
- `scripts/package-runtime.mjs`
- `scripts/runtime-package-rules.mjs`
- `scripts/verify-runtime.mjs`

### Tests and browser evidence

- `tests/api/readings.test.ts`
- `tests/browser/epsilon-n-flow.spec.ts`
- `tests/scripts/delivery-scripts.test.ts`
- `tests/ui/app-shell.test.tsx`
- `tests/ui/flywheel-state.test.ts`
- `tests/ui/reader.test.tsx`
- `tests/ui/reading-import.test.ts`
- `tests/ui/review-graph.test.tsx`
- `tests/ui/safety-accessibility.test.tsx`

### Records and reference assets

- `design-qa.md`
- `docs/DATA_SCHEMA.md`
- `docs/current/UI_FLYWHEEL_REFINEMENT_20260715.md`
- `docs/reference/aleksi-workbench-selected-flywheel-reference.png`
- `docs/superpowers/plans/2026-07-15-aleksi-ui-flywheel-refinement.md`

## Existing components and contracts reused

- `NavigationRail` and the existing four primary learning routes.
- `StatusDot` and `SaveReceipt` for state and filesystem receipts.
- `MarkdownRenderer`, its GFM/KaTeX pipeline, and existing reading media resolver.
- `apiClient`, React Query caches, unsaved-change guard, Reader selection transfer, and excerpt basket.
- Existing `ReadingForm`, `CardEditor`, graph API, reading API, Vault/index rebuild, atomic write, and rollback paths.
- Existing card-type schemas, legacy card compatibility, review/diagnosis services, Danus verification page, and Codex task generation.
- Existing local font files and Anthropic serif/sans/mono fallback policy.

## Duplicate or obsolete styles removed

The old graph implementation was removed in place rather than left as a parallel rendering path. Obsolete selector families removed from `components.css` include `.graph-board`, `.flywheel-svg*`, `.flywheel-node*`, `.graph-node-layer`, and `.graph-node-button*`. They were replaced by one `.flywheel-board`, `.flywheel-loop`, `.flywheel-stage-grid`, and `.flywheel-stage-card*` system. No standalone source file was deleted because the replacement reuses the same feature route and component boundary.

## Reference adaptation

The implementation follows the selected reference through the 3+2 card composition, large quiet return loop, numbered stage identity, restrained warm palette, explicit arrows, calm center caption, and active/completed/unavailable/affected state hierarchy. It does not copy the reference's invented full sidebar, dashboard donut, note widgets, fake counts, or unrelated routes. Real Workbench navigation, graph data, cards, trust state, and next action remain authoritative.

## Verification evidence

- `npm run verify`: 33 files, 349 tests passed, 1 OS-permission skip; production build passed.
- `npm run test:browser`: 3 browser journeys passed, including the persisted ε-N learning loop and an empty console/page-error assertion.
- `npm run verify:clean-base`: build, tests, source package, extracted-source health, idempotent repack, and audit passed.
- `npm run verify:runtime`: runtime build/audit, launch, repeat-launch reuse, health, and stop passed.
- `design-qa.md`: six required viewport classes, core page captures, contrast, touch targets, reduced motion, and same-input reference comparison passed.

The repository has no independent lint script. Static coverage is provided by TypeScript project checking, the full Vitest suite, production Vite build, package audits, browser regression, and targeted source scans; this limitation is recorded rather than presented as a lint pass.

## Known remaining limitations

- The repository still has no independent lint command, so no lint pass is claimed.
- One symlink-escape test is skipped only when Windows denies creation of the test symlink with `EPERM`; the skip remains visible in the totals.
- Browsers do not expose an absolute local source path. File imports now persist the safe base `sourceFileName`; they intentionally do not invent or store a fake absolute path.
- PDF parsing, OCR, cloud upload, and heavy document processing remain outside the requested scope.
