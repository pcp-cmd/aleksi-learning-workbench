# Aleksi Workbench Desktop Total Recovery — Delivery Record

Date: 2026-07-17  
Branch: `feature/desktop-total-recovery-20260717`  
Delivery status: complete; installer, source package, evidence package, installed-runtime proof, and temporary toolchain cleanup verified

## Delivered product boundary

The formal user-facing product is the Windows per-user NSIS installer. Browser/Vite mode remains a development and verification surface only. The implementation keeps one React frontend, the existing Node/Express local sidecar, the existing Markdown learning-library contract, and a thin Tauri 2 shell.

The five primary learning routes remain:

1. Today
2. Reader
3. Card Studio
4. Topic Flywheel
5. Review

Diagnosis remains contextual. Evidence Verification, relationships, GPT-assisted editable JSON import, verdict history, and revocation impact remain available through progressive disclosure. Settings separates ordinary library controls from advanced path and migration diagnostics.

## Recovery source of truth

- Accepted browser baseline: `baselines/accepted-browser-total-refinement-20260716`
- Locked baseline evidence: `baselines/accepted-browser-total-refinement-20260716/BASELINE_LOCK.md`
- Regression inventory: `baselines/accepted-browser-total-refinement-20260716/REGRESSION_INVENTORY.md`
- Selected flywheel reference: `docs/reference/aleksi-workbench-selected-flywheel-reference.png`
- Visual comparison record: `docs/current/TOTAL_RECOVERY_VISUAL_COMPARISON_20260717.md`
- Production browser evidence: `artifacts/total-recovery-browser-evidence-20260717`

The locked production evidence contains 32 records and 32 screenshots. The required 27-route matrix covers Entrance, Today, Reader, Cards, Flywheel, Review, Diagnosis, Verification, and Settings at 1440×960, 1280×800, and 960×680. Additional records cover Flywheel at 1024×768 and special loading/failure/advanced states. The evidence audit recorded no horizontal overflow and one consistent computed font stack.

## Implemented recovery work

- Restored the accepted warm-paper visual language and compact editorial hierarchy without creating a second design system.
- Made production and development load the same font policy; private fonts stay outside the public/source package.
- Kept one semantic style system and extended CSS governance tests for undefined tokens, duplicate ownership, forbidden aliases, and unapproved `!important`.
- Restored the five-route learning loop while keeping Diagnosis contextual and Verification advanced.
- Preserved the flywheel's five dimensions: concept, example, boundary, process, and mistake.
- Added local draft persistence for cards, diagnosis, review responses, excerpt basket, selected reading, and useful route context.
- Added a shared unsaved-change guard for primary navigation, internal navigation, settings, and desktop close handling.
- Added mutation-to-query invalidation so Today, Cards, Flywheel, Review, and related projections refresh after authoritative writes.
- Added application and high-complexity page error boundaries with Chinese recovery actions instead of blank-screen failure.
- Added safe library path fallback and retained the authoritative Markdown schema and compatibility behavior.
- Added Tauri single-instance, window-state, validated dynamic loopback identity, sidecar cleanup, and safe desktop runtime adapters.

## Native build and installer

- Tauri: 2.x project configuration
- Rust: 1.97.1, `x86_64-pc-windows-msvc`
- MSVC Build Tools: Visual Studio 2022 Build Tools 17.14.36, MSVC 19.44.35228
- Windows SDK used for the build: 10.0.26100
- Install mode: current user
- WebView2 mode: `downloadBootstrapper`
- Installed version: 0.1.0
- Runtime build identity: `desktop-29a1a1e905813a01cf48`
- Installer: `artifacts/Aleksi-Workbench-Setup.exe`
- Installer size: 25,257,346 bytes
- Installer SHA-256: `DC59EEE8DA8C1C8F02D13351BBFBC89CC8D558CB7EC8C206383C8B6E61AE6D12`
- Authenticode status: unsigned

The Rust toolchain, Visual Studio Build Tools, Windows SDK, Visual Studio Installer, and task-created build caches were temporary build dependencies. They were removed after the final package and installed-runtime gates. VS Code, the pre-existing WebView2 Runtime, the installed Aleksi application, `node_modules` for future source development, and all user learning data were preserved.

## Installed-runtime evidence

The installer hash was checked immediately before installation. A real installed window was then inspected through Windows application accessibility and screenshot state.

Verified installed state:

