# Large Markdown Document Pipeline

## Confirmed pre-change failure chain

The former limit was not one constant. A file selected in the browser was read with `File.arrayBuffer()`, the Tauri picker returned the complete body over IPC, the reading API accepted a roughly 2 MiB JSON body, the reading service materialized the complete source again, React Query cached it, and `ReactMarkdown` parsed and mounted it as one component tree. Raising only the HTTP limit would therefore have moved the failure to IPC, memory, parsing, caching, or DOM rendering.

The compatibility reading API remains for small, front-matter-based legacy assets and internal snapshot consumers. It is not used by Reader navigation or large-file import. Both compatibility and large-document paths now resolve the same canonical source and document registry; there is no second large-document parser or section model.

## Canonical model

A learning material remains one user-visible source file. Its bytes are never normalized, decorated with front matter, or split into visible files during file import.

```text
01-阅读材料/<canonical source>.md       user-created, authoritative
.aleksi/document-registry.json          authoritative source-to-document mapping
.aleksi/documents/<document-id>.json    generated, versioned, disposable index
.aleksi/document-imports/*              durable resumable staging and recovery state
```

`documentId` and `readingId` identify the logical material. A generated index records the source hash, cheap file version, parser/index versions, outline, structural chunks, byte offsets, line ranges, searchable plain text, complexity metrics, and diagnostics. The raw source is never copied into the index.

## Import and replacement

The browser and Tauri picker read only a 64 KiB preview. Import then uploads exact 512 KiB binary parts at explicit durable offsets. The service fsyncs each part, persists the received byte count, validates UTF-8 and NUL safety before publishing, and hard-links the staged bytes into the canonical location. A retry obtains the durable offset from the session and resumes without replaying accepted bytes.

Tauri returns a random opaque handle, file name, byte size, and preview. The renderer can request only a bounded range from that handle; it never receives a native path or the full source in one IPC response.

Replacement uses an expected source version. The staged source is validated before the old source moves. The old file is retained as a recovery backup until the new source, generated index, registry, and global projection are ready. A failed validation leaves the old bytes untouched; an interrupted move is reconciled from the session-specific incoming and backup files.

## Parsing and segmentation

One `unified` pipeline uses `remark-parse`, `remark-gfm`, and `remark-math`. Top-level Markdown AST blocks are the indivisible segmentation unit. Headings start semantic sections; sparse-heading documents fall back to paragraph and other block boundaries. Code, math, tables, lists, blockquotes, HTML blocks, definitions, and a single oversized block are never cut by character count.

Ordinary chunks target 32 KiB so they fit inside the default AI budget after its safety margin. The 64 KiB soft boundary can be exceeded only to preserve one structural block; such chunks are marked `oversized`. Chunk identity combines document identity, heading path, and content hash, with a collision occurrence for exact duplicates. Source offsets are UTF-8 bytes; line positions remain one-based.

## Reader, outline, and search

Reader first requests a metadata-only descriptor. It mounts the active chunk and one neighbor on each side, with estimated/measured spacers for the rest. Natural window scrolling, outline clicks, and search results all update the same active-chunk window. A failed chunk has a local retry control and does not take down the rest of the document.

The full outline and exact-search corpus come from the generated index, so they cover unloaded sections. Chunk content is read by source byte range and passed through the established `MarkdownRenderer`; list inline formatting, tables, KaTeX, links, code blocks, and image URL controls are therefore shared with short documents.

## AI and full-document summaries

All document AI context selection goes through `planAIContextChunks` and `buildAIContextBundle`. Priority is: selected range, active section, query matches, then neighbors. Candidate chunk IDs are deduplicated, a centralized budget and 15% safety margin are applied, and only complete structural chunks are returned. No provider call or automatic upload was added.

Full-document work produces a source-hash-bound dependency plan: section batches feed chapter batches, which feed one document batch. This is a local planning contract for the existing manual/offline AI boundary, not a hidden remote summarization service.

## Staleness, migration, and recovery

Opening first compares byte size, mtime, and inode. A match reuses the generated index without hashing or parsing. A mismatch hashes the source; unchanged bytes refresh only the cheap version, while changed bytes rebuild the index atomically. Missing or invalid generated indexes rebuild from the canonical source.

Legacy readings are registered lazily on first document access, keep their IDs and paths, and then use the unified descriptor/chunk service. Missing sources retain registry metadata and return `DOCUMENT_SOURCE_UNAVAILABLE`; the Reader offers an explicit relative-path relink flow inside `01-阅读材料`.

Incomplete staging never has `ready` status. Generated JSON is written atomically. Canonical-source absence, invalid encoding, oversized sources, stale replacement versions, and invalid relink targets have distinct service errors. The source safety ceiling is 128 MiB; it is a defensive boundary, not the segmentation mechanism.

## Verification boundaries

The checked-in Windows profile is [large-document-profile.windows-x64.json](../evidence/large-document-profile.windows-x64.json). It deliberately records both the former hard-limit failure and final document-core measurements. UI DOM bounds, list rendering, return navigation, large-document search, and application-root preservation are asserted separately in UI and Playwright tests.

Rust compilation and the formal Tauri/NSIS installer remain cloud qualifications. The source workflow and Windows qualification workflow run the document profile; the Windows workflow also performs `cargo fmt`, `cargo check`, Clippy, Rust tests, production browser tests, installer packaging, install/upgrade/close, uninstall/reinstall, hash, and provenance checks.
