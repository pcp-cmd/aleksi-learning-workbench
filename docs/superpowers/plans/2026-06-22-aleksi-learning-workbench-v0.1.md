# Aleksi Learning Workbench V0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a Windows-first local learning workbench that turns one mathematical-analysis reading into durable Markdown cards, diagnoses, reviews, Codex tasks, and a concept flywheel graph.

**Architecture:** A React/TypeScript Vite client talks only to an Express/TypeScript service bound to `127.0.0.1`. Markdown files in the active Vault are authoritative; Zod-validated JSON files are rebuildable indexes and caches. All file mutations use containment checks and atomic sibling-file replacement.

**Tech Stack:** Node.js 22, TypeScript, React 19, Vite, Express, Zod, gray-matter, react-markdown, remark-math, rehype-katex, Vitest, Testing Library, Supertest, Playwright, CSS.

---

## File Structure

The implementation should create this structure. Each file has one primary responsibility.

```text
aleksi-learning-workbench/
├── docs/
│   ├── UI_REUSE_MAP.md
│   ├── DATA_SCHEMA.md
│   ├── V0.1_ACCEPTANCE.md
│   └── superpowers/
│       ├── plans/2026-06-22-aleksi-learning-workbench-v0.1.md
│       └── specs/2026-06-22-aleksi-learning-workbench-v0.1-design.md
├── demo-vault-template/
│   └── 01-阅读材料/数列极限-epsilon-n-定义.md
├── scripts/
│   ├── start-workbench.ps1
│   └── verify-desktop-package.ps1
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   ├── routes.tsx
│   │   └── query-client.ts
│   ├── components/
│   │   ├── ActionBand.tsx
│   │   ├── ContextDrawer.tsx
│   │   ├── MarkdownMath.tsx
│   │   ├── NavigationRail.tsx
│   │   ├── SaveReceipt.tsx
│   │   └── StatusDot.tsx
│   ├── features/
│   │   ├── cards/
│   │   │   ├── CardEditor.tsx
│   │   │   ├── CardStudioPage.tsx
│   │   │   └── card-draft.ts
│   │   ├── diagnosis/DiagnosisPage.tsx
│   │   ├── graph/
│   │   │   ├── FlywheelGraph.tsx
│   │   │   └── WheelGraphPage.tsx
│   │   ├── reader/
│   │   │   ├── ReaderPage.tsx
│   │   │   ├── ReadingForm.tsx
│   │   │   └── selection.ts
│   │   ├── review/ReviewPage.tsx
│   │   ├── settings/SettingsDialog.tsx
│   │   └── today/TodayPage.tsx
│   ├── lib/
│   │   ├── api-client.ts
│   │   ├── date.ts
│   │   └── unsaved-guard.ts
│   ├── styles/
│   │   ├── base.css
│   │   ├── components.css
│   │   ├── tokens.css
│   │   └── workbench.css
│   ├── main.tsx
│   └── vite-env.d.ts
├── server/
│   ├── app.ts
│   ├── index.ts
│   ├── config/app-settings.ts
│   ├── domain/
│   │   ├── schemas.ts
│   │   └── types.ts
│   ├── lib/
│   │   ├── atomic-write.ts
│   │   ├── filename.ts
│   │   ├── markdown-codec.ts
│   │   └── path-safety.ts
│   ├── routes/
│   │   ├── cards.ts
│   │   ├── codex.ts
│   │   ├── diagnoses.ts
│   │   ├── graph.ts
│   │   ├── index-rebuild.ts
│   │   ├── readings.ts
│   │   ├── review.ts
│   │   └── vault.ts
│   └── services/
│       ├── card-service.ts
│       ├── codex-task-service.ts
│       ├── diagnosis-service.ts
│       ├── graph-service.ts
│       ├── index-service.ts
│       ├── reading-service.ts
│       ├── review-service.ts
│       └── vault-service.ts
├── tests/
│   ├── api/
│   ├── browser/
│   │   └── epsilon-n-flow.spec.ts
│   ├── fixtures/
│   │   └── epsilon-n-reading.md
│   ├── server/
│   ├── setup.ts
│   └── temp-vault.ts
├── .env.example
├── .gitignore
├── index.html
├── package.json
├── package-lock.json
├── playwright.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vite.config.ts
└── vitest.config.ts
```

## Task 1: Freeze UI Reuse and Data Contracts

**Files:**
- Create: `docs/UI_REUSE_MAP.md`
- Create: `docs/DATA_SCHEMA.md`
- Create: `docs/V0.1_ACCEPTANCE.md`
- Reference only: `C:\Users\pcp\Desktop\pcp-cmd.github.io.zip`
- Reference only: `E:\ALEKSI_LEARNING_WORKBENCH_V0.1_HANDOFF.md`

- [ ] **Step 1: Write `UI_REUSE_MAP.md`**

Record exact source-to-target mappings:

```markdown
# UI Reuse Map

| Aleksi source | Workbench use | Preserve | Exclude |
|---|---|---|---|
| `assets/css/tokens.css` | `src/styles/tokens.css` | dark surface, warm text, clay accent, type scale | public-site aliases not used by the app |
| `.claude-card` | learning cards and context cards | thin border, no glow, 1px lift | exhibition stacking |
| `.reading-row.is-selected` | selected reading/card/review item | clay left mark and soft wash | portfolio metadata |
| `.graph-panel` | flywheel graph surface | dark research-board field and detail panel | free topology editing |
| page entrance | route entrance | short fade/translate | long-running decorative loops |

## Layout decision

- Narrow left navigation rail.
- Reading-first central workspace.
- Bottom action band with current object, current block, next action.
- Right context drawer opens on demand.
```

- [ ] **Step 2: Write `DATA_SCHEMA.md`**

Define stable internal keys while documenting their Chinese UI labels:

```markdown
# Data Schema

## Shared card metadata

| Internal key | Chinese label | Type | Required |
|---|---|---:|---:|
| `id` | 隐藏标识 | string | yes |
| `type` | 卡片类型 | `definition@example@counterexample@proof` | yes |
| `title` | 卡片标题 | string | yes |
| `concept` | 所属概念 | string | yes |
| `relatedConcepts` | 相关概念 | string[] | no |
| `sourceReading` | 来源材料 | relative path | yes |
| `excerpt` | 原文摘录 | string | yes |
| `understanding` | 我的理解 | string | no |
| `blockType` | 当前卡点 | block enum | no |
| `nextAction` | 下一步行动 | string | no |
| `mastery` | 掌握状态 | mastery enum | yes |
| `createdAt` | 创建时间 | ISO datetime | yes |
| `nextReview` | 下次复习 | ISO date | yes |
| `revisionLog` | 修订记录 | revision[] | yes |
```

Include equivalent tables for reading, four card payloads, diagnosis, review item,
graph concept state, Codex task, index, and settings.

- [ ] **Step 3: Write executable acceptance IDs**

Create `docs/V0.1_ACCEPTANCE.md` with stable IDs:

```markdown
# V0.1 Acceptance

- `ACC-READ-01`: A Markdown reading renders inline and block KaTeX.
- `ACC-SELECT-01`: Selecting reader text exposes exactly five actions.
- `ACC-CARD-01`: A definition card is written as Obsidian-readable Markdown.
- `ACC-DIAG-01`: A diagnosis records one of eight block types.
- `ACC-REVIEW-01`: Review feedback changes `nextReview` by 1/3/7/14 days.
- `ACC-GRAPH-01`: 数列极限 reports definition present and three missing rings.
- `ACC-CODEX-01`: A Codex task Markdown file is generated.
- `ACC-SAFE-01`: No API operation can escape the active Vault.
- `ACC-RECOVER-01`: Corrupt JSON is backed up and rebuilt.
- `ACC-DESKTOP-01`: The verified project is copied to the Desktop destination.
```

- [ ] **Step 4: Verify the documents contain no scope drift**

Run:

```powershell
rg -n "account|cloud sync|AI API|Electron|OCR|PDF parser|free drag|infinite canvas" docs
```

Expected: matches appear only in explicit non-goal statements.

- [ ] **Step 5: Commit**

```powershell
git add docs/UI_REUSE_MAP.md docs/DATA_SCHEMA.md docs/V0.1_ACCEPTANCE.md
git commit -m "docs: freeze workbench UI and data contracts"
```

## Task 2: Scaffold the TypeScript Application and Test Harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `server/index.ts`
- Create: `tests/setup.ts`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create the package manifest**

Use these scripts and dependencies:

```json
{
  "name": "aleksi-learning-workbench",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently -k \"npm:dev:server\" \"npm:dev:client\"",
    "dev:client": "vite --host 127.0.0.1",
    "dev:server": "tsx watch server/index.ts",
    "build": "tsc -b && vite build",
    "start": "tsx server/index.ts",
    "typecheck": "tsc -b --pretty false",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:browser": "playwright test",
    "verify": "npm run typecheck && npm run test && npm run build"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.80.0",
    "express": "^5.1.0",
    "gray-matter": "^4.0.3",
    "katex": "^0.16.22",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-markdown": "^10.1.0",
    "react-router-dom": "^7.6.0",
    "rehype-katex": "^7.0.1",
    "remark-math": "^6.0.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.52.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.3.0",
    "@types/express": "^5.0.0",
    "@types/node": "^22.15.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@types/supertest": "^6.0.0",
    "@vitejs/plugin-react": "^4.4.0",
    "concurrently": "^9.1.0",
    "jsdom": "^26.1.0",
    "supertest": "^7.1.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0",
    "vite": "^6.3.0",
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 2: Create compiler and test configuration**

Create `tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

Create `tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "tests/ui"]
}
```

Create `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["server", "tests/server", "tests/api", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

Create `vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:5174"
    }
  }
});
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    restoreMocks: true
  }
});
```

UI test files must start with:

```ts
// @vitest-environment jsdom
```

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } }
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
```

