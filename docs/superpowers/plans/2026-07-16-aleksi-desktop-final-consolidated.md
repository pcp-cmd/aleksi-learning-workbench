# Aleksi Workbench Desktop Final Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This source delivery has no `.git` metadata, so each task ends with an evidence checkpoint instead of a commit.

**Goal:** Ship the existing Aleksi Learning Workbench as an installable Windows desktop application whose Tauri 2 shell owns the window and a controlled Node/Express sidecar while preserving the verified React workflows and Markdown Local Learning Library.

**Architecture:** Keep one React application and one Express backend. Tauri starts a bundled Node runtime plus the existing esbuild server bundle with fixed arguments, receives a loopback-port readiness message, exposes that base URL through a minimal command bridge, and owns single-instance, window-state, native selection, lifecycle, and installer behavior. Markdown files remain canonical and the browser remains a development-only frontend surface.

**Tech Stack:** React 19, React Router 7, TypeScript 5.8, Express 5, Node 22, Vite 6, Vitest 3, Playwright, Tauri 2, Rust MSVC, NSIS, WebView2.

---

## File responsibility map

- `src/app/route-registry.tsx`: the only route metadata and lazy component registry.
- `src/app/routes.tsx`: renders `Route` elements from the registry; contains no second route list.
- `src/app/App.tsx`: providers, launch gate, desktop shortcuts, shell, contextual settings.
- `src/desktop/runtime.ts`: typed Tauri detection and command adapter; browser-dev fallbacks live here only.
- `src/lib/api-client.ts`: one configurable API base URL and one request/error pipeline.
- `src/features/entrance/launch-machine.ts`: pure state transitions for animation, service readiness, reduced motion, timeout, and fallback.
- `src/features/entrance/LaunchSplash.tsx`: visual splash and animation completion reporting.
- `src/components/NavigationRail.tsx`: consumes registry labels and renders rail/bottom-navigation behavior.
- `src/features/reader/ReadingForm.tsx`: reuses the existing decoder and save workflow after native file selection.
- `server/runtime-config.ts`: distinguishes normal development port parsing from desktop port `0` bootstrap.
- `server/start-server.ts`: emits the machine-readable readiness record after the real port is bound.
- `server/app.ts`: mounts the existing routers, JSON API 404, central error middleware, and SPA fallback in that order.
- `server/persistence/library-context.ts`: the single Local Learning Library relative-path conversion boundary.
- `server/persistence/markdown-value.ts`: the single Markdown value-unit serializer/parser/required parser.
- `shared/card-types.ts`: stable card predicates only.
- `src-tauri/src/runtime.rs`: fixed-argument sidecar start/readiness/health/shutdown/restart state.
- `src-tauri/src/commands.rs`: least-privilege native commands for selected reading files, library folder selection, runtime state, diagnostics, and shutdown.
- `src-tauri/src/lib.rs`: Tauri plugin order, managed state, window lifecycle, single-instance focus, and command registration.
- `src-tauri/tauri.conf.json`: one desktop window, CSP, resources, NSIS, per-user installation, WebView2 bootstrapper.
- `scripts/prepare-desktop.mjs`: builds `server.js`, copies the current Node runtime into generated Tauri resources, and writes identity metadata.
- `scripts/package-desktop.mjs`: invokes the preparation/build path and copies the actual NSIS output to `artifacts/Aleksi-Workbench-Setup.exe`.
- `scripts/verify-desktop.mjs`: rejects missing sidecar/resources/installer and checks manifest/build identity agreement.
- `docs/current/DESKTOP_IMPLEMENTATION_20260716.md`: exact implementation and verification record.

## Task 1: Re-establish the source baseline and encode product truth

**Files:**
- Create: `tests/ui/route-registry.test.tsx`
- Create: `src/app/route-registry.tsx`
- Modify: `src/app/routes.tsx`
- Modify: `src/components/NavigationRail.tsx`
- Modify: `tests/ui/app-shell.test.tsx`

- [x] **Step 1: Run the existing baseline**

Run:

```powershell
npm.cmd run verify
npm.cmd run test:browser
npm.cmd run verify:clean-base
npm.cmd run verify:runtime
```

Expected: the previously audited source baseline passes; any failure is recorded before desktop changes.

- [x] **Step 2: Write registry invariants before implementation**

