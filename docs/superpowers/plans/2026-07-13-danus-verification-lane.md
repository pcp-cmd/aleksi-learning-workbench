# Danus-Inspired Evidence Verification Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app lane where a learner submits an immutable claim/proof attempt, receives a separately persisted strict review, and can distinguish candidate, repair-needed, and accepted evidence without treating an LLM verdict as formal truth.

**Architecture:** Reuse the existing Vault and place authoritative Markdown under `10-Codex任务/验证证据/`, so existing schema-version-1 Vaults remain valid. Candidate IDs and verdict IDs are SHA-256 content addresses; candidate content and verdict content live in separate files and are never overwritten. Express routes delegate to a focused verification service, while a React page creates candidates, copies a verifier prompt, records a structured verdict, and shows whether accepted evidence is independent enough to qualify for later mastery consideration.

**Tech Stack:** TypeScript 5.8, Node.js 22, Express 5, Zod 3, React 19, TanStack Query 5, gray-matter, Vitest, Testing Library, Playwright.

---

### Task 1: Pin the verification data contract

**Files:**
- Modify: `server/domain/schemas.ts`
- Modify: `server/domain/types.ts`
- Test: `tests/api/verification.test.ts`

- [ ] **Step 1: Write failing schema/API tests**

Add tests that post a candidate with `{ cardId, statement, proofAttempt, predecessorIds, assistanceLevel }`, reject unknown fields and empty proof text, and reject verdicts whose `correct` value disagrees with non-empty `criticalErrors` or `gaps`.

```ts
const invalidCorrectVerdict = {
  verifierKind: "ai-review",
  verificationReport: {
    summary: "仍有一步没有论证",
    criticalErrors: [],
    gaps: [{ location: "第二段", issue: "没有证明连续性" }]
  },
  verdict: "correct",
  repairHints: ""
};
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm.cmd test -- tests/api/verification.test.ts`

Expected: FAIL because `/api/verification` is not registered.

- [ ] **Step 3: Add exact Zod contracts**

Add these strict shapes to `server/domain/schemas.ts` and export their inferred types from `server/domain/types.ts`:

```ts
export const evidenceAssistanceLevelSchema = z.enum(["none", "hint", "source", "ai"]);
export const evidenceVerifierKindSchema = z.enum(["ai-review", "human-review"]);
export const evidenceFindingSchema = z.object({
  location: linkSafeStringSchema,
  issue: nonEmptyBodyStringSchema
}).strict();
export const evidenceCandidateCreateInputSchema = z.object({
  cardId: z.string().uuid(),
  statement: nonEmptyBodyStringSchema,
  proofAttempt: nonEmptyBodyStringSchema,
  predecessorIds: z.array(evidenceIdSchema).default([]),
  assistanceLevel: evidenceAssistanceLevelSchema
}).strict();
```

`evidenceVerdictInputSchema` must enforce: `correct` iff both finding arrays are empty; `wrong` iff at least one finding exists; `wrong` requires non-empty `repairHints`; `correct` requires `repairHints === ""`.

- [ ] **Step 4: Run typecheck**

Run: `npm.cmd run typecheck`

Expected: PASS.

### Task 2: Persist immutable content-addressed candidates and verdicts

**Files:**
- Create: `server/services/verification-service.ts`
- Test: `tests/api/verification.test.ts`

- [ ] **Step 1: Test content addressing and immutability**

Cover these behaviors:

```ts
expect(first.body.candidate.id).toMatch(/^evidence-[0-9a-f]{64}$/u);
expect(replay.body.candidate.id).toBe(first.body.candidate.id);
expect(replay.body.replayed).toBe(true);
expect(conflictingVerdict.status).toBe(409);
```

Also assert that the learner's exact statement and proof are present in the candidate Markdown, while the verdict is written to a separate `verdict-*.md` file.

- [ ] **Step 2: Implement the service boundary**

Create `verification-service.ts` with:

