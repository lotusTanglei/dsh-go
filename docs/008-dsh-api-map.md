# 008 · DSH API 映射（基线 0.2.2-rc.3）

所有条目均已在本机安装版上核实。`文件:行` 指 `$DSH_INSTALL_DIR/docs/` 下的文档。
标注 **[实测]** 的是我用运行中的 Electron/Inspect 直接验证过的。

---

## 1. 插件与打包

| 能力 | 符号 | 出处 | 备注 |
|---|---|---|---|
| 插件入口 | `export function apply(ctx: Context, config: Config)` | `user/develop/basic/index.md:19-31` | 函数/对象/类三种形态 |
| 依赖声明 | `export const inject = ['tools', ...]` | 同上 `:87-101` | 服务未就绪则等待 |
| 清理 | `ctx.effect(() => () => void)` | `:70-85` | 注册即 effect，卸载自动清理 |
| 配置 | `export const Config: Schema<Config>`（`@deepseek-ai/schemastery`） | `basic/config.md:23` | 不接受普通对象 |
| Bundle 清单 | `package.json` → `dsh.bundle.patch` | `basic/publish.md:33-44` | 指向 `cordis.patch.yml` |
| 激活 | `cordis.patch.yml` 中的 `- insert: [{ id, name, config }]` | `:56-62` | id 需唯一 |
| 版本约束 | `engines.dsh: ">=0.2.2-rc.3 <0.3.0"` | `:66`；本机安装拒绝 receipt | 用户确认：原 >=0.2.2 不含当前 rc.3，改为显式覆盖当前基线；不做风险豁免 |
| 加载顺序 | bundle 层 → profile patch → 家目录 patch → `--patch` | `:120-136` | 后层整行覆盖，不深合并 |

### 1.1 Desktop 安装入口（2026-11-17 补充）

用户已选择保留 Desktop，安装/配置检查使用桌面 Plugin Manager，不再要求 CLI 操作 `desktop` profile。此变更只确定入口，不授权下一次安装、修改 profile 或付费模型调用。

- **[实测]** 实际 CLI 路径为 `$DSH_INSTALL_DIR/lib/bin.js`。在当前安装版上，`plugin --profile desktop add <path>` 与 `--profile desktop --dump-config` 均退出 1，输出 `error: profile "desktop" is managed exclusively by the Electron application`。这是 CLI 入口限制，不是 bundle 加载失败或审批策略导致。
- **[实测]** 桌面 `plugin_manager` 的 `install_bundle` 已将临时 S1 bundle 安装并激活，receipt 为 `application: applied`、`packageResult.exitCode: 0`。`list_plugins` 返回该行 `enabled: true`、`fiberPhase: active`。完整操作与偏差披露见 [探针报告](../probes/RESULTS.md)。这不是原 CLI 探针通过，亦未证明 S2–S4。
- 后续 Desktop S1 验收记录管理器安装 receipt、bundle 选择与插件行激活状态；不伪造 CLI dump。仍需单独观察加载标记，以及按 P1 要求验证 SQLite 事务与 WAL。
- 不手改托管 profile，不修改任何 `@deepseek-ai/*`，不覆盖已有 preset，不放宽安全策略。

### 1.2 第三方 preset 声明（安装版契约已读；S2 运行时待验）

来源均为本机 `app.asar/dsh/node_modules/@deepseek-ai/` 中的安装版：

| 能力 | 契约 | 出处 |
|---|---|---|
| 声明 preset | bundle patch 插入 `name: '@deepseek-ai/dsh-agent-preset'` 行 | `dsh-agent-preset/README.md:28-49`；`dsh-agent-preset-registry/README.md:46-48` |
| 配置必填 | `config.id: string`、`config.plugins: Entry[]` | `dsh-agent-preset/README.md:40-48`；`src/index.ts:16-23` |
| 可选元数据 | `name?: string`、`description?: string`、`order?: number` | 同上 |
| 两种 id | Loader 行 `id` 供 patch 定位；`config.id` 才是 Session 与 `agentPreset` 使用的身份 | `dsh-agent-preset/README.md:48` |
| 前置 | Host 已有 `agentPresets` 服务；重复 preset id 会失败 | `dsh-agent-preset/README.md:84` |
| 生命周期 | 声明急切激活；已有 Agent 保留原 revision，新 Agent 用当前定义 | `dsh-agent-preset-registry/README.md:56-60,91-99` |
| 子会话选择 | `startActivation({ provider:'spawn', agentPreset:<config.id>, ... })`；独立选择仅 spawn 支持 | `docs/subsystems/subagent.md:78-86,136-140` |

