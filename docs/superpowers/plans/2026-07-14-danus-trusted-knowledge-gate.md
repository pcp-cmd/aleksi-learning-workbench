# Danus Trusted Knowledge Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing immutable verification boundary into a local-first trusted-knowledge gate that freezes submission context, projects evidence trust onto cards without changing mastery, supports typed dependencies and transitive revocation, and provides a confirmed ChatGPT Plus JSON import path inside existing card/review flows.

**Architecture:** Keep immutable candidate, verdict, and revocation Markdown as the source of truth. Upgrade new records to versioned schemas while retaining v1 readers. Derive card trust, active evidence, prerequisites, dependents, and revocation impact as a deterministic knowledge projection instead of transactionally mutating card Markdown. Expose that projection through the existing verification service/routes, surface compact summaries in card/review detail flows, and leave the full ledger as an addressable advanced view rather than mandatory top-level navigation.

**Tech Stack:** TypeScript, React 19, React Router, Express, Zod, Vitest, Testing Library, Vite, Markdown/YAML local persistence, Node.js packaging scripts.

---

## Internal change map

| Requirement | Existing owner | Change | Invariant preserved |
| --- | --- | --- | --- |
| A. Card trust | `verification-service`, card detail UI | Add derived `KnowledgeNodeProjection` with `activeEvidenceIds`, `trustState`, prerequisites and used-by edges | Review scheduler and card `mastery` remain untouched |
| B. Frozen context | candidate schema/service | Candidate v2 records card revision/hash, source reading ID/hash, excerpt metadata, and predecessor IDs exactly as submitted | Existing v1 candidates remain readable and immutable |
| C. Typed relations | candidate input/service | Attach one of `requires`, `proves_with`, `illustrates`, `refutes`, `replaces` to accepted predecessor evidence and resolve stable target card IDs | Evidence IDs remain content-addressed; no large graph UI |
| D. Revocation | verification service/routes | Append immutable revocation records, traverse dependency descendants, and project affected nodes as `under-review` with upstream cause/path | Accepted evidence/verdict files are never deleted or rewritten |
| E. GPT Plus import | verdict input/service/UI | Parse strict JSON locally, show editable preview, require explicit confirmation, persist `gpt-plus-import` verifier provenance | Imported review is non-formal and cannot bypass server validation |
| F. UI reduction | app routes/navigation/card/review/verification pages | Remove verification from top navigation; add contextual evidence actions and compact relationship summaries | Existing reader, card, review, vault, and advanced ledger routes continue working |

## Task 1: Extend contracts and frozen-source lookup

**Files:**
- Modify: `server/domain/schemas.ts`
- Modify: `server/domain/types.ts`
- Modify: `server/services/reading-service.ts`
- Test: `server/services/reading-service.test.ts`

- [ ] Add strict schemas/types for relation kinds, candidate relations, GPT verifier provenance, confirmation, revocation requests, evidence status, trust state, source snapshots, relation projections, revocation impacts, and knowledge-node projections.
- [ ] Keep predecessor arrays ordered and unique; validate that explicit relations cover the submitted predecessors exactly once.
- [ ] Add a vault-scoped reading lookup by canonical relative path that returns the stable reading ID and current Markdown without exposing private index internals.
- [ ] Write a focused reading-service test proving stable ID/path lookup and missing-path behavior.
- [ ] Run: `npm.cmd run test -- server/services/reading-service.test.ts`

## Task 2: Upgrade immutable evidence records and build knowledge projection

**Files:**
- Modify: `server/services/verification-service.ts`
- Modify: `server/services/verification-service.test.ts`

- [ ] Write failing tests proving a new candidate freezes card revision/hash and reading ID/hash while leaving the source card file byte-identical.
- [ ] Write a failing test proving an edited card does not alter an already-created candidate context.
- [ ] Add v1/v2 discriminated readers; emit candidate v2 records with ordered predecessor IDs, typed relations, card snapshot, and optional source snapshot/locator metadata.
- [ ] Preserve replay idempotency by hashing the full normalized frozen v2 payload; reject same semantic identity with incompatible stored content.
- [ ] Build a deterministic projection across candidates, verdicts, and revocations: accepted unaffected evidence is active; independently reviewed evidence strengthens trust; affected or directly revoked evidence places the relevant card under review; mastery is never read or written by the projection.
- [ ] Write tests proving accepted evidence updates projected trust/active IDs but leaves `mastery` and review dates unchanged.
- [ ] Run: `npm.cmd run test -- server/services/verification-service.test.ts`

## Task 3: Add typed dependency and transitive revocation semantics

**Files:**
- Modify: `server/services/verification-service.ts`
- Modify: `server/services/verification-service.test.ts`

