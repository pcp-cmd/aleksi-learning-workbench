# Aleksi Workbench Desktop Total Recovery Implementation Plan

> Execution note: implement this plan task by task in the current Codex task. No subagent delegation is assumed. Every claim of completion requires the command or installed-runtime evidence named below.

**Goal:** Restore the accepted browser visual and interaction experience inside the existing Windows desktop product, preserve all authoritative Markdown/API behavior and advanced knowledge-quality workflows, add missing recovery/state guarantees, and deliver a newly verified installer plus source and evidence packages.

**Architecture:** Keep one React frontend, one Express sidecar, one Markdown Local Learning Library, and a thin Tauri 2 shell. The accepted 2026-07-16 browser package is immutable comparison input. Desktop-only bridge, lifecycle, security, window, and packaging code is preserved unless a focused test proves it needs repair. Ordinary learning remains five primary routes; Diagnosis and Verification remain contextual/advanced.

**Tech stack:** React 19, React Router 7 data router, TanStack Query 5, TypeScript 5.8, Express 5, Vite 6, Vitest 3, Playwright, Tauri 2, Rust MSVC, NSIS, WebView2.

## Locked inputs and finish gates

- Accepted runtime ZIP SHA-256: B63FE103367B546C5C5E79B21EC72B2D144E0E0012ADD04DF5BE0411C9C3553A
- Accepted source ZIP SHA-256: 83EF031CC0907B276AD2871AC19B454C0255DF674C0755EAAB794E05A4F6048B
- Accepted build ID: sha256-8db1f7a3f8ddc72c2b8b
- Baseline lock: baselines/accepted-browser-total-refinement-20260716/BASELINE_LOCK.md
- Regression inventory: baselines/accepted-browser-total-refinement-20260716/REGRESSION_INVENTORY.md
- Visual matrix: 27 PNGs covering entrance plus eight route/state surfaces at 1440x960, 1280x800, and 960x680
- Selected flywheel reference: docs/reference/aleksi-workbench-selected-flywheel-reference.png
- Formal delivery: installed Windows EXE only; browser is development and comparison evidence
- Required verification chain: source tests, browser tests, clean-source test, runtime/package audits, Rust tests, installer verification, clean install, installed-EXE manual/visual pass

## File responsibility map

- src/app/router.tsx: one data-router definition and route error elements.
- src/app/route-registry.tsx: route metadata, visibility, lazy components, and stable identifiers.
- src/app/App.tsx: providers, launch gate, settings provider, desktop shortcuts, and shell only.
- src/app/NavigationGuard.tsx: one React Router blocker for links, history, shortcuts, and programmatic navigation.
- src/app/AppErrorBoundary.tsx: last-resort global React recovery.
- src/app/RouteErrorBoundary.tsx: page-level recovery that preserves the shell.
- src/app/query-keys.ts: canonical library-backed query keys.
- src/app/query-invalidation.ts: mutation-to-query invalidation map.
- src/lib/draft-store.ts: versioned, bounded, local-only draft storage; never authoritative Markdown.
- src/lib/unsaved-guard.ts: dirty-scope registry and one confirmation policy.
- src/features/settings/SettingsContext.tsx: open/close settings from recovery states and guard dirty settings.
- server/services/vault-service.ts: safe initialization/repair and ordered path fallback.
- src-tauri/src/runtime.rs: desktop path candidates, sidecar lifecycle, and build identity.
- src-tauri/src/lib.rs: single instance, restored window, guarded close, and shutdown.
- tests/browser/total-recovery.spec.ts: route/state/viewport and production-font evidence.
- artifacts/total-recovery-visuals/: generated browser and installed-EXE comparison evidence, never source truth.

---

## Task 0: Lock the accepted browser baseline and regression inventory

