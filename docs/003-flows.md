# 003 · 关键流程

每条流程标注：入口、步骤、失败分支、幂等点。
"失败分支"是本设计的一半价值——正常路径谁都会写。

---

## F1 · attended 入口（会话消息）

**触发**：`ctx.on('session/event')` 收到 `user/message`，且会话是主会话。

```
1. 归一化      消息 → Trigger{source:'session:<sid>', trust:'human', addressed:'direct'}
2. 去重        UNIQUE(source, externalId=messageId)；命中即返回
3. Thread      threadKey = 'session:<sid>'，不存在则建
4. 订阅检查    该 Thread 有未结束 Ticket → 直接 followup 给 Worker（F3）
5. 内联评审    agent 自己就是评审：本轮是否调用 ticket_create
6. 记账        调用→Decision(accept)；未调用→Decision(ignore，reason='conversational')
```

**关键设计**：不额外跑一次评估模型。评审就是这一轮对话本身，事后从动作推导裁决。

**失败分支**

| 情况 | 处理 |
|---|---|
| `ticket_create` 参数非法 | 工具返回结构化错误，agent 当轮修正；不落 Ticket |
| 槽位满 | 返回 `{ queued: true, position }`，进队列，agent 告知用户 |
| 同一消息被重放（重启/重投） | 去重键命中，直接返回已有结果 |
| `confirm=always` | 工具不直接建单，先 `human_ask`，人答"是"再建 |

---

## F2 · unattended 入口（v2 预留）

```
1. verify()      验签 / 来源校验          失败 → 401，记账，丢弃
2. normalize()   载荷 → Trigger           失败 → 400，记账
3. 快速过滤      allowlist / @ / 标签 / 命令 / 机器人 → 丢弃并记 reason
4. 去重          UNIQUE(source, externalId)
5. Thread 解析   写入或更新 Thread，seq++
6. 订阅检查      命中 → 直投 Worker
7. 入队 Eval     thread.evaluating 为空才启动；否则进 pending
8. Eval          gate（规则） → assessment（模型） → Decision
9. 裁决          accept → Ticket+Mandate+Subscription+ack 落库（一个事务）
                 ignore → 只记 Decision
                 stop   → 结束该 Thread 上的 Ticket
```

**背压**：队列长度 ≥ `queueLimit` 时拒绝新 Trigger（返回 429 + 友好提示），不无限堆积。

---

## F3 · 订阅直通

```
Thread 有订阅且 Ticket.state ∈ {open, running, waiting_human}
    → 不走 Eval，直接投递给当前 Assignment：
       - running         → agent.steer（下一步边界消费）
       - waiting_human   → agent.followup（唤醒一轮）
       - open（无 assignment）→ 排队，等 assignment_start 后投递
```

**为什么需要**：Worker 正在干的活，后续补充信息应该直接到它手上，而不是再走一遍"要不要做"。

**失败分支**：Worker 已结束但 Ticket 未结束（异常）→ 视为恢复场景，走 F5。

---

## F4 · 派活与汇报

```
Router: ticket_create(brief)  →  Ticket(state=open)
        assignment_start       →  Ticket(state=running)
                                   分配 workdir = <workRoot>/<ticketId>
                                   startActivation({ cwd, agentPreset:'worker',
                                                     outputSchema: ReportSchema })
Worker: 执行 → report_progress（可选，多次）→ report_result（一次）
Router: 收到 result.structured
        → 校验字段 + 逐条比对 acceptance
        → ready 且 acceptance 全 passed → ticket_end(completed)
        → ready 但 acceptance 有 failed/not-run → 退回 Worker 补一次（≤1 次）
        → ready 且 needHuman 非空 → Ticket(state=waiting_human) → channel_reply 提问
        → blocked/failed          → 记 Assignment.endedReason，视 retries 决定重试或结束
```

## brief：派活契约

Router 生成、Worker 解析，**结构化字段，不设自由文本段落**——自由文本无法校验。

| 字段 | 内容 | 例 |
|---|---|---|
| `goal` | 一句话，可验收 | 修复登录页弱网重复提交 |
| `scope` | 仓库 + 子目录 | `org/name`；`app/login`、`app/shared/http` |
| `base` | 基线 ref；是否要求干净工作树 | `main@a1b2c3d`，脏则先报不干活 |
| `allowWrite` / `denyWrite` | 路径 glob 双清单 | **白名单优先，未列即禁止** |
| `runtime` | 当前运行态 | 不启动 dev server、不连生产 |
| `acceptance` | 可执行验收项 | `A1: pnpm test`、`A2: 重复点击只发一次` |
| `outOfScope` | 本轮不做 | 不重构 http 层、不动其它页面 |
| `blockers` | 已知阻塞 | 无，或 `unknown` |
| `firstAction` | 下一步唯一动作 | 读 `app/login` 提交逻辑，定位重复触发点 |
| `approvalsRequired` | 需审批的动作 | 合并 PR、删分支、改配置 |

四条设计理由：

1. **白名单而非黑名单**：没列到的路径等于禁止，减少"以为可以改"。
2. **acceptance 必须可执行**：Worker 逐条回填 `passed/failed/not-run`，Router 不用信自述。
3. **`outOfScope` 与 `firstAction` 是防扩散、防犹豫的两条**，最常被省略、最值钱。
4. **完备度受 `router.readScope` 约束**：`none` 模式下 `allowWrite`/`acceptance` 只能写粗粒度，brief 会退化成 `goal + acceptance` 两项；这是读权限决策的直接后果。

