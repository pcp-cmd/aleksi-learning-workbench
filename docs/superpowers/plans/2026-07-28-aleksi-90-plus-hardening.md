# Aleksi 90+ Reliability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all eight mandatory reliability gates and prove T01-T22 against the current 0.1.3 baseline without adding product features.

**Architecture:** Resolve one immutable `LibraryContext` at each API boundary and hold a generation-aware shared lease for the whole request, while vault switching and migration take an exclusive lease. Route every authoritative Markdown mutation through a crash-recoverable journal with version checks; treat index, graph, and verification caches as rebuildable projections. Bound all filesystem traversal, model desktop shutdown as a truthful state machine, and make draft persistence failures observable.

**Tech Stack:** Node.js 22, TypeScript, Express 5, React 19, TanStack Query 5, Vitest, Playwright, Rust, Tauri 2, GitHub Actions, Windows NSIS.

---

## Current evidence baseline

- Baseline commit: `96fa5d6`.
- Working branch: `codex/0.1.4-90-plus-hardening`.
- User-owned pre-existing change: `design-qa.md` is deleted and must not be staged or restored.
- Fresh local baseline: 63 Vitest files passed; 557 tests passed and 1 skipped on 2026-07-28.
- The external review's claim that dynamic tests could not run is stale, but its source findings below remain independently reproducible.

| Gate | Current evidence | Baseline status |
|---|---|---|
| 1 | `review-service.ts` writes pending/card/committed separately and suppresses rollback failures; `atomic-write.ts` cannot recover after process death | open |
| 2 | services call `activeLearningLibrary()` multiple times inside one request; there is no generation or shared/exclusive vault lease | open |
| 3 | writes still roll back authoritative Markdown when projection rebuild fails; `10-Codex任务/验证证据` is not excluded from global traversal | open |
| 4 | editable assets do not expose or require a disk version and rollback can replace a newer external edit | open |
| 5 | Review, Verification, Graph, and vault copy paths use unbounded `Promise.all` or repeated scans | open |
| 6 | Rust `terminate_and_wait()` returns `()` and shutdown removes the child before proving exit | open |
| 7 | `approvedNavigation` is a module-global one-shot bit; draft writes can throw; draft vault identity uses 32-bit FNV-1a | open |
| 8 | migration copies directly to the final destination; corrupt app settings abort auto-prepare; release workflow lacks a complete attestation gate | open/partially evidenced |

## File ownership map

- `server/persistence/library-context.ts`: immutable context resolution and identity.
- `server/persistence/library-lease.ts`: generation-aware shared/exclusive lease manager.
- `server/http/library-request.ts`: Express request context and lease middleware.
- `server/transactions/*`: journal schema, durable writes, runner, recovery, and deterministic fault injection.
- `server/lib/asset-version.ts`: SHA-256/size/mtime/inode version capture and CAS.
- `server/lib/io-budget.ts`, `bounded-map.ts`, `bounded-read.ts`, `traversal-budget.ts`: common resource budgets.
- `server/projections/*`: projection status, queue, quarantine, and rebuilding.
- `server/services/*`: domain operations using explicit context, transaction, CAS, projection, and bounded I/O contracts.
- `src/app/library-identity.tsx`: client vault identity and mutation/switch coordination.
- `src/app/query-keys.ts`: vault-scoped query keys.
- `src/lib/api-client.ts`: `AbortSignal`, context generation, and typed conflict errors.
- `src/lib/unsaved-guard.ts`, `draft-store.ts`, `active-library-drafts.ts`: scoped navigation permission and typed draft persistence.
- `src-tauri/src/runtime.rs`: truthful process state and Windows Job Object ownership.
- `.github/workflows/*`, `scripts/*`: pinned release gates, reports, hashes, SBOM, provenance, and lifecycle evidence.

### Task 1: Add deterministic failure infrastructure

**Files:**
- Create: `server/testing/fault-controller.ts`
- Create: `server/testing/test-clock.ts`
- Create: `tests/server/fault-controller.test.ts`

- [ ] **Step 1: Write a failing deterministic fault test**

