# 最终验收记录 · 2026-11-18

## 当前结论

**主链路与真实模型 e2e 已通过；整体仍是部分交付，不宣称 P3/P4/P5 全部验收完成。**

| 阶段 | 状态 | 保留项 |
|---|---|---|
| P3 | 部分完成：持久管线、恢复、FakeSource 场景与真实派活/汇报通过 | Session Channel 仅延迟通知，不是即时人可见回复 |
| P4 | 部分完成：五规则、动作、审计、冷读与有界模型抽样接线完成 | 偏离模型尚无真实结果证据；escalate 唤醒 Router，不是已验证的人可见通知 |
| P5 | 部分完成：主三页、九路由、真实审批与重启一致性通过 | 其余四页只读/占位；侧栏点击、深浅主题与 console 待人工 |

用户已明确同意：①解除两次 setup 启动失败停止，修复后继续；②视觉检查留待人工，不阻塞 e2e。第二项不等于视觉验收通过，也不豁免 Channel 功能限制。

## 七步门禁

| 步骤 | 结果 | 证据与限制 |
|---|---|---|
| 1 typecheck / test / build | **通过** | Node v24.21.0；22 files / **111 tests**；client factory build 成功 |
| 2 预设零 token | **通过** | 三个 dsh-superagent preset 无 broken；产品 runtime ready，1 Session Source 健康 |
| 3 P3 fake 场景 | **通过** | 顺序重跑15项：三重复→1Trigger/1Ticket、同Thread串行补跑、暂停、FakeSource扩展、真实SIGKILL与ledger去重 |
| 4 P4 场景 | **规则场景通过；生产模型未全验** | 顺序重跑8项，随后新增token字段回归，全量111通过；卡死/空转/20分钟进展/预算顺序/等人不取消均有证据 |
| 5 P5 实测 | **HTTP/持久化通过；视觉待人工** | 匿名401、跨Origin403、owner200；资源200；approve200/replay409；重启仍approved；用户允许视觉待人工继续 |
| 6 真机e2e一次 | **通过（受控fixture）** | 实测3Trigger→2Ticket→2Assignment/Worker→2有效report；两个Ticket completed；Router每条1轮、共3turns/7steps |
| 7 清理 | **运行资源通过** | 实测liveAgents=0；所有隔离进程已停；端口无listener；activeAssignments=0、pendingTriggers=0、owner lock不存在；不删除历史/备份 |

最终工作区检查在收口提交后执行，不能用提交前的修改状态冒称干净。

## 1. 三闸原始尾部

执行顺序为 `pnpm typecheck && pnpm test && pnpm build`，使用 DSH bundled Node24 与 pnpm。

```text
$ tsc --noEmit -p tsconfig.json
$ vitest run
Test Files  22 passed (22)
Tests       111 passed (111)
Duration    10.61s
$ tsc -p tsconfig.build.json && node scripts/build-client.mjs
DSH client factory built: lib/client.js
[exit code: 0]
```

这轮包含 [真实 setup 契约回归](../tests/runtime.test.ts)、[Host 集成11项](../tests/runtime-integration.test.ts)、[SIGKILL 恢复](../tests/engine/crash-recovery.test.ts)、[正确 token 计数](../tests/engine/watchdog.test.ts)。

## 2. 零 token、HTTP 与资源证据

汇总产物：[final-zero-token-result.json](../probes/final-zero-token-result.json)。

真实 owner RPC：`POST /api/agentPresets/list`：

```json
{"type":"client-request","rpcId":"preset-health","method":"agentPresets/list","payload":{"args":{}}}
```

返回 `result.ok=true`，以下三个 preset 均无 broken：

```text
dsh-superagent-router
dsh-superagent-worker
dsh-superagent-watchdog
```

健康响应关键字段：

```json
{"ok":true,"runtime":{"state":"ready"},"sessionChannel":{"delivery":"deferred-until-next-admitted-step","immediateHumanReply":false},"outbox":{"pending":0},"sources":[{"id":"session:234b9575-5261-4d99-a4a3-32ac5367eff4","kind":"session","ok":true}]}
```

HTTP 实测：未认证401、跨Origin403、owner下health/overview/tickets/approvals200。Host HTML有dsh-superagent客户端引用；真实资源200、19334bytes、module-loader factory正确。没有浏览器截图或DOM替身，不把HTTP成功当作React成功挂载。

## 3. 审批与重启

仅向隔离开发数据库写入一个明确受控、无外部副作用的审批fixture；没有伪造业务审批成功。

```text
fixture: verify-p5-approval-20261118
approve HTTP 200
replay HTTP 409 / conflict
SQLite state approved / decided_by panel-owner
HTTP response excludes payload secret
restart: runtime ready, same Router session id
restart: approval still approved
```

审批fixture为独立记录，不宣称此测试覆盖真实Worker等待审批；该路径由真实SQLite+可控DSH替身的集成回归覆盖。

## 4. 真机 e2e 与反例核对