- [ ] **Step 3: Install dependencies**

Run:

```powershell
npm install
npx playwright install chromium
```

Expected: `package-lock.json` exists and Chromium installation exits 0.

- [ ] **Step 4: Add a failing server smoke test**

Create `tests/server/app-smoke.test.ts`:

```ts
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";

describe("local server", () => {
  it("reports health without exposing a public bind", async () => {
    const response = await request(createApp()).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, service: "aleksi-workbench" });
  });
});
```

- [ ] **Step 5: Run the smoke test and verify failure**

Run:

```powershell
npm test -- tests/server/app-smoke.test.ts
```

Expected: FAIL because `server/app.ts` does not exist.

- [ ] **Step 6: Implement the minimum Express app**

Create `server/app.ts`:

```ts
import express from "express";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, service: "aleksi-workbench" });
  });
  return app;
}
```

Create `server/index.ts`:

```ts
import { createApp } from "./app";

const port = Number(process.env.ALEKSI_SERVER_PORT ?? 5174);
createApp().listen(port, "127.0.0.1", () => {
  console.log(`Aleksi local service: http://127.0.0.1:${port}`);
});
```

- [ ] **Step 7: Run verification**

Run:

```powershell
npm test -- tests/server/app-smoke.test.ts
npm run typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 8: Commit**

```powershell
git add package.json package-lock.json tsconfig*.json vite.config.ts vitest.config.ts playwright.config.ts index.html src server tests .gitignore .env.example
git commit -m "build: scaffold local workbench application"
```

## Task 3: Define Domain Schemas and Markdown Round Trips

**Files:**
- Create: `server/domain/types.ts`
- Create: `server/domain/schemas.ts`
- Create: `server/lib/markdown-codec.ts`
- Test: `tests/server/markdown-codec.test.ts`

- [ ] **Step 1: Write the failing round-trip test**

```ts
import { describe, expect, it } from "vitest";
import { parseCardMarkdown, serializeCardMarkdown } from "../../server/lib/markdown-codec";

describe("card Markdown codec", () => {
  it("round-trips a definition card with Obsidian links", () => {
    const card = {
      id: "definition-sequence-limit",
      type: "definition" as const,
      title: "数列极限",
      concept: "数列极限",
      relatedConcepts: ["ε-N定义", "收敛"],
      sourceReading: "01-阅读材料/数列极限-epsilon-n-定义.md",
      excerpt: "对任意 ε > 0，存在 N...",
      understanding: "尾部最终进入任意小邻域。",
      blockType: "proof-search" as const,
      nextAction: "补一个反例",
      mastery: "learning" as const,
      createdAt: "2026-06-22T00:00:00.000Z",
      nextReview: "2026-06-23",
      revisionLog: [{ at: "2026-06-22", note: "第一次创建。" }],
      formalDefinition: "∀ε>0...",
      plainExplanation: "任意精度都能满足。",
      quantifierStructure: "∀ε ∃N ∀n",
      commonMisunderstandings: "N 依赖 ε。"
    };

    expect(parseCardMarkdown(serializeCardMarkdown(card))).toEqual(card);
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```powershell
npm test -- tests/server/markdown-codec.test.ts
```

Expected: FAIL because the codec and schemas are missing.

- [ ] **Step 3: Implement enums and discriminated schemas**

In `server/domain/schemas.ts`, define:

```ts
import { z } from "zod";

export const BlockTypeSchema = z.enum([
  "definition", "example", "counterexample", "proof-search",
  "technical", "expression", "transfer", "emotion"
]);

export const MasterySchema = z.enum([
  "learning", "due", "mastered", "rebuild", "archived"
]);

const RevisionSchema = z.object({
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().min(1)
});

const BaseCardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  concept: z.string().min(1),
  relatedConcepts: z.array(z.string()).default([]),
  sourceReading: z.string().min(1),
  excerpt: z.string(),
  understanding: z.string(),
  blockType: BlockTypeSchema.nullable().default(null),
  nextAction: z.string(),
  mastery: MasterySchema,
  createdAt: z.string().datetime(),
  nextReview: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  revisionLog: z.array(RevisionSchema)
});

export const DefinitionCardSchema = BaseCardSchema.extend({
  type: z.literal("definition"),
  formalDefinition: z.string(),
  plainExplanation: z.string(),
  quantifierStructure: z.string(),
  commonMisunderstandings: z.string()
});
```

Add complete `ExampleCardSchema`, `CounterexampleCardSchema`, and `ProofCardSchema`,
then export `CardSchema` as a discriminated union and inferred types from
`server/domain/types.ts`.

- [ ] **Step 4: Implement serialization and parsing**

`serializeCardMarkdown` must write Chinese headings, frontmatter metadata, Obsidian
links, type-specific sections, and revision entries. `parseCardMarkdown` must map
the same headings back through `CardSchema.parse`.

- [ ] **Step 5: Run the codec tests**

Run:

```powershell
npm test -- tests/server/markdown-codec.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add one round-trip test per remaining card type**