The test must assert this exact primary sequence and fail for duplicate paths, duplicate primary positions, missing short labels, or an omitted Flywheel:

```ts
expect(PRIMARY_ROUTES.map(({ path, shortLabel, position }) => ({
  path,
  shortLabel,
  position
}))).toEqual([
  { path: "/today", shortLabel: "今日", position: 1 },
  { path: "/reader", shortLabel: "精读", position: 2 },
  { path: "/cards", shortLabel: "卡片", position: 3 },
  { path: "/graph", shortLabel: "飞轮", position: 4 },
  { path: "/review", shortLabel: "复习", position: 5 }
]);
```

- [x] **Step 3: Run the focused test and confirm the old arrays fail it**

Run: `npm.cmd test -- tests/ui/route-registry.test.tsx`

Expected: FAIL because `/graph` is absent from `APP_ROUTES`, Review is position 4, and short labels still live in `NavigationRail.tsx`.

- [x] **Step 4: Implement one registry**

Use a discriminated route contract:

```ts
export type RouteVisibility = "primary" | "contextual" | "advanced";

export interface AppRoute {
  readonly path: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly visibility: RouteVisibility;
  readonly position?: number;
  readonly Component: LazyExoticComponent<ComponentType>;
}

export const PRIMARY_ROUTES = APP_ROUTE_REGISTRY
  .filter((route): route is AppRoute & { position: number } =>
    route.visibility === "primary"
  )
  .sort((left, right) => left.position - right.position);
```

Diagnosis is contextual; Verification is advanced. `WorkbenchRoutes` maps the registry directly and the dead V0.1 placeholder is deleted.

- [x] **Step 5: Pass route and shell tests**

Run: `npm.cmd test -- tests/ui/route-registry.test.tsx tests/ui/app-shell.test.tsx`

Expected: PASS with all five primary modules reachable and no duplicate metadata map.

## Task 2: Add the desktop runtime bridge and dynamic API base

**Files:**
- Create: `src/desktop/runtime.ts`
- Create: `tests/ui/desktop-runtime.test.ts`
- Modify: `src/lib/api-client.ts`
- Modify: `tests/ui/api-client.test.ts`

- [x] **Step 1: Write bridge and API-base tests**

Cover browser mode, ready desktop mode, crashed mode, retry, safe native import response validation, and absolute API URL composition:

```ts
setApiBaseUrl("http://127.0.0.1:43127");
await apiClient.get("/api/health");
expect(fetch).toHaveBeenCalledWith(
  "http://127.0.0.1:43127/api/health",
  expect.objectContaining({ method: "GET" })
);
```

- [x] **Step 2: Confirm tests fail before the bridge exists**

Run: `npm.cmd test -- tests/ui/desktop-runtime.test.ts tests/ui/api-client.test.ts`

Expected: FAIL because the API base is fixed to the current origin and no desktop adapter exists.

- [x] **Step 3: Implement the least-privilege adapter**

Expose only these typed operations:

```ts
export type DesktopRuntimeSnapshot = {
  mode: "browser-development" | "starting" | "ready" | "crashed" | "stopped";
  apiBaseUrl: string | null;
  buildId: string | null;
  message: string | null;
};

export const desktopRuntime = {
  isDesktop,
  snapshot,
  restartSidecar,
  selectReadingFile,
  selectLearningLibrary,
  requestExit
};
```

Do not expose shell commands, arbitrary arguments, or arbitrary filesystem reads.

- [x] **Step 4: Implement API URL composition**

`setApiBaseUrl` accepts only `http://127.0.0.1:<port>` and `http://localhost:<port>`; request paths must start with `/api/`. Browser development keeps relative URLs.

- [x] **Step 5: Pass bridge/API tests**

Run: `npm.cmd test -- tests/ui/desktop-runtime.test.ts tests/ui/api-client.test.ts`

Expected: PASS and existing friendly connection errors remain unchanged.

## Task 3: Make the Express sidecar desktop-ready

**Files:**
- Modify: `server/runtime-config.ts`
- Modify: `server/start-server.ts`
- Modify: `server/runtime-entry.ts`
- Modify: `server/app.ts`
- Modify: `server/runtime/lifecycle.ts`
- Modify: `tests/server/runtime-config.test.ts`
- Modify: `tests/server/listener.test.ts`
- Modify: `tests/server/http-errors.test.ts`
- Modify: `tests/server/app-smoke.test.ts`