最小声明形态（契约示意，不是已安装的产品配置）：

```yaml
- insert:
    - id: superagent-preset-probe
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: superagent-probe
        plugins: []
```

通过声明式 bundle 行使用已安装 preset 插件，不直接调用 registry 内部方法、不自建 registry、不改现有默认 preset。`plugins: []` 只解释配置形态，不能证明角色隔离。Preset 是能力组合，不是对恶意 Host 插件的安全沙箱（registry README:99）；S3 必须观察实际 Agent 的工具面。

## 2. 工具

| 能力 | 符号 | 出处 |
|---|---|---|
| 定义 | `defineTool({ name, description, parameters, output, execute })` | `user/develop/basic/tool.md:19-33` |
| 注册 | `ctx.tools.register(def, opts?)` | `subsystems/tools.md:662` |
| 条件准入 | `opts.when(ctx: ToolActivationContext)`，`{agent, modelSelection, signal}` | `:186-207` |
| 限制 | `ctx.tools.restrict({ allow?, deny? })` | `:664-671` | 
| 限制语义 | 作用于**继承来的**工具；自己的注册豁免；仅作用当前 scope 子树 | `:165`, `:170` |
| 审批钩子 | 工具结果 `{ kind:'ask', reason? }` → 需 `allowed-once` | `:543-558` |

> **不用 `restrict` 做身份隔离**：Router 限制自己会连带砍掉子会话（002 §3.1）。

### 2.1 探针取证用的 Agent-scoped 工具接口（安装版契约已读；未实测）

以下接口来自 `$DSH_INSTALL_DIR/docs/subsystems/tools.md`，只用于真实观测与调用，不改变角色架构：

| 符号 | 返回/语义 | 出处 |
|---|---|---|
| `ctx.tools.get(name, scope?, toolSet?)` | `ToolDefinition \| undefined`；按传入 Agent scope 查注册定义；不传 `toolSet` 只是定义检查 | `:673-683` |
| `ctx.tools.definitions(scope?, toolSet?)` | `readonly ToolDefinition[]`；scope 传真实 Agent，避免误读全局工具表 | `:704-710` |
| `ctx.tools.schemas(scope?, toolSet?)` | `ToolSchema[]`；模型可见 schema 投影 | `:712-719` |
| `ctx.tools.resolve({ agent, modelSelection, signal })` | `Promise<ResolvedToolSet>`；step-time 准入，调用者在 batch 结束后 `dispose()` | `:184-220,695-702` |
| `ctx.tools.executable(name, scope?, toolSet?)` | 不可执行时 `undefined`；无 `toolSet` 时条件注册不可执行 | `:685-693` |
| `ctx.tools.execute(input: ToolBatchInput)` | `Promise<ToolBatchResult>`；使用真实 Agent 和 executor，可在模型 step 外不传 log 执行，仍按 Agent scope 分派 | `:224-281,729-735` |

`ToolBatchInput` 的必填项是 `calls: readonly ToolCallBlock[]` 和 `signal: AbortSignal`；可选项包括 `agent`、`toolSet`、`log` 和并发上限。已读取同版 `dsh-llm/src/types.ts:111-119`：调用块为 `{ type:'tool-call', id:ToolCallId, name:string, arguments:string }`，arguments 是 JSON 字符串；`core.md:245-253` 的 ModelSelection 为 `{provider:string,model:string,reasoningEffort?:string}`。工具结果以 `ToolBatchResult.results[].result` 返回，不猜字段。

S3 必须同时检查 Router 与 Worker 的实际 Agent scope；条件准入还须结合 resolve 后的集合。S4 必须实际经过工具 executor；直接调用 JavaScript `definition.execute()` 或手写一个本地抛错断言，不算 S4。`UNKNOWN_TOOL` 是不可分派的文档语义，不是已观察到的 post-Assignment 报错，确切结果仍待探针。

