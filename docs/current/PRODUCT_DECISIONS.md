# Product Decisions

Status: current product decisions for Aleksi Learning Workbench V0.2.

These decisions are fixed for this delivery pass. Do not re-open them inside implementation unless the human changes the plan.

## Theme

The workbench has one default visual direction:

```text
Anthropic / Claude-inspired Light Paper Workspace
```

The product does not include:

- dark theme
- light/dark theme switch
- night mode
- multiple theme token sets
- user theme configuration

The visual target is warm white, paper-like, low-saturation, readable, quiet, and stable.

## overview.json

`public/motion/overview.json` is only an Entrance glyph resource.

Allowed placements:

- `EntrancePage`
- launch cover
- very small static or light-motion empty-state visual moments

Forbidden placements:

- reader body
- input backgrounds
- review cards
- formula areas
- ordinary functional cards
- full-site background

If `public/motion/overview.json` is missing, Codex must not fabricate it, generate a substitute JSON, or fetch one from the network. The app should show a graceful static fallback and still allow the user to enter `/today`.

## Reader stability

Reading, writing, review, and formula surfaces must remain visually stable.

Allowed:

- text selection highlight
- input focus border
- contextual action buttons after selection

Forbidden:

- reader paper changing background on hover
- reading body lifting on hover
- input area changing large background regions on hover
- formula area changing contrast on hover

## Card system

V0.2 primary card types:

- `concept`：概念卡
- `example`：例子卡
- `boundary`：边界卡
- `process`：流程卡
- `mistake`：错误卡

Legacy card types remain readable for compatibility only:

- `definition`：旧定义卡
- `counterexample`：旧反例卡
- `proof`：旧证明卡

New card creation defaults to `concept`. Main UI creation entries show only the five V0.2 primary types. Legacy schemas and existing legacy data must not be deleted.

## Learning evidence boundary

The workbench is an evidence-backed learning system, not an answer generator.

```text
AI may prompt, question, hint, check, and schedule. Only the learner's persisted independent output can advance evidence state; no single self-rating can produce mastered.
```

Required behavior:

- A review answer, explicit “I do not know” declaration, confidence, duration,
  and assistance level are persisted before the answer side is returned.
- Answer-bearing card content must not appear in the Today review queue or its
  rebuildable JSON cache.
- `forgot` and `fuzzy` require a self-correction, cause hypothesis, and next
  minimum action. This evidence is persisted with the review and explicitly
  handed to the existing Diagnosis page; this slice does not claim an
  automatic multi-file diagnosis transaction or closure.
- Assisted attempts remain useful learning records, but cannot directly
  promote mastery and cannot receive an interval longer than three days.
- `known` and `fluent` no longer promote a card to `mastered` by themselves.
  A later transfer-evidence slice will own that promotion rule.
- Today shows one authoritative next action. Remaining actions are secondary
  context and must not compete visually with the primary action.

Compatibility rules:

- Existing committed ReviewRecords remain readable.
- Vault settings remain at `schemaVersion: 1`; this update does not add a
  Vault migration or a new top-level asset directory.
- Diagnosis lifecycle and automatic retest closure remain outside this slice
  until crash-safe/cross-process locking, pending recovery, and deterministic
  multi-file reconciliation are implemented. The current process-local card
  lock only serializes Review, update, and archive mutations in one runtime.

## Delivery boundary

The V0.2 foundation remains a separately verified clean source package. The current canonical desktop candidate is Aleksi Workbench 0.1.2 at `artifacts/release/aleksi-workbench/0.1.2/Aleksi-Workbench-0.1.2-Setup.exe`. It is a Tauri 2 per-user NSIS `unsigned-preview`, not a signed commercial release.

The installer carries a bundled Node runtime, so end users do not need Node.js or Visual Studio. Its WebView2 policy is `online-light`: a compatible installed Runtime is reused, while a machine without WebView2 needs network access for the `downloadBootstrapper` path. Source verification, installer verification, workflow artifact upload, installed-runtime verification, and final user acceptance are separate claims; none may be used as a substitute for another.

## Danus-inspired evidence verification

The workbench borrows four structural ideas from Danus: separate production from verification, content-address candidate material, accept only with zero critical errors and zero gaps, and keep rejected history instead of rewriting it.

The learner's statement and proof/argument are first stored as **候选证据**. The candidate is immutable and is not trusted merely because it exists. A separately persisted verdict can move its derived status to `accepted` or `repair-needed`; a rejected candidate must be repaired by creating a new candidate. An immutable revocation can later derive `revoked` or transitively `affected` without deleting the original candidate or verdict.

Trust boundary:

- **AI 审查不是形式化证明**. A `correct` LLM verdict is an explicit review judgment, not a Lean/Coq-style certificate.
- This slice does not embed the Danus worker swarm, theorem search runtime, or a formal theorem prover.
- Only currently accepted, unaffected evidence may be named as a predecessor.
- Every predecessor has one explicit relation: `requires`, `proves_with`, `illustrates`, `refutes`, or `replaces`.
- Assistance level is the learner's self-report; the workbench does not claim to independently observe whether help was used.
- `activeEvidenceIds` and `trustState` are derived knowledge-node projections, not mutable card frontmatter.
- `trustState` is independent from card `mastery` and the review scheduler.
- The compatibility field `qualifiesForMastery` is always false; no accepted evidence automatically promotes mastery.
- Accepted independent evidence yields `independently-supported`; assisted evidence yields `supported`; a direct or upstream revocation yields `under-review`.
- GPT Plus JSON imports are parsed into an editable preview and require explicit user confirmation. They persist as `gpt-plus-import`, never as formal proof.
- Revocation propagation is transitive and records reason, time, immediate upstream, and the full root-to-dependent path.
- Candidate and verdict hashes are recomputed on every read. Frontmatter edits that no longer match the content-addressed ID are rejected as damaged evidence instead of inheriting an old accepted state.
- Important or high-stakes conclusions still require a qualified human or formal-tool review.

Compatibility boundary:

- Existing Vault settings remain `schemaVersion: 1`.
- Authoritative records live in the on-demand subdirectory `10-Codex任务/验证证据/`; no existing top-level Vault directory is renamed or reinterpreted.
- The global `.aleksi/index.json` does not ingest these nested files in this slice. The verification service rebuilds the ledger directly from its own immutable Markdown records.
- Existing candidate/verdict v1 Markdown remains readable and content-hash validated.
- New candidates use schema v2 to freeze card revision/hash, source reading ID/hash, excerpt metadata, submitted predecessor order, and typed relations.
- New verdicts use schema v2 to persist confirmation provenance and `formalProof: false`.
- Revocations are append-only schema v1 records. No card Markdown migration or rewrite is required.
