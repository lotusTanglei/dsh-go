# 超管改版设计 v1 · 看板 + 单一对话工作区

日期：2026-11-18。状态：**开发设计，不是已实现/已验收声明**。本轮仅新增本设计与[完整开发提示词](prompts/KANBAN-WORKSPACE-DEV.md)，不修改产品运行代码、profile、数据库或用户原稿。

## 0. 一句话目标

> 用户只打开一个“超管”工作区：在同一界面说需求、看看板、补充要求、处理审批、拿到最终结果；后台会话由系统维护。

用户已选择[方案03：看板流转](panel-option-03.html)。该 HTML 是合成数据的布局参考，不是可用产品，也不是最终交互契约。本设计以用户使用方式推导功能，替代“七个平级页面 + 请去另一个主会话”的日常流程。

已确认的是“选看板、不要自己维护多个会话、要有清楚的交互入口”；左右分区、消息意图、接口与实施顺序是本版为落实这些诉求提出的方案，不冒称每个技术细节都已逐条获用户确认。

### 0.1 综合本次用户反馈

| 用户提出的问题/选择 | 本版必须给出的结果 |
|---|---|
| “怎么用”还需要解释很多 | 首屏有输入框、示例和明确下一步，第一次使用不需要读手册 |
| “哪个是主会话” | 普通界面不再出现主会话/Router Session术语，不要求寻找、复制会话ID |
| “不还是我去维护多个会话” | 对话、卡片、审批和报告在同一工作区闭环；后台多会话不等于用户多入口 |
| “看板最合适” | 看板为默认主视图，不再让用户在四个方案里选或七个顶级页之间找功能 |
| 其他方案不能切换 | 设计稿提供独立HTML/默认全部展开；真实产品的可点击控件必须有实际行为和反馈，不能以存在按钮或源码断言冒充验收 |
| 功能摆齐不等于好用 | 日常任务操作在卡片/详情内；健康、来源、设置放低频系统抽屉 |

### 0.2 必须撤回的旧说法