```ts
it("blocks at a named boundary until the test releases it", async () => {
  const controller = new FaultController();
  const reached = controller.waitUntilReached("card:before-commit");
  const operation = controller.boundary("card:before-commit");
  await reached;
  expect(controller.snapshot()).toContain("card:before-commit");
  controller.release("card:before-commit");
  await expect(operation).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm.cmd test -- tests/server/fault-controller.test.ts`
Expected: FAIL because `FaultController` does not exist.

- [ ] **Step 3: Implement named throw, delay, external-edit callback, and termination simulation boundaries**

The controller API must be:

```ts
export type FaultAction =
  | { kind: "throw"; error: Error }
  | { kind: "block" }
  | { kind: "callback"; run: () => Promise<void> };

export class FaultController {
  install(name: string, action: FaultAction): void;
  boundary(name: string): Promise<void>;
  waitUntilReached(name: string): Promise<void>;
  release(name: string): void;
  snapshot(): string[];
}
```

- [ ] **Step 4: Run the focused test**

Run: `npm.cmd test -- tests/server/fault-controller.test.ts`
Expected: PASS with no unhandled rejections.

### Task 2: Introduce immutable LibraryContext and generation leases

**Files:**
- Modify: `server/persistence/library-context.ts`
- Create: `server/persistence/library-lease.ts`
- Create: `server/http/library-request.ts`
- Modify: `server/app.ts`
- Modify: `server/routes/cards.ts`
- Modify: `server/routes/readings.ts`
- Modify: `server/routes/diagnoses.ts`
- Modify: `server/routes/codex.ts`
- Modify: `server/routes/review.ts`
- Modify: `server/routes/graph.ts`
- Modify: `server/routes/index-rebuild.ts`
- Modify: `server/routes/today.ts`
- Modify: `server/routes/verification.ts`
- Modify: `server/routes/vault.ts`
- Modify: `server/services/*.ts`
- Test: `tests/server/library-lease.test.ts`
- Test: `tests/api/library-context.test.ts`

- [ ] **Step 1: Write failing lease and cross-vault race tests**

The tests must pause card creation after its source reading is resolved, request a vault switch, then prove either a complete original-vault commit or `409 ACTIVE_LIBRARY_CHANGED`. They must also prove an old slow GET cannot acquire a new-generation identity.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm.cmd test -- tests/server/library-lease.test.ts tests/api/library-context.test.ts`
Expected: FAIL because generation and leases do not exist.

- [ ] **Step 3: Implement the explicit contracts**

```ts
export type LibraryContext = Readonly<{
  path: string;
  vaultId: string;
  generation: number;
}>;

export type LibraryLease = {
  context: LibraryContext;
  assertCurrent(): void;
  release(): void;
};

export interface LibraryLeaseManager {
  acquireShared(signal?: AbortSignal): Promise<LibraryLease>;
  runExclusive<T>(operation: (generation: number) => Promise<T>): Promise<T>;
  currentIdentity(): Promise<LibraryContext>;
}
```

Every library-backed route resolves and passes `context` exactly once. Domain helpers accept `LibraryContext` or an explicit `vaultPath`; helper bodies must contain no `activeLearningLibrary()` call.

- [ ] **Step 4: Make vault selection exclusive and increment generation only after settings commit**

On failure, settings and generation stay unchanged. Existing shared leases finish before the switch commits; new shared acquisitions wait.

- [ ] **Step 5: Run context tests and scan for violations**

Run: `npm.cmd test -- tests/server/library-lease.test.ts tests/api/library-context.test.ts`
Expected: PASS.

Run: `rg -n "activeLearningLibrary\\(" server/services`
Expected: no matches.

### Task 3: Scope client requests, queries, and mutations to vault identity

**Files:**
- Create: `src/app/library-identity.tsx`
- Modify: `src/app/query-keys.ts`
- Modify: `src/app/query-invalidation.ts`
- Modify: `src/lib/api-client.ts`
- Modify: all `useQuery` call sites under `src/features`
- Modify: `src/features/settings/SettingsDialog.tsx`
- Test: `tests/ui/library-switch-race.test.tsx`

- [ ] **Step 1: Write failing UI race tests**

Cover T06 and T07: resolve a vault-B request before a delayed vault-A request, then assert no vault-A data renders; attempt switching during a mutation and assert the switch waits or rejects with visible state.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm.cmd test -- tests/ui/library-switch-race.test.tsx`
Expected: FAIL because query keys have no identity and query functions ignore `context.signal`.

