# 夜间自主开发任务（P2 收口 → P3 → P4 → P5）

> 交付给开发 agent 时整段复制。目标：无人值守跑一晚，早上留下可验收的产物。

你在 `/Users/dundundebaba/sync/dsh-s-p` 工作。P1 已封版（39 测试全绿、D1–D8 真覆盖）。P2 代码已完成但真实验收未通过，原因是三个预设声明错误，诊断已拿到。今晚的任务是：先收口 P2，再推进 P3、P4，有余力做 P5。

---

## 0. 开工前（必须，20 分钟内完成）

1. **建 git**：`git init`，确认 `.gitignore` 覆盖 `node_modules/ lib/ .superagent-state/ .probe/ .research/ *.sqlite*`，提交现状作为 `baseline: P2 code complete, presets broken`。
   > 没有版本控制的通宵是灾难。每完成一个阶段必须 commit，提交前三条门禁必须绿。

2. **读文档**（不要通读全部，按需）：
   - `docs/001-domain.md` §12 不变式、§7 Ticket 状态机
   - `docs/003-flows.md` F1–F8
   - `docs/004-persistence.md` §2 表结构、§6 恢复
   - `docs/007-plan.md` §3 P2、§4 P3、§5 P4、§6 P5
   - `probes/RESULTS.md`（S1–S4 结论，别再重复验证）

3. **建立基准**：`pnpm typecheck && pnpm test && pnpm build`，确认 39 passed 起步。

4. **建日志**：`docs/NIGHT-LOG.md`，之后每 30 分钟追加一行（时间 / 阶段 / 做了什么 / 卡点）。

---

## 1. 授权与边界

**允许**
- 修改仓库内任何文件
- 使用隔离 profile `superagent-dev`（装/更新/启动）
- 真实模型调用：**上限 8 次运行，每次 ≤3 轮，用最便宜的路由**，每笔记录 token

**禁止**
- 碰 desktop profile（Electron 独占，改了会坏用户环境）
- 安装新 npm 依赖（除非 P5 客户端构建确实必需，且先在报告里记一笔）
- 修改任何 `@deepseek-ai/*` 包
- 删除 `.research/`（参考实现克隆）
- 任何形式的"绕过验证让它变绿"

---

## 2. 阶段 A · P2 收口（必须先做完）

### A1 修三个预设（诊断已确认，不要重新猜）

我从 `agentPresets/list` 拿到的原文：

```
router   : service "fs" has been registered at <SandboxedFileSystem>
           unsupported JSON schema: parameters.brief.properties.goal.minLength ...
watchdog : service "fs" has been registered at <SandboxedFileSystem>
worker   : service "fs" / "shell" / "shellEnv" / "jobs" has been registered
           invalid config: $.sampleOverCapGlobResults missing required value
           unsupported JSON schema: parameters.done.items.minLength ...
```

四条修复：

1. **预设里只放 model-facing 工具行，不放服务行。**
   删除 `@deepseek-ai/dsh-fs-local`、`dsh-bash-local`、`dsh-shell-env`、`dsh-jobs-local`。
   保留 `@deepseek-ai/dsh-tool-fs`、`dsh-tool-fs-search`、`dsh-tool-bash`、`dsh-tool-jobs`。
   依据：`dsh-web-app/cordis.patch.yml` 只把 tool 行移进 preset，服务行留在宿主平面；重复注册服务会让整个预设作废。

2. **工具参数 DSL 是封闭词表**，只允许：
   ```
   通用：description title default examples required
   标量：+ type
   对象：+ type properties additionalProperties（必须显式写布尔）
   数组：+ type items
   枚举：+ type enum const
   ```
   删掉所有 `minLength` / `minimum` / `maxLength` / `pattern`。长度与范围校验写进 `execute` 自己判，返回结构化错误。

3. **`dsh-tool-fs-search` 不要传半份 config。** patch 是整行替换不是深合并；要么省略 config，要么写全必需字段。

4. 改完**不要立刻跑模型**，先过 A2 的零 token 闸门。

### A2 零 token 闸门（5 秒，零费用，以后每阶段都要跑）

```sh
dsh --profile superagent-dev --port 0 --no-open   # 记下 URL 与 token
curl -s -c /tmp/ck "$URL/?token=$TOKEN" -o /dev/null
curl -s -b /tmp/ck -X POST "$URL/api/agentPresets/list" \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"1","method":"agentPresets/list","payload":{"args":{}}}'
```

**验收**：`dsh-superagent-router` / `-worker` / `-watchdog` 三个的 `broken` 字段为空。把三条结果原文贴进报告。

### A3 真机 e2e（A2 全绿后才跑）

