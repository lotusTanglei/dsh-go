# 001 · 领域模型

纯领域层，**不 import 任何 `@deepseek-ai/*`**，可脱离 DSH 单测。
所有对象不可变（`readonly`）；状态变更通过 engine 产出新快照写库。

---

## 1. 标识符

```ts
type Brand<T, K extends string> = T & { readonly __brand: K }
type TriggerId    = Brand<string, 'TriggerId'>     // `${source}:${externalId}`
type ThreadKey    = Brand<string, 'ThreadKey'>     // `${source}:${ref}`
type TicketId     = Brand<string, 'TicketId'>
type AssignmentId = Brand<string, 'AssignmentId'>
type EvalId       = Brand<string, 'EvalId'>
type DecisionId   = Brand<string, 'DecisionId'>
type ApprovalId   = Brand<string, 'ApprovalId'>
type SourceId     = Brand<string, 'SourceId'>      // 实例 id，如 'session:abc' / 'github:org/repo'
```

**为什么是实例 id 而不是 kind**：原型按 kind 注册 Source，导致第二个 GitHub 仓库无法加入，且 Policy 只能按 kind 配。实例 id 现在零成本，将来是伤筋动骨的改动。

---

## 2. Trigger（不可变事件）

```ts
type Trust = 'human' | 'bot' | 'ci' | 'system'
type Addressed = 'direct' | 'mention' | 'none'

interface Actor {
  readonly id: string
  readonly source: SourceId
  readonly bot: boolean
}

interface Trigger {
  readonly id: TriggerId          // 去重键
  readonly source: SourceId
  readonly externalId: string     // 平台侧 id，如 messageId / commentId
  readonly threadKey: ThreadKey
  readonly actor: Actor
  readonly text: string
  readonly at: number
  readonly trust: Trust
  readonly addressed: Addressed
  readonly raw: unknown           // 原始载荷，不可信，仅存档
}
```

**不可变**：Trigger 一旦入库不再修改。处理结果写在 `TriggerDisposition`。

### TriggerDisposition（可变记录）

```ts
interface TriggerDisposition {
  readonly triggerId: TriggerId
  readonly at: number
  readonly filtered?: Reason          // 被快速过滤，附原因
  readonly evalId?: EvalId
  readonly decisionId?: DecisionId
  readonly ticketId?: TicketId
  readonly deliveredTo?: AssignmentId // 订阅直通投递给了谁
  readonly requeued?: boolean
  readonly ackedBy?: string
}
```

---

## 3. Thread

```ts
interface ThreadRef {
  readonly source: SourceId
  readonly kind: 'session' | 'issue' | 'pr' | 'im-thread'
  readonly id: string             // 会话 id / issue number / chat thread id
  readonly address: Record<string, string>  // 回写所需的平台坐标
}

interface Thread {
  readonly key: ThreadKey
  readonly ref: ThreadRef
  readonly createdAt: number
  readonly lastAt: number
  readonly seq: number            // 单调递增，乱序到达按此归位
  readonly paused: boolean
  readonly subscriptions: readonly TicketId[]
  readonly pending: readonly TriggerId[]   // 等待评估
  readonly evaluating?: EvalId             // 有值 = 正在评估
}
```

### 状态机

```
        ┌──── idle ────┐
        │              │ 收到新的 unattended trigger
        ▼              │
    pending ──start──→ evaluating ──finish──→ idle(已裁决)
        ▲                   │
        └──新消息进 pending──┘   （评估中到达的消息不另起评估）
```

不变式：`evaluating` 非空时**不得**开启新 Eval；新 Trigger 只进 `pending`。

---

## 4. Policy（版本化）

```ts
type AcceptMode = 'off' | 'observe' | 'auto'
type ConfirmMode = 'always' | 'when-ambiguous' | 'never'
type BotPolicy = 'deny' | 'infer'

interface Policy {
  readonly version: string          // sha256(规范化 JSON)，内容寻址
  readonly acceptedSources: readonly SourceId[]
  readonly acceptMode: AcceptMode
  readonly confirm: ConfirmMode
  readonly bots: BotPolicy
  readonly paused: boolean
  readonly evalTimeoutMs: number
  readonly budgets: Budgets
}
```