[运行器](../probes/final-runtime.cjs) 只复用产品runtime的真实Router，顺序发送两条明确fixture任务和一条闲聊。没有手工调用runtime.invoke制造Ticket/Assignment。

[完整结果](../probes/final-runtime-result.json) 从数据库和持久session事件获取：

```json
{"triggers":3,"tickets":2,"assignments":2,"validReports":2,"completedTickets":2}
```

- Router真实tool/call为ticket_create、assignment_start各两次。
- 两个assignment_start的持久tool/result均为`isError=false`、`ok=true`、`code=SA_STARTED`；返回Assignment id均匹配SQLite ended/ready记录，排除了自动pump掩盖工具失败的反例。
- Router两次派活的Assignment id：`a126064d-97cf-4692-985d-6959ba7a4ef5`、`e42b2c1f-bdc2-455e-8b6b-d45f6a27230e`。
- 两个真实Worker各1turn/1step，仅调用structured_output，非伪造文本报告。
- Router本次实际3turns/7steps，三条输入各1turn。运行器断言的是每条≤3，不冒称断言了总量≤3。
- 两份报告均有稳定id的inbox/spliced持久证据；只有第一份已进入后续user/message，第二份未被后续Router轮次消费。**已入队不等于两份均已消费或人已看到。**

### Token（冷读纠正，不重跑模型）

安装版TokenUsage的未缓存输入字段为inputTokens。最初误用uncachedInputTokens的0值已撤回，同时修复Watchdog并补预算回归；从三个原session冷读重算如下：

| 会话 | 未缓存inputTokens | cacheReadTokens | outputTokens |
|---|---:|---:|---:|
| Router | 3916 | 22016 | 925 |
| Worker1 | 919 | 3840 | 200 |
| Worker2 | 922 | 3840 | 187 |
| **合计** | **5757** | **29696** | **1312** |

cacheWriteTokens=0。字段互斥；总计36765 token，其中输入35453、输出1312。没有估造金额。

## 5. 清理

[Agent释放回执](../probes/final-cleanup-result.json)：

```json
{"kind":"production-runtime-cleanup","liveAgents":0,"liveSessionIds":[]}
```

通过runtime.dispose后读取整个agents.list实测，不是只检查Router handle。随后停止该Host。

[文件与数据库清理回执](../probes/final-filesystem-cleanup-result.json)：

```json
{"activeAssignments":0,"pendingTriggers":0,"ownerLockPresent":false,"recoverySentinelPresent":true}
```

进程表无superagent-dev；端口58387/59915/61602无listener。空recovery sentinel是[持久恢复互斥文件](../src/store/db.ts#L29-L31)，不是owner lock，OS释放占用，不删除该设计文件。保留受控fixture、session历史和备份供追溯，未清库、未删除用户数据。

## 6. 已修失败与过程偏差

两次初始Router启动报`setupCommit?.commit is not a function`，按计划停止并询问。用户允许继续后，`a3a5f5a`改为await mount但不返回preset对象，加入真实setup commit模拟回归；失败health不再伪装健康。[原始失败快照](../probes/final-runtime-startup-failure.json)保留。

[进度记录](PROGRESS.md)披露了多次30分钟心跳要求未满足、委派未按时交付的过程偏差，不回填虚构时间或测试结果。[P2诊断更正](P2-DIAGNOSIS.md)撤回旧探针硬编码计数与未真实inject的完整A3结论。

## 7. 保留风险与下一步边界

1. **Session Channel仍是部分实现**：通知等待下一次step admit；未admit保持UNKNOWN_DELIVERY/pending，无法即时显示。需要明确的人可见通知通道后才能闭合。
2. **P4模型抽样和人可见escalate未完整实证**：只读preset、512输出上限、超时/释放已有适配回归；生产模型判断未单独测试，不以两个Worker的e2e代替。
3. **P5视觉待人工**：侧栏入口、点击、console无slot crash、深浅主题尚未验证。用户只同意这项不阻塞e2e，并未声明视觉通过。
4. 七页中只有Overview/Tickets/Approvals为主流程；Threads/Settings为只读简版，Sources/Health占位，符合允许的P5范围缩减并明确披露。
5. 只使用superagent-dev和命令行临时overlay，不改desktop、不安装依赖、不新增DDL、不修改DSH安装包。

## 提交序列

```text
05192bd feat(p3): persist and recover trigger processing
aeb54b2 feat(p4): supervise workers with cold snapshots
531cbee fix(p3): trust host clocks and drain source work
264ed2c feat(p5): add guarded task and approval panels
a1dd179 feat(runtime): close guarded execution lifecycle
3927938 docs: record live startup gate stop
a3a5f5a fix(runtime): honor agent setup commit contract
6e2be39 fix(watchdog): count uncached input tokens
```

**一句话：P3部分（主链路通过、Channel延迟限制）；P4部分（规则通过、模型/人可见提醒待验）；P5部分（HTTP/持久化通过、视觉待人工）。**