### 2.2 用户确认方案 1：角色执行拒绝闸（2026-11-17）

保留 preset 组合，不用 restrict 做身份隔离。补充已读取的同版 `tools.md:458-479,526-535,737-749`：

- `ctx.tools.guard(guard:ToolGuard):()=>void` 注册作用域生命周期内的最终拒绝检查，所有 pre-execute/审批之后、工具体之前执行；返回 `undefined` 仅保持原决定，不能放行；返回 `{reason:string,info?:{name:string,code:string}}` 拒绝并保留结构化错误。不能通过后续 listener 变回允许。
- `exec.agent` 是真实调用 Agent（可缺省），`exec.name` 为工具名；使用 `ctx.agentPresets.composedPreset(exec.agent.ctx)` 的实际绑定识别角色，不信任模型参数/文本、metadata 或父角色。不认识的非 Super-agent 角色返回 undefined；无需 Agent 的普通 Host 调用不受影响。
- 共享 Host guard 每次按精确调用 Agent 判定，角色工具精确白名单来自 Config；不把 Router 的允许表沿继承链强加给 Worker。新工具默认拒绝。实际匹配到 Super-agent 角色但没有 Worker Assignment 绑定时 fail-closed；Assignment ended/旧绑定必须拒绝全部工具（包括 native bash/fs 与全局工具）。
- 闸不隐藏工具 schema，只阻止执行。面板/文档不得宣称额外全局工具不可见。已有 DSH 权限/审批/沙箱拒绝仍有效，不修改任何全局工具注册或普通会话的权限。探针先以无副作用全局计数哨兵与真实 executor 证明拒绝、隔离和清理。

## 3. 会话与 Agent

| 能力 | 符号 | 出处 |
|---|---|---|
| 会话容器 | `ctx.sessions.create(id?, opts)` —— 只有日志，无 loop | `session.md:1143` |
| 创建 Agent | `ctx.agents.create(opts): Promise<AgentHandle>` | `core.md:771` |
| 恢复 | `ctx.agents.resume({ resumeSessionId })` | `persistence.md:230` |
| 注入消息 | `agent.followup(m)` / `steer(m)` / `inject(m)` / `send(m, target, wakeup)` | `core.md:106-144` |
| 语义 | `followup` 新起一轮；`steer` 在下一步边界消费并唤醒；`inject` **不唤醒**，只在下一个 pre-step 带上 | `core.md:117-143` |
| 会话事件 | `ctx.on('session/event', (session, event) => …)` | `session.md:1426` |
| 生命周期事件 | `session/created` `session/disposed` `session/flush` | `:1377` `:1399` `:1447` |
| 日志 | append-only；`deriveMessages()` 为派生；`sessions.flush()` 为持久化屏障 | `:5` `:685` `:1215` |
| 冷读 | `ctx.sessionQuery.readSession(id)` / `observeSession(id)` | `session-query.md:425-431`, `:390` |
| 分叉 | `ctx.sessions.fork(source, boundary?, childId?)` | `session.md:1246` |
| 删除 | **无 API**，只能 `AgentHandle.dispose()` | `core.md:43-46` |

### 3.1 本地无输入探针所需的创建参数

同版 `dsh-agent/src/index.ts:66-120`：`CreateAgentOptions` 必填 `sessionId`，可选 `meta:{cwd?,agentPreset?,parentSession?,isSeeded?,origin?,delegationDepth?}`、`agentOptions`、`signal`、`setup`。**`meta.agentPreset` 只记录元数据，不自动装配**（本地首轮探针已观察）。`setup(agentCtx, agent)` 在 Agent 发布前运行；按 `core.md:623-641` 调用 `await ctx.agentPresets.mount(agentCtx, presetId):Promise<AgentPreset>` 绑定声明的 revision；`ctx.agentPresets.composedPreset(agent.ctx):string|undefined` 可读实际绑定。调用方仅使用已声明 preset，不直接 register 内部定义、不自建 registry。缺少 mount 的工具列表不算角色隔离证据。

最初的本地探针不送 followup/steer、不启动模型 turn；用户随后明确允许真实模型子会话探针。根 Router 创建时不得误标 `meta.origin:'subagent'`：实测会触发 `SubagentError(code='UNAUTHORIZED')`。安装版 `dsh-subagent/src/manager.ts:509-521` 明确拒绝没有运行时所有者的 delegated Agent；真正的 spawn 子会话由 manager 创建 lineage，不能手工伪造。

