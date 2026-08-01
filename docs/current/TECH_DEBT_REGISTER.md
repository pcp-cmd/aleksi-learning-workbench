# Aleksi Learning Workbench 技术债登记

本登记只记录会影响交付可信度、后续重构边界或用户启动体验的债务。每一项都必须写清楚风险、处理方案、验收标准、状态、相关文件；不能用“应该没问题”代替证据。

状态含义：

- `已收束`：当前 clean-base gate 已用测试或脚本验证。
- `已登记`：不是当前 clean-base 阻断项，但后续功能或包装前必须复查。
- `后置`：可进入路线图，不允许伪装成已完成能力。

## 本轮 all-issues 分支收束清单

这一段是给后续 Codex 和人工 review 的快速索引。英文 item 名称保持稳定，避免 PowerShell / 编码环境下检索中文短语失败；详细说明仍以各 P0/P1/P2 条目为准。

| Item | Status | 归属 |
| --- | --- | --- |
| Test cross-platform path issue | Fixed | Gate A |
| Listener timeout risk | Fixed | Gate A |
| health:source not in verify | Fixed | Gate A |
| PowerShell UTF-8 guard | Fixed | Gate B |
| demo-vault-template Chinese path | Fixed | Gate B |
| demo reading frontmatter | Fixed | Gate B |
| Settings hard-coded pcp path | Fixed | Gate C |
| README path mismatch | Fixed | Gate C / Gate G |
| Today recent card API shape mismatch | Fixed | Gate C |
| Today recent reading sorting | Fixed | Gate C |
| Cards empty direct save | Fixed | Gate D |
| Fake reference save | Fixed | Gate D |
| Ambiguous 我的理解 | Fixed | Gate D |
| Absolute path in primary UI | Fixed | Gate D |
| View card not using detail data | Fixed | Gate D |
| Card library not complete | Deferred | TD-P2-003 |
| Reader path exposure | Fixed | Gate E |
| Reader responsive layout | Fixed | Gate E |
| Excerpt basket limited card type | Fixed | Gate E |
| sessionStorage temporary basket | Fixed | Gate E |
| selection popover overflow | Fixed | Gate E |
| selection popover ARIA | Fixed | Gate E |
| Review legacy field mismatch | Fixed | Gate F |
| components.css scope debt | Deferred | TD-P1-004 |
| .claude-card semantic debt | Deferred | TD-P1-005 |
| stale APP_ROUTES copy | Fixed | Gate F |
| private fonts warning / local copy helper | Fixed | TD-P1-006 |
| Friend preview runtime boundary | Fixed | TD-P1-007 |
| non-JSON API error handling | Fixed | TD-P0-004 |
| Express JSON limit | Fixed | Gate E |

## P0：阻断交付的问题

### TD-P0-001：工作目录包混入 node_modules

- 风险：如果 source package 把 `node_modules`、`dist`、缓存、测试报告、构建产物或临时工作树打进去，用户收到的就不是可信源码包，体积和隐私边界都会失控。
- 处理方案：source package 使用统一排除规则；真实 ZIP 条目审计阻断任意位置的生成物，并排除 `.env` / `.env.*`（保留无凭据的 `.env.example`）等本地配置。
- 验收标准：`npm run package:source` 产出 zip；`npm run package:audit` 通过；真实 zip 条目不存在 forbidden entries。
- 状态：已收束。
- 相关文件：`scripts/package-rules.mjs`、`scripts/package-source.mjs`、`scripts/audit-package.mjs`、`tests/scripts/delivery-scripts.test.ts`。

### TD-P0-002：source audit 未阻断任意层级 forbidden entries

- 风险：只匹配根目录会漏掉 `nested/node_modules`、`foo/dist` 等嵌套污染，审计看似通过但包仍然脏。
- 处理方案：审计和打包规则按规范化路径检查任意层级 forbidden directory，并拒绝 unsafe zip entry。
- 验收标准：构造嵌套 forbidden entry 的测试必须失败；修复后同一测试通过。
- 状态：已收束。
- 相关文件：`scripts/package-rules.mjs`、`scripts/audit-package.mjs`、`tests/scripts/delivery-scripts.test.ts`。

### TD-P0-003：package-source manifest 幂等性问题

- 风险：重复打包时旧 `SOURCE_PACKAGE_MANIFEST.json` 可能被再次纳入 zip，导致 manifest 不可信、sha 对不上、源码包不可复现。
- 处理方案：source package 输入排除旧 source/runtime manifest；audit 校验 manifest 数量、文件名、大小和 sha256。
- 验收标准：从已打出的 source zip 解包后再次执行 `package:source` + `package:audit` 必须通过，且 manifest 只有一个。
- 状态：已收束。
- 相关文件：`scripts/package-source.mjs`、`scripts/package-rules.mjs`、`scripts/audit-package.mjs`、`tests/scripts/delivery-scripts.test.ts`。