- **不可变**：改配置产生新版本，不就地修改。
- 已发出的 Mandate 记录其 `policyVersion`；版本变化**不撤销** Mandate，但要把影响推给运行中的 Assignment（发一条 `policy-changed` 输入）。

---

## 5. Eval / Decision

```ts
type EvalState = 'running' | 'decided' | 'expired'

interface Eval {
  readonly id: EvalId
  readonly threadKey: ThreadKey
  readonly policyVersion: string
  readonly triggerIds: readonly TriggerId[]
  readonly startedAt: number
  readonly deadline: number
  readonly state: EvalState
  readonly requeues: number
}

type DecisionKind = 'accept' | 'ignore' | 'stop' | 'unavailable'
type Strength = 'explicit' | 'inferred'

interface Decision {
  readonly id: DecisionId
  readonly evalId: EvalId
  readonly threadKey: ThreadKey
  readonly triggerIds: readonly TriggerId[]
  readonly policyVersion: string
  readonly kind: DecisionKind
  readonly reason: string
  readonly strength: Strength
  readonly ticketId?: TicketId
  readonly at: number
}
```

### 状态机

```
running ──按时──→ decided
   │
   ├──超时──→ expired ──requeue<2──→ running（同一 Eval，deadline 顺延）
   │                └──requeue≥2──→ decided(kind='unavailable')
   │
   └──Policy 版本变化──→ 重新评估（旧版本不得裁决）
```

**硬规则**：`decision.policyVersion` 必须等于当前 Policy 版本，否则该 Eval 不得裁决。

---

## 6. Mandate

```ts
type MandateVia = 'addressed' | 'followup' | 'listed' | 'admission'

interface Mandate {
  readonly strength: Strength        // explicit: 明确指令；inferred: 推断
  readonly policyVersion: string
  readonly grantedBy: Actor
  readonly at: number
  readonly scope: string             // 例如 'repo:org/name' 或 'session:abc'
  readonly via: MandateVia
  readonly rules: readonly string[]  // 命中的规则名，审计用
}
```

### 变更权限（只有三种）

| 操作 | 触发者 | 条件 |
|---|---|---|
| 创建 | accept | 有 Eval 且版本匹配 |
| 撤销（随 Ticket 结束） | 人类 stop | 仅人类明确 stop |
| 失效 | 重新校验失败 | Policy 收紧后规则不再命中 |

任何其他路径修改 Mandate 都是 bug。

---

## 7. Ticket

```ts
type TicketState = 'open' | 'running' | 'waiting_human' | 'ended'
type EndedBy = 'executor' | 'human' | 'watchdog'
type Outcome = 'completed' | 'stopped' | 'failed' | 'dropped'

/** 一条验收标准必须可执行：要么是命令，要么是可观察断言。 */
interface AcceptanceCriterion {
  readonly id: string                     // A1, A2 …
  readonly check: string                  // 命令原文，或断言描述
  readonly kind: 'command' | 'assertion'
}

/**
 * 派活契约：Router 生成、Worker 解析。
 * 全部字段必填（未知写 'unknown'），不设自由文本段落——自由文本无法校验。
 */
interface TicketBrief {
  readonly goal: string                   // 一句话，可验收
  readonly scope: { readonly repo: string; readonly subdirs: readonly string[] }
  readonly base: { readonly ref: string; readonly requireCleanTree: boolean }
  readonly allowWrite: readonly string[]  // 路径 glob 白名单：未列即禁止
  readonly denyWrite: readonly string[]   // 路径 glob 黑名单
  readonly runtime: string                // 当前运行态（哪些服务在跑 / 不许启动）
  readonly acceptance: readonly AcceptanceCriterion[]
  readonly outOfScope: readonly string[]  // 本轮不做
  readonly blockers: readonly string[]    // 已知阻塞；未知写 'unknown'
  readonly firstAction: string            // 下一步唯一动作
  readonly approvalsRequired: readonly string[]
}

interface Ticket {
  readonly id: TicketId
  readonly threadKey: ThreadKey
  readonly decisionId: DecisionId
  readonly mandate: Mandate
  readonly brief: TicketBrief
  readonly title: string
  readonly state: TicketState
  readonly workdir: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly assignments: readonly AssignmentId[]
  readonly currentAssignment?: AssignmentId
  readonly attention?: { readonly id: string; readonly question: string; readonly at: number }
  readonly stoppedByHuman: boolean
  readonly ended?: { readonly at: number; readonly by: EndedBy; readonly outcome: Outcome; readonly reason?: string }
}
```

