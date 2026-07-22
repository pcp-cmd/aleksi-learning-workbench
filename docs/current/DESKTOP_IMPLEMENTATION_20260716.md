# Aleksi Workbench Desktop 实施与验收记录（2026-07-16）

## 交付结论

本轮把既有 Aleksi Learning Workbench 收口为 Tauri 2 Windows 桌面应用。桌面壳负责窗口、单实例、原生选择、退出保护和随附服务生命周期；React 工作台与 Express API 仍各自只有一套实现；Markdown Local Learning Library 继续是唯一持久化事实来源。

当前交付已经完成本机当前用户范围内的真实 NSIS 安装、首次启动、中文路径数据闭环、重启持久化、单实例、受保护退出、干净关闭和卸载保留学习库验证。未把静态检查或浏览器测试冒充为安装态证明。

## 最终架构

- 桌面壳：Tauri 2 / Rust MSVC，单窗口、单实例、窗口状态恢复、受控退出。
- 前端：React 19 + React Router 7；五个一级模块固定为 Today、Reader、Cards、Flywheel、Review；Diagnosis 为上下文路由，Verification 为高级证据账本路由。
- 本地服务：Tauri 启动随包携带的 `node.exe` 与固定的 `server.cjs`，只监听 `127.0.0.1` 的动态端口。
- 桥接：Rust 读取唯一的 `ALEKSI_READY` 记录并完成健康检查，然后把严格的 loopback API base 交给前端；前端不能执行任意命令或读取任意路径。
- 数据：Markdown 文件、`.aleksi/index.json`、复习记录与验证证据仍写入用户选择的 Local Learning Library；没有引入数据库或格式迁移。
- 安装：NSIS 当前用户安装，WebView2 bootstrapper 策略，安装目录为 `%LOCALAPPDATA%\Aleksi Workbench`。

## 主要实现范围

### 路由、启动与界面

- 用 `src/app/route-registry.tsx` 统一路由元数据、懒加载组件和导航顺序，删除第二份导航真相。
- 用纯状态机协调 Lottie 完成、服务 readiness、reduced motion、超时与重试。
- 根据 `overview.json` 的真实帧数动态调整播放速度，使桌面启动动画与 960 ms 产品时序一致；不再由固定计时器越过未完成动画。
- 五模块桌面导航、窄屏底部导航、飞轮参考视觉、品牌返回 Today、lazy Markdown/KaTeX 均已落地。

### 服务与安全边界

- 桌面 sidecar 以端口 `0` 启动，实际监听地址通过唯一的 `ALEKSI_READY` JSON 行公布。
- `/api/*` 未命中返回结构化 JSON 404，SPA fallback 不会吞掉 API 错误。
- 桌面 CORS 只允许 `http://tauri.localhost` 与 `tauri://localhost`；未知 Origin 返回 `403 DESKTOP_ORIGIN_FORBIDDEN`；浏览器开发模式不额外开放 CORS。
- API base 只接受 `http://127.0.0.1:<port>` 或 `http://localhost:<port>`，请求路径必须以 `/api/` 开头。
- 原生文件选择只返回用户明确选择的 `.md`、`.markdown`、`.txt` 内容；没有通用 shell 或任意文件系统命令。

### 持久化兼容

- 学习库相对路径转换集中到 `server/persistence/library-context.ts`。
- Markdown value-unit 编解码集中到 `server/persistence/markdown-value.ts`。
- 卡片 schema、目录映射、原子写入、真实路径边界与符号链接保护保持兼容。
- 新建学习库目录使用稳定中文映射：`01-阅读材料`、`02-概念卡`、`03-例子卡`、`04-边界卡`、`05-流程卡`、`06-错误卡`、`07-卡点诊断`、`08-复习记录`、`10-Codex任务`、`99-归档`；不创建旧的 `09-飞轮图谱`。

## 打包身份

- 产品版本：`0.1.0`
- 构建身份：`desktop-60e12e900719f58fa4da`
- 安装器：`artifacts/Aleksi-Workbench-Setup.exe`
- 安装器大小：`25,230,717` bytes
- 安装器 SHA-256：`4fb2bf7264ab49967ec82a21f913303ed475e0aa3bc82de98c2ebf5c9787a4f5`
- 安装包内随附：`aleksi-workbench.exe`、`resources/identity.json`、`resources/sidecar/node.exe`、`resources/sidecar/server.cjs`、`uninstall.exe`

## 真实安装态证据

### 安装与首次启动

- HKCU 卸载注册项显示 `Aleksi Workbench 0.1.0`，安装位置为 `C:\Users\pcp\AppData\Local\Aleksi Workbench`。
- 最终安装版在普通 Windows 启动环境中运行；没有依赖系统 Node、PowerShell、浏览器或源码目录。
- 最终重启 readiness：`127.0.0.1:52627`，shell PID `32416`，sidecar PID `42340`，构建身份与安装器一致。
- 重启前一轮：`127.0.0.1:59886`，shell PID `43288`，sidecar PID `42980`。
- 健康接口返回 `ok: true`、`version: 0.1.0`、相同 build ID。

### 中文路径学习闭环

独立验收学习库：`C:\Users\pcp\Documents\Aleksi 桌面验收学习库 20260716`。

