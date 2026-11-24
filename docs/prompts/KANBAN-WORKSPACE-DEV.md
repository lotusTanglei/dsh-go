# 完整开发任务：超管看板 + 单一对话工作区

> 将本提示词作为开发任务下达后执行。目标是**端到端开发、测试、验收与交付**，不是再写一份计划，也不是只换HTML皮肤。当前这次文档编制不启动执行。
>
> 配套规格：[KANBAN-WORKSPACE-DESIGN v1](../KANBAN-WORKSPACE-DESIGN.md)。视觉方向已由用户选择：[方案03 · 看板](../panel-option-03.html)。用户不接受自己维护多个后台会话；只维护一个超管入口。
>
> 不允许宣称已经完成不存在的能力，不允许为完成任务绕过安全、审批、构建或数据保留门禁。

## 0. 最终用户应该如何使用（先按这个做，不按数据库表摆页面）

1. 在DSH侧栏点“超管”，同一工作区看到**对话区 + 四列看板**。
2. 直接输入需求、选择“新任务”或询问超管；无需知道主会话/Router/Worker ID。
3. 多个任务同时运行时，仍在这里看进度；点击卡片“补充要求”后输入框明确显示目标任务。
4. 在当前工作区回答问题、查看影响范围、批准/拒绝、停止任务，不切换到后台会话。
5. 最终结果出现在当前对话及任务详情；刷新仍在；没有下一条用户消息也要送达结果。
6. 健康/来源/设置是“系统”低频抽屉，不和任务并列成七个顶级页面。

后台Router/Worker/Watchdog允许多个Session，但不向用户摊派维护负担。不能偷换成“你仍要在普通DSH聊天输入、另开超管看状态”，也不能劫持所有普通DSH聊天。

## 1. 基线与开工检查

工作区以`pwd`为准；本项目预期`/Users/dundundebaba/sync/dsh-s-p`。已知基线HEAD `22ebffe`、165 tests/typecheck/build通过，A/B/C提交`221e47e / d81fdc6 / 9ff03eb`；**开工必须重查**，已知数字不是免跑门禁的理由。

依次：

1. `pwd`、`git status --short`、`git log -5 --oneline`；有用户dirty/untracked就列清保留，不reset/clean/覆盖，也不因非冲突dirty假装不能做事。
2. 读配套设计、[最终验收2](../FINAL-VERIFY-2.md)、[已知限制](../KNOWN-LIMITS.md)、[安全提示2](SAFETY-BLOCK-2.md)、原[安全提示](SAFETY-BLOCK.md)；领域/流程/持久化按需查[001](../001-domain.md)/[003](../003-flows.md)/[004](../004-persistence.md)。
3. 注意用户已修改过`CLOSE-OUT/DEV-ALL/NIGHT`，还有两份未跟踪安全稿和HTML稿。它们是用户资料，不擅自改、移动、纳入提交；新成果用明确新路径。
4. 跑实际Node/pnpm环境，支持node:sqlite；`pnpm run typecheck`、`pnpm run test`、`pnpm run build`保存完整原始输出与退出码，用`set -euo pipefail`，禁止用tail掩盖前段失败。
5. 建`docs/PROGRESS-KANBAN.md`，写真当前时间/基线/下一步；每30分钟内真实心跳，暂停/等用户明确记录，禁止回填虚构时间。
6. 需要长时自动续做时创建/恢复当前任务goal，目标是完整闭环；不得在只完成UI或方案时mark complete。人工不可验项按设计诚实单列，不强行伪造。

### 指令优先级

- 用户最新指令高于旧提示词；本轮已取消“两次失败即停”。准确纪律：**同一路径累计5次无进展才暂停该路径**，每次记录现象、证据、已试方案、下一步；与产品Watchdog重复调用阈值不是一回事，禁止修改产品阈值来套开发规则。
- 本提示词+配套设计替代旧七页日常导航/主会话交互说明；不取消既有安全、不变式、数据保留、提交门禁。
- 旧安全稿`set(child,'workspace-write')`等片段必须以安装版合同/生命周期实证复核，不照抄成安全结论。

## 2. 允许做什么，什么需要另行确认

本提示词被用户作为开发任务下达后，允许：

