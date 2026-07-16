# Data Schema

Status: Card Markdown v2, preserving unversioned v1 read compatibility

## 1. Authority and transport model

- Markdown files under the active Vault are authoritative learning assets.
- JSON under `.aleksi/` is rebuildable projection data, except
  `.aleksi/settings.json`, which is authoritative Vault configuration.
- `%APPDATA%\Aleksi Learning Workbench\settings.json` is the authoritative
  application locator file.
- Core assets never live in `localStorage` or `IndexedDB`. Those stores may hold
  only disposable interface state.
- Internal keys are English `camelCase`; user-visible labels and Markdown
  headings are Chinese.
- Dates use `YYYY-MM-DD`. Datetimes use ISO 8601 UTC with milliseconds.
- Asset references stored in Markdown are normalized Vault-relative paths using
  `/`. Client create/update bodies never supply output paths.

### Field provenance vocabulary

Every asset table uses these values:

| Column | Values | Meaning |
|---|---|---|
| Client input | `required`, `optional`, `no`, `route selector`, or an explicit create/update-qualified combination | Whether a client supplies the value. A route selector is an opaque server-issued ID in the URL, never create-body authority. |
| Markdown | `frontmatter`, `body`, `both`, `no`, optionally qualified with H1 | Where the normalized value is serialized. |
| Authority/default | `client`, `server`, `derived`, or an explicit slash-separated combination | Who owns the normalized value and any default. |

Rules:

- Every request body uses a strict schema. Unknown keys are rejected; they are
  never ignored or copied into Markdown.
- Asset mutation bodies never accept `id`, `createdAt`, `reviewedAt`,
  `updatedAt`, `relativePath`, `absolutePath`, `filename`, `nextReview`,
  `revisionLog`, review-provenance fields, or another server-owned
  timestamp/path/identifier used as authority unless a later route-specific
  schema explicitly lists that key.
- Clients never choose an output directory or filename.
- Client-supplied references use opaque IDs such as `sourceReadingId` and
  `relatedCardId`; the server resolves and persists the corresponding relative
  path.
- The explicit Vault initialize/select/migrate/backup settings actions are
  privileged configuration operations, not asset writes. They may receive a
  user-confirmed filesystem location; asset mutation endpoints never do.
- Update/archive/review routes may use a server-issued ID as a route selector.
  The body cannot replace that ID.
- Server responses may return a `SaveReceipt` containing the actual paths and
  modification time; response values are not accepted back as write authority.
- `POST /api/cards/:id/archive` accepts exactly `{ "confirmed": true }`.
  `POST /api/index/rebuild` accepts exactly `{ "confirmed": true }`. Their
  route IDs and confirmation values do not grant authority over any other
  asset or path.

### Save receipt

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `relativePath` | 相对路径 | relative path | no | no | server | resolved inside the active Vault |
| `absolutePath` | 实际路径 | absolute path | no | no | server | response-only; never accepted as a write destination |
| `modifiedAt` | 修改时间 | datetime | no | no | server | filesystem-observed ISO 8601 UTC |

`SaveReceipt` is a response-only value object, not a create/update input and not
part of a persisted `CardRecord`. Card mutations return
`{ card: CardRecord, receipt: SaveReceipt }`.

## 2. Fixed enums and scheduling

| Enum | Internal values | Chinese labels |
|---|---|---|
| `CardType` | `concept`, `definition`, `example`, `boundary`, `counterexample`, `process`, `mistake`, `proof` | V0.2 通用卡：概念、例子、边界、流程、错误；兼容旧数学卡：定义、反例、证明 |
| `BlockType` | `definition`, `example`, `counterexample`, `proof-search`, `technical`, `expression`, `transfer`, `emotion` | 定义、例子、反例、证明搜索、技术、表达、迁移、情绪 |
| `Mastery` | `learning`, `due`, `mastered`, `rebuild`, `archived` | 学习中、待复习、已掌握、需要重构、已归档 |
| `ReviewFeedback` | `forgot`, `fuzzy`, `known`, `fluent` | 忘了、模糊、会了、很熟 |

Review intervals are fixed:

| Feedback | Interval | Persisted next mastery |
|---|---:|---|
| `forgot` | 1 day | `rebuild` |
| `fuzzy` | 3 days | `rebuild` |
| `known` | 7 days | `learning` |
| `fluent` | 14 days | `learning` |

### Mastery and due semantics

- Card Markdown persists only `learning`, `mastered`, `rebuild`, or `archived`.
- `due` is never persisted to card Markdown. It is an effective/cache-only
  state derived at read time.
- `due = true` exactly when the card is not archived and
  `nextReview <= todayUtcDate`.
- Effective mastery is:
  1. `archived` for archived cards, which are excluded from active queues;
  2. `rebuild` when persisted mastery is `rebuild`, even if due;
  3. `due` when `due = true`;
  4. otherwise the persisted mastery.
- A new card starts at `learning` with `nextReview = createdAt UTC date + 1`.
- Review feedback applies the transition table above. Archive is changed only
  by the archive route. A normal card update may explicitly choose
  `learning`, `mastered`, or `rebuild`, but cannot choose `due` or `archived`.
- Review date addition uses the UTC date portion of server-generated
  `reviewedAt`; it never constructs a local-midnight date.

## 3. Shared value objects

### Revision entry

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `at` | 修订日期 | date | no | body | server | UTC date of the successful mutation |
| `note` | 修订说明 | string | no | body | server | non-empty description of create, update, archive, or review |
| `reviewId` | 复习记录标识 | `string \| null` | no | body | server | deterministic ReviewRecord ID for a review entry; otherwise `null` |

## 4. Authoritative Markdown assets

### 4.1 Reading

Create input accepts `title`, `concept`, `body`, optional `source`, and optional
`sourceFileName` for browser file imports. Browsers intentionally do not expose
an absolute local path; the original base file name is the available provenance
metadata and is preserved without pretending that a full path is known.

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `id` | 隐藏标识 | string | no | frontmatter | server | stable UUID |
| `type` | 隐藏类型 | literal `reading` | no | frontmatter | server | fixed value |
| `title` | 标题 | string | required | frontmatter and H1 | client | trimmed, non-empty; link-safe title rule below |
| `concept` | 所属概念 | string | required | frontmatter | client | trimmed, NFC, non-empty; link-safe concept rule below |
| `body` | 正文 | string | required | body | client | non-empty Markdown or text |
| `source` | 来源 | `manual-paste \| file-import` | optional | frontmatter | server default | defaults to `manual-paste` |
| `sourceFileName` | 本地来源文件名 | string | optional | frontmatter | client for file import | NFC, 1–255 chars, supported `.md`/`.markdown`/`.txt` base name; rejected for manual paste; absolute paths are not accepted |
| `createdAt` | 创建时间 | datetime | no | frontmatter | server | request commit time |
| `relativePath` | 文件路径 | relative path | no | no | server | response/index only; under `01-阅读材料/` |

### 4.2 Card schemas

The API has four distinct schemas. They are not interchangeable:

- `CardCreateInput` is the strict body for `POST /api/cards`.
- `CardUpdateInput` is the strict body for `PUT /api/cards/:id`.
- `CardRecord` is the persisted/returned card, including server-owned fields.
- `SaveReceipt` is the response-only filesystem receipt defined above.

#### 4.2.1 CardCreateInput

`CardCreateInput` contains exactly:

| Internal key | Type | Presence and normalization |
|---|---|---|
| `type` | `CardType` | required; immutable after create |
| `title` | string | required; trimmed, non-empty |
| `concept` | string | required; trimmed and NFC |
| `relatedConcepts` | string[] | optional; omission becomes `[]`; supplied array may be empty |
| `sourceReadingId` | string | required opaque server-issued reading ID |
| `excerpt` | string | required; may be empty only for a manually started draft |
| `understanding` | string | optional; omission becomes `""`; explicit `""` is equivalent |
| `blockType` | `BlockType \| null` | optional; omission becomes `null`; explicit `null` clears it |
| `nextAction` | string | optional; omission becomes `""`; explicit `""` is equivalent |
| type-specific fields | strings | every key for the selected type is required; fields declared non-empty below reject `""` |

`mastery`, `nextReview`, IDs, paths, timestamps, revision/provenance fields, and
`SaveReceipt` keys are not create fields and are rejected.

#### 4.2.2 CardUpdateInput

`PUT /api/cards/:id` is full editable-field replacement, not PATCH. Its body
must contain every editable field exactly once:

```text
title, concept, relatedConcepts, sourceReadingId, excerpt, understanding,
blockType, nextAction, mastery, and every type-specific field for the
persisted card type
```

Rules:

- Omission of any listed key rejects the whole request with
  `CARD_UPDATE_INCOMPLETE`; no field is inherited implicitly.
- `relatedConcepts` is always an array and may be `[]`.
- `understanding`, `nextAction`, and type-specific fields explicitly permitted
  to be blank use `""` to clear the value.
- `blockType` is always present and uses `null` to clear it.
- No other editable field accepts `null`.
- `mastery` accepts only `learning`, `mastered`, or `rebuild`; `due` and
  `archived` are rejected. `nextReview` is server-owned and rejected.
- `type`, body `id`, `sourceReading`, timestamps, paths, revision/provenance
  fields, and unknown keys are rejected as immutable/server-owned.
- `sourceReadingId` is resolved again and replaces the persisted
  `sourceReading`; clients never submit the path.
- Changing `title` updates frontmatter/H1 but does not rename the existing card
  file; `relativePath` remains stable until archive.
- Validation is all-or-nothing. A rejected PUT changes neither Markdown nor
  caches and appends no revision.

#### 4.2.3 Persisted CardRecord

Card Markdown has two readable layouts:

- Unversioned files are schema v1 and retain the historical headings.
- New cards and every successful card update or committed review write schema
  v2 with `schemaVersion: 2`. Updating a v1 card is the only automatic
  migration boundary; there is no bulk-rewrite operation.
- In v2, the shared recall section is `闭卷重述`. The concept card's
  type-specific synthesis section is `整合理解`, so the two distinct values
  never share one `我的理解` heading.
- Unknown compatible v2 frontmatter is stored in `compatibleMetadata` and
  round-tripped in stable key order. It must be finite JSON, use a safe ASCII
  key, and cannot override a reserved card field.

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `schemaVersion` | 模式版本 | `1 \| 2` | no | frontmatter in v2; omitted in v1 | server | unversioned reads as v1; new/update/review writes v2 |
| `compatibleMetadata` | 兼容元数据 | JSON object | no | additional v2 frontmatter | preserved | stable key order; reserved keys and non-JSON values rejected |
| `id` | 隐藏标识 | string | no | frontmatter | server | stable UUID |
| `type` | 卡片类型 | `CardType` | create only | frontmatter | client/server | immutable after create |
| `title` | 卡片标题 | string | required | frontmatter and H1 | client | trimmed, non-empty; link-safe title rule below |
| `concept` | 所属概念 | string | required | both | client | trimmed, NFC, non-empty; link-safe concept rule below |
| `relatedConcepts` | 相关概念 | string[] | create optional/update required | both | client/default | unique, trimmed, NFC; stable input order |
| `sourceReading` | 来源材料 | relative path | no | frontmatter | server | resolved from `sourceReadingId`; under `01-阅读材料/` |
| `excerpt` | 原文摘录 | string | required | body | client | normalized body-string rules below |
| `understanding` | 闭卷重述 | string | create optional/update required | body | client/default | v1 heading `我的理解`; v2 heading `闭卷重述`; normalized empty string omits optional section |
| `blockType` | 当前卡点 | `BlockType \| null` | create optional/update required | frontmatter and body | client/default/review | null omits optional body section |
| `nextAction` | 下一步行动 | string | create optional/update required | body | client/default | normalized empty string omits optional section |
| `mastery` | 掌握状态 | persisted mastery | update required | frontmatter | server/client/review | create `learning`; PUT accepts only allowed manual values |
| `createdAt` | 创建时间 | datetime | no | frontmatter | server | immutable |
| `nextReview` | 下次复习 | date | no | frontmatter | server/review | create date plus one; never client supplied |
| `lastAppliedReviewId` | 已应用复习标识 | `string \| null` | no | frontmatter | server | latest committed review applied to schedule/mastery/block |
| `lastAppliedReviewSequence` | 已应用复习序号 | `positive integer \| null` | no | frontmatter | server | `reviewSequence` of `lastAppliedReviewId`; review-order floor |
| `reviewAppliedAt` | 复习应用时间 | `datetime \| null` | no | frontmatter | server | `reviewedAt` of `lastAppliedReviewId` |
| `reviewOverrideAt` | 人工覆盖时间 | `datetime \| null` | no | frontmatter | server | set by a later successful PUT that changes mastery or block |
| `pendingReviewId` | 暂存复习标识 | `string \| null` | no | frontmatter | server | transaction staging only; normally `null` |
| `revisionLog` | 修订记录 | `RevisionEntry[]` | no | body | server | at least one entry; append-only after committed mutations |
| `relativePath` | 文件路径 | relative path | no | no | server | response/index only; directory fixed by card type |

New cards initialize all five review-provenance fields to `null`. This evidence
slice writes the final review provenance only after a result is accepted and
does not expose automatic pending recovery as a product claim. Per-card locks,
pending reconciliation, and cross-asset recovery remain a later transaction
slice.

A successful PUT that actually changes `mastery` or `blockType` sets
`reviewOverrideAt` to the PUT commit time while retaining
`lastAppliedReviewId`, `lastAppliedReviewSequence`, and `reviewAppliedAt`. A PUT
that changes only other editable fields leaves review provenance unchanged. A
later newly committed review applies its transition, advances the applied ID
and sequence together, sets `reviewAppliedAt`, clears `reviewOverrideAt`, and
therefore explicitly supersedes the earlier manual override.

#### 4.2.4 Type-specific payloads

##### Concept payload

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `formalExplanation` | 正式解释 | string | required | body | client | non-empty when saved |
| `myUnderstanding` | 整合理解 | string | required | body | client | v1 heading `我的理解`; v2 heading `整合理解`; non-empty when saved |
| `commonMisunderstanding` | 常见误解 | string | required | body | client | key required; content may be empty |
| `usageContext` | 使用场景 | string | required | body | client | key required; content may be empty |

##### Definition payload

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `formalDefinition` | 正式定义 | string | required | body | client | non-empty when saved |
| `plainExplanation` | 大白话解释 | string | required | body | client | non-empty when saved |
| `quantifierStructure` | 量词结构 | string | required | body | client | key required; content may be empty |
| `commonMisunderstandings` | 常见误解 | string | required | body | client | key required; content may be empty |

##### Example payload

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `exampleContent` | 例子内容 | string | required | body | client | non-empty |
| `whyItFits` | 为什么它符合 | string | required | body | client | non-empty |
| `trainingPurpose` | 它训练我什么 | string | required | body | client | key required; content may be empty |

##### Boundary payload

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `confusingObjects` | 易混对象 | string | required | body | client | non-empty |
| `similarity` | 相似之处 | string | required | body | client | key required; content may be empty |
| `keyDifference` | 关键区别 | string | required | body | client | non-empty |
| `judgementRule` | 判断标准 | string | required | body | client | non-empty |

##### Counterexample payload

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `counterexampleContent` | 反例内容 | string | required | body | client | non-empty |
| `brokenCondition` | 它破坏了哪个条件 | string | required | body | client | non-empty |
| `whyItIsNot` | 为什么它不是 | string | required | body | client | non-empty |

##### Process payload

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `task` | 任务 | string | required | body | client | non-empty |
| `steps` | 步骤 | string | required | body | client | non-empty |
| `keyTurn` | 关键转折 | string | required | body | client | key required; content may be empty |
| `pitfall` | 易错点 | string | required | body | client | key required; content may be empty |
| `usageContext` | 使用场景 | string | required | body | client | key required; content may be empty |

##### Mistake payload

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `mistake` | 错误表现 | string | required | body | client | non-empty |
| `originalThinking` | 原来怎么想 | string | required | body | client | key required; content may be empty |
| `realCause` | 真正原因 | string | required | body | client | non-empty |
| `correctMethod` | 正确方法 | string | required | body | client | non-empty |
| `recognitionSignal` | 识别信号 | string | required | body | client | key required; content may be empty |

##### Proof payload

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `proposition` | 命题内容 | string | required | body | client | non-empty |
| `firstAttempt` | 我的第一次尝试 | string | required | body | client | key required; content may be empty |
| `keyMove` | 关键动作 | string | required | body | client | non-empty |
| `proofOutline` | 证明骨架 | string | required | body | client | non-empty |
| `failureReason` | 失败原因 | string | required | body | client | key required; content may be empty |

