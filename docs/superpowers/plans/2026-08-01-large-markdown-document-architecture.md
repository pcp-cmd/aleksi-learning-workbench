# Large Markdown Document Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user import and read one complete Markdown source of practical book size without manual splitting, while preserving the exact canonical bytes and providing full outline, search, bounded AI context, safe reindexing, and short-document compatibility through one document service.

**Architecture:** Keep user Markdown authoritative. Add an authoritative document registry for identity and source metadata, plus versioned and rebuildable per-document projections under `.aleksi/documents/`. A single server-side AST pass produces structural chunks, outline, complexity, search text, offsets, and hashes. Browser and Tauri imports share resumable fixed-size upload sessions; Tauri exposes only a user-selected opaque file handle and bounded reads. Reader, search, outline, AI context, and summary planning consume the same document API. Reader renders an active chunk window rather than a whole source string. Existing frontmatter readings are registered lazily and migrate without source mutation.

**Tech Stack:** Node 22, Express 5, TypeScript 5.8, unified 11 / remark-parse 11 with the existing remark-gfm and remark-math extensions, React 19, TanStack Query 5, React Markdown 10, Tauri 2/Rust, Vitest, Testing Library, Playwright, existing Vault transactions and atomic-write primitives.

---

### Task 1: Preserve a reproducible audit and baseline

**Files:**
- Create: `docs/current/LARGE_MARKDOWN_PIPELINE_AUDIT.md`
- Create: `scripts/generate-large-markdown-fixtures.mts`
- Create: `scripts/profile-large-markdown.mts`
- Create: `tests/fixtures/large-markdown/README.md`
- Modify: `package.json`

- [ ] Record every current whole-string boundary: browser decode, form state, JSON serialization, Express parser, bounded file read, Tauri IPC, API response, query cache, React Markdown parse, and full DOM.
- [ ] Record the 1.9 MiB request/source and 2 MiB response limits as symptoms, not the root architecture.
- [ ] Generate deterministic short, medium, book-like, formula-heavy, code-heavy, table-heavy, low-heading, malformed, and oversized-single-block fixtures outside Git history during profiling.
- [ ] Measure current validation failure, read/parse/render work, and memory/DOM indicators using the same fixture seeds used after the change.
- [ ] Save machine/runtime metadata and measured values; never substitute invented targets.

### Task 2: Define one versioned document contract and centralized limits

**Files:**
- Create: `shared/document-contract.ts`
- Create: `shared/document-limits.ts`
- Modify: `shared/vault-map.ts`
- Modify: `docs/DATA_SCHEMA.md`
- Test: `tests/server/document-contract.test.ts`

- [ ] Define stable document, chunk, outline, complexity, source-version, search-result, processing-status, AI-context, and summary-plan types.
- [ ] Define parser/index/registry schema versions and named upload, chunk, window, token, search, and complexity thresholds in one module.
- [ ] Specify UTF-8 byte offsets and one-based source lines unambiguously.
- [ ] Add `.aleksi/document-registry.json`, `.aleksi/documents/`, and `.aleksi/document-imports/` to the Vault contract, distinguishing authoritative registry metadata from rebuildable projections and temporary sessions.
- [ ] Add strict runtime schemas for persisted JSON and reject partial/unknown ready indexes.

### Task 3: Parse once and segment safely by Markdown structure

**Files:**
- Create: `server/documents/markdown-document-parser.ts`
- Create: `server/documents/document-segmenter.ts`
- Create: `server/documents/source-offset-map.ts`
- Create: `server/documents/document-text.ts`
- Test: `tests/server/document-segmenter.test.ts`

- [ ] Use unified/remark-parse with existing GFM and math extensions; use gray-matter only to locate existing frontmatter without mutating it.
- [ ] Traverse the one AST to derive counts, headings, definitions, structural blocks, text, and segmentation candidates.
- [ ] Convert sorted UTF-16 AST offsets to UTF-8 byte offsets in one linear pass and preserve one-based line ranges.
- [ ] Prefer heading boundaries, then complete top-level semantic blocks, and use size only to choose among valid boundaries.
- [ ] Never split code, math, table, HTML, frontmatter, list, blockquote, link, inline formatting, or custom blocks.
- [ ] Mark oversized indivisible blocks and keep them valid.
- [ ] Generate content/context-derived stable IDs so unrelated earlier insertions do not renumber unchanged sections.
- [ ] Preserve reference definitions for rendering without duplicating them in search or AI content.

### Task 4: Persist an authoritative registry and rebuildable projections safely

