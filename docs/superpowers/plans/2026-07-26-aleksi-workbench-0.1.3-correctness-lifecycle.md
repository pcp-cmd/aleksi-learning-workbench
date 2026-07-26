# Aleksi Workbench 0.1.3 Correctness and Desktop Lifecycle Implementation Plan

> **For Codex:** Execute this plan in order. Preserve the accepted visual system and security boundaries. Do not install a local Windows/Rust packaging toolchain; the official installer is qualified by GitHub Actions.

**Goal:** Make normal desktop shutdown reliable, prompt exactly once only for genuinely unsafe edits, preserve recoverable drafts across learning-library changes, and make the Windows release workflow fail when an installed application cannot close normally.

**Architecture:** Keep the existing Tauri 2 + React + Node sidecar architecture. Add a small application-close policy at the React shell boundary, keep the Rust `request_exit` command as the low-level shutdown primitive, and make learning-library changes an explicit application transaction. Draft storage remains local and versioned but uses a deterministic active-library identity instead of the global `"active-library"` slot.

**Tech Stack:** React 19, React Router 7, TanStack Query 5, Tauri 2, Rust, Vitest, Playwright, PowerShell, GitHub Actions.

---

## Invariants

1. A clean native close is not intercepted and follows Tauri's normal window-destroy path; only a genuinely dirty native close is prevented and delegated to the application-close policy.
2. Dirty close asks once. Cancel leaves the window and sidecar running. Confirm calls the low-level exit once.
3. Ctrl+Q and Settings Exit call the same high-level policy. They do not reproduce confirmation logic.
4. `beforeunload` protects browser development only. It is never a second desktop close authority.
5. A restored autosaved draft is a recoverable baseline. Only edits after restoration are destructive dirty state.
6. A learning-library change checks dirty state before the server mutation, preserves old-library drafts, activates a deterministic new-library draft namespace, removes library-backed query cache, remounts library-owned UI state, and navigates to `/today`.
7. Overview motion keeps its accepted source speed and visual duration. Service readiness may complete independently; failure and retry remain visible.
8. GitHub Actions builds one canonical installer and then uses the existing installed-desktop verifier to install, launch, close the real window, prove app/sidecar exit, relaunch, and clean up.

## Task 1: Add deterministic close-policy tests

**Files:**
- Create: `src/app/application-close.ts`
- Create: `tests/ui/application-close.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/features/settings/SettingsDialog.tsx`
- Modify: `src/lib/unsaved-guard.ts`

**Implementation:**

- Model close sources as `"native-window" | "keyboard" | "settings"`.
- Serialize concurrent requests with one in-flight promise.
- Return explicit `"cancelled" | "exited" | "browser-ignored" | "native-default"` outcomes.
- Log source/outcome only; never log paths, draft bodies, protocol secrets, or learning content.
- In `WorkbenchShell`, let a clean native close continue without `event.preventDefault()`; prevent and delegate only when dirty state requires a decision.
- Pass the same callback to Settings and Ctrl+Q.
- Gate `beforeunload` with desktop detection.

**Tests:**

- Clean native close is not prevented, does not confirm, and does not invoke the forced runtime-exit command.
- Dirty cancel confirms once and does not exit.
- Dirty confirm confirms once and exits once.
- Concurrent close sources share one decision and one exit.
- Browser mode does not invoke native exit.

## Task 2: Make restored drafts recoverable baselines

**Files:**
- Modify: `src/features/reader/ReadingForm.tsx`
- Modify: `src/features/cards/CardStudioPage.tsx`
- Modify: `src/features/diagnosis/DiagnosisPage.tsx`
- Modify: `src/features/review/ReviewPage.tsx`
- Modify: relevant tests under `tests/ui/`

**Implementation:**

- Initialize `cleanSnapshot` from the exact restored/selected payload instead of `null`.
- In Review, record the restored draft snapshot after queue identity validation; do not treat recovery alone as dirty.
- Keep writing safe local drafts after edits.
- Do not change Verification dirty behavior because it has no restored local draft path.

**Tests:**