- [x] **Step 1: Add failing dynamic-port and API-404 tests**

Required contracts:

```ts
expect(parseServerPort("0")).toThrow();
expect(parseDesktopServerPort("0")).toBe(0);

const response = await request(createApp()).get("/api/not-a-route");
expect(response.status).toBe(404);
expect(response.type).toMatch(/json/u);
expect(response.body.error.code).toBe("API_ROUTE_NOT_FOUND");
```

- [x] **Step 2: Confirm focused failure**

Run: `npm.cmd test -- tests/server/runtime-config.test.ts tests/server/listener.test.ts tests/server/http-errors.test.ts tests/server/app-smoke.test.ts`

Expected: FAIL for desktop port `0`, machine-readable readiness, and JSON API 404.

- [x] **Step 3: Implement the sidecar bootstrap record**

When `ALEKSI_DESKTOP_SIDECAR=1`, listen on port `0` and print exactly one line after binding:

```ts
console.log(`ALEKSI_READY ${JSON.stringify({
  host: LOOPBACK_HOST,
  port: boundPort,
  version: runtimeLifecycle.identity.version,
  buildId: runtimeLifecycle.identity.buildId
})}`);
```

Normal browser development retains port 5174. The server always binds `127.0.0.1`.

- [x] **Step 4: Put JSON 404 before SPA fallback and central middleware last**

```ts
app.use("/api", (_request, response) => {
  response.status(404).json({
    error: { code: "API_ROUTE_NOT_FOUND", message: "未找到本地服务接口" }
  });
});
```

All async errors continue through `next(error) -> httpErrorMiddleware`.

- [x] **Step 5: Pass the server tests**

Run: `npm.cmd test -- tests/server/runtime-config.test.ts tests/server/listener.test.ts tests/server/http-errors.test.ts tests/server/app-smoke.test.ts`

Expected: PASS including loopback-only binding and build identity in readiness/health.

## Task 4: Build the Tauri 2 shell and controlled sidecar lifecycle

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/runtime.rs`
- Create: `src-tauri/src/commands.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/icons/icon.ico`
- Create: `src-tauri/icons/icon.png`
- Modify: `.gitignore`

- [x] **Step 1: Create the desktop crate and strict bundle configuration**

The configuration uses the existing Vite output, one main window, per-user NSIS, `downloadBootstrapper`, and a restrictive CSP:

```json
{
  "productName": "Aleksi Workbench",
  "version": "0.1.0",
  "identifier": "io.aleksi.workbench",
  "build": {
    "beforeDevCommand": "npm.cmd run dev:desktop:web",
    "devUrl": "http://127.0.0.1:5173",
    "beforeBuildCommand": "npm.cmd run prepare:desktop",
    "frontendDist": "../dist"
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "resources": ["resources/sidecar/*", "resources/identity.json"],
    "windows": {
      "webviewInstallMode": { "type": "downloadBootstrapper" },
      "nsis": { "installMode": "currentUser", "displayLanguageSelector": true }
    }
  }
}
```

- [x] **Step 2: Register single instance first and window-state second**

The second launch restores, shows, unminimizes, and focuses `main`; it never starts another sidecar. The main window uses a safe minimum size and restored off-monitor state is corrected by the window-state plugin.

- [x] **Step 3: Implement fixed-argument sidecar start**

Rust starts only the bundled `resources/sidecar/node.exe` with the bundled `resources/sidecar/server.js`; it sets known environment variables and does not use a shell. Read stdout until `ALEKSI_READY`, validate host/port/version/build ID, then expose the snapshot.

- [x] **Step 4: Implement bounded shutdown and crash state**

On exit, send the fixed local `/api/runtime/exit` request, wait up to two seconds, then terminate only the retained child handle. `try_wait` updates state to `crashed`; `restart_sidecar` can replace it without touching React editor memory.

- [x] **Step 5: Compile the Rust unit tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS for readiness parsing, invalid identity, invalid host/port, fixed resource path construction, and lifecycle state transitions.

## Task 5: Replace timer-only entrance with a launch state machine

**Files:**
- Create: `src/features/entrance/launch-machine.ts`
- Create: `tests/ui/launch-machine.test.ts`
- Modify: `src/features/entrance/LaunchSplash.tsx`
- Modify: `src/app/App.tsx`
- Modify: `tests/ui/launch-splash.test.tsx`

- [x] **Step 1: Write the state-machine table as tests**

States are `idle`, `loading-animation`, `playing`, `service-ready`, `complete`, and `fallback`. Completion requires minimum visible duration, animation completion (or reduced-motion equivalent), and ready service. A bounded maximum reaches a retryable fallback instead of hanging.

- [x] **Step 2: Confirm the old 960 ms timer fails the readiness cases**

Run: `npm.cmd test -- tests/ui/launch-machine.test.ts tests/ui/launch-splash.test.tsx`

Expected: FAIL when the sidecar is delayed or crashed.

- [x] **Step 3: Implement pure transitions and desktop bootstrap**

Use explicit events:

```ts
type LaunchEvent =
  | { type: "ANIMATION_LOADED" }
  | { type: "ANIMATION_COMPLETED" }
  | { type: "SERVICE_READY" }
  | { type: "SERVICE_FAILED"; message: string }
  | { type: "MINIMUM_ELAPSED" }
  | { type: "MAXIMUM_ELAPSED" }
  | { type: "RETRY" };
