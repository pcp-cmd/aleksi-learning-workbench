# Aleksi Learning Workbench — Archival 1.0 Master Remediation and Release Plan

> **Purpose:** turn the supplied Aleksi Learning Workbench 0.1.4 source into a long-lived, recoverable, verifiable Windows desktop baseline that can be used daily with minimal manual maintenance.
>
> **Authoritative input:** `Aleksi-Learning-Workbench-Source-0.1.4-Final(2).zip`
>
> **Input SHA-256:** `5c4158b23ccabdc820f7dce071fd858f4d467d9393cd9d9773831e8104850d88`
>
> **Current honest static score:** **80 / 100**
>
> **Target after implementation and Windows evidence:** **96–98 / 100**
>
> **Release naming:** implement and prove changes under `0.1.5-rc.x`; publish `1.0.0` only after every hard gate in this document passes.

---

## 中文执行摘要

0.1.4 不是简单改版本号。它已经加入可恢复文件事务、学习库租约、CAS、投影降级、有界 I/O、草稿持久化状态、Sidecar 真实退出状态和较完整的 Windows qualification 工作流，工程基础明显强于 0.1.3。

但若目标是“这一版做完以后，日常使用基本不用再管”，当前仍有八类封存阻断项：

1. 事务进入 `quarantined` 后没有用户可见的检查、恢复和解除闭环；损坏 journal 甚至可能永久阻止后续写入。
2. HTTP 连接关闭可能先释放学习库租约，而后端业务仍在执行；部分服务只接收路径并重新读取 Vault ID，未真正使用完整、不可变的请求级上下文。
3. 前端学习库切换会无限等待卡住的保存操作，缺少超时、取消与可见恢复。
4. 应用级 `settings.json` 仍是单点，写入中断或损坏后只能隔离，不能可靠恢复上一个有效学习库位置。
5. 备份有校验但缺少完整的“发现中断备份—验证—恢复演练—清理残留”闭环。
6. 启动动画目前没有“直接进入”按钮，自动进入也由固定 20 秒而非动画完成事件决定，不符合明确产品要求。
7. 卡片区只有最近 10 张卡片，不是可长期扩展的全量卡片库。
8. 当前发布仍是短期保存的 unsigned qualification，未形成可永久追溯、签名、可回滚的稳定资产链。

“以后不用管”不能理解为软件永远不需要维护，而应落实为：**故障自动发现、数据可以恢复、备份实际可还原、升级可以回滚、发布证据永久保存、依赖变化由自动化定期检查。**

---

## 1. Non-negotiable product and engineering constraints

Codex must preserve all constraints below. They are release blockers, not suggestions.

### 1.1 Product identity

- Keep the accepted light/white visual system. Do not introduce a dark theme.
- Preserve the existing local-first Markdown learning-library architecture.
- Preserve the Card Workbench and Theme Flywheel as core features.
- Preserve advanced features. They may remain collapsed or contextual, but must not be deleted.
- Keep the primary path simple: Today → Reader → Cards → Flywheel → Review.
- Use the user-facing term **“本地学习库”**, not “Vault”, except in internal code where migration cost would be disproportionate.
- Do not add accounts, social features, cloud storage, paid API requirements, databases, Electron, or unrelated product redesign.
- Do not bundle or redistribute the user's private UI fonts. Continue using installed-font stacks and compliant fallbacks.

### 1.2 Startup animation contract — mandatory new requirement

The existing `public/motion/overview.json` is a fixed product asset. It is 20 seconds at source timing (`12 fps`, frames `0–240`) and must be preserved.

The startup experience must expose two explicit paths:

1. **Natural path:** show the complete one-shot animation at source speed, `loop: false`; after the actual Lottie `complete` event and local service readiness, enter the restored safe route automatically.
2. **Direct path:** show a clear, keyboard-accessible **“直接进入”** button while the animation is visible. Clicking it bypasses only the remaining visual wait. It must never fake local-service readiness.

Detailed rules:

- The animation must appear once on every desktop process launch.
- Do not add “never show again”.
- Do not delete, replace, shorten, loop, or silently speed up the animation.
- If “直接进入” is clicked before the service is ready, retain the request and display “正在准备本地服务…”; navigate immediately when readiness becomes true.
- If the service fails, remain on the startup surface with diagnostics, retry, and safe exit actions.
- Reduced-motion users receive the static/fallback presentation and can enter as soon as service readiness is true.
- Missing/corrupt animation assets must not block entry.
- The progress indicator must either be truly determinate with a valid `aria-valuenow`, or be an honest indeterminate progress element. Do not expose fake accessibility values.

