# Aleksi Archival 1.0 Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in the listed order. Steps use checkbox (`- [ ]`) syntax for tracking. Do not build or qualify the installer on the user's personal computer; desktop packaging and lifecycle evidence belong to GitHub Actions on a clean Windows runner.

**Goal:** Turn the authoritative Aleksi Learning Workbench 0.1.4 source package into an evidence-gated `0.1.5-rc.x` archival candidate, and permit `1.0.0` only after every hard release gate is proven.

**Architecture:** Preserve the local-first Markdown library and accepted light interface. Introduce an immutable request-level library operation context, handler-owned leases, observable transaction and projection health, mirrored application settings, verified restore-to-new-location flows, an event-driven dual-path launch state machine, and an index-backed full card library. Keep rebuildable projections subordinate to authoritative Markdown and move Windows packaging, signing, installation, upgrade, restore, and soak qualification into dedicated GitHub Actions workflows.

**Tech Stack:** React 19, TypeScript 5.8, Express 5, Zod 3, TanStack Query, Vitest, Playwright, Tauri 2/Rust, PowerShell, GitHub Actions.

---

## File map

- `server/persistence/library-context.ts`: immutable `LibraryOperationContext`.
- `server/persistence/library-lease.ts`: shared/exclusive lease lifecycle, timeout, abort, and generation.
- `server/http/library-request.ts`: handler-owned `withLibraryOperation`.
- `server/transactions/*`: duplicate-target preflight, orphan scavenging, health inspection, recovery actions, and audit records.
- `server/config/app-settings.ts`: checksummed primary/mirror/history locator.
- `server/projections/*`: durable projection health and centralized quarantine.
- `server/services/vault-transfer-schema.ts`: strict transfer manifest schemas.
- `server/services/vault-backup-service.ts`: interrupted-backup discovery, verification, and restore-to-new-location.
- `server/services/card-library-service.ts`: bounded index-backed card queries.
- `server/routes/health.ts`, `server/routes/cards.ts`, `server/routes/vault.ts`: narrow HTTP contracts.
- `src/features/entrance/*`: event-driven startup state and “直接进入”.
- `src/features/settings/LibraryHealthSection.tsx`: recovery and backup health.
- `src/features/cards/CardLibrary.tsx`: full card library while preserving Card Studio.
- `src/lib/library-mutation-coordinator.ts`: visible bounded switch coordination.
- `docs/current/*`: executable verification matrix and generated current contract.
- `.github/workflows/*.yml`: source CI, Windows qualification, scheduled health, and protected-tag stable release.

## Task 1: Freeze the authoritative baseline and release identity