注入 3 条 Trigger → 2 Ticket → 2 Worker → 2 条结构化 report 回到 Router。
约束：≤3 轮/条，最便宜路由，记录 token。收场后断言无残留 Session、无残留锁。

**阶段 A 完成条件**：A1 改完 + A2 全绿 + A3 通过与 token 记录。→ **commit**。

---

## 3. 阶段 B · P3 事件管线

范围见 `docs/007-plan.md` §4。要点：

1. `sources/types.ts`（`Source`/`Channel` 接口，按**实例 id** 注册，不按 kind）
2. `sources/session.ts`：监听 `session/event`，只取 `user/message`，归一化
3. `sources/fake.ts`：可控的重复 / 乱序 / 失败注入（测试专用）
4. `engine/intake.ts`：过滤 → 去重 → Thread 归位 → 订阅检查 → 入队
5. `engine/eval.ts`：单 Eval/Thread、超时、requeue、Policy 版本校验
6. `engine/outbox.ts`：幂等发送、退避重试、死信
7. `engine/pause.ts`：全局暂停；暂停时只入库
8. 启动恢复：四个 reconcile（Assignment / Outbox / Eval / Queue）

**验收（缺一不算）**
- 同一事件投 3 次 → 1 条 Trigger → 1 个 Ticket
- **D2（自 P1 移入）**：同一 Thread 并发 3 条 → 只有 1 个 running Eval，其余 pending，结束后按序补跑
- 乱序到达：seq 保证时间线正确
- kill -9 后重启：未完成 Ticket 继续、Outbox 不重复发送
- 暂停期间消息入库不丢，恢复后按序处理
- 新增假 Source 只实现接口，engine 零改动

→ 三条门禁绿 → **commit**。

---

## 4. 阶段 C · P4 Watchdog

范围见 §5。要点：

1. `sessions/watchdog.ts`：`sessionQuery.readSession` 冷读，**不把会话拉活**
2. 五条判定：无进展（`stallMs`）/ 空转（连续重复同一工具调用）/ 偏离（低频抽样）/ 超预算 / 久等人
3. 四个动作：`nudge`(steer) / `steer` / `cancel`(interrupt + assignmentStop) / `escalate`
4. 每次动作写审计，含判定时的指标快照
5. 误杀防护：`report_progress` 当心跳，只认进展写入

**验收**
- 注入卡死 Worker（不再汇报）→ 阈值内 nudge，二次超时 cancel
- 注入空转 Worker（重复同一调用）→ nudge 且消息指出重复内容
- 正常跑 20 分钟、每 2 分钟汇报的长任务 → **不误杀**
- 超预算 → nudge → stop → escalate 顺序正确
- Watchdog 自己不写代码、不发外部消息

→ 三条门禁绿 → **commit**。

---

## 5. 阶段 D · P5 面板（可选，只在 A–C 都完成且剩余 ≥1.5 小时时做）

范围见 §6 与 `docs/006-panel.md`。

1. 客户端构建：复刻 `clientBundle` 预设（DSH 未发布，需自建 tsdown 配置）
2. `sidebar.panellist` + `main` 两个 slot，`ctx.slots.inject` 包裹
3. 七页 + 审批按钮
4. Host 九条路由：`ctx.connection.fetch.register`
5. 主题 token、深浅色、无硬编码色值

**验收**：侧栏出现入口、七页可切、审批写入 `approval.state`、重启后状态一致、无密钥。
**若客户端构建卡住超过 90 分钟 → 停，写清楚卡在哪，不要耗掉整晚。**

→ **commit**。

---

## 6. 停止条件（触发即停手，写报告，不许硬干）

- 需要改 `004` 的表结构
- 需要装新依赖或改 profile
- 同一门禁连续失败 **5 次**
- 文档之间互相矛盾
- 真实模型调用已达 8 次上限
- 累计 6 小时

---

## 7. 硬性禁止

- 伪造测试通过、写恒真断言、skip 掉失败的用例
- 为了让闸门变绿而删检查、放宽权限、缩小验收范围
- 在两个阶段之间留下红的三闸
- 提交 `lib/` 与 `src/` 不一致的产物
- 通宵期间无声运行——每 30 分钟必须有一行 `NIGHT-LOG.md`

---

## 8. 早上要交的东西

1. `docs/NIGHT-LOG.md`：完整时间线
2. `docs/NIGHT-REPORT.md`：
   - 每个阶段：完成 / 部分完成 / 未开始，附验收输出原文
   - 真实模型调用次数与 token 合计
   - 新增/修改的公开接口
   - 与文档的偏差清单
   - 已知问题与下一步建议
3. `git log --oneline`：每阶段一个 commit
4. 三条门禁的最终输出尾部

**段落 A 报告里必须包含 `agentPresets/list` 的原文输出**——那是今晚第一个也是最重要的证据。