**Files:**
- Create: `server/documents/document-registry.ts`
- Create: `server/documents/document-index-store.ts`
- Create: `server/documents/document-source.ts`
- Modify: `server/lib/atomic-write.ts`
- Modify: `server/services/index-service.ts`
- Test: `tests/server/document-index-store.test.ts`
- Test: `tests/server/document-registry.test.ts`

- [ ] Persist identity/title/concept/source path/source kind in the registry with atomic writes and Vault-ID-bound operations.
- [ ] Persist one per-document projection containing metadata, outline, chunk metadata, search text, versions, hash, source version, diagnostics, and status.
- [ ] Write processing output to a sibling temporary file and expose it as ready only after schema validation and atomic replacement.
- [ ] Detect missing/corrupt/processing/old-version projections and rebuild from canonical source.
- [ ] Use size/mtime/inode as a cheap unchanged check and stream SHA-256 when the version changes.
- [ ] Mark missing sources unavailable without deleting registry, projection, cards, diagnoses, or reviews.
- [ ] Merge registered raw-source readings into the existing global index without reporting them as malformed frontmatter assets or showing generated chunks.

### Task 5: Add resumable exact-byte imports shared by browser and desktop

**Files:**
- Create: `server/documents/document-import-service.ts`
- Create: `server/routes/document-imports.ts`
- Modify: `server/app.ts`
- Modify: `src/lib/api-client.ts`
- Modify: `src/features/reader/reading-import.ts`
- Modify: `src/features/reader/ReadingForm.tsx`
- Modify: `src/features/reader/reading-import-draft-store.ts`
- Modify: `src/desktop/runtime.ts`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `tests/api/document-import.test.ts`
- Test: `tests/ui/reading-import.test.tsx`
- Test: Rust tests in `src-tauri/src/commands.rs`

- [ ] Create an import session from validated metadata, expected byte size, and file name.
- [ ] Upload fixed-size `application/octet-stream` parts at an exact expected offset and expose durable received-byte progress.
- [ ] Reconcile session metadata with the staged file after interruption and allow same-file resume.
- [ ] Validate UTF-8 incrementally, reject NUL/corrupt input clearly, hash exact bytes, parse/index the staged source, then atomically move it into the visible reading directory without rewriting line endings, BOM, frontmatter, or content.
- [ ] Keep failed/incomplete sessions retryable and prevent any incomplete source/index from appearing ready.
- [ ] In browser mode, upload `File.slice()` parts without `arrayBuffer()` for the whole file or putting full content in React state/localStorage.
- [ ] In Tauri, return an opaque selected-file handle plus bounded preview and read only bounded chunks; never expose an arbitrary filesystem-read command.
- [ ] Show upload percentage and ordinary-language stages: reading material, analyzing structure, preparing sections, building search index, ready.
- [ ] Keep manual paste on the same final document-indexing path while preserving its existing draft and conflict behavior.

### Task 6: Consolidate metadata, chunk, outline, search, and reindex APIs

**Files:**
- Create: `server/documents/document-service.ts`
- Create: `server/documents/document-search.ts`
- Create: `server/routes/documents.ts`
- Modify: `server/app.ts`
- Modify: `server/services/reading-service.ts`
- Modify: `server/services/card-service.ts`
- Modify: `src/app/query-keys.ts`
- Test: `tests/api/documents.test.ts`

- [ ] Register existing frontmatter readings lazily with the same reading ID/path and build their first projection without source changes.
- [ ] Return a bounded descriptor containing complete outline/chunk metadata but not full Markdown or search text.
- [ ] Return chunk Markdown through a bounded text response read from canonical byte ranges; append only required render definitions.
- [ ] Return active, previous, and next chunk metadata without reparsing.
- [ ] Search all indexed chunks, including unloaded ones, with exact/heading matches, previews, source offsets/lines, scores, and stable chunk IDs.
- [ ] Navigate duplicate headings by node ID/chunk ID rather than text.
- [ ] Rebuild stale indexes and expose ready/stale/failed/unavailable states with retry actions.
- [ ] Move frontend metadata reads off the legacy whole-document JSON response; keep only an internal compatibility snapshot while dependent server operations migrate.
- [ ] Resolve cards' reading ID/path through the shared registry/document service as well as legacy index entries.

### Task 7: Render a coherent bounded Reader window

**Files:**
- Create: `src/features/reader/document-api.ts`
- Create: `src/features/reader/DocumentReader.tsx`
- Create: `src/features/reader/DocumentOutline.tsx`
- Create: `src/features/reader/DocumentSearch.tsx`
- Modify: `src/features/reader/ReaderPage.tsx`
- Modify: `src/features/reader/reader-return.ts`
- Modify: `src/features/reader/selection.ts`
- Modify: `src/features/reader/reader.css`
- Test: `tests/ui/document-reader.test.tsx`
- Test: `tests/ui/reader.test.tsx`