## report：汇报契约

```ts
interface Report {
  state: 'progress' | 'ready' | 'blocked' | 'failed'
  done: string[]            // 已完成
  todo: string[]            // 未完成
  changedPaths: string[]    // 只给路径，不给原文（数据不上升）
  acceptance: {             // 逐条回填，不允许省略
    id: string              // 对应 brief.acceptance[].id
    result: 'passed' | 'failed' | 'not-run'
    evidence: string        // 命令输出摘要或观察结果
  }[]
  risks: string[]
  needHuman: string[]       // 需要人做什么
}
```

**失败分支**

| 情况 | 处理 |
|---|---|
| Worker 崩溃/被 dispose | Assignment→ended(failed)，按 maxRetries 重试，重试仍失败则 Ticket 结束 |
| 汇报缺字段 | 校验失败，要求重报一次；再失败按 failed 处理 |
| 同一 Assignment 多次 report_result | 只认第一次，第二次拒绝 |
| 旧 Assignment 汇报（重试后） | 按 `assignmentId` 校验，忽略 |

---

## F5 · 结束、恢复、停止

```
结束：ticket_end(outcome) → state=ended, ended.at/by/outcome
      释放槽位；取消订阅；Worker 若仍活着则 dispose

恢复：Thread 上新的 human Trigger
      → 命中 ended Ticket 的订阅
      → 守卫：!stoppedByHuman && trigger.trust==='human'
              && mandate.revalidate(policy) 通过
              && 有未投递输入
      → state=open → assignment_start → 新 Assignment、新 cwd（复用旧目录）

停止：human stop / watchdog cancel
      → state=ended(outcome='stopped')
      → 若 by==='human'：stoppedByHuman=true（此后永不恢复）
```

**Why 新 Assignment 而不是复活旧的**：DSH 的会话有生命周期，已 dispose 的激活不可复用；新 Assignment 让"谁在什么时候干了什么"时间线清晰。

---

## F6 · 审批

```
Worker: request_approval({kind, summary, payload})
   → Approval(pending) + Ticket(state=waiting_human) + 通知 Router
Router: channel_reply 给人类（会话/评论）：一句话 + 面板链接
人类：   面板点 approve/deny，或在会话里回"批准/拒绝"
   → decideApproval → Approval(approved|denied) → Ticket(state=running)
       approved → 执行动作（并写副作用账本，幂等键=approvalId）
       denied   → Worker 收到"被拒绝"，必须换方案或停下
超时（默认 24h）→ expired = denied（fail-closed）
```

**为什么自建**：DSH 内置审批只有 `ask|never` 两态、无类别注册，且本机策略是 `never`，调用只会返回 `unavailable`。内置审批只能当旁路，不能当审计真相。

---

## F7 · Watchdog

```
每 watchdogIntervalMs：
1. 冷读   sessionQuery.readSession 取每个运行中 Assignment 的末尾事件
2. 计算   上次进展时间 / 连续相同工具调用 / 步数 / token / 运行时长 / waiting_human 时长
3. 判定   命中任一规则 → 生成动作
4. 动作   nudge  → agent.steer("你已重复同一调用 3 次，换方法或汇报阻塞")
          steer  → agent.steer(纠偏指令)
          cancel → subagents.interrupt(...) + assignmentStop
          escalate → channel_reply 给人 + 记审计
5. 记账   每次动作写 audit，包含依据的指标快照
```

**判定规则（v1）**

| 规则 | 条件 | 动作 |
|---|---|---|
| 无进展 | `now - lastProgressAt > stallMs` | nudge → 再超时则 cancel |
| 空转 | 连续重复同一工具调用 ≥ `repeatCallThreshold` | nudge |
| 偏离 | 汇报与 brief 目标无关（模型判定，低频） | steer |
| 超预算 | steps/tokens/时长超限 | 先 nudge，再 cancel，再 escalate |
| 久等人 | `waiting_human` 超过 30min | escalate（只提醒，不取消） |

**不允许**：改代码、发外部消息（只能 escalate 给 Router）、合并 PR、改规则本身。

**不误杀**：长任务用 `report_progress` 心跳；Watchdog 只认"有进展"的写入事件，不认"进程活着"。

---

## F8 · 崩溃恢复

```
启动顺序（固定）：
1. 打开 SQLite，跑迁移（失败则整体失败，不清库）
2. 恢复配置 → 计算 Policy 版本
3. 绑定主会话（不存在则创建）
4. 扫描：running 的 Assignment → 标记 orphan（Worker 会话已丢）
5. 扫描：pending 的 Outbound → 重新入发送队列
6. 扫描：running 的 Eval → 检查 deadline，过期则 requeue 或 unavailable
7. 扫描：pending 的 Trigger / Thread.pending → 重新入队
8. 处理 orphan：按 maxRetries 重新 startActivation（新 Assignment），
   并用副作用账本跳过已执行的外部动作
```

**幂等三件套**

1. 去重键：`(source, externalId)` 唯一索引。
2. 副作用账本：`side_effect(key TEXT PRIMARY KEY)`，执行前先占位，执行后标记完成。
3. 失败补偿：Outbound 发送成功才置 `sent`；发送超时不明时，按幂等键由下游去重。
