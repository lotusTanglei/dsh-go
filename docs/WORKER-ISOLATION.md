# Worker 自建启动与进程树隔离（L1 / L2，2026-11-24）

对应 GitHub issue #10。状态：**代码与自动门禁绿；真实探针已在本机通过**。真实 Host 上“计划确认 → 启动 → 结构化报告 → 结果可见”仍需人工点一次 Worker 往返（自动测试全部使用 Fake Host + 真实 SQLite，没有调用真实模型）。

## 1. L1：Worker 不再继承 Router 沙箱根

生产启动路径不再走 `ctx.subagents.startActivation({provider:'spawn'})`（该路径的 child header 继承父 Session 的 cwd，见 `docs/KANBAN-CAPABILITY.md` 的反证）。改为插件自建 Agent：

- `ctx.agents.create({ sessionId: assignment.sessionId, meta: { cwd: <票目录>, agentPreset: 'dsh-superagent-worker', origin: 'subagent', delegationDepth: 1 }, setup })`
  - 安装版 rc.5 合同：`dsh-agent/src/index.ts:410-440` 的 `AgentRegistry.create`，`CreateAgentOptions.meta.cwd` 是持久 Session header 的 `cwd`；`dsh-sandbox-policy/src/index.ts:222-230` 用 `session.header.cwd` 作为 `workspace-write` 根。因此 Host 沙箱根 = 票目录，不是 Router 根。
- `setup` 内：
  - `agentPresets.mount(agentCtx, 'dsh-superagent-worker')`，挂载后核对 `composedPreset`。
  - 追加 Host 已有的权限事件：`sandbox/mode {mode:'workspace-write'}`、`approval/policy {policy:'never'}`（即 rc.5 `setSandboxMode` / `setApprovalPolicy` 的精确持久载荷）。审批 never 在 Host 侧解析为 `rejected`，不是 `unavailable`。
  - 用 `agentCtx.tools.restrict({deny:[...]})` 尽力隐藏 Host 全局 `bash`/`pwsh`/`job_*` 工具；未挂载的名字跳过，不当作放行理由。
- 创建后核对：Agent id = Assignment sessionId、`session.header.cwd` = 票目录、`composedPreset` = Worker preset；任一不符 → 释放 handle 并 `SA_WORKER_BOUNDARY_UNBOUND`。
- 任务提示通过 `agent.followup(...)` 投递；最终 `report_result` 由 runtime 结算为同一 Ticket/Assignment 状态机（自建 Agent 没有 spawn 的 `activation.result`）。
- 失败语义：`SA_WORKER_AGENT_UNAVAILABLE`（无 create）、`SA_WORKER_CREATE_FAILED`、`SA_WORKER_PRESET_MISMATCH`、`SA_WORKER_BOUNDARY_UNBOUND`、`SA_WORKER_PROMPT_FAILED`。

恢复（`runtime.ready`）：

- 只有 `executionBoundary=verified-dir` 且以下全部成立才 `ctx.agents.resume`：kv 中存在与当前授权源绑定的工作副本记录；持久 header 的 `cwd` 与票目录一致；持久 `agentPreset` 是 Worker preset；session 不处于本 runtime 之外的 live 状态。
- 旧 spawn 产生的 Worker Session（header cwd 继承 Router 根）会被拒绝并 `stopTicket(..., 'execution-recovery-failed')`，不会绕过隔离闸继续。
- `executionBoundary=unverified` 时恢复路径与旧行为一致：运行中 Assignment 全部停止（`execution-boundary-unverified`）。

## 2. L2：每票工作副本 + 受控 shell 进程树