```

The desktop path always shows one splash per process launch. Browser development preserves the nonce contract.

- [x] **Step 4: Make the motion asset cacheable**

The Vite asset is local/content-hashed for production. Do not request it with `cache: "no-store"`. Reduced motion renders the static flywheel mark for the short minimum duration.

- [x] **Step 5: Pass all entrance tests**

Run: `npm.cmd test -- tests/ui/launch-machine.test.ts tests/ui/launch-splash.test.tsx`

Expected: PASS for ready, delayed, failed, timeout, retry, second nonce, and reduced motion.

## Task 6: Add native desktop interactions without broad filesystem access

**Files:**
- Modify: `src/features/reader/ReadingForm.tsx`
- Modify: `src/features/reader/reading-import.ts`
- Modify: `src/features/settings/SettingsDialog.tsx`
- Modify: `src/lib/unsaved-guard.ts`
- Modify: `src/app/App.tsx`
- Modify: `src-tauri/src/commands.rs`
- Create: `tests/ui/desktop-interactions.test.tsx`
- Modify: `tests/ui/reading-import.test.ts`
- Modify: `tests/ui/today-settings.test.tsx`

- [x] **Step 1: Write failing native-boundary tests**

Desktop import calls one command that both opens the native dialog and returns validated UTF-8 text; browser development retains file input/drag-drop. Folder selection returns only the chosen directory. No command accepts arbitrary executable names or arguments.

- [x] **Step 2: Implement selected-file import**

Rust filters `.md`, `.markdown`, `.txt`, rejects NUL/invalid UTF-8/empty/oversized inputs, and returns:

```rust
struct SelectedReading {
    body: String,
    file_name: String,
    size: u64,
}
```

React sends the returned text through the existing title/concept/conflict/save workflow; no second persistence path is created.

- [x] **Step 3: Implement settings and shortcuts**

`Ctrl+O` imports, `Ctrl+,` opens settings, `Ctrl+Q` requests guarded exit, and `Ctrl+S` dispatches the existing card save action when available. Native selection is used for the Local Learning Library; existing server validation remains authoritative.

- [x] **Step 4: Guard desktop window close**

The close request consults `hasUnsavedChanges`; cancellation prevents close, confirmation invokes `requestExit`. Current editor state remains in React during sidecar restart.

- [x] **Step 5: Pass interaction tests**

Run: `npm.cmd test -- tests/ui/desktop-interactions.test.tsx tests/ui/reading-import.test.ts tests/ui/today-settings.test.tsx tests/ui/card-diagnosis.test.tsx`

Expected: PASS for native and browser-development paths, Chinese UTF-8, unsaved guard, and card save workflow.

## Task 7: Refine the five-module shell and responsive behavior

**Files:**
- Modify: `src/components/NavigationRail.tsx`
- Create: `src/components/FlywheelBrandMark.tsx`
- Modify: `src/styles/workbench.css`
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/base.css`
- Modify: `src/features/reader/reader.css`
- Modify: `src/features/cards/cards.css`
- Modify: `src/features/graph/flywheel.css`
- Modify: `src/main.tsx`
- Modify: `src/app/App.tsx`
- Create: `tests/ui/css-governance.test.ts`
- Modify: `tests/ui/overview-glyph.test.tsx`
- Modify: `tests/ui/review-graph.test.tsx`

