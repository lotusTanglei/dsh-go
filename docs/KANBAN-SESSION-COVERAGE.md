# 会话覆盖：默认纳入、手动排除与只读契约

更新：2026-11-21。用户在来源截图纠正“来源没有跨会话”，并明确选择 **“默认纳入，手动排除”**。本轮据此实现当前 DSH Host 普通会话的只读结构化工作汇总；不接管、激活、迁移原会话，不自动创建 Ticket。下文 2026-11-20 内容保留为当时的缺口与调查记录，不能将旧“未实现”当成现状，也不能将本轮实现外推为所有 profile/进程/机器的全量监控。

## 当前使用与实现（2026-11-21）

- 打开超管，在“其他会话的工作 · 只读”查看已有目标、当前步骤、下一步、显式阻塞和仍可回答的问题。标题只是来源标签，不拿标题冒充任务目标，不用 UUID 撑大标题。
- 系统 → 来源 → 会话工作汇总：普通会话现在和之后新增时默认纳入；“不再汇总此会话”保存持久排除偏好，“已排除”可恢复纳入。恢复只改变汇总范围，不恢复或激活 Agent。
- [SessionWorkSource](<../src/sources/session-work.ts>) 注册到既有 SourceRegistry，id=`session-work:current-host`，不接受外部规范化输入、不生成 Trigger、不能 reply。它是观察来源，不把别处历史用户消息提升为当前任务授权。
- 超管当前/归档绑定、已登记 Assignment 会话、超管角色 preset 及已知后代去重；其他 `origin=subagent` 不单列。普通 fork 不能仅凭 `parentSession` 当作子代理；非超管祖先的普通 fork 正常纳入。超管祖先的 fork 一并去重，是本产品保守归属策略，不是 DSH 对 fork 的定义。
- [runtime](<../src/runtime.ts>) 先 `listSessions` 取目录，再按归属、权限和排除偏好过滤；**排除会话不会读取工作 projection**。Host 范围由当前 persistence backend/内存目录决定；不跨 profile/机器搜文件。
- 投影只选 `title / goal / todos / agentTeam / userQuestions`。通过 `inspectSession(id, getter)` + `sessionProjections.snapshot(session, keys)` 使用安装版真实只读 API，不调用 create/resume/followup/steer/cancel/openSession。**cold 读取为计算精确投影，DSH 内部会读完整日志并 prepare，但不 publish/resume Agent**；不能称“底层不读正文”。适配器不索取 events、不将原始事件或整份 projection 下发，历史 settled 问题答案在 adapter 边界剔除。
- Goal `active/paused/blocked/complete` 是持久目标事实，Agent `running/idle` 是独立运行状态；idle 不等于完成，todo 全 completed 也不证明目标完成。`goal.blockedReason.message` 是阻塞，不自动当作等待人工。
- `userQuestions.active` 中 `open` 与 `continued` 都仍可回答；只取问题文字，不传历史答案。但该投影只覆盖 timed 问题，legacy blocking 问题及通用工具审批没有可靠的统一待决投影；没有问题不等于无需人工。界面只观察，必须回原会话处理，不能在此假批准。
- 四列看板继续仅统计已登记 Ticket。跨会话观察数不是任务数，不混入审批或 Ticket 动态；主工作区空态改为“已登记任务暂无待你决策”，不声称用户没有工作。
- 源目录和事实缓存最多15秒；预览最多6条，运行中的会话优先，再按创建时间，完整来源页每次最多20条、最多4个投影并发读取，不自动翻全页。预览不承诺已扫描全库任务/决策优先级。显示事实 `observedAt`，不拿响应时钟冒充所有投影的新鲜度。
- 页 cursor 绑定目录、归属与排除 revision；排序/成员变化要求重新同步，不静默跳页。排除时清缓存并提升 generation，旧 in-flight 读取不发布；读取后复核权限/排除。保存成功才从 UI 移除，失败保留原态并要求刷新核实，不自动重复 mutation。
- 排除只在既有 SQLite kv 保存稳定 ID，随超管状态库持久化，不改原 Session；不加 DDL、依赖、调度器或全局订阅。单页错误保留 unavailable/partial、总数未知用 null，不造 0。只读预览失败不影响主工作区/发送/审批，独立页冲突仍保留409。
- 新 POST `/session-work` 只允许 list 或精确 revision 的 set-included；复用现有 Host owner-only Fetch 与 Origin、epoch 校验，不允许 caller 提供角色、URL、路径、工具或会话控制动作。`remoteAccess.allows` 是原 Host Remote 过滤契约，在 Remote 外可为 true，**不是**本插件 owner 授权的替代品。

## 本轮验证边界

最终全量 **49 files / 585 tests、typecheck、build、pack 全部通过**，见[测试门禁](<../probes/kanban/sessions-verified-20261121-113000/test.log>)及[打包日志](<../probes/kanban/sessions-verified-20261121-113000/pack.log>)。包内容校验158项，包含Source/runtime/client/Host注入及本文，无状态库/凭据/依赖目录。首轮完整门禁只因新fallback DTO的TypeScript联合类型未声明optional revision而停止，补返回类型后整套通过，未放宽测试。

真实 SQLite 回归验证默认纳入、排除/重启/恢复、普通 fork、权限/内部子会话、只读副作用、continued 问题、不泄漏历史答案、分页与失效、旧工作区恢复。安装版 Host [受控来源回执](<../probes/kanban/session-work-20261121-112300-result.json>)仅对 probe 自建 Session 使用真实 list/inspect/selected projection 和 owner Fetch：普通/fork可见、子代理不读、排除停止读取、恢复仅成员变化、非owner/Origin403、旧epoch409、任意activate字段400、Ticket/Trigger/Assignment均0、无模型 completion。首轮探针把403纯文本当JSON导致失败，第二轮探针修复时变量重名未激活，均非产品规则失败，失败证据保留；最终语法检查后通过。

未对真实用户会话内容作全量业务验收，未修改 profile/核心、未重启当前 GUI；无 DOM/视觉/点击证明。真实运行 GUI 必须加载本轮 Host 与客户端资源后再核实；只读汇总通过不解除既有生产 Worker 安全关闭。

---

# 2026-11-20 历史调查（当时未接入）

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
