# Aleksi Workbench V0.2 Visual Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement V0.2 Phase 6 so the app reads as a dark manuscript research room instead of a dark SaaS dashboard.

**Architecture:** Keep the existing route structure, components, data flow, and dark Aleksi token system. Make small, test-backed UI refinements in the shell, Reader, CardEditor, and Graph surfaces: warm paper only for reading content, horizontal-scan rail labels, solid ActionBand, four-step card learning flow, and gap tags in the graph detail panel.

**Tech Stack:** React, TypeScript, CSS modules-by-convention in `src/styles/*.css`, Testing Library, Vitest, Playwright.

---

### Task 1: Shell rail and ActionBand visual contract

**Files:**
- Modify: `src/components/NavigationRail.tsx`
- Modify: `src/components/ActionBand.tsx`
- Modify: `src/styles/workbench.css`
- Modify: `tests/ui/app-shell.test.tsx`
- Modify: `tests/ui/safety-accessibility.test.tsx`

- [x] Write failing tests that assert the navigation links keep their full accessible names while rendering two-digit numeric labels (`01` through `06`) and short horizontal Chinese labels.
- [x] Write a failing CSS contract test that `workbench.css` no longer contains `writing-mode: vertical-rl` or `backdrop-filter: blur`.
- [x] Update `NavigationRail` to render `aria-label={route.label}`, a two-digit index, and a short visual label derived from the route.
- [x] Update rail CSS so active state uses a clay left line and brighter text without vertical Chinese.
- [x] Update `ActionBand` so the third cell is the primary note-like action cell, with no glassmorphism blur.
- [x] Run `npm.cmd run test -- tests/ui/app-shell.test.tsx tests/ui/safety-accessibility.test.tsx`.

### Task 2: Reader warm paper surface

**Files:**
- Modify: `src/features/reader/ReaderPage.tsx`
- Modify: `src/styles/components.css`
- Modify: `tests/ui/reader.test.tsx`
- Modify: `tests/ui/app-shell.test.tsx`

- [x] Write failing tests that the rendered reading object has a `reader-paper` class and remains the only warm paper surface.
- [x] Write a failing CSS contract test for `.reader-paper` with warm paper background, dark ink text, Songti/Noto Serif/SimSun stack, rounded paper radius, and generous reading padding.
- [x] Add `reader-paper` to the reading article while keeping `data-testid="reader-surface"` and selection behavior unchanged.
- [x] Update reader CSS so sidebars remain dark desk panels and only `.reader-paper` becomes warm paper.
- [x] Run `npm.cmd run test -- tests/ui/reader.test.tsx tests/ui/app-shell.test.tsx`.

### Task 3: CardEditor four-step learning flow

**Files:**
- Modify: `src/features/cards/CardEditor.tsx`
- Modify: `src/styles/components.css`
- Modify: `tests/ui/card-diagnosis.test.tsx`

- [x] Write failing tests that a card draft renders the four visual steps: `鈶?鍘熸枃`, `鈶?鎴戠殑閲嶈堪`, `鈶?缁撴瀯鍖栧崱鐗嘸, `鈶?涓嬩竴姝ヨ鍔╜.
- [x] Write failing tests that the save button text remains the single primary action `淇濆瓨鍗＄墖`.
- [x] Wrap the existing source/excerpt fields in step 1, understanding in step 2, type-specific card fields in step 3, and next action/save area in step 4 without changing the submit payload.
- [x] Add restrained section styling: source as quote, understanding as manuscript input, card fields as formal sediment, next action as clay note.
- [x] Run `npm.cmd run test -- tests/ui/card-diagnosis.test.tsx`.

### Task 4: Graph detail gap tags

**Files:**
- Modify: `src/features/graph/WheelGraphPage.tsx`
- Modify: `src/styles/components.css`
- Modify: `tests/ui/review-graph.test.tsx`

- [x] Write failing tests that suggested actions render inside a `缂哄彛鏍囩` list rather than as plain decorative copy.
- [x] Render each suggested action as a small gap tag and keep the next minimum action in the detail panel.
- [x] Keep the graph read-only: no drag, zoom, manual edge creation, or persistent layout controls.
- [x] Run `npm.cmd run test -- tests/ui/review-graph.test.tsx`.

### Task 5: Verification and commit

**Commands:**
- `npm.cmd run test -- tests/ui/app-shell.test.tsx tests/ui/safety-accessibility.test.tsx tests/ui/reader.test.tsx tests/ui/card-diagnosis.test.tsx tests/ui/review-graph.test.tsx`
- `npm.cmd run verify`
- `npm.cmd run test:browser`
- `git diff --check`
- `git commit -m "style: refine v0.2 manuscript workbench"`

- [x] Confirm focused visual tests pass.
- [x] Confirm full verification passes.
- [x] Confirm browser smoke passes.
- [x] Commit only the visual-optimization files and this plan.