### 状态机（唯一的真相）

```
                 assignment_start
        open ──────────────────────→ running
         │                              │  ▲
         │                    ask/审批  │  │ 人类回答
         │                              ▼  │
         │                        waiting_human
         │                              │
         └──────────┬───────────────────┘
                    │ end
                    ▼
                  ended ──── human_resume ──→ open
                             (条件见下)
```

**转移表**

| 从 | 到 | 触发 | 守卫 |
|---|---|---|---|
| open | running | `assignment_start` | 有额度、有可用槽位 |
| running | waiting_human | `report(state=waiting)` / `request_approval` / `ask_router` | — |
| waiting_human | running | 人类回答 / 审批决定 | 回答者 `trust='human'` |
| open/running/waiting_human | ended | 完成 / stop / watchdog 取消 / 放弃 | — |
| ended | open | `ticket_resume` | ① 未 `stoppedByHuman` ② 触发者是人类 ③ Mandate 重新校验通过 ④ 有未投递输入 |

**四条硬规则**

1. `stoppedByHuman=true` 的 Ticket **永不**恢复。
2. 机器人/CI 的 Trigger **不能**唤醒已结束的 Ticket（`trigger.trust !== 'human'` 直接拒绝）。
3. 同一 Ticket 同时只能有一个 `running` 的 Assignment；旧 Assignment 的汇报一律忽略（按 `assignmentId` 校验）。
4. Ticket 结束 → 该 Assignment 的工具调用必须被拒绝（见 002 的工具闸）。

---

## 8. Assignment

```ts
type AssignmentState = 'pending' | 'running' | 'ended'
type ReportState = 'progress' | 'waiting' | 'ready' | 'blocked' | 'failed' | 'dropped'

interface Assignment {
  readonly id: AssignmentId
  readonly ticketId: TicketId
  readonly sessionId: string          // DSH SessionId
  readonly state: AssignmentState
  readonly createdAt: number
  readonly startedAt?: number
  readonly endedAt?: number
  readonly endedReason?: string
  // 供 Watchdog 判定
  readonly lastProgressAt: number
  readonly steps: number
  readonly tokens: number
  readonly retries: number
  readonly repeatedCalls: number      // 连续相同工具调用次数
}
```

```
pending ──started──→ running ──end──→ ended
```

两条终态约束（I11）：

1. **进入 `ended` 必须带 `endedReason`**，不允许空字符串——否则审计里"这个任务为什么失败"永远答不出来。
2. **`running` 是强断言**：该 Assignment 的会话此刻必须活着。启动恢复时逐个核对 `ctx.sessions.get(sessionId)` 非空；核不上的一律转 `ended`，`endedReason='orphaned'`。这条把"重启后继续"从口号变成可查询的事实。

---

## 9. Subscription（多对多，无独立对象）

用两张表：`thread_subscription(threadKey, ticketId)`。
直通规则：Thread 有订阅且 Ticket 未结束 → 新 Trigger 直接投递给该 Ticket 的 Assignment，**不进 Eval**。

---

## 10. Channel / Outbox