- 修改本bundle内必要的源码、测试、locale、构建适配及新增报告；复用现有依赖和扩展点。
- 隔离`superagent-dev`进行受控验收，不触碰生产数据；使用自有临时目录/合成输入。
- 实现看板、对话可靠发送与投影、任务定向、审批/停止/结果回写、当前安全边界验证及必要修复。
- 每个可交付阶段在三闸绿且打包成功后提交；不自行push。

必须先报告并取得明确授权：

- 新/改DDL或数据迁移；**禁止改已发布m001**。先解释为何现有表不能满足、影响、备份和回滚。
- 新装依赖、改DSH安装包/核心、改运行profile包清单或patch、Desktop安装/启停插件。
- 需要削弱权限、提升沙箱、扩大可写根、突破原先任务写入范围的做法。
- 已有用户dirty文件与必须修改范围冲突时，先说明如何保留，不覆盖后再解释。

本次不做外部源、多租户、通用工作流、终端/IDE、自动发布/合并、附件/语音、任意会话选择器或整套宿主聊天复制品。

## 3. 按以下顺序连续实现，禁止只完成一层就收工

### S0 · 先核实能力、安全与生命周期（没有证明不要开真实写入）

1. 加载`dsh-doc`；先`cordis_inspect_list`，再查准确Service/Event/Slot/Theme合同。Inspect方法不是业务调用。看不到的API读安装版源码，不猜名。
2. 复查Client `main` keyed、侧栏入口、现有`superagent`键；保留宿主`conversation`，不替换`root`、不往document.body挂第二个应用。
3. 复查Host Agent发送/模型/Session持久化、session/event模式、subagents创建时机；现有已核实要点：
   - `followup(UserMessage):void`会排队并唤醒；`inject(UserMessage):void`不唤醒。`await void`不是接收/落盘/执行屏障。
   - inbox只拒绝**当前pending队列**同messageId，不提供全历史幂等。
   - `session/event`是post-commit fire-and-forget，SessionSource还异步处理；不是Trigger落盘屏障。
   - `sessions.flush(session)`必须返回true且成功，才证明有durability listener参加；false不可说已持久。
4. 模型选择使用canonical Router实际model.current或已配置default，Host验证provider/model/effort；create/resume agentOptions仅fallback，不透传任意浏览器agentOptions、不擅改用户默认/profile。
5. 写入安全分L1/L2验：
   - L1：首次工具前绑定有效Ticket目录沙箱，含恢复/重试/后台进程；检查preset catalog、mode/root、额外roots和权限升级路径。
   - L2：同Ticket内allowWrite以外/denyWrite不可写，native+shell都算；目录workspace-write只保证L1，不等于逐glob。
   - 不以activation返回之后set就声称无竞态；工具可能先跑，必须证明或在可执行前gate住。
   - 保留正常bash测试/构建能力，不用删bash、禁执行、stub拒绝、正则解析shell命令冒充执行级安全。
6. 若安装版无法完成L2或需要核心/依赖/迁移，给具体反证与可选方案，不擅自放宽。暂停受阻执行路径，仍可继续不依赖该能力的只读/工作区实现；最终必须保留发布阻断。

产出：`docs/KANBAN-CAPABILITY.md`，列已核实API、已运行反例、未证明项、实现选择及需要授权的事项；有具体证据后再进入真实写入验收。

### S1 · 后端纵向链路：可靠发送 → 正确目标 → 结果可见

先读`runtime.ts`、`sources/session.ts`、`engine/intake.ts`、`engine/eval.ts`、`engine/outbox.ts`、`sessions/worker.ts`，明确现有不变量：

- 唯一绑定mainId，不是任意DSH聊天；普通消息不能被全局接管。
- 同Thread active subscription会阻止startEval建新票；intake可能把后续消息给最老活跃Ticket；startEval还一次claim所有pending。**必须改这一层路由，不只是加输入框。**
- 当前report_result只记报告，最终结算消费activation.result.structured；deliverReport默认inject，不能保证人可见结果。

实现设计§4、§5接口：