### TD-P0-004：Failed to fetch 未统一转义

- 风险：后端未启动时，Settings / Reader / Cards 直接暴露浏览器错误，用户不知道该重启本地服务还是换学习库。
- 处理方案：所有 fetch 连接失败在 `apiClient` 统一转成 `LOCAL_SERVICE_UNREACHABLE` 和中文恢复提示；页面只消费统一错误。
- 验收标准：Settings / Reader / Cards 的失败测试都显示统一提示；实现中没有页面级 `Failed to fetch` 热补丁。
- 状态：已收束。
- 相关文件：`src/lib/api-client.ts`、`tests/ui/api-client.test.ts`、`tests/ui/today-settings.test.tsx`、`tests/ui/reader.test.tsx`、`tests/ui/card-diagnosis.test.tsx`。

### TD-P0-005：学习库路径输入无统一容错

- 风险：用户从资源管理器复制路径时经常带英文或中文引号；如果前后端各自随手替换，会破坏 path safety 或产生不一致。
- 处理方案：新增共享路径输入归一化函数，只移除一层匹配的外层引号；后端 privileged path safety 仍然做完整绝对路径、NUL、dot segment 和 encoded separator 检查。
- 验收标准：无引号、英文引号、中文引号、正斜杠 Windows 路径可用；相对路径、父级跳转、非完整绝对路径仍拒绝。
- 状态：已收束。
- 相关文件：`shared/user-path.ts`、`server/services/vault-service.ts`、`src/features/settings/SettingsDialog.tsx`、`tests/shared/user-path.test.ts`、`tests/api/vault.test.ts`。

### TD-P0-006：.worktrees mainline 失焦

- 风险：如果修复只停留在 `.worktrees/*`，用户从项目根目录启动时仍会运行旧代码，造成“测试通过但实际打不开/看不到修复”的交付错位。
- 处理方案：每轮 clean-base 开始必须确认实际主线目录；已验证 worktree 改动必须合入项目根目录，不能把并行工作树留作用户运行入口。
- 验收标准：项目根目录 `git status` 干净或只包含本轮变更；根目录代码包含已验证修复；`.worktrees/` 被打包规则和 source audit 排除。
- 状态：已收束。
- 相关文件：`.gitignore`、`scripts/package-rules.mjs`、`scripts/audit-package.mjs`、`docs/current/TECH_DEBT_REGISTER.md`。

## P1：必须治理但可排期的问题

### TD-P1-001：Settings 工程化

- 风险：Settings 首屏像工程控制台，会把普通用户推向迁移、内部路径、只读原因等高级概念，影响“零配置学习主链路”。
- 处理方案：Settings 分为常用与高级；常用只保留当前学习库位置、推荐位置、创建/更换/备份；高级默认折叠。
- 验收标准：首屏只有常用区；高级区默认不可见；点击后才显示迁移、内部路径、写入状态、只读原因、诊断信息。
- 状态：已收束。
- 相关文件：`src/features/settings/SettingsDialog.tsx`、`tests/ui/today-settings.test.tsx`。

### TD-P1-002：CardEditor legacy 字段暴露

- 风险：concept 等 V0.2 主卡片看到“例子内容 / 反例内容 / 证明骨架”的禁用按钮和“不使用字段”提示，会把旧卡片体系推到主 UI。
- 处理方案：候选内容按钮按当前 `CardType` 动态生成；不支持的字段不渲染；legacy 字段只在对应 legacy 卡或兼容路径出现。
- 验收标准：concept 卡不显示例子内容、反例内容、证明骨架按钮；不显示“当前概念卡不使用某字段”提示。
- 状态：已收束。
- 相关文件：`src/features/cards/CardEditor.tsx`、`tests/ui/card-diagnosis.test.tsx`、`shared/card-types.ts`、`shared/card-labels.ts`。

### TD-P1-003：卡片保存后 UI 不可见

- 风险：保存成功但用户只能去文件夹找 Markdown，会让学习闭环断掉，也难以确认刚才保存的内容。
- 处理方案：新增只读 recent cards API；卡片工作台保存后展示下一步动作、最近卡片列表和只读预览。
- 验收标准：创建 concept 卡后无需打开文件夹即可在 `/cards` 看见；刷新后仍可见；点击最近卡片可预览；不泄漏 absolutePath。
- 状态：已收束。
- 相关文件：`server/routes/cards.ts`、`server/services/card-service.ts`、`src/features/cards/CardStudioPage.tsx`、`tests/api/cards.test.ts`、`tests/ui/card-diagnosis.test.tsx`。

