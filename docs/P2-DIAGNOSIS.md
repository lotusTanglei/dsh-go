# P2/A3 diagnosis and closure

## 前置

- 分支：`main`
- 起点提交：`737700a docs: record overnight P2 gate stop`
- 起点门禁：13 test files / 60 tests、typecheck、build 全绿。
- 使用 profile：`superagent-dev`；未触碰 desktop；未安装依赖；未改 DSH 包。

## 二分探针原始结果

完整原始 JSON 保存在：

- `probes/p2-s1-result.json`
- `probes/p2-s2-result.json`
- `probes/p2-s3-result.json`

### S1：business-only + 明确 structured_output + maxTokens 512

关键原文：

```json
{
  "structured":{"state":"ready","done":["ok"],"todo":[],"changedPaths":[],"acceptance":[],"risks":[],"needHuman":[]},
  "hasStructured":true,
  "stopReason":"completed",
  "diagnostic":null,
  "tokenUsage":null,
  "effectiveOptions":{"worker":{"provider":"deepseek-official","model":"deepseek-flash","maxTokens":512}},
  "sessionEvents":["assistant/message","tool/call","tool/result","step/end","turn/end"]
}
```

### S2：同一任务 + maxTokens 4096

关键原文：

```json
{
  "structured":{"state":"ready","done":["ok"],"todo":[],"changedPaths":[],"acceptance":[],"risks":[],"needHuman":[]},
  "hasStructured":true,
  "stopReason":"completed",
  "diagnostic":null,
  "tokenUsage":null,
  "effectiveOptions":{"worker":{"provider":"deepseek-official","model":"deepseek-flash","maxTokens":4096}},
  "sessionEvents":["assistant/message","tool/call","tool/result","step/end","turn/end"]
}
```

### S3：真实 brief + prompt 末尾硬要求 structured_output

关键原文：

```json
{
  "structured":{"state":"ready","done":["Inspected the supplied fixture directory ..."],"todo":[],"changedPaths":[],"acceptance":[{"id":"A1","result":"passed","evidence":"..."}],"risks":[],"needHuman":[]},
  "hasStructured":true,
  "stopReason":"completed",
  "diagnostic":null,
  "tokenUsage":null,
  "effectiveOptions":{"worker":{"provider":"deepseek-official","model":"deepseek-flash","maxTokens":4096}},
  "sessionEvents":["assistant/message","tool/call","tool/result","step/end","turn/end"]
}
```

## 根因判定

**根因：引导问题 + 正式 Worker 绑定接线缺失；不是预算，也不是 structured-output 通道故障。**

证据：

1. S1 在 512 tokens 下完成 structured output，排除默认预算不足。
2. S2 在 4096 tokens 下同样完成，进一步排除预算问题。
3. S3 只有在 prompt 明确要求 `structured_output` 时稳定完成，说明旧生产提示词的“return a structured report”不足以约束模型。
4. 旧完整 A3 的冷读最后事件显示正式 Worker 写出“没有 bound ticket”，随后没有工具调用；这是 deny-only Assignment guard 的预期 fail-closed 行为。
5. 生产路径修复后，完整 A3 两个正式 Worker 均出现 `tool/call structured_output` 与 `tool/result`，并返回 `stopReason: completed`。

## 修复点

- `src/sessions/worker.ts:103`：生产 Worker prompt 改为明确要求：完成后必须调用 `structured_output`，不得用正文作为最终报告。
- `src/config.ts:80`：Worker allowlist 增加 `structured_output`。
- `src/index.ts:7-38`：Host 暴露 `superagentRoleGuard` 服务。
- `src/sessions/worker.ts:43-61,144-190`：Spawner 支持可信 Worker binding；`startWorker` 在 activation 发布后绑定 Ticket/Assignment 快照，dispose 时解除绑定。
- `probes/p2-real-run.cjs`：改为走 `startWorker` / `spawnerFromContext` 生产路径，并记录 diagnostic、冷读最后五条事件、实际 agentOptions、structured report 和 Router correlation。

## 完整 A3 原始结果

文件：`probes/p2-real-run-result.json`

摘要原文：

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
  "effectiveOptions":{"router":{"provider":"deepseek-official","model":"deepseek-flash","maxTokens":256},"worker":{"provider":"deepseek-official","model":"deepseek-flash","maxTokens":768}},
  "routerInjectedReports":[
    {"ticketId":"ticket-1","assignmentId":"assignment-1","wakeup":false},
    {"ticketId":"ticket-2","assignmentId":"assignment-2","wakeup":false}
  ],
  "cleanup":{"liveAgents":0}
}
```

Provider token usage 字段在当前 runtime 返回 `null`，没有进行估算；模型调用数为 S1/S2/S3 三次诊断 + A3 一次最终验收，共 4 次，低于上限 8。

## 门禁尾部

```text
Test Files  13 passed (13)
Tests       60 passed (60)
$ tsc --noEmit -p tsconfig.json
$ vitest run
$ tsc -p tsconfig.build.json
```

## 当前边界

- P2/A3 已通过；P3 尚未开始。
- “Router 注入”在本探针中记录为 Host correlation + `wakeup:false`，没有额外唤醒 Router 模型轮次。
- P3/P4/P5 仍需按阶段门禁推进。
