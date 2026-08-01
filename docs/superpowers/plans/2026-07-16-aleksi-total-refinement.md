# Aleksi Workbench Total Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the current Aleksi Learning Workbench into a reading-first, evidence-grounded local application with one-launch splash behavior, Card Markdown v2, read-only projections, interpretable Topic Flywheel semantics, and a build-identified Windows runtime.

**Architecture:** Keep React, Express, Markdown canonical storage, disposable JSON projections, and the browser-based Windows runtime. Add focused HTTP, persistence, projection, and runtime-lifecycle boundaries inside the existing tree; update existing feature routes in place and delete superseded helpers, sample initialization, CSS aliases, and duplicated flywheel UI.

**Tech Stack:** React 19, React Router, TanStack Query, Express 5, Zod, gray-matter, Vitest, Testing Library, Playwright, Vite, esbuild, Windows PowerShell runtime launcher.

---

## Baseline and boundaries

- Current source root: `work/aleksi-learning-workbench`; no Git metadata is present, so verification artifacts and the source-package manifest are the change boundary.
- Baseline `npm.cmd run verify`: 33 test files, 349 passed, 1 Windows `EPERM` symlink-creation skip, TypeScript and Vite production build passed.
- Baseline `npm.cmd run test:browser`: 3/3 Chromium journeys passed.
- The sandbox blocks the Vite/esbuild child process with `spawn EPERM`; repository verification must run outside that sandbox without changing source to hide the environment restriction.
- The product remains one application with one local server, one Markdown source of truth, one semantic token vocabulary, and one version/build identity.

### Task 1: Central HTTP error boundary

**Files:**
- Create: `server/http/async-route.ts`
- Create: `server/http/error-mapper.ts`
- Create: `server/http/error-response.ts`
- Modify: `server/app.ts`
- Modify: `server/routes/cards.ts`
- Modify: `server/routes/codex.ts`
- Modify: `server/routes/diagnoses.ts`
- Modify: `server/routes/graph.ts`
- Modify: `server/routes/index-rebuild.ts`
- Modify: `server/routes/readings.ts`
- Modify: `server/routes/review.ts`
- Modify: `server/routes/today.ts`
- Modify: `server/routes/vault.ts`
- Modify: `server/routes/verification.ts`
- Test: `tests/server/http-errors.test.ts`
- Test: `tests/server/app-smoke.test.ts`

- [ ] **Step 1: Write central-error tests that currently fail**

```ts
it.each([
  ["validation", 400, "INVALID_REQUEST_BODY"],
  ["not-found", 404, "CARD_NOT_FOUND"],
  ["conflict", 409, "CARD_UPDATE_CONFLICT"],
  ["storage", 500, "STORAGE_WRITE_FAILED"],
  ["unknown", 500, "INTERNAL_SERVER_ERROR"]
])("maps %s failures once", async (_label, status, code) => {
  const response = await request(createApp()).post(testRouteFor(code)).send({});
  expect(response.status).toBe(status);
  expect(response.body).toEqual({ error: expect.objectContaining({ code }) });
});
```

- [ ] **Step 2: Run the focused tests and confirm duplicated route-local mapping remains visible**

Run: `npm.cmd run test -- tests/server/http-errors.test.ts tests/server/app-smoke.test.ts`  
Expected: new mapping tests fail before `server/http/*` exists.

- [ ] **Step 3: Add the focused HTTP boundary**

```ts
export function asyncRoute(handler: AsyncRequestHandler): RequestHandler {
  return (request, response, next) => {
    void Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export type ErrorResponse = {
  status: number;
  body: { error: { code: string; message: string } };
};

export function errorMiddleware(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction
): void {
  const failure = mapHttpError(error);
  response.status(failure.status).json(failure.body);
}
```

Routes parse, call one service, and return success; `server/app.ts` mounts `errorMiddleware` after all API and static routes. Development logs retain unknown stacks, while production responses never include absolute paths or stack text.

- [ ] **Step 4: Delete every route-local `errorResponse` and `handle` implementation**

Run: `rg -n "function errorResponse|async function handle" server/routes`  
Expected: no matches.

- [ ] **Step 5: Run HTTP, API, and app smoke tests**

Run: `npm.cmd run test -- tests/server/http-errors.test.ts tests/server/app-smoke.test.ts tests/api`  
Expected: representative validation, not-found, conflict, storage, payload-size, and unknown errors pass with existing user-visible status meaning.

### Task 2: Focused persistence helpers