### TD-P1-004：components.css 职责过大

- 风险：一个样式文件同时承担布局、组件、状态、动效和兼容类，后续改视觉容易误伤学习流程。
- 处理方案：本轮只登记，不做大换皮；后续拆分必须以截图或组件测试保护关键页面。当前决策：新代码优先使用语义 surface，而不是继续扩大历史视觉类；优先级为 `surface-static`、`surface-interactive`、`reader-paper`、`input-surface`、`shell-panel`。
- 验收标准：拆分前列出影响的组件和页面；拆分后 Today / Reader / Cards / Settings 的关键 UI 测试通过。
- 状态：已登记。
- 相关文件：`src/styles/components.css`、`tests/ui/*`。

### TD-P1-005：.claude-card 语义残留

- 风险：`.claude-card` 是历史视觉命名，继续扩散会把实现和某个临时视觉来源绑定，影响长期产品语义。
- 处理方案：当前不破坏样式；后续以语义类逐步替换，保留兼容别名到视觉稳定；新增 UI 不应默认复制 `.claude-card`，除非是维护旧区域。
- 验收标准：新增组件优先使用产品语义类；替换时不改变现有布局和测试快照。
- 状态：已登记。
- 相关文件：`src/styles/components.css`、`src/features/*`。

### TD-P1-006：private font mode 打包边界

- 风险：用户本地私用字体不能误删，也不能进入 public/open-source/source package；字体边界不清会造成授权和交付风险。
- 处理方案：本地 worktree 允许私用字体存在；source package 默认排除；未来 runtime private build 必须显式 private mode。
- 验收标准：`public/fonts/claude/` 不进入 source package；文档写明不要删除用户本地私用字体。
- 状态：已收束。
- 相关文件：`docs/current/FONT_USAGE_POLICY.md`、`scripts/package-rules.mjs`。

### TD-P1-007：friend preview runtime 与平台打包边界

- 风险：runtime package、便携包和 exe 涉及端口、Node、启动脚本、平台权限、进程回收、升级卸载；如果共用 source package 的成功结论，会制造不可验证的交付状态。
- 处理方案：friend preview runtime 作为 V0.2.1 独立产物，内嵌 Node、只绑定 loopback 并在 `17817-17880` 选择端口；启动脚本设置 UTF-8，健康检查最多等待约 60 秒，启动失败时终止进程树；source/runtime 使用各自独立的打包、审计和 verify 命令。EXE 继续后置。
- 验收标准：`npm run verify:clean-base` 与 `npm run verify:runtime` 分别通过；runtime audit 阻断源码、私有字体路径和伪字体；运行时清单逐文件校验大小与 sha256；源码包不含 runtime/node.exe 或 runtime 调试目录。
- 状态：已收束（friend preview runtime v0.1）；EXE / installer 仍后置。
- 相关文件：`docs/current/PACKAGING_ROADMAP.md`、`package.json`、`scripts/package-runtime.mjs`、`scripts/audit-runtime.mjs`、`scripts/verify-runtime.mjs`。

### TD-P1-008：Reader 正文过窄

- 风险：精读页如果正文栏沿用过窄文章宽度，会让数学材料和长段落频繁换行，阅读体验不像“主工作台”，也会把注意力挤到侧栏。
- 处理方案：Reader 使用 reading-first 布局：正文主栏扩大到 960px，纸面内容控制在可读宽度内，摘录篮和材料列表退到辅助地位。
- 验收标准：Reader layout CSS 明确 `minmax(0, 960px)`；主阅读 surface 有 `reader-paper--reading-first`；正文 h1、数学块和高亮渲染受测试保护。
- 状态：已收束。
- 相关文件：`src/features/reader/ReaderPage.tsx`、`src/styles/components.css`、`src/components/MarkdownMath.tsx`、`tests/ui/reader.test.tsx`。

### TD-P1-009：Today 行动性不足

- 风险：Today 首屏如果展示路径、Vault 或工程状态，用户不知道下一步该读、制卡还是复习，学习闭环会在入口处断掉。
- 处理方案：Today 改为下一步行动面板：优先继续最近阅读，提供开始新精读和今日复习，并以最近卡片补足闭环反馈。
- 验收标准：Today 不显示绝对路径或 `01-阅读材料/*.md`；继续精读显示“阅读材料 · 最近打开”；最近卡片区域可见并展示最近保存内容。
- 状态：已收束。
- 相关文件：`src/features/today/TodayPage.tsx`、`src/styles/components.css`、`tests/ui/today-settings.test.tsx`。

