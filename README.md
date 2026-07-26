# Aleksi Workbench 0.1.2

Aleksi Workbench 是一套 local-first Windows 学习工作台。精读、摘录、卡片、诊断、飞轮复习和证据核验都写入用户自己的 Markdown Local Learning Library；Markdown 是权威数据，可重建的 JSON 只承担索引和缓存职责。

## 当前发布入口

版本、产品名、应用标识、安装器名称、目录契约和 WebView2 策略只以 [`release/identity.json`](release/identity.json) 为准。0.1.2 的 canonical installer path 是：

```text
artifacts/release/aleksi-workbench/0.1.2/Aleksi-Workbench-0.1.2-Setup.exe
```

同目录的 `release-manifest.json` 记录安装器字节数、SHA-256、协议版本和 shell/sidecar build identity。只有执行 `npm.cmd run package:desktop` 并通过 `npm.cmd run verify:desktop` 后，这些文件才是本次构建的有效产物；仓库路径写在文档中不代表当前检出目录已经构建出安装器。

0.1.2 当前是 `unsigned-preview`。Windows 可能显示未知发布者提示。代码签名发布者身份仍需用户确认，不能把未签名资格验证写成已签名商业发布。

## Windows 用户安装

支持 Windows 10/11 x64，安装范围为当前用户。

- 用户不需要安装 Node.js：安装器包含固定且按官方 SHA-256 校验的 bundled Node.js v22.23.1 sidecar runtime。
- 用户不需要安装 Visual Studio、Visual Studio Build Tools、Rust、Windows SDK 或 VS Code。
- VS Code 只是可选编辑器，不是运行 Aleksi Workbench 的依赖。
- 应用不会通过 PowerShell、`cmd.exe` 或外部浏览器启动本地服务。

安装器采用 WebView2 `online-light` 策略，对应 Tauri 的 `downloadBootstrapper`：

- 机器已有兼容 WebView2 Runtime 时，可以直接使用已有 Runtime；
- 机器缺少 WebView2 Runtime 时，安装器需要联网下载；
- 完全离线且缺少 WebView2 Runtime 时，本安装器不能保证完成安装；应先联网安装 WebView2 Runtime，或以后单独制作离线 WebView2 交付物。

这条限制只涉及 WebView2。Node 已随应用打包，不会在用户机器上另行下载或要求全局安装。

## Local Learning Library

桌面态首次启动会建议当前 Windows 用户的默认位置：

```text
C:\Users\<you>\Documents\Aleksi Learning Workbench
```

用户可以在设置中创建、选择、迁移、备份或打开学习库。卸载应用不得删除 Documents 下的 Local Learning Library。

当前 Windows 路径契约：

| 用途 | 路径 |
| --- | --- |
| 默认学习库 | `%USERPROFILE%\Documents\Aleksi Learning Workbench` |
| 后备学习库 | `%LOCALAPPDATA%\io.aleksi.workbench\library` |
| 应用配置 | `%LOCALAPPDATA%\io.aleksi.workbench\settings\settings.json` |
| 日志 | `%LOCALAPPDATA%\io.aleksi.workbench\logs` |
| 可重建缓存 | `<LOCAL_LEARNING_LIBRARY>\.aleksi` |

## 运行边界

桌面窗口由 Tauri 2 承载；Express sidecar 只绑定动态 `127.0.0.1` 端口。每次启动生成临时协议密钥，实际 `/api` 请求必须同时来自允许的 Tauri Origin 并携带正确密钥。密钥不进入 URL、持久化文件或诊断输出。

前端只接受 `http://127.0.0.1:<port>`，不接受 `localhost`、IPv6、非 HTTP 或非 loopback 地址。普通 JSON 请求体上限为 256 KiB，阅读材料请求与详情响应均受 2 MiB 上限约束；JSON 响应上限为 2 MiB，默认请求超时为 15 秒。

## 开发者要求

网页与服务端开发需要：

- Node.js 22（普通网页/服务端开发）；桌面发布运行时固定为官方 Windows x64 Node.js v22.23.1；
- npm。

```powershell
npm.cmd ci
npm.cmd run dev
```

只有在开发者本地构建 Windows NSIS 安装器时，才需要 Rust MSVC toolchain、Visual Studio Build Tools 的 C++ 组件和 Windows SDK。日常使用者不需要这些工具，VS Code 也不能替代 MSVC linker 或 Windows SDK。

## 验证与打包

基础类型、单元/API/UI 测试和生产构建：

```powershell
npm.cmd run verify
```

桌面资源、Rust 与 sidecar：

```powershell
$env:ALEKSI_NODE_RUNTIME_PATH = 'C:\path\to\official\v22.23.1\win-x64\node.exe'
npm.cmd run prepare:desktop
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm.cmd run verify:packaged-sidecar
```

`prepare:desktop` 会在复制前同时校验该文件的版本、MZ 头和 canonical SHA-256；不会把当前 PATH 中任意 Node 可执行文件无条件打进安装器。官方许可证文本固定在 `release/licenses/NODEJS-LICENSE-v22.23.1.txt`，并随发布证据包交付。

生成并静态验证 canonical 0.1.2 installer：

```powershell
npm.cmd run package:desktop
npm.cmd run verify:desktop
```

`.github/workflows/windows-release-qualification.yml` 在 Windows runner 上重复资格验证并上传 workflow artifact。它只有 `contents: read` 权限，不创建 GitHub Release、不推送 tag、不发布安装器，也不读取真实签名凭据。

## 证据边界

- 源码测试通过，不等于安装器通过。
- 安装器静态验证通过，不等于已在独立干净 Windows 环境安装成功。
- 开发机启动成功，不等于升级、降级、WebView2 缺失或卸载保留数据矩阵通过。
- GitHub Actions 上传的 artifact 只是候选交付物，不是 GitHub Release。
- 任何跳过、环境限制或未执行步骤都必须明确记录为未验证。

## Documentation authority

`docs/current` 是当前产品、架构、打包与工程纪律的权威入口。当前发布说明见 [`docs/current/RELEASE_0.1.2.md`](docs/current/RELEASE_0.1.2.md)，发布证据层级见 [`docs/current/PACKAGING_ROADMAP.md`](docs/current/PACKAGING_ROADMAP.md)。旧的审计与实施记录只提供历史上下文；若与当前 canonical identity、当前文档或可运行测试冲突，以当前证据为准。