Expected: all four card types preserve every field exactly.

- [ ] **Step 7: Commit**

```powershell
git add server/domain server/lib/markdown-codec.ts tests/server/markdown-codec.test.ts
git commit -m "feat: define card schemas and Markdown codec"
```

## Task 4: Implement Safe Paths, Filenames, and Atomic Writes

**Files:**
- Create: `server/lib/path-safety.ts`
- Create: `server/lib/filename.ts`
- Create: `server/lib/atomic-write.ts`
- Test: `tests/server/file-safety.test.ts`

- [ ] **Step 1: Write failing security tests**

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertInsideRoot } from "../../server/lib/path-safety";
import { sanitizeWindowsFilename } from "../../server/lib/filename";

describe("file safety", () => {
  it("rejects traversal outside the Vault", () => {
    const root = path.resolve("C:/vault");
    expect(() => assertInsideRoot(root, path.resolve(root, "../escape.md")))
      .toThrow("PATH_OUTSIDE_VAULT");
  });

  it("sanitizes Windows-invalid and reserved names", () => {
    expect(sanitizeWindowsFilename('数列:极限?')).toBe("数列-极限");
    expect(() => sanitizeWindowsFilename("CON")).toThrow("RESERVED_WINDOWS_NAME");
  });
});
```

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- tests/server/file-safety.test.ts
```

Expected: FAIL because utilities are missing.

- [ ] **Step 3: Implement containment and filename rules**

`assertInsideRoot` must use resolved paths plus a separator boundary, reject root
escape, and reject symlink-resolved destinations outside the Vault. Filename rules
must replace `< > : " / \ | ? *`, trim trailing dots/spaces, reject empty names,
and reject Windows device names.

- [ ] **Step 4: Implement atomic UTF-8 writes**

Expose:

```ts
export async function atomicWriteText(target: string, content: string): Promise<{
  path: string;
  modifiedAt: string;
}>;
```

Write to a unique sibling `.<name>.<pid>.tmp`, open with exclusive creation, sync,
close, rename over the target, and clean up the temporary file on failure.

- [ ] **Step 5: Add an atomic-write preservation test**

Simulate a failed replacement and assert the previous target content remains
unchanged and no `.tmp` file remains.

- [ ] **Step 6: Run tests and commit**

```powershell
npm test -- tests/server/file-safety.test.ts
git add server/lib tests/server/file-safety.test.ts
git commit -m "feat: secure Vault file mutations"
```

## Task 5: Initialize, Select, Migrate, and Back Up Vaults

**Files:**
- Create: `server/config/app-settings.ts`
- Create: `server/services/vault-service.ts`
- Create: `server/routes/vault.ts`
- Create: `tests/temp-vault.ts`
- Test: `tests/api/vault.test.ts`

- [ ] **Step 1: Write failing Vault API tests**

Test that:

```ts
it("initializes the required folder tree without overwriting an existing demo");
it("persists the active Vault path in the app settings file");
it("reports readOnly true when the Vault is not writable");
it("copies migration into an empty destination after confirmation");
it("creates a timestamped backup outside the live Vault");
```

Use `tests/temp-vault.ts` to create and remove only test-owned temporary directories.

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- tests/api/vault.test.ts
```

Expected: FAIL because the route is not registered.

- [ ] **Step 3: Implement app settings**

Resolve `%APPDATA%\Aleksi Learning Workbench\settings.json`, with an environment
override `ALEKSI_APP_SETTINGS_DIR` for tests. Store:

```ts
type AppSettings = {
  activeVaultPath: string;
  updatedAt: string;
};
```

- [ ] **Step 4: Implement Vault initialization**

Create the exact folder tree from the design, `.aleksi` JSON files, and the single
demo reading only when absent. Return:

```ts
type VaultStatus = {
  path: string;
  initialized: boolean;
  writable: boolean;
  readOnlyReason: string | null;
  lastSaveAt: string | null;
};
```

- [ ] **Step 5: Implement migration and backup**

Migration copies into a new empty destination, verifies file counts and SHA-256
hashes, then updates app settings. Backup creates
`Aleksi-Learning-Vault-backup-YYYYMMDD-HHmmss`.

- [ ] **Step 6: Register routes**

Mount:

```text
GET  /api/vault/status
POST /api/vault/initialize
POST /api/vault/select
POST /api/vault/migrate
POST /api/vault/backup
```

- [ ] **Step 7: Run tests and commit**

```powershell
npm test -- tests/api/vault.test.ts
git add server/config server/services/vault-service.ts server/routes/vault.ts server/app.ts tests
git commit -m "feat: manage local learning Vaults"
```

## Task 6: Build Rebuildable Indexes

**Files:**
- Create: `server/services/index-service.ts`
- Create: `server/routes/index-rebuild.ts`
- Test: `tests/server/index-service.test.ts`
- Test: `tests/api/index-rebuild.test.ts`

- [ ] **Step 1: Write a failing rebuild test**

Create two Markdown fixtures in a temporary Vault and assert:

```ts
expect(index.assets).toHaveLength(2);
expect(index.assets[0]).toMatchObject({
  type: "reading",
  concept: "数列极限"
});
```

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- tests/server/index-service.test.ts
```

