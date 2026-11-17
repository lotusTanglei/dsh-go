# 002 · 架构

## 1. 分层与包边界

```
dsh-superagent/
├── package.json          dsh.bundle + dsh.client + engines.dsh
├── cordis.patch.yml      insert: router / worker / watchdog / panel
├── src/
│   ├── index.ts          apply(ctx, config)：只做装配，不含业务
│   ├── config.ts         Schemastery 配置（全部可调值都在这里）
│   ├── domain/           ★ 零 DSH 依赖，纯函数 + 类型
│   ├── store/            node:sqlite + migrations/ + repos/
│   ├── engine/           命令编排 + 状态机转移 + 领域事件
│   ├── sources/          Source/Channel 接口、registry、session.ts
│   ├── sessions/         main / worker / watchdog —— 唯一碰 DSH 的地方
│   ├── tools/            Router 工具、Worker 汇报工具
│   ├── prompt/           systemPrompt.context 注入片段
│   └── client/           面板（client half）
├── presets/              router / worker / watchdog
├── locale/               en.json / zh.json
├── docs/                 本套文档
└── tests/                domain / store / engine / e2e
```

**三条边界规则**（违反即为架构 bug）：

1. `domain/` 不得 import 任何 `@deepseek-ai/*`；可 `node --test` 裸跑。
2. `sessions/` 是唯一 import DSH 服务的目录；其余层通过它暴露的窄接口调用。
3. `tools/` 只做参数校验与 engine 调用，不直接读写数据库、不直接操作会话。

---

## 2. 三个角色

| | Router | Worker | Watchdog |
|---|---|---|---|
| DSH 形态 | 长期存活的 Session | 每 Ticket 一个 `startActivation` | 独立 Session，定时唤醒 |
| 生命周期 | 与插件同寿 | 与 Assignment 同寿 | 与插件同寿 |
| 模型上下文 | 全局任务表/Policy/待审批 | 单个 Ticket 的 brief + 工作区 | 所有运行中 Assignment 的摘要 |
| 工具矩阵 | 见 §3 | 全套执行工具 | 只读 + 干预工具 |
| 说话对象 | 人（经 Channel） | 无（只能汇报） | 人（escalate） |
| 写代码 | ✗ | ✓（限本 Ticket 目录） | ✗ |
| 预算 | 中等，按消息计 | 每 Ticket 独立 | 独立小预算 |

### 2.1 为什么 Router 只是一个特性受限的会话，不是新物种

- DSH 里"能思考、能调工具、能被注入上下文"的最小单位就是会话 + agent。
- 把 Router 写成后台服务，就得自己补三样：嘴（对外回复）、手（派活）、上下文（读任务表）。补完还是一个没有界面的会话。
- 用会话换来的是：可观测（面板里能看到它在想什么）、可恢复（会话日志可重放）、可注入（`agent.inject` 灌任务表）。

### 2.2 为什么是"单例"而不是"一个会话类"

真正必需的只有两样：**单一权威状态**（任务表/Eval 锁/审批队列/预算）与**唯一决策者**。
它们塞进一个会话，是因为 DSH 的 `followup`/审批/UI 都挂在会话上。

用户可见形态：

```
侧边栏
├── 超管（主会话，router preset）   ← 你在这儿说话
└── …（Worker 会话默认不出现在列表）
```

---

## 3. 角色隔离怎么实现（重要）

### 3.1 不能用 `ctx.tools.restrict`

`restrict` 的语义是"scope 的子孙不该继承这些工具"（`tools.md:165`、`:664-671`）：
它作用于**继承来的**工具（全局层 + 祖先链），最后叠加自己的注册，且自己的注册豁免。

后果：Router 限制自己的 scope，**Worker 作为子孙会一起被砍**，正好反向泄漏。
另外两点也决定它不适合做身份级 RBAC：

- 会话工具集由 **preset（组合）** 决定，并写入 `meta.agentPreset`；文档明确这是持久的，因为"恢复出不同组合会重演模型现在无法执行的历史"（`persistence.md:182-187`）。
- 运行时可变的白名单会让同一会话两次恢复出不同工具面，破坏可重放性。