- [ ] Write failing tests for each relation contract, stable target card resolution, compact prerequisite/used-by projections, and rejection of dependencies that are not currently accepted.
- [ ] Write failing tests for a three-level chain where revoking the root marks every transitive dependent as affected, records the immediate upstream edge and full path, and does not delete candidate or verdict Markdown.
- [ ] Add immutable content-addressed revocation records with reason, timestamp, root evidence ID, and deterministic impact paths.
- [ ] Prevent new dependencies on revoked/affected evidence and prevent verdict creation for evidence already invalidated upstream.
- [ ] Make revocation replay idempotent and conflicting reasons explicit rather than overwriting history.
- [ ] Run: `npm.cmd run test -- server/services/verification-service.test.ts`

## Task 4: Add route contracts and confirmed GPT JSON import

**Files:**
- Modify: `server/routes/verification.ts`
- Modify: `server/routes/verification.test.ts`
- Modify: `server/services/verification-service.ts`

- [ ] Write failing API tests for knowledge projection retrieval, revocation confirmation, and GPT import rejection without explicit confirmation.
- [ ] Extend verdict records to v2 provenance fields while retaining v1 reads; require `confirmed: true` only for `gpt-plus-import`.
- [ ] Add `GET /api/verification/knowledge/:cardId` and `POST /api/verification/candidates/:id/revoke` with strict input validation and existing vault resolution.
- [ ] Verify legacy manual human/AI review requests still work and conflicting verdict behavior remains unchanged.
- [ ] Run: `npm.cmd run test -- server/routes/verification.test.ts`

## Task 5: Fold verification into card and review flows

**Files:**
- Modify: `src/app/routes.tsx`
- Modify: `src/components/NavigationRail.tsx`
- Modify: `src/features/cards/CardStudioPage.tsx`
- Modify: `src/features/review/ReviewPage.tsx`
- Modify: `src/features/verification/VerificationPage.tsx`
- Modify: relevant co-located CSS files only where existing tokens/classes cannot express the compact state UI
- Modify: `src/test/App.test.tsx`
- Modify: `src/features/verification/VerificationPage.test.tsx`

- [ ] Write failing UI tests proving verification is absent from primary navigation but remains routable from a selected card and a completed review.
- [ ] Add a compact card knowledge panel showing trust state, active/affected evidence counts, prerequisites, used-by links, and revocation cause without changing card mastery controls.
- [ ] Add contextual “verify this card” actions to card detail and completed-review states; preselect the card through a query parameter.
- [ ] Add typed relation selection to candidate creation while reusing existing accepted-evidence controls.
- [ ] Add ChatGPT JSON paste → strict parse → editable preview → confirmation checkbox → submit; label the result as independent model review, not formal proof.
- [ ] Add revocation controls behind an explicit destructive confirmation and reason field on evidence detail.
- [ ] Retain the full verification page as an advanced ledger and preserve the current refined light-paper visual language.
- [ ] Run: `npm.cmd run test -- src/test/App.test.tsx src/features/verification/VerificationPage.test.tsx`

## Task 6: Regression verification and Windows handoff

**Files:**
- Modify only if verification exposes a root-cause defect
- Create: `outputs/AleksiWorkbench-Danus-Trusted-Knowledge-Source-20260714.zip`
- Create: `outputs/AleksiWorkbench-Danus-Trusted-Knowledge-Preview-win-x64-20260714.zip`
- Create: `outputs/AleksiWorkbench-Danus-Trusted-Knowledge-Verification-Report-20260714.md`

- [ ] Run fresh full verification: `npm.cmd run verify`.
- [ ] Run browser/end-to-end verification: `npm.cmd run test:browser` (or the repository's canonical browser command discovered from scripts).
- [ ] Manually exercise: create candidate; replay it; edit the card and inspect frozen context; import GPT JSON with and without confirmation; accept evidence and confirm mastery is unchanged; create a three-level dependency chain; revoke the root; inspect all dependent trust states; revisit Reader, Cards, Review, and Vault.
- [ ] Build the Windows runtime package only after all source checks pass, then run the repository runtime audit against the packaged tree.
- [ ] Create the source ZIP from the verified working tree, excluding generated dependencies/build outputs according to the existing packaging script.
- [ ] Generate a report containing architecture findings, exact changed files, schema/migration behavior, automated/manual evidence, limitations, hashes, package paths, and the next highest-value Danus principle.
- [ ] Re-run the package audit and record SHA-256 hashes after final ZIP creation; never report unverified steps as passed.

## Non-goals for this increment

- No swarm runtime, strategy service, Lean kernel, remote API key, paid service, large graph dashboard, or automatic mastery promotion.
- No rewriting or deleting existing v1 candidate/verdict files.
- No replacement of the existing reader, card, review scheduler, Markdown vault, or packaging architecture.

## Execution note

This session executes the plan inline because the active collaboration policy does not authorize delegated agents. Each checkbox is still an independently verifiable unit and will be updated as evidence is obtained.