Expected: FAIL because `rebuildIndex` is missing.

- [ ] **Step 3: Implement index scanning**

Scan only the known asset directories, parse frontmatter, record relative paths,
skip archived assets from active lists, and preserve parse errors as diagnostic
entries instead of aborting the rebuild.

- [ ] **Step 4: Implement corrupt-cache recovery**

Before reading a cache, validate it. On failure, rename it to
`index.corrupt-<timestamp>.json`, rebuild from Markdown, and return
`recoveredFromCorruption: true`.

- [ ] **Step 5: Add and test `POST /api/index/rebuild`**

Expected response:

```json
{
  "ok": true,
  "assetCount": 2,
  "parseErrorCount": 0,
  "recoveredFromCorruption": false
}
```

- [ ] **Step 6: Commit**

```powershell
git add server/services/index-service.ts server/routes/index-rebuild.ts server/app.ts tests
git commit -m "feat: rebuild Vault indexes from Markdown"
```

## Task 7: Create and Read Mathematical Readings

**Files:**
- Create: `server/services/reading-service.ts`
- Create: `server/routes/readings.ts`
- Create: `demo-vault-template/01-阅读材料/数列极限-epsilon-n-定义.md`
- Create: `tests/fixtures/epsilon-n-reading.md`
- Test: `tests/api/readings.test.ts`

- [ ] **Step 1: Write failing reading API tests**

Assert that creating a reading:

- writes frontmatter and body;
- returns a relative path and real modification time;
- renders unchanged Markdown source on read;
- resolves filename collisions without overwriting;
- rejects an empty title or concept.

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- tests/api/readings.test.ts
```

- [ ] **Step 3: Implement reading create/list/get**

Use Zod:

```ts
const ReadingInputSchema = z.object({
  title: z.string().trim().min(1),
  concept: z.string().trim().min(1),
  body: z.string().min(1),
  source: z.literal("manual-paste").default("manual-paste")
});
```

Save under `01-阅读材料`, rebuild the index after a successful write, and return a
save receipt.

- [ ] **Step 4: Add the ε-N demonstration material**

The fixture must include:

```markdown
行内公式：$x_n \to a$

$$
\forall \varepsilon > 0,\ \exists N,\ \forall n > N,\ |x_n-a|<\varepsilon
$$
```

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -- tests/api/readings.test.ts
git add server/services/reading-service.ts server/routes/readings.ts server/app.ts demo-vault-template tests
git commit -m "feat: persist mathematical readings"
```

## Task 8: Create, Update, and Archive Four Card Types

**Files:**
- Create: `server/services/card-service.ts`
- Create: `server/routes/cards.ts`
- Test: `tests/api/cards.test.ts`

- [ ] **Step 1: Write failing card API tests**

Cover:

```ts
it.each(["definition", "example", "counterexample", "proof"])(
  "creates an Obsidian-readable %s card"
);
it("updates a card and appends a dated revision entry");
it("archives a card by moving it under 99-归档");
it("does not expose a permanent delete route");
```

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- tests/api/cards.test.ts
```

- [ ] **Step 3: Implement card create/get/update**

Validate with the discriminated `CardSchema`, map each card type to its fixed
directory, serialize Markdown, and return:

```ts
type SaveReceipt = {
  relativePath: string;
  absolutePath: string;
  modifiedAt: string;
};
```

- [ ] **Step 4: Implement archive**

Move the Markdown file into `99-归档/<original-folder>/`, set mastery to
`archived`, append the archive revision, and rebuild indexes.

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -- tests/api/cards.test.ts
git add server/services/card-service.ts server/routes/cards.ts server/app.ts tests
git commit -m "feat: manage durable learning cards"
```

## Task 9: Persist Diagnoses and Generate Codex Tasks

**Files:**
- Create: `server/services/diagnosis-service.ts`
- Create: `server/services/codex-task-service.ts`
- Create: `server/routes/diagnoses.ts`
- Create: `server/routes/codex.ts`
- Test: `tests/api/diagnosis-codex.test.ts`

- [ ] **Step 1: Write failing tests**

Assert a diagnosis accepts exactly the eight block types and writes all required
Chinese sections. Assert a Codex task includes current material, understanding,
block, five requested actions, and the “do not replace my learning” constraint.

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- tests/api/diagnosis-codex.test.ts
```

- [ ] **Step 3: Implement diagnosis persistence**

Store under `06-卡点诊断` with links to concept and associated card.

- [ ] **Step 4: Implement Codex task generation**

Store under `09-Codex任务` with a date-prefixed filename. No route may call an AI
service or parse an AI response automatically.

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -- tests/api/diagnosis-codex.test.ts
git add server/services server/routes server/app.ts tests/api/diagnosis-codex.test.ts
git commit -m "feat: save diagnoses and Codex task files"
```

