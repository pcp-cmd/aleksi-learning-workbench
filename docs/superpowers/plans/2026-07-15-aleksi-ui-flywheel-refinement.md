# Aleksi Workbench UI 与飞轮细化实施计划

> 目标：在现有 Aleksi Learning Workbench 架构与 Vault 契约内，复现所选暖纸面参考的层级与五段闭环语义，同时保留所有既有学习能力、兼容数据与交付验证链。

## 约束与基线

- 不新建平行应用，不改写 `/api/graph/state`、卡片类型、Vault 顶层目录或既有阅读/复习契约。
- 以 `docs/current/PROJECT_MAP.md` 与 `docs/current/PRODUCT_DECISIONS.md` 为实现边界。
- 视觉只借鉴参考图的暖纸面、3+2 飞轮、轻边框、状态层级和留白；导航、概念详情、信任状态等继续使用本项目真实功能与数据。
- 图片参考中没有需要抽取的摄影或品牌位图；阶段图标复用可审计的界面语义，不引入重型图表依赖。
- 完成门槛是：代码、测试、浏览器截图、Windows 便携运行时与交付包均有证据。

## 任务 1：飞轮状态计算与 3+2 视图

**文件**

- 新建：`src/features/graph/flywheel-state.ts`
- 修改：`src/features/graph/FlywheelGraph.tsx`
- 修改：`src/features/graph/WheelGraphPage.tsx`
- 修改：`tests/ui/review-graph.test.tsx`

**步骤**

- [ ] 把 ring 原始状态映射为完成、进行中、未开始、需复习、信任受影响和阻塞/不可用六类视图状态。
- [ ] 将“五类阶段”从“概念节点列表”中解耦，页面先选概念，再渲染 `概念 → 例子 → 边界 → 流程 → 错误 → 概念`。
- [ ] 桌面按 3+2 排列，平板紧凑，移动端纵向保持顺序与回流语义。
- [ ] 每张阶段卡整卡可点击并含编号、语义标记、短说明、状态、计数/进度；状态不能只靠颜色。
- [ ] 保留概念切换、当前卡点、缺口板、相关概念与下一步行动。

## 任务 2：令牌、页面层级与响应式收敛

**文件**

- 修改：`src/styles/tokens.css`
- 修改：`src/styles/base.css`
- 修改：`src/styles/components.css`
- 修改：`src/styles/workbench.css`

**步骤**

- [ ] 补齐表面、阴影、间距、状态、聚焦和容器令牌，清理被替代的旧图谱样式。
- [ ] 降低全站等权卡片感：主行动使用重点表面，支持信息使用轻表面，高级信息默认折叠。
- [ ] 保持 Reader 纸面无 hover 跳动、减少动画可用，并复核 1366/1440/1920、窄桌面、平板、移动端。

## 任务 3：Today、Reader、Card 与 Danus 渐进披露

**文件**

- 修改：`src/features/today/TodayPage.tsx`
- 修改：`src/features/reader/ReadingForm.tsx`
- 修改：`src/features/reader/ReaderPage.tsx`
- 修改：`src/features/cards/CardEditor.tsx`
- 修改：`src/features/cards/CardStudioPage.tsx`
- 修改：`src/features/verification/VerificationPage.tsx`
- 修改：`tests/ui/reader.test.tsx`
- 修改：`tests/ui/card-diagnosis.test.tsx`
- 修改：`tests/ui/verification.test.tsx`

**步骤**

- [ ] Today 保留首屏唯一下一步，把“稍后”压成默认折叠的支持列表。
- [ ] Reader 同一入口同时支持粘贴和 `.md/.markdown/.txt` 选择/拖放，客户端按 UTF-8 解码，提供大小提示、标题建议与冲突选择，并在成功后立即打开。
- [ ] Card 明确 `原文 → 重述 → 卡型 → 卡型字段 → 下一步`，把相关概念、卡点、来源元数据和候选脚手架放入折叠区，保留全部字段。
- [ ] Danus 普通视图只呈现简明信任摘要，完整审查仍保留在证据验证专页。

## 任务 4：Windows 单实例运行时

**文件**

- 修改：`scripts/package-runtime.mjs`
- 修改：`tests/scripts/delivery-scripts.test.ts`
- 可能修改：`scripts/verify-runtime.mjs`

**步骤**

- [ ] 启动前校验 PID 文件对应进程、命令行与健康端点，避免 PID 复用误判。
- [ ] 已有健康实例时只重开浏览器；陈旧 PID 自动清理。
- [ ] 启动失败只终止本次创建且身份匹配的进程，不误伤无关端口进程；正常停止后清理 PID。
- [ ] 增加脚本级断言，并在打包运行时上做重复启动实测。

## 任务 5：验证、视觉 QA 与交付

**文件/产物**

- 新建：`design-qa.md`
- 新建：`docs/current/UI_FLYWHEEL_REFINEMENT_20260715.md`
- 生成：`artifacts/*`
- 交付：`C:/Users/pcp/Documents/Codex/2026-07-14/qi/outputs/*20260715*`

**步骤**

- [ ] 运行 `npm run typecheck`、完整 Vitest、生产构建；项目无独立 lint 类别时在交付记录中明确，并以类型检查、单测和静态禁用模式扫描补位。
- [ ] 运行服务启动、既有库、新库、Markdown/TXT 导入、重复启动、运行时打包验证。
- [ ] 用 Codex 内置浏览器验证核心交互，并截取 1366×768、1440×900、1920×1080、窄桌面、平板、移动端。
- [ ] 把参考图与同视口实现截图置于同一比较页面，完成至少一轮可见差异修正；`design-qa.md` 必须以 `final result: passed` 收口。
- [ ] 生成源码 ZIP、Windows 便携预览 ZIP、截图包、SHA-256 与验证记录；只交付最终命名产物。

