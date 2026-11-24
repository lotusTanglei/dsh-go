# 收尾第二轮：用会话沙箱关掉 P0 写入隔离，然后出最终验收

> 基线：D 已提交 `22ebffe`；165 测试全绿；唯一 P0 阻断是 `allowWrite/denyWrite` 无执行级隔离。
> 用户 2026-11-18 修正：**取消"同一问题连续失败两次即停止"**——诊断修复后继续，但每次失败必须记录。
> 交付给开发 agent 时整段复制。

---

## 0. 先纠正一个方向

上一版提示词让你用 `guardToolCall` 做路径检查当主防线，那是次优解：guard 只看得到**显式路径参数**，`bash -c` 绕过它毫不费力。

正确的防线在沙箱层。我已核实安装版语义：

```text
docs/subsystems/sandbox.md:16-17   workspace-write 允许写 workspace 与注册的额外根
docs/subsystems/sandbox.md:210-211 "A session cwd is its workspace-write boundary"
docs/subsystems/permission-presets.md:73  set(session, name) 写入 session 事件，覆盖部署默认
```

也就是说：**会话的 cwd 就是它的可写边界**。我们已经在给每个 Worker 设 `cwd = <workRoot>/<ticketId>`，缺的只是绑定沙箱。

---

## 1. 修复（按顺序，每步可独立验证）

### 1.1 绑定 Worker 会话沙箱

Worker activation 成功后，取到子会话并绑定受限预设：

```ts
const child = ctx.sessions.get(activation.childId)
if (child === undefined) throw new Error('worker session missing after activation')
ctx.permissionPresets.set(child, 'workspace-write')
```

注意事项：
- 必须在**子会话真正创建之后**调用（`startActivation` 返回后），不能提前
- 预设名以安装版配置表为准；`workspace-write` 是随包默认表里的键，若 `resolve` 抛 unknown，读 `ctx.permissionPresets.catalog()` 取实际键名，**不要猜**
- 若 `set` 抛错，说明该会话不接受预设（例如已经启动），此时**停下来**报告，不要静默降级

### 1.2 Router 与 Watchdog 顺带收紧

两者本来就没有写工具，但沙箱再收一层几乎零成本：

```ts
ctx.permissionPresets.set(routerSession, 'workspace-write')   // 或 catalog 里的只读项
```

如果 catalog 里没有更严格的只读项，就用 `workspace-write`，并在报告里说明"Router 无写工具，沙箱为纵深防御"。

### 1.3 guard 保留为副防线

`guardToolCall` 已有的角色/Assignment 校验不动。**可选**追加一条：write/edit 类工具的显式路径参数必须落在本 Ticket 目录内。做完在报告里标明"guard 只覆盖显式路径参数，不覆盖 bash"。

---

## 2. 验收反例（四条，缺一不算过）

| # | 场景 | 期望 | 判定层次 |
|---|---|---|---|
| 1 | Worker 写 `/tmp/<random>` | 失败 | 沙箱 |
| 2 | Worker 写 `<workRoot>/<其他 ticketId>/x` | 失败 | 沙箱（**跨 Ticket 的关键证据**） |
| 3 | Worker 写本 Ticket `allowWrite` 内路径 | 成功 | 不误杀 |
| 4 | Worker 用 `bash -c 'echo hi > /tmp/y'` | 失败 | 沙箱（**唯一能区分提示词承诺与真实隔离的证据**） |

补充记录（不是验收项，但要写进报告）：
- 网络不在沙箱管辖范围内（`sandbox.md:11` 明确只说 filesystem effects），bash 仍可联网
- `/dev/null` 等在 POSIX 下被显式放行，属预期

**若第 2、4 条仍失败** → 说明 `set` 没生效或 cwd 不是 Ticket 目录。此时记录实际 `sandboxPolicy.resolve(session)` 的 `mode` 与 `workspaceRoot`，再决定下一步，**不许把"guard 能拦一部分"当作修复完成**。

---

## 3. 最终验收：`docs/FINAL-VERIFY-3.md`

只增不改，不覆盖 FINAL-VERIFY-2。

| 项 | 要求 |
|---|---|
| 三闸 | typecheck / test / build，贴真实尾部 |
| 四反例 | 每条贴实际输出（错误信息或成功） |
| resolve 快照 | Worker 会话的 `mode` 与 `workspaceRoot` 实际值 |
| 零 token 闸门 | 三个 preset 无 broken |
| 清理 | liveAgents=0、无 owner lock、端口释放 |
| 未验清单 | 视觉、10-Ticket 成本曲线、v2 源、desktop 安装 |

结论只能是以下之一，三选一，不许模糊：
- `可交付（本地 profile）`
- `可交付，但需人工完成视觉验收`
- `不可交付，原因：…`

---

## 4. 提交

1. 代码改动：`fix(runtime): confine worker writes to the ticket directory`
2. 文档：更新 `KNOWN-LIMITS.md`（把写入隔离从"未解决"改为实测结论）、追加 `FINAL-VERIFY-3.md`
3. `RELEASE.md` 的状态行按实际结论更新
4. 提交前三闸必须绿，`lib/` 与 `src/` 一致

---

## 5. 执行纪律

- **不再按 2 次停止**（用户已修正）：同一路径累计 5 次无进展才停；每次失败必须记一行——现象、已试方案、下一步
- 每 30 分钟一行心跳，缺一条视为本轮失败
- "需人工"不许写成"通过"
- 只有第 2、4 条反例都过，才允许在 `KNOWN-LIMITS` 里把写入隔离标为"已解决"

---

## 6. 停止条件

- `permissionPresets.set` 对子会话不可用，且 catalog 里无可用受限预设 → 停，报限制
- 需要改 DDL / 装依赖 / 碰 desktop profile
- 同一路径尝试 5 次仍无进展 → 停，写诊断

---

## 7. 交付

1. `docs/FINAL-VERIFY-3.md`（含四反例原始输出与 resolve 快照）
2. 更新后的 `KNOWN-LIMITS.md`
3. `git log --oneline | head -3`
4. 一句话结论（三选一）