## Task 10: Implement Review Scheduling and Durable Review Records

**Files:**
- Create: `server/services/review-service.ts`
- Create: `server/routes/review.ts`
- Create: `src/lib/date.ts`
- Test: `tests/server/review-service.test.ts`
- Test: `tests/api/review.test.ts`

- [ ] **Step 1: Write the failing schedule table test**

```ts
it.each([
  ["forgot", 1],
  ["fuzzy", 3],
  ["known", 7],
  ["fluent", 14]
] as const)("schedules %s by %i days", (result, days) => {
  expect(nextReviewDate("2026-06-22", result)).toBe(addDays("2026-06-22", days));
});
```

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- tests/server/review-service.test.ts
```

- [ ] **Step 3: Implement deterministic UTC-safe date logic**

Use date-only parsing and formatting; do not rely on local-midnight `Date`
construction that can cross a timezone boundary.

- [ ] **Step 4: Implement review queue rebuild and result mutation**

`GET /api/review/today` returns due active cards. `POST /api/review/:id/result`
updates the card's `nextReview`, mastery, selected block type, and revision log,
then rebuilds `review-queue.json`.

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -- tests/server/review-service.test.ts tests/api/review.test.ts
git add server/services/review-service.ts server/routes/review.ts src/lib/date.ts server/app.ts tests
git commit -m "feat: schedule flywheel reviews"
```

## Task 11: Generate the Concept Flywheel State

**Files:**
- Create: `server/services/graph-service.ts`
- Create: `server/routes/graph.ts`
- Test: `tests/server/graph-service.test.ts`
- Test: `tests/api/graph.test.ts`

- [ ] **Step 1: Write a failing graph-gap test**

```ts
expect(state.concepts["数列极限"]).toMatchObject({
  rings: {
    definition: "established",
    example: "missing",
    counterexample: "missing",
    proof: "missing"
  },
  suggestedNextActions: ["补 1 张例子卡", "补 1 张反例卡"]
});
```

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- tests/server/graph-service.test.ts
```

- [ ] **Step 3: Implement aggregation**

Aggregate active cards by concept. Treat `rebuild` mastery as `needs-rebuild`.
Choose the most recent diagnosis as current block, and expose due-review status.
Related-concept edges come only from explicit card links.

- [ ] **Step 4: Cache and expose graph state**

Write `.aleksi/graph-state.json` after rebuild and mount `GET /api/graph/state`.

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -- tests/server/graph-service.test.ts tests/api/graph.test.ts
git add server/services/graph-service.ts server/routes/graph.ts server/app.ts tests
git commit -m "feat: calculate concept flywheel gaps"
```

## Task 12: Build the Reading-First Application Shell

**Files:**
- Create: `src/app/App.tsx`
- Create: `src/app/routes.tsx`
- Create: `src/app/query-client.ts`
- Create: `src/components/NavigationRail.tsx`
- Create: `src/components/ActionBand.tsx`
- Create: `src/components/ContextDrawer.tsx`
- Create: `src/components/StatusDot.tsx`
- Create: `src/lib/api-client.ts`
- Create: `src/styles/tokens.css`
- Create: `src/styles/base.css`
- Create: `src/styles/components.css`
- Create: `src/styles/workbench.css`
- Test: `tests/ui/app-shell.test.tsx`

- [ ] **Step 1: Write a failing shell test**

```tsx
render(<App />);
expect(screen.getByRole("navigation", { name: "学习模块" })).toBeInTheDocument();
expect(screen.getByLabelText("当前行动")).toHaveTextContent("下一步行动");
expect(screen.queryByRole("complementary", { name: "详细上下文" })).not.toBeVisible();
```

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- tests/ui/app-shell.test.tsx
```

- [ ] **Step 3: Implement the shell**

Create a narrow six-item rail, route outlet, three-cell bottom action band, and
an accessible drawer controlled by a button with `aria-expanded`.

- [ ] **Step 4: Port only approved visual tokens**

Use the exact established dark/warm/clay values from `docs/UI_REUSE_MAP.md`.
Cards use thin borders, no glow, at most `translateY(-2px)`, and reduced-motion
media queries.

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -- tests/ui/app-shell.test.tsx
npm run typecheck
git add src tests/ui/app-shell.test.tsx
git commit -m "feat: add reading-first workbench shell"
```

## Task 13: Implement Today and Settings Surfaces

**Files:**
- Create: `src/features/today/TodayPage.tsx`
- Create: `src/features/settings/SettingsDialog.tsx`
- Create: `src/components/SaveReceipt.tsx`
- Test: `tests/ui/today-settings.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Assert Today displays main concept, one minimum action, due-review count, flywheel
gaps, frequent block types, last save time, and Vault path. Assert Settings can
initialize, select, migrate, and back up a Vault with confirmation.

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- tests/ui/today-settings.test.tsx
```

- [ ] **Step 3: Implement Today from API data**

Do not add charts. Empty states must point to creating the first reading.

- [ ] **Step 4: Implement Settings and read-only state**