### 4.3 Diagnosis

Create input uses optional `relatedCardId`; persisted `title` and output path are
server-generated.

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `id` | 隐藏标识 | string | no | frontmatter | server | stable UUID |
| `type` | 隐藏类型 | literal `diagnosis` | no | frontmatter | server | fixed value |
| `title` | 标题 | string | no | frontmatter and H1 | server | `卡点诊断：<concept>` |
| `concept` | 所属概念 | string | required | both | client | trimmed, NFC, non-empty; link-safe concept rule below |
| `relatedCardId` | 关联卡片标识 | string | optional | no | client reference | opaque card ID |
| `relatedCard` | 关联卡片 | `relative path \| null` | no | both | server | resolved from ID; null when omitted |
| `blockType` | 卡点类型 | `BlockType` | required | frontmatter and body | client | exactly one fixed value |
| `manifestation` | 具体表现 | string | required | body | client | trimmed, non-empty |
| `assumedProblem` | 我一开始以为的问题 | string | required | body | client | trimmed, non-empty |
| `actualCause` | 现在判断的真实原因 | string | required | body | client | trimmed, non-empty |
| `nextMinimumAction` | 下一步最小行动 | string | required | body | client | trimmed, non-empty |
| `targetCardType` | 要沉淀成哪类卡片 | `CardType` | required | frontmatter and body | client | one fixed card type |
| `createdAt` | 创建时间 | datetime | no | frontmatter | server | request commit time |
| `relativePath` | 文件路径 | relative path | no | no | server | response/index only; under `07-卡点诊断/` |

### 4.4 Review attempt, result input, and ReviewRecord asset

The current reader is an explicit compatibility union:

- V1 committed ReviewRecords remain readable as historical records.
- V2 `attempted`, `pending`, and `committed` records carry learner evidence.
- Only `committed` records enter index, history, graph, mastery, or scheduling
  projections. Incomplete V2 records remain auditable but do not block Today.

`POST /api/review/:id/attempt` receives exactly:

```ts
{
  idempotencyKey: UUIDv4;
  answer: string;
  declaredDontKnow: boolean;
  confidenceBeforeReveal: 1 | 2 | 3 | 4;
  durationMs: integer; // 0..86_400_000
  assistanceLevel: "none" | "hint" | "source" | "ai";
}
```

Exactly one of a nonblank `answer` or `declaredDontKnow: true` is required. The
server durably creates the deterministic V2 attempted record before returning
`revealedCard`. The attempt request hash is canonical JSON with keys in this
exact order:

```text
cardId, idempotencyKey, answer, declaredDontKnow,
confidenceBeforeReveal, durationMs, assistanceLevel
```

`GET /api/review/attempts/:attemptId` resumes an incomplete attempt only while
the current card bytes still match `baseCardSha256`.

`POST /api/review/:id/result` receives exactly:

```ts
{
  attemptId: ReviewId;
  feedback: "forgot" | "fuzzy" | "known" | "fluent";
  blockType: BlockType | null;
  selfCorrection: string;
  diagnosisDraft: {
    assumedProblem: string;
    causeHypothesis: string;
    nextMinimumAction: string;
    targetCardType: CardType;
  } | null;
}
```

`forgot` and `fuzzy` require a nonblank correction, non-null block type, and
non-null diagnosis draft. `known` and `fluent` require a null diagnosis draft
and may use a null block type. The result hash uses keys in the exact order
shown above; nested diagnosis keys retain their displayed order.

V2 body evidence uses UTF-8 byte-count value units for `闭卷回答`, `自我纠正`,
and, when weak, `我一开始以为的问题`, `原因假设（待复测）`, and
`下一步最小行动`. A diagnosis draft is evidence and UI handoff data; it does
not mean a Diagnosis asset was created or closed.

Scheduling is deliberately conservative: `forgot`/`fuzzy` persist `rebuild`;
`known`/`fluent` persist `learning`; no review result writes `mastered`. Any
assistance other than `none` caps the interval at three days.

The implementation uses exclusive create for the first attempted record and
rejects same-key/different-attempt payloads. A process-local shared card lock
serializes Review, update, and archive mutations; result submission verifies
the attempt ID, route card ID, and original card hash again immediately before
staging. This slice retains the existing pending write behavior: it does not
yet claim crash-safe/cross-process locking, automatic pending recovery, or
multi-file Diagnosis transactions.

#### Deferred transaction-safe recovery target (not implemented in this slice)

The historical protocol below is retained as a future design target. It is not
the current runtime contract and must not be cited as completed behavior.

`POST /api/review/:id/result` uses the card ID only as a route selector. Its body
contains exactly:

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `idempotencyKey` | 幂等键 | string | required | frontmatter | client | UUID v4 generated once per submit action; reused unchanged for retries; not an asset ID, path, filename, timestamp, or value derived from them |
| `feedback` | 复习反馈 | `ReviewFeedback` | required | no | client | one fixed value |
| `blockType` | 本次卡点 | `BlockType` | required | no | client | one fixed value |

The client creates a random UUID v4 before the first request and retains it
until the action receives a committed response. The server normalizes it to
lowercase and requires
`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`.
A different logical review uses a different key. The server rejects unknown
body keys, body card IDs, timestamps, paths, `nextReview`, and `mastery`.

The ReviewRecord ID is deterministic:

```text
"review-" + lowercaseHex(
  SHA-256(UTF8(cardId + "\u0000" + lowercase(idempotencyKey)))
)
```

The server also stores `requestHash`, the lowercase SHA-256 of canonical UTF-8
JSON containing exactly `{cardId, idempotencyKey, feedback, blockType}` with
keys in that order. Reuse of the same `(cardId, idempotencyKey)` with a
different `requestHash` is rejected with `IDEMPOTENCY_KEY_REUSE`.

Every review attempt owns one Markdown transaction record under
`08-飞轮复习/`. Only a record with `commitState: "committed"` belongs to
authoritative review history. A `pending` record is staging metadata and is
ignored by history, queue, graph, mastery, and scheduling projections.

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `id` | 复习记录标识 | string | no | frontmatter | server | deterministic SHA-256 ID above |
| `type` | 隐藏类型 | literal `review` | no | frontmatter | server | fixed value |
| `title` | 标题 | string | no | frontmatter and H1 | server | `复习记录：<cardTitle>` |
| `cardId` | 卡片标识 | string | route selector | frontmatter | server | copied from resolved card |
| `idempotencyKey` | 幂等键 | UUID v4 | required | frontmatter | client | normalized lowercase; unique with `cardId` |
| `requestHash` | 请求摘要 | SHA-256 hex | no | frontmatter | server | detects key reuse with a different payload |
| `commitState` | 提交状态 | `pending \| committed` | no | frontmatter | server | `committed` is the transaction commit marker |
| `reviewSequence` | 复习序号 | positive integer | no | frontmatter | server | per-card monotonic order assigned under the card lock |
| `cardPath` | 卡片路径 | relative path | no | frontmatter and body | server | resolved active card path |
| `cardTitle` | 卡片标题 | string | no | frontmatter | server | copied from card |
| `cardType` | 卡片类型 | `CardType` | no | frontmatter | server | copied from card |
| `concept` | 所属概念 | string | no | both | server | copied from card |
| `feedback` | 复习反馈 | `ReviewFeedback` | required | frontmatter and body | client | validated fixed value |
| `blockType` | 本次卡点 | `BlockType` | required | frontmatter and body | client | validated fixed value |
| `reviewedAt` | 复习时间 | datetime | no | frontmatter | server | generated once at pending creation; authoritative only when committed |
| `previousNextReview` | 原下次复习 | date | no | frontmatter | server | copied before mutation |
| `previousBlockType` | 原卡点 | `BlockType \| null` | no | frontmatter | server | copied before mutation |
| `intervalDays` | 间隔天数 | `1 \| 3 \| 7 \| 14` | no | frontmatter | derived | feedback mapping |
| `nextReview` | 新下次复习 | date | no | frontmatter and body | derived | reviewed UTC date plus interval |
| `previousMastery` | 原掌握状态 | persisted mastery | no | frontmatter | server | copied before mutation |
| `nextMastery` | 新掌握状态 | persisted mastery | no | frontmatter and body | derived | feedback transition mapping |
| `previousLastAppliedReviewId` | 原已应用复习标识 | `string \| null` | no | frontmatter | server | rollback snapshot |
| `previousLastAppliedReviewSequence` | 原已应用复习序号 | `positive integer \| null` | no | frontmatter | server | rollback snapshot |
| `previousReviewAppliedAt` | 原复习应用时间 | `datetime \| null` | no | frontmatter | server | rollback snapshot |
| `previousReviewOverrideAt` | 原人工覆盖时间 | `datetime \| null` | no | frontmatter | server | rollback snapshot |
| `baseCardSha256` | 原卡片摘要 | SHA-256 hex | no | frontmatter | server | canonical card bytes before staging |
| `stagedCardSha256` | 暂存卡片摘要 | SHA-256 hex | no | frontmatter | server | canonical staged card bytes |
| `relativePath` | 记录路径 | relative path | no | no | server | response/index only; under `08-飞轮复习/` |