**Evidence:**
- Existing: baselines/accepted-browser-total-refinement-20260716/BASELINE_LOCK.md
- Existing: baselines/accepted-browser-total-refinement-20260716/REGRESSION_INVENTORY.md
- Existing: baselines/accepted-browser-total-refinement-20260716/evidence/*.png

- [x] Verify source/runtime ZIP hashes and build identity.
- [x] Run the accepted runtime against an isolated 12-file learning-library copy.
- [x] Capture the 27-image visual matrix only after route loading markers settle.
- [x] Record the 152 identical, 60 changed, 0 missing, and 84 desktop-only file inventory.
- [ ] Copy the baseline lock and regression inventory into the final delivery evidence package without modifying the locked baseline directory.

## Task 1: Create a clean recovery checkout and record the pre-change state

**Files:**
- Create working checkout: ../aleksi-learning-workbench-total-recovery-20260717/
- Create: docs/current/TOTAL_RECOVERY_BASELINE_20260717.md
- Modify: .gitignore

- [ ] Copy the current authoritative desktop source to the sibling recovery checkout, excluding node_modules, dist, artifacts, src-tauri/target, and generated src-tauri/resources.
- [ ] Initialize Git in the recovery checkout, commit the imported desktop snapshot, and create branch feature/desktop-total-recovery-20260717. Do not touch the older dirty June checkout.
- [ ] Restore project-local JavaScript dependencies:

    npm.cmd ci

- [ ] Run and record the exact pre-change commands:

    npm.cmd run typecheck
    npm.cmd run test
    npm.cmd run build
    npm.cmd run test:browser
    npm.cmd run package:source
    npm.cmd run verify:clean-base

- [ ] If a command fails or hangs, capture the failing test/process first, diagnose the root cause, and add the smallest focused regression test before changing implementation.
- [ ] Commit only the imported baseline and factual preflight record.

## Task 2: Freeze Markdown, schema, API, and security behavior

**Files:**
- Modify only if a regression test exposes a defect:
  - server/domain/schemas.ts
  - server/persistence/library-context.ts
  - server/persistence/markdown-value.ts
  - server/services/card-service.ts
  - server/services/review-service.ts
  - server/services/verification-*.ts
  - shared/card-types.ts
  - shared/vault-map.ts
- Modify: tests/server/persistence-boundaries.test.ts
- Modify: tests/server/markdown-codec.test.ts
- Modify: tests/api/cards.test.ts
- Modify: tests/api/review.test.ts
- Modify: tests/api/verification.test.ts

- [ ] Run the focused compatibility suite before UI work:

    npm.cmd test -- tests/server/persistence-boundaries.test.ts tests/server/markdown-codec.test.ts tests/server/file-safety.test.ts tests/api/cards.test.ts tests/api/review.test.ts tests/api/verification.test.ts tests/shared/card-vault-map.test.ts

- [ ] Add explicit assertions for v1/v2 Markdown read compatibility, Chinese/emoji/math round-trip, atomic write boundaries, legacy review-directory reads, verification revocation propagation, and unchanged card type mapping.
- [ ] Do not migrate, rename, delete, or rewrite authoritative user Markdown.
- [ ] Commit the compatibility fence separately from UI recovery.

## Task 3: Repair development/production typography and semantic tokens

**Files:**
- Modify: src/app/App.tsx
- Modify: src/styles/fonts.css
- Modify: src/styles/tokens.css
- Modify: src/styles/base.css
- Modify: src/styles/workbench.css
- Modify: src/styles/components.css
- Modify: scripts/package-rules.mjs
- Modify: scripts/desktop-package-rules.mjs
- Modify: tests/ui/css-governance.test.ts
- Create: tests/ui/typography-contract.test.ts

- [ ] Write failing tests that reject import.meta.env.DEV-conditioned typography, page-local font-family declarations, undefined semantic tokens, duplicate top-level token names, unsupported breakpoints, and !important.
- [ ] Import the font policy identically in development and production. fonts.css defines optional private @font-face declarations only; tokens.css owns the semantic serif/sans/mono stacks and stable system fallbacks.
- [ ] Keep private font binaries out of source/public delivery archives. A private local desktop build may use them only when they are present and permitted.
- [ ] Derive bounded page/section/card/control sizes from the accepted screenshots. Ordinary route headings must not use the 4–7 rem launch scale.
- [ ] Keep width breakpoints at 1024px, 768px, and 560px and retain a usable minimum window of 960x680.
- [ ] Pass:

    npm.cmd test -- tests/ui/css-governance.test.ts tests/ui/typography-contract.test.ts
    npm.cmd run build

## Task 4: Consolidate router, global navigation protection, and error recovery

**Files:**
- Create: src/app/router.tsx
- Create: src/app/NavigationGuard.tsx
- Create: src/app/AppErrorBoundary.tsx
- Create: src/app/RouteErrorBoundary.tsx
- Modify: src/app/App.tsx
- Modify: src/app/routes.tsx
- Modify: src/app/route-registry.tsx
- Modify: src/lib/unsaved-guard.ts
- Modify: src/components/NavigationRail.tsx
- Create: tests/ui/navigation-guard.test.tsx
- Create: tests/ui/error-recovery.test.tsx
- Modify: tests/ui/route-registry.test.tsx
- Modify: tests/ui/app-shell.test.tsx

- [ ] Write failing tests for sidebar links, ordinary internal links, browser back/forward, keyboard shortcuts, programmatic navigation, settings close, desktop close, confirm/discard, and shell survival after a route render error.
- [ ] Replace BrowserRouter plus nested route truth with createBrowserRouter/RouterProvider while keeping route metadata in route-registry.tsx.
- [ ] Implement NavigationGuard with React Router useBlocker. Pages register dirty state through unsaved-guard.ts; one confirmation decision either proceeds or resets the blocked navigation.
- [ ] Wrap the provider tree in AppErrorBoundary and every route element in RouteErrorBoundary. Recovery actions are reload route, return Today, and open Settings where relevant; never expose stack traces.
- [ ] Preserve exactly five primary routes in order and keep Diagnosis contextual and Verification advanced.
- [ ] Restore the restrained accepted Aleksi rail mark, tooltip, keyboard access, return-to-Today behavior, and dirty-state protection; keep Flywheel as the fifth primary route.
- [ ] Pass:

    npm.cmd test -- tests/ui/navigation-guard.test.tsx tests/ui/error-recovery.test.tsx tests/ui/route-registry.test.tsx tests/ui/app-shell.test.tsx tests/ui/safety-accessibility.test.tsx

## Task 5: Restore the accepted entrance while decoupling service readiness

**Files:**
- Modify: src/features/entrance/launch-machine.ts
- Modify: src/features/entrance/LaunchSplash.tsx
- Modify: src/features/entrance/OverviewGlyph.tsx
- Preserve: public/motion/overview.json
- Modify: src/styles/workbench.css
- Modify: tests/ui/launch-machine.test.ts
- Modify: tests/ui/launch-splash.test.tsx
- Modify: tests/ui/overview-glyph.test.tsx
- Modify: tests/browser/entrance-overview.spec.ts

- [ ] Write failing state-table tests for animation loading/completion, minimum visible time, ready sidecar, missing motion asset, reduced motion, sidecar crash, timeout, retry, and browser nonce behavior.
- [ ] Preserve the accepted two-column entrance composition and real overview.json. Do not replace it with a generic spinner or oversized dashboard.
- [ ] Let visual animation and sidecar readiness report independently. Enter Today only when the minimum visual interval and required readiness conditions are satisfied; show a bounded plain-language retry state on failure.
- [ ] Use one cacheable local motion asset and deterministic animation speed derived from its real frames.
- [ ] Verify that browser development and production use the same entrance CSS and typography.
- [ ] Pass:

    npm.cmd test -- tests/ui/launch-machine.test.ts tests/ui/launch-splash.test.tsx tests/ui/overview-glyph.test.tsx
    npm.cmd run test:browser -- tests/browser/entrance-overview.spec.ts

## Task 6: Add versioned draft storage and central query invalidation

**Files:**
- Create: src/lib/draft-store.ts
- Create: src/app/query-keys.ts
- Create: src/app/query-invalidation.ts
- Create: tests/ui/draft-store.test.ts
- Create: tests/ui/query-invalidation.test.ts
- Modify: src/app/query-client.ts

- [ ] Write failing tests for schema versioning, corrupted/oversized/expired draft rejection, per-library namespaces, source-reference pruning, explicit clear, and no authoritative Markdown writes.
- [ ] Define canonical library-backed query families for vault, readings, cards, today, graph, review, verification, and recent activity.
- [ ] Define mutation maps:
  - card save -> cards/detail, Today, Flywheel, Review availability, graph projections;
  - review completion -> Review, Today, Flywheel, card detail, recent activity;
  - verification verdict/revocation -> Verification, card trust/detail, Today, Flywheel dependents;
  - library change -> all library queries and invalid source-bound drafts.
- [ ] Replace page-local manual invalidation with one invalidateAfterMutation helper.
- [ ] Pass:

    npm.cmd test -- tests/ui/draft-store.test.ts tests/ui/query-invalidation.test.ts tests/ui/api-client.test.ts

## Task 7: Restore Today and implement actionable library recovery

**Files:**
- Modify: src/features/today/TodayPage.tsx
- Create: src/features/settings/SettingsContext.tsx
- Modify: src/features/settings/SettingsDialog.tsx
- Modify: server/services/vault-service.ts
- Modify: server/routes/vault.ts
- Modify: src-tauri/src/runtime.rs
- Modify: tests/ui/today-settings.test.tsx
- Modify: tests/api/vault.test.ts
- Modify: tests/server/persistence-boundaries.test.ts

- [ ] Write failing tests for the single next action, working secondary actions, recent progress, unavailable-library recovery button, safe structure repair, ordered path fallback, and all-query invalidation after a library switch.
- [ ] Keep Today free of engineering language. The default surface shows one next action, why it is next, one primary button, quieter secondary actions, and recent feedback.
- [ ] Let Today open Settings directly through SettingsContext when the library cannot be used.
- [ ] In autoPrepareVault, try the active library first, then Documents/Aleksi Learning Workbench, then the desktop app-data library path supplied by Tauri. Repair only missing safe directories/metadata; never overwrite content.
- [ ] Keep manual user-selected folders as the final explicit fallback.
- [ ] Guard dirty Settings fields on close and keep advanced migration/diagnostics collapsed by default.
- [ ] Pass:

    npm.cmd test -- tests/ui/today-settings.test.tsx tests/api/vault.test.ts tests/server/persistence-boundaries.test.ts

## Task 8: Restore Reader and durable reading context

**Files:**
- Modify: src/features/reader/ReaderPage.tsx
- Modify: src/features/reader/ReadingForm.tsx
- Modify: src/features/reader/excerpt-basket.ts
- Modify: src/features/reader/reader-selection-transfer.ts
- Modify: src/features/reader/reader.css
- Create: src/features/reader/reader-draft.ts
- Modify: tests/ui/reader.test.tsx
- Modify: tests/ui/reading-import.test.ts
- Modify: tests/ui/reader-selection-transfer.test.ts
- Create: tests/ui/reader-recovery.test.tsx

- [ ] Write failing tests for selected reading URL restoration, scroll restoration, import-draft recovery, excerpt basket persistence, safe source pruning after library change, and all card-type selection actions.
- [ ] Preserve the accepted paper layout, typography, material drawer, import drawer, Markdown/math rendering, image handling, and selection popover.
- [ ] Store selected reading ID in the URL and a versioned local snapshot; restore scroll only after the same reading is rendered.
- [ ] Autosave only Reader form/excerpt state to draft-store.ts. Saving remains the only path that writes authoritative reading Markdown.
- [ ] Keep native desktop import and browser file/drop import on the same normalizeReadingImport pipeline.
- [ ] Use central invalidation after a reading save and clear the committed draft.
- [ ] Pass:

    npm.cmd test -- tests/ui/reader.test.tsx tests/ui/reading-import.test.ts tests/ui/reader-selection-transfer.test.ts tests/ui/reader-recovery.test.tsx

## Task 9: Repair Card Studio creation, save, discovery, and recovery

**Files:**
- Modify: src/features/cards/CardStudioPage.tsx
- Modify: src/features/cards/CardEditor.tsx
- Modify: src/features/cards/card-draft.ts
- Modify: src/features/cards/cards.css
- Create: src/features/cards/card-draft-store.ts
- Modify: tests/ui/card-diagnosis.test.tsx
- Modify: tests/ui/desktop-interactions.test.tsx
- Create: tests/ui/card-recovery.test.tsx

- [ ] Write failing tests for Reader-selection creation, same-reading continuation, personal-thought creation, explicit save, Ctrl+S, save receipt, dirty reset, local draft recovery, recent-card discovery, card ID URL restoration, and immediate next action.
- [ ] Keep all current card types and authoritative create/update schemas.
- [ ] Restore the accepted editor/source/save/recent/next-action hierarchy and remove duplicated or engineering-only metadata from the default layer.
- [ ] Autosave the editable CardDraft to the separate draft store with library/source identity. Never write card Markdown until Save succeeds.
- [ ] After Save, clear the draft, update the card ID in the URL, and call the central card-save invalidation map.
- [ ] Pass:

    npm.cmd test -- tests/ui/card-diagnosis.test.tsx tests/ui/desktop-interactions.test.tsx tests/ui/card-recovery.test.tsx tests/api/cards.test.ts

## Task 10: Restore Topic Flywheel from the selected structural reference

**Files:**
- Modify: src/features/graph/WheelGraphPage.tsx
- Modify: src/features/graph/FlywheelGraph.tsx
- Modify: src/features/graph/flywheel-state.ts
- Modify: src/features/graph/flywheel.css
- Modify: tests/ui/review-graph.test.tsx
- Modify: tests/ui/flywheel-state.test.ts
- Modify: tests/browser/epsilon-n-flow.spec.ts

- [ ] Write failing tests for Concept -> Example -> Boundary -> Process -> Mistake order, status semantics, selected topic URL state, keyboard/click interaction, one recommended next action, and no horizontal overflow at all required widths.
- [ ] Use the selected reference for structure, rhythm, loop direction, and selected-state hierarchy while retaining the accepted browser token system. Do not rasterize the whole interface.
- [ ] Keep current topic, five-node cycle, progress/status, recommended action, and compact relationships as the information order.
- [ ] Preserve server graph projection behavior and route handoff to Review/Diagnosis/Verification.
- [ ] Capture fresh flywheel screenshots at 1440x960, 1280x800, 1024x768, and 960x680.
- [ ] Pass:

    npm.cmd test -- tests/ui/review-graph.test.tsx tests/ui/flywheel-state.test.ts tests/api/graph.test.ts

## Task 11: Simplify Review and preserve contextual Diagnosis

**Files:**
- Modify: src/features/review/ReviewPage.tsx
- Modify: src/features/diagnosis/DiagnosisPage.tsx
- Create: src/features/review/review-draft.ts
- Create: src/features/diagnosis/diagnosis-draft.ts
- Modify: src/styles/components.css
- Modify: tests/ui/review-graph.test.tsx
- Modify: tests/ui/card-diagnosis.test.tsx
- Create: tests/ui/review-diagnosis-recovery.test.tsx
- Modify: tests/api/review.test.ts

- [ ] Write failing tests for prompt -> response/I do not know -> reveal -> result -> save -> next, progressive diagnosis only for weak outcomes, review-response recovery, diagnosis recovery, and context handoff.
- [ ] Keep ordinary Review compact; hide evidence-quality and correction detail until the learner reveals/needs it.
- [ ] Persist uncommitted response and diagnosis drafts in draft-store.ts; clear them only after successful authoritative save or explicit discard.
- [ ] Use stable card/concept URL parameters so reload does not select an unrelated first item.
- [ ] Call the central review-completion invalidation map.
- [ ] Pass:

    npm.cmd test -- tests/ui/review-graph.test.tsx tests/ui/card-diagnosis.test.tsx tests/ui/review-diagnosis-recovery.test.tsx tests/api/review.test.ts

## Task 12: Preserve Verification, relationships, revocation, and GPT JSON import behind progressive disclosure

**Files:**
- Modify: src/features/verification/VerificationPage.tsx
- Modify: src/features/cards/CardStudioPage.tsx
- Modify: src/features/graph/WheelGraphPage.tsx
- Modify: src/styles/workbench.css
- Modify: tests/ui/verification.test.tsx
- Modify: tests/api/verification.test.ts

- [ ] Write failing tests for plain-language trust summary, explicit advanced entry, candidate evidence creation, manual verdict, GPT JSON validation/confirmation, dependency relationships, revocation reason, affected dependents, and refreshed card/graph trust.
- [ ] Keep the default Card/Flywheel surface limited to trust status and a clear View evidence/Verify action.
- [ ] Keep immutable ledger detail, relationship management, revocation history, and GPT-assisted import inside labeled advanced disclosures.
- [ ] Preserve URL record/card context across reload and provide a clear recovery notice when context no longer exists.
- [ ] Replace verification-only invalidation with the central verification/revocation map.
- [ ] Pass:

    npm.cmd test -- tests/ui/verification.test.tsx tests/api/verification.test.ts tests/ui/review-graph.test.tsx

## Task 13: Consolidate CSS ownership, lazy loading, and visual-regression evidence

**Files:**
- Modify: src/styles/tokens.css
- Modify: src/styles/base.css
- Modify: src/styles/primitives.css
- Modify: src/styles/components.css
- Modify: src/styles/workbench.css
- Modify: src/features/reader/reader.css
- Modify: src/features/cards/cards.css
- Modify: src/features/graph/flywheel.css
- Modify: src/markdown/MarkdownTheme.css
- Modify: src/markdown/MarkdownRenderer.tsx
- Create: tests/browser/total-recovery.spec.ts
- Modify: tests/ui/css-governance.test.ts

- [ ] Generate selector/token ownership inventories and make the governance test fail on duplicates, undefined custom properties, final override sheets, private-font archive entries, unsupported breakpoints, or !important.
- [ ] Keep tokens in tokens.css, generic primitives in primitives/components, shell/route framing in workbench, and feature-only selectors in feature stylesheets.
- [ ] Preserve lazy Markdown/KaTeX loading after the entrance; do not add speculative lazy boundaries that obscure errors.
- [ ] Add a deterministic browser evidence test for entrance, Today, Reader, Cards, Flywheel, Review, Diagnosis, Verification, Settings, empty/error/advanced states, and required viewports.
- [ ] Record computed production font families, viewport size, route URL, scroll overflow, primary-action visibility, and screenshot path alongside each image.
- [ ] Compare new evidence with the locked baseline and classify every difference as required desktop capability, explicit plan change, or regression.
- [ ] Pass:

    npm.cmd test -- tests/ui/css-governance.test.ts tests/ui/typography-contract.test.ts
    npm.cmd run test:browser
    npm.cmd run build

## Task 14: Verify desktop lifecycle, route/window restoration, and safe shutdown

**Files:**
- Modify: src/desktop/runtime.ts
- Modify: src-tauri/src/runtime.rs
- Modify: src-tauri/src/lib.rs
- Modify: src-tauri/src/commands.rs
- Modify: src-tauri/tauri.conf.json
- Modify: tests/ui/desktop-runtime.test.ts
- Modify: tests/ui/desktop-interactions.test.tsx
- Modify: tests/server/runtime-lifecycle.test.ts
- Modify: tests/scripts/desktop-delivery.test.ts

- [ ] Write failing tests for one sidecar, unique loopback readiness, crash/retry, bounded shutdown, second-instance focus, guarded close, last safe route/context, minimum window, window size/position restore, and fallback to Today for stale context.
- [ ] Store only safe route/context identifiers after committed navigation. Never restore an uncommitted editor state as authoritative data; drafts restore separately.
- [ ] Preserve fixed executable/arguments, loopback-only API base, origin allowlist, build-identity validation, and no arbitrary shell/filesystem command.
- [ ] Verify source-level desktop contracts:

    npm.cmd run verify:desktop:source
    npm.cmd test -- tests/ui/desktop-runtime.test.ts tests/ui/desktop-interactions.test.tsx tests/server/runtime-lifecycle.test.ts tests/scripts/desktop-delivery.test.ts

- [ ] Before installing Rust, Visual Studio Build Tools, or a Windows SDK, obtain explicit user permission because those tools were intentionally removed immediately before this recovery task.
- [ ] After permission, install only the documented minimal Rust MSVC/Build Tools/SDK components, record exact versions, and avoid changing VS Code or WebView2 Runtime.
- [ ] Pass:

    cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
    cargo test --manifest-path src-tauri/Cargo.toml

## Task 15: Build, install, compare, fix, and package one complete delivery

**Files:**
- Modify: package.json
- Modify: scripts/prepare-desktop.mjs
- Modify: scripts/package-desktop.mjs
- Modify: scripts/verify-desktop.mjs
- Modify: scripts/package-source.mjs
- Modify: README.md
- Modify: docs/current/PRODUCT_DECISIONS.md
- Modify: docs/current/TECH_DEBT_REGISTER.md
- Create: docs/current/DESKTOP_TOTAL_RECOVERY_20260717.md
- Create: artifacts/AleksiWorkbench-Desktop-Total-Recovery-Verification-20260717.json
- Create: artifacts/AleksiWorkbench-Desktop-Total-Recovery-SHA256-20260717.txt

- [ ] Run the complete fresh source chain:

    npm.cmd run verify
    npm.cmd run test:browser
    npm.cmd run package:source
    npm.cmd run verify:clean-base
    npm.cmd run package:runtime
    npm.cmd run audit:runtime
    npm.cmd run verify:runtime
    npm.cmd run verify:desktop:source

- [ ] Build a new NSIS installer and verify resources/identity:

    npm.cmd run package:desktop
    npm.cmd run verify:desktop

- [ ] Install in the current-user scope, launch through normal Windows process semantics, and verify no dependency on system Node, PowerShell, browser, source path, Rust, or Visual Studio.
- [ ] Exercise the installed EXE through first launch/library creation, Today, Reader/import/selection, Cards/save, Flywheel, Review, Diagnosis, Verification/GPT JSON/revocation, Settings/advanced, restart persistence, route/window restore, second instance, sidecar restart, guarded close, clean shutdown, and uninstall-preserves-library.
- [ ] Capture installed-EXE screenshots for every required route/state at 1440x960, 1280x800, and 960x680. These images must be real installed-window evidence, not browser images relabeled as desktop.
- [ ] Compare installed evidence against the locked browser baseline; fix all P0/P1 discrepancies and rerun the full matrix after the last change.
- [ ] Package source and installer separately, audit both, and hash installer, source ZIP, verification JSON, implementation record, baseline lock, comparison record, and screenshots.
- [ ] Record factual limitations: Authenticode status, clean-account/VM coverage, WebView2 missing-runtime branch, Windows architecture/version coverage, and any remaining P2 difference.

## Final acceptance checklist

- [ ] The installed EXE is the formal product and visually matches the accepted browser system within documented desktop-only differences.
- [ ] Today, Reader, Cards, Flywheel, and Review are the five primary routes.
- [ ] Diagnosis, Verification, relationships, revocation history, and GPT JSON import remain functional behind progressive disclosure.
- [ ] Development and production use the same frontend behavior, token system, and font policy.
- [ ] Dirty navigation, settings close, browser/WebView history, keyboard/programmatic navigation, and desktop close are protected.
- [ ] Card, diagnosis, review response, excerpt basket, selected reading, and scroll state recover locally without silently writing authoritative Markdown.
- [ ] Mutation invalidation is centralized and no stale Today/Flywheel/Review/trust state remains after save.
- [ ] Global and route-level failures recover without a white screen or stack trace.
- [ ] Sidecar lifecycle, window/route restore, single instance, clean shutdown, and learning-library preservation are verified from the installed EXE.
- [ ] Source ZIP, installer, manifests, command record, installed-runtime record, visual comparison, limitations, product decisions, and debt register are delivered with SHA-256 hashes.