Show the real path, writeability, read-only reason, and latest save receipt.
Migration and backup use explicit confirmation dialogs.

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -- tests/ui/today-settings.test.tsx
git add src/features/today src/features/settings src/components/SaveReceipt.tsx tests
git commit -m "feat: show daily actions and Vault settings"
```

## Task 14: Implement Reader Rendering and Selection Actions

**Files:**
- Create: `src/components/MarkdownMath.tsx`
- Create: `src/features/reader/ReadingForm.tsx`
- Create: `src/features/reader/ReaderPage.tsx`
- Create: `src/features/reader/selection.ts`
- Test: `tests/ui/reader.test.tsx`

- [ ] **Step 1: Write failing reader tests**

Test that:

- inline and block formulas render through KaTeX;
- selecting text exposes exactly five Chinese actions;
- clicking a card action carries source path and excerpt to Card Studio;
- clicking diagnosis carries the same context to Diagnosis;
- raw Markdown is shown if rendering fails.

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- tests/ui/reader.test.tsx
```

- [ ] **Step 3: Implement Markdown/KaTeX rendering**

Use:

```tsx
<ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
  {source}
</ReactMarkdown>
```

Import `katex/dist/katex.min.css` once in `src/main.tsx`.

- [ ] **Step 4: Implement selection measurement**

Read `window.getSelection()`, reject collapsed or out-of-reader selections, save
the plain excerpt, and anchor a five-action popover near the range rectangle.

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -- tests/ui/reader.test.tsx
git add src/components/MarkdownMath.tsx src/features/reader src/main.tsx tests/ui/reader.test.tsx
git commit -m "feat: turn reading selections into learning actions"
```

## Task 15: Implement Card Studio, Diagnosis, and Candidate Content

**Files:**
- Create: `src/features/cards/card-draft.ts`
- Create: `src/features/cards/CardEditor.tsx`
- Create: `src/features/cards/CardStudioPage.tsx`
- Create: `src/features/diagnosis/DiagnosisPage.tsx`
- Test: `tests/ui/card-diagnosis.test.tsx`

- [ ] **Step 1: Write failing card-draft tests**

Assert each reader action produces the correct type-specific blank fields while
copying concept, excerpt, source path, creation date, and initial review date.

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- tests/ui/card-diagnosis.test.tsx
```

- [ ] **Step 3: Implement four explicit editors**

Use a shared base field section plus a type-specific section. Do not hide required
fields behind dynamic generic key/value controls.

- [ ] **Step 4: Implement candidate-content controls**

Provide a plain textarea and these explicit buttons:

```text
复制到“我的理解”
复制到“例子内容”
复制到“反例内容”
复制到“下一步行动”
复制到“证明骨架”
保存为参考材料
丢弃
```

Buttons unavailable for the current card type remain disabled with an explanation.

- [ ] **Step 5: Implement diagnosis form and Codex task action**

Use the fixed eight block choices. After save, expose “生成 Codex 任务 Markdown”
and show the returned real file path.

- [ ] **Step 6: Run tests and commit**

```powershell
npm test -- tests/ui/card-diagnosis.test.tsx
git add src/features/cards src/features/diagnosis tests/ui/card-diagnosis.test.tsx
git commit -m "feat: edit cards and diagnose learning blocks"
```

## Task 16: Implement Review and Flywheel Graph Interfaces

**Files:**
- Create: `src/features/review/ReviewPage.tsx`
- Create: `src/features/graph/FlywheelGraph.tsx`
- Create: `src/features/graph/WheelGraphPage.tsx`
- Test: `tests/ui/review-graph.test.tsx`

- [ ] **Step 1: Write failing review tests**

Assert one due card displays four feedback buttons, requires a block type after
feedback, posts the result, and advances to the next card.

- [ ] **Step 2: Write failing graph tests**

Assert a concept node shows four ring states, opens the right drawer on click,
lists existing cards, and displays suggested next actions. Assert there is no drag
handler or edge-creation control.

- [ ] **Step 3: Verify failures**

Run:

```powershell
npm test -- tests/ui/review-graph.test.tsx
```

- [ ] **Step 4: Implement review flow**

Keep one card in focus. Show the answer/details only after the user reveals them.
After feedback, require one of eight blocks before submitting.

- [ ] **Step 5: Implement a deterministic SVG research-board graph**

Lay out concept nodes in a fixed responsive grid/radial arrangement derived from
sorted concept names. Use four small ring markers per node. Clicking opens details;
do not add dragging, zoom persistence, or manual edges.

- [ ] **Step 6: Run tests and commit**

```powershell
npm test -- tests/ui/review-graph.test.tsx
git add src/features/review src/features/graph tests/ui/review-graph.test.tsx
git commit -m "feat: review cards and inspect flywheel gaps"
```

## Task 17: Add Unsaved-Change, Recovery, and Accessibility Behavior

**Files:**
- Create: `src/lib/unsaved-guard.ts`
- Modify: card, reading, diagnosis, and settings forms
- Test: `tests/ui/safety-accessibility.test.tsx`

