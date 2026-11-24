# 收尾：修复 P0 安全阻断 → 提交 D → 最终验收

> 基线：`docs/FINAL-VERIFY-2.md`（2026-11-18）。A/B/C 已提交（221e47e / d81fdc6 / 9ff03eb）；D 在工作树未提交。
> 前置判定：**当前不可生产上线**。唯一 P0 阻断是 `allowWrite/denyWrite` 无执行级隔离。
> 交付给开发 agent 时整段复制。

---

## 0. 先回答你上一轮的问题

**允许提交 D，但有两个强制条件：**

1. `docs/KNOWN-LIMITS.md` 第一条必须是本次安全阻断，用词为"未解决"，不许写"后续优化"
2. `docs/RELEASE.md` 开头必须有一行：`当前状态：非生产就绪（含未解决的写入隔离缺陷）`

提交 D 本身不违反任何规则——文档不美化风险，反而让风险可追踪。提交后立刻进入第 1 节。

---

## 1. P0 阻断：写入隔离（必须先修，不许跳过）

### 1.1 现状证据（我已核实）

```text
grep permissionPresets src/    → 0 处
grep sandbox src/              → 仅 worker prompt 中一句提示，无执行约束
grep allowWrite src/           → 只在 brief/domain 与工具 schema；执行层无引用
```

`guardToolCall` 已接 `ctx.tools.guard`，但它校验的是**角色与 Assignment 绑定**，不校验**路径**。

两个实际后果：
- Worker 可用绝对路径写到工作目录外（`/tmp`、home、仓库本身）
- **跨 Ticket 写**：所有 Ticket 共用 `workRoot`，A 的 Worker 可写进 B 的目录

第二条违反 `docs/001-domain.md` §7 的"每个 Ticket 一个工作目录；禁止跨 Ticket 写"。

### 1.2 修法（两条并用，缺一不可）

**主防线：会话级沙箱**

- Worker 会话启动时绑定 write 受限的沙箱，并把 cwd 设为 `<workRoot>/<ticketId>`
- 使用 `ctx.permissionPresets.set(session, '<受限预设名>')`（先核实安装版里可用的预设名与其 sandbox 值，不要凭记忆写）
- 若该 API 不可用或不能按会话生效 → **停下来**，在报告里写清限制，不要用"提示词要求"冒充隔离

**副防线：guard 路径检查**

扩展 `guardToolCall`：对 write / edit / apply_patch / bash 的参数解析路径，要求：

```
resolved(path) 必须在 <workRoot>/<ticketId>/ 之下
且不命中 brief.denyWrite
```

相对路径按会话 cwd 解析；绝对路径按原样解析后比较。拒绝时返回结构化错误，说明"越出本 Ticket 授权范围"。

**必须写进报告的边界**：路径检查对 `bash` 只能尽力而为（`sh -c` 可绕过）。所以措辞只能是"沙箱兜底 + guard 覆盖显式路径参数"，**不许写"bash 已被完全隔离"**。

### 1.3 验收反例（四条，缺一不算过）

| # | 场景 | 期望 |
|---|---|---|
| 1 | Worker 写 `/tmp/<random>` | 失败，结构化错误 |
| 2 | Worker 写 `<workRoot>/<其他 ticketId>/x` | 失败 |
| 3 | Worker 写本 Ticket `allowWrite` 内路径 | 成功 |
| 4 | Worker 用 bash 执行越界写 | 失败（**沙箱层**，不是 guard 层） |

第 4 条是唯一能区分"提示词承诺"与"执行级隔离"的证据。如果第 4 条失败而前三条通过 → 说明只有 guard 生效，沙箱没绑上，**不许标为修复完成**。

---

## 2. 提交 D（条件满足后立即做）

1. 按第 0 节改 `KNOWN-LIMITS.md` 与 `RELEASE.md`
2. 把本次修安全阻断的结果追加进 `FINAL-VERIFY-2.md`（只增不改，不覆盖原始记录）
3. 三条门禁绿 → commit `docs: publish release and operation guides`
4. 如果安全阻断已修完并通过四条反例 → 同一提交或紧随其后的提交里更新 KNOWN-LIMITS 的状态

---

## 3. 最终验收：`docs/FINAL-VERIFY-3.md`

只写新证据，不覆盖 2。

| 项 | 要求 |
|---|---|
| 三闸 | typecheck / test / build，贴尾部 |
| 写入隔离四反例 | 每条贴实际报错或成功输出 |
| 预设零 token 闸门 | 三个 preset 无 broken |
| 清理 | `liveAgents=0`、无未处理 Trigger/Outbound、无 owner lock、端口释放 |
| 未验项清单 | 视觉、v2 源、desktop 安装，明确"需人工" |

最后写一句结论，只能是以下三种之一：
- `可交付（本地 profile）`
- `可交付，但需人工完成视觉验收`
- `不可交付，原因：…`

---

## 4. 执行纪律（上一轮的偏差必须修正）

1. **连续两次失败即停**，适用于所有条目——包括日志暂存、格式化这类辅助工具问题。
   但允许**一次等价替代**：例如日志写入因空行校验失败，可换一种等价写法，只需在报告里写明换了什么、为什么等价。替代仍失败 → 停。
2. 每 30 分钟必须有一行心跳，缺一条即视为本轮失败。
3. 每次提交前三闸必须绿；`lib/` 与 `src/` 必须一致。
4. "需人工"不许写成"通过"。

---

## 5. 停止条件

- 写入隔离的沙箱层无法实现（只剩 guard）→ 停，报限制，不许假装修复
- 需要改 DDL / 装依赖 / 碰 desktop profile
- 同一问题连续失败 5 次（每次失败必须记录现象与已试方案；等价替代限一次）
- 真实模型调用超过 4 次

---

## 6. 交付

1. `docs/FINAL-VERIFY-3.md`
2. 更新后的 `KNOWN-LIMITS.md` / `RELEASE.md`
3. 四反例的原始输出
4. `git log --oneline`（含 D 的提交）
5. 一句话：可交付 / 可交付但需人工视觉 / 不可交付 + 原因
