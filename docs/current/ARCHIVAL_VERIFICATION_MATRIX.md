# Archival 1.0 Verification Matrix

> Generated from `docs/reference/ALEKSI_0.1.4_ARCHIVAL_1.0_MASTER_PLAN.md` by `npm run generate:archival-matrix`.
>
> A row changes from `not-run` only when the linked machine-readable evidence exists. Source tests cannot satisfy Windows lifecycle evidence by themselves.

| ID | Requirement | Automated evidence | Windows evidence | Status | Artifact |
|---|---|---|---|---|---|
| S01 | animation loads, plays once at source speed, emits real completion, service ready, automatic entry occurs. | `tests/ui/launch-*.test.*`, `tests/browser/entrance-overview.spec.ts` | Production Playwright; native launch cases in Windows qualification | not-run | — |
| S02 | user clicks “直接进入” after service readiness; navigation is immediate. | `tests/ui/launch-*.test.*`, `tests/browser/entrance-overview.spec.ts` | Production Playwright; native launch cases in Windows qualification | not-run | — |
| S03 | user clicks “直接进入” before readiness; request is retained, no fake readiness, navigation occurs when ready. | `tests/ui/launch-*.test.*`, `tests/browser/entrance-overview.spec.ts` | Production Playwright; native launch cases in Windows qualification | not-run | — |
| S04 | animation completes before service; page waits with clear service status. | `tests/ui/launch-*.test.*`, `tests/browser/entrance-overview.spec.ts` | Production Playwright; native launch cases in Windows qualification | not-run | — |
| S05 | animation asset is missing/corrupt; fallback renders and entry remains possible. | `tests/ui/launch-*.test.*`, `tests/browser/entrance-overview.spec.ts` | Production Playwright; native launch cases in Windows qualification | not-run | — |
| S06 | service fails; retry and safe exit work; no blank screen. | `tests/ui/launch-*.test.*`, `tests/browser/entrance-overview.spec.ts` | Production Playwright; native launch cases in Windows qualification | not-run | — |
| S07 | retry succeeds after initial failure without replay loops or stale timers. | `tests/ui/launch-*.test.*`, `tests/browser/entrance-overview.spec.ts` | Production Playwright; native launch cases in Windows qualification | not-run | — |
| S08 | reduced motion uses a stable non-animated presentation and enters when ready. | `tests/ui/launch-*.test.*`, `tests/browser/entrance-overview.spec.ts` | Production Playwright; native launch cases in Windows qualification | not-run | — |
| S09 | keyboard Tab/Enter/Space can activate direct entry; focus is visible. | `tests/ui/launch-*.test.*`, `tests/browser/entrance-overview.spec.ts` | Production Playwright; native launch cases in Windows qualification | not-run | — |
| S10 | each new desktop process launch presents the entrance once; internal route changes never replay it. | `tests/ui/launch-*.test.*`, `tests/browser/entrance-overview.spec.ts` | Production Playwright; native launch cases in Windows qualification | not-run | — |
| T01 | crash after payload directory creation but before journal write leaves a discoverable safe orphan. | `tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts` | Vitest fault matrix; process-kill cases in Windows qualification | not-run | — |
| T02 | crash after primary journal only. | `tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts` | Vitest fault matrix; process-kill cases in Windows qualification | not-run | — |
| T03 | crash after mirror journal only. | `tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts` | Vitest fault matrix; process-kill cases in Windows qualification | not-run | — |
| T04 | crash before first target. | `tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts` | Vitest fault matrix; process-kill cases in Windows qualification | not-run | — |
| T05 | crash between two targets. | `tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts` | Vitest fault matrix; process-kill cases in Windows qualification | not-run | — |
| T06 | crash after target replacement displaced old file. | `tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts` | Vitest fault matrix; process-kill cases in Windows qualification | not-run | — |
| T07 | crash after all targets but before committed journal. | `tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts` | Vitest fault matrix; process-kill cases in Windows qualification | not-run | — |
| T08 | crash after committed journal but before cleanup. | `tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts` | Vitest fault matrix; process-kill cases in Windows qualification | not-run | — |
| T09 | second crash during recovery remains recoverable. | `tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts` | Vitest fault matrix; process-kill cases in Windows qualification | not-run | — |
| T10 | external edit during transaction is never overwritten. | `tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts` | Vitest fault matrix; process-kill cases in Windows qualification | not-run | — |
| T11 | duplicate normalized target paths fail before disk mutation. | `tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts` | Vitest fault matrix; process-kill cases in Windows qualification | not-run | — |
| T12 | unreadable primary with valid mirror recovers. | `tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts` | Vitest fault matrix; process-kill cases in Windows qualification | not-run | — |
| T13 | unreadable primary and mirror enters visible health state, not invisible permanent lock. | `tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts` | Vitest fault matrix; process-kill cases in Windows qualification | not-run | — |
| T14 | accept-current resolution preserves external content and unlocks writes. | `tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts` | Vitest fault matrix; process-kill cases in Windows qualification | not-run | — |
| T15 | apply-intended resolution requires preview and current CAS. | `tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts` | Vitest fault matrix; process-kill cases in Windows qualification | not-run | — |
| T16 | recovery/export actions never expose absolute paths or secrets. | `tests/server/transaction-recovery.test.ts`, `tests/api/library-health.test.ts` | Vitest fault matrix; process-kill cases in Windows qualification | not-run | — |
| L01 | a request reads and writes only one immutable context. | `tests/server/library-operation-context.test.ts`, `tests/api/library-context.test.ts` | Vitest/Supertest; disconnect and process cases in Windows qualification | not-run | — |
| L02 | switching waits for an active commit. | `tests/server/library-operation-context.test.ts`, `tests/api/library-context.test.ts` | Vitest/Supertest; disconnect and process cases in Windows qualification | not-run | — |
| L03 | a client disconnect aborts a cancellable scan but does not release its lease early. | `tests/server/library-operation-context.test.ts`, `tests/api/library-context.test.ts` | Vitest/Supertest; disconnect and process cases in Windows qualification | not-run | — |
| L04 | a disconnected non-cancellable commit finishes before lease release. | `tests/server/library-operation-context.test.ts`, `tests/api/library-context.test.ts` | Vitest/Supertest; disconnect and process cases in Windows qualification | not-run | — |
| L05 | a hung mutation produces a visible delayed-switch state. | `tests/server/library-operation-context.test.ts`, `tests/api/library-context.test.ts` | Vitest/Supertest; disconnect and process cases in Windows qualification | not-run | — |
| L06 | user cancels pending switch safely. | `tests/server/library-operation-context.test.ts`, `tests/api/library-context.test.ts` | Vitest/Supertest; disconnect and process cases in Windows qualification | not-run | — |
| L07 | server exclusive acquisition timeout returns structured `LIBRARY_BUSY`. | `tests/server/library-operation-context.test.ts`, `tests/api/library-context.test.ts` | Vitest/Supertest; disconnect and process cases in Windows qualification | not-run | — |
| L08 | concurrent switch requests remain serialized and identity headers match each body. | `tests/server/library-operation-context.test.ts`, `tests/api/library-context.test.ts` | Vitest/Supertest; disconnect and process cases in Windows qualification | not-run | — |
| L09 | stale responses from the previous library are rejected client-side. | `tests/server/library-operation-context.test.ts`, `tests/api/library-context.test.ts` | Vitest/Supertest; disconnect and process cases in Windows qualification | not-run | — |
| L10 | old-library drafts remain isolated and recoverable. | `tests/server/library-operation-context.test.ts`, `tests/api/library-context.test.ts` | Vitest/Supertest; disconnect and process cases in Windows qualification | not-run | — |
| L11 | app locator changes externally during a request cannot change transaction Vault ID. | `tests/server/library-operation-context.test.ts`, `tests/api/library-context.test.ts` | Vitest/Supertest; disconnect and process cases in Windows qualification | not-run | — |
| L12 | process restart preserves correct active library generation/identity. | `tests/server/library-operation-context.test.ts`, `tests/api/library-context.test.ts` | Vitest/Supertest; disconnect and process cases in Windows qualification | not-run | — |
| A01 | primary valid/mirror missing repairs mirror. | `tests/server/app-settings-recovery.test.ts` | Vitest fault boundaries; process-kill cases in Windows qualification | not-run | — |
| A02 | mirror valid/primary missing repairs primary. | `tests/server/app-settings-recovery.test.ts` | Vitest fault boundaries; process-kill cases in Windows qualification | not-run | — |
| A03 | copies disagree; newest valid monotonic revision wins. | `tests/server/app-settings-recovery.test.ts` | Vitest fault boundaries; process-kill cases in Windows qualification | not-run | — |
| A04 | process death during each replacement boundary retains at least one valid copy. | `tests/server/app-settings-recovery.test.ts` | Vitest fault boundaries; process-kill cases in Windows qualification | not-run | — |
| A05 | both corrupt produces recovery picker, not silent default-library switch. | `tests/server/app-settings-recovery.test.ts` | Vitest fault boundaries; process-kill cases in Windows qualification | not-run | — |
| A06 | recently known path is unavailable; UI explains and allows locate/retry. | `tests/server/app-settings-recovery.test.ts` | Vitest fault boundaries; process-kill cases in Windows qualification | not-run | — |
| A07 | root-relative/relative/UNC policy violations are rejected safely. | `tests/server/app-settings-recovery.test.ts` | Vitest fault boundaries; process-kill cases in Windows qualification | not-run | — |
| A08 | settings diagnostics remain bounded and do not accumulate indefinitely. | `tests/server/app-settings-recovery.test.ts` | Vitest fault boundaries; process-kill cases in Windows qualification | not-run | — |
| P01 | Markdown write succeeds while index rebuild fails; authoritative content remains. | `tests/server/index-service.test.ts`, `tests/api/verification.test.ts` | Vitest/Supertest | not-run | — |
| P02 | projection failure record includes attempts and timestamps. | `tests/server/index-service.test.ts`, `tests/api/verification.test.ts` | Vitest/Supertest | not-run | — |
| P03 | projection health remains visible even if its state file cannot be written. | `tests/server/index-service.test.ts`, `tests/api/verification.test.ts` | Vitest/Supertest | not-run | — |
| P04 | rebuild clears stale state only after success. | `tests/server/index-service.test.ts`, `tests/api/verification.test.ts` | Vitest/Supertest | not-run | — |
| P05 | corrupt evidence moves outside active directory and other records still load. | `tests/server/index-service.test.ts`, `tests/api/verification.test.ts` | Vitest/Supertest | not-run | — |
| P06 | malformed filenames produce diagnostics. | `tests/server/index-service.test.ts`, `tests/api/verification.test.ts` | Vitest/Supertest | not-run | — |
| P07 | quarantine files do not count toward active record limits. | `tests/server/index-service.test.ts`, `tests/api/verification.test.ts` | Vitest/Supertest | not-run | — |
| P08 | one oversized record does not crash the entire page. | `tests/server/index-service.test.ts`, `tests/api/verification.test.ts` | Vitest/Supertest | not-run | — |
| P09 | semantic array/item count limits reject pathological records. | `tests/server/index-service.test.ts`, `tests/api/verification.test.ts` | Vitest/Supertest | not-run | — |
| P10 | all scans honor deadline, total-byte, file-count and concurrency budgets. | `tests/server/index-service.test.ts`, `tests/api/verification.test.ts` | Vitest/Supertest | not-run | — |
| B01 | normal backup manifest and all hashes verify. | `tests/api/backup-restore.test.ts`, restore-drill report | Automated restore drill on clean Windows runner | not-run | — |
| B02 | source changes during backup fail safely. | `tests/api/backup-restore.test.ts`, restore-drill report | Automated restore drill on clean Windows runner | not-run | — |
| B03 | crash during copy is discovered and classified. | `tests/api/backup-restore.test.ts`, restore-drill report | Automated restore drill on clean Windows runner | not-run | — |
| B04 | crash after backup verified but before final rename can finalize safely. | `tests/api/backup-restore.test.ts`, restore-drill report | Automated restore drill on clean Windows runner | not-run | — |
| B05 | invalid partial is never treated as a backup. | `tests/api/backup-restore.test.ts`, restore-drill report | Automated restore drill on clean Windows runner | not-run | — |
| B06 | transfer manifest duplicate paths and malformed hashes are rejected. | `tests/api/backup-restore.test.ts`, restore-drill report | Automated restore drill on clean Windows runner | not-run | — |
| B07 | cleanup failure appears in health state. | `tests/api/backup-restore.test.ts`, restore-drill report | Automated restore drill on clean Windows runner | not-run | — |
| B08 | restore always targets a new location. | `tests/api/backup-restore.test.ts`, restore-drill report | Automated restore drill on clean Windows runner | not-run | — |
| B09 | restored library canonical files equal the source snapshot. | `tests/api/backup-restore.test.ts`, restore-drill report | Automated restore drill on clean Windows runner | not-run | — |
| B10 | restored library launches, writes a Chinese reading, creates a card and completes a review. | `tests/api/backup-restore.test.ts`, restore-drill report | Automated restore drill on clean Windows runner | not-run | — |
| B11 | migration resume works after a second process termination. | `tests/api/backup-restore.test.ts`, restore-drill report | Automated restore drill on clean Windows runner | not-run | — |
| B12 | backup/quarantine retention cleanup requires confirmation and preserves exportability. | `tests/api/backup-restore.test.ts`, restore-drill report | Automated restore drill on clean Windows runner | not-run | — |
| D01 | first launch reaches matching shell/sidecar identity. | source lifecycle tests plus Windows qualification report | GitHub Actions clean Windows runner required | not-run | — |
| D02 | native X safely stops app and process tree. | source lifecycle tests plus Windows qualification report | GitHub Actions clean Windows runner required | not-run | — |
| D03 | Ctrl+Q uses same close controller. | source lifecycle tests plus Windows qualification report | GitHub Actions clean Windows runner required | not-run | — |
| D04 | Settings Exit uses same close controller. | source lifecycle tests plus Windows qualification report | GitHub Actions clean Windows runner required | not-run | — |
| D05 | dirty close asks once; cancel remains open. | source lifecycle tests plus Windows qualification report | GitHub Actions clean Windows runner required | not-run | — |
| D06 | stop failure reports `stop-failed`, preserves handle and permits retry. | source lifecycle tests plus Windows qualification report | GitHub Actions clean Windows runner required | not-run | — |
| D07 | no duplicate Sidecar after failed restart. | source lifecycle tests plus Windows qualification report | GitHub Actions clean Windows runner required | not-run | — |
| D08 | force-exit command has explicit success/non-return contract. | source lifecycle tests plus Windows qualification report | GitHub Actions clean Windows runner required | not-run | — |
| D09 | parent death terminates full Sidecar process tree. | source lifecycle tests plus Windows qualification report | GitHub Actions clean Windows runner required | not-run | — |
| D10 | stale-generation crash events are ignored. | source lifecycle tests plus Windows qualification report | GitHub Actions clean Windows runner required | not-run | — |
| D11 | diagnostics redact protocol secret and absolute sensitive paths. | source lifecycle tests plus Windows qualification report | GitHub Actions clean Windows runner required | not-run | — |
| D12 | 0.1.4/0.1.5 predecessor upgrade preserves learning data. | source lifecycle tests plus Windows qualification report | GitHub Actions clean Windows runner required | not-run | — |
| D13 | uninstall preserves user learning library and removes app processes/binaries as documented. | source lifecycle tests plus Windows qualification report | GitHub Actions clean Windows runner required | not-run | — |
| D14 | reinstall and relaunch retain data and pass health checks. | source lifecycle tests plus Windows qualification report | GitHub Actions clean Windows runner required | not-run | — |
| C01 | pagination returns deterministic non-duplicated cards. | `tests/api/card-library.test.ts`, `tests/ui/card-library.test.tsx` | Vitest/Playwright; 10,000-card performance report | not-run | — |
| C02 | title/concept search is bounded and identity-scoped. | `tests/api/card-library.test.ts`, `tests/ui/card-library.test.tsx` | Vitest/Playwright; 10,000-card performance report | not-run | — |
| C03 | type/mastery/due filters combine correctly. | `tests/api/card-library.test.ts`, `tests/ui/card-library.test.tsx` | Vitest/Playwright; 10,000-card performance report | not-run | — |
| C04 | stale/degraded index displays recovery action without hiding authoritative cards already available. | `tests/api/card-library.test.ts`, `tests/ui/card-library.test.tsx` | Vitest/Playwright; 10,000-card performance report | not-run | — |
| C05 | deep link opens a non-recent card. | `tests/api/card-library.test.ts`, `tests/ui/card-library.test.tsx` | Vitest/Playwright; 10,000-card performance report | not-run | — |
| C06 | archive/update use current CAS. | `tests/api/card-library.test.ts`, `tests/ui/card-library.test.tsx` | Vitest/Playwright; 10,000-card performance report | not-run | — |
| C07 | keyboard and screen reader navigation pass. | `tests/api/card-library.test.ts`, `tests/ui/card-library.test.tsx` | Vitest/Playwright; 10,000-card performance report | not-run | — |
| C08 | 10,000-card synthetic library remains responsive within documented budgets. | `tests/api/card-library.test.ts`, `tests/ui/card-library.test.tsx` | Vitest/Playwright; 10,000-card performance report | not-run | — |
| C09 | no absolute path appears in normal UI. | `tests/api/card-library.test.ts`, `tests/ui/card-library.test.tsx` | Vitest/Playwright; 10,000-card performance report | not-run | — |
| C10 | Card Studio and Flywheel regressions remain green. | `tests/api/card-library.test.ts`, `tests/ui/card-library.test.tsx` | Vitest/Playwright; 10,000-card performance report | not-run | — |
| R01 | clean source tree and source ZIP audit. | CI, Windows qualification, release, and soak evidence | GitHub Actions or external clean-machine evidence required | not-run | — |
| R02 | deterministic version/identity across npm, Cargo, Tauri and manifest. | CI, Windows qualification, release, and soak evidence | GitHub Actions or external clean-machine evidence required | not-run | — |
| R03 | TypeScript typecheck. | CI, Windows qualification, release, and soak evidence | GitHub Actions or external clean-machine evidence required | not-run | — |
| R04 | all Vitest suites. | CI, Windows qualification, release, and soak evidence | GitHub Actions or external clean-machine evidence required | not-run | — |
| R05 | production Playwright suite. | CI, Windows qualification, release, and soak evidence | GitHub Actions or external clean-machine evidence required | not-run | — |
| R06 | Rust fmt/check/clippy/tests. | CI, Windows qualification, release, and soak evidence | GitHub Actions or external clean-machine evidence required | not-run | — |
| R07 | dependency audit, dependency review, secret scan and code scan. | CI, Windows qualification, release, and soak evidence | GitHub Actions or external clean-machine evidence required | not-run | — |
| R08 | reproducible desktop resource preparation. | CI, Windows qualification, release, and soak evidence | GitHub Actions or external clean-machine evidence required | not-run | — |
| R09 | signed installer and executable signature/timestamp verification. | CI, Windows qualification, release, and soak evidence | GitHub Actions or external clean-machine evidence required | not-run | — |
| R10 | first-install test on clean Windows user profile, including an offline clean image without preinstalled WebView2. | CI, Windows qualification, release, and soak evidence | GitHub Actions or external clean-machine evidence required | not-run | — |
| R11 | predecessor upgrade test. | CI, Windows qualification, release, and soak evidence | GitHub Actions or external clean-machine evidence required | not-run | — |
| R12 | native close/uninstall/reinstall residual-process test. | CI, Windows qualification, release, and soak evidence | GitHub Actions or external clean-machine evidence required | not-run | — |
| R13 | backup restore drill. | CI, Windows qualification, release, and soak evidence | GitHub Actions or external clean-machine evidence required | not-run | — |
| R14 | SBOM/checksum/provenance reconciliation. | CI, Windows qualification, release, and soak evidence | GitHub Actions or external clean-machine evidence required | not-run | — |
| R15 | 24-hour soak with periodic save/switch/review/backup and handle/memory/process telemetry. | CI, Windows qualification, release, and soak evidence | GitHub Actions or external clean-machine evidence required | not-run | — |
| R16 | immutable release assets can be downloaded and reverified after workflow artifacts expire. | CI, Windows qualification, release, and soak evidence | GitHub Actions or external clean-machine evidence required | not-run | — |
