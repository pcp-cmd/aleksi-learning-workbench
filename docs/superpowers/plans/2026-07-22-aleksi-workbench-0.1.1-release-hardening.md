# Aleksi Workbench 0.1.2 Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualify Aleksi Workbench 0.1.2 from the supplied, manifest-verified 0.1.1 source by authenticating its loopback sidecar, making packaged configuration deterministic, bounding local operations, preserving the approved learning experience, and generating an honest unsigned release-evidence bundle. The supplied 0.1.1 installer remains the upgrade/audit predecessor.

**Architecture:** Keep the existing React 19 frontend, Express 5 local sidecar, Markdown Local Learning Library, and thin Tauri 2 Windows shell. Tauri owns a per-launch secret and passes it only to the child process and trusted WebView memory; Express enforces the secret and desktop-origin policy on every `/api` route. A validated release-identity document drives cross-file assertions and release metadata without replacing Tauri's native configuration model.

**Tech Stack:** TypeScript 5.8, React 19, Express 5, Zod 3, Vitest 3, Playwright 1.52, Vite 6, Node 22, Rust 1.97, Tauri 2.11, NSIS, WebView2.

---

## Task 0: Lock repository truth and pre-change evidence

**Files:**
- Create: `artifacts/review/repository-baseline.md`
- Modify: `docs/superpowers/plans/2026-07-22-aleksi-workbench-0.1.1-release-hardening.md`

- [x] Record branch, SHA, pre-existing dirty files, installer hashes/versions/signature state, toolchain versions, lockfiles, commands, persistence formats, permissions, CSP, routes, sidecar resources, and workflow state.
- [x] Record the recovered source chain: manifest-verified 0.1.1 source ZIP imported as the authoritative baseline, supplied 0.1.1 installer retained as the predecessor, and the older Git checkout retained only for history.
- [x] Run and record the pre-change baseline:

    npm.cmd ci --ignore-scripts
    npm.cmd run typecheck
    npm.cmd run test
    npm.cmd run build
    cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
    cargo check --manifest-path src-tauri/Cargo.toml
    cargo test --manifest-path src-tauri/Cargo.toml

- [x] Preserve the user's pre-existing deleted `design-qa.md`; do not restore, stage, or include it.

## Task 1: Establish and validate one 0.1.2 release identity

**Files:**
- Create: `release/identity.json`
- Create: `scripts/release-identity.mjs`
- Create: `scripts/validate-release-identity.mjs`
- Create: `shared/release-identity.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `scripts/prepare-desktop.mjs`
- Modify: `src/features/settings/SettingsDialog.tsx`
- Create: `tests/scripts/release-identity.test.ts`

- [ ] Write a failing test that rejects blank fields and mismatches across package, Cargo, Tauri, runtime identity, installer filename, identifier, schema version, and protocol version.
- [ ] Define canonical values for Aleksi Workbench 0.1.2, `io.aleksi.workbench`, publisher `Aleksi`, executable/installer names, application directory names, schema version 2, and protocol version 1.
- [ ] Generate TypeScript constants and release metadata from the validated JSON while preserving native Tauri configuration files as auditable inputs.
- [ ] Display canonical name/version/build/protocol details in the existing Settings/About surface.
- [ ] Pass:

    npm.cmd test -- tests/scripts/release-identity.test.ts tests/ui/today-settings.test.tsx
    npm.cmd run validate:release-identity

## Task 2: Authenticate every sidecar API request and harden the handshake

**Files:**
- Create: `server/http/desktop-auth.ts`
- Modify: `server/app.ts`
- Modify: `server/http/desktop-cors.ts`
- Modify: `server/start-server.ts`
- Modify: `server/runtime/build-identity.ts`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/runtime.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src/desktop/runtime.ts`
- Modify: `src/lib/api-client.ts`
- Modify: `src/app/App.tsx`
- Create: `tests/server/desktop-auth.test.ts`
- Modify: `tests/server/listener.test.ts`
- Modify: `tests/ui/api-client.test.ts`
- Modify: `tests/ui/desktop-runtime.test.ts`

