# Aleksi Learning Workbench Desktop 0.1.1 Release Audit

> Retired from `docs/current`; retained here as historical evidence only.

> 历史审计记录：本文只记录 0.1.1 时点，不是当前发布入口。0.1.2 canonical path、bundled Node、Visual Studio 非用户依赖及 WebView2 `online-light` 边界以 `docs/current/RELEASE_0.1.2.md` 为准。

## Current score

**70 / 100 — local release candidate, not yet a Windows release pass.**

The score cannot exceed 79 until Rust and Windows installer gates run on a Windows runner. A deliverable EXE requires at least 95/100, zero known critical/high-risk defects, and two consecutive Windows audit rounds without a new critical/high-risk finding.

## Release rule

This release is blocked until:

1. Every confirmed critical/high-risk issue has a recorded fix and regression test.
2. The packaged Windows sidecar starts twice from a path containing spaces and Chinese characters.
3. The NSIS installer is installed silently on a clean Windows runner and the installed application remains healthy through the 20-second startup ritual.
4. The installed application passes a second-launch and data-persistence test.
5. Two consecutive independent Windows audit rounds find no new critical or high-risk issue.

## Scoring rule

- A later round finding an issue missed by an earlier round deducts both issue severity points and a missed-detection penalty.
- Passing a previously blocked hard gate may restore confidence points, but does not erase the issue history.
- A green build without installed-runtime verification is not considered a release pass.
- Test-runner or tool-output failures are kept separate from product defects, but must still be made deterministic before release.

## Audit ledger

| Round | Starting score | New findings | Deduction / recovery | Ending score | Status |
|---|---:|---|---:|---:|---|
| 1 — failure reconstruction | 100 | CI never started the packaged sidecar. CommonJS bundle was named `server.js` inside an ESM package, causing `require is not defined`. Startup deadline and diagnostics log names were inconsistent. | −38 | 62 | Fixed in source; regression verification added. |
| 2 — lifecycle race review | 62 | A stale monitor thread from an older sidecar generation could overwrite the state of a newly started sidecar as crashed. | −10 missed-detection penalty | 52 | Generation guard implemented; Rust test added. |
| 3 — package identity review | 52 | Runtime package `buildId` calculation and audit expectation diverged. | −6 | 46 | Fixed; targeted package tests passed. |
| 4 — API persistence review | 46 | One failed-write test depended on Unix permission behavior and falsely passed under a privileged runner. | −2 test-quality penalty | 44 | Replaced with platform-stable path-targeted failure mock. |
| 5 — frontend startup/UI review | 44 | No new product defect in startup state machine, retry route, 20-second animation gate, settings simplification, or card empty state. | +20 verified coverage | 64 | UI groups passed. |
| 6 — deployment identity review | 64 | Reusing version `0.1.0` would make the fixed installer indistinguishable from the broken one. | −12, then +12 after fix | 64 | npm, Cargo and Tauri versions are `0.1.1`. |
| 7 — release-chain review | 64 | Version expectations were duplicated in tests; default Vitest multi-file execution could fail to return deterministically; the UI still referenced excluded font files. | −18 including missed-detection penalties | 46 | Version tests now read the unique package version; release tests run one file per bounded process; UI font URLs removed. |
| 8 — deterministic local re-verification | 46 | No new critical/high-risk product defect. | +20 | 66 | Server/scripts/docs 230, API 92 and UI 117 assertions passed in deterministic isolation; typecheck and production build passed. |
| 9 — packaged sidecar and font delivery | 66 | No new critical/high-risk product defect. | +10 | 76 | Sidecar started twice with matching 0.1.1 identity, dynamic loopback ports, Chinese/space paths, writable library, data write, diagnostics and graceful exit. Font delivery gate passed; only KaTeX math fonts are packaged. |
| 10 — shell-close lifecycle review | 76 | Installed verification proved API-requested Sidecar exit but did not prove that closing the desktop window reaps the Sidecar process. | −6 missed-detection penalty | **70** | Verification source now tests API exit on launch one and normal main-window close on launch two. Windows evidence pending. |

## Confirmed defects and fixes

### D-001 — Fatal sidecar module-format mismatch

- Severity: Critical
- Symptom: Desktop shell repeatedly displayed “retry local service”.
- Root cause: esbuild emitted CommonJS, but the resource was named `server.js` under a `type: module` package context.
- Fix: Runtime output and all desktop references changed to `server.cjs`.
- Regression gate: `scripts/verify-packaged-sidecar.mjs` starts the packaged resource twice.

### D-002 — Startup deadline shorter than intended startup ritual

