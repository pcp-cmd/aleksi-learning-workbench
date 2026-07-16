# Font Usage Policy

Aleksi Learning Workbench 支持用户本地私用字体，但字体边界必须和交付边界分开。不要删除用户本地私用字体，也不要让 source package 带字体。

## worktree/private-local

在用户自己的 worktree 或本地私用安装里：

```text
允许 public/fonts/claude 存在。
```

这些字体只能来自用户已经拥有的本地来源，例如 `claude-fonts.zip` 或 `typora_claude-main/claude-fonts/`。Do not download these fonts from the internet. 不要从互联网下载，不要猜测替代字体名，不要复制完整 `claude.css` / `claude-dark.css` 主题文件来污染本项目样式。

本地私用规则：

- 可以读取 `public/fonts/claude/` 作为 private-local 视觉资源。
- 默认应用构建不引用这些私有路径；`src/styles/fonts.css` 只允许在 Vite dev/private-local worktree 中加载，避免 source/runtime build 对缺失私有字体产生解析警告。
- 不要删除用户本地私用字体，除非用户明确要求。
- 不要重命名字体文件来伪装授权状态。
- Do not commit the font binaries to the repository.
- 不要把字体二进制提交到公共仓库。

## local copy helper

`scripts/copy-claude-fonts.mjs` 只从用户提供的本地路径复制字体到 `public/fonts/claude/`。它用于 private-local worktree，不是下载器，也不是授权证明。

操作边界：

- 只从用户提供的本地路径复制。
- 不下载字体。
- 复制前必须校验所需字体文件存在。
- 复制结果仍然必须被 source package 排除。

## source package

source package 是当前 V0.2 clean base 的唯一交付形态。

```text
默认排除 public/fonts/claude。
```

原因：

- source package 可能被复制、上传、交给别人或进入公开仓库；
- Claude/Typora 来源字体授权状态不是本项目默认授权；
- 源码包不需要私有字体才能运行和测试；
- 字体进入 source package 会扩大体积和版权风险。

验收：

- `scripts/package-rules.mjs` 将 `public/fonts/claude/` 作为 excluded private-local content。
- `npm run package:audit` 不允许 source zip 中出现该目录。
- 文档和最终报告必须把“字体未进入 source package”与“用户本地字体未删除”分开说明。

## runtime private build

未来 runtime private build 可以选择包含私用字体，但必须显式 private mode。

要求：

- 构建命令或配置必须出现明确的 private mode 开关；
- manifest 必须标记字体来源和 private distribution 边界；
- audit 必须能区分 public runtime 与 private runtime；
- 用户必须知道该包不适合公开分发。

如果没有显式 private mode，就按 public/open-source/runtime 规则处理：不包含字体。

## public/open-source/runtime

公开、开源、共享给他人或默认 runtime 包：

```text
禁止包含，除非授权确认。
```

这里的“授权确认”必须是明确证据，不是“看起来像免费字体”。在未确认之前，public/open-source/runtime 只能使用系统 fallback 字体栈。

当前 friend preview runtime 会删除 `app/dist/fonts/claude/`，并由 runtime audit 阻断改名后的非 KaTeX 字体二进制、SHA-256 与当前 KaTeX 依赖不一致的伪装字体、非 KaTeX `@font-face`、私有字体路径和已知私有字体文件名。KaTeX 自带的数学排版字体属于应用依赖且是公式正确显示所必需，不属于 UI 私有字体；除此之外，朋友预览使用系统 fallback 字体栈。

## EXE / installer

Windows 便携 exe 或安装器同样不能默认包含 `public/fonts/claude/`。如果某个 private exe 需要字体，必须继承 runtime private build 的显式 private mode、manifest 和 audit 要求。

## 操作底线

- 不要删除用户本地私用字体。
- 不要让 source package 带字体。
- 不要把 private-local 视觉资源解释成 public license。
- 不要为了“看起来一致”牺牲交付边界。