- Restored Reading, Card, Diagnosis, and Review content does not register destructive dirty state.
- One edit after recovery registers dirty state.
- Saving/committing resets the baseline as before.

## Task 3: Make library switching transactional

**Files:**
- Modify: `src/lib/active-library-drafts.ts`
- Modify: `src/lib/draft-store.ts`
- Modify: all feature draft-store adapters
- Modify: `src/features/settings/SettingsDialog.tsx`
- Modify: `src/app/App.tsx`
- Modify: `tests/ui/draft-store.test.ts`
- Modify: `tests/ui/today-settings.test.tsx`

**Implementation:**

- Derive a stable non-reversible library draft key from the normalized library path.
- Persist only the active derived key.
- On first adoption, re-key legacy `"active-library"` draft envelopes without deleting them.
- Before initialize/select/migrate, run the shared dirty confirmation. Cancel sends no mutation.
- After success, activate the destination identity, remove library-backed queries, increment a shell generation key, and replace navigation with `/today`.
- Remove `clearAllDraftStorage()` from the change path.
- Keep Settings path inputs local to the dialog; closing the dialog still confirms their loss, but those fields do not masquerade as learning-work dirty state.

**Tests:**

- Cancelled switch makes no API call and preserves old state.
- Successful switch preserves old-library drafts, exposes any existing new-library drafts, removes old query cache, and remounts at `/today`.
- Unrelated localStorage is untouched.

## Task 4: Decouple launch readiness from visual completion

**Files:**
- Modify: `src/features/entrance/launch-machine.ts`
- Modify: `src/app/App.tsx`
- Modify: `tests/ui/launch-machine.test.ts`
- Modify: `tests/ui/desktop-route-restore.test.tsx`

**Implementation:**

- Keep Overview Lottie at `setSpeed(1)` and preserve the 20-second source duration.
- Treat the minimum visual interval as the visual contract; do not require a duplicate animation-complete callback to unlock a healthy ready service.
- Retain the maximum service timeout and retry path.
- Add ordering tests for service-ready-before-animation and animation-before-service-ready.

## Task 5: Strengthen release scripts and Windows installed qualification

**Files:**
- Modify: `package.json`
- Modify: `scripts/run-release-tests.mjs`
- Modify: `scripts/verify-installed-desktop.ps1`
- Modify: `.github/workflows/windows-release-qualification.yml`
- Modify: script contract tests

**Implementation:**

- Give `ui-core`, `ui-desktop`, and `ui-features` real non-overlapping include scopes, or replace them with the one honest `test:release:ui` command.
- Keep one deterministic resource preparation and one installer build.
- After `verify:desktop`, call `verify-installed-desktop.ps1` against the canonical installer.
- Require real normal-window close evidence, process-tree exit, sidecar port closure, relaunch, and verifier-owned cleanup.
- Upload installed lifecycle JSON/logs/hash evidence with the installer.

## Task 6: Version and documentation reconciliation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `release/identity.json`
- Modify: `README.md`
- Modify: `docs/current/PROJECT_MAP.md`
- Modify: `docs/current/TECH_DEBT_REGISTER.md`
- Create: `docs/current/RELEASE_0.1.3.md`

**Implementation:**

- Set canonical release version and artifact paths to `0.1.3`.
- Record shutdown, dirty/recoverable semantics, library transactions, CI realism, lint, large-module, and CSS debt as `RESOLVED`, `ACCEPTED`, `DEFERRED`, or `NEW`.
- State that the official Windows installer is GitHub-built and that no signing credential is used by the unsigned qualification workflow.

## Task 7: Verification and handoff

**Commands when dependencies are available:**

```powershell
npm.cmd run typecheck
npm.cmd run test
npm.cmd run test:browser:production
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
node scripts/verify-release-identity.mjs
```

**GitHub qualification:**

- Push only after explicit user authorization.
- Run `Windows release qualification`.
- Report run URL/status, exact failing step if any, artifact name, installer SHA-256, installed lifecycle evidence, and remaining manual checks.
- Do not create a GitHub Release and do not sign the installer without separate authorization and credentials.