**Files:**
- Create: `server/lib/error-code.ts`
- Create: `server/persistence/library-context.ts`
- Create: `server/persistence/markdown-value.ts`
- Create: `server/persistence/save-receipt.ts`
- Modify: `server/config/app-settings.ts`
- Modify: `server/lib/atomic-write.ts`
- Modify: `server/lib/filename.ts`
- Modify: `server/lib/markdown-codec.ts`
- Modify: `server/services/card-service.ts`
- Modify: `server/services/codex-task-service.ts`
- Modify: `server/services/diagnosis-service.ts`
- Modify: `server/services/index-service.ts`
- Modify: `server/services/reading-service.ts`
- Modify: `server/services/review-service.ts`
- Modify: `server/services/vault-service.ts`
- Modify: `server/services/verification-store.ts`
- Test: `tests/server/persistence-boundaries.test.ts`

- [ ] **Step 1: Write exact helper-contract tests**

```ts
expect(hasErrorCode(Object.assign(new Error("x"), { code: "ENOENT" }), "ENOENT")).toBe(true);
expect(markdownFrontmatterValue("汉字\nmath $x$"))
  .toBe(JSON.stringify("汉字\nmath $x$"));
expect(createSaveReceipt("02-概念卡/a.md", absolutePath, modifiedAt))
  .toEqual({ relativePath: "02-概念卡/a.md", absolutePath, modifiedAt });
await expect(activeLearningLibrary()).resolves.toBe(resolve(vaultPath));
```

- [ ] **Step 2: Run the focused test and confirm the new modules are absent**

Run: `npm.cmd run test -- tests/server/persistence-boundaries.test.ts`  
Expected: import failures for the four new focused modules.

- [ ] **Step 3: Move one implementation of each concept into its owning module**

```ts
export function hasErrorCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof Error && "code" in error &&
    typeof error.code === "string" && codes.includes(error.code);
}

export async function activeLearningLibrary(): Promise<string> {
  const settings = await readAppSettings();
  if (settings === null) throw new VaultServiceError(
    "ACTIVE_VAULT_NOT_CONFIGURED",
    "No active local learning library is configured"
  );
  const path = resolvePrivilegedAbsolutePath(settings.activeVaultPath);
  await assertInitializedVault(path);
  return path;
}
```

`markdown-value.ts` owns canonical frontmatter/value-unit serialization only; `save-receipt.ts` owns the shared receipt type and constructor only. No `utils.ts` or dependency-injection layer is created.

- [ ] **Step 4: Import the focused helpers and delete duplicates**

Run: `rg -n "function (isErrorCode|frontmatterString|saveReceipt)|async function activeVault" server`  
Expected: no duplicate definitions outside their owner modules.

- [ ] **Step 5: Run persistence, API, path, atomic-write, and verification-store tests**

Run: `npm.cmd run test -- tests/server tests/api tests/shared`  
Expected: existing behavior and path safety remain green.

### Task 3: Card Markdown schema version 2 and explicit migration

**Files:**
- Modify: `server/domain/schemas.ts`
- Modify: `server/domain/types.ts`
- Modify: `server/lib/markdown-codec.ts`
- Modify: `server/services/card-service.ts`
- Modify: `server/services/review-service.ts`
- Modify: `docs/DATA_SCHEMA.md`
- Test: `tests/server/markdown-codec.test.ts`
- Test: `tests/api/cards.test.ts`
- Test: `tests/api/review.test.ts`

- [ ] **Step 1: Add failing v1/v2 compatibility and recovery cases**

```ts
expect(parseCardMarkdown(v1Markdown).schemaVersion).toBe(1);
const v2 = serializeCardMarkdown({ ...v1Card, schemaVersion: 2 });
expect(v2).toContain("schemaVersion: 2");
expect(v2).toContain("## 闭卷重述");
expect(v2).toContain("## 整合理解");
expect(parseCardMarkdown(v2)).toEqual({ ...v1Card, schemaVersion: 2 });
```

The same test file covers Chinese Unicode, tables, KaTeX source, missing optional sections, malformed frontmatter, duplicate headings, unknown compatible frontmatter metadata, invalid UTF-8, and atomic update failure recovery.

- [ ] **Step 2: Run codec and card API tests and confirm v2 cases fail**

Run: `npm.cmd run test -- tests/server/markdown-codec.test.ts tests/api/cards.test.ts tests/api/review.test.ts`  
Expected: missing `schemaVersion` and ambiguous-heading expectations fail.

- [ ] **Step 3: Add version-aware card records and headings**

```ts
const recordCommonShape = {
  schemaVersion: z.union([z.literal(1), z.literal(2)]).default(1),
  compatibleMetadata: z.record(z.unknown()).default({}),
  // existing fields remain unchanged
};

const V2_RESTATEMENT_HEADING = "闭卷重述";
const V2_INTEGRATED_HEADING = "整合理解";
```

