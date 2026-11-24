# Go v1 验证记录（VERIFY-V1）

日期：2026-11-25。对应工单 [#11](https://github.com/lotusTanglei/dsh-go/issues/11)、边界 [SCOPE-V1](SCOPE-V1.md) §6。

**结论：代码与自动证据已完成，v1 尚未验收。** 还差三类证据：真实 Desktop Host 探针、你本人实图+点击、真实模型调用。缺任一不算 v1 完成。

## 1. 自动门禁（当前 HEAD）

| 项 | 结果 | 说明 |
|---|---|---|
| build | 通过 | `lib/client.js` 由干净 `rm -rf lib` 构建 |
| typecheck | 通过 | `tsc --noEmit` 无输出 |
| test | **77 files / 1529 tests 通过** | 全量 `pnpm -s vitest run` |
| 隔离探针 | **18/18 通过** | `node probes/worker-isolation/run.mjs`，收据 `probes/worker-isolation/result.json`（`ok:true`，模板 digest 与 runner sha256 已记录） |
| 打包 | 见 §4 | 包内容校验在 CI 式命令中执行 |

隔离探针允许：票内写/读、heredoc、python、TypeScript 编译、`node --test`。
隔离探针拒绝：父目录、跨票、`$HOME`、`/tmp`、heredoc 外写、python 外写、延迟后台写、symlink 目录/文件逃逸、hardlink 逃逸、嵌套 sandbox 放宽；后台进程组被杀。

## 2. 已交付的 v1 能力（按工单）

| 工单 | 能力 | 自动证据 |
|---|---|---|
| #2 | 移除全部外部来源，只留会话来源 | 来源路由/配置/测试删除，门禁绿 |
| #3 | 定位→投递前确认（绑定目标+动作+正文+图片，改任一即失效） | 服务/HTTP/Fake Host/客户端四层 |
| #9 | 阶段模型真实调用（resolve→独立授权→单次 prepared call→回执+窗口披露）；locate 阶段口语意图解析 | 19 项合同测试 |
| #4 | live 受管会话投递（continue→followup / supplement→inject / steer→steer），fence 先写、未知不重发 | 单测+HTTP+Fake Host |
| #5 | 停止（interrupted/unknown/blocked 诚实三态）+ 停止后新计划 | 同上 |
| #6 | cold 会话唤醒（一次 resume、原 preset、身份/模型漂移即回滚） | 同上 |
| #7 | 图片随消息投递（能力闸 unknown=不支持、原字节 digest 校验、image blocks） | 同上 |
| #8 | 待决策接真实投影（timed 问题回答经 Host gate；legacy/通用审批标未覆盖） | 同上 |
| #10 | L1 自建票根 Agent + L2 sandbox-exec 进程树约束 + 每票工作副本 | 探针 18/18 + 合同测试 |

## 3. 未验证（v1 不能宣称完成的原因）

### 3.1 真实 Desktop Host（需要你授权在真实 DSH 里跑一次）

- 真实会话一次继续、一次停止的持久回执。
- 真实 cold 会话唤醒（resume 往返、preset 挂载、写锁冲突）。
- 真实图片到达目标会话并由模型实际看图。
- 真实阶段模型调用（真实 provider、用量、实际路由回执）。
- 真实 Worker 一次完整往返：计划确认→启动→结构化报告→结果可见。
- 真实 `userQuestions.answer` 的受理/结算时序。

### 3.2 视觉与交互（必须你本人）

- 工作概览、项目/事项、待决策、超管对话 四个视图。
- 设置里的「管理范围」「阶段模型」两个编辑页。
- 主路径窄屏一次；主题、IME、键盘焦点、console。

### 3.3 已知残余风险（已在实现处披露）

- DSH rc.5 无最终 provider dispatch 原子授权；回执固定披露授权到外发之间的窗口。
- 隔离只约束写入边界：网络不限制，读不隔离，launchd/系统服务派生的进程树外动作、信号/IPC 不在写入边界内，`setsid()` 可逃进程组 kill（但写入仍被拒）。
- 工作副本只做路径级秘密过滤，不做内容扫描。
- 探针收据是本机证据，不是密码学证明。

## 4. 复跑命令

```sh
pnpm -s build && pnpm -s typecheck && pnpm -s vitest run
node probes/worker-isolation/run.mjs
npm pack --dry-run
```

## 5. v1 完成判定

按 SCOPE-V1 §6，以下三条同时满足才算 v1 完成：

1. 本文件 §3.2 由你本人实图+点击确认。
2. 本文件 §3.1 的探针在真实 Host 上有可复现回执。
3. 本文件 §1 的自动门禁在当前 HEAD 重跑全绿。

在此之前，任何“v1 完成”“生产就绪”的表述都不成立。