### 1.3 Delivery workflow

- Codex modifies source, tests, documentation, and GitHub Actions in the repository.
- Do **not** build or qualify the installer on the user's personal computer.
- The canonical installer must be produced by GitHub Actions on a clean Windows runner.
- When a manual upload or secret is needed, state exactly what the user must upload; do not attempt a long local upload workflow.
- Do not label an artifact stable, verified, signed, archival, or 1.0 unless the evidence gates below pass.

### 1.4 Engineering discipline

> Codex八荣八耻：以瞎猜接口为耻、认真查询为荣；以模糊执行为耻、寻求确认为荣；以臆想业务为耻、人类确认为荣；以创造接口为耻、复用现有为荣；以跳过验证为耻、主动测试为荣；以破坏架构为耻、遵循规范为荣；以假装理解为耻、诚实无知为荣；以盲目修改为耻、谨慎重构为荣。

Additional rules:

- No hot patches layered over superseded code.
- Delete superseded helpers and tests after the replacement is proven.
- Add failing regression tests before changing critical behavior.
- Refactor large modules only after behavior is locked by tests.
- Never rollback authoritative user Markdown merely because an index, graph, or other rebuildable projection failed.
- Never overwrite an external edit silently.
- Every swallowed cleanup error must either be demonstrably irrelevant or appear in a health/diagnostic record.

---

## 2. Iterative review ledger and score evolution

The score changed as new classes of risk were discovered. A lower later score does not mean the source regressed; it means the review standard became more complete.

| Round | Review axis | New result | Score |
|---|---|---|---:|
| 0 | Initial 0.1.4 static impression | Major 0.1.3 hardening is present | 88 |
| 1 | Package, identity, source cleanliness | Package audit, desktop source contract and release identity pass | 89 |
| 2 | Transaction recovery | Recovery exists, but quarantine has no resolution path; duplicate targets and orphan payloads are unguarded | 85 |
| 3 | Learning-library concurrency | Context exists, but routes pass only path; socket close can release lease before handler completion | 83 |
| 4 | Startup and explicit product requirement | No direct-entry button; natural completion is fixed timer, not animation completion | 82 |
| 5 | App locator and projection health | App settings are still a single point; projection failure records can disappear | 81 |
| 6 | Backup, verification and bounded I/O | Interrupted backup discovery/restore drill missing; several user files still use unbounded reads | 80 |
| 7 | Release permanence | Qualification is unsigned, branch-specific, temporary and predecessor artifact can expire | 78 |
| 8 | Product completeness and maintainability | No full card library; several 700–1700-line modules remain | 79 |
| 9 | Security and operational boundaries | Strong loopback/path/CSP boundaries; no high-confidence RCE/path traversal found statically | 81 |
| 10 | Convergence | No new architecture catastrophe; gaps cluster into a finite archival plan | **80** |

### Current score breakdown

| Dimension | Current | Archival target |
|---|---:|---:|
| Data integrity and crash recovery | 76 | 98 |
| Learning-library concurrency | 74 | 97 |
| Desktop process lifecycle | 87 | 98 |
| Security boundaries | 88 | 97 |
| Test design | 88 static / unproven dynamic | 97 proven |
| Release reproducibility and provenance | 77 | 98 |
| UX and accessibility | 82 | 96 |
| Maintainability | 73 | 94 |
| Product completeness for long-term use | 75 | 95 |
| Documentation and operational governance | 76 | 97 |

---

## 3. Release-blocking findings

### AR-P0-001 — Quarantined transactions can permanently block all writes

**Evidence:**

- `server/transactions/transaction-runner.ts` calls recovery before each write and throws when `recovery.quarantined > 0`.
- `server/transactions/transaction-recovery.ts` reports unreadable journals or Vault-ID mismatch but exposes no resolution operation.
- The normal HTTP error body drops `TransactionQuarantinedError.transactionId` and provides no recovery action.
- There is no settings/health screen that shows affected files, old/new hashes, or safe resolution choices.

**Required implementation:**

Create a transaction-health subsystem:

- `server/transactions/transaction-health.ts`
- `server/routes/health.ts` or a narrowly scoped `/api/vault/health` router
- a Settings “学习库健康” section and a global non-dismissable warning when writes are blocked

Health response must include sanitized, relative-only information:

- transaction ID
- operation
- state
- created/updated timestamps
- relative target paths
- old/current/new SHA-256 state
- whether new/old payloads are intact
- diagnostics
- allowed actions

Supported safe actions:

1. `retry_recovery`
2. `accept_current_external_version` — abandon intended changes without overwriting current files
3. `apply_intended_version` — only after preview and a fresh CAS assertion
4. `export_recovery_bundle`
5. `remove_unreadable_journal` — only after moving all artifacts to a quarantine bundle, never deleting evidence directly

Every action must be transactional, auditable and idempotent. The UI must explain consequences in ordinary Chinese.

**Do not implement:** a generic “force unlock” button that deletes journals.

### AR-P0-002 — Request-level library identity is not fully immutable

**Evidence:** routes generally call `requestLibraryContext(response)` but pass only `.path`; services then call `readVaultId(vaultPath)` again. Examples exist in card, reading, review, diagnosis and Codex-task flows.

**Required implementation:**

Introduce and consistently pass an immutable `LibraryOperationContext`:

```ts
type LibraryOperationContext = Readonly<{
  path: string;
  vaultId: string;
  generation: number;
  signal: AbortSignal;
  assertCurrent(): void;
}>;
```

- Routes obtain it once.
- Services accept the context, not a raw active-library path.
- Transactions use `context.vaultId` and `context.assertCurrent`.
- Long scans and hashes accept `context.signal` and checkpoint it.
- Re-reading `.aleksi/settings.json` during the same operation is prohibited unless explicitly reading content as user data rather than identity.

Add an architecture test that rejects active-library service entry points whose first parameter is a raw `vaultPath: string`.

### AR-P0-003 — HTTP connection close can release the lease before business completion

**Evidence:** `requestLibraryContext` releases its shared lease on response `finish` or `close`. A client disconnect can close the response while an async handler continues running.

**Required implementation:**

- Add `withLibraryOperation(response, async context => ...)` or equivalent middleware that owns the lease for the entire handler promise.
- Abort on request/response disconnect, but release only in handler `finally` after the service operation has stopped or settled.
- Ensure all write and scan operations honor the abort signal.
- A response socket is not the ownership boundary for a storage operation.

### AR-P0-004 — Learning-library switch can wait forever

**Evidence:** `src/lib/library-mutation-coordinator.ts` uses an unbounded `waitForMutationIdle()` and serial switch tail.

**Required implementation:**

- Track each active mutation by ID, label, start time and AbortController.
- After a short threshold, show which operation is delaying the switch.
- Provide “取消切换” and, where safe, “取消卡住的保存并重试”.
- Use a bounded server-side exclusive lease acquisition timeout with a structured `LIBRARY_BUSY` response; never silently switch underneath an active write.
- Do not automatically kill a storage transaction after it has entered a non-cancellable commit section.

### AR-P0-005 — App-level active-library locator is a single point of failure

**Evidence:** `server/config/app-settings.ts` stores only `settings.json`. Invalid content is renamed and the application becomes unconfigured. A process death during replacement can lose the only active-library pointer even while the learning library itself remains healthy.

**Required implementation:**

Implement a mirrored locator:

- `settings.json`
- `settings.mirror.json`
- optional append-only `settings.history.jsonl` with bounded retention

Rules:

- Validate both copies and select the newest valid value.
- Repair the missing/stale copy after selection.
- Include a monotonic revision and checksum.
- Never automatically choose another learning library solely because the locator was interrupted.
- If no valid copy exists, show a recovery picker with recently known paths from the bounded history; never silently create/select a different default library.
- Add process-termination tests at each replacement boundary.

### AR-P0-006 — Startup contract does not meet the required dual path

**Evidence:**

- `LaunchSplash` has retry only, no “直接进入”.
- `settleLaunchState` completes when `minimumElapsed && serviceReady`; it ignores `animationCompleted`.
- Documentation claims differ from code.

**Required implementation:**

Replace the launch state machine with explicit state:

```ts
type LaunchState = {
  animation: "loading" | "playing" | "complete" | "unavailable" | "reduced";
  service: "starting" | "ready" | "failed";
  directEntryRequested: boolean;
  failure: string | null;
};
```

Completion predicate:

```ts
service === "ready" &&
(directEntryRequested || animation === "complete" || animation === "unavailable" || animation === "reduced")
```

Add the button without removing the full animation. Keep the animation a one-shot presentation on every desktop launch.