#### Atomic write primitive

Every transaction boundary below uses the same primitive: serialize canonical
bytes to a unique sibling temporary file, flush the file, atomically replace
the destination, and flush the containing directory when the platform permits.
The next boundary does not begin until the prior replace succeeds. A per-card
exclusive lock serializes review, PUT, archive, and rebuild repair for that
card.

#### Authoritative review commit protocol

1. Acquire the card lock and run pending/committed recovery for that card.
2. Resolve the route ID to an active reviewable card, validate the strict body,
   derive `id`, and compute `requestHash`.
3. If the deterministic record already exists:
   - a different `requestHash` returns `409 IDEMPOTENCY_KEY_REUSE`;
   - `committed` triggers any needed card finalization and returns the original
     committed result with `replayed: true`; no new history or revision is
     created;
   - `pending` retains its already assigned `reviewSequence` and resumes only
     when the current canonical card SHA-256 equals its `baseCardSha256`;
     otherwise return `409 REVIEW_RETRY_CONFLICT`.
4. For a new key, derive the next sequence while still holding the card lock:
   scan this card's committed ReviewRecords, require unique positive sequences,
   and assign `reviewSequence = 1` when none exist or
   `max(committed reviewSequence) + 1` otherwise. A different unresolved
   pending record reserves that next sequence and returns
   `409 REVIEW_PENDING_RETRY_REQUIRED`; a new key cannot skip or reuse it.
   Snapshot the card's canonical SHA-256 and all previous review-controlled
   provenance fields. Generate `reviewedAt` once, derive the transition and
   complete staged card bytes once, compute `stagedCardSha256`, and atomically
   write the complete ReviewRecord with `commitState: pending`.
5. Atomically stage the card: apply `nextReview`, `nextMastery`, and
   `blockType`; append exactly one revision whose `reviewId` is this record ID;
   set `pendingReviewId` to the record ID; leave `lastAppliedReviewId`,
   `lastAppliedReviewSequence`, `reviewAppliedAt`, and `reviewOverrideAt` at
   their previous values.
6. Atomically rewrite only the ReviewRecord `commitState` from `pending` to
   `committed`. This durable replace is the single commit point. If the replace
   reports an ambiguous I/O error, synchronously reread and strictly parse the
   deterministic record path:
   - proven `committed` is committed success;
   - proven `pending` followed by durable rollback of any staged card, or proven
     absent with the card also proven/restored to its base bytes, is a
     pre-commit failure;
   - read error, parse error, unrecognized state, or inability to prove/restore
     the card returns `503 REVIEW_COMMIT_INDETERMINATE` with
     `retryable: true`, `reviewId`, and `idempotencyKey`.
   An indeterminate response is neither success nor a proven failed review.
   The client must retain and retry the same key and must not create a new
   logical review.
7. Atomically finalize the card: keep the staged schedule/mastery/block, set
   `lastAppliedReviewId` to the record ID, set `lastAppliedReviewSequence` to
   `reviewSequence`, set `reviewAppliedAt` to `reviewedAt`, clear
   `reviewOverrideAt`, and clear `pendingReviewId`.
8. Rebuild the queue/index/graph projections. Projection failure never changes
   the committed ReviewRecord or finalized card.

The first committed response is `201`; a replay is `200`. Both contain the same
canonical `result` object (`reviewId`, `cardId`, `feedback`, `blockType`,
`reviewSequence`, `reviewedAt`, `intervalDays`, `nextReview`, `nextMastery`)
derived from the committed ReviewRecord. `replayed` and `projectionStatus` are
envelope metadata, not a different committed result.

A definitive failed-review status is returned only before step 6 or after the
step-6 reread proves pending/absent and rollback/base state is durable.
`REVIEW_COMMIT_INDETERMINATE` is explicitly not a definitive failed-review
status. After the commit marker is proven durable, card-finalization or cache
failures are reported as committed success with `projectionStatus: "stale"`
and recovery codes. If the connection is lost after commit, retrying the same
key returns the same committed result. No definitively failed review becomes
authoritative after rebuild.

After `REVIEW_COMMIT_INDETERMINATE`, retry resolution begins by rereading the
same deterministic path under the card lock. `committed` returns the original
result; `pending` resumes the same record and sequence; proven absence may
recreate only that same deterministic record/path and sequence after the card
base state is proven. If state still cannot be proven, the server repeats the
indeterminate response. It never allocates another sequence, ID, or path for
that logical review.

#### Crash recovery by boundary

Recovery runs before card reads/mutations and during explicit index rebuild:

- Before/during pending-record write: no durable record means no effect.
- After pending record, before card staging: the pending record remains
  non-authoritative; the card remains unchanged.
- After card staging, before commit marker: if the current card hash equals
  `stagedCardSha256`, restore the exact previous schedule/mastery/block and
  provenance, remove the revision with this `reviewId`, clear
  `pendingReviewId`, and atomically write the restored card. The pending record
  remains available for an identical retry. Approved API mutations cannot
  interleave because they recover under the same lock.
- After commit marker, before/during card finalization: the committed record is
  authoritative. Apply/finalize it exactly once and clear `pendingReviewId`.
- During cache rebuild: keep the committed Markdown state, quarantine/rebuild
  the failed cache, and return the committed result with a stale/recovered
  projection status.

On startup and explicit rebuild, the next sequence is recovered without a
separate counter: validate all committed records for the card and use `1` when
there are none or `max(committed reviewSequence) + 1` otherwise. Pending records
never raise the committed maximum, but an unresolved pending record retains its
reserved sequence and blocks allocation to a different key.

If a pending record's staged hash does not match the current card, recovery
reports `REVIEW_PENDING_CONFLICT` and does not overwrite externally modified
bytes. Such a record remains excluded from history. Normal UI/API updates never
produce this conflict because recovery precedes mutation.

#### Provenance, ordering, rebuild, and post-review edits

- Committed history sorts exclusively by `reviewSequence` ascending. Sequences
  are unique and monotonic per card; timestamps and IDs never break ties or
  determine order. The committed record with greatest `reviewSequence` is
  latest, and `lastReviewed` is that record's `reviewedAt`. Pending records
  never participate.
- `lastAppliedReviewId` identifies the committed record whose transition is
  currently reflected in the card. `lastAppliedReviewSequence` must equal that
  record's sequence and is the card's review floor.
- Rebuild may repair `nextReview`, `mastery`, and `blockType` only from the
  greatest committed `reviewSequence` strictly greater than
  `lastAppliedReviewSequence`. It then advances ID, sequence, and applied time
  together. It never reapplies an older/equal sequence, appends a duplicate
  review revision, or rewrites title, concept, source, related concepts, or any
  free-form card body value.
- If `reviewOverrideAt` is non-null and is later than or equal to a candidate
  record's `reviewedAt`, the manual mastery/block values win and rebuild does
  not apply that candidate. Equal timestamps favor the manual PUT.
- A successful PUT after a committed review therefore survives cache deletion
  and rebuild. Only a newly submitted, later committed review can explicitly
  supersede it; replaying the older idempotency key cannot.
- Missing/mismatched applied ID/sequence provenance, duplicate committed
  sequences, or a non-positive sequence is
  `CARD_REVIEW_PROVENANCE_INVALID`; rebuild reports it and does not guess.

Deleting `review-queue.json` and rebuilding preserves committed history and
`lastReviewed`. Any permitted provenance repair reports
`CARD_REVIEW_SUMMARY_REPAIRED`.

### 4.5 Codex task