The parser recognizes the current unversioned v1 layout and the explicit v2 layout. Serialization follows `card.schemaVersion`; new records and every update set `schemaVersion: 2`. Compatible unknown frontmatter JSON values are round-tripped in stable key order without overriding reserved fields.

- [ ] **Step 4: Make updates the explicit safe migration boundary**

```ts
const updated = cardRecordSchema.parse({
  ...existing,
  ...clientFields,
  schemaVersion: 2,
  revisionLog: [...existing.revisionLog, revision]
});
```

No bulk rewrite route is added. Failed update and review writes restore the exact original bytes before returning an error.

- [ ] **Step 5: Run all codec, card, review, index, and graph tests**

Run: `npm.cmd run test -- tests/server/markdown-codec.test.ts tests/api/cards.test.ts tests/api/review.test.ts tests/server/index-service.test.ts tests/server/graph-service.test.ts`  
Expected: v1 reads, v2 round trips, updates migrate, and rollback tests pass.

### Task 4: Read-only projection reads and explicit rebuilds

**Files:**
- Create: `server/projections/projection-file.ts`
- Modify: `server/services/index-service.ts`
- Modify: `server/services/graph-service.ts`
- Modify: `server/services/review-service.ts`
- Modify: `server/services/today-service.ts`
- Modify: `server/routes/graph.ts`
- Modify: `server/routes/review.ts`
- Modify: `server/routes/index-rebuild.ts`
- Test: `tests/server/index-service.test.ts`
- Test: `tests/server/graph-service.test.ts`
- Test: `tests/server/review-service.test.ts`
- Test: `tests/server/today-service.test.ts`
- Test: `tests/api/graph.test.ts`

- [ ] **Step 1: Add failing filesystem-write-count tests**

```ts
const first = await readGraphProjection(vaultPath);
const firstMtime = (await stat(graphPath)).mtimeMs;
const second = await readGraphProjection(vaultPath);
expect(second).toEqual(first);
expect((await stat(graphPath)).mtimeMs).toBe(firstMtime);
```

Companion cases modify one Markdown file, delete/corrupt each projection, and verify recovery plus a new projection timestamp.

- [ ] **Step 2: Run projection tests and confirm GET-style reads rewrite files**

Run: `npm.cmd run test -- tests/server/index-service.test.ts tests/server/graph-service.test.ts tests/server/review-service.test.ts tests/api/graph.test.ts`  
Expected: unchanged-read mtime assertions fail.

- [ ] **Step 3: Add source fingerprints and read/rebuild pairs**

```ts
export async function readIndexProjection(vaultPath: string): Promise<IndexDocument>;
export async function rebuildIndex(vaultPath: string): Promise<RebuildIndexResult>;
export async function readGraphProjection(vaultPath: string): Promise<GraphStateDocument>;
export async function rebuildGraphState(vaultPath: string): Promise<GraphStateDocument>;
export async function readReviewProjection(vaultPath?: string): Promise<ReviewQueueDocument>;
export async function rebuildReviewQueue(vaultPath?: string): Promise<ReviewQueueDocument>;
```

`IndexDocument.sourceFingerprint` is a stable SHA-256 over candidate relative path, size, and mtime. Graph and review documents store the source index fingerprint. A read returns the valid fresh file unchanged; missing, corrupt, or stale data invokes the matching rebuild exactly once.

- [ ] **Step 4: Route all GET paths through read operations**

`GET /api/graph/state`, `GET /api/review/today`, and `getTodayNext()` use read methods. Explicit rebuild endpoints and learning-data write operations continue to rebuild or invalidate predictably.

- [ ] **Step 5: Run projection, Today, API, corrupt-recovery, and repeated-read tests**

Run: `npm.cmd run test -- tests/server/index-service.test.ts tests/server/graph-service.test.ts tests/server/review-service.test.ts tests/server/today-service.test.ts tests/api/graph.test.ts tests/api/index-rebuild.test.ts`  
Expected: repeated reads make no persistent writes; changes and corruption refresh correctly.

### Task 5: Runtime build identity and lifecycle capabilities

**Files:**
- Create: `server/runtime/build-identity.ts`
- Create: `server/runtime/lifecycle.ts`
- Create: `server/routes/runtime.ts`
- Modify: `server/app.ts`
- Modify: `server/start-server.ts`
- Modify: `scripts/package-runtime.mjs`
- Modify: `scripts/audit-runtime.mjs`
- Modify: `scripts/verify-runtime.mjs`
- Modify: `scripts/runtime-package-rules.mjs`
- Modify: `src/features/settings/SettingsDialog.tsx`
- Test: `tests/server/runtime-lifecycle.test.ts`
- Test: `tests/server/app-smoke.test.ts`
- Test: `tests/scripts/delivery-scripts.test.ts`
- Test: `tests/ui/today-settings.test.tsx`

