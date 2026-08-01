# Aleksi Learning Workbench V0.1 Design

Date: 2026-06-22  
Status: Approved design, pending implementation plan  
Target platform: Windows-first local browser application

## 1. Purpose

Aleksi Learning Workbench is a private, local-first learning tool for mathematical analysis.
It turns reading into reusable learning assets through one closed loop:

```text
read material
→ create a card draft
→ diagnose the learning block
→ schedule review
→ show the flywheel gap
→ choose the next action
```

This is a new project. It does not modify or become part of the existing Aleksi Lab
public website. The relationship is:

```text
Workbench = daily growth and learning actions
Vault     = durable Markdown assets
Website   = public presentation of mature outcomes
```

## 2. V0.1 Outcome

V0.1 is complete only when the following path works against real local files:

1. Open Today.
2. Create the demonstration reading material `数列极限 ε-N 定义`.
3. Render its Markdown and inline/block KaTeX.
4. Select the ε-N definition.
5. Create a definition-card draft.
6. Add `大白话解释` and `当前卡点`.
7. Save the card as Markdown.
8. Record `证明搜索卡住`.
9. generate a Codex task Markdown file.
10. See the definition card in today's review queue.
11. See the concept graph report definition established and example,
    counterexample, and proof missing.
12. Receive the next-action suggestion to add an example or counterexample.

The application must not claim a save succeeded until the file is durably written.

## 3. Confirmed Product Constraints

- Deliver a complete, runnable V0.1 rather than a visual-only prototype.
- Windows is the supported V0.1 platform.
- The default Vault path is:
  `C:\Users\pcp\Documents\Aleksi-Learning-Vault`.
- The Vault path can be changed later in Settings.
- Changing the path does not silently move the old Vault. A separate,
  explicitly confirmed copy-migration action handles migration.
- Initial setup creates only one demonstration reading material. It does not
  migrate the old website's complete math archive.
- Development happens in the Codex workspace. The verified final project is
  copied to `C:\Users\pcp\Desktop\aleksi-learning-workbench`.
- The existing Aleksi Lab ZIP is a read-only visual and content reference.
- The old website project is never modified.

## 4. Explicit Non-Goals

V0.1 does not include:

- accounts, profiles, social features, collaboration, or cloud sync;
- an AI API, API-key settings, embedded chat, or automatic Codex execution;
- PDF parsing, OCR, web scraping, video transcription, or batch import;
- a TeX compiler, formula editor, or handwriting recognition;
- FSRS or another advanced spaced-repetition algorithm;
- a long-term planner, Gantt chart, calendar system, or analytics dashboard;
- free graph dragging, manual edge drawing, or an infinite canvas;
- permanent deletion;
- scanning, writing, or migrating the user's existing Obsidian vault;
- public deployment or a packaged Electron/EXE application;
- a redesign of the established Aleksi visual language.

## 5. Technical Approach

### 5.1 Stack

- React and TypeScript for the interface.
- Vite for the development application.
- A Node.js TypeScript local service for Vault file access.
- Markdown parsing with frontmatter support.
- KaTeX for inline and block mathematics.
- JSON files only for rebuildable indexes, queues, and graph caches.

The user runs:

```powershell
npm run dev
```

The user-facing application opens at:

```text
http://127.0.0.1:5173
```

Vite proxies `/api` to the local Node service. Both processes bind only to
`127.0.0.1`.

### 5.2 Responsibility Boundaries

The React application:

- renders six pages;
- manages navigation and transient form state;
- renders Markdown and KaTeX;
- captures selected reader text;
- edits card, diagnosis, and review forms;
- displays API success and failure truthfully.

The Node service:

- validates all paths against the active Vault root;
- creates and reads Markdown assets;
- atomically updates files;
- archives assets;
- rebuilds JSON indexes from Markdown;
- calculates review dates and graph summaries;
- creates and migrates Vaults;
- returns the final path and write time for every successful save.

The Vault:

- is the durable source of truth;
- remains readable without the Workbench;
- is directly compatible with Obsidian;
- never depends on localStorage or IndexedDB for core assets.

The application keeps one non-asset locator file at:

```text
%APPDATA%\Aleksi Learning Workbench\settings.json
```

It stores the active Vault path so a changed Vault can be reopened on the next
launch. Vault-specific preferences remain in `.aleksi/settings.json`.
localStorage may hold only disposable interface state such as rail collapse and
the most recently opened page.

## 6. Information Architecture

V0.1 has exactly six main pages:

1. 今日学习
2. 数学阅读器
3. 卡片工作台
4. 卡点诊断
5. 飞轮复习
6. 飞轮图谱