Create input may reference source assets by opaque IDs. The five actions and
learning guardrail are fixed server templates, not client-authored authority.

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `id` | 隐藏标识 | string | no | frontmatter | server | stable UUID |
| `type` | 隐藏类型 | literal `codex-task` | no | frontmatter | server | fixed value |
| `title` | 标题 | string | no | frontmatter and H1 | server | `Codex 任务：<concept>卡点诊断` |
| `concept` | 所属概念 | string | required | frontmatter | client | trimmed, NFC, non-empty; link-safe concept rule below |
| `sourceReadingId` | 来源材料标识 | string | optional | no | client reference | opaque reading ID |
| `sourceReading` | 来源材料 | `relative path \| null` | no | frontmatter | server | resolved from ID |
| `relatedCardId` | 关联卡片标识 | string | optional | no | client reference | opaque card ID |
| `relatedCard` | 关联卡片 | `relative path \| null` | no | frontmatter | server | resolved from ID |
| `currentMaterial` | 当前材料 | string | required | body | client | non-empty |
| `understanding` | 我的理解 | string | required | body | client | may be empty |
| `blockType` | 当前卡点 | `BlockType` | required | frontmatter and body | client | one fixed value |
| `requestedActions` | 请你执行 | five-item string tuple | no | body | server | exactly the approved five ordered requests |
| `learningGuardrail` | 学习边界 | string | no | body | server | fixed “do not replace my learning” constraint |
| `createdAt` | 创建时间 | datetime | no | frontmatter | server | request commit time |
| `relativePath` | 文件路径 | relative path | no | no | server | response/index only; under `10-Codex任务/` |

## 5. Canonical Markdown wire format

### Global serialization rules

- Encoding is UTF-8 without BOM.
- Incoming body strings normalize CRLF and bare CR to LF and reject U+0000.
  After that boundary normalization, leading/trailing whitespace and every
  other byte are preserved.
- Serialized line endings are LF. Files end with exactly one LF and contain no
  extra blank line after the final body unit.
- Frontmatter opens and closes with `---` on their own lines.
- Frontmatter keys use the exact order in the matrix below.
- String scalars use JSON-compatible double-quoted escaping. Arrays use JSON
  flow syntax. Null is `null`. Multiline user content never enters frontmatter.
- The exact file skeleton is frontmatter, one empty line, and one H1. When
  mirrored link metadata exists, it follows after one empty line as contiguous
  fixed-order lines with no empty line between them. Every following H2 section
  starts after exactly one empty line, and adjacent H2 sections are separated
  by exactly one empty line. No tabs or trailing spaces are emitted on
  structural lines.
- Every free-form body value, including reading `body` and all client-authored
  card/diagnosis/Codex text, uses this length-delimited unit:

  ```text
  ## <fixed heading>
  <!-- aleksi:value bytes=<decimal UTF-8 byte count> -->
  <exact normalized value bytes>
  <!-- /aleksi:value -->
  ```

  The parser reads exactly `bytes` bytes immediately after the LF terminating
  the opening marker. It then requires exactly one structural LF followed by
  the exact closing marker. The decimal count covers only normalized value
  bytes, never either structural LF or a marker. Therefore headings, backticks,
  HTML comments, and even a literal `<!-- /aleksi:value -->` inside the value
  are data and need no escaping. For a value ending in LF, the serializer emits
  that value LF plus the separate structural LF. For `bytes=0`, zero value
  bytes occur between the opening marker's LF and the required structural LF,
  so there is exactly one empty physical line between the opening and closing
  marker lines.
- Obsidian links use `[[target]]`. Concept values, related-concept values, and
  display titles used as aliases are trimmed NFC strings and reject `|`, `[[`,
  `]]`, CR, LF, `/`, and `\`. These characters are rejected, not escaped.
  Multiple concept links join with `、`.
- Concept links are `[[<concept>]]`. Asset links are
  `[[<Vault-relative path without .md>|<display title>]]`.
- Asset link targets are server-generated normalized Vault-relative paths. They
  may contain `/` as path separators but reject `|`, `[[`, `]]`, CR, LF,
  backslash, empty segments, dot segments, and traversal.
- Optional body sections are omitted when their normalized value is empty or
  null. Required sections are emitted even when their contract permits empty
  content.
- Parsers reject duplicate frontmatter keys, duplicate reserved headings, or a
  mismatch between frontmatter concept/reference values and mirrored body
  links. They never search user value bytes for headings or delimiters.

### Serialization matrix

| Asset | Frontmatter key order | H1 | Body order |
|---|---|---|---|
| Reading | `id`, `type`, `title`, `concept`, `source`, `createdAt` | `# <title>` | required value unit `正文` |
| Concept card | shared card order below | `# 概念卡：<title>` | concept links; `原文摘录`; `正式解释`; `我的理解`; `常见误解`; `使用场景`; optional shared sections; `修订记录` |
| Definition card | shared card order below | `# 定义卡：<title>` | concept links; `原文摘录`; `正式定义`; `大白话解释`; `量词结构`; `常见误解`; optional shared sections; `修订记录` |
| Example card | shared card order below | `# 例子卡：<title>` | concept links; `原文摘录`; `例子内容`; `为什么它符合`; `它训练我什么`; optional shared sections; `修订记录` |
| Boundary card | shared card order below | `# 边界卡：<title>` | concept links; `原文摘录`; `易混对象`; `相似之处`; `关键区别`; `判断标准`; optional shared sections; `修订记录` |
| Counterexample card | shared card order below | `# 反例卡：<title>` | concept links; `原文摘录`; `反例内容`; `它破坏了哪个条件`; `为什么它不是`; optional shared sections; `修订记录` |
| Process card | shared card order below | `# 流程卡：<title>` | concept links; `原文摘录`; `任务`; `步骤`; `关键转折`; `易错点`; `使用场景`; optional shared sections; `修订记录` |
| Mistake card | shared card order below | `# 错误卡：<title>` | concept links; `原文摘录`; `错误表现`; `原来怎么想`; `真正原因`; `正确方法`; `识别信号`; optional shared sections; `修订记录` |
| Proof card | shared card order below | `# 证明卡：<title>` | concept links; `原文摘录`; `命题内容`; `我的第一次尝试`; `关键动作`; `证明骨架`; `失败原因`; optional shared sections; `修订记录` |
| Diagnosis | `id`, `type`, `title`, `concept`, `relatedCard`, `blockType`, `targetCardType`, `createdAt` | `# <title>` | concept/card links; `卡点类型`; `具体表现`; `我一开始以为的问题`; `现在判断的真实原因`; `下一步最小行动`; `要沉淀成哪类卡片` |
| ReviewRecord V1 | legacy review order below | `# <title>` | historical card/concept links; `复习反馈`; `本次卡点`; `调度结果` |
| ReviewRecord V2 | V2 evidence order below | `# <title>` | byte-count `闭卷回答`; after result, `自我纠正`; optional weak diagnosis evidence; `调度结果` |
| Codex task | `id`, `type`, `title`, `concept`, `sourceReading`, `relatedCard`, `blockType`, `createdAt` | `# <title>` | `当前材料`; `我的理解`; `当前卡点`; `请你执行`; `学习边界` |

Shared card frontmatter order:

```text
id, type, title, concept, relatedConcepts, sourceReading,
blockType, mastery, createdAt, nextReview, lastAppliedReviewId,
lastAppliedReviewSequence, reviewAppliedAt, reviewOverrideAt, pendingReviewId
```

Legacy V1 ReviewRecord frontmatter order:

```text
id, type, title, cardId, idempotencyKey, requestHash, commitState,
reviewSequence, cardPath, cardTitle, cardType, concept, feedback, blockType,
reviewedAt, previousNextReview, previousBlockType, intervalDays, nextReview,
previousMastery, nextMastery, previousLastAppliedReviewId,
previousLastAppliedReviewSequence, previousReviewAppliedAt,
previousReviewOverrideAt, baseCardSha256, stagedCardSha256
```

V2 attempted frontmatter order:

```text
schemaVersion, id, type, title, cardId, idempotencyKey,
attemptRequestHash, cardPath, cardTitle, cardType, concept, attemptedAt,
promptVersion, declaredDontKnow, confidenceBeforeReveal, durationMs,
assistanceLevel, baseCardSha256, commitState
```

V2 pending/committed records retain that attempt metadata and add:

```text
resultRequestHash, reviewSequence, feedback, blockType, reviewedAt,
evidenceQuality, diagnosisTargetCardType, previousNextReview,
previousBlockType, intervalDays, nextReview, previousMastery, nextMastery,
previousLastAppliedReviewId, previousLastAppliedReviewSequence,
previousReviewAppliedAt, previousReviewOverrideAt, stagedCardSha256
```