- [ ] **Step 3: Add identity-bearing query keys and signals**

```ts
export type ClientLibraryIdentity = Readonly<{
  vaultId: string;
  generation: number;
}>;

queryKey: [...queryKeys.cards.recent, identity.vaultId, identity.generation],
queryFn: ({ signal }) =>
  apiClient.get("/api/cards/recent?limit=10", { signal })
```

All library-backed GETs must use the query function `AbortSignal`. All mutations register with a coordinator; switching blocks new mutations, awaits or cancels active work, commits the server switch, updates identity, then removes old cache.

- [ ] **Step 4: Run the focused UI tests**

Run: `npm.cmd test -- tests/ui/library-switch-race.test.tsx`
Expected: PASS.

### Task 4: Implement the durable transaction journal and recovery

**Files:**
- Create: `server/transactions/transaction-types.ts`
- Create: `server/transactions/transaction-journal.ts`
- Create: `server/transactions/transaction-runner.ts`
- Create: `server/transactions/transaction-recovery.ts`
- Create: `server/transactions/transaction-fault-injection.ts`
- Modify: `server/lib/atomic-write.ts`
- Modify: `server/runtime/start-server.ts`
- Test: `tests/server/transaction-recovery.test.ts`

- [ ] **Step 1: Write failing prepared/applying/committed/quarantine recovery tests**

Use real temporary vault files. Simulate termination after journal persistence and after the first rename. Re-run recovery twice and assert identical disk state.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm.cmd test -- tests/server/transaction-recovery.test.ts`
Expected: FAIL because no journal exists.

- [ ] **Step 3: Implement the journal schema**

```ts
export type TransactionState =
  | "prepared"
  | "applying"
  | "committed"
  | "rolling-back"
  | "quarantined";

export type TransactionTarget = {
  path: string;
  oldSha256: string | null;
  newSha256: string;
  temporaryPath: string;
  backupPath: string | null;
};

export type TransactionJournal = {
  transactionId: string;
  vaultId: string;
  operation: string;
  state: TransactionState;
  targets: TransactionTarget[];
  createdAt: string;
  updatedAt: string;
};
```

Journal writes go to `.aleksi/transactions/<transactionId>.json` using a durable temporary write and atomic rename. Recovery compares current/old/new hashes and quarantines ambiguous files without overwriting them.

- [ ] **Step 4: Run recovery before startup, vault switch completion, and first write**

The recovery runner must be idempotent and serialized per vault.

- [ ] **Step 5: Run focused recovery tests**

Run: `npm.cmd test -- tests/server/transaction-recovery.test.ts`
Expected: PASS including repeat recovery and missing backup diagnostics.

### Task 5: Add AssetVersion CAS and migrate authoritative writes

**Files:**
- Create: `server/lib/asset-version.ts`
- Modify: `server/domain/schemas.ts`
- Modify: `server/http/error-mapper.ts`
- Modify: `server/services/card-service.ts`
- Modify: `server/services/reading-service.ts`
- Modify: `server/services/diagnosis-service.ts`
- Modify: `server/services/review-service.ts`
- Modify: `server/services/codex-task-service.ts`
- Modify: corresponding routes, client types, and editors
- Test: `tests/server/asset-version.test.ts`
- Test: `tests/api/asset-conflicts.test.ts`

- [ ] **Step 1: Write failing external-edit and rollback-conflict tests**

Read an asset and capture its version, externally replace it, then submit the stale version. Assert `409 ASSET_VERSION_CONFLICT`, external bytes unchanged, and no projection rebuild based on stale data.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm.cmd test -- tests/server/asset-version.test.ts tests/api/asset-conflicts.test.ts`
Expected: FAIL because responses and writes have no `AssetVersion`.

- [ ] **Step 3: Implement the version contract**

```ts
export type AssetVersion = {
  sha256: string;
  size: number;
  mtimeNs: string;
  inode: string;
};
```

Editable reads return `version`; update/archive/delete/review writes require `expectedVersion`. The transaction runner verifies the version immediately before applying. Rollback only replaces a file whose hash equals that transaction's new hash; otherwise it quarantines.