- [ ] **Step 1: Add failing health/build/lifecycle tests**

```ts
expect((await request(app).get("/api/health")).body).toEqual({
  ok: true,
  service: "aleksi-workbench",
  version: "0.1.0",
  buildId: expect.stringMatching(/^[a-z0-9.-]+$/)
});
```

Launcher source tests require version/build checks before reuse, a fresh `launch` nonce for every browser open, 30-day date-log retention, and Settings actions labelled `打开本地学习库`, `导出诊断`, and `退出 Aleksi Workbench`.

- [ ] **Step 2: Run runtime and script tests and confirm identity fields are absent**

Run: `npm.cmd run test -- tests/server/runtime-lifecycle.test.ts tests/server/app-smoke.test.ts tests/scripts/delivery-scripts.test.ts tests/ui/today-settings.test.tsx`  
Expected: health, manifest, reuse, and lifecycle-capability assertions fail.

- [ ] **Step 3: Use package version plus generated content build ID**

```ts
export type BuildIdentity = { version: string; buildId: string };

export function runtimeBuildIdentity(env = process.env): BuildIdentity {
  return {
    version: env.ALEKSI_APP_VERSION ?? packageJson.version,
    buildId: env.ALEKSI_BUILD_ID ?? `dev-${packageJson.version}`
  };
}
```

`package-runtime.mjs` hashes the packaged `app/server.js` plus sorted `app/dist` files once. It writes the same `version` and `buildId` into the runtime manifest, launcher constants, process environment, instance file, logs, and health comparison.

- [ ] **Step 4: Add explicit local lifecycle endpoints and UI actions**

`POST /api/runtime/open-library` opens only the validated active learning-library path in Windows Explorer. `GET /api/runtime/diagnostics` downloads sanitized JSON containing identity, mode, health, and bounded log tails without user learning content. `POST /api/runtime/exit` responds before invoking the registered server-close callback and is enabled only in packaged runtime mode.

- [ ] **Step 5: Add log retention and stale-build rejection**

The launcher deletes only date logs matching `yyyy-MM-dd.log` older than 30 days, caps copied diagnostic tails, and rejects reuse when health, instance metadata, executable, command line, version, or build ID differs.

- [ ] **Step 6: Run runtime-focused tests**

Run: `npm.cmd run test -- tests/server/runtime-lifecycle.test.ts tests/server/app-smoke.test.ts tests/scripts/delivery-scripts.test.ts tests/ui/today-settings.test.tsx`  
Expected: identity, sanitized diagnostics, explicit exit, retention, and stale-build tests pass.

### Task 6: One-launch splash and automatic Today entry

**Files:**
- Create: `src/features/entrance/launch-token.ts`
- Create: `src/features/entrance/LaunchSplash.tsx`
- Modify: `src/app/App.tsx`
- Delete: `src/features/entrance/EntrancePage.tsx`
- Modify: `src/styles/workbench.css`
- Modify: `scripts/package-runtime.mjs`
- Test: `tests/ui/launch-splash.test.tsx`
- Test: `tests/browser/entrance-overview.spec.ts`
- Test: `tests/scripts/delivery-scripts.test.ts`

- [ ] **Step 1: Add failing launch-token cases**

```ts
expect(launchState("/?launch=fresh-token", sessionStorage)).toEqual({ show: true });
expect(launchState("/today", sessionStorage)).toEqual({ show: false });
expect(consumeLaunchToken("fresh-token", sessionStorage)).toBe(true);
expect(consumeLaunchToken("fresh-token", sessionStorage)).toBe(false);
```

Browser cases cover first launcher invocation, refresh, route navigation, second nonce, reduced motion, and backend-unavailable error visibility.

- [ ] **Step 2: Run launch tests and confirm the manual entrance page remains**

Run: `npm.cmd run test -- tests/ui/launch-splash.test.tsx tests/scripts/delivery-scripts.test.ts`  
Expected: missing launch-token modules and manual-entry assertions fail.

- [ ] **Step 3: Render a dedicated bounded splash only for an unconsumed nonce**

```tsx
return showSplash ? (
  <LaunchSplash durationMs={reducedMotion ? 120 : 960} onComplete={enterToday} />
) : (
  <WorkbenchShell />
);
```

Completion uses `navigate("/today", { replace: true })`, removing the query token. A normal `/` visit redirects to `/today` without introduction copy or an entry button.

- [ ] **Step 4: Make every launcher browser open use a new nonce**

PowerShell generates `[guid]::NewGuid().ToString('N')` and opens `/?launch=<nonce>` for both a new process and a reused process. The server starts independently, so a health failure remains visible in launcher logs and does not wait on frontend animation.

