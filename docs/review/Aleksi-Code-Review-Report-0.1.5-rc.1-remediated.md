# Aleksi Code Review Report — 0.1.5-rc.1 Remediated

Generated: 2026-08-08T10:14:02.379Z

## Summary

- Modules: 240
- Dependency edges: 767
- TypeScript/JavaScript functions: 1355
- Runtime dependency cycles: 0
- Weak dependency components: 25

## Hotspots after remediation

| Module | Lines | Functions | In | Out |
|---|---:|---:|---:|---:|
| `src/features/reader/ReaderPage.tsx` | 516 | 2 | 1 | 20 |
| `src/features/review/ReviewPage.tsx` | 679 | 6 | 1 | 13 |
| `server/services/index-service.ts` | 566 | 14 | 9 | 13 |
| `src-tauri/src/runtime.rs` | 1770 | 70 | 1 | 0 |
| `server/services/vault-service.ts` | 1088 | 39 | 6 | 10 |
| `src/features/verification/VerificationPage.tsx` | 614 | 2 | 1 | 10 |
| `src/features/reader/ReadingForm.tsx` | 651 | 14 | 1 | 7 |

## Highest in-degree

- `server/lib/path-safety.ts`: 35
- `server/persistence/library-context.ts`: 21
- `shared/card-types.ts`: 21
- `server/domain/schemas.ts`: 20
- `server/lib/error-code.ts`: 20
- `shared/document-contract.ts`: 18
- `server/lib/atomic-write.ts`: 17
- `src/lib/api-client.ts`: 17
- `server/http/async-route.ts`: 14
- `server/http/library-request.ts`: 14

## Highest out-degree

- `server/services/review-service.ts`: 21
- `src/features/reader/ReaderPage.tsx`: 20
- `server/app.ts`: 19
- `server/services/card-service.ts`: 19
- `server/services/reading-service.ts`: 19
- `server/documents/document-import-service.ts`: 18
- `src/app/App.tsx`: 17
- `server/services/graph-service.ts`: 16
- `src/features/cards/CardStudioPage.tsx`: 16
- `server/services/codex-task-service.ts`: 14

## Method boundary

The supplied baseline and this output both use source-resolved static module edges. The baseline did not identify its community algorithm, so this report uses deterministic weak components and does not present the community count as directly comparable. Function complexity remains available per node for TypeScript/JavaScript; Rust function complexity is intentionally not inferred by regex.