- [ ] **Step 4: Run focused CAS tests**

Run: `npm.cmd test -- tests/server/asset-version.test.ts tests/api/asset-conflicts.test.ts`
Expected: PASS with explicit 409 mappings.

### Task 6: Decouple authoritative Markdown from projections

**Files:**
- Create: `server/projections/projection-types.ts`
- Create: `server/projections/projection-runner.ts`
- Create: `server/projections/projection-recovery.ts`
- Modify: `server/services/index-service.ts`
- Modify: `server/services/graph-service.ts`
- Modify: all authoritative create/update services
- Modify: `shared/vault-map.ts`
- Test: `tests/server/projection-recovery.test.ts`
- Test: `tests/server/index-service.test.ts`
- Test: `tests/api/verification.test.ts`

- [ ] **Step 1: Write failing T02 and T12 tests**

Force index rebuild failure after a card commit and prove the card survives with `projectionStatus: "stale"`. Create candidate/verdict/revocation records and prove the index fingerprint and parse errors exclude the verification subtree.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm.cmd test -- tests/server/projection-recovery.test.ts tests/server/index-service.test.ts tests/api/verification.test.ts`
Expected: FAIL on rollback coupling or verification subtree traversal.

- [ ] **Step 3: Commit source independently from projection**

```ts
export type SaveOutcome<T> = {
  value: T;
  saved: true;
  projectionStatus: "fresh" | "stale";
  projectionErrorId: string | null;
};
```

Projection work is per-vault serialized and deduplicated. Corrupt cache files are renamed with `.corrupt-<timestamp>` and rebuilt. No projection failure deletes authoritative Markdown.

- [ ] **Step 4: Add exact traversal exclusion**

The recursive scanner skips `VERIFICATION_DIRECTORY` before reading entries; the exclusion is path-segment aware and does not exclude similarly prefixed sibling names.

- [ ] **Step 5: Run projection tests**

Run: `npm.cmd test -- tests/server/projection-recovery.test.ts tests/server/index-service.test.ts tests/api/verification.test.ts`
Expected: PASS.

### Task 7: Enforce common bounded I/O

**Files:**
- Create: `server/lib/io-budget.ts`
- Create: `server/lib/bounded-map.ts`
- Create: `server/lib/bounded-read.ts`
- Create: `server/lib/traversal-budget.ts`
- Modify: `server/services/review-service.ts`
- Modify: `server/services/verification-store.ts`
- Modify: `server/services/graph-service.ts`
- Modify: `server/services/vault-service.ts`
- Modify: `server/services/card-service.ts`
- Test: `tests/server/io-budget.test.ts`
- Test: `tests/server/resource-limits.test.ts`

- [ ] **Step 1: Write failing budget tests**

Cover maximum depth, file count, per-file bytes, total bytes, concurrency, deadline, and cancellation. Include a 10,000-review-record fixture and one corrupt verification record.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm.cmd test -- tests/server/io-budget.test.ts tests/server/resource-limits.test.ts`
Expected: FAIL because the shared budget API does not exist.

- [ ] **Step 3: Implement a consumed, monotonic budget**

```ts
export type IoBudgetLimits = {
  maxDepth: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxConcurrency: number;
  deadlineAt: number;
};

export interface IoBudget {
  claimFile(size: number, depth: number): void;
  checkpoint(signal?: AbortSignal): void;
  snapshot(): Readonly<{ files: number; bytes: number }>;
}
```

Review scans its records once into `Map<cardId, ResultRecord[]>`. Verification scans once and quarantines an invalid record while returning diagnostics. Graph uses bounded concurrency. Migration/backup stream hashes and enforce total limits. Card index uses the repairing projection reader.

- [ ] **Step 4: Run focused budget tests**

Run: `npm.cmd test -- tests/server/io-budget.test.ts tests/server/resource-limits.test.ts`
Expected: PASS, including deterministic over-budget diagnostics.