```ts
export async function createEvidenceCandidate(input: EvidenceCandidateCreateInput): Promise<CreateEvidenceCandidateResponse>;
export async function listEvidenceCandidates(): Promise<EvidenceCandidateSummary[]>;
export async function getEvidenceCandidate(id: string): Promise<EvidenceCandidateDetail>;
export async function recordEvidenceVerdict(id: string, input: EvidenceVerdictInput): Promise<RecordEvidenceVerdictResponse>;
```

Use `10-Codex任务/验证证据/` as an on-demand subdirectory. Compute the candidate hash from canonical JSON containing `cardId`, normalized `statement`, normalized `proofAttempt`, sorted unique `predecessorIds`, and `assistanceLevel`; exclude timestamps and paths. Compute the verdict hash from canonical JSON containing the candidate ID and the complete verdict input. A same-content retry returns the existing record; a second different verdict for one candidate returns `EVIDENCE_VERDICT_ALREADY_RECORDED` with HTTP 409.

- [ ] **Step 3: Enforce predecessor and trust rules**

Before writing a candidate, resolve every predecessor and require an existing `correct` verdict. Derive:

```ts
const evidenceQuality = input.assistanceLevel === "none" ? "independent" : "assisted";
const qualifiesForMastery = verdict === "correct" && evidenceQuality === "independent";
```

Do not mutate card mastery. The flag is evidence for a later policy decision, not automatic promotion.

- [ ] **Step 4: Generate the verifier prompt from persisted content**

Return a prompt that contains the candidate ID, statement, proof attempt, accepted predecessor IDs, and this exact verdict rule:

```text
Return correct if and only if criticalErrors and gaps are both empty.
This is an LLM/human review record, not a formal proof certificate.
```

The required JSON keys are `verificationReport.summary`, `verificationReport.criticalErrors`, `verificationReport.gaps`, `verdict`, and `repairHints`.

- [ ] **Step 5: Run focused tests**

Run: `npm.cmd test -- tests/api/verification.test.ts`

Expected: all verification API tests PASS.

### Task 3: Expose the Express API

**Files:**
- Create: `server/routes/verification.ts`
- Modify: `server/app.ts`
- Test: `tests/api/verification.test.ts`

- [ ] **Step 1: Add route tests**

Test `GET /api/verification/candidates`, `POST /api/verification/candidates`, `GET /api/verification/candidates/:id`, and `POST /api/verification/candidates/:id/verdict`. Confirm new writes return 201, content-addressed replays return 200, malformed IDs return 400, missing records return 404, and conflicting verdicts return 409.

- [ ] **Step 2: Implement a thin router**

Parse params and bodies with the Task 1 schemas, map `VerificationServiceError`, `VaultServiceError`, path errors, and Zod errors to stable JSON error codes, and delegate all filesystem behavior to the service.

- [ ] **Step 3: Register the router**

Add to `server/app.ts`:

```ts
app.use("/api/verification", createVerificationRouter());
```

- [ ] **Step 4: Run server smoke and API tests**

Run: `npm.cmd test -- tests/api/verification.test.ts tests/server/app-smoke.test.ts`

Expected: PASS.

### Task 4: Build the learner-facing verification workbench

**Files:**
- Create: `src/features/verification/VerificationPage.tsx`
- Modify: `src/app/routes.tsx`
- Modify: `src/components/NavigationRail.tsx`
- Modify: `src/styles/workbench.css`
- Test: `tests/ui/verification.test.tsx`
- Test: `tests/ui/app-shell.test.tsx`

- [ ] **Step 1: Write the UI test**

Mock recent cards and verification endpoints. Assert that a learner can select a card, enter a statement and proof, choose assistance level, save the immutable candidate, copy the verifier prompt, enter a strict report, record `wrong`, and see the status `需要修复` plus the repair hint.

- [ ] **Step 2: Add the route and navigation item**

