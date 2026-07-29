# Aleksi Workbench packaging roadmap

Status: current for 0.1.5-rc.1.
Authority: release/identity.json and executable verification gates.

本路线按证据层串行推进。源码、生成资源、sidecar、NSIS installer、已安装 runtime 和最终用户环境各有独立门禁；上一个层级通过不能自动证明下一个层级。

## 当前候选交付：0.1.5-rc.1 unsigned Windows installer

Canonical directory：

    artifacts/release/aleksi-workbench/0.1.5-rc.1

Canonical installer：

    artifacts/release/aleksi-workbench/0.1.5-rc.1/Aleksi-Workbench-0.1.5-rc.1-Setup.exe

Canonical manifest：

    artifacts/release/aleksi-workbench/0.1.5-rc.1/release-manifest.json

它是 Tauri 2 生成的 per-user NSIS 候选安装器。package:desktop 负责构建并复制唯一 NSIS 输出；verify:desktop 负责校验 MZ header、最小体积、SHA-256、版本、protocol、shell/sidecar build identity、资源哈希、currentUser 与 WebView2 配置。

路径存在于文档或 identity 中不等于文件已经生成。只有当前构建的 installer 和 manifest 同时通过静态门禁，才能上传为 workflow artifact。

## 最终用户依赖边界

安装器包含 bundled Node runtime 与 server.cjs。最终用户不需要安装 Node.js、npm、Visual Studio、Visual Studio Build Tools、Rust、Windows SDK 或 VS Code。Visual Studio Build Tools 与 Rust MSVC 只用于从源码构建原生 Windows 安装器。

WebView2 policy 是 online-light，Tauri install mode 是 downloadBootstrapper：

- 已有兼容 WebView2 Runtime：复用现有 Runtime；
- 缺少 Runtime 且联网：bootstrapper 下载；
- 缺少 Runtime 且离线：当前安装器无法保证成功。

因此 bundled Node 不代表 bundled WebView2。若需要完全离线安装，必须作为新的交付类型评审和验证，不能静默改变当前候选版本的体积与更新责任。

## 证据层

### Gate A — canonical identity

- release/identity.json 是产品名、版本、标识符、安装器名、路径、签名状态和 WebView2 policy 的单一来源。
- verify-release-identity 必须在构建前通过。
- 当前 signing status 必须是 unsigned-preview；法律发布者仍待用户确认。

### Gate B — npm/source verification

- npm ci 使用锁文件安装；
- npm audit、typecheck 与完整 Vitest 通过；
- 生产 Vite build 与字体交付门禁通过；
- 生产浏览器回归单独记录。

源码包与 installer 是不同交付物。source package 只证明源码内容和可复现入口，不证明 native build、NSIS 或 installed runtime。

### Gate C — generated desktop resources

- prepare:desktop 生成 bundled Node、单一 server.cjs 和 identity.json；
- protocol version、shell build ID 与 sidecar build ID 必须一致；
- packaged sidecar 在中文/空格路径上使用动态 127.0.0.1 端口；
- hostile .env、无鉴权请求、诊断脱敏、写入、重启与优雅退出门禁通过。

### Gate D — Rust/Tauri qualification

- cargo fmt --check；
- cargo check --locked；
- cargo clippy --all-targets --locked -- -D warnings；
- cargo test --locked；
- 最小 capability allowlist 与生产 CSP 契约通过。

### Gate E — NSIS package

- package:desktop 构建真实 NSIS EXE；
- verify:desktop 对 installer、manifest 和 bundled resources 进行静态核对；
- Windows workflow 上传 canonical directory，但不创建 GitHub Release。

### Gate F — installed runtime

安装、首次启动、启动动画、动态端口、API 鉴权、单实例、窗口关闭、重启、升级和卸载保留学习库需要独立执行。CI 构建机或开发机验证不能被描述为完整 clean-machine 用户验收。

## Windows CI policy

.github/workflows/windows-release-qualification.yml 在 windows-2022 上执行 Gate A 至 Gate E，并上传短期 GitHub Actions artifact。

当前归档候选分支的 push、PR 验证和 Windows 构建只有 `contents: read`；仅从 `main` 手动运行且前置资格任务通过后，独立证明任务才获得 `id-token: write` 与 `attestations: write`。工作流不执行 tag、push、GitHub Release、商店发布或自动更新。签名插入点被记录，但当前 workflow 不读取证书、私钥、签名密码或任何 secrets；真实签名必须另行授权。

## 后续 signed release

签名前仍需完成：

- 法律发布者名称、证书与时间戳服务确认；
- 最小权限的证书保管和轮换流程；
- Defender/SmartScreen 与企业策略矩阵；
- Windows 10/11 x64 clean-machine 安装；
- WebView2 已有、缺失联网、缺失离线三种状态；
- 从当前固定前代升级、重装、降级与安装中断；
- 卸载后 Local Learning Library 保留。

在这些证据完成前，0.1.5-rc.1 只能称为 unsigned preview / release candidate，不能称为 signed production release。

## 历史兼容记录（不是当前发布路径）

以下名称保留用于旧脚本与历史审计检索，不是当前候选的 canonical 交付。friend preview runtime 也不再代表当前最终用户路径：

- 已完成基础：V0.2 clean source package；
- Friend Preview Portable Runtime v0.1；
- 当前交付：Windows Desktop Verification Preview；
- 下一阶段：Signed Desktop Release；
- artifacts/aleksi-learning-workbench-source.zip；
- artifacts/AleksiWorkbench-Desktop-Source-20260716.zip；
- artifacts/Aleksi-Workbench-Setup.exe；
- artifacts/AleksiWorkbench-Preview-win-x64.zip；
- Start Aleksi Workbench.cmd；
- 历史 friend preview 端口范围 17817-17880。

历史 runtime package 只能证明该便携包。clean source 通过不等于 runtime、installer 或 installed runtime 通过。private fonts are excluded from source package；KaTeX 依赖字体除外。
