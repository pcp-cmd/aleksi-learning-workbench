# Aleksi Learning Workbench Desktop

Aleksi Learning Workbench 是一套 local-first 学习工作台：把精读、摘录、卡片、卡点诊断、闭卷复习、概念飞轮与证据核验持续写入用户自己的 Markdown 本地学习库。网页开发态与 Windows 桌面态共用同一套 React 界面、Express 业务服务和文件格式。

## Current artifact types

- Windows 安装包（当前桌面交付）：`artifacts/Aleksi-Workbench-Setup.exe`。这是 Tauri 2 生成的 per-user NSIS 安装包，内含固定 Node sidecar，不要求使用者安装 Node、PowerShell、浏览器或 Visual Studio。
- 桌面源码包（当前复现交付）：`artifacts/AleksiWorkbench-Desktop-Source-20260716.zip`。由正式源码打包与审计脚本生成，不是整个工作目录的手工压缩包。
- clean-base 源码审计中间件：`artifacts/aleksi-learning-workbench-source.zip`。`verify:clean-base` 使用它执行解包、重装、构建、测试和重打包幂等验证。
- friend preview portable runtime：`artifacts/AleksiWorkbench-Preview-win-x64.zip`。这是桌面安装包之前的兼容交付，双击 `Start Aleksi Workbench.cmd`；它不是安装器，也不能替代桌面验证。
- worktree snapshot：只用于诊断，不是正式交付物。

不要手工压缩整个项目目录。正式源码包会排除 `node_modules`、构建输出、Rust `target`、生成的 sidecar、缓存、测试报告、用户数据和 private-local 字体。

## Documentation authority

`docs/current` 是当前产品、架构、打包与工程纪律的权威入口。`docs/superpowers/plans` 和其他旧计划只提供实施来源与历史上下文；若与 `docs/current` 冲突，以当前文档和可运行测试为准。

## Install and run on Windows

支持 Windows 10/11 x64。运行：

```text
artifacts\Aleksi-Workbench-Setup.exe
```

安装范围是当前用户。安装器在需要时使用 WebView2 bootstrapper；应用本身启动一个受控的本地 sidecar，只绑定动态的 `127.0.0.1` 端口。桌面窗口不调用外部浏览器，也不通过 shell 启动服务。

本安装包未做商业代码签名，因此 Windows 可能显示未知发布者提示。源码、安装包哈希和运行验证记录必须一起核对，不能把“构建成功”写成“已在干净机器安装成功”。

## Developer requirements

- Node.js 22 或更高版本；
- npm；
- 仅在构建桌面安装包时需要 Rust MSVC 工具链、Visual Studio Build Tools（C++ 组件）和 Windows SDK；
- VS Code 可以继续作为编辑器，但它不包含 MSVC 链接器或 Windows SDK。

网页开发态：

```powershell
npm.cmd install
npm.cmd run dev
```

客户端为 `http://127.0.0.1:5173`，开发服务同样只监听本机回环地址。不要直接双击 `index.html`。

## Local Learning Library

桌面态首次启动会建议当前 Windows 用户的默认位置：

```text
C:\Users\<you>\Documents\Aleksi Learning Workbench
```

设置里可以创建、选择、迁移、备份或打开本地学习库。Markdown 是权威数据；`.aleksi/*.json` 是可重建索引和缓存。当前路径保存于桌面应用本地数据目录的 `settings/settings.json`。卸载应用不得删除 Documents 下的本地学习库。

新库使用 `08-复习记录`；旧库中的 `08-飞轮复习` 仍可读取且不会被移动。飞轮缓存使用 `.aleksi/graph-state.json`，不会为新库创建旧的 `09-飞轮图谱`。

## Product navigation

五个一级模块只有一份路由注册表：

1. 今日：执行服务端选出的下一最小行动；
2. 精读：导入或粘贴材料、摘录与重述；
3. 卡片：形成概念、例子、边界、流程和错误卡；
4. 飞轮：观察五类覆盖与概念缺口；
5. 复习：先保存闭卷作答与辅助程度，再揭示答案和安排下一次复习。

卡点诊断是上下文模块，证据核验是高级模块。可信证据状态与卡片熟练度相互独立；一次自评或 AI 判断不会自动产生 `mastered`。

## Verification

源码类型、单元/API/UI 测试和生产构建：

```powershell
npm.cmd run verify
```

真实 Chromium 学习闭环：

```powershell
npm.cmd run test:browser
```

从正式源码 ZIP 解包后的重装、构建、测试、审计和幂等打包：

```powershell
npm.cmd run verify:clean-base
```

Rust/Tauri 与桌面安装包：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
npm.cmd run package:desktop
npm.cmd run verify:desktop
```

最终命名源码包：

```powershell
npm.cmd run package:desktop-source
npm.cmd run audit:desktop-source
```

这些门禁分别证明源码、浏览器、Rust/打包边界。安装、首次启动、动态端口、单实例、退出、重启和卸载保留学习库必须写入单独的桌面运行验证记录。

## Recovery and safety

- 本地学习库不可写时显示原因，不静默改写到别处；
- 损坏的可重建 JSON 会隔离后从 Markdown 重建；
- 归档卡片只移动到 `99-归档`，没有永久删除接口；
- 未保存表单会阻止路由切换、刷新和桌面退出；
- sidecar 崩溃进入可重试状态，不用另一个持久化通道绕过现有 API；
- 迁移和备份需要显式确认。

## Non-goals

当前桌面交付不包含账号登录、云同步、自动更新、商业代码签名、OCR/PDF 导入、任意 shell/文件系统命令、自由拖拽图谱或自动迁移无关的 Obsidian 知识库。