- **工作副本**（`src/isolation/workcopy.ts`）：从授权源目录 `git archive HEAD` 解包到 `<workRoot>/<ticketId>`，不含 `.git`/未跟踪文件；按保守路径策略排除凭据型文件（`.env*`、`*.pem`、`*.key`、`id_rsa*`、`.npmrc`、`.netrc`、`.ssh/*`、`.aws/*`、`credentials*`、`secrets*` 等）；指向副本外的已提交符号链接被丢弃；非 git 源、非单层 workRoot 子目录、临时根下的票目录都明确失败。基线 digest（排序 path+mode+内容 SHA-256）写入 kv `worker-copy:v1:<ticketId>`；契约列只存摘要，不存原始绝对路径/commit。Ticket 结束/停止**不删除**副本与产物，也不触碰用户源目录。
- **受控 shell**（`src/isolation/seatbelt.ts` / `shell.ts` / `src/tools/go-bash.ts`）：
  - profile 模板：`(version 1) (allow default) (deny file-write*) (allow file-write* (literal "/dev/null") (subpath "<票目录>"))`。写只允许票目录（含票内 `.go-runtime` tmp/cache），**不授予** `/tmp`、`/private/tmp`、`/var/tmp` 或 `additionalWritableRoots`；读不限制。
  - 子进程 env 走白名单：不转发任何 `*_KEY`/`*_TOKEN`/凭据/代理变量；`TMPDIR`/`GOCACHE`/`GOPATH`/npm/pip/XDG 缓存与 pycache 全部重定向到票目录 `.go-runtime/`，`BASH_ENV=/dev/null`，绕开用户 shell 启动文件。
  - `/usr/bin/sandbox-exec` 绝对路径、`/bin/bash --noprofile --norc -c`，`detached` 使 shell 成为新进程组 leader；命令结束/超时/abort/输出超限时 `kill(-pid, SIGKILL)` 杀整个进程组；`IsolatedShell.killTicket/killAll` 负责 stop/dispose 清理。结果带稳定失败码：`SA_GO_BASH_OK|INVALID|WORKDIR_INVALID|UNAVAILABLE|DENIED|TIMEOUT|ABORTED|OUTPUT_LIMIT|EXIT`。
  - 参数白名单只有 `command`（非空、≤100000 字节、无 NUL）；没有 cwd/env/超时覆盖入口。
  - **披露**：网络不做强制限制（结果与探针都写 `networkPolicy: 'unrestricted'`）；读不隔离；`setsid()` 脱离进程组的进程仍会被继承的 sandbox 拒绝写入，但可能逃过组 kill。承诺范围是**本进程树的写入**：通过 launchd/系统服务派生到进程树之外的动作、对其他进程的信号/IPC、网络外发不在写入边界内。沙箱只在 macOS 可用，其他平台 `verified-dir` 一律 fail-closed。
  - 工作副本是**路径策略**过滤（未跟踪文件天然不进、凭据型路径排除）；合法命名的配置文件里若内嵌明文密钥，本切片不做内容级秘密扫描，这是已知残余风险。
- **原生写工具**：Worker 的 Session 权限固定 `workspace-write`，Host `dsh-fs-sandbox` 以票目录为根；角色 guard 另外对 `write`/`edit`/`apply_patch` 的目标路径做票目录围栏（`SA_WORKER_PATH_DENIED`），并用 `SA_WORKER_WORKDIR_UNBOUND` 拒绝“Session cwd 不是绑定票目录”的旧 live 会话。

## 3. 门禁（同一判断三处生效）

- 配置：`executionBoundary: 'unverified' | 'verified-dir'`（默认 `unverified`）、`executionProbePath`（绝对路径）。
- `verified-dir` 只在：macOS + `/usr/bin/sandbox-exec` 存在 + 收据 JSON 合法 + 收据 `profile.templateDigest` = 当前模板 + 收据 `sandboxExec.sha256` = 当前 runner 字节 + 全部 18 项检查通过 + `ok:true` 时为 `allowed:true`。收据是本机可复现证据的本地回执，不是密码学证明；模板或 runner 变字节即失效。
- `startAssignment`（生产）：先判定；未验证时不写任何 Ticket/Assignment 行，返回 `SA_EXECUTION_BOUNDARY_UNVERIFIED`（带固定 `reason`）。已验证时先备副本再落 running。
- 恢复：见 §1。
- 工具 guard：`installRoleGuard` 的 `executionBlocked/executionGate` 来自同一个 decision；`go_bash` 在 runtime 与 guard 都有围栏，结束后返回 `SA_ASSIGNMENT_ENDED`。
- 健康接口新增 `executionBoundary` 与 `isolation` 固定字段（不含路径/密钥）。

## 4. 真实探针

```sh
pnpm -s build
node probes/worker-isolation/run.mjs   # 结果写入 probes/worker-isolation/result.json
```

2026-11-25 本机（macOS 27.0.1 / arm64 / Node v22.23.1 / `/usr/bin/sandbox-exec` sha256 `58839ef01b4e…`）：

- 全部 18 项检查通过：票内写/读/heredoc/python/TypeScript 编译/node:test 正常；父目录写、跨票写、`$HOME` 写、`/tmp` 写、heredoc 外写、python 外写、延迟后台写、符号链接目录/文件逃逸、硬链接逃逸、嵌套 `sandbox-exec` 放宽全部被拒且目标文件不存在；后台进程组被杀死。
- 收据 `ok:true`、`profile.templateDigest` 与运行时模板一致；`resolveExecutionBoundary` 对该收据返回 `{allowed:true, reason:'verified'}`。
- 探针失败时 `ok:false` 且退出码 1，绝不据此放行（运行时校验 `ok:true` 才开闸）。

## 5. 仍需真实 Host / 人工验证

- 真实 Desktop Host 上的一次 Worker 往返：计划确认 → 启动 → 结构化报告 → 结果可见（当前自动测试是 Fake Host + 真实 SQLite + 真实 OS sandbox，不是真实模型）。
- 真实 `ctx.agents.create/resume` 的持久化、preset 挂载与权限投影在真实 Session 上的行为（本仓库只按 rc.5 只读源码与 Fake Host 合同测试）。
- 真实 Worker 的编译/测试工具链在票目录 `.go-runtime` 缓存下的兼容性；网络未限制下的数据外发风险由用户策略承担。
- UI 仍保守显示“仅规划/执行未开放”（`workerExecution:false`）；本次未改客户端语义。