- Executable: `C:\Users\pcp\Aleksi Workbench\aleksi-workbench.exe`
- Main process: one `aleksi-workbench.exe`
- Local sidecar: `C:\Users\pcp\Aleksi Workbench\resources\sidecar\node.exe`
- Sidecar binding observed: `127.0.0.1:63800`
- Health response: `ok=true`, service `aleksi-workbench`, version `0.1.0`, build ID `desktop-29a1a1e905813a01cf48`
- Second launch produced one application window, confirming the single-instance path.
- Today, Reader, Card Studio, Topic Flywheel, Review, Settings, and collapsed/expanded advanced Settings were opened and visually inspected in the installed Tauri window.
- The learning library resolved to `C:\Users\pcp\Documents\Aleksi Learning Workbench` and advanced Settings reported it writable with no read-only reason.
- The installed window did not show a browser or terminal dependency.

The installed app was then closed normally, silently uninstalled, and checked after uninstall:

- Install directory removed.
- Current-user uninstall registration removed.
- Documents learning library remained present with 12 files.
- Documents learning library matched the pre-install safety copy by relative path and SHA-256: 0 differences.
- Local and roaming application-data directories remained present.

The same final installer was then hash-checked and reinstalled successfully. The final installed application remains on the machine.

After Rust, Visual Studio Build Tools, Visual Studio Installer, Windows SDK, and native build caches were removed, the installed application was launched again. Its executable and bundled sidecar both ran from `C:\Users\pcp\Aleksi Workbench`; the sidecar bound only to `127.0.0.1:54534` and returned the same healthy runtime identity. This proves the shipped installation does not depend on the removed compiler toolchain.

## Verification commands

The final gate completed fresh runs of:

```text
npm run verify:all
npm run test:browser:production
npm run package:source
npm run package:audit
npm run verify:clean-base
npm run audit:runtime
npm run verify:runtime
npm run verify:desktop:source
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
npm run verify:desktop
```

Results:

- `verify:all`: passed; 49 test files, 433 passed tests, and one documented Windows symlink-permission skip; typecheck, production build, health checks, and four default browser checks passed.
- `test:browser:production`: passed with 32 production evidence records and 32 screenshots.
- `package:source`, `package:audit`, and `verify:clean-base`: passed, including source-package idempotence.
- `audit:runtime` and `verify:runtime`: passed before the non-formal runtime preview was removed as a temporary verification artifact.
- `verify:desktop:source`, `cargo fmt --check`, four Rust tests, and `verify:desktop`: passed.
- Installed, uninstalled, data-preservation checked, reinstalled, and launched again after toolchain cleanup: passed.

The machine-readable final result is written to `artifacts/AleksiWorkbench-Desktop-Total-Recovery-Verification-20260717.json`. Package hashes are written to `artifacts/Aleksi-Workbench-Desktop-Total-Recovery-Manifest-20260717.json`.

## Known limitations

- The installer is unsigned. Windows SmartScreen may warn; no trusted-publisher claim is made.
- `downloadBootstrapper` is intentionally retained. This is a smaller online installer and may need internet access when WebView2 is absent. The current machine already had WebView2 150.0.4078.65, which is preserved.
- Installation and installed-runtime verification were performed on this Windows current-user environment, not a separate clean Windows account or virtual machine.
- Windows 10, ARM64, enterprise policy, antivirus-product matrices, Store/MSIX distribution, multi-version upgrade matrices, and the WebView2-missing download branch were not separately verified.
- Actual installed-window inspection was performed on this machine; the full 1440/1280/960 route matrix is production-browser evidence from the same frontend. These evidence layers are reported separately.
- Reader truthfully supports `.md`, `.markdown`, and `.txt`; PDF and DOCX import are not claimed.
- Card Studio exposes recent cards and card detail; it is not described as a complete searchable card library.
- Private local font assets are not included in the clean source package.

## Cleanup boundary

Preserve:

- `artifacts/Aleksi-Workbench-Setup.exe`
- `artifacts/aleksi-learning-workbench-source.zip`
- final manifests and verification records
- baseline lock, regression inventory, visual comparison record, and browser evidence
- installed Aleksi Workbench
- `C:\Users\pcp\Documents\Aleksi Learning Workbench`
- VS Code and existing WebView2 Runtime

Removed after final verification:

- task-installed Rust/rustup
- task-installed Visual Studio Build Tools and Windows SDK
- task-created Cargo/Rustup caches
- `src-tauri/target`
- generated `src-tauri/resources`
- temporary runtime build and install safety-copy directories after preservation is proven

Also removed: task-created Visual Studio installer logs and the non-formal runtime preview ZIP/directory. The formal installer, source ZIP, machine-readable verification/manifest records, visual evidence, and installed application are retained.

Cleanup must not be used to erase final evidence or user data.
