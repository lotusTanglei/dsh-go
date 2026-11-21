# DSH Super-agent

在 DeepSeek Harness 上实现的一个 Super-agent bundle：一个常驻调度会话（Router）+ 每个任务一个独立执行会话（Worker）+ 独立巡检会话（Watchdog）+ Web 面板。

**当前状态：看板工作区开发中，部分完成／不可交付，非生产就绪。** 本轮真实安装版探针证明 L1 spawn 继承父根、L2 同票未授权/deny 路径仍可被 native/shell 写入；生产 Worker 启动与恢复执行现已 fail-closed。历史 A/B/C 证据保留，不代表当前安全门禁已通过。

已实现后端：持久命令与幂等回执、显式任务定向、当前可信输入建单确认、分页对话/看板/任务时间线、结构化结果确定性 Outbox 摘要。最新完整门禁 **585 tests／typecheck／build／pack** 通过；真实 Host 本地确定性适配器验证发送、精确计划批准、建票、唯一通知及 Worker 阻断，**外部 provider 请求 0，不是真实 Worker 完成证明**。单一工作区四列UI已实现，左栏按使用流程重做为“交给超管”：空态引导需求、决策优先、动态合计3行、规划任务/问一问；日常数据来自未筛选账本，原始会话保留为次级历史。用户截图已证实旧页能连接；匿名curl 401不能判断浏览器认证。旧v2已被用户截图判定信息堆砌不可用；本次重做去掉重复标题、版本/账本说明与空分组，只保留“交给超管”、次级历史、可操作决策和紧凑输入。当前新版资源须加载后再核实，完整视觉/交互仍未验。完整逐项结论见[本轮验收](<docs/KANBAN-ACCEPTANCE.md>)，人工步骤见[工作区人工清单](<docs/KANBAN-MANUAL.md>)。

跨会话只读来源已实现：当前 DSH Host 的普通会话**默认纳入，可手动排除/恢复**；在工作区单独展示已有目标/步骤/提问，不接管、不激活、不重复建票，看板数字仍仅统计正式 Ticket。范围、冷读取及未覆盖审批的限制见[会话来源](<docs/KANBAN-SESSION-COVERAGE.md>)。

仍未完成：L1/L2 执行级隔离、真实产品端到端和浏览器视觉/IME/键盘验收、真实成本曲线。owner主目录内规范项目可显示`~/完整项目后缀`，不改变实际执行路径；其他范围/动作若被脱敏而无法完整审阅仍禁批。未知请求已支持显式终止路由（不停止模型/已受理任务）；人工停止后可带来源铺新任务草稿，需新计划确认。首次项目选择与跨机器项目映射仍未闭合。不得用 prompt、删 bash、目录沙箱或 stub 冒充逐文件安全。Desktop 未改。

证据与下一步见 [最终验收2](docs/FINAL-VERIFY-2.md)、[收口A](docs/CLOSEOUT-A.md)／[B](docs/CLOSEOUT-B.md)／[C](docs/CLOSEOUT-C.md)、[已知限制](docs/KNOWN-LIMITS.md)、[发布](docs/RELEASE.md)与[运维](docs/OPERATIONS.md)。旧证据保留于[最终验收记录](docs/FINAL-VERIFY.md)、[P3](docs/P3-report.md)／[P4](docs/P4-report.md)／[P5](docs/P5-report.md) 报告。旧 P2/A3 计数与注入证明的问题已在 [诊断更正](docs/P2-DIAGNOSIS.md) 披露。

新增任务来源：[企业微信文档 Source](<docs/WECOM-DOCUMENT-SOURCE.md>)。可配置多文档/表/范围/筛选，工作区手动读取、查原文及截图后生成待确认计划；外部内容保持不可信，重复读取/移动/修订/停止不自动重复建票。不加轮询、不写回。连接器最小 typed/strike 补丁已附包；继承/未知格式禁止自动导入，仅完整unknown项允许打开原表显式核对留痕后生成计划；已知划掉及其他阻断不可覆盖。尚未重载运行中的MCP或用指定真实文档验收，不能称任意企微文档完整可用。

