# Aleksi Workbench V0.2 Today and Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement V0.2 Phase 5 so Today exposes one next minimum action and Graph becomes a five-card-type coverage/gap board.

**Architecture:** Convert the graph-derived contract from the legacy four math rings to V0.2 generic coverage rings: concept, example, boundary, process, mistake. Preserve compatibility by normalizing legacy math cards into the V0.2 semantic coverage set (`definition -> concept`, `counterexample -> boundary`, `proof -> process`) until old Vault content is migrated; the UI must still display only the five generic V0.2 rings. Today continues to read Vault, review queue, and graph APIs, but presents the graph-derived `nextAction` as the primary daily decision.

**Tech Stack:** TypeScript service logic, React, TanStack Query, Vitest, Playwright.

---

### Task 1: Backend generic graph coverage

**Files:**
- Modify: `server/services/graph-service.ts`
- Modify: `tests/server/graph-service.test.ts`
- Modify: `tests/api/graph.test.ts`

- [x] Write failing tests expecting graph `rings` keys: `concept`, `example`, `boundary`, `process`, `mistake`.
- [x] Update graph card type order and suggestions to the five generic types.
- [x] Keep archived assets, non-card assets, and unmapped assets from creating false V0.2 coverage.
- [x] Preserve diagnosis/current-block precedence and due-review handling.

### Task 2: Today next minimum action

**Files:**
- Modify: `src/features/today/TodayPage.tsx`
- Modify: `tests/ui/today-settings.test.tsx`

- [x] Write failing UI tests where the primary graph concept has a V0.2 gap and Today shows the exact `nextAction` as the prominent next minimum action.
- [x] Update Today graph types and ring summary to five generic coverage labels.
- [x] Keep Vault-not-configured and loading/error behavior unchanged.

### Task 3: Graph gap board UI

**Files:**
- Modify: `src/features/graph/FlywheelGraph.tsx`
- Modify: `src/features/graph/WheelGraphPage.tsx`
- Modify: `src/styles/components.css`
- Modify: `tests/ui/review-graph.test.tsx`

- [x] Write failing UI tests expecting five generic coverage labels and a gap board with suggested actions.
- [x] Update graph page summary from "four rings" to "five generic card coverage".
- [x] Render gap actions as the important detail, not decorative graph controls.

### Task 4: Verification and commit

**Commands:**
- `npm.cmd run test -- tests/server/graph-service.test.ts tests/api/graph.test.ts tests/ui/today-settings.test.tsx tests/ui/review-graph.test.tsx`
- `npm.cmd run verify`
- `npm.cmd run test:browser`
- `git diff --check`
- `git commit -m "feat: add v0.2 graph gap board"`

- [x] Confirm focused tests pass.
- [x] Confirm full verification passes.
- [x] Confirm browser smoke passes.
- [x] Commit only the relevant files.
