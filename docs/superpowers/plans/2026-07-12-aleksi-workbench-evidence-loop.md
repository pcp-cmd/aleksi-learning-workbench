# Aleksi Workbench Evidence Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a safe first evidence-loop slice: persist a learner attempt before reveal, keep review queues answer-free, prevent self-rating from awarding mastery, and let Today present one deterministic next action.

**Architecture:** Markdown remains the Vault source of truth. A V2 ReviewRecord adds an `attempted` pre-reveal state and later reuses the existing pending/committed result path, while V1 committed history stays readable through an explicit union parser. Incomplete attempts are immutable evidence but do not block Today; this slice deliberately avoids automatic Diagnosis creation/closure because the current codebase lacks the locking and recovery protocol required for a safe Review/Card/Diagnosis multi-file transaction.

**Tech Stack:** React 19, TypeScript 5.8, Express 5, Zod 3, gray-matter, TanStack Query, Vitest, Testing Library, Supertest, Playwright, Vite.

---

## Scope and Boundaries

This slice includes:

- answer-free due-review queue and cache;
- durable attempt-before-reveal with confidence, duration, assistance, and prompt evidence;
- result submission tied to the exact attempt and unchanged card bytes;
- conservative mastery and assisted-interval cap;
- learner correction plus a persisted diagnosis draft for weak reviews;
- an explicit UI handoff to the existing Diagnosis page;
- one server-selected Today action.

This slice does not claim:

- crash-safe per-card locking or pending recovery beyond the existing behavior;
- automatic multi-file Diagnosis creation or closure;
- a manual diagnosis lifecycle;
- transfer-evidence promotion to `mastered`;
- a new Vault directory, database, or Vault schema migration.

## File Structure

- Modify `server/domain/schemas.ts` and `server/domain/types.ts`: strict attempt/result contracts and shared evidence types.
- Modify `server/services/review-service.ts`: V1/V2 parsing, attempted record persistence, answer-free queue, result/card identity checks, and conservative scheduling.
- Modify `server/routes/review.ts`: attempt, resume, and updated result routes.
- Modify `server/services/index-service.ts`: omit non-committed ReviewRecords from index projections.
- Create `server/services/today-service.ts` and `server/routes/today.ts`; modify `server/app.ts`.
- Modify `src/features/review/ReviewPage.tsx`: attempt-first interaction and diagnosis handoff.
- Modify `src/features/today/TodayPage.tsx`: one authoritative action.
- Modify `src/features/diagnosis/DiagnosisPage.tsx`: use “原因假设（待复测）” language and accept review-prefill state without adding lifecycle claims.
- Modify `src/styles/components.css`: restrained evidence controls and Today primary card.
- Update API/UI tests and current documentation.

## Task 1: Define Strict Attempt and Result Requests

**Files:**
- Modify: `server/domain/schemas.ts`
- Modify: `server/domain/types.ts`
- Test: `tests/api/review.test.ts`

- [ ] **Step 1: Add failing strict-body tests**

The attempt body is exactly:

```ts
{
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  answer: "先给任意精度，再找到统一控制后续项的阶段。",
  declaredDontKnow: false,
  confidenceBeforeReveal: 3,
  durationMs: 42000,
  assistanceLevel: "none"
}
```

Reject unknown fields, confidence outside `1..4`, invalid duration, invalid assistance, a blank answered attempt, and a nonblank “do not know” attempt.

- [ ] **Step 2: Implement the attempt schema**

```ts
export const reviewAssistanceLevelSchema = z.enum([
  "none",
  "hint",
  "source",
  "ai"
]);

export const reviewAttemptInputSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    answer: bodyStringSchema,
    declaredDontKnow: z.boolean(),
    confidenceBeforeReveal: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4)
    ]),
    durationMs: z.number().int().min(0).max(86_400_000),
    assistanceLevel: reviewAssistanceLevelSchema
  })
  .strict()
  .superRefine((value, context) => {
    const hasAnswer = value.answer.trim().length > 0;
    if (value.declaredDontKnow === hasAnswer) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["answer"],
        message: "Provide an answer or declare that you do not know, but not both"
      });
    }
  });
```

- [ ] **Step 3: Implement the result schema**

```ts
export const reviewDiagnosisDraftSchema = z
  .object({
    assumedProblem: nonEmptyBodyStringSchema,
    causeHypothesis: nonEmptyBodyStringSchema,
    nextMinimumAction: nonEmptyBodyStringSchema,
    targetCardType: cardTypeSchema
  })
  .strict();

export const reviewResultInputSchema = z
  .object({
    attemptId: reviewIdSchema,
    feedback: reviewFeedbackSchema,
    blockType: blockTypeSchema.nullable(),
    selfCorrection: bodyStringSchema,
    diagnosisDraft: reviewDiagnosisDraftSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    const weak = value.feedback === "forgot" || value.feedback === "fuzzy";
    if (weak && value.selfCorrection.trim().length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selfCorrection"],
        message: "Weak reviews require a non-empty self-correction"
      });
    }
    if (weak !== (value.diagnosisDraft !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["diagnosisDraft"],
        message: weak
          ? "Forgot and fuzzy reviews require a diagnosis draft"
          : "Known and fluent reviews must not create a diagnosis draft"
      });
    }
    if (weak && value.blockType === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockType"],
        message: "Weak reviews require a block type"
      });
    }
  });
```

