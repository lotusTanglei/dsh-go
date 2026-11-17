# 007 · 开发计划

## 0. 前置：四个探针（P1 第一件事，半天）

真写代码前必须先验证，否则整条架构要改：

| # | 探针 | 验证什么 | 验不过怎么办 |
|---|---|---|---|
| S1 | 装包（Desktop 路线，用户已选） | 通过桌面 Plugin Manager 安装本地 bundle，记录 receipt 与插件行状态；观察加载标记并验证 SQLite 事务/WAL | 原 CLI add/dump-config 均被托管 Desktop 拒绝；不手改 profile、不自行换环境，失败先停下报告 |
| S2 | preset 注册 | 第三方 bundle 能否注册 agentPreset 并在 `startActivation({agentPreset})` 中使用 | 退：`when(ctx)` 在调用时自检角色，配 `tools.restrict` |
| S3 | 子会话工具隔离 | Worker 真的拿不到 `channel_reply`，Router 真的拿不到 shell | 退：工具内部做角色断言，越权即抛错 |
| S4 | Ticket 结束后拒绝 | Assignment 结束后 Worker 再调工具会失败 | 退：`activation.dispose()` + 工具自检双保险 |

S2/S3/S4 是架构级假设，**验不过就不是改实现，是改方案**。

### 2026-11-17 实测检查点（不是 P1 完成）

- S1：Desktop CLI 安装/dump 被托管限制拒绝；按用户选择经 Plugin Manager 安装、激活和卸载成功。方案 1 探针在 Host 内发出加载 marker 并验证 SQLite WAL/COMMIT/ROLLBACK；P1 产品自己的 marker 待产品加载验收。
- S2：真实 spawn 采用第三方 Worker preset，独立 child 正常 completed，返回 PROBE_OK。
- S3：实际 Router 无 shell/写，实际 child Worker 无 channel_reply/human_ask。用户已选择方案 1：补充 deny-only 执行闸；真实 executor 证明 Router/Worker/Watchdog 越权全局哨兵被拒绝且 body 未执行，普通会话前后成功。全局 schema 仍可能可见，不冒称隐藏。
- S4：实际 activation 结束后再调为 `isError:true`、`session "<id>" is not live in this store`，无结构化错误码。方案 1 内存绑定探针另验证 Worker 仍活着时 ended/旧绑定/未绑定拒绝，分别有 SA_ASSIGNMENT_ENDED/STALE/UNBOUND；P2 必须用真实领域库绑定再次覆盖。
- 父子测试 Agent 已释放，临时 bundle 已卸载，未改核心或放宽权限。全部命令、receipt、原始输出见 [探针报告](../probes/RESULTS.md)。

---

## 1. 阶段总览

| 阶段 | 主题 | 产出 | 工期（T 恤） |
|---|---|---|---|
| P1 | 骨架 + 领域 + 存储 | 可运行的空插件 + 领域单测全绿 | M |
| P2 | 三个会话角色 | Router/Worker/Watchdog 能跑通一次派活 | L |
| P3 | 事件管线 | 去重/Thread/Eval/Outbox/暂停/恢复 | L |
| P4 | Watchdog | 卡死检测与干预 | M |
| P5 | 面板 | 七页 + 审批 | L |
| P6 | 加固 | 注入/并发/故障/成本压测 + 上线清单 | M |
| P7 | GitHub 源（后置） | 真源接入 | L |
| P8 | 飞书源（后置） | 真源接入 | M |

顺序理由：面板放在 Watchdog 之后，因为审批按钮要先有 Approval 实体；真源全部后置，因为它需要公网入口与凭据，是唯一会被环境卡住的环节。

---

## 2. P1 · 骨架 + 领域 + 存储

**范围**：包骨架、Config、SQLite 与迁移、领域对象与状态机。不含任何会话逻辑。

任务

1. 包骨架：`package.json`（`dsh.bundle` + `dsh.client` + `engines.dsh`）、`tsconfig`、`vitest.config`、`.gitignore`
2. `src/domain/*`：ids / trigger / thread / policy / eval / mandate / ticket / assignment / approval，全部纯函数
3. `src/domain/invariants.ts`：I1–I11 的判定函数（I11 = 孤儿 Assignment 判定，纯谓词 `isOrphan(a, liveSessionIds)`）
4. `src/store/db.ts` + `migrations/001_init.ts`：DDL、迁移器、文件锁
5. `src/store/repos/*`：各表的最小组装（insert/get/update-by-state）
6. `src/config.ts`：Schemastery schema（全部可调值）
7. 探针 S1（装包）

