# Overnight development report

时间：2026-11-17（Asia/Shanghai）

## 总结

- P1：基线已存在；本夜基准门禁通过。
- P2 A1：完成。
- P2 A2：完成，三个 preset 的 `broken` 均为空。
- P2 A3：已通过；S1/S2/S3 定位后修复 structured_output 引导与 Worker Assignment binding，生产路径得到 2 条 structured report，liveAgents=0。
- P3：未开始；本轮 A3 收口后才恢复推进。
- P4：未开始；已停止委派实现，未纳入本夜交付。
- P5：未开始。

## 开工基线与提交

- 已执行 `git init`。
- `.gitignore` 覆盖 `node_modules/`、`lib/`、`.superagent-state/`、`.probe/`、`.research/`、`*.sqlite*`。
- 基线提交：`a60bf55 chore: baseline P2 implementation`。
- 提交前门禁：typecheck、60 tests、build 全部通过。

## 阶段 A：P2

### A1 预设与 DSL

- 删除 preset 中 host-plane 服务行：`dsh-fs-local`、`dsh-bash-local`、`dsh-shell-env`、`dsh-jobs-local`。
- 保留 model-facing tool 行：`dsh-tool-fs`、`dsh-tool-fs-search`、`dsh-tool-bash`、`dsh-tool-jobs`。
- 删除 DSH value-schema 不支持的 `minLength`、`minItems`、`minimum` 等键。
- `dsh-tool-fs-search` 使用必需完整配置：`sampleOverCapGlobResults: false`。
- 保留框架无关参数校验；长度/范围不再进入 DSH DSL。

### A2 零 token 闸门

启动：`superagent-dev`

最终 RPC 原文：

```json
{"type":"server-response","rpcId":"p2-health-final","result":{"ok":true,"value":{"presets":[{"id":"standard","order":1,"isDefault":true},{"id":"ptc","order":2,"isDefault":false},{"id":"minimal","order":3,"isDefault":false},{"id":"cordis","order":4,"isDefault":false},{"id":"dsh-superagent-router","name":"Superagent Router","description":"Read-only task routing and human-facing coordination.","isDefault":false},{"id":"dsh-superagent-watchdog","name":"Superagent Watchdog","description":"Read-only assignment observation seam.","isDefault":false},{"id":"dsh-superagent-worker","name":"Superagent Worker","description":"Ticket-scoped execution and structured reporting.","isDefault":false}]}}}
```

三条目标记录均没有 `broken` 字段，A2 通过。

### A3 真实模型

证据文件：`probes/p2-real-run-result.json`。

诊断阶段先执行 S1/S2/S3：S1、S2、S3 均得到 `structured` 且 `stopReason: completed`；S1/S2 排除预算问题，S3 确认 prompt 必须明确调用 `structured_output`。随后修复 Worker prompt 和正式 Assignment binding。

最终生产路径 A3 原文摘要：

```json
{
  "state":"finished",
  "acceptedTickets":2,
  "expectedTriggers":3,
  "workerReports":[
    {"hasStructured":true,"stopReason":"completed","diagnostic":null},
    {"hasStructured":true,"stopReason":"completed","diagnostic":null}
  ],
  "turns":{"router":1,"worker":1},
  "routerInjectedReports":[
    {"ticketId":"ticket-1","assignmentId":"assignment-1","wakeup":false},
    {"ticketId":"ticket-2","assignmentId":"assignment-2","wakeup":false}
  ],
  "cleanup":{"liveAgents":0}
}
```

provider token usage 在当前 runtime 返回 `null`，没有估算；累计真实调用为 S1/S2/S3 三次诊断 + 最终 A3 一次，共 4 次。

清理：`liveAgents: 0`；active `superagent.sqlite.lock` 不存在，仅保留既有 `.lock.recovery` 文件。

## 阶段 B：P3

尚未实现；P2 A3 现在已通过，下一阶段可开始。

## 阶段 C：P4

未开始。原因同上。

## 阶段 D：P5

未开始。

## 最终门禁尾部

```text
Test Files  13 passed (13)
Tests       60 passed (60)
$ tsc --noEmit -p tsconfig.json
$ vitest run
$ tsc -p tsconfig.build.json
```

## 公开接口变更

本夜没有新增 P3/P4 公开接口。P2 既有接口保持：

- `Spawner.startActivation(input): Promise<WorkerActivation>`
- `startWorker(input, spawner): Promise<WorkerHandle>`
- `dispatchTriggers(triggers, options): Promise<readonly RouterReport[]>`
- `REPORT_OUTPUT_SCHEMA`

## 偏差与已知问题

1. provider token usage 当前 runtime 返回 `null`，未估算。
2. 探针中的 Router 注入记录为 Host correlation + `wakeup:false`，没有额外唤醒模型轮次。
3. P3/P4/P5 尚未实现，不应声称整晚任务全部完成。
4. 没有修改 DSH 包、没有碰 desktop profile、没有安装新依赖、没有改数据库 schema。

## 下一步

1. A3 已通过，下一步实现 P3 `sources/types.ts`、实例 registry 和契约测试。
2. 保持每阶段提交前三条门禁全绿。
3. 后续 P3/P4 仍需独立验收，不得用 P2 证据替代。