Shared card body details:

- Card link metadata order is
  `所属概念：[[<concept>]]`, optional
  `相关概念：[[a]]、[[b]]`.
- Diagnosis link metadata order is
  `所属概念：[[<concept>]]`, then optional
  `关联卡片：[[<relatedCard path without .md>]]`.
- Legacy V1 ReviewRecord link metadata order is
  `关联卡片：[[<cardPath without .md>|<cardTitle>]]`, then
  `所属概念：[[<concept>]]`.
- Optional shared heading order is `我的理解`, `当前卡点`, `下一步行动`.
- `修订记录` is always last. Each entry is
  `- YYYY-MM-DD：<note>` when `reviewId` is null, otherwise
  `- YYYY-MM-DD：[review:<reviewId>] <note>`.
- Legacy V1 ReviewRecord `调度结果` contains exactly three lines:
  `间隔天数：N`, `下次复习：YYYY-MM-DD`, `掌握状态：<Chinese label>`.
- V2 ReviewRecord `调度结果` contains `间隔天数：N` and
  `下次复习：YYYY-MM-DD`; mastery and evidence quality remain authoritative
  frontmatter fields.
- Codex `请你执行` is an ordered list of exactly five items.

### Normative byte-exact fixtures

For the fixture below, the bytes are exactly the UTF-8 encoding of the shown
characters, every displayed line break is byte `0A`, and there is one final
`0A` after the last closing marker. There is no BOM, CR, trailing space, or
additional blank line. The `正文` value is exactly 49 UTF-8 bytes and includes
both a reserved-looking heading and a literal closing marker:

````text
---
id: "11111111-1111-4111-8111-111111111111"
type: "reading"
title: "ε-N"
concept: "ε-N"
source: "manual-paste"
createdAt: "2026-06-22T03:14:15.926Z"
---

# ε-N

## 正文
<!-- aleksi:value bytes=49 -->
first
## 正式定义
<!-- /aleksi:value -->
last
<!-- /aleksi:value -->
````

Parsing the fixture yields
`body = "first\n## 正式定义\n<!-- /aleksi:value -->\nlast"`. Serializing that
record reproduces the fixture byte for byte. The normative link examples are
`所属概念：[[ε-N]]` and
`关联卡片：[[02-定义卡/ε-N|ε-N 定义]]`. Inputs such as `ε|N`, `a/b`,
`a\b`, `a]]b`, or a title containing CR/LF are rejected before filename or link
derivation.

The normative empty required-value unit is exactly the UTF-8 encoding of this
text, including the final LF:

```text
## 量词结构
<!-- aleksi:value bytes=0 -->

<!-- /aleksi:value -->
```

Equivalently, its exact character sequence is
`"## 量词结构\n<!-- aleksi:value bytes=0 -->\n\n<!-- /aleksi:value -->\n"`.
There are zero value bytes, then one structural LF; visually this is one blank
line between marker lines. A serializer that emits consecutive marker lines or
two blank lines is non-canonical, and the parser rejects it.

### Filename derivation

- Link validation runs first, so `/`, `\`, and `|` in a title are rejected
  consistently rather than silently changed for one use and preserved for
  another.
- User-title assets normalize the accepted title to NFC, replace the remaining
  Windows-invalid filename characters `< > : " ? *` with `-`, collapse
  repeated `-`, trim, then trim trailing dots/spaces.
- Empty names and Windows device names are rejected.
- The server selects the fixed directory by asset type.
- A collision appends `-2`, `-3`, and so on before `.md`; existing files are
  never overwritten.
- Diagnosis filenames derive from their server-generated `title`.
- Codex task filename is `<YYYY-MM-DD>-<title-slug>.md`, using the UTC date of
  `createdAt`.
- ReviewRecord filename is `<reviewId>.md`, where `reviewId` is the deterministic
  `review-` plus SHA-256 identifier. Attempted, pending, and committed rewrites
  use that same path and never create a second history file.

### Fixed Codex task requests

`requestedActions` contains exactly:

1. `判断我主要卡在：定义 / 例子 / 反例 / 证明搜索 / 技术 / 表达 / 迁移 / 情绪 哪一类。`
2. `检查这张卡片是否缺少关键条件。`
3. `给出 1 个例子候选和 1 个反例候选。`
4. `生成 1 道下一步训练题。`
5. `不要直接替我完成全部学习，只给结构、提示和训练方向。`

## 6. Index and cache schemas

### Index entry

All indexed Markdown assets persist an explicit `title`; diagnosis, review, and
Codex titles use the server-generated values above.

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `id` | 资产标识 | string | no | no | derived | parsed from asset frontmatter |
| `assetType` | 资产类型 | `reading \| CardType \| diagnosis \| review \| codex-task` | no | no | derived | known asset type only |
| `title` | 标题 | string | no | no | derived | parsed from explicit frontmatter `title` |
| `concept` | 所属概念 | `string \| null` | no | no | derived | parsed; null only when not applicable |
| `relativePath` | 文件路径 | relative path | no | no | derived | known asset directory only |
| `mastery` | 掌握状态 | `Mastery \| null` | no | no | derived | card assets only; effective mastery |
| `nextReview` | 下次复习 | `date \| null` | no | no | derived | card assets only |
| `updatedAt` | 更新时间 | datetime | no | no | derived | filesystem modification time |
| `archived` | 已归档 | boolean | no | no | derived | true only under `99-归档/` |

### Parse error entry

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `relativePath` | 文件路径 | relative path | no | no | derived | file that failed parsing |
| `code` | 错误代码 | string | no | no | server | stable diagnostic code |
| `message` | 错误说明 | string | no | no | server | user-safe message |

### Review queue item

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `cardId` | 卡片标识 | string | no | no | derived | card frontmatter |
| `cardPath` | 卡片路径 | relative path | no | no | derived | active card path |
| `cardType` | 卡片类型 | `CardType` | no | no | derived | reviewable cards only |
| `concept` | 所属概念 | string | no | no | derived | card frontmatter |
| `mastery` | 有效掌握状态 | `Mastery` | no | no | derived | mastery precedence above |
| `nextReview` | 下次复习 | date | no | no | derived | card frontmatter, repaired only by the committed provenance rules |
| `lastReviewSequence` | 上次复习序号 | `positive integer \| null` | no | no | derived | greatest committed `reviewSequence`; null before first review |
| `lastReviewed` | 上次复习 | `datetime \| null` | no | no | derived | `reviewedAt` of `lastReviewSequence` |
| `due` | 今日到期 | boolean | no | no | derived | exact due rule above |
| `prompt` | 闭卷提示 | string | no | no | server | generated from concept and card type; must not contain answer-bearing card fields |

`ReviewQueueItem` deliberately has no `card` or `revealedCard` property. The
same answer-free shape is written to `.aleksi/review-queue.json`.

### Today next response

`GET /api/today/next` returns one `nextAction` and a quiet `later` list. Each
primary action contains `kind`, `title`, `reason`, `href`, `estimatedMinutes`,
`concept`, and `count`. Allowed kinds are `due-review`, `remediation`,
`graph-gap`, `continue-reading`, and `new-reading`.

Selection priority is deterministic:

1. due review;
2. an existing Graph `currentBlock` with a nonblank `nextAction`;
3. a structured five-ring coverage gap;
4. the latest reading by `updatedAt`, then ID;
5. start a new reading.

The selector uses structured fields and never parses localized suggestion text
to infer action type. Incomplete review attempts are excluded until recovery or
abandon semantics are defined.

### Graph ring state

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `count` | 卡片数量 | non-negative integer | no | no | derived | active cards in the ring |
| `state` | 环状态 | ring-state enum | no | no | derived | deterministic precedence below |

| Ring key | Chinese label | Allowed states |
|---|---|---|
| `concept` | 概念环 | `missing`, `established`, `needs-rebuild` |
| `example` | 例子环 | `missing`, `established`, `needs-rebuild` |
| `boundary` | 边界环 | `missing`, `established`, `needs-rebuild` |
| `process` | 流程环 | `missing`, `established`, `needs-rebuild` |
| `mistake` | 错误环 | `missing`, `established`, `needs-rebuild` |