- [x] **Step 1: Encode CSS safeguards before edits**

The test inventories active CSS and rejects `!important`, unsupported media widths, a final override sheet, private distribution font names, and missing five-item narrow navigation.

- [x] **Step 2: Replace the large A and preserve brand return-to-Today**

Use a simplified five-node loop mark derived from the current flywheel/launch geometry. Keep the Aleksi wordmark restrained and accessible.

- [x] **Step 3: Consolidate responsive thresholds**

Use only `1024px`, `768px`, and `560px` for width breakpoints. At narrow widths, the single rail becomes a bottom bar with Today, Reader, Cards, Flywheel, Review all visible; settings moves to the compact utility action.

- [x] **Step 4: Remove eager Markdown/math CSS from launch**

Move KaTeX CSS and `MarkdownTheme.css` into the lazy Markdown renderer boundary. Production uses the tested Windows system stack; private Anthropic font files remain development-only and excluded from delivery.

- [x] **Step 5: Pass UI/CSS tests and build**

Run:

```powershell
npm.cmd test -- tests/ui/css-governance.test.ts tests/ui/app-shell.test.tsx tests/ui/overview-glyph.test.tsx tests/ui/review-graph.test.tsx
npm.cmd run build
```

Expected: PASS, zero `!important`, no unsupported breakpoint, and separate lazy Markdown/math chunks.

## Task 8: Consolidate durable server primitives without format migration

**Files:**
- Modify: `server/persistence/library-context.ts`
- Modify: `server/lib/path-safety.ts`
- Modify: `server/persistence/markdown-value.ts`
- Modify: `server/services/graph-service.ts`
- Modify: `server/services/review-service.ts`
- Modify: `shared/card-types.ts`
- Modify: `shared/vault-map.ts`
- Modify: `server/services/vault-service.ts`
- Modify: `tests/server/persistence-boundaries.test.ts`
- Modify: `tests/server/markdown-codec.test.ts`
- Modify: `tests/server/file-safety.test.ts`
- Modify: `tests/shared/card-vault-map.test.ts`

- [x] **Step 1: Write parity tests around every existing implementation**

Cover normalized separators, escape rejection, Chinese/emoji/math/empty Markdown values, malformed byte counts, truncation, v1 reading, v2 round-trip, legacy review directory reads, and clean-library directory creation.

- [x] **Step 2: Centralize library-relative conversion**

One persistence-boundary function reuses path-safety primitives and deletes only behaviorally identical duplicates. Preserve separate `pathExists`, `fileExists`, `directoryExists`, and safe-real-path checks.

- [x] **Step 3: Centralize value-unit parsing**

Export exactly:

```ts
serializeMarkdownValueUnit(value: string): string
extractMarkdownValueUnit(markdown: string): MarkdownValueUnit | null
requireMarkdownValueUnit(markdown: string): MarkdownValueUnit
```

Graph and Review consume this implementation.

- [x] **Step 4: Apply library compatibility rules**

New libraries no longer create `09-飞轮图谱` because state is `.aleksi/graph-state.json`. New review writes use `08-复习记录`; reads search it first and then `08-飞轮复习`. Existing directories are never deleted or moved.

- [x] **Step 5: Pass durable-data tests**

Run: `npm.cmd test -- tests/server/persistence-boundaries.test.ts tests/server/markdown-codec.test.ts tests/server/file-safety.test.ts tests/shared/card-vault-map.test.ts tests/server/review-service.test.ts tests/server/graph-service.test.ts`

Expected: PASS with unchanged card format and atomic/path safety guarantees.

## Task 9: Prepare and package the self-contained desktop runtime

**Files:**
- Create: `scripts/prepare-desktop.mjs`
- Create: `scripts/package-desktop.mjs`
- Create: `scripts/verify-desktop.mjs`
- Create: `scripts/desktop-package-rules.mjs`
- Modify: `package.json`
- Modify: `scripts/package-rules.mjs`
- Modify: `scripts/health-source.mjs`
- Modify: `tests/scripts/delivery-scripts.test.ts`
- Create: `tests/scripts/desktop-delivery.test.ts`