- Severity: High
- Fix: Startup deadline is at least 30 seconds and at least animation duration + 10 seconds.
- Product decision: The 20-second startup animation remains unchanged.

### D-003 — Diagnostics omitted the files actually written by Tauri

- Severity: High
- Fix: Diagnostics recognizes `sidecar.stdout.log`, `sidecar.stderr.log`, legacy server names and `latest.log`.

### D-004 — Stale sidecar generation could poison a restart

- Severity: High
- Fix: Runtime generation number invalidates stale stdout/exit reports during shutdown/restart.
- Regression gate: Rust unit test rejects stale generation crash reports.

### D-005 — Build identity verification drift

- Severity: Medium
- Fix: Runtime manifest, desktop identity and audit use the same `server.cjs` identity inputs and the package version as the unique version source.

### D-006 — Cross-platform rollback test was not deterministic

- Severity: Test infrastructure
- Fix: Failed-write simulation targets the reading directory path rather than Unix permission semantics.

### D-007 — Fixed build reused broken build version

- Severity: High deployment risk
- Fix: Release version advanced to `0.1.1` across npm, Cargo and Tauri metadata.

### D-008 — Excluded UI fonts were still referenced by CSS

- Severity: Medium visual/build hygiene risk
- Fix: Removed file-backed `@font-face` rules while preserving the exact semantic font stacks. Windows now uses installed Anthropic/Noto/Source Han families when available and stable system fallbacks otherwise.
- Regression gate: `scripts/verify-font-delivery.mjs` rejects UI font URLs, private font references and every non-KaTeX packaged font binary.

### D-009 — Release tests were not process-isolated

- Severity: Test infrastructure
- Symptom: Assertions passed but a multi-file Vitest process could fail to return deterministically.
- Fix: `scripts/run-release-tests.mjs` runs every test file in a bounded independent process and reports exact per-file failure/timeout.

### D-010 — Installed verification did not test normal window-close cleanup

- Severity: High lifecycle verification gap
- Risk: The desktop shell could close while leaving the local Node Sidecar orphaned.
- Fix in source: The first installed launch verifies API-requested exit; the second launch closes the actual main window and requires both shell exit and Sidecar disappearance.
- Status: Static regression test passed; Windows execution remains a hard gate.

## Verified local gates

- [x] Version is consistently `0.1.1` in npm, Cargo, Cargo lock and Tauri metadata.
- [x] TypeScript typecheck.
- [x] Server/shared/scripts/docs: 230 passed; one Windows-only path alias case remains platform-skipped locally.
- [x] API: 92 passed.
- [x] UI: 117 passed.
- [x] Production Vite build: 2,198 modules transformed.
- [x] No private UI font URL or binary in production output.
- [x] KaTeX math fonts remain packaged.
- [x] Packaged `server.cjs` identity/hash validation.
- [x] Two real sidecar launches with different dynamic loopback ports.
- [x] Chinese and space-containing paths.
- [x] Writable local learning library and Chinese reading persistence.
- [x] Diagnostics includes actual sidecar stdout/stderr logs.
- [x] Graceful sidecar exit.

## Windows hard gates still open

- [ ] `cargo fmt --check` on the checked-in source.
- [ ] `cargo test --locked` on Windows.
- [ ] Windows `npm run verify:packaged-sidecar` using the bundled Windows Node runtime.
- [ ] Windows `npm run build:desktop`.
- [ ] Silent NSIS installation of 0.1.1.
- [ ] Installed resource hashes equal `identity.json`.
- [ ] Installed app first launch reaches matching ready/health identity.
- [ ] App remains alive and API healthy after the 20-second startup ritual.
- [ ] Installed learning library is writable and accepts a Chinese reading.
- [ ] Normal main-window close exits the shell and leaves no orphan Sidecar.
- [ ] Installed app second launch reaches healthy state and retains data.
- [ ] Upgrade path from the broken 0.1.0 install is checked.
- [ ] Two consecutive Windows rounds find no new critical/high-risk issue.

## Font behavior

The installer does not embed private UI fonts. The existing visual stacks and geometry are unchanged:

- UI: Anthropic Sans → Noto Sans SC → Source Han Sans SC → Segoe UI → Microsoft YaHei → system sans.
- Reading/title: Anthropic Serif → Noto Serif SC → Source Han Serif SC → Songti/SimSun → Times/Georgia.
- Code: Anthropic Mono → Cascadia Mono → Consolas → system monospace.

A Windows computer with matching installed fonts uses them automatically. Other computers retain the existing system-fallback appearance. KaTeX fonts remain bundled solely for mathematical formulas.
