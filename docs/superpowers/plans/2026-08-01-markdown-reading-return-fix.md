# Markdown Rendering and Reading Return Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the unified Markdown pipeline structurally correct for formatted list items and make every workflow launched from Intensive Reading provide a context-aware, draft-safe return to the same material and reading position.

**Architecture:** Continue rendering reading bodies through `MarkdownRenderer`/`react-markdown`; add regression coverage at that public component boundary instead of adding a parser. Introduce one validated React Router return-context model and one shared return control. Reader captures its existing persisted material/scroll state before navigation, passes it through route state, and downstream card, review, diagnosis, and verification transitions forward the same context. Reader remains the single scroll-restoration owner.

**Tech Stack:** React 19, React Router 7, React Markdown 10, remark-gfm, Vitest, Testing Library, Playwright, TypeScript, existing CSS tokens and draft-store infrastructure.

---

### Task 1: Lock down Markdown structure

**Files:**
- Modify: `tests/ui/reader.test.tsx`
- Verify: `src/markdown/MarkdownRenderer.tsx`
- Verify: `src/markdown/MarkdownComponents.tsx`
- Verify: `src/markdown/MarkdownPlugins.ts`

- [ ] Add one regression test containing paragraph bold, ordered/unordered/nested/mixed lists, inline code, links, emphasis, a paragraph inside a list item, table, heading, blockquote, and fenced code.
- [ ] Assert semantic DOM (`ol`, `ul`, `li`, `strong`, `em`, `code`, `a`) rather than only text content.
- [ ] Run the focused test and record whether the current unified renderer already preserves AST children.
- [ ] If the test fails, trace the exact AST-to-React conversion and change only the responsible shared component/plugin. Do not normalize source Markdown or add a parser.

### Task 2: Add a validated shared return context

**Files:**
- Create: `src/app/navigation-return.ts`
- Create: `src/components/ContextualReturnControl.tsx`
- Modify: `src/styles/components.css`
- Test: `tests/ui/navigation-return.test.tsx`

- [ ] Define a bounded discriminated context for reading and ordinary route origins, including a sanitized destination and optional reading material, scroll, anchor, focus excerpt, and mode fields.
- [ ] Add helpers that read context from React Router state, forward it to downstream transitions, and create a safe route-origin fallback where required.
- [ ] Build one keyboard-focusable shared control with destination-specific Chinese text and existing theme tokens.
- [ ] Test valid reading/card origins, malformed state rejection, safe fallback, click navigation, and accessible name.

### Task 3: Capture and restore Reader context

**Files:**
- Modify: `src/features/reader/ReaderPage.tsx`
- Modify: `src/features/reader/reader-draft-store.ts`
- Test: `tests/ui/reader.test.tsx`

- [ ] Capture `selectedReadingId`, current reader scroll, current selection excerpt, nearest section anchor when available, and reading mode before leaving Reader.
- [ ] Persist the material and scroll using the existing reader draft store before each card/diagnosis navigation.
- [ ] Pass the shared reading return context on both direct selection and excerpt-basket transitions.
- [ ] On Reader mount, prioritize the explicit requested material and restore scroll after content layout; focus the restored section or reader surface without stealing normal direct-entry focus.
- [ ] Test same-material and non-zero-scroll restoration through both explicit return and browser history.

### Task 4: Cover editable and derived workflows

**Files:**
- Modify: `src/features/diagnosis/DiagnosisPage.tsx`
- Modify: `src/features/cards/CardStudioPage.tsx`
- Modify: `src/features/review/ReviewPage.tsx`
- Modify: `src/features/verification/VerificationPage.tsx`
- Test: `tests/ui/card-diagnosis.test.tsx`
- Test: `tests/ui/review-graph.test.tsx`
- Test: `tests/ui/verification.test.tsx`

- [ ] Render the shared return control above each relevant page title when a valid origin exists.
- [ ] Preserve the Reader origin across card create, save, preview, edit, review, verification, and diagnosis transitions.
- [ ] When verification/diagnosis is opened from the card or review workflow without Reader context, return to that real origin instead of Reader.
- [ ] Confirm Diagnosis and Card Studio keep using their existing per-library draft stores; add regression checks that returning and reopening restores input.
- [ ] Confirm browser/Alt+Left navigation uses pushed entries and does not replace the origin entry.

### Task 5: Verify the complete loop

**Files:**
- Modify or create: `tests/browser/reading-return.spec.ts`

- [ ] Add a production-browser flow: open material, set non-zero scroll, launch Diagnosis, type, return, assert same material/scroll, reopen, assert draft.
- [ ] Repeat representative flows for card creation, card detail/edit, verification, and card-library origin.
- [ ] Run focused UI tests, TypeScript checks, production build, and browser tests.
- [ ] Inspect the rendered control and reading list formatting at desktop and narrow viewport sizes.
- [ ] Record verified results and any environment-limited checks without claiming installer qualification.