### Graph concept state

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `concept` | 概念名称 | string | no | no | derived | normalized grouping key |
| `rings` | 飞轮状态 | five ring records | no | no | derived | exact V0.2 ring keys: `concept`, `example`, `boundary`, `process`, `mistake` |
| `currentBlock` | 当前卡点 | `BlockType \| null` | no | no | derived | diagnosis ordering below |
| `nextAction` | 下一步行动 | string | no | no | derived | precedence below |
| `hasDueReview` | 复习已到期 | boolean | no | no | derived | any active card has `due = true` |
| `relatedConcepts` | 相关概念 | string[] | no | no | derived | explicit card links only |
| `suggestedNextActions` | 建议下一步 | string[] | no | no | derived | stable ordering below |

### Cache documents

`.aleksi/index.json`:

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `generatedAt` | 生成时间 | datetime | no | no | server | rebuild completion time |
| `assets` | 资产索引 | `IndexEntry[]` | no | no | derived | stable path order; every non-committed ReviewRecord is omitted |
| `parseErrors` | 解析错误 | `ParseErrorEntry[]` | no | no | derived | stable path order |

`.aleksi/review-queue.json`:

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `generatedAt` | 生成时间 | datetime | no | no | server | rebuild completion time |
| `items` | 复习队列项目 | `ReviewQueueItem[]` | no | no | derived | `nextReview`, then `cardId` ascending |

`.aleksi/graph-state.json`:

| Internal key | Chinese label | Type | Client input | Markdown | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `generatedAt` | 生成时间 | datetime | no | no | server | rebuild completion time |
| `concepts` | 概念状态 | `Record<string, GraphConceptState>` | no | no | derived | keys emitted in stable concept order |

## 7. Deterministic graph aggregation

1. Normalize concept names with trim plus Unicode NFC.
2. The node inclusion set is exact: a normalized concept becomes a node if and
   only if at least one non-archived card with type `concept`, `definition`,
   `example`, `boundary`, `counterexample`, `process`, `mistake`, or `proof`
   has that `concept`. Archived cards, readings, diagnoses, ReviewRecords,
   Codex tasks, and `relatedConcepts` alone never create nodes.
3. Active cards create and populate ring counts. Diagnoses may enrich
   `currentBlock`/`nextAction` only when their concept already has a card-created
   node. ReviewRecords affect history only; due state comes from the active card.
   Readings and Codex tasks do not enrich graph state. A related-concept edge is
   emitted only when both endpoint nodes independently exist.
4. Ring count is the number of active cards mapped to that V0.2 coverage type.
   Legacy compatibility mapping is `definition -> concept`,
   `counterexample -> boundary`, and `proof -> process`.
5. Ring state precedence:
   - no cards: `missing`;
   - any card with persisted mastery `rebuild`: `needs-rebuild`;
   - otherwise: `established`.
6. `currentBlock` comes from diagnoses sorted by `createdAt` descending, then
   `id` ascending; the first record wins.
7. `nextAction` precedence:
   - current diagnosis `nextMinimumAction`;
   - first non-empty card `nextAction` after sorting by card type
     `concept`, `definition`, `example`, `boundary`, `counterexample`,
     `process`, `mistake`, `proof`, then `id` ascending;
   - first generated suggestion;
   - empty string.
8. Suggestions use this exact priority and Chinese text:

   | Priority | Condition | Exact string |
   |---:|---|---|
   | 1 | concept `missing` | `补 1 张概念卡` |
   | 2 | concept `needs-rebuild` | `重构概念卡` |
   | 3 | example `missing` | `补 1 张例子卡` |
   | 4 | example `needs-rebuild` | `重构例子卡` |
   | 5 | boundary `missing` | `补 1 张边界卡` |
   | 6 | boundary `needs-rebuild` | `重构边界卡` |
   | 7 | process `missing` | `补 1 张流程卡` |
   | 8 | process `needs-rebuild` | `重构流程卡` |
   | 9 | mistake `missing` | `补 1 张错误卡` |
   | 10 | mistake `needs-rebuild` | `重构错误卡` |
   | 11 | `hasDueReview = true` | `完成今日到期复习` |

   A condition emits exactly one string. Duplicate strings are removed while
   preserving first occurrence.
9. Related concepts are unique and sorted by normalized UTF-16 code-unit order.
10. Concept records and SVG nodes use the same normalized UTF-16 code-unit order.
   Node layout is therefore stable for identical Markdown inputs.

For the minimum ε-N demonstration, the only card-created node has concept
`established`, the other four rings `missing`, and the complete suggestion
array is `["补 1 张例子卡", "补 1 张边界卡", "补 1 张流程卡", "补 1 张错误卡"]`.

## 8. Settings schemas

### App settings

Stored at `%APPDATA%\Aleksi Learning Workbench\settings.json`.

| Internal key | Chinese label | Type | Client input | Persisted JSON | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `activeVaultPath` | 当前 Vault 路径 | absolute path | selected through OS/settings action | yes | server | resolved, existing or creatable directory |
| `updatedAt` | 更新时间 | datetime | no | yes | server | successful settings-write time |

The app locator is written only after successful
`POST /api/vault/initialize`, `POST /api/vault/select`, or
`POST /api/vault/migrate`. `GET /api/vault/status`,
`POST /api/vault/backup`, asset mutations, index rebuild, and ordinary Settings
dialog open/close never change it. There is no general settings-update route in
V0.1.

### Vault settings

Stored at `.aleksi/settings.json`.

| Internal key | Chinese label | Type | Client input | Persisted JSON | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `schemaVersion` | Vault 结构版本 | literal `1` | no | yes | server | fixed V0.1 schema version |
| `vaultId` | Vault 标识 | UUID v4 | no | yes | server | generated on initialize; immutable identity |

The JSON object contains exactly those two keys in that order; unknown or
missing keys are invalid. Initialize creates it once and never overwrites an
existing valid identity. Select reads/validates it without mutation. Migration
copies and preserves a valid source `vaultId`; when importing a source without
Aleksi settings, it generates one only after destination copy/hash verification
succeeds. Backup copies the file as ordinary Vault content but changes neither
the live file nor `activeVaultPath`.

Settings dialog operations use these exact strict bodies:

| Route | Exact request body | Locator effect |
|---|---|---|
| `POST /api/vault/initialize` | `{ "path": "<absolute path>" }` | set to initialized Vault after success |
| `POST /api/vault/select` | `{ "path": "<absolute path>" }` | set to validated existing Vault after success |
| `POST /api/vault/migrate` | `{ "sourcePath": "...", "destinationPath": "...", "confirmed": true }` | set to verified destination after success |
| `POST /api/vault/backup` | `{ "confirmed": true }` | none |

Initialize/select confirmation is the user's Settings-dialog action and is
captured out-of-band before the request; their bodies do not contain
`confirmed`, and adding it is an unknown-field error. Migration and backup are
the only Vault routes whose bodies require literal `confirmed: true`; omission
or `false` is rejected without mutation.

These privileged path bodies are the only V0.1 exception to the asset rule
against client-supplied absolute paths. They still reject unknown fields,
traversal ambiguity, missing required migration/backup confirmation, and
symlink escapes.

## 9. Filesystem-safe timestamps and collisions

- Filesystem timestamps use UTC `yyyyMMddTHHmmssfffZ`, for example
  `20260622T031415926Z`. They contain no `:`, spaces, or local-time ambiguity.
- Corrupt cache backup:
  `<cache-base>.corrupt-<utcStamp>.json`.
- Vault backup directory:
  `Aleksi-Learning-Vault-backup-<utcStamp>`.
- Prior Desktop package:
  `aleksi-learning-workbench.previous-<utcStamp>`.
- Vault backups are created as siblings of the active Vault. Prior Desktop
  packages are renamed within `C:\Users\pcp\Desktop`.
- If a generated name already exists, append `-2`, `-3`, and so on. Never
  overwrite the earlier backup.

## 10. Desktop package manifest

The copied project contains `DESKTOP_PACKAGE_MANIFEST.json`, generated by the
packaging script, not by the browser client.

