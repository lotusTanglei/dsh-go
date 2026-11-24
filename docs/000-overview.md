# 000 · 总览

## 1. 这份文档集是什么

**Go**：一个跑在 DeepSeek Harness（DSH）上的 **Super-agent bundle** 的完整设计与开发计划。
不含产品代码，只有方案、接口契约、状态机、表结构、阶段计划与验收口径。

| 文档 | 内容 |
|---|---|
| 000 | 总览：定位、目标、边界、术语、全景 |
| 001 | 领域模型：对象、状态机、硬规则不变式 |
| 002 | 架构：分层、三个会话角色、Source/Channel 接口 |
| 003 | 关键流程：八条主链路的时序与失败分支 |
| 004 | 持久化与恢复：表结构、迁移、幂等、崩溃恢复 |
| 005 | 安全与预算：信任边界、权限矩阵、审批、成本、并发 |
| 006 | 面板：信息架构、路由 API、前端约束 |
| 007 | 开发计划：阶段、任务、验收、风险、未验证项 |

引用约定：`xxx.md:NNN` 指 `$DSH_INSTALL_DIR/docs/subsystems/xxx.md` 第 NNN 行，基线版本 **DSH 0.2.2-rc.3**。
`$DSH_INSTALL_DIR = /Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh`。

---

## 2. 要解决的问题

一个人同时只能盯 3–5 个活跃会话，单任务上限是模型能力，多任务上限是人的注意力。
本系统的目标不是让模型更聪明，而是**把人的注意力从"盯着执行"挪到"做判断"**。

推论（决定了后面所有设计）：

1. 重活必须挪到独立会话、独立目录，否则会挡住统一入口。
2. 决策与执行必须是两个角色，否则"要不要做"和"怎么做"互相污染。
3. 外部事件必须能被过滤、去重、串行化，否则人会淹没在噪声里。
4. 卡住的任务必须被发现，否则"自主"等于"失控"。
5. 所有副作用必须可归因、可重放、可恢复，否则出事无法定位。

---

## 3. 目标（v1 必须全部成立）

1. 可作为一个 DSH bundle 通过 patch 加载，**不修改任何 `@deepseek-ai/*` 包**。
2. 一个常驻 **Main Session（Router）**：评估、派活、对外回复、持有全局状态。
3. 每个 Ticket 一个独立 **Executor Session（Worker）** 与独立工作目录。
4. 入站为**被动**：不轮询、不建 WS、不碰外部凭据；会话是第一个通道。
5. 端到端：3 条事件 → 2 个 Ticket → 2 个 Worker → 2 条回复。
6. 重复投递同一事件只产生一个 Ticket。
7. 进程重启后未完成的工作继续，且**不重复执行外部副作用**。
8. 角色隔离：Router 不能写文件/跑 shell；Worker 不能直接对外发言。
9. 独立 **Watchdog Session**：按进展、空转、预算判定，而非进程存活。
10. Web 面板：只读 + 审批按钮，七个页面。
11. 日志与面板中不出现密钥、token、私有 URL。
12. 新增 Source 只需实现 `Source` 接口。

## 4. 非目标

- 通用工作流引擎（不做 DAG、不做任意编排 DSL）。
- 多租户 SaaS、多用户 RBAC。
- 向量库、长期记忆系统（记忆交给 DSH 自带的 memory / documents）。
- 重写 DSH 的 Agent Loop、工具运行时、会话存储。
- 一次支持所有代码平台（v1 只留 GitHub 的接口位，实际不接）。

---

## 5. 运行环境约束（已实测，不是假设）

| 事实 | 影响 |
|---|---|
| DSH Desktop 打包版 **0.2.2-rc.3**，核心在 `app.asar` 内，本机无源码 checkout | 我们做**独立包**，不参与 DSH 的 pnpm workspace |
| Electron 44.7.0 / **Node 24.21.0**，`node:sqlite` 可用 | 持久化用内置 SQLite，零原生依赖 |
| 桌面 GUI 只监听 `127.0.0.1:60003`，无公网入口 | webhook 物理不可用；v1 本来就只做被动入站 |
| 本会话审批策略为 `never` | `ctx.approval.request` 只会返回 `unavailable`，**审批必须自建** |
| `dsh` CLI 不在 PATH，只有 asar 内 `lib/bin.js` | 安装方式待验（见 007 的 S1） |
| `docs/subsystems/` 共 47 篇，含 `web-server.md` | Web/面板能力有正式文档，不靠猜 |