### AR-P0-007 — Stable release evidence is temporary and unsigned

**Evidence:** the current workflow uploads qualification artifacts with finite retention, uses an expiring predecessor Actions artifact, publishes no immutable release, and explicitly produces `unsigned-preview`.

**Required implementation:**

Create separate workflows:

1. `ci.yml` — PR/main source checks.
2. `windows-qualification.yml` — installed Windows matrix.
3. `stable-release.yml` — protected tag only, environment approval, signing and immutable publication.
4. `scheduled-health.yml` — automated security/build/restore checks.

Stable release must publish immutable GitHub Release assets:

- signed installer
- source ZIP
- SHA-256 checksums
- `release-manifest.json`
- CycloneDX or SPDX SBOM
- dependency-license inventory
- provenance/attestation
- first-install report
- predecessor-upgrade report
- uninstall/reinstall report
- backup-restore drill report
- soak report
- known limitations

The predecessor installer must be a durable release asset with a pinned hash, not a short-lived Actions artifact ID.

`1.0.0` is blocked until Authenticode signature and timestamp are verified on the installed executable and installer. If no certificate is available, produce an RC only and describe it honestly as unsigned.

### AR-P0-008 — No proof that a backup can actually be restored

**Evidence:** backup content is copied and hashed, but there is no complete user-facing restore flow or automated restore drill that starts the application against a restored copy.

**Required implementation:**

- Add “验证备份” and “从备份恢复到新位置”.
- Never restore over the active library in place.
- Validate manifest schema, every relative path, total counts, file sizes and hashes.
- Restore into a new verified destination.
- Initialize/open it under an exclusive library switch only after verification.
- Add a release qualification drill: create populated library → backup → restore to new path → compare canonical content → launch app against restored copy → create and review a card.

---

## 4. High-priority reliability tasks

### AR-P1-001 — Reject duplicate transaction targets before any disk mutation

Normalize all target paths first and reject duplicates. The current `options.targets.find(...)` behavior is ambiguous when the same normalized target appears twice.

Test case: two inputs such as `a/../b.md` and `b.md` must fail before payload directory creation.

### AR-P1-002 — Scavenge orphan transaction artifacts safely

Preparation can create `.aleksi/transactions/<uuid>/` before a journal is durable. `listTransactionIds` only discovers `.json` and `.mirror`.

Add startup scavenging for:

- payload directories without either journal copy
- stale `.tmp` or `.bak` transaction files
- journals without payloads

Never hard-delete unexplained data. Move uncertain artifacts into `.aleksi/quarantine/transactions/<timestamp-id>/` with a manifest and retention policy.

### AR-P1-003 — Preserve startup recovery health

`startServer` waits for recovery but discards the returned report. Persist the startup health snapshot in memory and expose it through `/api/health` or `/api/vault/health`. The desktop “ready” record should distinguish:

- healthy
- ready-with-degraded-projections
- ready-read-only-needs-recovery

Do not claim fully healthy when writes are blocked.

### AR-P1-004 — Make projection failure durable and observable

Current projection failure recording can itself fail and be swallowed.

Store:

- first failure time
- last failure time
- attempt count
- sanitized error category
- status
- last successful rebuild time

Maintain an in-memory fallback health state when the file cannot be written. Expose “重建索引” in the health UI. Projection failure must never rollback Markdown.

### AR-P1-005 — Move corrupt projections/evidence out of active directories

Current `.corrupt-*` renames remain in the scanned directory and count against record limits.

Centralize quarantine under:

```text
.aleksi/quarantine/
  transactions/
  projections/
  verification/
  app-settings-diagnostics/
```

- Exclude quarantine from all normal indexes and record limits.
- Keep a bounded inventory, export action and user-confirmed cleanup.
- Detect malformed verification filenames, not only malformed recognized records.

### AR-P1-006 — Finish bounded I/O migration

Replace direct user-controlled `readFile` calls in:

- `server/services/review-service.ts`
- `server/services/verification-candidate.ts`
- `server/services/vault-service.ts` migration manifest path
- any remaining service read discovered by the architecture scan

Use common helpers that enforce:

- regular non-symlink file
- max file size
- shared total I/O budget
- deadline
- concurrency cap
- abort signal

Add a static test that rejects direct `readFile` imports in user-data service modules unless the file is explicitly allowlisted.

### AR-P1-007 — Validate transfer manifests with a real schema

Replace type assertions with strict Zod parsing for `VaultTransferManifest` and `FileDigest`.