### 3.2 正确做法：三个 agentPreset

| preset | 注册的工具 | 说明 |
|---|---|---|
| `dsh-superagent-router` | `read` `glob` `grep`（受 `readScope` 约束）+ 业务工具 `ticket_*` `assignment_*` `channel_reply` `human_ask` | **不注册** shell / 写文件 / git / 合并 |
| `dsh-superagent-worker` | 全套执行工具 + `report_progress` `report_result` `request_approval` `ask_router` | **不注册** `channel_reply` / `human_ask` |
| `dsh-superagent-watchdog` | `read`（冷读会话摘要）+ `watchdog_*` | 不注册任何写工具；额外用 `restrict` 兜底（叶子节点，安全） |

> 待验证（S2，见 007）：第三方 bundle 能否注册 agentPreset；不能则退回"每个 Worker 的工具用 `when(ctx)` 在调用时自检 Ticket 状态"。

### 3.2.1 方案 1：补充执行拒绝闸（用户 2026-11-17 确认）

实测 preset 不隐藏 Host-global 工具。保留三个 preset 与各自不注册禁止工具的约束，另由 Host 装配 deny-only `ctx.tools.guard`（契约见 008 §2.2）。每次以实际调用 Agent 的 composedPreset 精确匹配角色，读取 Config 的该角色允许表；未列工具拒绝执行，不使用 restrict，也不继承父角色的允许表。非 Super-agent 会话不受影响。Worker 未绑定、旧 Assignment 或 ended 均拒绝所有工具，原有审批/沙箱拒绝不能被闸放行。普通 Host-global 工具可能仍展示 schema，执行拒绝与隐藏必须明确区分。

### 3.3 工具闸（Ticket 结束后必须拒绝）

三种实现，按优先级：

1. **preset 层**：Worker 的工具在注册时绑定 `assignmentId`，闭包里查库，`ticket.state==='ended'` 直接抛错。
2. **调用层**：`ToolRegistrationOptions.when(ctx)` 在每步准入时判断（`tools.md:198-207`），状态不对则该步不声明这些工具。
3. **会话层**：Assignment 结束时 `activation.dispose()`，会话不再接受输入。

三者叠加，任一生效即可拒绝。

---

## 4. Source 与 Channel

```ts
interface SourceHealth {
  readonly ok: boolean
  readonly lastAt?: number
  readonly detail?: string
}

interface Source {
  readonly id: SourceId
  readonly kind: 'session' | 'github' | 'feishu' | 'inbox'
  readonly attended: boolean          // true=有人在场，走内联评审

  start(): Promise<void>
  stop(): Promise<void>
  health(): Promise<SourceHealth>

  /** 验签/来源校验。attended 源可恒真，但接口保留。 */
  verify(input: unknown): Promise<boolean>

  /** 转成不可变 Trigger；纯函数，不做 IO。 */
  normalize(input: unknown): Promise<Trigger | Trigger[]>

  /** 读上下文（给 Eval / Worker 用）。 */
  readThread(threadKey: ThreadKey): Promise<ThreadContext>

  /** 回写。失败抛错，由 Outbox 重试。 */
  reply(channel: ChannelKind, threadKey: ThreadKey, body: string, idemKey: string): Promise<void>
}
```

`Channel` 是 `reply` 的目标描述，不单独建模为服务。
**新增一个源 = 实现这个接口 + 注册一行**，不改 engine、不改表结构。

v1 只实现 `session` 与 `inbox`（测试用假源）。

---

## 5. 会话层的三个薄封装

`sessions/main.ts`

```ts
ensureMainSession(config): Promise<SessionId>   // 启动时绑定或创建，落库可配置
injectContext(sessionId, text): void            // agent.inject，不唤醒
notifyRouter(sessionId, text): void             // agent.followup，唤醒一轮
```

- 绑定关系存 `kv: mainSessionId`，配置项 `mainSessionId` 可覆盖。
- 会话被删（`session/disposed`）→ 清空绑定，下次启动重建。

`sessions/worker.ts`