验收

- `pnpm typecheck && pnpm test && pnpm build` 全绿
- 单测覆盖五组：去重、Thread 单 Eval、Ticket 恢复、Policy 版本、Mandate 校验
- **D2 的"并发 3 条只 1 个 running"已移到 P3**（P1 没有 engine，此处只测纯谓词，不造假并发）
- 追加 I11 谓词单测：`live` 里没有的 sessionId 必须判 orphan；`ended` 缺 `endedReason` 必须拒绝（恢复时的接线在 P3）
- 追加 D5 导出面测试：`mandate.ts` 的变更入口只有 grant / withdraw / revalidate 三个，没有其它 mutator
- 迁移单测：空库 → migrate → 断言 16 张表与全部索引（用户确认：14 张业务表 + schema_migrations/kv）；Ticket.brief 按 rev2 完整保存于必填 brief_json
- 插件能被 patch 加载（日志出现 `[superagent] loaded`），无任何功能

风险：`node:sqlite` 在 Electron 主进程的线程/权限行为与普通 Node 有差异 → S1 时顺带验证事务与 WAL。

---

## 3. P2 · 三个会话角色

**范围**：Main Session 绑定、Worker 派活、汇报协议、审批协议、工具闸。

任务

1. `sessions/main.ts`：`ensureMainSession`（配置优先/库里记忆/被删重建）、`injectContext`、`notifyRouter`
2. `sessions/worker.ts`：`startActivation({provider:'spawn', delivery:'caller', cwd, agentPreset, outputSchema})` 封装
3. `presets/`：router / worker / watchdog 三份组合定义
4. `tools/router.ts`：`ticket_create` `ticket_list` `ticket_status` `ticket_cancel` `ticket_resume` `assignment_start` `assignment_stop` `human_ask` `channel_reply`
5. `tools/worker.ts`：`report_progress` `report_result` `request_approval` `ask_router`
6. **brief 生成**：Router 按 `TicketBrief` 十个字段填（见 003-F4），字段完备度受 `router.readScope` 约束；填不出写 `unknown`，不许编造路径
7. **report 校验**：schema 校验 + 逐条比对 `brief.acceptance`；缺字段或有 `not-run` 退回一次，再失败按 failed
8. 工具闸：Ticket 结束 → 拒绝；旧 Assignment → 拒绝

验收

- 假事件注入 3 条 → 2 Ticket → 2 Worker → 2 条汇报回到 Router
- Router 工具表里没有 shell/写文件；Worker 工具表里没有 `channel_reply`
- Ticket 结束后 Worker 再调 `report_progress` 返回明确错误
- 探针 S2/S3/S4 有结论并记录到本文档

风险：Worker 的 cwd 必须真隔离；`cwd` 传相对路径会按父目录解析（`subagent.md:11`），必须传绝对路径。

---

## 4. P3 · 事件管线

**范围**：Source 接口、会话源、去重、Thread、Eval、Outbox、暂停恢复。

任务

1. `sources/types.ts` + `registry.ts`（按实例 id 注册）
2. `sources/session.ts`：监听 `session/event`，过滤出 `user/message`，归一化
3. `sources/fake.ts`：重复/乱序/失败注入能力（测试专用）
4. `engine/intake.ts`：过滤 → 去重 → Thread 归位 → 订阅检查 → 入队
5. `engine/eval.ts`：单 Eval/Thread、超时、requeue、Policy 版本校验
6. `engine/outbox.ts`：幂等发送、退避重试、死信
7. `engine/pause.ts`：全局暂停；暂停时只入库不处理
8. 启动恢复：四个 reconcile（Assignment/Outbox/Eval/Queue）

验收

- 同一事件投 3 次 → 1 条 Trigger → 1 个 Ticket
- **D2（自 P1 移入）**：同一 Thread 并发 3 条 → 只有 1 个 `running` Eval，其余进 `pending`，Eval 结束后按序补跑
- 乱序到达：seq 保证时间线正确，Eval 批处理不丢
- kill -9 后重启：未完成 Ticket 继续，Outbox 不重复发送
- 暂停期间消息入库不丢，恢复后按序处理
- 新增一个假 Source 只实现接口，engine 零改动

风险：`session/event` 是提交后推送（`session.md:1410`），需要自己判断哪些事件是"用户输入"，避免把工具结果当消息。

---

## 5. P4 · Watchdog

**范围**：独立会话、定时判定、四种动作、审计。

任务

