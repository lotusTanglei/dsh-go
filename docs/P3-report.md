# P3 · 事件管线实现报告

## 范围

按 DEV-ALL rev4 实现 Source 实例接口与 SQLite 持久流水线，不新增依赖，不修改既有 DDL。

- `src/sources/types.ts`：Source/Channel/ThreadContext/健康契约。
- `src/sources/registry.ts`：按实例 id 注册，重复 id 拒绝，幂等 disposer 与 stopAll。
- `src/sources/session.ts`：只接受主会话直接真人 `user/message`；消息 id 去重；停机等待在途处理。
- `src/sources/fake.ts`：测试源，重复/乱序/normalize/reply 故障注入；不进入编译产物。
- `src/engine/intake.ts`：过滤、去重、Thread seq、订阅、背压；订阅投递确认后才 ack/consume。
- `src/engine/eval.ts`：单 Thread 单 Eval；当前 Policy/Host 时钟/deadline 校验；accept 原子写入；超时同 id 有界重试；pending 串行补跑。
- `src/engine/outbox.ts`：唯一幂等键、每 Store 串行 drain、指数退避、死信、未知结果保持 pending。
- `src/engine/pause.ts`：暂停只入库，恢复保留 seq 顺序。
- `src/engine/recovery.ts`：Assignment → Outbox → Eval → Queue 顺序恢复；孤儿 Assignment 与 Ticket 指针同事务修复。

## Host 接口

`createEngine(store, config, ports)` 提供 `ingest`、`ackDelivery`、`evaluate`、`enqueue`、`drainOutbox`、`pause`、`resume`、`paused`、`expireEval`、`recover`。

## 已验证

- 同一 FakeSource 事件三次只落一个 Trigger、一个 Ticket。
- 同 Thread 并发只一个 evaluator；运行中追加两条 pending，结束后串行补跑。
- 暂停期间不消费；恢复后顺序仍在。
- subscription steer 失败不 ack；Outbox 失败不 sent。
- 真实子进程 SIGKILL：持锁进程死亡、exact lock pid/nonce 核验、死锁回收、孤儿 Assignment → ended/orphaned、Ticket → open、pending 保留。
- crash-before-local-ack：下游 durable ledger 已 accepted，本地 Outbox pending；重启 replay 不产生重复下游投递。
- 测试子进程使用 Node24 直接加载当前 TS 源，不借旧 lib 产物。

## 边界与风险

- 外部 GitHub/飞书源仍属 v2；新增源只需实现接口和注册实例。
- 本地唯一索引不能单独保证外部 exactly-once；外部下游必须真正接受 idempotencyKey，测试使用 durable ledger 证明这一条件。
- Host 自动派活/恢复与真实 profile 尚需最终门禁，模块测试不冒充运行验收。真实 Router setup 启动失败两次，已按硬停止条件停止，未执行最终真机 e2e。
- [运行链路回归](../tests/runtime-integration.test.ts) 11 项通过：多审批阻断/恢复、最多一次报告 correction、maxRetries、只读诊断、seq 串行投递和失败不 ack。它们使用真实 SQLite + 可控 DSH 替身，不是 live Host 证明。
- Session Channel 的 inbox 注入只能等待下一次 step admit；未进入可渲染日志时保留 Outbox pending，不能当即时人可见回复。

## 提交

- `05192bd feat(p3): persist and recover trigger processing`
- `531cbee fix(p3): trust host clocks and drain source work`

最终逐条证据见 [FINAL-VERIFY](FINAL-VERIFY.md)（最终收口时生成/更新）。
