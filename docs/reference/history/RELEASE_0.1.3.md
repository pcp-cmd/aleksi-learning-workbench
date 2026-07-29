# Aleksi Learning Workbench 0.1.3

> Retired from `docs/current`; retained here as historical evidence only.

Title: **Aleksi Learning Workbench 0.1.3 Correctness & Desktop Lifecycle Maintenance Release**

Date: 2026-07-26

## Scope

This is a focused maintenance release. It does not redesign the accepted light visual system, Overview motion, Card Workbench, Theme Flywheel, local-first Markdown architecture, or security boundaries.

## Correctness changes

- Native window X, Ctrl+Q, and Settings Exit share one application-close policy.
- Clean close exits immediately; dirty close asks once; cancel remains open; confirm shuts down the sidecar and application.
- Tauri desktop no longer registers a competing browser `beforeunload` guard.
- Restored Reading, Card Studio, Diagnosis, and Review drafts are recoverable baselines. Only edits after restoration are destructive dirty state.
- Learning-library changes are transactions: dirty check, server mutation, deterministic draft identity switch, query-cache removal, route-state remount, and safe navigation to Today.
- Old-library drafts are retained. A switch never calls the former all-drafts deletion path.
- Overview motion remains at source speed and the accepted 20-second interval; service readiness no longer waits on a duplicate animation-complete callback.

## Windows qualification

The official candidate installer must be built by `.github/workflows/windows-release-qualification.yml` on `windows-2022`.

A manual qualification run requires a canonical 0.1.2 installer URL. The workflow verifies its pinned SHA-256, installs 0.1.2, builds 0.1.3 once, upgrades, launches the installed application, sends a real native window close, proves application and sidecar exit, relaunches, captures lifecycle evidence, and uninstalls the runner payload.

The normal-window verifier no longer falls back to Ctrl+Q. A build whose real X cannot close now fails.

The npm release gate fails on every unexpected high or critical advisory. It
permits only `GHSA-qwww-vcr4-c8h2` against the reviewed
`react-router`/`react-router-dom` 7.18.1 pair, and only after scanning the
runtime source for React Server Components modules and APIs. This application
uses browser SPA routing and does not use the experimental RSC surface affected
by that advisory. Version drift, RSC usage, malformed audit output, audit
transport failure, or any additional high/critical finding fails the gate. The
workflow records the decision in
`artifacts/qualification/npm-audit-evidence.json`.

## Release identity

- Version: `0.1.3`
- Installer: `Aleksi-Workbench-0.1.3-Setup.exe`
- Canonical directory: `artifacts/release/aleksi-workbench/0.1.3`
- Canonical installer path: `artifacts/release/aleksi-workbench/0.1.3/Aleksi-Workbench-0.1.3-Setup.exe`
- Upgrade source: `0.1.2`
- Signing: `unsigned-preview`
- WebView2: `online-light`
- Runtime: bundled Node.js sidecar; users do not install Node or Visual Studio

No GitHub Release, tag, upload, or signing operation is implied by this document.

## 离线安装边界

Bundled Node 已包含在安装器中。WebView2 仍采用 `online-light` / `downloadBootstrapper`：机器已有兼容 Runtime 时可直接使用；机器缺失 Runtime 时需要联网。0.1.3 不宣称完全离线安装。

## Verification boundary

Local source inspection and dependency-free identity checks can run without restoring the deleted local build toolchain. Full TypeScript, Vitest, Playwright, Rust, packaging, installed lifecycle, and artifact-hash evidence must come from the GitHub qualification run or another explicitly provisioned clean environment.