`AgentHandle.agent` 是真实 Agent，`dispose():Promise<void>` 结束并释放该 Agent。`core.md:61-75` 定义 `Agent.id/session/status/ctx`；无输入 Agent 应保持 idle。`ctx.agents.get(id)` 只读取现存 Agent（`core.md:38,55`），可用于探针清理确认。

探针注册的 Router 工具只是不产生外部消息的 `channel_reply/human_ask` 哨兵；Worker 使用已安装的 `@deepseek-ai/dsh-tool-bash`（README:28-43）与 `@deepseek-ai/dsh-tool-fs`（README:44-70）的实际注册。不运行 shell，不执行文件写入；fs 的 `read/readImage/write/edit/applyPatch` 配置均显式指定。该测试只证明所测组合，不能替代后续产品 preset 的验收。

## 4. 子会话（Worker 的载体）

```ts
ctx.subagents.startActivation({
  provider: 'spawn',            // 注册表名
  label: string,
  name?: string,                // 1-32 小写字母/数字/连字符
  childId?: SessionId,
  signal: AbortSignal,
  delivery: 'parent' | 'caller',
  cwd?: string,                 // 相对路径按父目录解析，必须传绝对路径
  agentPreset?: string,         // 需要 provider 支持 capabilities.agentPreset
  prompt: ContentBlock[],
  parent: Agent,
  agentOptions?: { provider?, model?, reasoningEffort?, maxTokens? },
  outputSchema?: ObjectJsonSchema,   // 结构化返回 → result.structured
})
```

出处 `subagent.md:31-125`、`:456`。

| 能力 | 符号 | 出处 |
|---|---|---|
| 结果 | `activation.result: Promise<SubagentResult>`，含 `structured` | `:263-289` |
| 状态 | 只有 `running` / `inactive`，**不代表完成** | `:401` |
| 后代列表 | `listDescendants(rootSessionId)` | `:566` |
| 中断 | `interrupt(id, { kind:'ancestor'|'user' })` 即发即返回 | `:538` |
| 停止单个 | `activation.dispose()` | `:69` |

## 5. 审批

| 能力 | 符号 | 出处 |
|---|---|---|
| 请求 | `ctx.approval.request(req): Promise<ApprovalOutcome>` | `approval.md:132` |
| 结果 | `'allowed-once' \| 'rejected' \| 'cancelled' \| 'unavailable'` | `:28` |
| 前置 | 请求会话必须处于**打开的 turn** 内 | `:86` |
| 策略 | `setPolicy(agent, 'ask'|'never')`、`overrideOf(session)` | `:112`, `:139` |
| 回答者 | waterfall `'approval/request'` | `:164` |
| 类别注册 | **不存在** | — |
| 审计 | `approval/asked` / `approval/decided` 只进日志，不进模型上下文 | `:11`, `:88` |

**[实测]** 本机策略为 `never` → 调用只会得到 `unavailable`。因此审批必须自建（005 §3）。

## 6. Web 面板

| 能力 | 符号 | 出处 |
|---|---|---|
| 客户端声明 | `package.json` → `dsh.client: { platform:'web', inject?, external?, immediately? }` + `exports["./client"]` | `client-modules.md:94` |
| 客户端入口 | `export const inject = ['slots','theme','locale']` + `apply(ctx: ClientContext)` | `client-ui-layout/src/client/index.ts:153-162` |
| 注册 | `ctx.slots.register(options, component)` / `registerFactory` / `inject(key, cb)` | `client-ui-renderer/src/client/registry.ts:181-209` |
| 侧栏入口 | slot `sidebar.panellist`（list / root），`{ name, id, order, label, locale }` | `client-ui-sidebar/src/client/contract/slots.ts:44-47` |
| 页面 | slot `main`（keyed / root），`{ name, key }` | `client-ui-layout/src/client/index.ts:71-75` |
| 切页 | `ctx.layout.selectPanel(id)`；只有活动 key 渲染 | `client-ui-layout/src/client/service.ts:31-36` |
| Host 路由 | `ctx.connection.fetch.register({ path, methods, requestBody, fetch })` | `client-connection/src/rpc.ts:153-176` |
| 请求方式 | 页面 `fetch(new URL(path, document.baseURI))`，Electron 走 `__DSH_TRANSPORT__` | `deepseek-chat-import/src/client/upload.ts:119-143` |
| typed Remote | **第三方不可用**：需构建期代码生成 + 客户端装配挂载 | `api-gateway.md:80-122` |
| 主题 token | `--dsw-alias-*`、`--dsw-specific-sidebar-fill`；深浅色由 `body[data-ds-dark-theme]` 驱动 | `client-ui-theme/src/client/index.ts:153-168` |