## 6. v1 的边界（明确砍掉的东西）

- **只有一个通道**：DSH 会话。GitHub / 飞书只留接口，不实现。
- **不做验签、不做凭据**：没有外部入口，就没有签名要验。
- **不主动收集**：没有轮询器、没有长连接、没有 webhook 监听。
- **不做多仓库**：v1 的 `Source` 按**实例 id** 设计，但只注册一个实例。

## 7. 术语

| 术语 | 含义 |
|---|---|
| Trigger | 不可变的外部事件（会话里的一条消息，将来是一条评论） |
| Thread | 同一会话 / PR / 话题下的事件流；并发控制与订阅的粒度 |
| Eval | 一次评估：gate（规则）+ assessment（模型），产出 accept / ignore / stop |
| Mandate | accept 时授予的权限凭据：强度、Policy 版本、触发人、范围 |
| Ticket | 授权后的工作单元，状态机见 001 |
| Assignment | Ticket 与某个 Executor Session 的绑定 |
| Channel | 回写通道（会话 / GitHub 评论 / 飞书话题） |
| Outbox | 待发送队列，失败重试，不阻塞接收 |
| attended | 有人在场的入口（会话）：评审内联、默认不产生工作 |
| unattended | 无人值守的入口（GitHub/飞书）：必须过 gate + 异步 Eval |

---

## 8. 全景

```
                       ┌──────────────── 面板 (client half) ───────────────┐
                       │ Overview Tickets Threads Sources Approvals Health │
                       └───────────────▲───────────────────────────────────┘
                                       │ connection.fetch (POST /api/superagent/*)
┌──────────────┐                       │
│ DSH 会话      │──session/event──┐     │
│ (attended)   │                 ▼     │
└──────────────┘        ┌───────────────────────┐        ┌──────────────────┐
┌──────────────┐        │   Main Session        │        │    Watchdog      │
│ GitHub 评论   │──→ Inbox│   (Router)            │◀───────│  (独立 Session)   │
│ (v2, 未实现)  │        │   评估/派活/对外回复    │ 冷读    │  定时/判定/干预    │
└──────────────┘        └──────────┬────────────┘        └──────────────────┘
                                   │ startActivation
                    ┌──────────────▼──────────────┐
                    │  Worker Session (每 Ticket)  │
                    │  独立 cwd / 全套执行工具      │
                    │  只能汇报，不能对外说话        │
                    └──────────────┬──────────────┘
                                   │ report_result (structured)
                                   ▼
                    ┌───────────────────────────┐
                    │  SQLite 领域库 + Outbox    │
                    └───────────────────────────┘
```

## 9. 与参考实现的关系

`deepseek-ai/dsh-superagent-prototype`（MIT，研究原型）提供了领域模型与不变式清单，我们不整包复制，差异如下：

| 维度 | 原型 | 本项目 |
|---|---|---|
| Watchdog | **不存在** | 独立会话，按进展/空转/预算判定 |
| Approval | **不存在**（合并靠提示词约束） | 一等公民：实体 + 状态机 + 面板 |
| Source 标识 | 按 kind，一个 kind 只能一个实例 | 按实例 id，天然支持多仓多群 |
| Ticket 状态 | 无字段，由 stage 派生 | 显式状态机（可审计、可断言） |
| 外部源 | GitHub 单仓 + 飞书 | v1 不接，接口先定型 |
| 崩溃恢复 | 两个存储手工对账 | 幂等键 + 副作用账本 |

---

## 10. 验收总纲

| # | 验收项 | 阶段 |
|---|---|---|
| A1 | `pnpm typecheck && pnpm test && pnpm build` 全绿 | P1 起每阶段 |
| A2 | 通过 patch 装进 DSH Web，面板出现左栏入口 | P5 |
| A3 | 3 事件 → 2 Ticket → 2 Worker → 2 回复 | P2/P3 |
| A4 | 重复事件只产生一个 Ticket | P3 |
| A5 | 重启后继续且不重复副作用 | P3 |
| A6 | Router 无写工具；Worker 无对外发言工具 | P2 |
| A7 | Ticket 结束后 Worker 工具被拒绝 | P2 |
| A8 | Watchdog 能发现卡死/空转/超预算且不误杀长任务 | P4 |
| A9 | 日志与面板无密钥 | P5/P6 |
| A10 | 危险动作都有审批记录 | P5 |
| A11 | 新增 Source 不改核心（以假 Source 验证） | P3 |