Validate:

- schema version
- operation
- UUID
- absolute source/final paths only at privileged boundary
- normalized relative paths without duplicates
- lower-case 64-character SHA-256
- finite non-negative sizes
- bounded file count and total bytes
- consistency between phase/completed/finalFiles

### AR-P1-008 — Discover and resolve interrupted backups

Migration has partial discovery; backup does not form an equivalent user-visible lifecycle.

At startup/settings health:

- find backup `.partial-*` and manifests
- classify incomplete, complete-but-not-renamed, invalid or orphaned
- allow verify/finalize/export/delete after confirmation
- report cleanup failures rather than swallowing them

### AR-P1-009 — Complete force-exit failure semantics

The UI calls `desktopRuntime.forceExit()` without handling failure. Define one of two explicit contracts:

- native command is guaranteed non-returning, or
- it returns a result and the UI displays failure

Do not leave an unhandled rejected promise. Log destroyed-window shutdown failure in sanitized diagnostics.

### AR-P1-010 — Add a real full Card Library

The current interface exposes only recent cards. For long-term use implement a minimal, bounded full card library without adding a database:

- index-backed pagination
- title/concept query
- type filter
- mastery/trust state filter
- due/review status filter
- sort by updated, created, title and due date
- open/edit/archive actions
- deep links by card ID
- empty, loading, degraded-index and recovery states

Use the existing index as a rebuildable projection. Do not recursively rescan the entire learning library on every keystroke.

Keep Card Studio as the creation/editing workspace and add a clear “全部卡片” entry. Do not replace the existing workflow.

### AR-P1-011 — Fix documentation drift and create one generated current contract

Update or retire stale current documentation, including old canonical versions and outdated launch behavior.

Create `docs/current/CURRENT_CONTRACT.md` generated/validated from:

- `package.json`
- `release/identity.json`
- Tauri/Cargo metadata
- launch constants
- route registry
- signing/WebView2 policy

Add a governance test that rejects stale canonical version strings in `docs/current`, except explicitly marked historical tables.

### AR-P1-013 — Remove the first-install WebView2 network dependency

The current `online-light` policy can require network access on a clean Windows machine. For a low-touch stable release, package the Microsoft Evergreen WebView2 offline installer/bootstrap payload through the supported Tauri install mode, verify its hash during packaging, and test on a clean Windows image without a preinstalled runtime and without network access.

Do not freeze a permanently obsolete WebView2 runtime inside the application. The objective is an offline-capable first installation followed by the normal Evergreen update model. If installer-size constraints prevent this, retain `online-light` only as an explicitly documented limitation and cap the release below the archival target.

### AR-P1-012 — Add lint, architecture and complexity gates

Add a conservative lint baseline, then enable as errors after cleanup:

- no floating promises
- React hooks rules
- no unsafe ignored promises
- no empty catch without comment/diagnostic
- consistent type-only imports
- no direct active-library reads below route boundary
- no unbounded user-data reads

Add architecture checks:

- no UI → server imports
- no service → route imports
- domain/codec do not import Express/Tauri
- projections cannot delete authoritative Markdown
- active-library service methods require context

Set budgets to prevent growth, not to force immediate arbitrary splitting. After behavior is locked, split:

- `src-tauri/src/runtime.rs`
- `server/services/vault-service.ts`
- `server/services/index-service.ts`
- `src/features/review/ReviewPage.tsx`
- `src/features/verification/VerificationPage.tsx`
- `src/features/reader/ReaderPage.tsx`
- `src/features/settings/SettingsDialog.tsx`
- `src/lib/api-client.ts`

Prefer domain-specific modules and state machines; do not create generic `utils.ts` dumping grounds.

---

## 5. Implementation order

The order is mandatory because later work depends on earlier invariants.

### Stage A — Freeze behavior and create the executable verification matrix

1. Create `docs/current/ARCHIVAL_VERIFICATION_MATRIX.md` with every test below.
2. Add failing tests for all P0 issues before implementation.
3. Record current 0.1.4 source hash and release identity.
4. Create branch `codex/1.0.0-archival-baseline` or equivalent.
5. Keep release version as `0.1.5-rc.1` until all stable gates pass.

### Stage B — Storage and identity foundation

1. Immutable `LibraryOperationContext`.
2. Handler-owned lease lifecycle and cancellation.
3. Transaction duplicate guard and orphan scavenging.
4. Transaction health/recovery center.
5. Mirrored app locator.
6. Projection health and centralized quarantine.
7. Finish bounded I/O and manifest schemas.