Settings is a small utility surface opened from the navigation, not a seventh
main workflow page.

### 6.1 Persistent Navigation and Action Surface

The selected visual direction is **Reading-first with a bottom action band**:

- a narrow left rail holds the six modules;
- the central workspace receives maximum width;
- the bottom band always shows only:
  - current object,
  - current learning block,
  - next action;
- detailed context opens as an on-demand right drawer;
- the right drawer is not permanently visible.

This makes the product feel like an actionable mathematics reading desk rather
than a SaaS dashboard.

## 7. Page Behavior

### 7.1 今日学习

Displays:

- today's main concept;
- one minimum action;
- due reviews;
- current flywheel gaps;
- frequent block types;
- last successful save time;
- active Vault path and backup reminder.

It has no hero, portfolio wall, or decorative analytics.

### 7.2 数学阅读器

Supports one manually created Markdown/TXT reading at a time:

- title;
- concept;
- pasted body;
- save and begin reading.

The rendered reader supports Markdown and KaTeX. Selecting text opens exactly:

- 生成定义卡
- 生成例子卡
- 生成反例卡
- 生成证明卡
- 记录卡点

The selected excerpt and source-reading path are passed to the destination form.

### 7.3 卡片工作台

Creates a structured draft from the selected excerpt. “Generation” in V0.1
means template-based prefill, not an AI-generated answer.

All card types share:

- 卡片标题
- 卡片类型
- 所属概念
- 相关概念
- 来源材料
- 原文摘录
- 我的理解
- 当前卡点
- 下一步行动
- 掌握状态
- 创建时间
- 下次复习
- 修订记录

Type-specific fields:

- Definition: 正式定义, 大白话解释, 量词结构, 常见误解
- Example: 例子内容, 为什么它符合定义, 它训练我什么
- Counterexample: 反例内容, 它破坏了哪个条件, 为什么它不是
- Proof: 命题内容, 我的第一次尝试, 关键动作, 证明骨架, 失败原因

Saving requires human confirmation. Codex-returned content can be pasted into a
candidate area and copied field-by-field; it never overwrites a card automatically.

### 7.4 卡点诊断

Uses exactly eight block types:

- 定义
- 例子
- 反例
- 证明搜索
- 技术
- 表达
- 迁移
- 情绪

The form records:

- 所属概念
- 关联卡片
- 卡点类型
- 具体表现
- 我一开始以为的问题
- 现在判断的真实原因
- 下一步最小行动
- 要沉淀成哪类卡片

### 7.5 飞轮复习

Reviewable assets are definition, example, counterexample, and proof cards.

Feedback and scheduling:

```text
忘了 → next day
模糊 → 3 days
会了 → 7 days
很熟 → 14 days
```

Every review also records one of the eight block types. The result updates the
review queue and appends a review/revision record to the source card.

### 7.6 飞轮图谱

The graph unit is a mathematical concept, not a file.

Each concept summarizes:

- definition-card count and state;
- example-card count and state;
- counterexample-card count and state;
- proof-card count and state;
- current block;
- next action;
- due-review state;
- manually recorded related concepts.

The graph is generated from card data. Nodes are clickable and open the context
drawer. V0.1 does not permit dragging or editing graph topology.

## 8. Vault Design

```text
Aleksi-Learning-Vault/
├── 01-阅读材料/
├── 02-定义卡/
├── 03-例子卡/
├── 04-反例卡/
├── 05-证明卡/
├── 06-卡点诊断/
├── 07-飞轮复习/
├── 08-飞轮图谱/
├── 09-Codex任务/
├── 99-归档/
└── .aleksi/
    ├── index.json
    ├── review-queue.json
    ├── graph-state.json
    └── settings.json
```

### 8.1 Markdown Rules

- User-visible field names and section headings are Chinese.
- Frontmatter contains stable machine-readable metadata.
- Each card contains Obsidian links for `所属概念` and `相关概念`.
- Every update appends a dated revision record.
- Markdown is authoritative; caches can always be deleted and rebuilt.

### 8.2 File Naming

- Names are derived from the user title.
- Windows-invalid characters are removed or replaced.
- Reserved Windows device names are rejected.
- Duplicate names receive a deterministic short numeric suffix.
- API clients never provide an unrestricted absolute output path.

### 8.3 Safe Writes

Each mutation:

1. validates the resolved destination remains inside the active Vault;
2. writes a temporary sibling file;
3. flushes and closes it;
4. replaces the target atomically where the platform permits;
5. updates/rebuilds affected caches;
6. returns the actual path and modification time.

If a write fails, the UI retains the unsaved form and offers retry and copy.

