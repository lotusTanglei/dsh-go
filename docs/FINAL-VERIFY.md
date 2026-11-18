# 最终验收记录 · 2026-11-18

## 结论

**P3 / P4 / P5 均为部分完成，未达到完整交付验收。**

代码层最新三闸通过；真实隔离 profile 的三个 preset 健康，但产品 Router 两次初始化失败。按 [DEV-ALL §7](prompts/DEV-ALL.md#L242-L249)“同一问题连续失败两次即停”停止，不继续修产品或启动模型。desktop 未改；本轮最终 e2e 模型调用 0 次。

## 七步门禁（严格按序）

| 步骤 | 结果 | 证据与限制 |
|---|---|---|
| 1 typecheck / test / build | **通过** | Node v24.21.0，22 test files / 109 tests，client factory build 成功 |
| 2 预设零 token | **预设通过，产品启动失败** | owner RPC roster 三个 dsh-superagent preset 均无 broken；Router ready rejected |
| 3 P3 fake 场景 | **有单测证据；未在步骤2之后继续验收** | 去重三次→1Trigger/1Ticket、并发pending补跑、暂停恢复、可插拔FakeSource；真实SIGKILL+durable downstream ledger测试通过 |
| 4 P4 场景 | **有单测证据；live未执行** | 五规则、长任务不误杀、预算顺序、等人不取消、模型抽样边界与释放单测通过；生产定时器/模型未实际运行 |
| 5 P5 实测 | **未完成** | owner健康路由200、匿名401；sources=[]；无浏览器，不能证明侧栏/切页/主题/console；未做真实审批重启 |
| 6 真机e2e一次 | **未开始** | 3Trigger→2Ticket→2Worker→2report未运行；不复用旧P2硬编码计数 |
| 7 清理 | **进程/owner锁通过；完整验收条件未全满足** | 两隔离进程退出、端口53163/53784无listener、SQLite activeAssignments=0、owner lock不存在；未有liveAgents API实测，因此不伪造该计数 |

## 原始输出（不含访问凭据）

### 三闸

```text
$ tsc --noEmit -p tsconfig.json
$ vitest run
Test Files  22 passed (22)
Tests       109 passed (109)
Duration    10.77s
$ tsc -p tsconfig.build.json && node scripts/build-client.mjs
DSH client factory built: lib/client.js
[exit code: 0]
```

### 预设健康

真实 owner RPC 形式为 `POST /api/agentPresets/list`：

```json
{"type":"client-request","rpcId":"preset-health","method":"agentPresets/list","payload":{"args":{}}}
```

从返回 `result.ok=true`、`value.presets` 读取：

```json
[
  {"id":"dsh-superagent-router","name":"Superagent Router","description":"Read-only task routing and human-facing coordination.","isDefault":false},
  {"id":"dsh-superagent-watchdog","name":"Superagent Watchdog","description":"Read-only assignment observation seam.","isDefault":false},
  {"id":"dsh-superagent-worker","name":"Superagent Worker","description":"Ticket-scoped execution and structured reporting.","isDefault":false}
]
```

三个对象均不含 broken。先前不带规范 envelope 的请求被 gateway 拒绝，不当作产品错误或健康证据。

### 产品真实启动

两次均观察：

```text
[superagent] loaded
[superagent] runtime initialization failed
```

第二次仅增加命令行诊断 overlay，不修改 profile 文件，不运行模型。捕获 [失败产物](../probes/final-runtime-result.json)：

```json
{"state":"idle","kind":"production-runtime-e2e","modelsStarted":false,"ready":false,"startupError":{"name":"TypeError","code":"","reason":"setupCommit?.commit is not a function"}}
```

## 已定位根因（未越过停止条件修复）

[当前 Router setup](../src/runtime.ts#L279) 直接 `return ctx.agentPresets.mount(...)`，mount 返回 `{id}`。安装版 Agent setup 契约只允许 `void` 或 `{commit()}`；AgentLoop 对非空返回值调用 `setupCommit?.commit()`，所以创建失败。

修复候选：改为 async block，`await mount(...)` 后不返回该 `{id}`；加入模拟真实 setup commit contract 的回归。**该修复尚未执行，须用户解除停止后继续。**

## 已知未完成与风险

1. Session Channel：inject 只写 inbox/spliced，不立即显示。仅 exact user/message 出现后才能记为进入可渲染聊天记录；否则 UNKNOWN_DELIVERY，Outbox 保持 pending。不是即时回复，也不能证明人已读。
2. P4 抽样使用只读 preset、512 maxTokens、超时/释放；只验证了适配契约和假activation，不是模型结果实证。Watchdog escalate 尚未证明人可见。
3. P5 完成主三页代码，另外四页简版/占位。浏览器工具不可用，UI视觉门禁未通过。
4. 运行异常只安全日志，没有原始私有路径；当前 health 未显式把 ready rejection 作为整体不健康，这是需要修正的健康诊断缺口。
5. 旧 P2 报告的完整 A3 结论已撤回，参见 [P2-DIAGNOSIS](P2-DIAGNOSIS.md)。

## 清理证据

```json
{"activeAssignments":0,"tickets":0,"ownerLockPresent":false,"recoverySentinelPresent":true}
```

空 `.lock.recovery` 是持久 SQLite 恢复互斥文件，不是 owner lock；源码 [db.ts](../src/store/db.ts#L29-L31) 明确设计为保留，OS 在进程退出后释放锁。未删除数据/会话历史/备份，不清库。

两次管理进程作业均已取消并收集终态；进程表未见 superagent-dev，端口检查未见 listener。未触碰 desktop，也未启动替代服务器冒充当前 GUI。

## 本轮提交

```text
05192bd feat(p3): persist and recover trigger processing
aeb54b2 feat(p4): supervise workers with cold snapshots
531cbee fix(p3): trust host clocks and drain source work
264ed2c feat(p5): add guarded task and approval panels
a1dd179 feat(runtime): close guarded execution lifecycle
```

后续只有在用户明确解除本次停止后，才修正 setup/健康诊断并从三闸重新顺序验收。