- [ ] Write failing HTTP tests for valid secret/origin, missing and wrong secret, originless request, wrong origin, authenticated preflight, and secret-free errors.
- [ ] Generate a cryptographically random 256-bit secret in Tauri for each sidecar launch and pass it only via an inherited environment variable.
- [ ] Add `X-Aleksi-Protocol-Secret` to every frontend and native `/api` request; never include it in URLs, persistence, logs, diagnostics, readiness output, or errors.
- [ ] Require an allowlisted desktop Origin plus the secret in packaged mode; allow the existing same-origin browser-development path only outside packaged mode.
- [ ] Add `protocolVersion`, `shellBuildId`, and `sidecarBuildId` to the readiness contract and reject mismatches before exposing a ready snapshot.
- [ ] Keep `127.0.0.1` binding and an operating-system-selected port.
- [ ] Pass:

    npm.cmd test -- tests/server/desktop-auth.test.ts tests/server/listener.test.ts tests/ui/api-client.test.ts tests/ui/desktop-runtime.test.ts
    cargo test --manifest-path src-tauri/Cargo.toml

## Task 3: Make packaged configuration deterministic and recoverable

**Files:**
- Modify: `server/runtime-config.ts`
- Modify: `server/start-server.ts`
- Modify: `src-tauri/src/runtime.rs`
- Modify: `src/features/entrance/launch-machine.ts`
- Modify: `src/features/entrance/LaunchSplash.tsx`
- Modify: `tests/server/runtime-config.test.ts`
- Create: `tests/server/packaged-env.test.ts`
- Modify: `tests/ui/launch-machine.test.ts`
- Modify: `tests/ui/launch-splash.test.tsx`

- [ ] Write a failing test that starts packaged mode from a hostile current-directory `.env` and proves path, port, identity, and protocol values are ignored.
- [ ] Load working-directory `.env` only behind an explicit development-mode condition.
- [ ] Validate the packaged environment through a strict allowlisted schema and fail closed on missing or malformed parent-owned values.
- [ ] Classify missing resource, crash, stale/mismatched build, mismatched protocol, and bind failure into safe repair codes without echoing secrets or arbitrary paths.
- [ ] Render clear retry/repair guidance in the launch gate while retaining the approved Overview animation at `setSpeed(1)`.
- [ ] Pass:

    npm.cmd test -- tests/server/runtime-config.test.ts tests/server/packaged-env.test.ts tests/ui/launch-machine.test.ts tests/ui/launch-splash.test.tsx tests/ui/overview-glyph.test.tsx
    cargo test --manifest-path src-tauri/Cargo.toml

## Task 4: Add route-specific request and response boundaries

**Files:**
- Create: `server/http/request-limits.ts`
- Create: `server/http/response-limits.ts`
- Modify: `server/app.ts`
- Modify: `server/http/error-mapper.ts`
- Modify: `server/routes/readings.ts`
- Modify: `server/routes/cards.ts`
- Modify: `server/routes/vault.ts`
- Modify: `src/lib/api-client.ts`
- Create: `tests/server/request-limits.test.ts`
- Modify: `tests/server/http-errors.test.ts`
- Modify: `tests/server/file-safety.test.ts`

- [ ] Write failing tests for ordinary JSON, reading-import, file-count, file-size, response-size, timeout, aborted request, and structured `413`/`422` guidance.
- [ ] Apply a small ordinary-command JSON limit and a justified larger reading-import limit at route ownership boundaries.
- [ ] Bound file enumeration/count, imported bytes, diagnostic/download response sizes, and server work duration without weakening realpath, symlink/junction, reparse-point, and atomic-write checks.
- [ ] Add deterministic fault-injection tests around save, rename, backup, atomic swap, and rollback; preserve original bytes on failure.
- [ ] Pass:

    npm.cmd test -- tests/server/request-limits.test.ts tests/server/http-errors.test.ts tests/server/file-safety.test.ts tests/server/persistence-boundaries.test.ts tests/api/readings.test.ts tests/api/cards.test.ts tests/api/vault.test.ts

## Task 5: Narrow CSP, permissions, and diagnostics

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `server/runtime/lifecycle.ts`
- Create: `server/runtime/diagnostic-redaction.ts`
- Create: `tests/server/diagnostic-redaction.test.ts`
- Modify: `tests/server/runtime-lifecycle.test.ts`
- Modify: `tests/scripts/desktop-delivery.test.ts`

- [ ] Write failing release assertions for `localhost:*`, development origins, unsafe script sources, unnecessary capability grants, and secret-bearing diagnostics.
- [ ] Remove `http://localhost:*`; retain `script-src 'self'`; keep inline style only because React components currently use inline style properties and verify that choice.
- [ ] Keep the sole main-window capability at the minimum needed by existing Tauri IPC commands and window-state behavior.
- [ ] Export only allowlisted structured fields, bounded log tails, sanitized paths/URLs, and redaction by sensitive key names plus known per-launch values.
- [ ] Pass fake secret, token, password, URL credential, local path, and oversized-log fixtures.