Strong reviews may use `blockType: null`; weak reviews require it.

## Task 2: Persist Attempt Before Reveal and Remove Queue Leakage

**Files:**
- Modify: `server/services/review-service.ts`
- Modify: `server/routes/review.ts`
- Modify: `server/services/index-service.ts`
- Test: `tests/api/review.test.ts`

- [ ] **Step 1: Add answer-leak sentinels for every card type**

For concept, definition, example, boundary, counterexample, process, mistake, and proof cards, use a unique answer sentinel and assert neither `GET /api/review/today` nor `.aleksi/review-queue.json` contains it. The queue contains only metadata and a generated prompt.

- [ ] **Step 2: Define explicit V1/V2 record readers**

Implement a union reader for:

```text
V1 committed ReviewRecord (existing strict frontmatter)
V2 attempted ReviewRecord + ## 闭卷回答 value unit
V2 pending/committed ReviewRecord + attempt/result evidence value units
```

Do not replace the V1 schema with a strict V2 schema. The body decoder must return the exact UTF-8 value-unit content so resume and result can recover the persisted answer.

- [ ] **Step 3: Canonicalize the attempt request hash**

Hash normalized JSON keys in this exact order:

```ts
{
  cardId,
  idempotencyKey,
  answer,
  declaredDontKnow,
  confidenceBeforeReveal,
  durationMs,
  assistanceLevel
}
```

- [ ] **Step 4: Create without overwrite**

Use the existing exclusive-create/CAS primitive from `server/lib/atomic-write.ts` for the first attempted record. Concurrent identical requests replay; concurrent changed content under the same key returns `409 IDEMPOTENCY_KEY_REUSE` and never overwrites the first attempt.

- [ ] **Step 5: Add attempt and resume endpoints**

```ts
POST /api/review/:cardId/attempt
GET  /api/review/attempts/:attemptId
```

The POST returns `revealedCard` only after the attempted record is durably readable. Resume and result both reject a changed current card hash.

- [ ] **Step 6: Exclude incomplete records from projections**

Index rebuild skips every ReviewRecord whose `commitState !== "committed"`. Incomplete attempts remain auditable Markdown but do not block Today and do not affect history, queue, graph, mastery, or scheduling.

## Task 3: Commit Evidence Conservatively

**Files:**
- Modify: `server/services/review-service.ts`
- Modify: `server/routes/review.ts`
- Test: `tests/api/review.test.ts`
- Test: `tests/server/review-service.test.ts`

- [ ] **Step 1: Bind result identity**

`POST /api/review/:cardId/result` must verify:

```text
attemptId exists
attempt.commitState is attempted/pending/committed as appropriate
route cardId equals attempt.cardId
current canonical card SHA-256 equals attempt.baseCardSha256 before staging
```

Unknown attempts, route mismatch, stale card content, and changed result payloads return stable `4xx` errors without mutating the card.

- [ ] **Step 2: Canonicalize the result request hash**

Hash keys in this exact order:

```ts
{
  attemptId,
  feedback,
  blockType,
  selfCorrection,
  diagnosisDraft
}
```

The nested diagnosis object uses `assumedProblem`, `causeHypothesis`, `nextMinimumAction`, `targetCardType` in that order.

- [ ] **Step 3: Persist readable evidence**

V2 committed records retain the attempted answer metadata and add:

```ts
selfCorrection: string;
evidenceQuality: "insufficient" | "assisted" | "independent";
diagnosisDraft: ReviewDiagnosisDraft | null;
```

Store answer, self-correction, cause hypothesis, and next minimum action as byte-count Markdown sections. The diagnosis draft is evidence and UI handoff data; it is not a claim that a Diagnosis asset was created.

- [ ] **Step 4: Remove one-click mastery**

Use:

```text
forgot/fuzzy -> rebuild
known/fluent -> learning
assistance != none -> interval is min(base interval, 3)
```

No Review result in this slice writes `mastered`.

## Task 4: Select One Today Action

**Files:**
- Create: `server/services/today-service.ts`
- Create: `server/routes/today.ts`
- Modify: `server/app.ts`
- Create: `tests/api/today.test.ts`

- [ ] **Step 1: Test deterministic priority**

Use this order:

```text
1. due review
2. existing Graph currentBlock/nextAction
3. Graph coverage gap
4. latest reading
5. start new reading
```

Incomplete attempts are deliberately absent until recovery/abandon semantics exist.

- [ ] **Step 2: Return structured actions**

```ts
type TodayNextResponse = {
  nextAction: {
    kind: "due-review" | "remediation" | "graph-gap" | "continue-reading" | "new-reading";
    title: string;
    reason: string;
    href: string;
    estimatedMinutes: number;
    concept: string | null;
    count: number;
  };
  later: Array<{ kind: string; title: string; href: string }>;
};
```

Do not parse localized suggestion strings to infer types. The service may reuse the Graph `nextAction` as display text while selecting the route from structured conditions (`currentBlock`, `hasDueReview`, ring states).

## Task 5: Build the Attempt-First Review UI

**Files:**
- Modify: `src/features/review/ReviewPage.tsx`
- Modify: `src/styles/components.css`
- Test: `tests/ui/review-graph.test.tsx`
- Test: `tests/ui/safety-accessibility.test.tsx`

- [ ] **Step 1: Test the UI gate**

Verify that reveal is unavailable until answer-or-“I do not know” plus confidence are present, the attempt POST completes before answer content renders, the original answer freezes after reveal, and feedback is absent before reveal.

- [ ] **Step 2: Implement explicit states**

```ts
type ReviewUiState =
  | "answering"
  | "saving-attempt"
  | "revealed"
  | "saving-result"
  | "saved";
```

Retain one attempt idempotency key across network retries. Do not automatically advance after save; show an explicit Next card button.

- [ ] **Step 3: Collect correction and diagnosis draft**

Weak feedback requires self-correction, block type, assumed problem, cause hypothesis, and next minimum action. After save, write the draft to a feature-local/sessionStorage transfer object and offer one explicit “进入卡点诊断” action. Do not claim that a Diagnosis was created or resolved.

- [ ] **Step 4: Meet accessibility and visual rules**

Use fieldset/legend for confidence, assistance, and feedback; use `role="alert"`, `aria-live="polite"`, visible 44px targets, existing focus-visible behavior, paper surfaces, clay accent, serif headings, and reduced-motion support.

## Task 6: Make Today Execute the Priority

**Files:**
- Modify: `src/features/today/TodayPage.tsx`
- Modify: `src/styles/components.css`
- Modify: `tests/ui/today-settings.test.tsx`

- [ ] **Step 1: Fetch the authoritative action**

After auto-prepare, use `GET /api/today/next`. Render exactly one primary action with title, reason, estimate, and Start link.

- [ ] **Step 2: Demote later work**

Render `later` as a quiet list without primary buttons. Preserve existing loading, read-only, and local-service recovery states.

## Task 7: Documentation and Verification

**Files:**
- Modify: `docs/current/PRODUCT_DECISIONS.md`
- Modify: `docs/DATA_SCHEMA.md`
- Modify: `README.md`

- [ ] **Step 1: Record the invariant**

```text
AI may prompt, question, hint, check, and schedule. Only the learner's persisted independent output can advance evidence state; no single self-rating can produce mastered.
```

- [ ] **Step 2: Document compatibility and nonclaims**

State that V1 committed ReviewRecords remain readable, incomplete V2 records do not enter projections, Vault settings stay schemaVersion 1, diagnosis lifecycle remains a future transaction-safe slice, and client/server must ship together because queues no longer expose answer content.

- [ ] **Step 3: Run verification**

```powershell
npm.cmd run typecheck
npm.cmd run test -- tests/api/review.test.ts tests/api/today.test.ts tests/ui/review-graph.test.tsx tests/ui/today-settings.test.tsx tests/ui/safety-accessibility.test.tsx
npm.cmd run verify
npm.cmd run test:browser
npm.cmd run verify:runtime
```

All commands must exit `0` before a runtime ZIP is called verified. If Vite/esbuild child-process creation is sandbox-blocked, report typecheck separately and keep test/build/runtime gates explicitly incomplete.

- [ ] **Step 4: Package the source**

```powershell
npm.cmd run package:source
npm.cmd run package:audit
```

Generate the Windows runtime package only after the build/test gates can run.

## Self-Review

- Spec coverage: attempt-before-reveal, queue privacy, evidence persistence, conservative mastery, explicit diagnosis handoff, Today priority, accessibility, compatibility, and delivery boundaries each map to a task.
- Risk reduction: the plan no longer introduces an undefined multi-file Diagnosis transaction or a permanent incomplete-review Today blocker.
- Type consistency: attempt and result hashes have exact canonical payloads; result route/card identity and stale-card checks are explicit; V1 and V2 record readers are separate.

## Execution Choice

The user requested the recommended method. Execute with **Subagent-Driven Development**: backend Tasks 1–4, frontend Tasks 5–6, root integration/documentation/verification.