1. `/workspace`：canonical绑定epoch、可用性/模型状态、能力及禁止原因。无模型/初始化失败就在当前工作区显示，不让用户找后台Session。
2. `/command` + `/command-status`：Host验证owner/Origin/body/epoch/限额/目标；固定`requestId`+payload摘要冲突409。
3. 明确`message / new-task / ticket-input`三意图。message发给超管，不隐式偷投Worker；new-task建立独立受理范围；ticket-input只发明确且经Host验证的Ticket。客户端不能指定sessionId/actor/role/assignment/thread来伪造权限。
4. 把受理→目标映射→Trigger消费归到一个命令服务，工具/路由/恢复共用。Router ticket_create只消费当前可信受理上下文，不混并发输入/旧闲聊；一需求拆多票要有确定子Trigger/Decision lineage，不能重复settle一个Eval。补设计`/admission`所述建单确认：confirm=always/when-ambiguous下在当前工作区确认特定计划/指纹后走合法Decision/mandate，拒绝/改计划/过期版本不启动；禁止把confirm改never或acceptMode改auto来让演示通过。建单确认与危险动作审批分开。
5. 持久journal不是现成能力：`side_effect`只是表/Repo。若复用，设计有版本状态/唯一约束/seq/失败/恢复。detail会脱敏，不能当原始消息重放库。不得复制完整聊天数据库。
6. 唯一入站链优先使用Host构造真实UserMessage后**单次followup**；不可inject再followup相同消息、不可裸写user/message假事件。ticket_create前做有界/当前命令ID范围的真实admitted user-message catch-up，共用normalize/ingest并await。若选择更强pre-step同步屏障，先验证真实pre-step生命周期，处理claimed-but-rejected。
7. 回执分received/queued/admitted/processing/published；unknown需查证；只flush=true后给持久accepted。关标签不撤回已受理工作。只查pending inbox不足以重试；对账持久splice/user事件，不能给已admitted消息再followup。
8. `/conversation`只投影canonical可见人类/助手/Channel消息，稳定ID/序号、epoch游标、分页/增量、安全文本；人类消息包含持久inbox splice，并按messageId合并后续user/message，queued/claimed/rejected/canceled不能刷新丢失。不显示内部report JSON、system/developer/reasoning/原始工具参数，不读取无关会话。`/workspace`给Host校验的archiveEpoch清单，仅能只读查本超管旧绑定，不能接受客户端sessionId或给旧epoch发送。
9. 最终结构化报告通过既有校验和结算后，生成确定性结果摘要，经Channel/Outbox在同一对话发布；不依赖Router再次总结或下一条人类消息。报告结算与结果enqueue同事务，或pump按确定`assignmentId+resultVersion`补偿扫描缺失Outbox；崩溃不丢/重发结果。审批/补答通知也可关联任务。
10. sent改为至少目标Session已flush持久发布，不能仅await inject(void)；sent仍不是浏览器ACK/已读，pending长期重试要可见。
11. 跨Session日志/SQLite不是一个事务；逐窗口证明恢复，不宣称物理exactly-once。外部副作用另做幂等，不因UI请求ID就推定全链安全。

接口新增/扩展必须保持owner-only POST、字段白名单、参数绑定SQL、固定错误码与无秘密日志。正文16KiB、UUID requestId、limit1–100、429/409/503按设计；新对话不能绕过paused/queueLimit，但停止/拒绝审批等控制动作不被普通任务队列饿死。

先用真实SQLite+fake activation贯通，再用一个自有最小真实Host fixture证明发/建单/结果；不得先堆UI后发现入站路线不成立。

### S2 · 看板与单一对话工作区（真正接后端）

1. 以方案03为布局参考，进入超管默认四列：**待处理 / 执行中 / 等你处理 / 已结束**。源state/outcome映射见设计§3.4，异常state进待处理标异常禁动作；结束区分completed/failed/stopped/dropped/unknown。
2. 左对话、右看板，详情在看板区域侧板；窄屏同一工作区内看板/对话切换，保持同一绑定、草稿和选定任务。不要求用户跳回宿主聊天。
3. 顶部搜索/最后同步/连接/待办/系统，不显示裸UUID活动墙、不放大而无行动的0/2卡片。
4. 主输入“发送给超管”常驻；“新任务”明确意图；只有点“补充要求”才切目标并显示可取消target chip。点开卡片本身不隐式改变输入目标。
5. 发送草稿与原requestId保留，IME组合Enter不发送；支持Shift+Enter；超时查回执再原ID重试，不换ID重复建单。
6. `/board`按服务端列投影计数/分页，不从一页20条中假统计全量；>100条、并发变化也不丢票/重复归列。任务级时间线独立查询，不从全局20条过滤。
7. 卡片显示真实实质进展，不把token用量/轮询次数/经过时间当完成百分比；budget与acceptance覆盖率明确分开。
8. 最终结果、审批、补答均可在对话/卡片打开，动作走真实端点；没有实现的业务操作不放空onClick。
9. 系统抽屉收纳健康/来源/只读设置，预留未接线项明确标记；不新增配置编辑器或危险全局权限开关。
10. 生产CSS只用已核实DSH tokens、中英locale、宿主React、现有构建。HTML稿可固定色值，不能原样带入运行插件。避免巨型单文件新增所有逻辑，按现有build-client自包含约束做可维护模块并验证打包无闭包丢失。