## 7. 不存在的 API（不要照着写）

| 想做的事 | 结论 | 替代 |
|---|---|---|
| 给某个 session 单独配工具白名单 | 不存在 | agentPreset 组合 / `when(ctx)` |
| 自建 `/api/<ns>/<method>` typed Remote | 不可（需生成期） | `connection.fetch` 普通路由 |
| 注册审批"类别" | 不存在 | 自建 Approval 表 + 面板 |
| 删除会话 | 不存在 | `dispose()` |
| 面板级实时订阅 helper | 不存在 | 轮询 / 自建 SSE 路由 |
| 按 URL 路由到面板 | 不存在（无 history 路由） | `ctx.layout.selectPanel` |
| 面板里改配置并持久化 | 不存在（配置在 patch 层） | 改 `cordis.patch.yml` |

## 8. 待验（见 007 §0）

- S1：指定 CLI 路径失败；用户选择 Desktop 管理器路线。安装/激活/卸载 receipt 均已证实；方案 1 探针在实际 Host 内发出 `[superagent-probe] loaded` 并记录 marker、验证 SQLite journal_mode=wal、COMMIT 可见及 ROLLBACK 不可见。产品 P1 仍须自己的 `[superagent] loaded` 证据。
- S2：**[实测通过]** 第三方声明可注册，真实 `startActivation({provider:'spawn',agentPreset:'superagent-probe-worker',delivery:'caller'})` 返回独立 child；`composedPreset` 等于指定 Worker id；模型 `stopReason:'completed'` 且输出恰为 `PROBE_OK`。
- S3：**[实测：preset 窄项 + 已确认方案 1 执行闸通过]** 真 Router 无 bash/write/edit/apply_patch；实际 spawned Worker 有 bash/write/edit/report_progress，无 channel_reply/human_ask。Host-global schema 仍可见；用户选择方案 1，真实 executor 对 Router/Worker/Watchdog 白名单外全局哨兵返回 `SA_ROLE_TOOL_DENIED`，body 未执行；普通会话前后调用成功。只证明执行阻止，不宣称隐藏。
- S4：**[实测，实际 activation 生命周期子项通过]** 真 executor 在子会话结束前调用 report_progress 成功；`activation.result` 完成后与显式 `activation.dispose()` 后均返回 `isError:true`、`error.message:'session "<id>" is not live in this store'`，没有结构化 name/code。方案 1 另用真实 executor + 探针绑定状态验证会话活着时 ended：report/read/write/edit/bash/全局允许哨兵均为 `SA_ASSIGNMENT_ENDED`，未绑定为 `SA_ASSIGNMENT_UNBOUND`，旧绑定为 `SA_ASSIGNMENT_STALE`。这是内存状态探针；P2 仍须以真实领域库绑定覆盖，不把探针内存状态等同产品状态。

方案 1 闸与 SQLite 实测见 [runtime-guard-result.json](../probes/s2-s3-s4/runtime-guard-result.json)，5 个测试 Agent 清理后 liveAgents=0、临时 bundle 已卸载。实际派发与工具表见 [runtime-activation-root-result.json](../probes/s2-s3-s4/runtime-activation-root-result.json)；先前无模型测试见 [runtime-mounted-result.json](../probes/s2-s3-s4/runtime-mounted-result.json)。命令、修正与限制见 [探针报告](../probes/RESULTS.md)。派发测试确认 `parentStillLive:false`、`childStillLive:false`、`timedOut:false`，临时插件已卸载。用户明确允许真实模型探针，不再逐次询问费用许可；不因此跳过阶段确认或改变权限矩阵。