```ts
start(input: {
  ticket, assignment, brief, workdir, preset, agentOptions, signal
}): Promise<WorkerHandle>          // 内部调用 ctx.subagents.startActivation
```

用的是 `startActivation({ provider:'spawn', delivery:'caller', cwd, agentPreset, outputSchema })`（`subagent.md:456`）：
结构化汇报直接由 `outputSchema` 约束，父会话拿 `result.structured`，**不需要自己发明汇报协议**。

`sessions/watchdog.ts`

```ts
snapshotAssignments(): Promise<AssignmentSnapshot[]>   // sessionQuery.readSession 冷读
nudge/steer/cancel/escalate(...)
```

冷读用 `ctx.sessionQuery.readSession(id)`，**不把会话拉活**（`session-query.md:425-431`）。

---

## 6. 与 DSH 的接触面（全部）

| 用途 | DSH 符号 | 备注 |
|---|---|---|
| 工具注册 | `ctx.tools.register(defineTool(...), opts)` | Router/Worker/Watchdog 各自注册 |
| 会话事件 | `ctx.on('session/event', (s, e) => …)` | 会话入口的监听点 |
| 子会话 | `ctx.subagents.startActivation(...)` | Worker |
| 注入 | `agent.followup / inject / steer` | 派活/灌上下文/纠偏 |
| 冷读 | `ctx.sessionQuery.readSession / observeSession` | Watchdog |
| 中断 | `subagents.interrupt / activation.dispose / agent.cancel` | 取消 |
| 刷盘 | `ctx.sessions.flush(session)` | 崩溃前屏障 |
| 配置 | `export const Config: Schema<Config>` | schemastery |
| 系统提示 | `ctx.systemPrompt.context` | 注入任务表/Policy/待审批 |
| 面板 | `ctx.slots.register` / `ctx.slots.inject` | `sidebar.panellist` + `main` |
| 面板 RPC | `ctx.connection.fetch.register({path, methods, requestBody, fetch})` | 不能自建 `@Remote` |

---

## 7. 配置（全部可调值，硬编码即 bug）

```ts
interface Config {
  mainSessionId?: string
  routerReadScope: 'none' | 'reported' | 'repo'      // 默认 reported
  confirm: 'always' | 'when-ambiguous' | 'never'     // 默认 when-ambiguous
  acceptMode: 'off' | 'observe' | 'auto'             // 默认 auto（仅 attended 生效）
  maxWorkers: number                                  // 默认 3
  queueLimit: number                                  // 背压阈值，默认 200
  evalTimeoutMs: number                               // 默认 120000
  maxStepsPerTicket: number                           // 默认 80
  maxTokensPerTicket: number                          // 默认 2_000_000
  maxDurationMsPerTicket: number                      // 默认 2h
  maxRetries: number                                  // 默认 2
  watchdogIntervalMs: number                          // 默认 60000
  stallMs: number                                     // 无进展阈值，默认 300000
  repeatCallThreshold: number                         // 空转阈值，默认 3
  workRoot: string                                    // Ticket 工作目录根
  dbPath: string                                      // 默认 <stateDir>/superagent.sqlite
  paused: boolean
  sources: SourceConfig[]                             // v1 只有一个 session 源
}
```

**原则**：两个部署可能不一样的值，一律进配置，并进 `cordis.patch.yml` 可覆盖。

---

## 8. 加载方式

`package.json`

```json
{
  "name": "dsh-superagent",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".":       { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client":{ "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "engines": { "dsh": ">=0.2.2-rc.3 <0.3.0" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-locale"] }
  }
}
```

`cordis.patch.yml`（四行，id 加前缀避免与已装 bundle 冲突）

```yaml
- insert:
    - id: superagent-router
      name: 'dsh-superagent/router'
      config: { routerReadScope: reported, confirm: when-ambiguous }
    - id: superagent-worker
      name: 'dsh-superagent/worker'
    - id: superagent-watchdog
      name: 'dsh-superagent/watchdog'
    - id: superagent-panel
      name: 'dsh-superagent/client'
```

> 用户 profile 已装 4 个第三方 bundle（mnemon / dev-runner / plan-note / plugin-updates），id 一律带 `superagent-` 前缀。
