# Large Markdown Document Implementation Report

## Outcome

Aleksi now treats imported Markdown as one logical document while using a versioned structural index for outline, search, incremental rendering, and bounded AI context. The former 1.9 MiB native/JSON path is no longer in the file-import or Reader critical path. The original file bytes remain authoritative and exact.

The same coordinated change also fixes inline Markdown AST handling inside ordered, unordered, mixed, and nested lists, and introduces a shared origin-aware return control for Diagnosis, card creation/edit/detail, Review, and Verification workflows entered from Reader. Reading document, active chunk, scroll, focus anchor, mode, and editable drafts are restored.

## Main implementation areas

- `shared/document-contract.ts` and `shared/document-limits.ts`: one versioned model and centralized budgets.
- `server/documents/*`: source validation, parser, UTF-8 byte/line mapping, structural segmentation, registry/index persistence, search, resumable import/replacement, AI context, summary planning, and unified service.
- `server/routes/document-imports.ts` and `server/routes/documents.ts`: bounded binary import and metadata/chunk/search/context/reindex/relink APIs.
- `src/features/reader/*`: preview-only selection, resumable upload with phase polling, descriptor/chunk Reader, virtual window, outline, search, relink, and context restoration.
- `src-tauri/src/runtime.rs` and `commands.rs`: opaque native file handles and bounded range reads.
- `src/markdown/MarkdownPlugins.ts`: AST-preserving list-item compatibility for bold punctuation immediately followed by Chinese text.

## Removed from the primary flow

- Browser full-file `arrayBuffer()` import.
- Complete source bodies returned from the Tauri file picker.
- JSON body upload for imported files.
- Reader dependence on `GET /api/readings/:id` and its complete `rawMarkdown` payload.
- Full-document React Query source caching and one-shot full DOM rendering.
- Route-specific return buttons and route-specific scroll restoration.

The bounded legacy reading-detail adapter remains for existing small-asset API consumers and archival compatibility. It is not a competing large-document architecture and delegates registered raw documents to the canonical document source.

## Tests and evidence

Automated coverage includes:

- headings, sparse-heading paragraph fallback, duplicate headings, offsets, lines, stable IDs, definitions, nested lists, code, math, tables, HTML blocks, front matter, and oversized blocks;
- exact multi-part import above the old limit, durable resume offsets across a UI remount, bounded staged-prefix revalidation before resume, rejection of a same-name/same-size different source, crash-idempotent canonical publication, source byte equality, hidden generated indexes, search of an unloaded final section, source-change reindex, missing-index rebuild, atomic replacement, invalid-stage rollback, missing-source metadata, and relink;
- AI budget margins, deduplication, render-only definition isolation, query/active priority, hierarchical summary dependencies, and explicit omission of indivisible over-budget blocks;
- a ten-chunk Reader that mounts at most the active chunk plus neighbors, remeasures delayed rendered content, keeps programmatic jumps stable until real scroll intent, and supports complete outline navigation and unloaded-section search;
- list inline rendering and source-aware return/draft/scroll/history behavior in UI and Playwright;
- browser large-document import/open/search with the application root preserved.

The reproducible Windows profile contains nine requested fixture classes. Notable current-machine results include:

- 3.15 MiB book-like fixture: 140.048 ms parsing, 37.658 ms segmentation, and 4.919 ms indexed search;
- 2.10 MiB sparse-heading fixture: 89.417 ms parsing, 20.343 ms segmentation, and 1.928 ms search;
- formula-heavy 0.52 MiB fixture: 278.346 ms parsing;
- table-heavy 0.13 MiB fixture: 7,164.424 ms parsing, identifying GFM table parsing as the dominant measured pathological case;
- the prior pipeline baseline is a hard failure above 1,900,000 native bytes / roughly 2 MiB JSON, so no honest old large-document open time exists.

These are observations from Node 22.14.0 on Windows x64, not universal targets. See [the exact JSON evidence](../evidence/large-document-profile.windows-x64.json).

## Migration and failure behavior

Existing readings are lazily registered without moving or rewriting them. Generated indexes are disposable; schema/parser mismatch, deletion, or corruption causes rebuild. Source modification invalidates the old hash and rebuilds. A missing source retains document metadata and exposes relink. An interrupted upload resumes at the durable file length only after every staged prefix block is compared with the reselected source; a mismatch stops the import without appending bytes. Invalid UTF-8 fails before publication or replacement.

## Remaining verified boundaries

- The local profile exercises document-core sources through 3.15 MiB and an oversized 1 MiB single block; the 128 MiB ceiling is a safety limit, not a locally proven interactive target.
- A single structural block larger than the selected AI budget is deliberately omitted rather than split; the context result is marked truncated.
- The table-heavy fixture is responsive in the WebView because parsing runs in the local sidecar, but its measured 7.164 s parse stage is still a performance hotspot.
- Relink currently accepts a verified Local Learning Library relative path; it does not expose an unrestricted native path to the renderer.
- Local TypeScript/API/UI verification can run here. Rust and the final installer are not built locally; their authoritative status must come from the GitHub Actions Windows qualification run.
- Cloud status is pending until the repository changes are explicitly authorized, pushed, and the workflows finish. No cloud success is claimed in this report.

## Verification snapshot — 2026-08-01

- Production build: passed (`tsc -b` and Vite, 2,228 modules); the existing bundle-size advisory remains.
- Production browser regression with installed Chrome: 9/9 passed. This includes the natural-duration entrance animation, reduced-motion and missing-asset fallbacks, large-document import/search with at most three mounted chunks, list inline Markdown, `Alt + Left`, the visible return control, exact scroll restoration, and draft restoration.
- Unfiltered Vitest with one test-file worker: 97/97 test files passed; 755 tests passed and one Windows symlink test was skipped because the OS denied symlink creation. No release-governance files were excluded.
- The verdict-race failure was traced to a ledger scan quarantining a live atomic-write `.tmp` artifact. A deterministic regression test now covers that boundary; the complete verification API file passed 14/14 and the 12-request race passed eight additional consecutive reruns before the full suite passed.
- The four release responsibilities are now separate: source CI, unsigned Windows qualification, scheduled archival health, and protected signed stable publication. Current `0.1.5-rc.1` remains honestly labeled `unsigned-preview`; the stable workflow is gated on the exact annotated `v1.0.0` tag, environment approval, signing secrets, closure evidence, and soak evidence.
- Final TypeScript typecheck, production build, and `git diff --check` passed. The source security scan covered 443 workspace source files with zero findings. The audited source candidate contains 505 entries and is approximately 9.32 MB.
- Local Rust formatting/compilation was not executed because `cargo` is not installed in this terminal. No local installer was built. Rust, installer, upgrade, restore, uninstall, manifest, and provenance gates remain assigned to the clean GitHub Actions Windows qualification run.