### Task 8: Make sidecar lifecycle truthful and process-tree safe

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/runtime.rs`
- Modify: `src/desktop/application-close.ts`
- Modify: close UI components
- Test: Rust unit tests in `src-tauri/src/runtime.rs`
- Test: `tests/ui/application-close.test.ts`

- [ ] **Step 1: Add failing Rust state and error-propagation tests**

Inject terminate, kill, wait, and try-wait failures. Assert `stop-failed`, retained ownership, restart refusal, and structured shutdown error.

- [ ] **Step 2: Run focused Rust tests and confirm failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml runtime`
Expected: FAIL because `terminate_and_wait()` returns `()`.

- [ ] **Step 3: Implement states and error result**

```rust
enum RuntimeProcessState {
    Starting,
    Running,
    Stopping,
    StopFailed,
    Stopped,
    Crashed,
}

fn terminate_and_wait(
    &mut self,
) -> Result<std::process::ExitStatus, ShutdownError>;
```

Retain the child and Windows Job Object handles until exit is proven. Job Objects use `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Restart returns an error while an old PID is live or state is `StopFailed`.

- [ ] **Step 4: Unify and expose close failure UI**

Native X, Ctrl+Q, and Settings exit call one close controller. It serializes duplicate requests and renders closing, failure reason, retry, and explicit force-exit choices.

- [ ] **Step 5: Run Rust and UI lifecycle tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

Run: `npm.cmd test -- tests/ui/application-close.test.ts`
Expected: PASS with no unhandled promise rejection.

### Task 9: Repair unsaved navigation and draft persistence

**Files:**
- Modify: `src/lib/unsaved-guard.ts`
- Modify: `src/lib/draft-store.ts`
- Modify: `src/lib/active-library-drafts.ts`
- Modify: editors that call the draft API
- Test: `tests/ui/unsaved-guard.test.ts`
- Test: `tests/ui/draft-store.test.ts`
- Test: `tests/ui/library-switch-race.test.tsx`

- [ ] **Step 1: Write failing T10/T11 and migration rollback tests**

Cover save-edit-navigate, multiple dirty scopes, quota/security errors, deterministic collision inputs, and failure writing the destination draft key.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm.cmd test -- tests/ui/unsaved-guard.test.ts tests/ui/draft-store.test.ts tests/ui/library-switch-race.test.tsx`
Expected: FAIL for stale permission or thrown storage error.

- [ ] **Step 3: Replace the global permission with target-bound synchronous consumption**

```ts
export type NavigationPermit = Readonly<{
  target: string;
  dirtyRevision: number;
}>;
```

Saving never creates a permit. Confirmation creates one permit for one target and the router consumes it immediately. Any dirty-scope transition invalidates it.

- [ ] **Step 4: Return typed draft results and retain in memory on persistence failure**

```ts
export type DraftWriteResult =
  | { ok: true; persisted: true }
  | { ok: true; persisted: false; warning: "DRAFT_NOT_PERSISTED" }
  | { ok: false; code: "INVALID_DRAFT" | "DRAFT_TOO_LARGE" };
```

All storage access is inside `try/catch`. Draft identity is `SHA-256(vaultId + canonicalPath)` with stored metadata. Migration writes and verifies the new key before deleting the old key.

- [ ] **Step 5: Run focused draft tests**

Run: `npm.cmd test -- tests/ui/unsaved-guard.test.ts tests/ui/draft-store.test.ts tests/ui/library-switch-race.test.tsx`
Expected: PASS.

### Task 10: Make migration, backup, and settings recovery crash-safe

**Files:**
- Modify: `server/services/vault-service.ts`
- Modify: `server/config/app-settings.ts`
- Create: `server/services/vault-transfer.ts`
- Test: `tests/api/vault.test.ts`
- Test: `tests/server/app-settings-recovery.test.ts`

- [ ] **Step 1: Write failing T15 and T16 tests**