### S3 · 人工动作、失败恢复和安全回归

- 审批：原位看影响范围/摘要指纹/到期，批准/拒绝理由必填、二次确认；Host真实人类身份、payload绑定、终态CAS，多标签冲突409。
- **“继续/同意”聊天不是自动审批**；补答不能越过未决审批，model/report/source注入均不能伪造人工授权。业务审批不授权改变DSH profile/沙箱，也不能放行写Ticket外。
- 停止：先展示正在停止，真实interrupt+持久停止+dispose；旧Assignment晚报告不覆盖；人工停止不原地resume。若实现“以此需求新建”，必须真新Ticket/新授权，不放假按钮。
- 恢复：只对允许恢复的终态票，在mandate/新输入/审批/安全能力满足时执行；不能仅更新前端卡片。
- Client卸载只释放轮询/lease/订阅/焦点/未受理请求，**不能取消已受理后台任务**。Runtime/fixture销毁才停止自有Worker并清理。
- 冷重启/消息受理中断/已splice未admit/flush失败/结果投递失败/绑定epoch变化/DB只读/活锁/orphan逐项可诊断。明确未知，不造假正常/零值。
- 安全使用合成目录，native及shell越Ticket/跨Ticket/符号链接/同Ticket未授权/denyWrite反例与allowed成功都要测。含shell间接脚本、heredoc、python/node、后台进程；不止工具guard stub。
- 原Watchdog nudge→cancel→escalate、预算/配额、schema报告、路径保真、日志redactor、幂等Outbox不得退化。旧20分钟反例引用已有证据，不冒称新真实长时运行。

### S4 · 最终验收与交付（全部跑完，不在“UI好了”处停）

建立`docs/KANBAN-ACCEPTANCE.md`，逐项填写设计§8的ID，不覆盖旧FINAL-VERIFY系列。证据放`probes/kanban/`，每次独立命名，禁止复用陈旧passed回执。

必做证明组：

1. **正常闭环**：从超管输入→确定目标→建Ticket→Worker→结构化验收→同工作区唯一结果，无用户再发一条才能显示。
2. **多任务**：A执行时新建B，B不进A；对A补充只进A；含相同正文不同requestId、同requestId并发重试、body变更冲突。
3. **崩溃/恢复**：journal前后、inbox前后、claimed后pre-step拒绝、admit前后、flush失败/false、报告结算但未enqueue；重启不重复建单/误唤醒，queued等历史与回执阶段正确，旧epoch只读归档可校验。
4. **看板**：所有state/outcome/未知、>100条/每列计数与分页、旧任务时间线、筛选/详情/草稿/目标保持。
5. **人工动作**：建单确认always/歧义确认/拒绝/改计划/旧指纹冲突；补答/多审批/过期/双标签竞争/停止竞态/晚报告/禁止人工stop恢复/模型自动批准拒绝。
6. **安全**：L1与L2分别实证；capability/race/额外根/真实shell/合法测试构建/非目标会话不受影响；若未过如实阻断。
7. **UI**：深浅主题/中英/宽窄/键盘/IME/焦点恢复/网络错误/无console Slot crash；一次独立UI/UX审查。
8. **三闸**：typecheck、全量tests、build exit0，支持node:sqlite运行时，src/lib一致；不可只贴最后几行成功掩盖前面失败。
9. **真实Host零token**：3preset无broken，真实owner-auth路由/Origin，client resource含当前factory、Slot数量与i18n；默认不唤醒模型。
10. **清理**：仅自有fixtures，agents0、pending/running Assignment0、pending/evaluating Trigger0、running Eval0、pending Outbox0、owner lock无、临时端口释放；保留历史/备份/sentinel，不误关用户服务。