- [ ] **Step 5: Run unit and browser launch acceptance**

Run: `npm.cmd run test -- tests/ui/launch-splash.test.tsx tests/scripts/delivery-scripts.test.ts`  
Run: `npm.cmd run test:browser -- tests/browser/entrance-overview.spec.ts`  
Expected: splash plays once per nonce, never on refresh/navigation, and reduced motion passes.

### Task 7: Reading-first Reader and two-level selection menu

**Files:**
- Create: `src/features/reader/ReaderToolsDrawer.tsx`
- Create: `src/features/reader/SelectionActions.tsx`
- Modify: `src/features/reader/ReaderPage.tsx`
- Modify: `src/features/reader/ReadingForm.tsx`
- Modify: `src/features/reader/selection.ts`
- Modify: `src/styles/components.css`
- Test: `tests/ui/reader.test.tsx`
- Test: `tests/ui/safety-accessibility.test.tsx`
- Test: `tests/browser/epsilon-n-flow.spec.ts`

- [ ] **Step 1: Add failing layout and menu semantics**

```ts
expect(screen.getByRole("toolbar", { name: "选区动作" }))
  .toHaveTextContent("摘录创建卡片记录困难");
expect(within(toolbar).getAllByRole("button")).toHaveLength(3);
await user.click(within(toolbar).getByRole("button", { name: "创建卡片" }));
expect(screen.getByRole("menu", { name: "选择卡片类型" }))
  .toHaveTextContent("概念例子边界流程错误");
```

Tests also assert the material list and empty excerpt basket are collapsed controls by default, import is a drawer/sheet, Escape closes and returns focus, and half-screen Reader keeps an article width of at least 480px without horizontal overflow.

- [ ] **Step 2: Run Reader tests and confirm current permanent columns/seven actions fail**

Run: `npm.cmd run test -- tests/ui/reader.test.tsx tests/ui/safety-accessibility.test.tsx`  
Expected: default-layout and exact-three-action assertions fail.

- [ ] **Step 3: Recompose Reader around the manuscript**

The article is the only permanent content column. `材料` and `摘录篮 · N` controls open a project-native overlay drawer or narrow bottom sheet. `+ 新材料` opens the import form in that layer, so no form or list changes article width.

- [ ] **Step 4: Use one measured selection-placement strategy**

`selection.ts` returns the DOM range rectangle only. `SelectionActions.tsx` measures its own rendered bounds, clamps against `visualViewport`, and switches to a fixed bottom sheet below the narrow breakpoint. It handles Arrow keys, Enter, Escape, focus return, and viewport resize without hardcoded 520px estimates or final CSS offsets.

- [ ] **Step 5: Preserve import, basket, card transfer, and diagnosis transfer**

The three first-level actions map to basket, card-type submenu, and diagnosis. Existing `ReaderSelectionPayload`, file import, duplicate replace/keep, session basket, and unsaved guard remain the data contracts.

- [ ] **Step 6: Run Reader tests and required browser widths**

Run: `npm.cmd run test -- tests/ui/reader.test.tsx tests/ui/reader-selection-transfer.test.ts tests/ui/safety-accessibility.test.tsx tests/ui/reading-import.test.ts`  
Expected: all Reader contracts pass.

### Task 8: Deep card workflow with durable save state

**Files:**
- Create: `src/features/cards/card-save-state.ts`
- Create: `src/features/cards/CardSectionNav.tsx`
- Modify: `src/features/cards/CardEditor.tsx`
- Modify: `src/features/cards/CardStudioPage.tsx`
- Modify: `src/features/cards/card-draft.ts`
- Modify: `src/styles/components.css`
- Test: `tests/ui/card-diagnosis.test.tsx`
- Test: `tests/ui/safety-accessibility.test.tsx`
- Test: `tests/api/cards.test.ts`

- [ ] **Step 1: Add failing state-transition and review-dead-end tests**

```ts
expect(cardSaveState({ saving: false, receipt: null, dirty: true })).toBe("unsaved");
expect(cardSaveState({ saving: true, receipt: null, dirty: true })).toBe("saving");
expect(cardSaveState({ saving: false, receipt, dirty: false })).toBe("saved");
expect(cardSaveState({ saving: false, receipt, dirty: true })).toBe("modified-after-save");
```

UI tests require the four-section orientation nav, viewport-near confirmation, persistent primary-button state, editable saved fields, save failure, and no enabled `去复习` button when the saved card is not due.

- [ ] **Step 2: Run card tests and confirm the current binary saved/unsaved UI fails**

Run: `npm.cmd run test -- tests/ui/card-diagnosis.test.tsx tests/ui/safety-accessibility.test.tsx`  
Expected: save-state and review-destination assertions fail.