**Files:**
- Replace: `SOURCE_PACKAGE_MANIFEST.json`
- Delete: `design-qa.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `release/identity.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`
- Create: `docs/current/ARCHIVAL_VERIFICATION_MATRIX.md`
- Create: `docs/current/ARCHIVAL_BASELINE.json`

- [x] **Step 1: Record the authoritative input**

Write `ARCHIVAL_BASELINE.json` with the exact source SHA-256, 398 entries, 8,487,246 unpacked bytes, source commit `15d2ec51fc0bbcef56b187d0a8ab84c745c3f7b6`, branch name, canonical pre-release version, and a declaration that local installer qualification is forbidden.

- [x] **Step 2: Align the branch to the source ZIP**

Use the package-generated manifest and remove the tracked file absent from the authoritative package. Verify every other packaged file matches the branch after normalizing CRLF.

- [x] **Step 3: Set the canonical version**

Set npm, Cargo, Cargo.lock, Tauri, and release identity to `0.1.5-rc.1`. Keep `upgradeFromVersion` at `0.1.4`; do not invent predecessor hashes. Until a durable 0.1.4 release asset is pinned, mark predecessor evidence as blocked in the verification matrix.

- [x] **Step 4: Materialize the verification matrix**

Copy S01–S10, T01–T16, L01–L12, A01–A08, P01–P10, B01–B12, D01–D14, C01–C10, and R01–R16 into a machine-readable Markdown table with columns `ID`, `Requirement`, `Automated evidence`, `Windows evidence`, `Status`, and `Artifact`.

- [x] **Step 5: Verify the baseline**

Run:

```powershell
npm.cmd run typecheck
npm.cmd test -- --run tests/scripts/release-identity.test.ts tests/docs/governance-docs.test.ts
```

Expected: the version and documentation contracts pass without building a desktop installer.

## Task 2: Create immutable handler-owned library operations

**Files:**
- Modify: `server/persistence/library-context.ts`
- Modify: `server/persistence/library-lease.ts`
- Replace: `server/http/library-request.ts`
- Modify: all `server/routes/*.ts` active-library handlers
- Modify: active-library service entry points under `server/services/`
- Create: `tests/server/library-operation-context.test.ts`
- Modify: `tests/server/library-lease.test.ts`
- Modify: `tests/api/library-context.test.ts`

- [x] **Step 1: Add failing L01/L03/L04/L07/L11 tests**

Tests must prove that disconnect aborts cancellable work, lease release occurs only after the handler promise settles, a non-cancellable commit retains the lease, exclusive acquisition times out with `LIBRARY_BUSY`, and locator changes cannot alter a captured Vault ID.

- [x] **Step 2: Define the context**

```ts
export type LibraryOperationContext = Readonly<{
  path: string;
  vaultId: string;
  generation: number;
  signal: AbortSignal;
  assertCurrent(): void;
}>;
```

- [x] **Step 3: Replace response-owned release**

```ts
export async function withLibraryOperation<T>(
  request: Request,
  response: Response,
  operation: (context: LibraryOperationContext) => Promise<T>
): Promise<T>;
```

The middleware aborts on disconnect. `withLibraryOperation` acquires once, sets identity headers, awaits the handler operation, and releases in `finally`. No `finish` or `close` callback releases the lease.

- [x] **Step 4: Add bounded exclusive acquisition**

`runExclusive` and `runExclusiveWithContext` accept `{ signal, timeoutMs, incrementGeneration }`. Timeout throws a structured `LibraryBusyError` with code `LIBRARY_BUSY`, HTTP 409, and a retry-safe message.

- [x] **Step 5: Migrate routes and services**

Every active-library service accepts `LibraryOperationContext` as its first argument. Transactions use `context.vaultId` and `context.assertCurrent`; scans checkpoint `context.signal`. Add an architecture test rejecting active-library entry points whose first parameter is `vaultPath: string`.

- [x] **Step 6: Verify**

```powershell
npm.cmd test -- --run tests/server/library-operation-context.test.ts tests/server/library-lease.test.ts tests/api/library-context.test.ts
npm.cmd run typecheck
```

## Task 3: Close transaction safety and recovery

**Files:**
- Modify: `server/transactions/transaction-types.ts`
- Modify: `server/transactions/transaction-journal.ts`
- Modify: `server/transactions/transaction-runner.ts`
- Modify: `server/transactions/transaction-recovery.ts`
- Create: `server/transactions/transaction-health.ts`
- Create: `server/transactions/transaction-quarantine.ts`
- Create: `server/routes/health.ts`
- Modify: `server/app.ts`
- Modify: `server/http/error-mapper.ts`
- Modify: `tests/server/transaction-recovery.test.ts`
- Create: `tests/api/library-health.test.ts`

- [x] **Step 1: Add failing T01/T11/T13–T16 tests**

Cover payload-before-journal orphan discovery, duplicate normalized targets before any directory creation, unreadable primary and mirror visibility, accept-current, preview-plus-CAS apply-intended, and relative-only export.

- [x] **Step 2: Preflight normalized targets**

Normalize all targets before creating a transaction ID or payload directory. Reject duplicate normalized paths with `DUPLICATE_TRANSACTION_TARGET`.

- [x] **Step 3: Scavenge uncertain artifacts**

Move orphan payload directories, stale `.tmp`/`.bak`, and journals without payloads to `.aleksi/quarantine/transactions/<timestamp-id>/` with a bounded manifest. Never directly delete unexplained data.

- [x] **Step 4: Expose sanitized health**

```ts
type TransactionHealthRecord = Readonly<{
  transactionId: string;
  operation: string;
  state: "quarantined" | "unreadable" | "orphaned";
  createdAt: string | null;
  updatedAt: string;
  targets: ReadonlyArray<{
    relativePath: string;
    oldSha256: string | null;
    currentSha256: string | null;
    newSha256: string | null;
    oldPayloadIntact: boolean;
    newPayloadIntact: boolean;
  }>;
  diagnostics: readonly string[];
  allowedActions: readonly TransactionRecoveryAction[];
}>;
```

The API returns transaction IDs and relative paths only. `TransactionQuarantinedError` includes its real transaction ID in the structured error body.

- [x] **Step 5: Implement idempotent actions**

Support `retry_recovery`, `accept_current_external_version`, `apply_intended_version`, `export_recovery_bundle`, and `remove_unreadable_journal`. `apply_intended_version` requires preview token plus fresh hashes. Removal first moves all evidence into quarantine.

- [x] **Step 6: Verify**

```powershell
npm.cmd test -- --run tests/server/transaction-recovery.test.ts tests/api/library-health.test.ts
npm.cmd run typecheck
```

## Task 4: Mirror and repair the app-level locator

**Files:**
- Replace: `server/config/app-settings.ts`
- Create: `server/config/app-settings-schema.ts`
- Create: `tests/server/app-settings-recovery.test.ts`
- Modify: `tests/api/vault.test.ts`

- [x] **Step 1: Add failing A01–A08 tests**

Use fault boundaries around both copy replacements. Test primary-only, mirror-only, divergent revisions, both corrupt, unavailable history path, path-policy rejection, and bounded diagnostics/history.

- [x] **Step 2: Define checksummed locator copies**

```ts
type AppSettings = Readonly<{
  schemaVersion: 2;
  revision: number;
  activeVaultPath: string;
  updatedAt: string;
  checksum: string;
}>;
```

The checksum covers every field except itself in canonical key order.

- [x] **Step 3: Read, choose, and repair**

Validate `settings.json` and `settings.mirror.json`; choose the highest valid revision and repair the missing/stale copy. Append a bounded, checksummed history record after both copies are durable. If neither copy is valid, return a recovery-required result containing sanitized recent candidates; never choose or create another learning library silently.

- [x] **Step 4: Verify**

```powershell
npm.cmd test -- --run tests/server/app-settings-recovery.test.ts tests/api/vault.test.ts
npm.cmd run typecheck
```

## Task 5: Make projection, evidence, and user-file I/O observable and bounded

**Files:**
- Modify: `server/projections/projection-types.ts`
- Modify: `server/projections/projection-runner.ts`
- Modify: `server/projections/projection-file.ts`
- Create: `server/projections/projection-health.ts`
- Create: `server/lib/quarantine.ts`
- Modify: `server/services/review-service.ts`
- Modify: `server/services/verification-candidate.ts`
- Modify: `server/services/verification-store.ts`
- Modify: `server/services/vault-service.ts`
- Create: `server/services/vault-transfer-schema.ts`
- Create: `tests/server/architecture-boundaries.test.ts`
- Modify: projection, verification, review, and I/O tests

- [ ] **Step 1: Add failing P01–P10 and B06 tests**

Prove Markdown survives projection failure, fallback health survives failed health-file writes, corrupt records move outside active directories, malformed filenames are diagnosed, semantic limits are enforced, and all scans respect deadline/byte/file/concurrency/abort budgets.

- [ ] **Step 2: Persist projection health with memory fallback**

Record first/last failure, attempts, sanitized category, status, and last successful rebuild. Clear only after a successful rebuild.

- [ ] **Step 3: Centralize quarantine**

Use `.aleksi/quarantine/{transactions,projections,verification,app-settings-diagnostics}`. Exclude it from normal indexes and limits. Inventory and export are bounded; cleanup requires explicit confirmation.

- [ ] **Step 4: Strictly parse transfer manifests**

Zod schemas reject unknown keys, duplicate normalized paths, invalid UUID/hash/size/count/phase combinations, and unsafe privileged paths.

- [ ] **Step 5: Add static architecture gates**

Reject direct `readFile` imports in user-data services unless allowlisted; raw active-library path entry points; UI→server and service→route imports; Express/Tauri imports in domain/codec; and projection code that deletes authoritative Markdown.

- [ ] **Step 6: Verify**

```powershell
npm.cmd test -- --run tests/server/architecture-boundaries.test.ts tests/server/index-service.test.ts tests/server/projection-file.test.ts tests/api/verification.test.ts
npm.cmd run typecheck
```

## Task 6: Complete backup discovery, verification, and restore

**Files:**
- Split from: `server/services/vault-service.ts`
- Create: `server/services/vault-backup-service.ts`
- Create: `server/services/vault-migration-service.ts`
- Create: `server/routes/backup.ts`
- Modify: `server/routes/vault.ts`
- Modify: `src/lib/api-client.ts`
- Modify: `src/features/settings/SettingsDialog.tsx`
- Create: `src/features/settings/BackupRecoverySection.tsx`
- Create: `tests/api/backup-restore.test.ts`
- Create: `tests/scripts/backup-restore-drill.test.ts`

- [ ] **Step 1: Add failing B01–B12 tests**

Cover interrupted copy, verified-but-not-renamed finalization, invalid partial exclusion, cleanup-health reporting, restore-to-new-location, canonical-content comparison, second termination resume, and confirmed retention cleanup.

- [ ] **Step 2: Discover interrupted backups**

Classify sibling `.partial-*` entries as `incomplete`, `verified-needs-finalize`, `invalid`, or `orphaned` using strict schemas and bounded hashing.

- [ ] **Step 3: Verify and restore**

Verification checks every relative path, count, size, and SHA-256. Restore always targets a new empty destination, verifies after copy, then switches under a bounded exclusive lease.

- [ ] **Step 4: Add the automated drill**

Generated non-personal fixture data must survive backup → restore → launch → Chinese reading → card creation → review. The drill emits a machine-readable report.

- [ ] **Step 5: Verify**

```powershell
npm.cmd test -- --run tests/api/backup-restore.test.ts tests/scripts/backup-restore-drill.test.ts
npm.cmd run typecheck
```

## Task 7: Replace the startup state machine with the mandatory dual path

**Files:**
- Replace: `src/features/entrance/launch-machine.ts`
- Modify: `src/features/entrance/LaunchSplash.tsx`
- Modify: `src/features/entrance/OverviewGlyph.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/workbench.css`
- Modify: `tests/ui/launch-machine.test.ts`
- Modify: `tests/ui/launch-splash.test.tsx`
- Modify: `tests/ui/overview-glyph.test.tsx`
- Modify: `tests/browser/entrance-overview.spec.ts`

- [ ] **Step 1: Add failing S01–S10 tests**

Tests cover real Lottie completion, direct entry before/after readiness, animation-before-service wait, missing asset, service failure/retry/safe exit, reduced motion, keyboard activation, and once-per-process behavior.

- [ ] **Step 2: Define explicit state**

```ts
type LaunchState = Readonly<{
  animation: "loading" | "playing" | "complete" | "unavailable" | "reduced";
  service: "starting" | "ready" | "failed";
  directEntryRequested: boolean;
  failure: string | null;
}>;
```

Entry is allowed only when service is ready and direct entry was requested or animation is complete/unavailable/reduced.

- [ ] **Step 3: Preserve source motion**

Keep `/motion/overview.json`, `loop: false`, `setSpeed(1)`, and the real `complete` event. Remove the fixed 20-second navigation timer. Missing motion and reduced motion mark the animation gate available without faking service readiness.

- [ ] **Step 4: Add “直接进入” and truthful progress**

The keyboard-accessible button remains visible during startup. Before readiness it changes the status to “正在准备本地服务…”. Use an honest indeterminate progress element without fake `aria-valuenow`. Failure retains diagnostics, retry, and safe exit.

- [ ] **Step 5: Verify**

```powershell
npm.cmd test -- --run tests/ui/launch-machine.test.ts tests/ui/launch-splash.test.tsx tests/ui/overview-glyph.test.tsx
npm.cmd run test:browser:production -- tests/browser/entrance-overview.spec.ts
```

Do not run Tauri packaging locally.

## Task 8: Bound learning-library switching and expose recovery

**Files:**
- Replace: `src/lib/library-mutation-coordinator.ts`
- Modify: `src/features/settings/SettingsDialog.tsx`
- Modify: all mutation call sites
- Modify: `tests/ui/library-switch-race.test.ts`
- Create: `tests/ui/library-switch-recovery.test.tsx`

- [ ] **Step 1: Add failing L02/L05/L06 tests**

Track mutation ID, label, start time, abort controller, and cancellable/commit state. Test delayed visibility, cancel switch, cancel safe mutation and retry, and no cancellation inside non-cancellable commit.

- [ ] **Step 2: Implement bounded coordination**

`runLibraryMutation` receives `{ label, signal, cancellable }`; `runLibrarySwitch` receives an abort signal and delay threshold. Expose active operation metadata through `useLibraryMutationState`.

- [ ] **Step 3: Add settings recovery UI**

Display the delaying operation after the threshold, with “取消切换” and conditionally “取消卡住的保存并重试”.

- [ ] **Step 4: Verify**

```powershell
npm.cmd test -- --run tests/ui/library-switch-race.test.ts tests/ui/library-switch-recovery.test.tsx
npm.cmd run typecheck
```

## Task 9: Add the full Card Library

**Files:**
- Create: `server/services/card-library-service.ts`
- Modify: `server/routes/cards.ts`
- Modify: `src/app/query-keys.ts`
- Create: `src/features/cards/CardLibrary.tsx`
- Modify: `src/features/cards/CardStudioPage.tsx`
- Modify: `src/features/cards/cards.css`
- Create: `tests/api/card-library.test.ts`
- Create: `tests/ui/card-library.test.tsx`
- Create: `tests/performance/card-library-10000.test.ts`

- [ ] **Step 1: Add failing C01–C10 tests**

Cover deterministic cursor pagination, bounded title/concept query, combined type/mastery/due filters, all required sorts, degraded index recovery, non-recent deep links, CAS archive/update, keyboard/screen reader behavior, no absolute paths, and Card Studio/Flywheel continuity.

- [ ] **Step 2: Add the bounded query contract**

```ts
type CardLibraryQuery = Readonly<{
  cursor?: string;
  limit: number;
  query?: string;
  type?: string;
  mastery?: string;
  due?: "overdue" | "today" | "future" | "none";
  sort: "updated" | "created" | "title" | "due";
  order: "asc" | "desc";
}>;
```

Read the existing index once per request. Do not recursively rescan on every keystroke.

- [ ] **Step 3: Add “全部卡片” without replacing Card Studio**

Provide loading, empty, degraded-index, recovery, list, filters, pagination, deep-link open/edit/archive states. Preserve the accepted editor and Theme Flywheel.

- [ ] **Step 4: Verify**

```powershell
npm.cmd test -- --run tests/api/card-library.test.ts tests/ui/card-library.test.tsx tests/performance/card-library-10000.test.ts
npm.cmd run typecheck
```

## Task 10: Close desktop force-exit and destroyed-window diagnostics

**Files:**
- Modify: `src/desktop/runtime.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/application-close.ts`
- Modify: `src-tauri/src/runtime.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: lifecycle tests

- [ ] **Step 1: Add failing D06–D11 tests**

Prove stop failure preserves the handle, retry cannot create a duplicate sidecar, force exit has an explicit result/non-return contract, parent death kills the process tree, stale generation events are ignored, and diagnostics redact secrets and sensitive absolute paths.

- [ ] **Step 2: Handle force-exit failure explicitly**

If the native command can return, await it and show failure. No floating promise or unhandled rejection is permitted.

- [ ] **Step 3: Persist sanitized destroyed-window failure**

Write bounded diagnostics without protocol secret or private paths and surface the state in health.

- [ ] **Step 4: Verify source-level behavior**

```powershell
npm.cmd test -- --run tests/ui/application-close.test.ts tests/server/runtime-lifecycle.test.ts tests/server/diagnostic-redaction.test.ts
npm.cmd run typecheck
```

Rust and installed lifecycle remain GitHub Actions evidence.

## Task 11: Add health UI, generated current contract, lint, and architecture gates

**Files:**
- Create: `src/features/settings/LibraryHealthSection.tsx`
- Modify: `src/features/settings/SettingsDialog.tsx`
- Modify: `src/app/App.tsx`
- Create: `scripts/generate-current-contract.mjs`
- Create: `docs/current/CURRENT_CONTRACT.md`
- Modify: `package.json`
- Modify: `tests/docs/governance-docs.test.ts`
- Modify: `tests/server/architecture-boundaries.test.ts`
- Add ESLint configuration and focused complexity budget

- [ ] **Step 1: Add the non-dismissable blocked-write warning**

Settings explains transaction, projection, locator, and backup health in ordinary Chinese. Global warning remains until health no longer blocks writes.

- [ ] **Step 2: Generate the single current contract**

Generate version, identity, startup semantics, routes, signing state, and WebView2 policy from machine-readable sources. Reject stale canonical versions in `docs/current` except explicitly historical tables.

- [ ] **Step 3: Add conservative lint and architecture gates**

Enable floating-promise, hooks, ignored-promise, empty-catch, type-only import, layer-boundary, context, and bounded-I/O checks. Set complexity budgets at the current characterized baseline and lower them only after behavior-preserving splits.

- [ ] **Step 4: Split characterized large modules**

Split `vault-service.ts`, `index-service.ts`, `runtime.rs`, `ReviewPage.tsx`, `VerificationPage.tsx`, `ReaderPage.tsx`, `SettingsDialog.tsx`, and `api-client.ts` by domain responsibility. Remove superseded code only after focused tests pass.

- [ ] **Step 5: Verify**

```powershell
npm.cmd run lint
npm.cmd run architecture
npm.cmd run typecheck
npm.cmd test -- --run tests/docs/governance-docs.test.ts tests/server/architecture-boundaries.test.ts
```

## Task 12: Separate CI, qualification, scheduled health, and stable release

**Files:**
- Replace: `.github/workflows/windows-release-qualification.yml`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/windows-qualification.yml`
- Create: `.github/workflows/scheduled-health.yml`
- Create: `.github/workflows/stable-release.yml`
- Create: `release/release-manifest.schema.json`
- Create: release evidence scripts and tests

- [ ] **Step 1: Add workflow contract tests**

Require pinned action SHAs, least permissions, no fork-secret exposure, artifact retention, source checks, clean Windows qualification, signing gate, durable release publication, SBOM, licenses, checksums, provenance, restore report, installed lifecycle reports, and soak report.

- [ ] **Step 2: Create source CI**

PR/main runs typecheck, Vitest, production Playwright, lint, architecture, package audit, npm audit, dependency review, secret scan, and code scan.

- [ ] **Step 3: Create Windows qualification**

On a clean Windows runner, run Rust fmt/check/clippy/tests, prepare desktop resources, build NSIS, install, launch, close, upgrade from a durable pinned 0.1.4 release asset, uninstall/reinstall, restore drill, process residual checks, and reconcile all evidence.

- [ ] **Step 4: Create scheduled health**

Weekly dependency/secret scan; monthly clean Windows install/launch/close and synthetic restore drill; quarterly predecessor upgrade. Open an issue only on failure and never upload real user data.

- [ ] **Step 5: Create protected-tag stable release**

Only protected `v1.0.0` tags with environment approval may sign and publish immutable GitHub Release assets. Verify Authenticode signature and timestamp on installer and installed executable. If signing secrets are absent, fail the stable job and keep the build an unsigned RC.

- [ ] **Step 6: Address WebView2 first-install policy**

Use the supported Evergreen offline bootstrap/install mode with a pinned Microsoft payload hash and a clean offline image test. If repository/runner limits prevent this, retain `online-light`, record the limitation, and cap the score below the archival target.

- [ ] **Step 7: Verify workflow syntax and source package**

```powershell
npm.cmd test -- --run tests/scripts/desktop-delivery.test.ts tests/scripts/release-package.test.ts tests/scripts/tauri-security-contract.test.ts
npm.cmd run package:desktop-source
npm.cmd run audit:desktop-source
```

Do not run `npm run build:desktop` locally.

## Task 13: Publish evidence-gated RC, then stable only when externally unblocked

**Files:**
- Update: `docs/current/ARCHIVAL_VERIFICATION_MATRIX.md`
- Create: `release/evidence/KNOWN_LIMITATIONS.md`
- Create: `release/evidence/P0_P1_CLOSURE.md`
- Create: `release/evidence/CHANGED_FILES.md`
- Create: `release/evidence/SOAK_REPORT.json`

- [ ] **Step 1: Run the complete source suite**

```powershell
npm.cmd run typecheck
npm.cmd test -- --run
npm.cmd run build
npm.cmd run test:browser:production
npm.cmd run lint
npm.cmd run architecture
```

- [ ] **Step 2: Push the RC branch and run GitHub Actions**

Push `codex/1.0.0-archival-baseline`; wait for source CI and Windows qualification. Record exact run URLs and artifact hashes.

- [ ] **Step 3: Run the soak**

Run at least 24 hours for a stable candidate; 72 hours is preferred. Emit periodic save/switch/review/backup operations plus memory, handle, and process telemetry. An interrupted soak is not a pass.

- [ ] **Step 4: Keep the honest release boundary**

Without a user-provided Authenticode certificate and GitHub environment secrets, publish only `0.1.5-rc.x` and label it unsigned. Do not create `1.0.0`, a protected stable tag, or an archival/verified claim until R01–R16 and every P0/P1 row are green.

- [ ] **Step 5: Final handoff**

Return commit SHA, protected tag if legitimately created, grouped changed files, P0/P1 closure, CI and Windows URLs, signed artifact evidence, manifest/checksums, SBOM/licenses/provenance, lifecycle/restore/soak reports, and every remaining limitation or unexecuted command.