- [x] **Step 1: Write packaging contract tests**

Require generated resources to contain `node.exe`, bundled `server.js`, and identity JSON, while source packages exclude the generated Node binary and Tauri `target/`. Reject an installer missing the sidecar or identity agreement.

- [x] **Step 2: Implement deterministic preparation**

`prepare-desktop.mjs` runs the existing frontend/server build, copies `process.execPath` to `src-tauri/resources/sidecar/node.exe`, copies the bundled `server.js`, and writes content hashes plus version/build ID. Generated resources are cleaned before each run.

- [x] **Step 3: Add explicit scripts**

```json
{
  "desktop:dev": "npm run prepare:desktop && tauri dev",
  "prepare:desktop": "node scripts/prepare-desktop.mjs",
  "build:desktop": "npm run prepare:desktop && tauri build --bundles nsis",
  "package:desktop": "node scripts/package-desktop.mjs",
  "verify:desktop": "node scripts/verify-desktop.mjs"
}
```

- [x] **Step 4: Build the NSIS installer**

Run: `npm.cmd run package:desktop`

Expected: the real Tauri NSIS artifact is copied to `artifacts/Aleksi-Workbench-Setup.exe`; no placeholder executable is accepted.

- [x] **Step 5: Verify the packaged artifact**

Run: `npm.cmd run verify:desktop`

Expected: PASS for installer existence, sidecar resource hashes, version/build identity, NSIS target, WebView2 bootstrapper strategy, current-user install mode, and absence of browser/PowerShell/Stop launch dependencies.

## Task 10: Run the complete acceptance chain and deliver evidence

**Files:**
- Create: `docs/current/DESKTOP_IMPLEMENTATION_20260716.md`
- Create: `artifacts/desktop-verification-20260716.json`
- Modify: `README.md`
- Modify: `docs/current/PROJECT_MAP.md`
- Modify: `docs/current/PACKAGING_ROADMAP.md`
- Modify: `SOURCE_PACKAGE_MANIFEST.json` through the official package script only

- [x] **Step 1: Run source verification**

Run:

```powershell
npm.cmd run verify
npm.cmd run test:browser
npm.cmd run verify:clean-base
```

Expected: all existing and new TypeScript/UI/API/server/browser tests pass from a clean extracted source package.

- [x] **Step 2: Run desktop verification**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
npm.cmd run package:desktop
npm.cmd run verify:desktop
```

Expected: Rust tests pass and the actual NSIS installer is verified.

- [x] **Step 3: Perform installed runtime checks**

Install to a per-user Chinese-path test account/location, launch without Node/PowerShell/browser, verify one sidecar and dynamic loopback port, run Today → Reader → Cards/Diagnosis → Flywheel → Review → Verification, launch a second instance, exercise guarded exit, uninstall, and confirm the Local Learning Library remains.

- [x] **Step 4: Record exact evidence and limitations**

The implementation record lists changed files, architecture decisions, sidecar start/health/shutdown behavior, data compatibility, exact commands/results, installer path/size/hash, runtime screenshots, and any unverified clean-machine or signing limitation. Static/build success is never reported as installed-runtime proof.

- [x] **Step 5: Generate final source and delivery manifests**

Run the official source packaging and audit commands, then generate SHA-256 hashes for the source ZIP, installer, implementation record, verification JSON, and screenshot evidence.

Expected final artifact names:

```text
AleksiWorkbench-Desktop-Source-20260716.zip
Aleksi-Workbench-Setup.exe
AleksiWorkbench-Desktop-Implementation-20260716.md
AleksiWorkbench-Desktop-Verification-20260716.json
AleksiWorkbench-Desktop-SHA256-20260716.txt
```

## Self-review

- Spec coverage: every section in the consolidated desktop plan maps to Tasks 1–10; installer, WebView2, sidecar lifecycle, native interactions, five primary routes, CSS/assets, durable storage, and real runtime proof each have a separate checkpoint.
- Placeholder scan: the implementation plan contains no `TBD`, deferred implementation, or unqualified “add tests” step.
- Type consistency: the desktop snapshot, launch events, selected reading payload, API base, route registry, readiness record, and final artifact names are defined once and reused consistently.
- Scope control: no second frontend, database, Electron, cloud feature, auto-migration, arbitrary shell/filesystem command, or new durable card format is introduced.
