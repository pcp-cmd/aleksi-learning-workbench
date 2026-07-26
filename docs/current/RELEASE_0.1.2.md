# Aleksi Workbench 0.1.2 release qualification

Status: current release contract
Release type: unsigned-preview
Canonical identity: release/identity.json

## Canonical release path

    artifacts/release/aleksi-workbench/0.1.2/
    ├── Aleksi-Workbench-0.1.2-Setup.exe
    └── release-manifest.json

完整 installer path：

    artifacts/release/aleksi-workbench/0.1.2/Aleksi-Workbench-0.1.2-Setup.exe

安装器只有在 package:desktop 成功且 verify:desktop 对 MZ header、文件大小、SHA-256、sidecar identity、NSIS current-user 配置及 WebView2 策略全部通过后，才可称为本次资格验证候选物。

## 用户运行依赖

安装器内含按 Node.js 官方 SHA-256 固定校验的 bundled Node.js v22.23.1 runtime 和单一 Express sidecar bundle。因此最终用户：

- 不需要安装 Node.js 或 npm；
- 不需要安装 Visual Studio、Visual Studio Build Tools、Rust 或 Windows SDK；
- 不需要安装 VS Code；VS Code 只是可选编辑器；
- 不需要通过 PowerShell、命令提示符或外部浏览器启动应用。

Visual Studio Build Tools、Rust MSVC toolchain 和 Windows SDK 仅属于“从源码构建 Windows 安装器”的开发/CI 依赖，不属于已打包 EXE 的运行依赖。

## WebView2 online-light 与离线安装边界

Canonical policy 是 WebView2 online-light，Tauri 配置值为 downloadBootstrapper。

- 已安装兼容 WebView2 Runtime：安装器复用现有 Runtime，不需要再次下载。
- 未安装 WebView2 Runtime 且可以联网：bootstrapper 下载并安装所需 Runtime。
- 未安装 WebView2 Runtime 且完全离线：下载分支无法完成，本安装器不保证安装成功。

这意味着 0.1.2 不是 full-offline WebView2 installer。若部署环境必须完全离线，需要另行评审 fixed runtime 或 offline installer 的体积、更新和安全责任；不能把 bundled Node 与 bundled WebView2 混为一谈。

## 安全与身份边界

- Tauri sidecar 仅绑定动态 IPv4 loopback 127.0.0.1。
- 每次启动使用新的 256-bit 协议密钥；实际 API 请求要求允许的 Tauri Origin 和专用 secret header。
- ready record 同时核对 protocol version、shell build ID 与 sidecar build ID，但不包含 secret。
- packaged runtime 不读取相邻 .env，secret 不进入 URL、持久化或诊断。
- 应用能力清单只允许实际使用的自定义 Tauri commands；生产 CSP 不允许开发 localhost host。

## Windows release qualification workflow

.github/workflows/windows-release-qualification.yml 只完成以下工作：

1. 在 windows-2022 runner 安装 Node/Rust 构建依赖；
2. 执行 canonical identity 校验、npm audit、typecheck、完整 Vitest 和生产浏览器测试；
3. 执行 prepare:desktop；
4. 执行 Cargo format/check/clippy/test；
5. 运行 packaged sidecar 验证；
6. 构建 NSIS installer 并运行 verify:desktop；
7. 上传 canonical release directory 为 GitHub Actions artifact。

工作流明确不执行：

- Git tag 或 GitHub Release 创建；
- 自动发布、商店上传或更新通道写入；
- 安装器签名；
- 已安装应用/卸载验证；
- 任何真实证书、私钥或签名密码读取。

签名插入点被保留在 package 与最终 verify/upload 之间，但当前 workflow 只接受 canonical unsigned-preview 身份。将来接入签名必须单独审批法律发布者、证书保管、时间戳服务和密钥权限，不能直接在本工作流中增加真实凭据。

## 验证结论的边界

CI runner 是新建的托管构建环境，但不能等同于完整的最终用户 clean-machine matrix。尤其以下项目仍需独立证据：

- Windows 10 与不同 Windows 11 补丁级别；
- WebView2 已安装、缺失后联网下载、缺失且离线；
- 从 0.1.1 升级、重装和降级阻止策略；
- SmartScreen、Defender 与企业策略；
- 安装、双实例、窗口关闭、重启和卸载后学习库保留。

构建成功、artifact 上传成功、开发机安装成功和最终用户验收是四个不同声明，不得互相替代。