### TD-P1-010：A Logo 语义不清

- 风险：侧栏 A 标识如果只是装饰性 `div`，用户无法理解它是否可点击，也无法通过键盘或辅助技术把它当作回到今日学习的入口。
- 处理方案：A 标识改为品牌链接，指向 `/today`，保留 tooltip、可访问名称和未保存变更保护。
- 验收标准：导航栏中存在 aria-label 为 `Aleksi Learning Workbench，回到今日学习` 的 link；href 为 `/today`；title 为 `Aleksi Learning Workbench`；焦点样式明确。
- 状态：已收束。
- 相关文件：`src/components/NavigationRail.tsx`、`src/styles/workbench.css`、`tests/ui/app-shell.test.tsx`。

## P2：可后置的问题

### TD-P2-001：source package 之后的 fresh install 体验

- 风险：源码包干净不等于普通用户轻松启动，Node/npm 依赖仍然重。
- 处理方案：进入 V0.2.1 / V0.3 时再做 runtime 与无 Node 包，不能倒灌到 clean base。
- 验收标准：独立分支、独立验证命令、独立用户启动脚本。
- 状态：后置。
- 相关文件：`docs/current/PACKAGING_ROADMAP.md`。

### TD-P2-002：大体积资源与懒加载策略

- 风险：后续材料、字体、图谱数据增长后，首屏和包体可能变慢。
- 处理方案：等主链路稳定后用实际性能数据驱动，不凭空优化。
- 验收标准：有性能基线、变更前后数据和用户可感知指标。
- 状态：后置。
- 相关文件：`src/features/*`、`public/`。

### TD-P2-003：全量卡片库与搜索/筛选

- 风险：当前 `/cards` 已能创建卡片、查看最近卡片和预览详情，但它不是全量卡片库；如果把 recent cards 误称为完整卡片库，用户会期待搜索、筛选、全部卡片浏览和批量管理能力，造成交付边界失真。
- 处理方案：本轮不实现全量卡片库；后续单独设计全部卡片列表、搜索/筛选、卡型/来源过滤、排序和空状态。
- 验收标准：新功能必须有独立接口或明确复用现有接口，有 UI 测试覆盖搜索/筛选/空状态；在此之前只能称为“最近卡片”或“卡片工作台”，不能声称“卡片库 complete”。
- 状态：后置。
- 相关文件：`src/features/cards/CardStudioPage.tsx`、`server/routes/cards.ts`、`server/services/card-service.ts`、`tests/ui/card-diagnosis.test.tsx`。

## 交付阻断规则

- P0 未通过验证时，禁止声称“可交付”。
- P1 可以带着登记进入下一阶段，但不能在功能开发中继续扩大。
- P2 只允许作为 roadmap，不允许伪装成已完成能力。
- 本轮 clean base 禁止借题发挥做 runtime、exe、AI 接入、图谱重写或主题大换皮。

<!-- current-contract:historical-table:start -->
## 0.1.3 Correctness and lifecycle reconciliation

| Item | Status | Evidence |
| --- | --- | --- |
| Native X / Ctrl+Q / Settings Exit had competing policies | RESOLVED | `src/app/application-close.ts`, `src/app/App.tsx`, `tests/ui/application-close.test.ts` |
| Desktop `beforeunload` competed with Tauri close | RESOLVED | `src/lib/unsaved-guard.ts` |
| Restored local drafts were immediately destructive-dirty | RESOLVED | Reading, Card Studio, Diagnosis, Review snapshot baselines |
| Library changes cleared every draft namespace | RESOLVED | deterministic library identities and transactional Settings switch |
| Installed verifier hid a broken X behind Ctrl+Q fallback | RESOLVED | both PowerShell lifecycle verifiers now fail on native-close timeout |
| Windows CI previously stopped at static installer checks | DEFERRED | qualification workflow now installs 0.1.2, upgrades, closes, relaunches, and uninstalls, but its first GitHub Windows run is still required before this debt can be marked resolved |
| Repeated UI release-script aliases ran the same suite | RESOLVED | one honest `test:release:ui` command remains |
| Large Settings / Review modules | ACCEPTED | only lifecycle and transaction boundaries were extracted; broad rewrite deferred |
| Monolithic historical CSS and semantic class debt | DEFERRED | no visual migration in 0.1.3 |
| ESLint/Biome baseline | DEFERRED | adding it now would create unrelated churn; TypeScript, Vitest, browser, Rust and installed gates remain authoritative |
| Code signing publisher and credentials | DEFERRED | 0.1.3 remains `unsigned-preview`; no credential is referenced |
<!-- current-contract:historical-table:end -->