## 读什么

| 文档 | 内容 |
|---|---|
| [000 · 总览](docs/000-overview.md) | 目标/非目标、环境约束、全景图、验收总纲 |
| [001 · 领域模型](docs/001-domain.md) | 对象定义、五个状态机、十条不变式 |
| [002 · 架构](docs/002-architecture.md) | 分层、三个会话角色、角色隔离、Source/Channel 接口 |
| [003 · 关键流程](docs/003-flows.md) | 八条主链路的时序与失败分支 |
| [004 · 持久化与恢复](docs/004-persistence.md) | 表结构、迁移、幂等、崩溃恢复 |
| [005 · 安全与预算](docs/005-security-budget.md) | 信任边界、权限矩阵、审批、注入防御、成本 |
| [006 · 面板](docs/006-panel.md) | 七页信息架构、Host 路由、前端约束 |
| [007 · 开发计划](docs/007-plan.md) | 阶段、任务、验收、风险、探针 |
| [008 · DSH API 映射](docs/008-dsh-api-map.md) | 已核实的扩展点与"不存在的 API"清单 |

## 三条最关键的结论

1. **角色组合使用 agentPreset，补充仅拒绝的执行权限闸**（用户已确认方案 1）。不用 `ctx.tools.restrict` 做身份隔离：它会连带影响后代。Host 全局 schema 可能仍可见，执行拒绝不等于隐藏。
2. **审批必须自建**——DSH 内置审批无类别注册，且本机策略为 `never`，调用只会返回 `unavailable`。
3. **v1 是被动入站**——不轮询、不建连接、不碰凭据；DSH 会话是第一个通道，也是唯一一个。

## 环境

- DSH Desktop `0.2.2-rc.3`（Electron 44.7.0 / Node 24.21.0）
- 持久化用内置 `node:sqlite`，零原生依赖
- 不修改任何 `@deepseek-ai/*` 包，通过 bundle patch 加载
- `engines.dsh` 经用户确认包含当前预发布版：`>=0.2.2-rc.3 <0.3.0`，未使用版本风险豁免

## P1 复现

```sh
pnpm typecheck && pnpm test && pnpm build
node --test tests/domain-bare.test.mjs
```

本轮已验证安装版 Electron Node 24.21.0 可运行 typecheck／Vitest／build／pack 与 `node:sqlite`；系统 PATH Node 22.23.1 不满足 manifest engine。本轮使用独立 Node shim 指向安装版运行时，未改签名或关闭系统保护；具体命令和原始输出见 [本轮进度](<docs/PROGRESS-KANBAN.md>) 与 [能力边界](<docs/KANBAN-CAPABILITY.md>)。

Desktop profile 由应用管理，CLI 的 plugin add / dump-config 均拒绝。安装使用桌面 Plugin Manager 的本地目录入口。P1 验收安装后已卸载，不残留活跃插件。`cordis.patch.yml` 配置数据目录；`host-runtime.json` 仅为安装版 Schemastery 引导路径，迁移到其他机器时须设置新路径（或由 DSH_INSTALL_DIR 提供）。没有把 DSH 包复制到项目或改写安装包。

初始迁移含 16 张表（14 业务表 + schema_migrations/kv），必填 `ticket.brief_json` 保存 rev2。迁移只增不改；降级拒开；升级前先 checkpoint/备份；回滚需停插件并恢复匹配版本的完整备库。文件锁使用原子发布与 SQLite 恢复互斥，异常退出后仅回收已确认死亡的 owner；无法确认的损坏锁 fail-closed，不自动删未知文件。

P1 不安装角色工具，也不执行探针权限闸的产品逻辑。方案 1 的真实执行证据位于 probes 下，P2 才接入领域库的 Assignment 绑定。