## 9. Local API

Minimum routes:

```text
GET    /api/vault/status
POST   /api/vault/initialize
POST   /api/vault/select
POST   /api/vault/migrate
POST   /api/vault/backup

POST   /api/readings
GET    /api/readings
GET    /api/readings/:id

POST   /api/cards
GET    /api/cards/:id
PUT    /api/cards/:id
POST   /api/cards/:id/archive

POST   /api/diagnoses
GET    /api/review/today
POST   /api/review/:id/result
GET    /api/graph/state
POST   /api/codex/tasks
POST   /api/index/rebuild
```

All write routes validate their payloads and return structured errors containing
a user-safe message and a diagnostic code.

## 10. Failure and Recovery

- If the Vault cannot be created or written, the app enters explicit read-only
  mode and shows the cause.
- A Markdown parse error falls back to raw text for that asset.
- A corrupt JSON cache is renamed with a timestamp and rebuilt from Markdown.
- Unsaved form changes trigger a navigation warning.
- Archive, Vault migration, backup overwrite, and full index rebuild require
  confirmation.
- Existing same-name demonstration files are never overwritten.
- No operation may escape the active Vault through `..`, symlinks, encoded
  separators, or user-provided absolute paths.

## 11. Visual Reuse Contract

Before UI implementation, create `docs/UI_REUSE_MAP.md` using the ZIP as a
read-only reference.

Reuse from Aleksi Lab:

- dark background and warm off-white text;
- low-saturation clay-orange emphasis;
- existing typography hierarchy;
- paper-object cards with thin borders and no glow;
- restrained `translateY` hover and border deepening;
- selected-state orange deepening;
- status dots;
- right-side drawer motion;
- page fade/translate entrance;
- reduced-motion behavior.

Do not reuse:

- public-site hero structure;
- exhibition/portfolio wall;
- public-facing product copy;
- oversized display composition;
- decorative long-running loops.

The Workbench must remain recognizably Aleksi while prioritizing reading density,
Chinese labels, and task clarity.

## 12. Testing Strategy

### 12.1 Unit Tests

- frontmatter parse/serialize round trips;
- Windows filename sanitization and collision handling;
- review-date calculations;
- flywheel gap calculation;
- path containment and traversal rejection;
- Markdown-to-index rebuilding;
- card template generation.

### 12.2 API Integration Tests

Using a temporary Vault:

- initialize a Vault;
- create and read a reading;
- create, update, and archive each card type;
- save a diagnosis;
- apply all four review results;
- generate a Codex task;
- rebuild caches;
- recover from corrupt JSON;
- report read-only/write errors honestly;
- reject paths outside the Vault.

### 12.3 Browser Tests

Automate the complete ε-N demonstration path. Verify:

- selected text exposes exactly five actions;
- the definition-card draft receives its source excerpt;
- a real Markdown card is written;
- review and graph states update;
- reload preserves the result from disk;
- unsaved-change warnings work;
- the final graph suggests a missing example or counterexample.

### 12.4 Visual QA

- Desktop is the primary V0.1 viewport.
- Narrow layouts remain usable but do not need full mobile optimization.
- Verify the reading-first layout, bottom action band, and on-demand drawer.
- Check for visual drift into neon, glow-heavy, or generic SaaS styling.
- Verify keyboard focus and reduced-motion behavior.

## 13. Delivery

The final verified delivery contains:

- complete source code;
- lockfile and reproducible scripts;
- a demonstration Vault template containing only the ε-N reading;
- `README.md`;
- `docs/UI_REUSE_MAP.md`;
- `docs/DATA_SCHEMA.md`;
- `docs/V0.1_ACCEPTANCE.md`;
- a Windows start script that checks dependencies, installs them when absent,
  and starts the local application;
- automated test and verification scripts.

Completion requires all of:

1. static/type/unit checks pass;
2. API integration tests pass against a temporary Vault;
3. browser automation passes the complete demonstration path;
4. a real local file write and reload is observed;
5. visual QA is reviewed against the Aleksi reference;
6. the complete verified project is copied to the Desktop destination.

Static verification alone is not sufficient to call V0.1 complete.

## 14. Implementation Order

The implementation plan must preserve this order:

1. `UI_REUSE_MAP.md`
2. `DATA_SCHEMA.md`
3. project and Vault initialization
4. safe minimum file read/write
5. single reading creation and rendering
6. reader selection to card draft
7. four card types saved as Markdown
8. diagnosis persistence
9. review queue
10. flywheel state generation
11. Codex task Markdown
12. Aleksi visual treatment
13. acceptance, browser QA, and Desktop handoff