```ts
type ChannelKind = 'session' | 'github-comment' | 'github-review' | 'feishu-thread'
type OutboundKind = 'acknowledgement' | 'reply' | 'notice'
type OutboundState = 'pending' | 'sent' | 'dropped'

interface Outbound {
  readonly id: string
  readonly ticketId?: TicketId
  readonly channel: ChannelKind
  readonly threadKey: ThreadKey
  readonly kind: OutboundKind
  readonly body: string
  readonly idempotencyKey: string   // 唯一索引，防重复发送
  readonly state: OutboundState
  readonly attempts: number
  readonly nextAt: number
  readonly lastError?: string
}
```

---

## 11. Approval

```ts
type ApprovalKind = 'merge-pr' | 'send-external' | 'delete-branch' | 'close-pr' | 'payment' | 'permission'
type ApprovalState = 'pending' | 'approved' | 'denied' | 'expired'

interface Approval {
  readonly id: ApprovalId
  readonly ticketId?: TicketId
  readonly kind: ApprovalKind
  readonly summary: string           // 给人看的一句话
  readonly payload: unknown          // 机器可执行的参数（不含密钥）
  readonly requestedBy: string       // router / worker:<assignmentId>
  readonly createdAt: number
  readonly state: ApprovalState
  readonly decidedBy?: string
  readonly decidedAt?: number
  readonly reason?: string
}
```

```
pending ──approve──→ approved ──执行──→ (账本记录)
   │
   ├──deny──→ denied
   └──超时──→ expired（默认拒绝，fail-closed）
```

**DSH 内置审批不能替代**：它只有 `ask|never` 两态、无类别注册、且本机策略为 `never`（只会返回 `unavailable`）。内置审批仅作为旁路。

---

## 12. 不变式清单（每条都要有单测）

| # | 不变式 | 强制层 | 测试要点 |
|---|---|---|---|
| I1 | 同一 `(source, externalId)` 只产生一个 Trigger | store 唯一索引 | 重复投递 3 次，Trigger 1 条 |
| I2 | 一个 Trigger 只能产生一个 Ticket | engine（`accepted` 映射） | 同一 decision 重放，Ticket 不变 |
| I3 | 一个 Thread 同时只有一个 running Eval | engine + thread.evaluating | 并发 3 条消息，Eval 1 个、其余进 pending |
| I4 | 旧 Policy 版本的 Eval 不得裁决 | engine | 版本变化后旧 Eval 被拒 |
| I5 | Mandate 只可由 accept / 人类 stop / 重校验失败变更 | domain | 直接改 Mandate 的调用不存在 |
| I6 | 已结束 Ticket 只由人类消息恢复 | engine | bot 消息不恢复；human 恢复；stopped 不恢复 |
| I7 | 旧 Assignment 的汇报被忽略 | engine | 两个 assignment 交替汇报，只认当前 |
| I8 | 同一 Outbound 只发送一次 | store 幂等键 | 重试 5 次，只发 1 次 |
| I9 | Policy 变更不撤销 Mandate，只推送影响 | engine | 收窄规则后 Ticket 仍在，收到 policy-changed |
| I10 | Ticket 结束后其 Assignment 的工具全部拒绝 | tools 层 | 结束前后各调一次，后者报错 |
| I11 | **不存在没有终态的 Assignment**：任何 `running` 的 Assignment 必须对应一个活着的会话；否则必须在同一事务里转 `ended` 并写 `endedReason` | engine + 启动恢复 | 删掉会话后重启，`running` 数量归零；双进程启动被拒 |

## 13. 命令与事件（engine 的对外接口）

**命令**（Router 工具 / 面板 / Watchdog 调用）
`ingest` `startEval` `decide` `ticketCreate` `ticketResume` `ticketStop` `assignmentStart` `assignmentStop` `report` `requestApproval` `decideApproval` `channelReply` `pause` `resume`

**领域事件**（写审计 + 驱动副作用，不同步回调）
`trigger.received` `trigger.duplicate` `trigger.filtered` `thread.opened` `eval.started` `eval.decided` `ticket.created` `ticket.ended` `ticket.resumed` `assignment.started` `assignment.ended` `report.received` `approval.requested` `approval.decided` `outbound.queued` `outbound.sent` `outbound.failed` `watchdog.action`
