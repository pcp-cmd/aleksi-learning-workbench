# Aleksi Workbench V0.2 Excerpt Basket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement V0.2 Phase 4 so the reader becomes a deep-reading workbench with an excerpt basket, and basket excerpts can become cards or diagnoses.

**Architecture:** Keep this slice frontend-local and reuse the existing `aleksi.readerSelection` handoff contract for downstream card/diagnosis pages. Add a small excerpt-basket data object in the reader feature, store basket items in React state, and convert basket items into the same selection payload currently produced from an immediate text selection.

**Tech Stack:** React, React Router, TanStack Query, sessionStorage handoff, Vitest/jsdom, Playwright smoke coverage.

---

### Task 1: Reader rename

**Files:**
- Modify: `src/app/routes.tsx`
- Modify: `src/features/reader/ReaderPage.tsx`
- Test: `tests/ui/reader.test.tsx`
- Test: `tests/ui/app-shell.test.tsx`
- Test: `tests/ui/safety-accessibility.test.tsx`
- Test: `tests/browser/epsilon-n-flow.spec.ts`

- [x] Write tests expecting `精读工作台` instead of `数学阅读器`.
- [x] Update the route label, reader heading, empty/help text, and existing test navigation labels.
- [x] Run focused reader tests and browser smoke after implementation.

### Task 2: Excerpt basket data object and add action

**Files:**
- Create: `src/features/reader/excerpt-basket.ts`
- Modify: `src/features/reader/selection.ts`
- Modify: `src/features/reader/ReaderPage.tsx`
- Test: `tests/ui/reader.test.tsx`

- [x] Add a failing test that selects text, clicks `加入摘录篮`, and sees a basket item with the selected excerpt, source path, concept, and action buttons.
- [x] Add an `ExcerptBasketItem` type with `id`, `sourceReadingId`, `sourcePath`, `concept`, `excerptText`, and `createdAt`.
- [x] Add a selection action for `加入摘录篮`.
- [x] Keep the basket in reader state for this V0.2 slice.

### Task 3: Excerpt-to-card and excerpt-to-diagnosis

**Files:**
- Modify: `src/features/reader/ReaderPage.tsx`
- Test: `tests/ui/reader.test.tsx`

- [x] Add failing tests that click basket item actions and assert the existing `aleksi.readerSelection` payload is written with the basket excerpt.
- [x] Implement basket item conversion by reusing the existing selection payload shape.
- [x] Keep direct selection-to-card/diagnosis actions working.

### Task 4: Verification and commit

**Commands:**
- `npm.cmd run test -- tests/ui/reader.test.tsx tests/ui/app-shell.test.tsx tests/ui/safety-accessibility.test.tsx`
- `npm.cmd run verify`
- `npm.cmd run test:browser`
- `git diff --check`
- `git commit -m "feat: add reader excerpt basket"`

- [x] Confirm focused tests pass.
- [x] Confirm full verification passes.
- [x] Confirm browser smoke passes.
- [x] Commit only the relevant files.