- [ ] **Step 3: Add stable section anchors and save state**

```ts
export type CardSaveState =
  | "unsaved" | "saving" | "saved" | "modified-after-save" | "save-failed";
```

`CardSectionNav` links to source, restatement, structured fields, and next action without hiding earlier sections. The top success panel and primary button share the same derived state; saving updates the clean snapshot, subsequent edits become `modified-after-save`, and failure retains the draft.

- [ ] **Step 4: Replace the empty review dead end**

The save response or card detail exposes `nextReview`. When due today, show `开始今日复习`; otherwise show the next due date plus `预览复习格式`, which opens a meaningful card-specific preview without pretending the due queue contains the new card.

- [ ] **Step 5: Keep v2, all eight readable card types, and deep fields intact**

No card field or legacy read path is removed. New/updated files write v2; source, closed-book restatement, type fields, and next action remain the primary cognitive sequence.

- [ ] **Step 6: Run card UI/API/codec regression**

Run: `npm.cmd run test -- tests/ui/card-diagnosis.test.tsx tests/ui/safety-accessibility.test.tsx tests/api/cards.test.ts tests/server/markdown-codec.test.ts`  
Expected: orientation, all save states, meaningful next actions, v1 read, and v2 write pass.

### Task 9: Interpretable Topic Flywheel and direct actions

**Files:**
- Modify: `server/services/graph-service.ts`
- Modify: `src/features/graph/flywheel-state.ts`
- Modify: `src/features/graph/FlywheelGraph.tsx`
- Modify: `src/features/graph/WheelGraphPage.tsx`
- Modify: `src/features/reader/reader-selection-transfer.ts`
- Modify: `src/styles/components.css`
- Test: `tests/server/graph-service.test.ts`
- Test: `tests/ui/flywheel-state.test.ts`
- Test: `tests/ui/review-graph.test.tsx`
- Test: `tests/browser/epsilon-n-flow.spec.ts`

- [ ] **Step 1: Add failing semantic tests that reject false precision**

```ts
expect(deriveFlywheelStages(concept).map(({ coverage, learningStatus }) => ({ coverage, learningStatus })))
  .toEqual([
    { coverage: "established", learningStatus: "learning" },
    { coverage: "missing", learningStatus: "not-started" },
    { coverage: "missing", learningStatus: "not-started" },
    { coverage: "missing", learningStatus: "not-started" },
    { coverage: "missing", learningStatus: "not-started" }
  ]);
expect(screen.queryByText(/\d+%/u)).not.toBeInTheDocument();
expect(screen.getByText("覆盖：1 / 5 个维度已建立")).toBeInTheDocument();
```

- [ ] **Step 2: Run graph tests and confirm arbitrary 34/58/100 percentages fail**

Run: `npm.cmd run test -- tests/server/graph-service.test.ts tests/ui/flywheel-state.test.ts tests/ui/review-graph.test.tsx`  
Expected: false-precision absence and coverage-label assertions fail.

- [ ] **Step 3: Separate structural coverage, learning status, and evidence confidence**

```ts
type StructuralCoverage = "missing" | "established" | "needs-repair";
type LearningStatus =
  | "not-started" | "established" | "learning" | "due-for-review"
  | "verified" | "needs-repair";
```

Counts establish structural coverage; review scheduling/mastery and accepted evidence determine learning status. The UI shows counts and interpretable labels. It does not convert one card into mastery or fabricate zero-card progress.

- [ ] **Step 4: Strengthen the loop and remove duplicate status blocks**

Keep the 3+2 geometry, visible restrained arrows, semantic solid/dashed segments, central core, and emphasized Error→Concept return. Delete `RingSummary`. The standard desktop detail becomes compact/contextual; narrow layouts use a bottom sheet.

- [ ] **Step 5: Wire the recommended action to grounded work**

Graph links include the selected concept and stage. The Reader or Card Studio receives a feature-local transfer payload with the correct card type and any available reading context; no recommendation opens an unrelated generic screen.

- [ ] **Step 6: Run graph and browser regression**

Run: `npm.cmd run test -- tests/server/graph-service.test.ts tests/ui/flywheel-state.test.ts tests/ui/review-graph.test.tsx`  
Expected: interpretable coverage/state and direct-action tests pass.

### Task 10: Terminology, relation selection, and empty production libraries