- [ ] Fetch one descriptor and the active chunk plus configured neighbors; never place a full large source/AST in query cache or React state.
- [ ] Render chunks with the existing `MarkdownRenderer`, GFM/math/plugins, image resolver, and sanitization path.
- [ ] Advance the active window at boundary sentinels, unload distant chunks, and compensate scroll height so reading remains coherent.
- [ ] Preserve selection/copy, native links, math, code, tables, anchors, accessibility, and card/diagnosis excerpt transfer.
- [ ] Generate the full outline from document metadata; clicking an item loads/focuses its chunk without reparsing.
- [ ] Search across unloaded chunks and load/focus/highlight the selected result.
- [ ] Restore the same document, chunk/section, excerpt focus, and scroll context through the shared return mechanism and browser history.
- [ ] Isolate a failed/oversized rendered chunk and provide retry/copy access without crashing the Library.

### Task 8: Centralize bounded AI context and hierarchical summary planning

**Files:**
- Create: `server/documents/ai-context-builder.ts`
- Create: `server/documents/document-summary-plan.ts`
- Modify: `server/routes/documents.ts`
- Modify: `docs/current/PRODUCT_DECISIONS.md`
- Test: `tests/server/ai-context-builder.test.ts`
- Test: `tests/api/document-ai-context.test.ts`

- [ ] Define named model-budget profiles and safety margins without assuming one universal context window.
- [ ] Select unique structural chunks by selection, active chunk, ancestors, neighbors, exact search relevance, and action mode.
- [ ] Stop only at structural boundaries, preserve heading/source provenance, and report truncation/retrieval reasons.
- [ ] Produce section/chapter/document summary batches with stable input hashes, inclusion tracking, and retryable partial status.
- [ ] Keep the offline boundary: expose local prompt/context bundles for manual export/import and never add automatic provider calls, accounts, telemetry, MCP, webhooks, or uploads.

### Task 9: Prove migration, recovery, and performance

**Files:**
- Create: `tests/integration/document-lifecycle.test.ts`
- Create: `tests/browser/large-markdown-document.spec.ts`
- Modify: `tests/browser/reading-return.spec.ts`
- Modify: `tests/server/architecture-boundaries.test.ts`
- Modify: `scripts/profile-large-markdown.mts`
- Create: `docs/current/LARGE_MARKDOWN_PERFORMANCE.md`

- [ ] Cover import/parse/index/open, search/navigation, outline navigation, reopen, stale detection/rebuild, failed retry, missing source, interrupted upload/processing, bounded AI context, and summary planning.
- [ ] Cover exact canonical byte equality and confirm no chunk files appear in the visible Local Learning Library.
- [ ] Cover short, medium, large, formula, code, table, low-heading, malformed, and oversized-block fixtures.
- [ ] Cover incremental DOM bounds, search across unloaded chunks, section focus, return-scroll restoration, drafts, and app-level remount absence in a production browser build.
- [ ] Run the same profiling script and record baseline/final read, parse, segmentation, index, initial-open, navigation, search, memory, DOM, and context-building results.
- [ ] State environmental limits honestly; desktop-installed behavior remains unverified until the cloud workflow completes.

### Task 10: Remove permanent whole-document frontend paths and qualify in GitHub Actions

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/windows-qualification.yml`
- Modify: `docs/current/PROJECT_MAP.md`
- Modify: `docs/current/CURRENT_CONTRACT.md`
- Create: `docs/current/LARGE_MARKDOWN_IMPLEMENTATION_REPORT.md`

- [ ] Add deterministic large-document unit/integration/browser/performance-smoke gates without committing giant generated fixtures.
- [ ] Remove the frontend full-source detail path, legacy file-size rejection wording, duplicated outline/search loading, and obsolete Tauri whole-body IPC.
- [ ] Retain a narrowly documented internal canonical-snapshot adapter only where a server transaction requires a frozen evidence hash; route it through document source service.
- [ ] Run typecheck, architecture, Vitest, production Playwright, source security, source package audit, Rust format/check/clippy/test, and local non-installer build checks.
- [ ] Review the exact diff and commit only the coordinated document/reading work, excluding unrelated pre-existing release work unless it is an explicit dependency.
- [ ] After fresh user authorization, push the reviewed commit and trigger Source CI plus Windows qualification; use GitHub Actions for the final Tauri/NSIS installer.
- [ ] Record workflow URLs/conclusions/artifact identity and distinguish passing source checks from installed-desktop qualification.
- [ ] Deliver the audit, changed files, decisions, removed paths, tests, performance comparison, migration/recovery behavior, limitations, and cloud build status.