- 初始化状态：`initialized: true`、`writable: true`。
- Reader 材料：`01-阅读材料/桌面验收：极限定义.md`。
- 概念卡：`02-概念卡/ε-N 定义.md`。
- 卡点诊断：`07-卡点诊断/卡点诊断：ε-N 定义.md`。
- 复习尝试：`review-c69c469495b2d83a862defc2fdcd7849eec939d5cc8f7f13b97e4b7249a4839b`；结果 `known`，间隔推进 7 天，`nextReview: 2026-07-23`。
- 验证证据：`evidence-55b5400511b44829c46014228b031f6b6bc139cadff350a9d1940e07193bb48d`；人工审查结论 `correct`，状态 `accepted`。
- 重启后重新读取到 1 条材料、1 张卡片、已接受证据，今日复习队列为 0，证明复习状态已经持久化。

### 可视化模块检查

通过 Windows.Graphics.Capture 与 UI Automation 在真实安装窗口中逐页观察：

- Today 显示 `ε-N 定义` 的唯一下一步。
- Reader 显示中文标题、正文与公式材料。
- Cards 显示最近概念卡、来源路径和“已有独立证据支持”。
- Verification 显示 `审查通过` 与已接受陈述。
- Flywheel 显示 `1 / 5` 覆盖以及概念、例子、边界、流程、错误五段闭环。
- Review 显示 `今日清空 / 今天没有到期卡片`，与已提交复习结果一致。

这些安装态截图显示在本次验收任务的 Computer Use 记录中。按照该工具的安全约束，没有把截图数据 URL 解码成伪造的本地文件；交付包中的 `artifacts/total-refinement-screenshots/` 是 Playwright 浏览器视觉 QA，不冒充安装态截图。

### 生命周期与卸载

- 第二次启动后仍只有原 shell PID `43288` 与原 sidecar PID `42980`，端口保持 `59886`，单实例通过。
- 正常关闭后 shell 与 sidecar 均为 0；重启后各恢复为恰好 1 个进程并换用动态端口 `52627`。
- 在 Reader 新材料抽屉输入未保存草稿后按 `Ctrl+Q`，应用没有退出，弹出“你有未保存的学习内容，确认要离开吗？”；确认后两个进程均归零。
- 退出前已把活动学习库恢复为 `C:\Users\pcp\Documents\Aleksi Learning Workbench`，状态可写。
- 静默卸载返回码 `0`；安装目录消失、HKCU 卸载项为 0。
- 卸载后原学习库、中文验收库、测试阅读材料和测试卡片全部仍存在。

## 发现并修复的安装态问题

第一次真实安装启动时 sidecar 健康接口可访问，但 WebView 显示本地服务不可用。根因不是 sidecar 崩溃，而是 `http://tauri.localhost` 到动态 loopback 端口缺少受限 CORS 响应。修复后加入桌面专用 origin allowlist 与 OPTIONS 处理，并补齐 CORS/API/runtime 测试；随后重新构建、重新安装并完成上述全链路验收。

一次通过 Computer Use 的直接 `launch_app` 启动继承了 Codex MSIX 的 AppData 重定向，触发学习库真实路径保护。改为正常 Windows `Start-Process` 启动后使用标准 `%LOCALAPPDATA%\io.aleksi.workbench`，问题消失；路径保护本身正确拒绝了越界写入。最终安装态证据全部来自正常启动环境。

## 验证命令

最终交付前执行并记录：

```powershell
npm.cmd run verify
npm.cmd run test:browser
npm.cmd run verify:clean-base
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
npm.cmd run verify:desktop
npm.cmd run package:desktop-source
npm.cmd run audit:desktop-source
```

机器可执行结果同时写入 `artifacts/AleksiWorkbench-Desktop-Verification-20260716.json`。

最终新鲜结果：

- `npm.cmd run verify`：通过；43 个测试文件，406 个测试通过，1 个符号链接用例因 Windows 返回 `EPERM` 明确跳过；Vite 生产构建完成，2186 个模块完成转换。
- `npm.cmd run test:browser`：通过；Chromium 端到端 4/4，包括启动、reduced-motion/缺失资产降级、后端不可用恢复、完整 ε-N 闭环与刷新持久化。
- `npm.cmd run verify:clean-base`：通过；从 `artifacts/aleksi-learning-workbench-source.zip` 解压副本重新 typecheck/build/test，随后再次重打包并审计；296 个条目，7,353,876 bytes。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：通过；4/4 Rust 单元测试。
- `npm.cmd run verify:desktop`：通过；安装器大小、SHA-256、sidecar 资源与 build ID 一致。

## 明确限制

- 安装器尚未进行 Authenticode 签名；不能声称 SmartScreen 信任或生产签名已完成。
- 已验证本机当前用户与中文 Documents 路径，但没有在独立的全新 Windows 账户或虚拟机上再跑一次完整安装矩阵。
- 当前机器已经安装 WebView2 Runtime，因此验证了 bootstrapper 配置与现有 Runtime 启动，没有实际触发“缺少 WebView2 时下载 bootstrapper”的联网分支。
- 没有执行多版本升级覆盖、企业策略、杀毒软件矩阵或 Windows 10/ARM64 验证。

## 保留的验收数据

`C:\Users\pcp\Documents\Aleksi 桌面验收学习库 20260716` 是独立验收证据，不属于安装目录。为避免未经许可删除用户可见数据，本轮卸载验证后保留该目录；如需清理，应先由用户确认。