### Stage C — Backup and lifecycle closure

1. Interrupted-backup discovery.
2. Verify/restore-to-new-location flow.
3. Automated restore drill.
4. Sidecar force-exit/destroyed-window diagnostics.
5. Windows process-kill boundary tests.

### Stage D — Required startup UX

1. Replace launch state machine.
2. Add “直接进入”.
3. Correct progress accessibility.
4. Add startup matrix tests.
5. Update current documentation from actual behavior.

### Stage E — Long-term product completeness

1. Add full Card Library.
2. Preserve Card Studio, Flywheel and existing light design.
3. Add degraded/offline/recovery states.
4. Run accessibility and keyboard tests.

### Stage F — Maintainability refactor

1. Add lint and architecture gates.
2. Split large files only with characterization tests.
3. Remove superseded code and duplicate tests.
4. Keep import graph acyclic.

### Stage G — Stable release pipeline

1. Durable predecessor release asset.
2. Signed protected-tag workflow.
3. SBOM, checksums, provenance and evidence bundle.
4. Full Windows install/upgrade/uninstall/restore matrix.
5. 24-hour minimum soak for 1.0; 72-hour preferred.
6. Publish `1.0.0` only after all hard gates are green.

---

## 6. Mandatory verification matrix

Every case must produce machine-readable evidence. A passing unit test alone is insufficient for Windows lifecycle cases.

### A. Startup — S01–S10

- **S01:** animation loads, plays once at source speed, emits real completion, service ready, automatic entry occurs.
- **S02:** user clicks “直接进入” after service readiness; navigation is immediate.
- **S03:** user clicks “直接进入” before readiness; request is retained, no fake readiness, navigation occurs when ready.
- **S04:** animation completes before service; page waits with clear service status.
- **S05:** animation asset is missing/corrupt; fallback renders and entry remains possible.
- **S06:** service fails; retry and safe exit work; no blank screen.
- **S07:** retry succeeds after initial failure without replay loops or stale timers.
- **S08:** reduced motion uses a stable non-animated presentation and enters when ready.
- **S09:** keyboard Tab/Enter/Space can activate direct entry; focus is visible.
- **S10:** each new desktop process launch presents the entrance once; internal route changes never replay it.

### B. Transactions — T01–T16

- **T01:** crash after payload directory creation but before journal write leaves a discoverable safe orphan.
- **T02:** crash after primary journal only.
- **T03:** crash after mirror journal only.
- **T04:** crash before first target.
- **T05:** crash between two targets.
- **T06:** crash after target replacement displaced old file.
- **T07:** crash after all targets but before committed journal.
- **T08:** crash after committed journal but before cleanup.
- **T09:** second crash during recovery remains recoverable.
- **T10:** external edit during transaction is never overwritten.
- **T11:** duplicate normalized target paths fail before disk mutation.
- **T12:** unreadable primary with valid mirror recovers.
- **T13:** unreadable primary and mirror enters visible health state, not invisible permanent lock.
- **T14:** accept-current resolution preserves external content and unlocks writes.
- **T15:** apply-intended resolution requires preview and current CAS.
- **T16:** recovery/export actions never expose absolute paths or secrets.

### C. Learning-library concurrency — L01–L12

- **L01:** a request reads and writes only one immutable context.
- **L02:** switching waits for an active commit.
- **L03:** a client disconnect aborts a cancellable scan but does not release its lease early.
- **L04:** a disconnected non-cancellable commit finishes before lease release.
- **L05:** a hung mutation produces a visible delayed-switch state.
- **L06:** user cancels pending switch safely.
- **L07:** server exclusive acquisition timeout returns structured `LIBRARY_BUSY`.
- **L08:** concurrent switch requests remain serialized and identity headers match each body.
- **L09:** stale responses from the previous library are rejected client-side.
- **L10:** old-library drafts remain isolated and recoverable.
- **L11:** app locator changes externally during a request cannot change transaction Vault ID.
- **L12:** process restart preserves correct active library generation/identity.

### D. App locator — A01–A08

- **A01:** primary valid/mirror missing repairs mirror.
- **A02:** mirror valid/primary missing repairs primary.
- **A03:** copies disagree; newest valid monotonic revision wins.
- **A04:** process death during each replacement boundary retains at least one valid copy.
- **A05:** both corrupt produces recovery picker, not silent default-library switch.
- **A06:** recently known path is unavailable; UI explains and allows locate/retry.
- **A07:** root-relative/relative/UNC policy violations are rejected safely.
- **A08:** settings diagnostics remain bounded and do not accumulate indefinitely.

