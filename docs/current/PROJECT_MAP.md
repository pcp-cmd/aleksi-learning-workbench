# Project Map

Status: current architecture map for Aleksi Workbench 0.1.2, 2026-07-22.

## Runtime shape

```text
Tauri 2 window
  -> React route registry and feature UI
  -> typed desktop command bridge
  -> dynamic http://127.0.0.1:<port>/api/*
  -> SHA-256-pinned Node.js v22.23.1 + one Express server bundle
  -> Markdown Local Learning Library
```

网页开发态复用 React/Express，但 API 使用同源 Vite proxy；桌面态只接受经验证的动态 loopback base URL。两种形态没有第二套业务接口或持久化实现。

## Source tree responsibilities

### `src/app`

`route-registry.tsx` 是路由标题、短标签、层级和懒加载组件的唯一注册表。`routes.tsx` 只渲染注册表；`App.tsx` 负责 providers、启动门禁、桌面快捷键、未保存退出保护和 shell 组合，不拥有功能业务逻辑。

一级顺序固定为 Today → Reader → Cards → Flywheel → Review。Diagnosis 是 contextual，Verification 是 advanced。

### `src/desktop`

桌面边界只暴露类型化的最小命令：运行状态、重启 sidecar、选择阅读文件、选择/打开学习库、导出诊断、请求退出。它负责 Tauri 检测和 loopback URL 校验，不允许任意命令、任意参数或任意文件读取。

### `src/features` and `src/components`

功能目录拥有 Today、Reader、Cards、Diagnosis、Graph、Review、Verification、Settings 与 Entrance。`FlywheelBrandMark`、导航与 shell 邻接组件可跨功能复用，但不创建第二套存储契约。

`entrance/launch-machine.ts` 是纯状态机。完成启动需要动画完成（或 reduced-motion 等价事件）、最短展示时长与 sidecar ready；桌面最多等待 12 秒并进入可重试 fallback。真实 Lottie 素材按目标展示时长调速。

### `src/markdown`

拥有 Markdown/KaTeX 渲染、remark/rehype 插件和文章排版。渲染器与数学 CSS 在 Reader 边界懒加载，不阻塞桌面启动包。

### `src/lib`

`api-client.ts` 是唯一请求/error pipeline。桌面 base URL 必须是 `http://127.0.0.1:<port>`，不接受 `localhost`、IPv6 或非 loopback 地址；路径必须以 `/api/` 开头。桌面会话原子安装 base URL 与每次启动的 protocol secret，secret 只进入专用 header。JSON 响应最多 2 MiB，默认 15 秒超时，公开调用可以用 `AbortSignal` 主动取消。

### `shared`

只放前后端都可引用的稳定契约：卡片类型、日期与学习库目录映射。`server` 可以依赖 `shared`；`shared` 不依赖 `src` 或 `server`。

### `server`

`runtime-config.ts` 区分正常开发端口与桌面端口 `0`。`start-server.ts` 在真实监听完成后只输出一条 `ALEKSI_READY` 身份记录。`app.ts` 保持 API、JSON 404、错误中间件、SPA fallback 的明确顺序。

`server/routes` 只处理 HTTP 输入/输出，`server/services` 持有业务行为，`server/persistence` 持有安全路径、原子文件与 Markdown value-unit 边界。学习库相对路径和 Markdown 值解析各只有一个实现。

`verification-service.ts` 是 Danus-inspired trusted-knowledge gate 的公共 facade；`verification-revocation.ts` 负责传递撤销，候选、裁决、撤销和投影是不可变/派生记录，不修改卡片 mastery。

### `src-tauri`

- `src/runtime.rs`：解析资源、以固定 `node.exe server.cjs` 参数启动 sidecar、校验 ready 身份、保存动态端口、写日志、优雅退出与有界 kill fallback。
- `src/commands.rs`：本地对话框、经过验证的学习库打开、诊断导出与退出命令。
- `src/lib.rs`：single-instance 插件先注册，window-state 次之；负责主窗口 focus 与进程生命周期。
- `tauri.conf.json`：单窗口、loopback CSP、NSIS current-user、WebView2 bootstrapper、sidecar 资源。
- `resources/` 和 `target/`：生成状态，必须从源码包排除。

### `scripts` and `artifacts`

`prepare-desktop.mjs` 生成 Node/server/identity 资源；`package-desktop.mjs` 只接受真实 MZ NSIS 输出；`verify-desktop.mjs` 校验安装包、sidecar 哈希、build identity 和配置边界。

`package-source.mjs` 与 `audit-package.mjs` 生成/审计源码 ZIP。`verify-clean-base.mjs` 在解包源码中重装、构建、测试并验证幂等打包。正式交付位于 `artifacts/`，用户学习库绝不进入该目录。

### `release` and Windows CI

`release/identity.json` 是 0.1.2 发布名称、版本、安装器文件名、Windows 目录、本地协议、签名状态和 WebView2 `online-light` 策略的单一来源。Canonical installer path 是 `artifacts/release/aleksi-workbench/0.1.2/Aleksi-Workbench-0.1.2-Setup.exe`。

`.github/workflows/windows-release-qualification.yml` 只负责在 Windows runner 上构建、验证并上传 artifact；它不创建 GitHub Release，不使用真实签名凭据。安装器包含 bundled Node，所以用户不需要 Node.js 或 Visual Studio；WebView2 缺失时的 bootstrapper 下载仍需要网络。

## Durable data compatibility

- Markdown 仍是权威事实；`.aleksi` JSON 可重建。
- 新 review 写入 `08-复习记录`，读取兼容旧 `08-飞轮复习`。
- 新 graph state 写入 `.aleksi/graph-state.json`；旧目录不删除、不移动。
- 所有用户选择路径仍由服务端安全边界最终裁决。

## Boundary rules

- `server` 不导入 `src`，`shared` 不反向依赖运行层。
- 浏览器和桌面共用现有保存流程，不添加原生直写学习库的捷径。
- Tauri 命令不能接受可执行程序名、shell 文本或任意 API URL。
- 源码验证、浏览器验证、安装包静态验证和已安装运行验证必须分别记录。
- private-local UI 字体不进入源码包或默认安装包；KaTeX 依赖字体除外。
