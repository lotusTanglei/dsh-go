# Overnight development report

时间：2026-11-17（Asia/Shanghai）

## 总结

- P1：基线已存在；本夜基准门禁通过。
- P2 A1：完成。
- P2 A2：完成，三个 preset 的 `broken` 均为空。
- P2 A3：未通过；真实 Worker structured report 连续两次失败，触发“同一门禁连续失败 2 次”停止条件。
- P3：未开始；已停止委派实现，未纳入本夜交付。
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

第一次真实运行：

```json
{
  "workerReports": [
    {"structured":null,"hasStructured":false,"stopReason":"max-tokens","outputCount":1,"outputKinds":["reasoning"]},
    {"structured":null,"hasStructured":false,"stopReason":"max-tokens","outputCount":1,"outputKinds":["reasoning"]}
  ],
  "cleanup":{"liveAgents":0}
}
```

第二次受限重试（明确 JSON prompt、增大 output cap）：

```json
{
  "workerReports": [
    {"structured":null,"hasStructured":false,"stopReason":"error","outputCount":2,"outputKinds":["reasoning","text"]},
    {"structured":null,"hasStructured":false,"stopReason":"error","outputCount":2,"outputKinds":["reasoning","text"]}
  ],
  "turns":{"router":1},
  "tokenUsage":{"router":null},
  "cleanup":{"liveAgents":0}
}
```

结论：2 Tickets 与 2 Worker activation 曾创建，但没有 2 条结构化 report，A3 不通过。真实模型调用达到本夜实际上限 2 次；依据停止规则不再重试。provider token usage 在探针中不可用，记录为 `null`，未估算。

清理：`liveAgents: 0`；active `superagent.sqlite.lock` 不存在，仅保留既有 `.lock.recovery` 文件。

## 阶段 B：P3

未开始。原因：P2 A3 同一门禁连续失败两次，触发停止条件。

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

1. A3 真实 Worker 没有返回 `output.structured`；目前只得到 reasoning/text 或 error。
2. 当前探针使用的 `outputSchema` 与真实模型调用路径仍需继续定位；下一次应先用 DSH structured-output contract 的最小独立 probe 确认 `structured_output` 工具调用方式，再恢复 A3。
3. P3/P4 未实现，不应声称夜间任务完成。
4. 没有修改 DSH 包、没有碰 desktop profile、没有安装新依赖、没有改数据库 schema。

## 下一步

1. 先定位真实 spawn 的 structured-output contract，不增加真实调用次数，优先用零 token/本地 fake activation 和 DSH 安装源码验证。
2. 修复后重新跑 A1 → A2 → A3；A3 通过后再开始 P3。
3. 保持每阶段提交前三条门禁全绿。
