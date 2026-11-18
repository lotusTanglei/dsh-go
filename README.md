# DSH Super-agent

在 DeepSeek Harness 上实现的一个 Super-agent bundle：一个常驻调度会话（Router）+ 每个任务一个独立执行会话（Worker）+ 独立巡检会话（Watchdog）+ Web 面板。

**当前状态：A/B 自动验收完成，整体仍是部分交付，不可宣称生产上线。** 最新 typecheck／**165 项测试**／build 通过；A四页真实数据/静态证据完成，B受控单Worker stall→nudge→cancel→escalate真实链完成，C离线并发/故障/注入证据完成。

仍未完成：实际浏览器视觉、10-ticket真实成本曲线，以及 Ticket `allowWrite/denyWrite` 的执行级文件/命令隔离。C1-2已实测 write/bash 越界工具体可达，属于 **RELEASE BLOCKER**；不要把 prompt标记、workspace sandbox 或局部角色guard冒称为逐文件安全边界。desktop 未改。

证据与下一步见 [最终验收2](docs/FINAL-VERIFY-2.md)、[收口A](docs/CLOSEOUT-A.md)／[B](docs/CLOSEOUT-B.md)／[C](docs/CLOSEOUT-C.md)、[已知限制](docs/KNOWN-LIMITS.md)、[发布](docs/RELEASE.md)与[运维](docs/OPERATIONS.md)。旧证据保留于[最终验收记录](docs/FINAL-VERIFY.md)、[P3](docs/P3-report.md)／[P4](docs/P4-report.md)／[P5](docs/P5-report.md) 报告。旧 P2/A3 计数与注入证明的问题已在 [诊断更正](docs/P2-DIAGNOSIS.md) 披露。

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

DSH 自带 Node 在 macOS 上拒绝加载 Rollup 原生模块（签名 Team ID 不同）；开发测试使用本机普通 Node 22.23.1，真实插件/SQLite 用 Electron Node 24.21.0 另验。未改签名或关闭系统保护。

Desktop profile 由应用管理，CLI 的 plugin add / dump-config 均拒绝。安装使用桌面 Plugin Manager 的本地目录入口。P1 验收安装后已卸载，不残留活跃插件。`cordis.patch.yml` 配置数据目录；`host-runtime.json` 仅为安装版 Schemastery 引导路径，迁移到其他机器时须设置新路径（或由 DSH_INSTALL_DIR 提供）。没有把 DSH 包复制到项目或改写安装包。

初始迁移含 16 张表（14 业务表 + schema_migrations/kv），必填 `ticket.brief_json` 保存 rev2。迁移只增不改；降级拒开；升级前先 checkpoint/备份；回滚需停插件并恢复匹配版本的完整备库。文件锁使用原子发布与 SQLite 恢复互斥，异常退出后仅回收已确认死亡的 owner；无法确认的损坏锁 fail-closed，不自动删未知文件。

P1 不安装角色工具，也不执行探针权限闸的产品逻辑。方案 1 的真实执行证据位于 probes 下，P2 才接入领域库的 Assignment 绑定。
