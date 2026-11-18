# 发布说明

## 发布判定（2026-11-18）

当前版本是**部分完成／不可交付，非生产就绪**：本轮安装版真实native/shell探针确认L1 spawn父根与L2逐路径授权缺口，生产Worker启动/恢复/工具执行均已关闭。后端工作区命令/特定计划/持久通知已用真实Host本地适配器验证，外部provider0；不是实际Worker完成。看板UI源码/构建/Host资源合同已通过，但真实GUI验收仍未做；owner主目录内无敏感后缀的规范repo以`~/完整项目后缀`可审阅，不改变实际路径；其他范围被隐私脱敏无法完整审阅时仍禁止批准。发布前必须解决执行安全与知情授权阻断并完成人工清单，历史A/B/C证据不外推本轮。最终全量307tests/typecheck/build/pack通过，真实Host最新bundle、显式计划修改与旧指纹拒绝、owner/Origin合同及清理已复测；不代表真实Worker或浏览器验收通过。详见[逐项验收](<KANBAN-ACCEPTANCE.md>)、[人工清单](<KANBAN-MANUAL.md>)、[能力边界](<KANBAN-CAPABILITY.md>)与[本轮进度](<PROGRESS-KANBAN.md>)。

## 安装

### Desktop

Desktop profile **只能使用应用内 Plugins 管理界面**：

安装前先解决发布阻断；以下是待人工执行的流程，不表示本轮已安装。

1. 准备可移植 bundle 副本，把自有 bundle 的 `superagent-foundation` 配置改为**包目录之外**的持久绝对 `stateDir`；`dbPath/lockPath/workRoot` 留空由它派生，或显式配置到同一包外目录。当前仓库 patch 的路径是开发机示例，不能原样用于别的机器。禁止改 Desktop profile 文件。
2. 打开 DeepSeek Harness → Plugins。截图位 A：侧栏 Plugins 入口和 Add plugin 按钮。
3. 选择 Add plugin / 本地目录，选择准备好的 bundle 目录并确认 manifest/图标/说明。截图位 B：本地目录选择与确认框（隐藏用户路径）。
4. 在 Plugins 列表确认 `dsh-superagent` 已启用，确认配置为包外持久目录。截图位 C：启用状态及脱敏的配置检查。
5. 新建会话后检查三个 preset 无 broken，并在超管工作区的系统→健康检查 DB/version/runtime。截图位 D：preset roster 与健康真实数据。
6. 用本轮[工作区人工清单](<KANBAN-MANUAL.md>)逐项验收；[旧P5视觉清单](<P5-VISUAL-CHECKLIST.md>)仅作历史对照。上述截图位仅为采集说明，没有伪造截图。

本项目禁止通过 CLI 改 Desktop profile；不要手写 `~/.dsh/profiles/desktop/package.json` 或 `cordis.patch.yml`。

### 开发/隔离验证

仅在用户明确授权的 `superagent-dev` profile 使用命令行临时 overlay；DSH 启动会生成/更新 profile root 的 `cordis.yml`，这不是 Desktop 安装流程。不要打印 token/cookie/credentials。

## 配置项

| 名称 | 类型 | 默认值 | 影响 |
|---|---|---:|---|
| `stateDir` | absolute string | required | 状态、备份、工作根默认来源 |
| `dbPath` / `lockPath` / `workRoot` | absolute string | derived | SQLite、owner lock、Worker 工作目录 |
| `mainSessionId` | optional string | 自动创建/持久绑定 | 显式Router会话；显式缺失fail-closed，不自动换历史 |
| `routerReadScope` | none/reported/repo | reported | 保留配置；当前尚未接入读工具范围执行控制 |
| `confirm` | always/when-ambiguous/never | when-ambiguous | Router确认策略 |
| `acceptMode` | off/observe/auto | auto | 触发接受策略 |
| `bots` | deny/infer | deny | 是否接受机器人触发 |
| `paused` | boolean | false | 全局暂停新处理 |
| `maxWorkers` | positive integer | 3 | 并发 Worker 上限 |
| `queueLimit` | positive integer | 200 | 待处理 Trigger 上限 |
| `evalTimeoutMs` / `maxEvalRequeues` | duration/integer | 120000/2 | Eval超时与重排 |
| `maxStepsPerTicket` / `maxTokensPerTicket` / `maxDurationMsPerTicket` | integer/duration | 80/2000000/7200000 | Ticket预算 |
| `maxRetries` | integer | 2 | Worker重试上限 |
| `watchdogIntervalMs` / `stallMs` / `repeatCallThreshold` / `waitingHumanMs` | duration/integer | 60000/300000/3/1800000 | Watchdog规则 |
| `approvalTimeoutMs` | duration | 86400000 | 审批超时 fail-closed |
| `outboxMaxAttempts` / `outboxBackoffMs` / `outboxBackoffMaxMs` | integer/duration | 5/1000/60000 | 通知重试 |
| `budgetWarningRatio` | number (0,1) | 0.8 | 只校验/展示；80%预算预警路径尚未接线 |
| `panelPollMs` | duration | 5000 | 保留配置；客户端当前固定5000ms，改此值尚不改变轮询 |
| `panelPageSize` | positive integer | 20 | 列表默认分页长度（路由上限100） |
| `backupIntervalMs` / `backupKeep` | duration/integer | 86400000/7 | 保留配置；周期备份/自动轮转尚未实现，仅迁移前有`.bak.<version>` |
| `triggerRetentionMs` / `outboundRetentionMs` | duration | 90d/30d | 保留配置；当前没有自动清理consumer，不保证自动保留/清除 |
| `sqliteBusyTimeoutMs` / `staleLockMs` | duration | 5000/3600000 | SQLite等待/锁回收阈值 |
| `sources` | array | [] | v1 通常由 session source 运行时注册 |
| `roleTools.router` | string[] | read/glob/grep + ticket/assignment/human/channel工具 | 角色精确允许表；不能配置shell/写工具 |
| `roleTools.worker` | string[] | read/read_image/glob/grep/write/edit/bash/jobs + report/request/ask/structured_output | 生命周期/角色允许表，不等于allowWrite执行隔离 |
| `roleTools.watchdog` | string[] | read + watchdog_nudge/steer/cancel/escalate/structured_output | 只读/监督工具；不能配置一般执行工具 |

Settings 页只读展示生效值与来源；配置改动走受支持的 profile patch/环境配置，不在面板保存。

## 升级与回滚

迁移只增不改；启动时若数据库版本高于当前支持版本则拒绝启动。升级前：

1. 停止插件并确认没有 Worker、owner lock 或写入进程。
2. 复制整个领域库、`-wal`/`-shm`（若存在）和 lock 状态；命名为 `superagent.sqlite.pre-vX.Y.Z-YYYYMMDD-HHmmss`。
3. 保留原 bundle 与配置快照。
4. 启动新版本，让迁移创建版本化 `.bak.<migrationVersion>`；检查 Health DB version、Outbox、runtime。

回滚：停止新版本、确认 lock 释放，恢复与目标版本匹配的完整备份（主库及 WAL/SHM），再启动旧版本。不要用“删除迁移表”降级，不要把临时代理 JAR/手工复制的运行件当交付。

## 卸载

通过 Desktop Plugins 管理界面卸载。**只有按安装前提把 stateDir/dbPath/workRoot 配置到 bundle 包外，移除包时才不会连带丢失这些文件。** 当前仓库随包patch是开发机路径示例，不能无条件保证数据包外。卸载前先备份实际 stateDir；本插件没有主动删除领域历史的卸载逻辑。保留库、会话日志和备份由用户管理，不存在自动保留清理保证。
