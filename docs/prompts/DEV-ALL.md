# 全量开发任务：P3 + P4 + P5 连续推进

> 基线：docs rev 4。P1 已封版；P2 的 A1/A2/A3 已通过收口。
> 本任务一次性把 P3、P4、P5 全部开发完，验收统一放到最后。
> 交付给开发 agent 时整段复制。

---

## 0. 开工前（15 分钟）

1. `git status` 确认干净；`git log --oneline` 确认有 P2 收口提交
2. 读 `docs/P2-DIAGNOSIS.md`，确认 A3 通过的证据与结论（**不要重跑，那要花 token**）
3. 三条门禁跑一遍，记下起始数字（应 ≥60 passed）
4. 建 `docs/PROGRESS.md`，写第一行：
   `T+00:00 | 起点 | 60 passed | 开始 P3`

---

## 1. 工作方式（本任务与前几轮最大的不同）

**连续开发，门禁后移。**

- 不在阶段之间停下来等验收；一个模块写完直接进入下一个模块
- 但每写完一个模块，仍要跑 `pnpm typecheck`（几十秒，零成本）；
  它红了立刻修，不许带着类型错误往下写
- 单元测试**随写随加**，不要留到最后补——补出来的测试通常只测已实现的行为
- 真正的验收（预设零 token 闸门、真机 e2e、面板实测、完整场景）统一放到第 6 节，最后一次性做
- 每完成一个可编译的单元就 commit，不要攒成一个大提交

**为什么这样排**：一次性开发时，最贵的不是写代码，是发现地基错了要回头。
所以保留 typecheck 这个不花钱的哨兵，推后所有要跑模型/起服务/点面板的验收。

---

## 2. 周期汇报（硬要求）

每隔 **30 分钟**往 `docs/PROGRESS.md` 追加一行，格式固定：

```
T+02:30 | P3-intake | 完成 去重+Thread归位; 下一步 eval | 卡点:无 | 测试 72 passed
```

字段：时间 / 阶段 / 已完成 / 下一步 / 当前卡点 / 测试数。
卡点写"无"或一句话，不要写"遇到一些问题"。

阶段切换时额外写一块：

```
=== P3 完成 T+05:10 ===
产出: engine/intake, eval, outbox, pause; 测试 88 passed
未做: 真实 Source 接入（v2）
风险: outbox 重试退避只在单测验证
```

---

## 3. 阶段 P3 · 事件管线

顺序执行，每个文件写完就 typecheck + commit。

### 3.1 `src/sources/types.ts`

```ts
interface SourceHealth { ok: boolean; lastAt?: number; detail?: string }

interface Source {
  readonly id: SourceId          // 实例 id，如 'session:<sid>' / 'github:org/repo'
  readonly kind: 'session' | 'inbox' | 'github' | 'feishu'
  readonly attended: boolean
  start(): Promise<void>
  stop(): Promise<void>
  health(): Promise<SourceHealth>
  verify(input: unknown): Promise<boolean>
  normalize(input: unknown): Promise<Trigger | Trigger[]>
  readThread(threadKey: ThreadKey): Promise<ThreadContext>
  reply(channel: ChannelKind, threadKey: ThreadKey, body: string, idemKey: string): Promise<void>
}
```

硬要求：**按实例 id 注册，不按 kind**。同一 kind 将来要能注册多个实例（多仓库/多群）。

### 3.2 `src/sources/registry.ts`

- `register(source)` / `get(id)` / `all()` / `stopAll()`
- 重复 id 注册必须抛错，不许静默覆盖
- 注册即 effect，插件卸载时自动 stop

### 3.3 `src/sources/session.ts`

- 监听 `ctx.on('session/event')`，只取 `user/message`
- 归一化为 Trigger：`source='session:<sid>'`、`trust='human'`、`addressed='direct'`、`threadKey='session:<sid>'`
- `externalId` 用消息 id，保证重复投递可去重
- `attended = true`

### 3.4 `src/sources/fake.ts`（测试专用，不进产物）

- 可注入：重复事件、乱序事件、`normalize` 抛错、`reply` 失败
- 提供 `emit(trigger)` 与 `failNext(n)`

### 3.5 `src/engine/intake.ts`

流水线顺序固定：

```
过滤 → 去重 → Thread 归位 → 订阅检查 → 入队
```

- 去重键 `(source, externalId)`，命中返回 `duplicate`，不抛错
- Thread 不存在则创建，`seq` 单调递增
- 订阅命中 → 直接投递给当前 Assignment，不进 Eval
- 队列长度 ≥ `queueLimit` → 拒绝并返回结构化错误（背压）

### 3.6 `src/engine/eval.ts`

- 一个 Thread 同时只有一个 running Eval（`thread.evaluating` 非空即拒绝启动）
- 评估期间到达的 Trigger 只进 `pending`
- 超时 → `expired` → requeue ≤2 → 仍失败记 `decision.kind='unavailable'`
- 裁决前校验 `decision.policyVersion === 当前 Policy 版本`，不等则拒
- accept 必须在**一个事务**里落：decision + ticket + mandate + subscription + disposition

### 3.7 `src/engine/outbox.ts`

- 发送失败按指数退避重试，超过 `maxRetries` → `dropped` + 告警
- 幂等键唯一索引保证只发一次
- 发送成功才置 `sent`；超时不明时保持 `pending`（宁可重发也不丢）

### 3.8 `src/engine/pause.ts`

- 全局 `paused` 时：Trigger 只入库不处理
- 恢复后按 `seq` 顺序处理，不许丢

### 3.9 启动恢复 `src/engine/recovery.ts`

