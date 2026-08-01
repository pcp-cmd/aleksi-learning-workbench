# Aleksi Workbench V0.2 P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the V0.2 P0 blockers without starting the larger five-card migration or visual redesign.

**Architecture:** Keep the existing V0.1 structure. Normalize the example-card contract across frontend drafts, API schemas, Markdown serialization, and tests. Treat desktop packaging and launching as delivery boundaries with explicit verification instead of hidden generated state.

**Tech Stack:** React 19, TypeScript, Zod, Express, Vitest, Playwright, PowerShell launcher scripts.

---

## File Structure

- Modify `src/features/cards/card-draft.ts`: make example drafts use `whyItFits` and `trainingPurpose`.
- Modify `src/features/cards/CardEditor.tsx`: bind the example-card training textarea to `trainingPurpose`.
- Modify `server/domain/schemas.ts`: make example-card create/update/record schemas accept `whyItFits` and `trainingPurpose`.
- Modify `server/lib/markdown-codec.ts`: serialize and parse example cards using `whyItFits` and `trainingPurpose`.
- Modify tests under `tests/api`, `tests/server`, and `tests/ui`: cover the unified example-card fields.
- Modify `scripts/verify-desktop-package.ps1`: reject generated delivery files including `*.tsbuildinfo`, `node_modules`, and `dist` in package manifests.
- Add or modify a tracked launcher script for ready polling before browser open.
- Verify with focused tests, `npm run verify`, browser test, and desktop package verification.

---

### Task 1: Example-card contract regression

**Files:**
- Modify: `tests/ui/card-diagnosis.test.tsx`
- Modify: `tests/api/cards.test.ts`
- Modify: `tests/server/markdown-codec.test.ts`

- [x] **Step 1: Write failing UI regression**

Add a Card Studio test that seeds an example-card reader selection, fills:

```ts
whyItFits: "它满足定义中的约束。"
trainingPurpose: "训练我识别正例。"
```

and expects `POST /api/cards` to contain `whyItFits` and `trainingPurpose`, not `whyItFitsDefinition` or `trainsWhat`.

- [x] **Step 2: Run the focused UI test**

Run:

```powershell
npm.cmd run test -- tests/ui/card-diagnosis.test.tsx
```

Expected before implementation: FAIL because the draft still uses `trainsWhat`.

- [x] **Step 3: Write failing API/Markdown expectations**

Update example-card API and Markdown tests to use `whyItFits` and `trainingPurpose`.

- [x] **Step 4: Run focused server tests**

Run:

```powershell
npm.cmd run test -- tests/api/cards.test.ts tests/server/markdown-codec.test.ts
```

Expected before implementation: FAIL because schemas/codec still use `whyItFitsDefinition`.

---

### Task 2: Implement unified example-card fields

**Files:**
- Modify: `src/features/cards/card-draft.ts`
- Modify: `src/features/cards/CardEditor.tsx`
- Modify: `server/domain/schemas.ts`
- Modify: `server/lib/markdown-codec.ts`

- [x] **Step 1: Rename frontend draft field**

Use `trainingPurpose` in `ExampleCardDraft`, empty draft creation, and CardEditor textarea binding.

- [x] **Step 2: Rename backend schema field**

Use this shape:

```ts
const examplePayloadShape = {
  exampleContent: nonEmptyBodyStringSchema,
  whyItFits: nonEmptyBodyStringSchema,
  trainingPurpose: bodyStringSchema
};
```

- [x] **Step 3: Rename Markdown field**

Use this example-card format:

```ts
example: {
  h1Label: "例子卡",
  fields: [
    { key: "exampleContent", heading: "例子内容" },
    { key: "whyItFits", heading: "为什么它符合" },
    { key: "trainingPurpose", heading: "它训练我什么" }
  ]
}
```

- [x] **Step 4: Run focused tests until green**

Run:

```powershell
npm.cmd run test -- tests/ui/card-diagnosis.test.tsx tests/api/cards.test.ts tests/server/markdown-codec.test.ts
```

Expected after implementation: PASS.

---

### Task 3: Delivery package cleanup rule

**Files:**
- Modify: `scripts/verify-desktop-package.ps1`
- Test: use a temporary package copy or generated fixture directory.

- [x] **Step 1: Add exclusion check for generated file patterns**

Teach the verifier to reject package inventory entries ending in `.tsbuildinfo`, in addition to existing excluded directories.

- [x] **Step 2: Verify manifest inventory excludes generated files**

Run the desktop verifier after regenerating the package manifest. Expected package manifest files must not include `node_modules`, `dist`, or `*.tsbuildinfo`.

---

### Task 4: Launcher ready polling

**Files:**
- Add: `scripts/启动 Aleksi Workbench.cmd` or equivalent tracked launcher template.
- Modify: desktop package launcher during handoff.

- [x] **Step 1: Replace fixed sleep with condition polling**

Launcher behavior:

```bat
start powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-workbench.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "poll http://127.0.0.1:5173/ until HTTP 200"
start "" "http://127.0.0.1:5173/"
```

- [x] **Step 2: Failure behavior**

If the page is not ready before timeout, print a clear message and exit non-zero instead of opening a blank page.

---

### Task 5: Full verification and handoff

**Files:**
- Desktop package at `C:\Users\pcp\Desktop\aleksi-learning-workbench`

- [x] **Step 1: Run full repo verification**

Run:

```powershell
npm.cmd run verify
npm.cmd run test:browser
```

- [x] **Step 2: Commit source changes**

Run:

```powershell
git add <changed files>
git commit -m "fix: resolve v0.2 p0 workbench blockers"
```

- [x] **Step 3: Sync desktop package and verify**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\pcp\Desktop\aleksi-learning-workbench\scripts\verify-desktop-package.ps1" -Path "C:\Users\pcp\Desktop\aleksi-learning-workbench"
```

Expected: `Desktop package verification passed.`