## Task 6: Preserve and verify the shortest product journey

**Files:**
- Modify only where a focused regression test fails: `src/features/**`, `src/markdown/**`, `src/styles/**`
- Modify: `tests/browser/total-recovery.spec.ts`
- Modify: `tests/browser/entrance-overview.spec.ts`
- Create: `tests/browser/release-regressions.spec.ts`

- [ ] Verify first-launch automatic Local Learning Library creation/repair and use only `本地学习库` in user-facing text.
- [ ] Verify light theme, 20-second Overview animation, Reader width, readable hover states, Markdown tables, card-save success and next action, five-point flywheel, actionable connection recovery, and advanced disclosure.
- [ ] Verify the shortest workflow: first launch -> import reading -> extract/select -> save card -> inspect flywheel -> complete review evidence.
- [ ] Make only focused fixes backed by a failing test; do not redesign the accepted visual language or remove advanced capabilities.
- [ ] Pass:

    npm.cmd run test:browser:production

## Task 7: Automate reproducible release evidence

**Files:**
- Create: `scripts/generate-sbom.mjs`
- Create: `scripts/generate-license-report.mjs`
- Create: `scripts/package-release.mjs`
- Create: `scripts/measure-package.mjs`
- Create: `.github/workflows/windows-release-qualification.yml`
- Modify: `package.json`
- Modify: `scripts/package-desktop.mjs`
- Create: `tests/scripts/release-package.test.ts`
- Modify: `README.md`

- [ ] Generate `artifacts/release/aleksi-workbench/0.1.2/` with installer, SHA-256 sidecar, manifest, provenance, SPDX or CycloneDX SBOM, dependency licenses, smoke report, upgrade report, and known limitations.
- [ ] Assert executable metadata, installer metadata, runtime identity, canonical identity, SHA-256, architecture, Tauri version, schema/protocol versions, WebView2 policy, and unsigned status.
- [ ] Choose and document `online-light bootstrapper`; verify network-disabled behavior is an explicit limitation on machines missing WebView2.
- [ ] Measure installer, installed payload estimate, bundled Node, app assets, and actual shipped font formats; record developer-machine timing/memory separately from clean-machine evidence.
- [ ] Add a GitHub Actions Windows workflow for locked dependency restore, format/lint/type/Rust gates, tests, build, package, artifact checks, and evidence upload without publishing a release or requiring signing secrets.

## Task 8: Build and test the packaged application

**Files:**
- Create: `artifacts/release/aleksi-workbench/0.1.2/smoke-test-report.md`
- Create: `artifacts/release/aleksi-workbench/0.1.2/upgrade-test-report.md`
- Create: `artifacts/release/aleksi-workbench/0.1.2/known-limitations.md`

- [ ] Run:

    npm.cmd run verify
    cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
    cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
    cargo check --manifest-path src-tauri/Cargo.toml
    cargo test --manifest-path src-tauri/Cargo.toml
    npm.cmd run build:desktop
    npm.cmd run verify:desktop
    npm.cmd run package:release

- [ ] Launch the newly built unpackaged/installed executable only after hash and metadata verification; use an isolated test library and hostile launch-directory `.env`.
- [ ] Record startup, sidecar, single-instance, restart, crash recovery, abrupt termination, persistence, upgrade retention, repair/reinstall, uninstall retention, and no-external-Node behavior that can be verified on this machine.
- [ ] Do not label this developer machine as clean; record VM-only matrix rows as not executed with exact reason.

## Task 9: Final integrity audit and cleanup

**Files:**
- Modify: `artifacts/review/repository-baseline.md`
- Modify: `docs/superpowers/plans/2026-07-22-aleksi-workbench-0.1.1-release-hardening.md`

- [ ] Audit the release directory against the required tree and independently recompute every SHA-256.
- [ ] Run `git diff --check`, inspect the complete diff, and verify the pre-existing `design-qa.md` deletion remains untouched.
- [ ] Remove only task-created transient caches/processes that are not required for reproducibility; keep source, release evidence, installer, lockfiles, and user data.
- [ ] Mark only actually completed checkboxes and list every skipped or failed command with its exact error and verification boundary.