### E. Projection and verification health — P01–P10

- **P01:** Markdown write succeeds while index rebuild fails; authoritative content remains.
- **P02:** projection failure record includes attempts and timestamps.
- **P03:** projection health remains visible even if its state file cannot be written.
- **P04:** rebuild clears stale state only after success.
- **P05:** corrupt evidence moves outside active directory and other records still load.
- **P06:** malformed filenames produce diagnostics.
- **P07:** quarantine files do not count toward active record limits.
- **P08:** one oversized record does not crash the entire page.
- **P09:** semantic array/item count limits reject pathological records.
- **P10:** all scans honor deadline, total-byte, file-count and concurrency budgets.

### F. Backup, migration and restore — B01–B12

- **B01:** normal backup manifest and all hashes verify.
- **B02:** source changes during backup fail safely.
- **B03:** crash during copy is discovered and classified.
- **B04:** crash after backup verified but before final rename can finalize safely.
- **B05:** invalid partial is never treated as a backup.
- **B06:** transfer manifest duplicate paths and malformed hashes are rejected.
- **B07:** cleanup failure appears in health state.
- **B08:** restore always targets a new location.
- **B09:** restored library canonical files equal the source snapshot.
- **B10:** restored library launches, writes a Chinese reading, creates a card and completes a review.
- **B11:** migration resume works after a second process termination.
- **B12:** backup/quarantine retention cleanup requires confirmation and preserves exportability.

### G. Sidecar and desktop lifecycle — D01–D14

- **D01:** first launch reaches matching shell/sidecar identity.
- **D02:** native X safely stops app and process tree.
- **D03:** Ctrl+Q uses same close controller.
- **D04:** Settings Exit uses same close controller.
- **D05:** dirty close asks once; cancel remains open.
- **D06:** stop failure reports `stop-failed`, preserves handle and permits retry.
- **D07:** no duplicate Sidecar after failed restart.
- **D08:** force-exit command has explicit success/non-return contract.
- **D09:** parent death terminates full Sidecar process tree.
- **D10:** stale-generation crash events are ignored.
- **D11:** diagnostics redact protocol secret and absolute sensitive paths.
- **D12:** 0.1.4/0.1.5 predecessor upgrade preserves learning data.
- **D13:** uninstall preserves user learning library and removes app processes/binaries as documented.
- **D14:** reinstall and relaunch retain data and pass health checks.

### H. Card Library and daily UX — C01–C10

- **C01:** pagination returns deterministic non-duplicated cards.
- **C02:** title/concept search is bounded and identity-scoped.
- **C03:** type/mastery/due filters combine correctly.
- **C04:** stale/degraded index displays recovery action without hiding authoritative cards already available.
- **C05:** deep link opens a non-recent card.
- **C06:** archive/update use current CAS.
- **C07:** keyboard and screen reader navigation pass.
- **C08:** 10,000-card synthetic library remains responsive within documented budgets.
- **C09:** no absolute path appears in normal UI.
- **C10:** Card Studio and Flywheel regressions remain green.

### I. Release and long-run evidence — R01–R16

- **R01:** clean source tree and source ZIP audit.
- **R02:** deterministic version/identity across npm, Cargo, Tauri and manifest.
- **R03:** TypeScript typecheck.
- **R04:** all Vitest suites.
- **R05:** production Playwright suite.
- **R06:** Rust fmt/check/clippy/tests.
- **R07:** dependency audit, dependency review, secret scan and code scan.
- **R08:** reproducible desktop resource preparation.
- **R09:** signed installer and executable signature/timestamp verification.
- **R10:** first-install test on clean Windows user profile, including an offline clean image without preinstalled WebView2.
- **R11:** predecessor upgrade test.
- **R12:** native close/uninstall/reinstall residual-process test.
- **R13:** backup restore drill.
- **R14:** SBOM/checksum/provenance reconciliation.
- **R15:** 24-hour soak with periodic save/switch/review/backup and handle/memory/process telemetry.
- **R16:** immutable release assets can be downloaded and reverified after workflow artifacts expire.

---

## 7. Release scoring gates

### 90 points

Requires all P0 storage/concurrency/startup issues fixed and all source tests passing in CI. Still an RC if unsigned or installed evidence is incomplete.

