# Aleksi Learning Workbench 当前技术债登记

Status: current repository truth for 0.1.5-rc.1 after final-closure remediation.

本文件只记录仍然存在的债务。已解决事项由 Git 历史、测试和发布证据保存，不再与当前债务混排。

## 当前非阻断债务

### TD-P1-004：历史 `components.css` 职责较大

- 状态：已登记，非当前 release qualification blocker。
- 风险：布局、组件、状态和兼容样式集中，视觉修改的影响范围偏大。
- 边界：不为压缩行数做无保护的大换皮；新代码优先使用语义 surface 类。
- 验证：任何拆分都必须保持 Today、Reader、Cards、Settings 的 UI/E2E 测试通过。

### TD-P1-005：历史 `.claude-card` 命名仍存在

- 状态：已登记，非功能债务。
- 风险：历史视觉命名可能继续扩散。
- 边界：新增组件不再默认采用该类名；后续仅在有视觉回归保护时渐进替换。

### TD-P2-001：Tauri 桌面产物尚未签名

- 状态：当前 RC 明确为 `unsigned-preview`。
- 风险：Windows 会显示未知发布者；这不等同于源码或安装器验证失败。
- 收束路径：稳定 `v1.0.0` 发布工作流要求 Authenticode 凭据、环境审批和完整稳定证据。

### TD-P2-002：大体积内容仍需持续性能监测

- 状态：现有 Markdown 分块、搜索、性能测试和大小上限均已落地。
- 风险：极端文档仍可能暴露新的浏览器内存或布局瓶颈。
- 边界：继续使用现有 profile/performance 测试，不新增第二套渲染器或存储格式。

### TD-P2-003：`vault-service.ts` 剩余架构余量有限

- 状态：已审查并有 1125 行架构上限；本轮未做投机性拆分。
- 原因：当前迁移、恢复和路径安全责任高度耦合于事务语义，未经额外故障注入 characterization 不适合为指标移动代码。
- 后续触发条件：只有新增 vault 行为，或可识别出独立且充分测试的迁移子系统时，才进行职责提取。

## 当前已实现事实

- Card library 已支持分页、搜索、筛选、详情、编辑、归档和来源返回；它不是 deferred 功能。
- ESLint 已接入 `npm run lint` 与 Source CI；不存在“尚未建立 lint baseline”的当前债务。
- 正式 Windows RC 安装器由 GitHub Actions 的 canonical qualification/build 入口生成；本地不承担正式安装器构建。
- `windows-qualification.yml` 是可复用 qualification workflow，正式手动入口是 `build-current-windows-installer.yml`。
- Quick installer 仅为 `UNQUALIFIED / DEBUG ONLY / NOT FOR RELEASE`。
- 桌面 runtime bootstrap 与入口动画状态相互独立，Tauri API session 未就绪时 fail closed。

## 当前发布边界

源码包验证、GitHub Actions Windows qualification、安装器静态验证、已安装 runtime 验证和最终用户验收是五个不同证据层。任何一层通过都不能替代另一层；未执行的层必须明确写为 `NOT EXECUTED`。
