# 会话覆盖：当前缺口与安装版只读契约

日期：2026-11-20。依据安装版 DSH 0.2.2-rc.3 源码与超管当前实现；**不是已经接入其他会话的声明，也不是读取用户其他会话内容或接管它们的授权。**

## 用户看见的问题与当前事实

用户有进行中的 DSH 会话，而超管四列全 0。此前界面“全部任务总数”将局部台账包装成全量工作，属于统计范围误导。

- [readBoard](<../src/panel/board.ts#L28-L57>) 只读取超管数据库的 `ticket`；不按当前 epoch/session 过滤，所以已经登记的历史任务跨绑定可见。
- [SessionSource](<../src/sources/session.ts#L21-L34>) 仅接受自身绑定 Session 的直接人类消息。[runtime](<../src/runtime.ts#L343-L372>) 只为超管绑定创建该 source；[workspace.onHuman](<../src/workspace/runtime.ts#L148-L153>) 不接管普通聊天。
- 其他普通会话尚未汇总。全 0 只表示当前返回范围内没有已登记 Ticket，不能推断用户没有工作，也不能仅凭“会话未关闭”把它计作运行中任务。

本轮修复：board API 显式返回 `scope:{kind:'superagent-ledger',otherSessions:'not-included'}`；全局可见“未汇总其他会话”；没有该 scope 的旧响应显示范围未知，空态和辅助文案也不猜范围。过滤零命中、真零条、非零总数却无加载记录分别显示；动态里的已确认计划不再拼成 Ticket 总数。**没有扫描、导入、重复建票、模型摘要或会话控制。**

## 已核实的安装版契约

### 元数据目录：不读取会话正文，不激活 cold Agent

```ts
ctx.sessionQuery.listSessions(signal?: AbortSignal): Promise<SessionRecord[]>
// SessionRecord: { header, live, persisted, formatStatus? }
ctx.agents.get(sessionId): Agent | undefined
ctx.agents.list(): Agent[]
// Agent.status: 'idle' | 'running'
```

- 合并当前 Host persistence corpus 与内存 Session，返回克隆 header；`live` 指存在内存 Session，不等于 Agent 正在运行。
- Agent registry 查询不 create/resume。`running` 表示 driver 活跃（含 pre-step/drain/close/checkpoint），不等于正在请求模型或有新业务产出。
- 只能声称当前 Host/backend 的范围，不能声称所有 profile、进程或机器。
- query 是 trusted infrastructure，自身不处理 caller authorization；未来 Host adapter 必须保留 owner/范围约束、字段白名单与路径隐私。

源码：[headers 合并](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session-query/src/corpus.ts#L57-L87>)、[SessionRecord 类型](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session-query/src/types.ts#L26-L36>)、[Agent 状态语义](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent/src/runtime-types.ts#L129-L136>)、[query 权限边界](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session-query/README.md#L149-L153>)。

### 官方 Session 列表：被动但不等于最小字段传输

```ts
ctx.sessionController.list({}, signal): Promise<{ items: SessionSummary[] }>
// Client: ctx.remote.session.list({})
```

`SessionSummary` 包含 sessionId、updatedAt、agentAvailable、running、blank、origin/parentSessionId/cwd、projections。attached running 来自 registry；cold 列表只读 header/cache，不激活 Agent。缓存缺失/落后不能补成“没有任务”。

列表包含所有 summary-eligible projections，可能带 title、goal objective、Team task 文本；**没有只选字段的参数**，所以不应宣称它是严格 metadata-only API。当前无动态 Inspect，以上仅源码合同，本轮没有枚举真实用户会话。

源码：[列表 schema](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/types.ts#L153-L167>)、[列表实现](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/list.ts#L125-L194>)、[Remote list](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/index.ts#L275-L285>)。

### 不适合默认全局观察的入口

- `state/observeState` 带完整待发 queue.content；`control` baseline 带全部 live Session projections；`wait` 带 bounded assistant output。都不是 running-only 元数据目录。
- `events/search/follow` 涉及正文，不能为填看板静默调用。完整 projections 也可能对 cold 日志执行准备/校验，不是 header-only。
- `ctx.uiWorkspace.openSession` 有官方导航契约，但导航会 retain mainView，标准 Client follow 硬编码 `activate:true`。打开 cold 普通会话可能 promotion/resume Agent，不能把后台逐个打开视为被动扫描。未来来源导航仅允许人明确点击。

源码：[队列内容](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/state/controller.ts#L134-L158>)、[全 control projection](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/control.ts#L55-L73>)、[导航 retain](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/src/client/navigation.ts#L523-L552>)、[activate:true](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/client/transport.ts#L172-L184>)。

## 后续只读汇总的最窄范围（未实现）

如果用户明确要求实现，先区分观察与接管：

1. 不导入 Ticket，不改变原会话、不 create/resume，不调用 followup/steer/cancel、不启动 Worker。
2. 优先一个 Host metadata adapter，`sessionQuery.listSessions + agents.get/status`，只白名单返回必要的身份/关联、agentAvailable/running、采样时间与当前 corpus 范围；不要把原始 header/projections 整包下发。
3. 用户要的是任务/决策抽象，不是另一张 Session 管理表。已有结构化 goal/Team 等事实可以作为另行授权的只读来源，缺失就写“未提供任务摘要”，不能用模型从任意聊天正文代造任务或完成状态。
4. Goal active 是持久 phase，不是正在执行；Todo 在下一 turn/start 清空且 summary:false；Team in_progress 是任务状态，不证明 owner Agent 在运行。
5. jobs 与 subagent 目录成员独立：job roster 的 unowned 条目需按 ID 去重；subagent directory 的 activity=running 仅表示 Session 存在，不等于 AgentStatus。不能混加成业务任务总数。
6. 失败、断连、未 ready、权限拒绝、缓存缺失都保留 unknown，不以 0/idle 兜底。全会话内容摘要、正文读取、执行控制及任何接管需明确新的内容与动作范围，不能从本次询问或旧自动目标推定。

结构化契约：[Goal](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-goal/src/types.ts#L101-L137>)、[Todo 清空/不作列表 summary](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tool-todo/src/index.ts#L118-L134>)、[Team](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-team/src/types.ts#L60-L108>)、[subagent activity](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-subagent/src/list-children.ts#L119-L124>)。

## 证据边界

本轮仅阅读安装版源代码、运行自有 SQLite 测试与隔离合成 Host 探针；无用户其他会话枚举、正文/凭据读取、外部产品模型调用、profile 修改或真实 Worker 执行。UI/UX 子代理只读复核统计口径，未做浏览器视觉/IME/焦点验证。实际页面是否加载新版仍需真实 GUI 证据。