四个 reconcile，顺序固定：

```
Assignment(running→核对会话，不存在则 ended/orphaned)
→ Outbox(pending→重新入队)
→ Eval(running→检查 deadline)
→ Queue(thread.pending→重新入队)
```

**I11 在这里落地**：`running` 的 Assignment 必须对应活着的会话，否则转 `ended`，`endedReason='orphaned'`。

---

## 4. 阶段 P4 · Watchdog

### 4.1 `src/sessions/watchdog.ts`

- 冷读：`ctx.sessionQuery.readSession(id)`，**不把会话拉活**
- 采集：`lastProgressAt` / 连续相同工具调用次数 / steps / tokens / 运行时长 / waiting_human 时长

### 4.2 判定规则（五条）

| 规则 | 条件 | 动作 |
|---|---|---|
| 无进展 | `now - lastProgressAt > stallMs` | nudge → 二次超时 cancel |
| 空转 | 连续重复同一工具调用 ≥ `repeatCallThreshold` | nudge（指出具体重复） |
| 偏离 | 低频抽样，模型判定与 brief 目标无关 | steer |
| 超预算 | steps/tokens/时长超限 | nudge → stop → escalate |
| 久等人 | waiting_human > 30min | escalate（只提醒） |

### 4.3 四个动作

`nudge`(agent.steer) / `steer`(纠偏) / `cancel`(interrupt + assignmentStop) / `escalate`(channel_reply 给人)

### 4.4 审计

每次动作写 `audit`，`detail` 里含**判定时的指标快照**（不是事后补的）。
Watchdog 不改代码、不发外部消息、不改规则本身。

---

## 5. 阶段 P5 · 面板

### 5.1 客户端构建

DSH 没发布 `clientBundle` 预设，需要自建 tsdown 配置：

- 入口 `src/client/index.ts`，输出 `lib/client.js`
- `package.json` 的 `exports["./client"]` 指向它
- `dsh.client: { platform: 'web' }`

### 5.2 两个 slot（严格照这两条）

```ts
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist', id: 'superagent', order: 100, label: () => '超管'
}, SuperAgentIcon))

ctx.slots.register({
  name: 'main', key: 'superagent', store, inject: () => ({ ... }), locale: NS
}, SuperAgentPage)
```

切页用 `ctx.layout.selectPanel('superagent')`。
**不要往 `root` slot 注册**——会顶掉框架自己的座位。

### 5.3 七个页面

Overview / Tickets / Threads / Sources / Approvals / Health / Settings
每页只读，Approvals 页有 approve / deny，Tickets 页有 stop / resume。

### 5.4 Host 路由

`ctx.connection.fetch.register({ path: '/api/superagent/…', methods: ['POST'], requestBody: 'buffered', fetch })`

九条：`/overview` `/tickets` `/ticket` `/threads` `/approvals` `/approval` `/ticket-action` `/health` `/settings`

### 5.5 前端硬约束

- 只用主题 token（`--dsw-alias-*`），禁止硬编码色值
- 不存密钥、不拼 SQL、不在前端判权限
- 文案进 `locale/{en,zh}.json`
- 轮询 5s，4xx 不重试

**P5 允许简化**：先做 Overview + Tickets + Approvals 三页跑通，其余四页留占位并在报告里写明。
跑通比铺满重要。

---

## 6. 收口验收（全部开发完成后，一次性做）

按顺序，前一步不过不进下一步：

1. **三闸全量**：`pnpm typecheck && pnpm test && pnpm build`
2. **预设零 token 闸门**：起 profile → `POST /api/agentPresets/list` → 三个预设 `broken` 为空
3. **P3 场景验收**（全用 fake source，不花 token）：
   - 同一事件投 3 次 → 1 Trigger → 1 Ticket
   - 同一 Thread 并发 3 条 → 1 个 running Eval，其余 pending，结束后补跑
   - kill -9 后重启 → 未完成 Ticket 继续，Outbox 不重复发送
   - 暂停期间入库不丢
   - 新增假 Source 只实现接口，engine 零改动
4. **P4 场景验收**：卡死 / 空转 / 长任务不误杀 / 超预算四场景
5. **P5 实测**：起 profile → 侧栏出现入口 → 切页 → 审批落库 → 重启后一致
6. **真机 e2e 一次**：3 Trigger → 2 Ticket → 2 Worker → 2 report（≤3 轮/条，记 token）
7. 收场断言：`liveAgents=0`、无残留 lock、工作区干净

---

## 7. 停止条件（触发即停，写报告，不许硬干）

- 需要改表结构（001/004 的 DDL）
- 需要装新依赖（P5 构建除外，但要先记一笔）
- 需要改 profile 或碰 desktop
- 同一问题连续失败 5 次
- 文档之间互相矛盾
- 累计 8 小时

---

## 8. 禁止

- 因为"验收放到后面"就在开发期完全不跑 typecheck
- 伪造测试通过、写恒真断言、skip
- 为了让闸门变绿删检查、缩范围
- 把 `lib/` 与 `src/` 不一致的产物提交
- 连续 30 分钟无 `PROGRESS.md` 记录

---

## 9. 早上要交的

1. `docs/PROGRESS.md`：完整心跳时间线
2. `docs/P3-report.md` / `docs/P4-report.md` / `docs/P5-report.md`：做了什么、改了哪些文件、新增接口、未做项、已知风险
3. `docs/FINAL-VERIFY.md`：第 6 节七步的逐条结果 + 原始输出尾部
4. `git log --oneline`：按阶段提交
5. 一句话总结：P3/P4/P5 各自完成度（完成 / 部分 / 未开始）