**Files:**
- Delete: `demo-vault-template/01-readings/sequence-limit-epsilon-n.md`
- Delete: `demo-vault-template/01-readings`
- Delete: `demo-vault-template`
- Modify: `server/services/vault-service.ts`
- Modify: `src/app/routes.tsx`
- Modify: `src/features/diagnosis/DiagnosisPage.tsx`
- Modify: `src/features/review/ReviewPage.tsx`
- Modify: `src/features/cards/CardStudioPage.tsx`
- Modify: `src/features/verification/VerificationPage.tsx`
- Modify: `src/features/settings/SettingsDialog.tsx`
- Modify: `README.md`
- Modify: `docs/current/PROJECT_MAP.md`
- Modify: `tests/api/vault.test.ts`
- Modify: `tests/api/readings.test.ts`
- Modify: `tests/ui/today-settings.test.tsx`
- Modify: `tests/ui/card-diagnosis.test.tsx`
- Modify: `tests/ui/verification.test.tsx`
- Modify: `tests/scripts/delivery-scripts.test.ts`

- [ ] **Step 1: Add failing user-language and clean-library assertions**

```ts
expect(await readdir(join(cleanLibrary, READING_DIRECTORY))).toEqual([]);
expect(await readdir(join(cleanLibrary, CARD_DIRECTORIES.concept))).toEqual([]);
expect(screen.queryByText(/Vault|UUID|关联卡片 ID|飞轮复习/u)).not.toBeInTheDocument();
```

Package tests reject `demo-vault-template`, production fixture names, and non-test sample cards/readings.

- [ ] **Step 2: Run Vault/UI/package tests and confirm samples/raw IDs remain**

Run: `npm.cmd run test -- tests/api/vault.test.ts tests/ui/card-diagnosis.test.tsx tests/ui/verification.test.tsx tests/scripts/delivery-scripts.test.ts`  
Expected: clean-library, raw-ID, and sample-package assertions fail.

- [ ] **Step 3: Initialize only the required empty directory tree and metadata**

Remove demo-writing code and the production template directory. Test fixtures remain under `tests/fixtures`; individual tests create the learning data they require.

- [ ] **Step 4: Use consistent product terms**

Normal UI uses `本地学习库`, `今日复习`, and `主题飞轮`. Internal API paths and established server class names may retain `vault` for backward compatibility, but no ordinary screen treats it as the user concept.

- [ ] **Step 5: Replace raw relation IDs with card selection**

Diagnosis and verification use the existing recent-card endpoint plus accessible searchable/select controls. Ordinary trust summaries show card titles/counts, not sliced UUIDs. Deep links may continue carrying opaque IDs internally.

- [ ] **Step 6: Run clean-library, compatibility, terminology, and package tests**

Run: `npm.cmd run test -- tests/api/vault.test.ts tests/api/readings.test.ts tests/ui/today-settings.test.tsx tests/ui/card-diagnosis.test.tsx tests/ui/verification.test.tsx tests/scripts/delivery-scripts.test.ts`  
Expected: empty initialization, no sample progress, and user-facing terminology pass.

### Task 11: Semantic-token and CSS responsibility convergence

**Files:**
- Create: `src/styles/primitives.css`
- Create: `src/features/reader/reader.css`
- Create: `src/features/cards/cards.css`
- Create: `src/features/graph/flywheel.css`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/base.css`
- Modify: `src/styles/components.css`
- Modify: `src/styles/workbench.css`
- Modify: `src/markdown/MarkdownTheme.css`
- Test: `tests/ui/app-shell.test.tsx`
- Test: `tests/ui/reader.test.tsx`
- Test: `tests/ui/review-graph.test.tsx`
- Test: `tests/ui/safety-accessibility.test.tsx`

- [ ] **Step 1: Add failing token/selector inventory tests**

```ts
for (const token of [
  "--canvas", "--paper", "--surface-subtle", "--text-primary",
  "--text-secondary", "--border-subtle", "--accent", "--danger", "--success"
]) expect(tokens).toContain(token);
for (const alias of ["--bg", "--clay", "--surface", "--text-strong", "--line"])
  expect(activeCss).not.toContain(`var(${alias})`);