Add `/verification` as position 5 with label `证据验证` and short label `验证`. Render `VerificationPage` directly and update app-shell expectations to `01` through `05`.

- [ ] **Step 3: Implement candidate creation**

Use TanStack Query for recent cards and candidate records. Disable submission until card, statement, and proof are non-empty. Explain above the form that a candidate is not trusted evidence and that AI review is not formal verification.

- [ ] **Step 4: Implement structured verdict entry**

Provide fields for verifier kind, summary, critical errors, gaps, and repair hints. The UI may add/remove multiple findings but must never synthesize a `correct` verdict when any finding exists. Require the learner to select `correct` or `wrong`; the server remains authoritative for consistency.

- [ ] **Step 5: Render the evidence ledger**

Show `等待审查`, `需要修复`, or `审查通过`, the assistance provenance, predecessor count, content-addressed ID, and `可作为掌握候选` only for accepted independent evidence. Rejected evidence must invite a new candidate rather than editing the old one.

- [ ] **Step 6: Run focused UI tests**

Run: `npm.cmd test -- tests/ui/verification.test.tsx tests/ui/app-shell.test.tsx`

Expected: PASS.

### Task 5: Document the Danus trust boundary and Vault shape

**Files:**
- Modify: `docs/current/PROJECT_MAP.md`
- Modify: `docs/current/PRODUCT_DECISIONS.md`
- Modify: `docs/DATA_SCHEMA.md`
- Test: `tests/docs/governance-docs.test.ts`

- [ ] **Step 1: Add governance assertions**

Require current docs to name `候选证据`, `AI 审查不是形式化证明`, `10-Codex任务/验证证据`, and `qualifiesForMastery`.

- [ ] **Step 2: Document the exact boundary**

State that the design borrows Danus's producer/verifier separation, content addressing, strict zero-error/zero-gap gate, and immutable history. State that it does not embed the Danus swarm, does not claim Lean/Coq-level verification, and does not automatically promote card mastery.

- [ ] **Step 3: Document both Markdown records**

List candidate and verdict frontmatter/body fields, client/server authority, ID hashing inputs, replay behavior, predecessor requirements, and the derived `evidenceQuality` / `qualifiesForMastery` values.

- [ ] **Step 4: Run documentation tests**

Run: `npm.cmd test -- tests/docs/governance-docs.test.ts`

Expected: PASS.

### Task 6: Verify and package the combined learning project

**Files:**
- Modify: `tests/scripts/delivery-scripts.test.ts` only if package inventory assertions need the new files listed
- Create: `outputs/AleksiWorkbench-Danus-Verification-Release-Notes-20260713.md`
- Create: `outputs/AleksiWorkbench-Danus-Verification-Source-20260713.zip`
- Create: `outputs/AleksiWorkbench-Danus-Verification-Preview-win-x64-20260713.zip`

- [ ] **Step 1: Run the complete source gate**

Run: `npm.cmd run verify`

Expected: typecheck PASS, all Vitest files PASS, Vite production build PASS.

- [ ] **Step 2: Run browser verification**

Run: `npm.cmd run test:browser`

Expected: all Playwright scenarios PASS and existing reading/review behavior remains intact.

- [ ] **Step 3: Build and verify the runtime package**

Run: `npm.cmd run package:source`

Expected: `artifacts/aleksi-learning-workbench-source.zip` created.

Run: `npm.cmd run verify:runtime`

Expected: runtime archive audit PASS and packaged `/api/health` returns HTTP 200.

- [ ] **Step 4: Copy immutable dated deliverables and write release notes**

Copy the verified source/runtime archives to the filenames above. Release notes must separate implemented behavior, automated evidence, trust limitations, and explicitly unimplemented Danus swarm/formal-prover behavior.

- [ ] **Step 5: Hash the final files**

Run: `Get-FileHash outputs/AleksiWorkbench-Danus-Verification-* -Algorithm SHA256`

Expected: each deliverable has a non-empty SHA-256 digest recorded in the final handoff.