| Internal key | Chinese label | Type | Client input | Persisted JSON | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `schemaVersion` | 清单版本 | literal `1` | no | yes | server/script | fixed |
| `sourceCommit` | 来源提交 | 40-char Git SHA | no | yes | script | verified source HEAD |
| `packagedAt` | 打包时间 | datetime | no | yes | script | copy completion time |
| `destinationPath` | Desktop 目标 | absolute path | no | yes | script | exact verified destination |
| `files` | 文件清单 | `PackageFileEntry[]` | no | yes | script | copied source files only, sorted by relative path |
| `excludedDirectories` | 排除目录 | string[] | no | yes | script | exact packaging exclusion list |
| `verification` | 验证记录 | `PackageVerificationResult[]` | no | yes | script | one result per required verification step |
| `testVaultPath` | 测试 Vault | absolute path | no | yes | script | temporary verification Vault |
| `saveReceipt` | 保存回执 | `SaveReceipt` | no | yes | script | observed Desktop-package write/reload |

### Package file entry

| Internal key | Chinese label | Type | Client input | Persisted JSON | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `path` | 相对路径 | relative path | no | yes | script | copied source file; `/` separators |
| `sha256` | 文件摘要 | 64-char SHA-256 | no | yes | script | hash of copied bytes |
| `bytes` | 文件大小 | non-negative integer | no | yes | script | copied file length |

### Package verification result

| Internal key | Chinese label | Type | Client input | Persisted JSON | Authority/default | Validation |
|---|---|---|---|---|---|---|
| `name` | 验证名称 | `install \| verify \| browser \| desktop-write-reload` | no | yes | script | one result per fixed step |
| `command` | 验证命令 | string | no | yes | script | exact executed command or script action |
| `exitCode` | 退出码 | integer | no | yes | script | `0` for accepted package |
| `completedAt` | 完成时间 | datetime | no | yes | script | observed completion time |
| `evidence` | 证据摘要 | string | no | yes | script | concise observed result; non-empty |

`files` excludes `DESKTOP_PACKAGE_MANIFEST.json` itself and any content generated
after the copy, including verification-installed `node_modules`. The copied-file
exclusion list is exactly `.git`, `node_modules`, `dist`, `playwright-report`,
`test-results`, and `.superpowers`.

Desktop verification performs an exact post-verification reconciliation:

1. Re-enumerate the destination after install/tests/write-reload complete.
2. Require `DESKTOP_PACKAGE_MANIFEST.json` itself to exist and parse strictly.
3. For every `files` entry, require exactly one destination file at that path,
   recompute SHA-256 and byte length from destination bytes, and require both to
   equal the manifest. Any missing, duplicate-normalized, size-mismatched, or
   hash-mismatched entry fails verification.
4. Build the actual copied-file set by excluding only the manifest itself and
   the verification-generated `node_modules/**` tree. The actual set must equal
   the manifest path set exactly: no unlisted file and no missing listed file.
5. Require all six excluded directories to remain absent outside the permitted
   verification-generated `node_modules`.

Verification output does not amend the manifest's copied-file set. A package is
accepted only after this rehash/reconciliation succeeds.

If the Desktop destination already exists, packaging stops for explicit
confirmation. On approval it renames the whole prior folder using the timestamp
rule above, then copies a fresh tree. It never merges into or silently
overwrites the previous folder.

## 11. Evidence verification records

The Danus-inspired verification lane stores authoritative Markdown under
`10-Codex任务/验证证据/`. These nested records intentionally stay outside the global
asset index. Candidate, verdict, and revocation files are separate and immutable.

### 11.1 Candidate record

Client input contains `cardId`, `statement`, `proofAttempt`, `predecessorIds`,
`relations`, and `assistanceLevel`. Relations must cover every predecessor exactly
once and use `requires`, `proves_with`, `illustrates`, `refutes`, or `replaces`.
Unknown IDs, timestamps, paths, status, quality, and verdict fields are rejected.

| Internal key | Type | Authority/default | Rule |
|---|---|---|---|
| `schemaVersion` | literal `2` | server | v1 remains readable; all new candidates use v2 |
| `id` | `evidence-` + 64-char SHA-256 | derived | hash of the complete frozen v2 identity, excluding `createdAt` |
| `type` | literal `verification-evidence` | server | fixed |
| `title` | string | server | derived from related card title |
| `concept` | string | server | resolved from related card |
| `cardId` | UUID | client/server-resolved | opaque card selector |
| `cardPath` | Vault-relative path | server | resolved from `cardId`; never client supplied |
| `statement` | non-empty Markdown/text | client | immutable candidate claim |
| `cardRevision` | integer | server | frozen revision count when submitted |
| `cardContentHash` | 64-char SHA-256 | server | hash of exact card Markdown bytes when submitted |
| `sourceReadingId` | UUID or null | server | resolved source reading identity |
| `sourceReadingContentHash` | 64-char SHA-256 or null | server | exact source Markdown hash |
| `sourceExcerpt` | string | server | exact excerpt frozen from the card source field |
| `sourceLocator` | string or null | server | optional frozen page/locator metadata |
| `proofAttempt` | non-empty Markdown/text | client | immutable learner output |
| `predecessorIds` | unique evidence IDs | client/server-validated | submitted order is frozen; every predecessor must be accepted and unaffected |
| `relations` | typed relation array | client/server-validated | exactly one relation per predecessor, in matching order; target card is resolved and frozen |
| `assistanceLevel` | `none \| hint \| source \| ai` | client | learner self-report of help used before submission; not independently observed |
| `evidenceQuality` | `independent \| assisted` | derived | independent only when the self-reported assistance is `none` |
| `createdAt` | UTC datetime | server | excluded from content hash |

Submitting identical hash inputs is an idempotent replay. A revised proof creates
a different candidate ID and a new Markdown file; the old candidate is preserved.
Every read recomputes the candidate ID and `evidenceQuality`. A manual edit that
changes hashed content or contradicts the assistance-derived quality fails with
`INVALID_EVIDENCE_FILE`; it never inherits the old verdict. Later edits to the
card or reading do not rewrite the frozen candidate context.

### 11.2 Verdict record

Client input contains exactly `verifierKind`, `verificationReport`, `verdict`,
`repairHints`, and `confirmed`. `confirmed` must be true for GPT Plus imports.

| Internal key | Type | Authority/default | Rule |
|---|---|---|---|
| `id` | `verdict-` + 64-char SHA-256 | derived | hash of candidate ID and complete verdict input |
| `type` | literal `verification-verdict` | server | fixed |
| `schemaVersion` | literal `2` | server | v1 remains readable; all new verdicts use v2 |
| `candidateId` | evidence ID | route/server | target immutable candidate |
| `verifierKind` | `ai-review \| human-review \| gpt-plus-import` | client | explicit provenance, never formal-proof authority |
| `verificationReport.summary` | non-empty string | client | concise result |
| `verificationReport.criticalErrors` | `{location, issue}[]` | client/server-validated | every item is non-empty |
| `verificationReport.gaps` | `{location, issue}[]` | client/server-validated | every item is non-empty |
| `verdict` | `correct \| wrong` | client/server-validated | `correct` iff both finding arrays are empty |
| `repairHints` | string | client/server-validated | empty for `correct`; non-empty for `wrong` |
| `verifiedAt` | UTC datetime | server | excluded from verdict hash |

One candidate accepts one immutable verdict. An identical retry replays; a
| `confirmedByUser` | boolean | server | true only when client confirmation is explicit |
| `formalProof` | literal `false` | server | GPT/AI/human review is not a formal certificate |
different second verdict receives HTTP 409 instead of overwriting history. The
service also re-applies the strict verdict schema and recomputes the verdict ID
on every read, so edited findings, repair hints, or verdicts cannot retain the
old accepted identity.

### 11.3 Revocation and knowledge projection

An accepted candidate can receive one append-only revocation record containing
the target ID, reason, UTC revocation time, and a content-addressed ID. Replaying
the same reason is idempotent; a different reason conflicts instead of rewriting
history. The derived projection performs a transitive traversal over predecessor
edges. The root becomes `revoked`; all reachable dependents become `affected` and
carry the root ID, immediate upstream ID, full propagation path, reason, and time.
Affected/revoked candidates cannot be used as new predecessors.

Derived evidence fields are:

- `status = awaiting-verification` when no verdict exists;
- `status = accepted` for a `correct` verdict;
- `status = repair-needed` for a `wrong` verdict;
- `status = revoked` for the direct revocation target;
- `status = affected` for every transitive dependent;
- compatibility field `qualifiesForMastery = false` in all states.

The card-level knowledge projection exposes `activeEvidenceIds`, `trustState`,
`prerequisites`, and `usedBy`. `trustState` is `unverified`, `supported`,
`independently-supported`, or `under-review`. It never mutates or schedules card
mastery; no card Markdown migration is required.