1. `sessions/watchdog.ts`：冷读（`sessionQuery.readSession`）、指标计算
2. 判定规则：无进展 / 空转 / 偏离 / 超预算 / 久等人
3. 动作：`nudge`（steer）、`steer`、`cancel`（interrupt + assignmentStop）、`escalate`（channel_reply）
4. 心跳与自审计：每次动作记录指标快照
5. 误杀防护：`report_progress` 作为心跳；只认进展写入

验收

- 注入一个"卡死"的假 Worker（不再汇报）→ 阈值内被发现并 nudge，二次超时 cancel
- 注入一个"空转" Worker（重复同一工具调用）→ nudge 且消息内容指向具体重复
- 一个正常跑 20 分钟但每 2 分钟汇报的长任务 → 不误杀
- 超预算 Worker → nudge → stop → escalate 顺序正确

风险：冷读拿到的只是会话事件，判断"是否偏离目标"需要模型，成本高 → v1 只做低频抽样。

---

## 6. P5 · 面板

**范围**：七页 + 审批动作 + Host 路由。

任务

1. 客户端构建：复刻 `clientBundle` 预设（tsdown 配置）
2. `client/index.ts`：`sidebar.panellist` + `main` 注册，`ctx.slots.inject` 包裹
3. 七个页面组件 + 主题 token + locale
4. Host：`ctx.connection.fetch.register` 九条路由
5. 审批二次确认 + 失败态 + 空状态
6. 面板轮询与错误退避

验收

- 侧栏出现图标，点开有七个页签
- 审批按钮生效，DB 中 `approval.state` 与 `decided_by` 正确
- 重启后面板状态与库一致
- 页面无硬编码色值；深浅色切换正常
- 面板与日志中无密钥

风险：客户端构建是独立工程量（DSH 未发布该构建预设）→ 若卡住，降级用"动态客户端半"（纯 JS + `host.call`，标 experimental）。

---

## 7. P6 · 加固

- 提示词注入测试集：仓库文件注入、汇报注入、面板注入
- 并发压测：50 Ticket 同时到达，队列不堆爆、内存平稳
- 故障注入：DB 只读、主会话被删、Worker 进程消失、时钟跳变
- 成本压测：连续 20 个 Ticket 的 token 曲线
- 上线检查清单 + 已知限制
- 升级/回滚说明（迁移只增不改；回滚需备库）

---

## 8. P7/P8 · 真源（后置）

- P7 GitHub：独立账号、验签、Issue/PR/Review/CI、评论回写、合并审批
- P8 飞书：bot 身份、长连接、话题回复、图片/文件引用、回复 ≤100 字

**前置条件**：一个可折腾的测试仓库 / 飞书应用凭据。没有就继续用 fake。

---

## 9. 依赖图

```
S1 ─┐
S2 ─┼─→ P2 ─→ P3 ─→ P4 ─┐
S3 ─┤                    ├─→ P6 ─→ P7 ─→ P8
S4 ─┘                    │
     P1 ─────────────────┴─→ P5
```

P1 与探针可并行；P5 只依赖 P1（读库）与 P2（审批实体）。

---

## 10. 风险登记册

| # | 风险 | 影响 | 概率 | 应对 |
|---|---|---|---|---|
| R1 | 第三方 bundle 无法注册 agentPreset | 角色隔离失效，架构改动 | 中 | S2 先验；退路是工具内自检 |
| R2 | `tools.restrict` 反向泄漏到子会话 | Worker 被砍成只读 | 高（已定性） | 不用它做身份隔离，只用 preset |
| R3 | 客户端构建预设未发布 | 面板工期翻倍 | 高（已知） | 复刻构建；退路是动态客户端半 |
| R4 | DSH 内置审批不可用（策略 never） | 无法复用审批 UI | 已发生 | 自建 Approval + 面板 |
| R5 | Worker cwd 未真隔离 | 跨 Ticket 写 | 中 | 绝对路径 + 启动断言 |
| R6 | 会话事件流噪声大 | 把工具结果当用户消息 | 中 | 按 `event.type` + `source` 双重过滤 |
| R7 | 成本不可见 | 跑到超支才发现 | 中 | 每 Ticket 记 tokens；Overview 展示 |
| R8 | 迁移写坏数据 | 无法回滚 | 低 | 迁移前备份 + 降级拒开 |

---

## 11. 每阶段的汇报格式（约定）

1. 本阶段做了什么
2. 改了哪些文件
3. 新增/修改的公开接口
4. 跑了哪些测试，结果如何
5. 没做什么、已知风险
6. 下一阶段建议

阶段之间**停下来等确认**，不自动进入下一阶段。
