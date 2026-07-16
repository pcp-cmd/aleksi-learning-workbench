# Aleksi Workbench total-recovery baseline record (2026-07-17)

## Recovery checkout

- Path: `C:\Users\pcp\Documents\Codex\2026-07-14\qi\work\aleksi-learning-workbench-total-recovery-20260717`
- Branch: `feature/desktop-total-recovery-20260717`
- Imported authoritative desktop commit: `b16e8e9`
- The older June Git checkout, locked browser baseline, current installer, and original source snapshot were not modified.

## Dependency restore

Command:

```powershell
npm.cmd ci
```

Result: 426 packages installed, 427 packages audited, 0 known vulnerabilities. The first sandboxed attempt failed with Windows `spawn EPERM` while npm tried to start an install script; the same project-local install completed outside the process sandbox. This was an execution-environment restriction, not a source defect.

## Source verification before recovery changes

Command:

```powershell
npm.cmd run verify
```

Result: PASS.

- TypeScript project build: PASS.
- Vitest: 43 test files passed; 406 tests passed; 1 Windows file-symlink case skipped because the OS denied symlink creation with `EPERM`.
- Vite production build: PASS; 2,186 modules transformed.
- Production output retains separate lazy Markdown renderer and Markdown/math chunks.

The sandboxed run reached TypeScript success and then failed when Vitest/Vite attempted to spawn the project-local esbuild binary. The same command passed outside the process sandbox; no source workaround was applied.

## Browser verification and portability repair

Initial command:

```powershell
npm.cmd run test:browser
```

Initial result: 3 passed, 1 failed. Entrance, reduced-motion/missing-asset recovery, and backend-unavailable recovery passed. The complete epsilon-N learning loop reached the final visual QA step and then failed because the test read this package-external temporary path:

```text
artifacts/total-refinement-incoming/current-flywheel-real-screenshot.png
```

Root cause: the browser test depended on an artifact intentionally excluded from a clean authoritative source package. The checked-in selected reference already exists at:

```text
docs/reference/aleksi-workbench-selected-flywheel-reference.png
```

Repair: `tests/browser/epsilon-n-flow.spec.ts` now reads the checked-in selected reference.

Fresh result after the repair: PASS, 4/4 Playwright tests in 20.1 seconds.

## Desktop build prerequisite state

The following were intentionally removed before this recovery work and are currently absent:

- Rust `cargo` and `rustc`
- Visual Studio Build Tools / MSVC
- Windows SDK used by the Tauri NSIS build
- generated `src-tauri/target`
- generated `src-tauri/resources`

VS Code, Node.js, WebView2 Runtime, the installed Aleksi EXE, current installer, and source packages remain. A new installer build requires explicit permission before reinstalling the removed desktop compiler toolchain.