“在任意当前DSH聊天里说话，超管都会接管”**不成立**。源码只为绑定的Router创建SessionSource：[runtime](../src/runtime.ts#L277-L339)；[verify](../src/sources/session.ts#L25-L34)仅接受该session的真实人类消息。

“回到DSH聊天页查看最终回复”也不是新交互要求。新版应在超管工作区完成，而不是用新文案掩盖第二入口。

“有conversation.chat.node扩展点，所以已经能嵌入完整宿主聊天”同样不成立。现有[channel定义](../src/client/channel.ts)只渲染特定通知；完整聊天控件复用能力尚须核实。默认采用插件自有的**窄化对话投影**，不复制宿主聊天应用。

## 1. 基线、优先级与范围

### 1.1 当前实测基线

- HEAD基线为`22ebffe`；旧A/B/C为`221e47e / d81fdc6 / 9ff03eb`。实施前重查，不把固定hash当永远当前。
- [最终验收2](FINAL-VERIFY-2.md)记录165 tests、typecheck/build、真实受控stall动作链、零token与隔离fixture清理。
- 现有面板九条POST路由；任务停止/恢复、审批有真实runtime端口；配置只读。
- **未解决的P0：**Worker写入隔离。角色guard不是路径隔离，Ticket目录边界也不等于完整allowWrite/denyWrite glob策略。
- 运行中Router消失、Watchdog取消与审计之间崩溃窗口、大库扫描等限制仍见[KNOWN-LIMITS](KNOWN-LIMITS.md)；本设计不自动解除。
- 用户截图证明某个部署已显示总览，但不能据此确认当前连接页的部署版本、profile、7项视觉行为或安全修复已过。

### 1.2 本次功能范围

必须：单一工作区、可用的对话发送/历史、四列看板、明确的消息目标、任务详情、内联审批/补答、最终结果、错误恢复与持久幂等、安全反例和真实验收。

保留：既有领域状态机、Source/Channel、Outbox、角色工具、审批人类决定、Watchdog、配额和审计。界面替换不应重写Agent Loop。

不做：多租户、多人权限平台、GitHub/飞书接入、任意工作流DSL、后台会话管理器、整套IDE/终端、自动合并或默认发布、模型链式思考展示、无依据完成百分比。初版对话只接文本；附件/语音不放假按钮。

### 1.3 文档冲突处理

本版替代旧[006-panel](006-panel.md)的七页导航与交互；不撤销既有安全、不变式和数据保留规则。旧[SAFETY-BLOCK](prompts/SAFETY-BLOCK.md)与[SAFETY-BLOCK-2](prompts/SAFETY-BLOCK-2.md)的代码片段是待核实方案，不是API/安全保证。两次失败即停已由用户取消：**同一路径累计5次无进展才暂停该路径，逐次记录现象/已试方案/下一步**。DDL、新依赖、Desktop profile仍需另行明确授权。

## 2. 用户使用流程 → 功能

| 场景 | 用户操作 | 系统责任 | 成功反馈 |
|---|---|---|---|
| 第一次使用 | 打开侧栏“超管” | 自动读取绑定、模型可用性和已有历史，不启动一次空模型请求 | 出现看板、对话输入框；缺配置时在本工作区解释 |
| 提新需求 | 输入“检查登录超时”，点发送；要派新工作时选“新任务” | 可靠受理、明确消息上下文，Router澄清或派活 | 发送回执；随后澄清消息或任务卡片，不许把发送成功写成任务完成 |
| 追问/补充 | 在任务卡片点“补充要求” | 输入框显示“发送给：任务X”，不暗中送给最老的Worker | 回执关联同一Ticket，卡片更新时间 |
| 看多个任务 | 扫视四列 | 按真实状态派生，一票仅在一列 | 卡片说明当前步骤、需要谁做什么 |
| 需要审批 | 点卡片“处理审批” | 原位展开审批详情；Host做人类决定校验、CAS和审计 | 待办减少；确认后重新读状态，批准不等于已执行成功 |
| 需要补答 | 回答卡片上的具体问题 | 只解除该问题；未决审批仍阻止执行 | 同任务继续或明确仍受阻 |
| 停止 | 卡片/详情点停止，填写理由并确认 | 复用持久停止与interrupt/dispose，晚到报告不得覆盖 | “正在停止”到终态；不要仅接到取消信号就写已停止 |
| 完成 | 点击结果卡或对话中结果 | 从已验收结构化报告生成摘要，提供验收/修改/风险 | 同界面拿到结果，不要求跳到Worker会话 |
| 刷新/重启 | 重开超管 | 恢复历史/看板、重查未决请求；不重建同一Ticket | 已确认消息不丢、请求不重复派活 |

“只在一个地方交互”是交付标准，不是禁止后台存在多个Session；不劫持普通DSH聊天，不自动把用户无关对话加入超管。

## 3. 页面与布局

### 3.1 桌面主视图

```text
┌ 超管  [连接状态 / 最后同步]        [搜索任务] [待你处理 2] [系统] ┐
│                                                                │
│ SUPERAGENT 对话         │ 待处理 │ 执行中 │ 等你处理 │ 已结束    │
│ 我：检查登录超时        │ 卡片A  │ 卡片B  │ 卡片C    │ 卡片D     │
│ 超管：需要确认范围…     │        │        │ 审批1    │ 完成/失败  │
│ [任务B已创建]           │        │        │ 补答1    │ 停止       │
│ [任务D结果摘要]         │        │        │          │            │
│                        │ 点击卡片：工作区内详情侧板             │
│ 发送给：[超管 ×/任务B]  │ 概览 / 进展 / 审批 / 结果              │
│ [输入要求…] [发送]      │ 不打开第二个会话                       │
└────────────────────────────────────────────────────────────────┘
```

- 宽屏：左对话约320–420px，可折叠；右看板占剩余空间，列有最小宽度，可局部横滚。
- 卡片详情在看板区域内侧板/覆盖层打开，不遮掉整个对话输入，关闭回到原卡片与滚动位置。
- 窄屏：同一工作区内“看板 / 对话”切换，共享同一对话与任务状态；不是新聊天入口。详情全高覆盖，关闭恢复原位置。
- 不在DSH全局输入框下面新增长驻区域，不替换`main`的`conversation`键或`root`；使用插件自己的`superagent`面板键。
- 顶栏不再大面积展示“总数0/2”；优先显示连接/需处理数量。统计必须有口径和数据时间。

### 3.2 对话区

- 固定一个输入框；Enter发送、Shift+Enter换行，中文输入法组合中Enter不得误发。
- 输入目标常驻可见：“超管”或“补充给：任务标题”；选择/取消有明确操作。仅选择卡片**不自动改变**下条消息的收件目标。
- 发送过程中保留草稿；超时先查原请求回执，用原requestId重试，不自动换ID；发送成功后清空对应已提交草稿。
- 第一版显示用户文本、Router可见回复、任务/审批/结果通知；不展示system/developer提示词、reasoning、原始工具参数、全部Worker日志。
- 不用“正在思考”表示卡住；显示真实已受理/排队/执行中/响应中断，数据不可得写“状态未知”。
- 闲聊/澄清不强制建Ticket；“新任务”是人明确要求新工作，但仍须满足brief、mandate、审批与安全条件，不绕过Router决策。
- `confirm=always/when-ambiguous`所需的建单确认也在本工作区完成：展示目标/项目/范围/验收/风险，用户显式确认该版本计划后才授予对应mandate；拒绝/修改则不执行。它不是危险动作审批，不复用一个“批准全部”按钮。当前ticket_create在confirm=always返回CONFIRMATION_REQUIRED，**必须补真实确认闭环，禁止为演示把配置改成never/auto**。
- 不默认自动批准危险动作；一句“同意”不能被模型当作对任意pending approval的批量授权。

### 3.3 任务卡片

必要字段：标题、状态/原因、最近一条进展摘要、最后实质进展相对时间、需人工项、可用操作。选看板卡不是选后台会话。

默认不展示UUID、长路径、内部事件名。提供复制ID、更多信息；私有绝对路径继续脱敏，项目显示别名。预算显示`steps 12/80、tokens 4k/上限、时长`，**不能写成“任务完成42%”**。验收通过数可写`2/4条已通过`，也不推算剩余时间。

进展时间取Assignment的lastProgressAt，不取轮询时间；最后同步时间与任务进展时间分开。

### 3.4 看板列：纯投影，不改数据库状态枚举

| 列 | 映射 | 备注 |
|---|---|---|
| 待处理 | `Ticket.state=open` | 原因可为排队/待分派/安全阻断，不能统称正在执行 |
| 执行中 | `state=running` | Worker不存在或关联人工等待数据冲突时留在原列标异常/禁执行并对账，不能凭UI改终态 |
| 等你处理 | `state=waiting_human` | 区分待审批、待补答、报告阻塞；数据冲突显示“状态待同步” |
| 已结束 | `state=ended` | outcome分完成/失败/停止/丢弃/未知；已结束不等于成功 |

- **归列优先级固定以Ticket.state为准**，其他关联数据只加徽标/禁用原因，不再做一套排除条件导致无列可进。running但出现pending审批/attention时仍在执行中标“状态冲突，待同步”，同时计入需处理提示；Host拒绝危险执行并对账，不能让UI猜状态或重复放卡。
- 每票唯一归列，不能pending approval与运行任务重复计数；一个任务可有多条审批。未知/损坏state统一进入“待处理”并显示“状态异常/待核实”、禁用业务动作，给诊断入口；不能丢票或猜成完成。未知outcome留在“已结束”标未知结果。
- 无Ticket的全局审批在顶栏“待你处理”中单列，不伪造一个任务卡。
- 新请求尚未建Ticket时属于对话回执，不伪造Ticket ID/待处理卡。
- 不支持拖拽改真实状态，不将视觉位置当命令；排序/筛选可以在只读状态上实现。
- 每列独立总数、游标与“加载更多”；不能拿列表前20项当全部，不能先只取一页再在客户端分列统计。
- 搜索任务标题/ID、状态子类筛选；搜索范围/总数是否过滤后应明确。结束记录默认最近20条，历史按需加载。

### 3.5 详情与审批

详情默认“概览”：目标/范围/当前步骤/最近进展/下一步；再看进展、审批、结果。已有关联信息不能因抽屉取数而断链。

- 时间线按该Ticket查询，不能从全局最近20条再过滤导致历史假空。
- 审批展示请求类型、任务、请求者、摘要、作用范围、过期时间与payload摘要指纹；批准/拒绝理由必填。
- Host计算允许动作与原因；客户端传不传按钮都不构成授权。数据过期返回409，重读后展示已由谁处理，不能覆盖终态。
- 人工停止后的Ticket禁止原地恢复。若要再做，走“以此需求新建任务”，重新授权/新Ticket，并保留来源关联；不能暗改stoppedByHuman。
- 其他结束任务仅在mandate有效、有真实新输入、审批满足时允许恢复；不新增一条“resume成功”假回执。
- “停止任务”和“停止本轮对话生成”若都提供，必须命名区分；本版只要求真实任务停止，不放不工作的生成停止按钮。

### 3.6 系统抽屉

保留健康/来源/设置，但不再七个平级入口。系统异常顶栏提示并给“查看原因”，日常无异常不抢占看板。

健康：runtime、DB版本/主库+WAL大小、Worker使用量、Watchdog最近判定、Outbox、最近安全错误码。来源：真实健康/最后事件/暂停只读徽标，不用disabled开关伪装可操作。设置按运行/预算/监督/审批/存储/权限分组，只读；预留未接线项明确标识，不能展示成有效控制。

## 4. 消息链路与权威状态

### 4.1 一个入口、一个canonical对话绑定

- 保留现有Router为本profile下唯一canonical对话；超管工作区读写该绑定，不由浏览器提供任意sessionId。
- 普通DSH会话不被自动改preset、读取或迁移，不注册全局“接管所有消息”。后台Session仅在诊断中可看，不要求用户管理。
- 绑定附epoch（至少由当前Router ID及持久绑定版本组成）。自动恢复精确not-found时产生新epoch，旧历史保留可查，旧epoch发送返回409，先同步再由人重试。
- corruption/存储错误/显式mainSessionId缺失继续fail-closed，不能用重建清空错误历史。
- Router模型必须有来源：优先沿用现有已绑定模型；新建时可读取已核实`agentDefaultModel.currentSelection()`，不能凭空硬编码provider或把当前任意聊天的模型当绑定。create/resume的agentOptions只是fallback，不保证覆盖持久model selection；读取实际`model.current()`验证，不能透传任意浏览器agentOptions。无有效模型不接受会唤醒的发送，显示就地配置说明，不改用户默认模型/profile。
- 项目上下文不足时，在本工作区询问项目/范围并由Host校验；可以复用已核实目录选择能力，不提供假文件选择器、不凭空补路径，不要求用户自行配置Router Session。

### 4.2 有作用域的输入，不把消息塞给最老订阅

当前[intake](../src/engine/intake.ts#L33-L87)按Thread选择最早活跃订阅；只加一个发送路由会把“新任务B”误投给任务A。这是本次必须修的功能边界。

统一Command/Ingress适配器接收三种意图：

1. `message`：对超管说话/询问/澄清，默认不直接向任何Worker投递。
2. `new-task`：为这次明确新需求建立独立受理上下文，经Router确认/评估后建单，不能被现有活跃订阅截走。
3. `ticket-input`：必须显式携带目标Ticket，Host验证归属/非终态/允许动作，只投该票，禁止客户端指定Worker、Thread或Assignment。

逻辑任务Thread可以有多个，但用户看到的始终是一条统一对话投影；Thread是路由细节，不是要求用户切聊天。

- Host生成/校验受理上下文，把requestId/messageId与目标Thread/Ticket持久绑定；Router的ticket_create从**当前可信受理上下文**消费pending Trigger，不从任意全局/固定session Thread抽最早输入。
- 一条自然语言可能包含多个子任务；如拆多票，每张必须有可追溯子Trigger/Decision/mandate，子标识由Host在原请求下确定，不对同一Eval重复settle。不能为支持多票而破坏一条Trigger唯一处置的不变式。
- 单个问题的补答与scope变更要区分：扩大写范围/危险操作不沿用旧mandate直接执行，必须重新验证与确认。
- 当前`startEval`还会因任意活跃订阅拒绝新Eval，并一次claim该Thread所有pending Trigger；因此默认路径不是已经支持多任务，而是新需求可能被旧任务吞掉，未来多订阅又有最老者误路由。必须让每次新需求/子任务有明确受理范围，不把旧闲聊、并发命令合并成新授权。
- 监听`session/event`是post-commit异步emit，**不能当成已await入库屏障**；模型执行ticket_create前必须保证该次受理Trigger/目标落盘。路由与事件监听必须合流进同一个幂等入口，不能双方各建一份Trigger、各唤醒一轮。
- 可选最小实现：单次followup接收，`ticket_create`前从当前canonical Session中已经admitted的真实`user/message`做有界catch-up（共用normalize/ingest，按本轮可信命令映射限定id），await领域写入后再startEval。不能无界扫描全部历史。若选“模型启动前入库”的更强方案，必须另证明pre-step屏障及被拒绝/未admitted消息的处置，不能裸append伪造人类事件。

### 4.3 可靠发送与回执

```text
浏览器 mint requestId → Host验证owner/epoch/限额/目标
 → 幂等操作账本提交 → 单次权威followup入队
 → 确认持久inbox splice或user/message，sessions.flush=true
 → 回传accepted/queued；异步admit后共用入站catch-up
 → ticket_create消费前验证该次Trigger/作用域已落盘
 → 同一工作区读历史/结果
```

准确区分`received（Host账本） / queued（inbox） / admitted（user/message） / processing / published`。这些不是同一个阶段，也不要求用户了解内部Session。Agent的`followup(UserMessage):void`与`inject(UserMessage):void`没有Promise回执；`await`一个void不会等入库/执行。消息ID只在pending inbox中去重，不是全历史exactly-once。必须查持久splice/user事件与操作账本；`sessions.flush=false`说明没有durability listener，不能回“已持久受理”。

- POST只“受理”而非等待整轮模型生成；浏览器关闭/断网后已受理工作仍由runtime管理。
- requestId在该canonical工作区持久唯一；相同ID+相同输入返回原回执，不重建单；相同ID+不同payload或目标返回409。
- 禁止“注入一条，再followup同一条”造成两条模型输入；核实安装版Agent接收语义，只选一条权威入站链。只用inject又不唤醒同样不合格。
- 当前`side_effect`仅有表/Repo，**没有现成command journal协议**。可在现有`side_effect/kv/audit`上新增有版本的最小回执/映射协议，但必须实现唯一约束、状态机、恢复算法与测试，不得称已有能力。
- 对话正文只由DSH Session作权威持久历史。现有`detail`会脱敏，不能把需精确重放的原始body放进去再声称原样可重放。最小操作账本保存requestId、epoch、意图/目标、确定messageId、payload摘要、阶段/seq/错误及无秘密的恢复引用。正文尚未进入Session时的`received`记录不算accepted；该窗口若崩溃，在用户用原requestId重试并匹配摘要前不能凭脱敏副本代发。
- 若现有表不能满足一致性/恢复，先给新增迁移方案与回滚，**未经批准不改DDL**。
- Session日志与SQLite不是一个事务；用可重入状态、确定messageId和恢复对账解决“已收消息但未记回执”“已记回执尚未入队”。已splice但尚未admit、被拒绝或取消都不是“没发过”；不得同ID再次followup误唤醒，需明确阶段处置与补偿。不能宣称跨库物理exactly-once；外部副作用继续独立幂等。
- 回执区分：sending（客户端）、accepted（已持久受理）、queued（等处理）、failed（确定未接受）、unknown（需按requestId查证）。请求超时不等于任务失败。
- 发送纯文本最大16KiB（UTF-8），requestId规范UUID，预期同一请求内容指纹取经明确规范化的意图/文本/目标/epoch；服务端做长度与字段白名单。敏感值不进操作日志/面板回执。
- queueLimit覆盖所有会积压的分支，含paused和定向输入；停止/拒绝审批等控制命令不能因普通新任务满队列而失去可用性。不得通过扩大maxWorkers/queueLimit掩盖压力。

### 4.4 历史与最终结果

- DSH Session持久事件是对话真相，SQLite是领域状态/操作账本；不再维护浏览器本地第二份聊天数据库。
- 每条显示项有稳定id、seq/版本、时间、角色/类型、可选Ticket关联和可见安全文本。历史分页，增量读，刷新按稳定id合并不重复。
- 对话投影包含人类输入、正常助手回复、持久Channel notice；不把内部`superagent`输入上下文、worker-report JSON或工具结果裸露为用户回复。
- 人类输入投影必须覆盖`source=user`的持久inbox splice，并与后来的`user/message`按messageId合并；显示queued/claimed/admitted/rejected/canceled的真实阶段。只读user/message会让已持久受理但尚未admit或pre-step拒绝的消息刷新后消失。无法精确投影的阶段标未知，不能把不在pending当作没收到。
- 当前Worker的`report_result`只写Assignment报告；最终完成路径实际消费`activation.result.structured`并检验，再调用[deliverReport](../src/runtime.ts#L82-L86)注入Router。默认inject并不保证admit、唤醒或最终用户回复。这三个事件不能混为完成。
- 新实现必须在最终结构化报告通过既有校验/状态结算后，**不依赖下一次人类消息**把结果通过持久Channel/Outbox发到本工作区；仅先调一次report_result不算结果已结算。
- 首选从已校验结构化报告生成确定性结果摘要：任务标题、outcome、done/changedPaths的安全投影、逐条acceptance、risks/needHuman。可选Router额外总结不应成为可见结果的唯一通道。
- 报告结算与结果Outbox入队要么在同一SQLite事务完成，要么由pump扫描已结算且缺通知的报告，用确定键（如`assignmentId + resultVersion`）重建；二者选定并测试。禁止结算commit后尚未enqueue就崩溃导致永远没有结果，禁止重试创建第二条结果。
- 报告到达与最终验收区分；报告ready但存在failed/not-run不得标完成。停止后的晚报告只能作为历史，不恢复或覆盖人工停止。
- 新投递路径将Outbox sent定义为：目标Session已持久发布通知（至少flush=true）；单独`inject:void`或`SA_ENQUEUED`不够。不能为了显得成功跳过flush失败/重试。原始历史证据仍按其当时定义保留，不追溯冒称更强保证。
- sent仍不等于浏览器已显示/人已读，没有ACK不要展示已读；Outbox长期pending要能从详情看到“报告待投递/重试”，不能承诺有界必达。
- cursor绑定epoch及稳定位置，跨epoch/过期返回受控重同步，不扫描全部会话或返回其他会话数据。
- `/workspace`提供Host维护的旧绑定archiveEpoch清单；`/conversation`允许只读指定归档epoch并校验该epoch属于本超管绑定历史（只传opaque epoch，不接受sessionId）。旧epoch只能查历史/请求状态，不允许使用旧epoch授权发送/恢复/改任务；任务账本本身不随对话epoch删除，经过runtime恢复/当前mandate与归属重验后，仍可由当前epoch操作可恢复任务。与当前epoch历史分组显示，不静默拼成新对话。历史文件实际缺失时明确“不可恢复”，不造空记录。

## 5. 后端接口与分层（新设计契约，不是已有API）

所有业务路由沿用`POST /api/superagent/*`、owner-only、Origin/Host、结构化白名单、固定安全错误信息；客户端不获得Host内部Service任意调用权。新增端点是本插件设计，不是声称DSH原生存在。

| 接口 | 请求要点 | 响应/职责 |
|---|---|---|
| `/workspace`（新增） | `{}` | epoch、已校验archiveEpoch清单、绑定可用状态、模型是否可用、服务端时间、能力/禁用原因、全局待办摘要；不返回密钥/私有路径 |
| `/conversation`（新增） | `{epoch, after?, before?, limit?}`，after/before互斥 | 有界历史/增量安全投影、next cursor、接受/等待状态；limit1–100，默认30 |
| `/command`（新增） | `{epoch, requestId, intent, text, ticketId?}` | message/new-task/ticket-input；返回请求/消息id及持久接受状态，不直接成功建单 |
| `/command-status`（新增） | `{epoch, requestId}` | 原回执或确定not-found；旧epoch仅允许安全查证/引导重同步，不接受继续发送 |
| `/admission`（新增建单确认） | `{epoch, requestId, planId, fingerprint, decision}` | owner显式确认/拒绝特定计划版本，CAS后续走Decision/mandate；不代替危险审批，schema在S0/S1定版 |
| `/board`（新增） | `{column?, cursor?, limit?, query?, outcome?}` | columns全部计数、按列有界卡片及hasMore/cursor、snapshotAt；每票仅一列 |
| `/ticket`（扩展） | `{id, timelineCursor?, limit?}` | 完整详情/报告/真实任务级时间线、操作能力和禁止原因 |
| `/approvals`（扩展） | `{state?, ticketId?, cursor?, limit?}` | 按任务或全局待办，稳定排序/分页；无Ticket项也可处理 |
| `/approval`（复用加固） | `{id, decision, reason, expectedVersion或fingerprint}` | Host绑定真实人类身份与payload；终态CAS，冲突409；不信任actor字符串 |
| `/ticket-action`（复用） | stop/resume、理由及必要预期版本 | 复用runtime命令，不直写投影冒充执行 |
| `/health /settings /threads`（保留） | 既有只读契约 | 系统抽屉/诊断；不再成为七个平级顶栏入口 |

统一格式继续`{ok:true,data}`或`{ok:false,code,error:{code,message},message}`。401/403未认证/拒绝、400字段错误、404无资源、409冲突/epoch变化、429背压、503初始化/模型/安全能力不可用。超时用回执查证。

实现分层：`client`负责看板/对话/详情 → `panel/routes`负责输入校验及DTO → 窄`PanelPorts`/命令服务负责实际行为 → runtime/engine/Source/Channel负责状态/投递。不要让路由直接创建任意Agent或绕过mandate；抽出公共命令路径，避免面板、工具与恢复循环各写一套规则。

### 5.1 已核实的DSH能力与尚未证明的事

本轮Inspect已核实（安装版，2026-11-18）：

- Client `main`是keyed/root，注册`key`，已占`conversation`；可保留自有`superagent`，不可替换宿主聊天。
- Client `layout.selectPanel`是导航，不是嵌入聊天组件；`uiWorkspace.openSession`会打开会话，不符合日常无切换目标。
- Host `sessionQuery.readSession/observeSession`可按精确会话冷读/观察；lease必须释放，轮询替代也应有界且停页停止。
- `agentDefaultModel.currentSelection()`可读取当前默认选择；是否配置有效要在真实Host验证。
- `permissionPresets.catalog/resolve/set(session,name)`存在；`sandboxPolicy.resolve({session})`的cwd边界与额外根等可读。
- `subagents.startActivation`返回带childId/result/dispose的activation。**返回之后再set沙箱是否早于第一次工具执行，尚未证明**。
- `session/event`为post-commit fire-and-forget，不能依赖观察者执行完成再开始模型。

Inspect目录并非业务Service；开发时再次查准确签名、事件模式、配置、主题、Slot props，不把方法名想象成可直接从Client调用。当前没有足够证据保证可复用完整宿主Conversation组件、原子命令接收、流式浏览器推送或完整shell glob限制；必须在实现阶段先补证明。

## 6. 安全：分开验收两层，禁止“换皮即修复”

### 6.1 L1 Ticket目录隔离

- 每Worker cwd固定为其Ticket目录；输入目录不能用prefix字符串判断，校验规范化/真实路径/符号链接与跨Ticket。
- 启动、恢复、重试每一次都必须在首次可能执行工具**之前**完成权限绑定；无法证明时默认拒绝执行，不留启动竞态窗口。
- catalog核实受限preset，检查有效mode/workspaceRoot、额外全局根/授权根、升级路径；不得以danger-full-access启动后“尽快改回来”。
- bash/job后台进程权限必须受同一边界并随任务停止收敛。只拦write/edit，不拦shell真实副作用不算通过。

### 6.2 L2 allowWrite/denyWrite逐路径授权

- L1允许Ticket根内写，不代表`allowWrite=['src/**']`时也允许写Ticket根内`private/x`。必须分别证明：命中白名单可写、未列不许写、deny优先。
- native文件工具可用guard检查显式路径；shell不能用字符串parse或只匹配`> /path`冒充完整约束。
- 当前inspect的沙箱仅mode/目录根语义，未提供glob拒绝表达式。若无覆盖任意shell/后台进程的强制能力，必须出具体方案/所需授权，标记L2未解决；不把L1四反例通过当全部P0消失。
- 不准为“测试通过”删除bash能力、禁掉构建测试、只跑stub，或以提示词承诺代替执行边界。
- 执行仓库副本/隔离工作树与原repo的映射必须明确：本版不自动把workdir产物写回原仓库、不自动merge/push；输出diff/产物供验收，范围扩大与合入另走授权。不能把读写原仓库的原有行为静默改名为安全沙箱。

### 6.3 人类授权、隐私与释放

- 浏览器owner身份由认证链确认，模型输出不能调用“人工批准”路由；`trust/role/actor/sessionId/assignmentId`不从请求体信任。
- model-authored风险文本不得自动批准；chat消息“同意”不能代替显式审批ID+内容+理由的确认。
- 写Ticket外按既有安全规则直接拒绝，不提供“批准即可扩大到home”的按钮。网络不受仅filesystem沙箱保证，需如实保留边界。
- 不渲染任意HTML/脚本/外链；安全Markdown或纯文本；secret/private URL/用户路径不进公开历史、面板、审计和诊断包。执行契约中的合法路径与展示脱敏分层，不得为脱敏破坏实际repo路径。
- **Client切页/关标签**仅释放该页面轮询/观察lease、事件订阅、尚未受理的请求及焦点锁；已受理的后台工作继续，不能因客户端卸载取消任务。
- **Runtime/插件或验收fixture销毁**才负责停止自有Worker、等待dispose/drain、释放锁和临时监听资源；不能误停其他会话或用户正常服务。

## 7. 失败、加载与无障碍

| 情况 | UI行为 |
|---|---|
| 初始化中 | 骨架+“正在连接超管”，不显示正常/零任务 |
| 空看板 | 解释暂无任务，输入框可直接描述需求；不创建演示任务 |
| 首次无模型/项目上下文 | 同界面明确缺什么；只读看板仍可读；不让用户去找Router会话 |
| 网络/Host失败 | 保留最后成功数据、标过期及最后同步时间，显示重试；不清空成0 |
| 发送超时 | 保留草稿与requestId，先查回执，禁止重复建单 |
| Router busy | 回执排队，输入不丢；不是一直转圈至整轮结束 |
| 绑定消失/epoch变化 | 同工作区重连提示；原历史不抹除，不把旧目标发送给新Router |
| 服务能力缺失 | 能力位/原因，真实disabled，不放空点击按钮 |
| 多标签审批竞争 | 一次决定成功，其余显示已处理/冲突，不能覆盖 |

主题用已inspect的DSH tokens；中英i18n；状态不用仅颜色区分。列与卡片语义标签、键盘到达、详情Escape/焦点返回、审批理由label、aria-live克制播报。窄屏不让输入框挤出、不用整页横滚；列滚动与对话滚动独立。

## 8. 验收矩阵（实现后逐条给证据，不能现在勾过）

| ID | 必须证明 |
|---|---|
| UX-01 | 首次只打开超管，一次文本提交能创建真实任务；不要求选择Session或去别处聊天 |
| UX-02 | 在同一界面补答/审批/看结果，关闭详情仍保留草稿、滚动位置和任务目标 |
| MSG-01 | 相同requestId连点/多标签/超时重试只受理一次；改payload同ID409 |
| MSG-02 | 主输入new-task不被活跃任务吞掉；A/B并行时ticket-input只投指定票 |
| MSG-03 | Router开始建单前Trigger已提交；注入/监听/补偿不双重唤醒或双建票 |
| MSG-04 | 收消息/写回执/唤醒各窗口崩溃可对账；queued/claimed/rejected输入刷新仍在；报告结算与Outbox窗口不丢/重复结果 |
| MSG-05 | requestId/epoch无串会话、外来sessionId被拒绝；corrupt不自动新建假恢复；旧epoch经验证只读，不能发送 |
| RESULT-01 | Worker报告后没有新用户消息，用户仍在同工作区收到唯一结果摘要 |
| RESULT-02 | failed/not-run/blocked/停止晚报告不得变completed；无已读ACK不写已读 |
| BOARD-01 | 四列映射含open/running/waiting_human/各outcome/未知；一票一次，数量全量不是首屏样本 |
| BOARD-02 | >100条、并发变化时游标/去重/重新同步正确；任务级旧时间线不被全局20条截断 |
| ACTION-01 | 停止等执行收敛，旧Worker再调工具拒绝；人工stop无原地resume |
| ACTION-02 | 多审批/过期/竞争/拒绝/未决下补答/模型注入均fail-closed；人类决定可追溯 |
| ACTION-03 | confirm=always/when-ambiguous在同工作区确认计划/拒绝/改计划/旧指纹冲突；不改默认策略绕过建单确认 |
| S1 | native写Ticket外、其他Ticket、symlink逃逸被拒绝；允许路径可成功 |
| S2 | 真实bash/python/node/heredoc/后台任务越界写均受沙箱，非stub无文件变化 |
| S3 | 同Ticket内allowWrite外、denyWrite路径的native与shell写被拒绝；allowed可测试/构建 |
| S4 | startup/resume/retry首次工具前已绑定；额外roots/权限升级不偷偷扩大范围 |
| SAFE-01 | shell网络边界如实说明；HTML/XSS/SQL/超长body/secret/path不会越权或泄漏 |
| REL-01 | 正常/paused/subscription背压、maxWorkers、时钟回拨、只读DB、活锁、orphan无回归 |
| BUILD-01 | pnpm typecheck/test/build，使用支持node:sqlite的已验证Node；lib/src一致 |
| LIVE-01 | 实际Host路由owner认证/Origin、3preset无broken、真实client bundle当前factory，0token gate |
| VIS-01 | 真实GUI明暗/中英/宽窄/中文输入法/键盘/错误恢复/审批/结果；无console slot crash |
| CLEAN-01 | 所有自有fixture agents0、非终态Assignment0、pending/evaluating Trigger0、running Eval0、pending Outbox0、无owner lock/残留端口 |

每项记录实现commit、自动/人工/不可验、原始证据、限制。静态HTML与源码grep不是视觉或真实shell隔离证据。没有浏览器控制就保留人工清单；仅当没有未解决执行安全阻断且功能/后端验收齐全时，才可报告“工程闭环完成、视觉待人工”，不能写生产验收全过。

## 9. 从现状到完整交付的实施顺序

1. **S0 真能力/安全前置**：准确API/Slot/模型/收消息语义核实；验证L1首次执行前绑定与L2可实现边界；记录可行/不可行。需要DDL/依赖/核心改动先申请，不擅自降级。
2. **S1 后端纵切**：命令作用域、持久回执、canonical历史、可靠入站、结果Channel；离线+真实小fixture先跑通“发→建票→报告→看结果”。
3. **S2 看板与单对话工作区**：替换七页日常入口，四列/对话/侧板/系统；真实DTO，不用mock挂到生产。
4. **S3 控制与恢复**：内联审批、补答、停止/可恢复、新任务隔离、多标签、断网/重启、容量与后台清理。
5. **S4 验收交付**：全矩阵、三闸、有限真实请求、GUI人工项、UI/UX独立复核，新增验收报告，更新风险/发布说明再提交。

阶段不是可丢弃功能的菜单；完整目标是纵向闭环。安全不可实现时暂停受阻执行路径并报告，不伪装修好；可独立的只读/交互工作可继续，不擅自开启真实写入。提交只包含本次改动，不覆盖用户修改的旧提示词/安全稿/HTML参考。

## 10. 完成定义与下一步

- **功能链路实现/部分完成**：交互和后端链路已有证据，但L1/L2安全或其他强制实现门禁仍不满足时，只能使用此口径，并写不可交付原因。
- **工程闭环完成**：单一工作区真实端到端可用、功能与错误恢复有证据、全部实现阶段与L1/L2强制执行安全门禁完成且打包通过；可以明确保留真实视觉等人工未验项。存在执行安全阻断时不得用此词避重就轻。
- **生产就绪**：另须L1/L2执行安全、真实GUI与必要运行验收通过；只改善导航不满足。
- 若L2受安装版能力约束，不得把“看板做好”或L1已过写成生产可用。交付要明确差哪项、所需决策与最小后续方案。

使用[完整开发提示词](prompts/KANBAN-WORKSPACE-DEV.md)继续实施。该提示词要求做完全部可授权范围，不授权改DSH核心、安装依赖、改DDL或操作Desktop profile；这些影响必须先明确申请。