- [ ] **Step 1: Write failing safety tests**

Assert dirty forms intercept route navigation, save failure retains all entered
text, retry reuses the same payload, and copy-to-clipboard remains available.

- [ ] **Step 2: Write failing accessibility tests**

Assert keyboard focus reaches navigation, selection actions, action band, drawer,
form controls, review buttons, and graph nodes. Assert reduced-motion CSS disables
route and drawer transitions.

- [ ] **Step 3: Verify failures**

Run:

```powershell
npm test -- tests/ui/safety-accessibility.test.tsx
```

- [ ] **Step 4: Implement guards and failure receipts**

Use `beforeunload` plus router blockers. Never clear a form until the API returns a
successful save receipt.

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -- tests/ui/safety-accessibility.test.tsx
git add src tests/ui/safety-accessibility.test.tsx
git commit -m "fix: protect unsaved learning work"
```

## Task 18: Automate the Complete ε-N Browser Path

**Files:**
- Create: `tests/browser/epsilon-n-flow.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing browser test**

The test must:

1. start with a fresh temporary Vault;
2. open Today;
3. initialize the Vault;
4. create `数列极限 ε-N 定义`;
5. verify rendered KaTeX;
6. select the definition text;
7. click `生成定义卡`;
8. fill `大白话解释` and `当前卡点`;
9. save and assert the real relative path;
10. save a `证明搜索` diagnosis;
11. generate a Codex task;
12. review the definition card;
13. open the graph;
14. assert definition established and three missing rings;
15. reload the browser and confirm persistence from disk.

- [ ] **Step 2: Run the browser test and verify failure**

Run:

```powershell
npm run test:browser -- tests/browser/epsilon-n-flow.spec.ts
```

Expected: FAIL at the earliest missing selector or behavior.

- [ ] **Step 3: Fix only product defects exposed by the path**

Do not add features outside the approved acceptance IDs.

- [ ] **Step 4: Run the complete verification chain**

```powershell
npm run verify
npm run test:browser
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git add tests/browser playwright.config.ts package.json package-lock.json src server
git commit -m "test: verify the epsilon-n learning loop"
```

## Task 19: Package the Windows Handoff and Verify Desktop Delivery

**Files:**
- Create: `README.md`
- Create: `scripts/start-workbench.ps1`
- Create: `scripts/verify-desktop-package.ps1`
- Modify: `docs/V0.1_ACCEPTANCE.md`

- [ ] **Step 1: Write the Windows start script**

The script must:

```powershell
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js 22 or newer is required.'
}
if (-not (Test-Path 'node_modules')) {
  npm install
}
npm run dev
```

- [ ] **Step 2: Write README operating instructions**

Document:

- supported Windows version and Node requirement;
- `npm install`, `npm run dev`, and start-script use;
- default Vault location;
- how to select, migrate, and back up a Vault;
- how to run static and browser verification;
- explicit non-goals and recovery behavior.

- [ ] **Step 3: Run final verification in the workspace**

Run:

```powershell
npm run verify
npm run test:browser
git status --short
```

Expected: all tests pass; status shows only intended delivery-document changes.

- [ ] **Step 4: Commit the handoff files**

```powershell
git add README.md scripts docs/V0.1_ACCEPTANCE.md
git commit -m "docs: add Windows workbench handoff"
```

- [ ] **Step 5: Copy the verified project to Desktop**

Copy to:

```text
C:\Users\pcp\Desktop\aleksi-learning-workbench
```

Exclude:

```text
.git
node_modules
dist
playwright-report
test-results
.superpowers
```

Do not overwrite a pre-existing Desktop folder silently; rename the prior folder
with a timestamp after explicit confirmation.

- [ ] **Step 6: Verify the Desktop package**

Run `scripts/verify-desktop-package.ps1` against the copied path. It must check:

- required source and documentation files exist;
- no excluded directories were copied;
- `npm install` succeeds;
- `npm run verify` succeeds;
- the local service binds to `127.0.0.1`;
- a temporary Desktop-package Vault can write and reload one card.

- [ ] **Step 7: Record acceptance evidence**

Update `docs/V0.1_ACCEPTANCE.md` with the exact command results, browser-test
timestamp, test Vault path, Desktop destination, and observed save receipt.

- [ ] **Step 8: Commit the acceptance record**

```powershell
git add docs/V0.1_ACCEPTANCE.md
git commit -m "test: record v0.1 acceptance evidence"
```

## Final Plan Self-Review

- Every design requirement maps to at least one task.
- Documentation and schema contracts precede project implementation.
- Markdown remains authoritative; JSON recovery is tested.
- No AI API, permanent deletion, public deployment, Electron, advanced scheduler,
  free graph editing, or old Obsidian-vault mutation appears in the plan.
- File paths, function names, route names, enums, and review intervals are
  consistent across tasks.
- Every feature begins with a failing test and ends with verification and a
  focused commit.
- Desktop copying is treated as part of completion, not an optional convenience.