### 94 points

Requires the Windows installer matrix, backup restore drill, quarantine recovery UI, full card library and 8-hour soak.

### 96 points

Requires Authenticode signing, durable release assets, 24-hour soak, security scans, documentation SSOT and no unresolved P0/P1 defect.

### 97–98 points

Requires a preferred 72-hour soak, forced-process-termination fault matrix on Windows, restore drill, synthetic large-library performance evidence, and one independent clean-machine installation round.

### 100 points

Do not claim 100. The application depends on Windows, WebView2, Node/Rust/npm dependencies and future security conditions. The correct objective is a **highly reliable, low-touch, observable 97–98 baseline**, not an unverifiable permanent-perfect label.

---

## 8. Automated low-maintenance operating model

After 1.0.0, minimize manual attention through GitHub automation:

- Weekly dependency and secret scan.
- Monthly clean Windows rebuild and install/launch/close test.
- Monthly backup/restore drill using generated non-personal fixture data.
- Quarterly predecessor-upgrade test from latest stable release.
- Automatic issue creation only when a scheduled health workflow fails, with logs and exact failing gate.
- Dependabot or equivalent update PRs must run the full source test suite; no automatic merge into stable without green Windows qualification.
- Keep the last two stable installers and their hashes permanently available for rollback.
- Never upload a real user learning library to CI.

This is the operational meaning of “以后基本不用管”: the system detects maintenance needs before daily use is affected and leaves a precise, reproducible repair task.

---

## 9. Required final deliverables from Codex

Codex must return one concise completion report and link the following repository artifacts:

1. Source commit SHA and protected stable tag.
2. Complete changed-file list grouped by task.
3. P0/P1 closure table with test IDs.
4. Full CI run URL and Windows qualification run URL.
5. Signed installer and installed executable signature evidence.
6. Release manifest and checksums.
7. SBOM and license inventory.
8. First-install, upgrade, uninstall/reinstall and restore reports.
9. Soak report with duration and telemetry summary.
10. Remaining known limitations. “None” is acceptable only with evidence.

Codex must explicitly state any command or test that did not run. It must never convert an unexecuted check into a pass.

---

## 10. Definition of done

The archival release is done only when all statements below are true:

- The full entrance animation remains present and one-shot.
- Users can wait for natural completion or click “直接进入”.
- A transaction crash cannot silently lose or overwrite user Markdown.
- Every quarantined state has a visible safe recovery path.
- One request cannot cross learning-library identities.
- A stuck save cannot freeze learning-library switching forever without explanation or cancellation.
- Losing one app-settings write cannot lose the active-library pointer.
- Projection/index failure cannot delete authoritative content.
- Every user-controlled scan is bounded and cancellable where safe.
- A backup has been successfully restored and used in an automated drill.
- Sidecar stop failure is truthful and leaves no duplicate process.
- Old cards remain searchable through a full Card Library.
- Current documentation matches actual code and release identity.
- The installer works on a clean offline Windows image or the remaining network dependency is explicitly accepted and scored as a limitation.
- The installer and executable are signed and timestamped.
- The full release evidence is immutable and survives Actions artifact expiration.
- The release passes the Windows install, upgrade, close, uninstall, reinstall, restore and soak matrix.
- No unresolved P0 or P1 item remains.

Only then change the canonical version to `1.0.0` and describe it as the long-term stable baseline.

---

## 11. Review limitations and evidence already verified

Verified in the current review environment:

- Source ZIP SHA-256 recorded above.
- Package audit passed: 398 entries, 8,487,246 bytes.
- Desktop source contract passed.
- Canonical release identity passed for version 0.1.4.
- Current source contains 63 frontend source files / 11,006 lines, 70 server files / 13,502 lines, 4 Rust files / 2,136 lines, and 79 test files / 22,718 lines.
- The Overview animation asset exists and is exactly 20 seconds at source metadata timing.
- No high-confidence remote-code-execution or path-traversal flaw was identified in static inspection.
- No private UI font binary was found in the source package.

Not proven in this environment:

- TypeScript compilation
- Vitest execution
- Playwright execution
- Rust compilation/tests
- Windows NSIS packaging
- real installed lifecycle
- npm vulnerability status
- Authenticode signing
- Windows process-kill recovery
- long-duration soak

The local dependency restore was unavailable, so none of the unexecuted checks may be treated as passed. GitHub Actions evidence is mandatory.
