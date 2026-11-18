# P4 · Watchdog 实现报告

## 已实现

`src/engine/watchdog.ts` 只通过 `sessionQuery.readSession` 冷读，不拉活 Worker。

指标：lastProgressAt、连续相同工具名+canonical args、step/start 数、assistant/message.data.usage、运行时长、waiting_human 时长。

五规则：

1. stall：nudge，第二次超时 cancel。
2. repeat：指出具体重复工具调用，仅 nudge。
3. deviation：低频注入式判定 port 返回原因后 steer。
4. budget：nudge → cancel → escalate，记录持久 stage。
5. waiting-human：只提醒，不取消。

所有动作记录 requested/completed/failed 审计和判定时的指标快照。单 tick 防重入，不把普通工具调用当成进展。

## 场景验证

[watchdog测试](../tests/engine/watchdog.test.ts) 六项通过：卡死 nudge/cancel、空转指出具体调用、20 分钟每两分钟进展不误杀、预算顺序恰一次、久等人/低频纠偏、DSH inputTokens/cache/output字段正确累加触发预算。最初漏算未缓存输入的问题已在`6e2be39`修复。

## 生产接线边界

Host runtime 已接入定时器、指标来源、动作、持久状态与模型抽样。[sampleDeviation](../src/sessions/watchdog.ts) 使用只读 preset、512 输出 token 上限和超时；成功与晚返回 activation 释放均有单测。waiting-human 优先于预算，已结束但仍等人的 Ticket 仍参与提醒。

Router setup 曾把 preset mount 的返回对象透传给 AgentSetupCommit，导致两次启动失败并停止。用户明确允许修复继续后，`a3a5f5a` 已修复并加入真实提交契约回归；最新111项测试通过，隔离 runtime ready，重启恢复原 Router id、冷读 heartbeat 正常。生产偏离模型结果仍未单独实证，不冒充全部 live P4 场景。

Session Channel 没有即时显示能力：inbox 注入未 admit 不记 sent；escalate 目前唤醒 Router，并非已验证的人可见通知。

不允许 Watchdog 改代码、改 Policy 或直接对外发消息；任何模型抽样都必须只读、有预算和释放。

## 提交

`aeb54b2 feat(p4): supervise workers with cold snapshots`

最终生产接线与验收结论以 [FINAL-VERIFY](FINAL-VERIFY.md) 为准。阶段结论：部分完成（规则和有界适配通过，真实模型纠偏与人可见escalate仍待验）。