使用实际已连接GUI验收；无浏览器控制则只做源码/构建/真实Host端口等可验证项，并交人工步骤，**不可用自制DOM/截图/假React替代**。不启动另一个服务器假装更新当前GUI，不许为取截图搜用户token/cookie/browser profile。client热更新是否可用以真实watcher/安装版本为准，不能口头承诺刷新就一定是新包。

真实模型仅用于最小验收，不作为调试默认动作：建议本轮明确预算最多4次provider请求，先用离线/0token；到上限前报实际requests/usage并申请继续，不把上限当必须花完。任何未获当前执行授权的真实模型/配置操作先确认；协作代理推理调用与产品验收provider请求分开记账。

## 4. 提交纪律与团队分工

- 按S0→S1→S2→S3→S4依次推进，不中间等“你说继续”才做剩余普通授权功能；实质权限/范围阻断除外。
- 阶段可独立提交，但**每个提交前typecheck/test/build必须绿，且打包成功**；不提交未读diff、不全量stage用户dirty文件、不自行push。
- 可并行：只读API/安全调查、独立测试、UI模块；公共runtime/ports contract由集成者定版。共享任务记录文件范围，不能两人覆盖同文件/构建产物；构建由集成者串行执行。
- 每30分钟心跳：实际时间、已完成、下一步、具体卡点、测试/成本；用户问进度先回答，不长时间静默。
- 同一路径5次无进展前每次都诊断，不盲改/放宽门禁。5次后停该路径写根因/证据/方案/所需用户决定；不借此假称整个产品已完成。
- 不删除失败证据；日志空行等格式问题可精确修复，不重写原始错误结论，不篡改构建结果。

建议提交意图（按实际范围命名，非强制假造已做）：

- `fix(runtime): enforce verified worker boundaries`（有实证后才用）
- `feat(runtime): add durable scoped workspace input`
- `feat(panel): add kanban conversation workspace`
- `fix(runtime): reconcile commands and publish results`
- `docs: record kanban acceptance and release limits`

安全改动提交说明必须写威胁/边界/未覆盖项，不能只有“harden security”空话。

## 5. 遇到限制时的正确处理

- 无完整Conversation组件：实现设计中的窄化投影，不跳回另一个会话、不私自引入宿主内部前端包。
- emit监听不能await：使用已admitted消息catch-up/确证屏障；禁止直接加延时等运气。
- 多任务需要不同Thread：在命令/领域层明确作用域，别把所有人话往最老订阅投；若需迁移先申请。
- 没有L2 shell强制能力：保留P0，给最小可行架构及授权要求；不得偷偷变成目录隔离后宣称全解决。
- 不能完成GUI操作：提供人工清单及部署版本；不把静态通过写成视觉通过。
- Desktop部署：仅按用户明确授权走应用内管理；不以CLI改Desktop profile，不在本任务擅自安装。

## 6. 最终交付（缺项说明原因，不发“全绿”空话）

1. 可运行bundle源码/构建，完整真实单入口交互，不只是HTML样例。
2. `docs/KANBAN-CAPABILITY.md`：准确API、生命周期/权限可行性、边界。
3. `docs/PROGRESS-KANBAN.md`：真实心跳、失败诊断、授权/暂停记录。
4. `docs/KANBAN-ACCEPTANCE.md`：设计全部验收ID、自动/需人工/不可验、原始输出/commit、L1/L2分别结论。
5. `probes/kanban/`：限定合成fixtures、三闸、命令重试/崩溃、真实发送/结果、沙箱及清理原始证据，不含凭据。
6. 更新README/RELEASE/KNOWN-LIMITS当前状态，不覆盖旧FINAL-VERIFY原始记录；未解决写入隔离位于风险首位，发布说明明确“非生产就绪”。
7. 已审查的分阶段commit和最终git status；用户原文件不改不夹带。
8. 给用户一句明确结论：
   - `工程闭环已完成，生产验收也通过`（只有所有强制安全/运行/真实视觉都通过才允许）；或
   - `工程闭环已完成，仍需人工验收：…`（不存在未解决执行安全阻断时）；或
   - `部分完成/不可交付，原因：…；已完成…，尚需…`。

禁止把“已写文档”“看板显示正常”“mockup按钮齐全”“目录四反例过了”当作完整开发验收完成。