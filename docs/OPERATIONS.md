# 运维手册

## 健康检查

优先打开面板 **Health**：

- `runtime.state`: ready/starting/failed/stopped/unavailable；不要把缺失当 healthy。
- `db.version`、`db.sizeBytes`: 迁移版本与主库+WAL字节数。
- `watchdog.lastAt`、`watchdog.decisions[]`: 最近最多20条终态动作及 `stallMs/durationMs/usage/repeatedCalls`（公开页用 usage 表示审计中的 tokens）。
- `outbox.pending/dropped`: 通知积压/丢弃。
- `recentErrors[]`: 安全错误码与时间，不含原始路径/异常正文。
- `sources[]`: id/kind/attended/ok/lastAt/paused；Sources 页的开关是只读状态。

接口是 owner-auth、same-origin 的 POST：`/api/superagent/health`、`/overview`、`/tickets`、`/approvals`。不要把匿名 curl 200 当成成功；未认证应为401，跨Origin应为403。

## 日志与证据

插件加载日志为固定 `[superagent] loaded`，初始化失败为固定 `[superagent] runtime initialization failed`；领域审计在 SQLite `audit.detail`，写入前脱敏。详细阶段原始证据在 `probes/closeout/`，不要把其中的 synthetic token、路径或 URL 当用户数据。完整会话事件由 DSH session persistence 管理；领域库会保存经脱敏的入站 `trigger.text`，并非完全不保存消息文本。

## 常见故障

### Worker 卡死

1. Health 查看最近 Watchdog action/metrics，确认 `rule=stall` 与实际 `stallMs`。
2. 观察顺序是否为 nudge → cancel → escalate；不要手工改 Assignment 状态。
3. 检查 Ticket 是否 ended/stopped、Outbox 是否 sent/pending、Router 是否收到一条对应 idempotency notice。
4. 若 Outbox pending，先确认 Router/source 是否健康；不要重复触发会产生第二条通知。
5. 当前仍有 cancel→stage2审计落盘之间的崩溃窗口，不能称完整 crash-safe。

### Outbox 积压

检查 `pending`、`attempts`、`next_at` 和 Source health。恢复 Source 后由维护循环重试；`dropped` 需要人工调查。不要直接删除 outbound 行，否则会丢失幂等账本。

### DB 锁冲突

确认没有第二个 DSH/插件进程持有 `stateDir/*.sqlite.lock`。Health/日志应显示固定错误，不要删除活跃 owner lock。只有确认 pid 已死亡且锁格式有效、超过 `staleLockMs` 时，启动流程才会回收；损坏锁 fail-closed，人工备份后处理。

### 预设加载失败

检查 Plugins/Agent Presets roster 中 `dsh-superagent-router/worker/watchdog` 的 broken 字段、profile manifest 与 DSH 版本范围。重新加载前先保留 SQLite/会话备份；不要改 Desktop profile 文件，也不要用 CLI plugin add 代替应用内管理。

例外（2026-11-24 更名迁移）：包标识由 `dsh-superagent` 改为 `dsh-go`，产品名 Go。该次仅同步更新 profile 的 bundles/依赖键与 `node_modules/dsh-go` 链接，preset id（`dsh-superagent-router/worker/watchdog`）保持不变以兼容已持久化会话；目录与 SQLite 绝对路径未动。此迁移属一次性例外，之后仍走应用内管理。

## 数据保护

- 不打印 token/cookie/credentials。
- 不把真实仓库、真实密钥或生产审批用于验收。
- `allowWrite/denyWrite` 目前尚未提供执行级逐文件/逐命令隔离；shell 旁路是发布阻断。不要以“Worker 已按范围执行”作为安全结论。
- 真实视觉、浏览器通知显示、人已读均未由自动证据证明。
