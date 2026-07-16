# Aleksi Learning Workbench Packaging Roadmap

本路线按“证据层”串行推进，而不是按文件扩展名猜测完成状态。源码包、便携 runtime、NSIS 安装包和已安装运行各自有独立门禁；上一层通过不能自动证明下一层。

## 已完成基础：V0.2 clean source package

clean base 保留为桌面交付的可复现源头。内部验收包为：

```text
artifacts/aleksi-learning-workbench-source.zip
```

最终桌面命名源码包为：

```text
artifacts/AleksiWorkbench-Desktop-Source-20260716.zip
```

两者都必须由 `scripts/package-source.mjs` 生成并由 `scripts/audit-package.mjs` 审计，包含唯一 `SOURCE_PACKAGE_MANIFEST.json`。源码包排除 `.git`、`node_modules`、`dist`、测试报告、private-local 字体、`src-tauri/target`、生成的 sidecar 和桌面 identity。

验收入口：

- `npm run package:source` / `npm run package:audit`
- `npm run package:desktop-source` / `npm run audit:desktop-source`
- `npm run health:source`
- `npm run verify:clean-base`

`verify:clean-base` 必须在解包目录中重装依赖、执行类型/构建/测试、重打包并再次审计。它证明源码可复现，不证明安装器或已安装应用。

## 已保留兼容交付：Friend Preview Portable Runtime v0.1

旧 friend preview runtime 仍可单独生成：

```text
artifacts/AleksiWorkbench-Preview-win-x64.zip
```

它内嵌 Node，使用 `Start Aleksi Workbench.cmd`，在 `17817-17880` 选择 loopback 端口，并有独立的 `verify:runtime`。这是桌面安装包之前的兼容预览通道，不再代表当前最佳最终用户路径。

runtime package 只能证明该便携包，不能证明 NSIS 安装、WebView2、单实例、原生窗口或卸载行为。

## 当前交付：Windows Desktop Verification Preview

当前桌面产物为：

```text
artifacts/Aleksi-Workbench-Setup.exe
```

实现边界：

- Tauri 2 单窗口，NSIS `currentUser` 安装；
- WebView2 `downloadBootstrapper`；
- 内嵌当前 Node 22 runtime 和单一 Express bundle；
- 只以固定参数启动 `node.exe server.js`，不经过 PowerShell、cmd 或外部浏览器；
- sidecar 只绑定动态 `127.0.0.1` 端口，ready 记录必须匹配 version/build ID；
- single-instance、window-state、原生文件/目录选择、诊断导出、受保护退出；
- 本地学习库在用户 Documents，卸载不得删除。

静态/构建门禁：

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run package:desktop`
- `npm run verify:desktop`

运行门禁必须另行完成并记录：安装、首次启动、启动动画、动态端口、sidecar 身份、Today → Reader → Cards/Diagnosis → Flywheel → Review → Verification、第二实例、退出、重启、卸载和学习库保留。

当前桌面版本是验证预览，不是已签名商业发布。若未在独立干净账户/虚拟机完成验证，报告必须明确写“未验证”，不能用本机安装成功代替。

## 下一阶段：Signed Desktop Release

进入签名发布前必须回答：

- Authenticode 证书、时间戳与发布者身份；
- Windows Defender/SmartScreen 误报抽检；
- 完整的干净 Windows 10/11 x64 安装矩阵；
- 升级/降级、安装中断、WebView2 不同状态；
- sidecar 崩溃恢复与日志隐私；
- 用户主动清除应用设置时的明确提示；
- 自动更新是否需要以及如何保证永不触碰学习库。

自动更新、MSIX/Microsoft Store、跨平台安装包和服务端重写不属于当前桌面验证预览。

## 总规则

- private fonts are excluded from source package 和默认 desktop installer；KaTeX 依赖字体除外。
- clean source 通过不等于 runtime、installer 或 installed runtime 通过。
- installer 哈希一致只证明文件身份，不证明首次启动和卸载。
- 浏览器闭环通过不证明 Tauri command、single-instance 或原生退出。
- 已安装运行验证必须给出进程、端口、health/build identity、截图/日志与卸载后数据存在性证据。
- 每个未执行或受环境限制的门禁都要明确标记为未验证。
