# Aleksi Workbench V0.2 Generic Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the card system from math-only four-card assumptions toward the V0.2 five generic learning card types while preserving existing V0.1 cards.

**Architecture:** Add the V0.2 generic types as first-class card types without deleting legacy `definition`, `counterexample`, and `proof` support in the same slice. Server schema, Markdown codec, card directories, index, and review queue become type-list driven. UI and graph conversion happen in later slices after the backend contract is verified.

**Tech Stack:** TypeScript, Zod, Express, canonical Markdown codec, Vitest, Supertest.

---

## Scope

This slice implements:

- generic card API create/save for `concept`, `example`, `boundary`, `process`, `mistake`;
- canonical Markdown serialize/parse for those five types;
- index/review inclusion for the five generic types;
- compatibility with existing legacy cards.

This slice does not implement:

- full CardEditor visual redesign;
- graph coverage conversion;
- excerpt basket;
- active-recall review UI.

---

### Task 1: Red tests for generic server contract

**Files:**
- Modify: `tests/api/cards.test.ts`
- Modify: `tests/api/review.test.ts`
- Modify: `tests/server/markdown-codec.test.ts`

- [x] **Step 1: Add generic-card create inputs**

Define create payloads for:

```ts
concept: {
  type: "concept",
  formalExplanation: "A concept is...",
  myUnderstanding: "In my words...",
  commonMisunderstanding: "Not the same as...",
  usageContext: "Use it when..."
}

example: {
  type: "example",
  exampleContent: "Concrete example...",
  whyItFits: "It matches because...",
  trainingPurpose: "It trains recognition."
}

boundary: {
  type: "boundary",
  confusingObjects: "A and B",
  similarity: "They both...",
  keyDifference: "Only A...",
  judgementRule: "Check..."
}

process: {
  type: "process",
  task: "Do the thing",
  steps: "1. ...",
  keyTurn: "The turning point...",
  pitfall: "Common failure...",
  usageContext: "Use it when..."
}

mistake: {
  type: "mistake",
  mistake: "I did...",
  originalThinking: "I thought...",
  realCause: "Actually...",
  correctMethod: "Next time...",
  recognitionSignal: "I can spot it when..."
}
```

- [x] **Step 2: Verify API red**

Run:

```powershell
npm.cmd run test -- tests/api/cards.test.ts
```

Expected before implementation: FAIL because new card types are rejected.

- [x] **Step 3: Add review queue red**

Create one due `mistake` card fixture and assert `/api/review/today` includes `cardType: "mistake"`.

Expected before implementation: FAIL because review scans only old card types.

---

### Task 2: Implement backend generic card contract

**Files:**
- Modify: `server/domain/schemas.ts`
- Modify: `server/domain/types.ts`
- Modify: `server/lib/markdown-codec.ts`
- Modify: `server/services/card-service.ts`
- Modify: `server/services/index-service.ts`
- Modify: `server/services/review-service.ts`

- [x] **Step 1: Extend `cardTypeSchema`**

Accept these canonical V0.2 card types:

```ts
"concept" | "example" | "boundary" | "process" | "mistake"
```

Keep legacy values:

```ts
"definition" | "counterexample" | "proof"
```

- [x] **Step 2: Add payload shapes**

Add `conceptPayloadShape`, `boundaryPayloadShape`, `processPayloadShape`, and `mistakePayloadShape`.

- [x] **Step 3: Add create/update/record schemas**

Add schemas to `cardCreateInputSchemas`, `cardUpdateInputSchemas`, and `cardRecordSchemas`.

- [x] **Step 4: Add Markdown formats**

Add H1 labels and sections:

```ts
concept: "概念卡"
boundary: "边界卡"
process: "流程卡"
mistake: "错误卡"
```

- [x] **Step 5: Add directories**

Use stable local Vault directories:

```ts
concept: "02-概念卡"
example: "03-例子卡"
boundary: "04-边界卡"
process: "05-流程卡"
mistake: "06-错误卡"
```

Keep legacy directories for reading existing files.

- [x] **Step 6: Include generic cards in index and review**

Update card-type lists in index/review services to include the five canonical V0.2 types and legacy aliases.

---

### Task 3: Verify slice

**Files:**
- All changed files.

- [x] **Step 1: Run focused tests**

Run:

```powershell
npm.cmd run test -- tests/api/cards.test.ts tests/api/review.test.ts tests/server/markdown-codec.test.ts
```

- [x] **Step 2: Run full verification**

Run:

```powershell
npm.cmd run verify
```

- [x] **Step 3: Commit**

Run:

```powershell
git add server tests docs
git commit -m "feat: add generic card backend contract"
```

---

## Later slices

- CardEditor five-template UI.
- Reader action rename and excerpt basket.
- Active-recall ReviewPage.
- Graph coverage conversion.
- Visual polish.
