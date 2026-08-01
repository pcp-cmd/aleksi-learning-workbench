# Engineering Discipline

Status: current effective engineering discipline for Aleksi Learning Workbench V0.2.

This project is a local-first learning workbench, not a demo stack or a place for visual experiments. Every change must make the codebase cleaner, more stable, easier to package, and easier to maintain.

## Codex 八荣八耻

```text
以瞎猜接口为耻、认真查询为荣；
以模糊执行为耻、寻求确认为荣；
以臆想业务为耻、人类确认为荣；
以创造接口为耻、复用现有为荣；
以跳过测试为耻、验证通过为荣；
以隐藏错误为耻、暴露问题为荣；
以过度设计为耻、最小实现为荣；
以破坏结构为耻、维护秩序为荣。
```

## Karpathy Engineering Skill

```text
先读全局，再动局部。
先定位层级，再写代码。
优先删除和合并旧代码，再新增必要代码。
用最少代码解决真实问题。
不要为了局部修复制造长期技术债。
每一行 diff 都要能解释为什么存在。
```

Before modifying code, identify the affected layer:

- token 层
- 组件层
- feature 层
- 数据模型层
- server 层
- 测试层
- 文档层
- 封装层

Do not cover a problem at the nearest CSS or component surface when the root cause is a shared token, schema, routing, packaging, or data-model boundary.

## Hard prohibitions

- 禁止热补丁式 CSS 覆盖问题。
- 禁止使用 `!important` 压制样式冲突。
- 禁止新增重复组件绕过旧组件。
- 禁止重复定义 schema、card type、Vault directory map, or date logic.
- 禁止破坏 `src` / `shared` / `server` 代码树边界。
- 禁止让 `server` 依赖 `src`。
- 禁止让源码交付包包含 `node_modules`、`dist`、缓存或测试报告。
- 禁止为了交付源码包而改做 Electron、exe 或安装器。

## Verification rule

Completion is not a feeling. A change is complete only when the relevant tests or verification commands prove it. If verification fails, report the failing command, root cause, related files, current fix status, and remaining risk.