Terminate a migration after one file, restart, and assert the final destination is not reported successful while its partial is resumable or quarantinable. Corrupt `settings.json`, run auto-prepare, and assert isolation plus successful fallback.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm.cmd test -- tests/api/vault.test.ts tests/server/app-settings-recovery.test.ts`
Expected: FAIL on direct-final copy or settings parse abort.

- [ ] **Step 3: Implement partial transfer manifests**

Copy to `<destination>.partial-<transactionId>`. The manifest records source vault ID, relative path, size, SHA-256, start time, and `completed`. Stream copy/hash under an exclusive vault lease and I/O budget. Verify every manifest entry before directory rename.

- [ ] **Step 4: Quarantine corrupt app settings and continue fallback**

Rename invalid settings to `settings.corrupt-<timestamp>.json`, record a diagnostic, and try the recommended and app-data vault paths. Do not block first launch.

- [ ] **Step 5: Run migration/settings tests**

Run: `npm.cmd test -- tests/api/vault.test.ts tests/server/app-settings-recovery.test.ts`
Expected: PASS.

### Task 11: Establish the complete release evidence chain

**Files:**
- Modify: `.github/workflows/windows-release.yml`
- Modify: `.github/workflows/windows-qualification.yml`
- Create/modify: release evidence scripts under `scripts/`
- Test: `tests/scripts/release-package.test.ts`
- Test: `tests/scripts/desktop-delivery.test.ts`

- [ ] **Step 1: Pin third-party actions to full commit SHAs**

Every `uses:` line outside the repository uses a 40-hex commit. Dependabot/Renovate comments retain the human-readable upstream version.

- [ ] **Step 2: Add all mandatory release gates**

The release workflow enforces source cleanliness, dependency integrity, typecheck, static audit, unit/integration/fault tests, Playwright, Rust, Tauri build, installed first-run, upgrade, shutdown/process cleanup, uninstall, SBOM/license, attestation, and manifest reconciliation before a stable release.

- [ ] **Step 3: Generate machine-readable evidence**

Upload JUnit, failed Playwright traces, transaction recovery report, installed lifecycle report, PID cleanup report, `release-manifest.json`, SBOM, source ZIP, installer, SHA-256 sums, and GitHub artifact attestation.

- [ ] **Step 4: Run release contract tests**

Run: `npm.cmd test -- tests/scripts/release-package.test.ts tests/scripts/desktop-delivery.test.ts`
Expected: PASS and prove all expected files and hash relationships.

- [ ] **Step 5: Keep signing status honest**

Preview/RC outputs remain explicitly unsigned until a user-controlled Authenticode certificate is available. Stable publication is blocked without a verified signature.

### Task 12: Execute and reconcile T01-T22

**Files:**
- Create: `docs/current/90-plus-verification-matrix.md`
- Create: `artifacts/evidence/90-plus/` reports through scripts/workflows
- Modify tests as required to map every T-number to an executable test

- [ ] **Step 1: Map every T-number to an exact test and report**

Each row records requirement, test file/name, command, result, commit SHA, artifact hash, and remaining boundary. No test may be reused for a broader claim than it exercises.

- [ ] **Step 2: Run the full local non-installer suite**

Run: `npm.cmd run typecheck`

Run: `npm.cmd test -- --reporter=verbose`

Run: `npm.cmd run build`

Run: `npm.cmd run test:browser:production`

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: every command exits 0.

- [ ] **Step 3: Run bounded soak and resource telemetry**

Run the packaged candidate for 8 hours while polling PID, process count, handle count, private bytes, projection status, and transaction journal count. T21 passes only when no sustained handle growth, duplicate sidecar, or unrecoverable projection occurs.

- [ ] **Step 4: Run GitHub Windows qualification**

GitHub Actions—not the user's local machine—builds the NSIS installer and executes T18-T20 plus release evidence reconciliation. T22 verifies commit/source/installer/SBOM/test-report hashes.

- [ ] **Step 5: Perform a requirement-by-requirement completion audit**

All eight gates and T01-T22 must have direct current evidence. Any missing, indirect, skipped, or stale item remains incomplete; do not claim 90+.

## Self-review

- Spec coverage: all eight gates, T01-T22, the required workflow chain, artifact list, and ten Codex constraints map to tasks above.
- Placeholder scan: the plan contains no TBD/TODO/later placeholders; every task has concrete files, contracts, commands, and pass conditions.
- Type consistency: `LibraryContext`, `LibraryLease`, `AssetVersion`, `SaveOutcome`, `IoBudget`, transaction states, lifecycle states, `NavigationPermit`, and `DraftWriteResult` are defined once and used consistently.
- Execution mode: inline execution in this task because the current environment does not authorize sub-agent delegation.