expect(activeCss).not.toContain(".claude-card");
expect(activeCss).not.toContain("!important");
```

- [ ] **Step 2: Run style-contract tests and record every active alias/compatibility selector**

Run: `npm.cmd run test -- tests/ui/app-shell.test.tsx tests/ui/reader.test.tsx tests/ui/review-graph.test.tsx tests/ui/safety-accessibility.test.tsx`  
Expected: legacy-token and broad-card assertions fail before migration.

- [ ] **Step 3: Move active selectors by responsibility and migrate usages**

`tokens.css` contains semantic values only. `primitives.css` owns buttons, fields, status, drawers, surfaces, and focus. Reader/Card/Flywheel files own their feature selectors. `components.css` retains only genuinely shared components and shrinks rather than receiving final overrides.

- [ ] **Step 4: Delete aliases and obsolete overrides after the final usage is gone**

Run: `rg -n "var\(--(bg|surface|text-strong|text-muted|line|clay)|\.claude-card|!important" src --glob "*.css" --glob "*.tsx"`  
Expected: no active compatibility-token, broad-card, or hot-patch matches.

- [ ] **Step 5: Run visual-contract, keyboard, reduced-motion, and full type tests**

Run: `npm.cmd run typecheck`  
Run: `npm.cmd run test -- tests/ui`  
Expected: semantic token inventory, focus, motion, layout, Reader, Card, and Flywheel tests pass.

### Task 12: Full data, browser, runtime, and delivery proof

**Files:**
- Modify: `tests/browser/entrance-overview.spec.ts`
- Modify: `tests/browser/epsilon-n-flow.spec.ts`
- Modify: `scripts/verify-runtime.mjs`
- Modify: `scripts/verify-clean-base.mjs`
- Modify: `design-qa.md`
- Create: `docs/current/TOTAL_REFINEMENT_20260716.md`
- Generate: `artifacts/aleksi-learning-workbench-source.zip`
- Generate: `artifacts/AleksiWorkbench-Preview-win-x64.zip`
- Generate: `artifacts/total-refinement-screenshots/*`
- Deliver: `outputs/AleksiWorkbench-Total-Refinement-*20260716*`

- [ ] **Step 1: Extend the real browser path**

The Playwright path covers launcher-token splash, Today, import, Reader drawer, text selection, the three-action menu, Concept card v2, all four editor sections, saved state, Topic Flywheel, direct Example action, second dimension, due-review behavior, excerpt basket, difficulty recording, and zero console/page errors.

- [ ] **Step 2: Add required width and failure-state assertions**

Capture and assert no overflow/clipping at 1920×1080, 1440×900, 1366×768, 720×900 split-screen, and 768×1024 tablet-like width. Exercise reduced motion, backend unavailable, corrupt projection recovery, port conflict, repeated launch, stale-build rejection, and explicit exit.

- [ ] **Step 3: Run the full repository gate**

Run: `npm.cmd run verify`  
Expected: typecheck, all Vitest files, and production build pass; the Windows symlink permission skip remains explicitly visible if the OS still denies test symlink creation.

- [ ] **Step 4: Run clean-base and browser gates**

Run: `npm.cmd run verify:clean-base`  
Run: `npm.cmd run test:browser`  
Expected: extracted-source health and idempotent repack pass; all browser journeys pass with empty error collection.

- [ ] **Step 5: Run runtime package proof**

Run: `npm.cmd run verify:runtime`  
Expected: package audit, first launch, version/build-identified health, same-build reuse, new-build stale-process rejection, launch nonce, diagnostics, explicit exit, and safe shutdown pass.

- [ ] **Step 6: Perform the data-safety matrix on disposable libraries**

Initialize an empty Chinese-path library, copy an existing fixture library, create/edit/reopen all five primary card types, read a v1 card, write v2, restart, rebuild projections, corrupt and recover projections, render tables/math, inject atomic-write failures, and confirm original Markdown bytes survive.

- [ ] **Step 7: Compare the included reference and implementation in one visual input**

Open `artifacts/total-refinement-incoming/current-flywheel-real-screenshot.png` beside the same-state implementation capture. Inspect fonts, geometry, loop direction, Error→Concept return, central core, details, narrow Reader, Card save state, focus, and reduced motion. Fix all P0–P2 findings; `design-qa.md` ends exactly `final result: passed`.

- [ ] **Step 8: Package and audit the final five artifacts**

Produce source ZIP, Windows runtime ZIP, screenshot ZIP, concise verification record, and SHA-256 manifest. Audit archive boundaries and contents after the final copy; verify every checksum from the delivered files. Record exact changed files, architecture decisions, v1→v2 migration behavior, command results, limitations, and output paths in `docs/current/TOTAL_REFINEMENT_20260716.md` and the final Codex response.

## Plan self-review

- Spec coverage: launch, Reader, selection menu, card depth/save, flywheel semantics/actions, terminology, samples, HTTP, persistence, Card v2, projections, build identity, lifecycle, tokens, data safety, responsive visual proof, and packaging each map to an executable task.
- Placeholder scan: no unresolved placeholder, deferred implementation marker, parallel app, database, Electron, cloud requirement, additional agent, or speculative feature remains in the plan.
- Type consistency: `schemaVersion`, `compatibleMetadata`, projection fingerprints, `BuildIdentity`, `CardSaveState`, `StructuralCoverage`, and `LearningStatus` are defined before their consumers and use one name throughout.
- Execution mode: inline in the current Codex session, because the delivery brief requires one integrated refinement and the current collaboration policy does not authorize subagent dispatch.
