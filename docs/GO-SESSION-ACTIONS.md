# G2 会话动作概念与最窄协议（2026-11-21）

这是 [Go 开发合同](<superagent-design-20261121-v2/PROMPTS.md>) 的小步实现提案，不新增 DDL，不迁移用户状态，不安装/部署，不解除 L1/L2。先写概念与 schema，随后代码在现有 `side_effect / kv` 中保存最少控制元数据。

## 用户路径与实施边界

人类在无副作用定位结果核对目标和当前范围/事实版本 → 输入本次直接要求，选择继续/补充/纠偏 → Host 核对动作并返回持久回执。生产端明确显示执行隔离阻断，只有“核对动作”入口，没有假发送/假停止。普通会话控制是最终需求，当前阻断不是取消需求。

当前生产 runtime 不注入 dispatch 或目标对账适配器；没有配置、HTTP 字段、模型输出或普通 Session API 可启用它。独立服务测试只使用明确合成 cold/live 目标，证明防重放状态机，不冒充真实 Host/业务控制通过。stop/resume、图片、问题回答、阶段模型和具体操作批准不伪装成本文3种文字意图；后续各自验证适配合同。

## 概念与 v1 schema

- **单动作输入**：`requestId / actionId`（UUID），当前 `epoch`，操作 `continue | supplement | steer`，`target:{sessionId,scopeRevision,factRevision}`，精确 `text`。每个 request 在此切片只有一个 action；不能换 action ID 重试同一请求。
- **Host 验证绑定**：来自可信当前目录的稳定 session ID、project kind/key、scope revision、事实 revision。显式 ID 或定位结果都不是权限；准备与真正 dispatch 前重新核对，异步边界后同步 fence。执行 gate 另外必须返回 Host `controlRevision / grantRevision` 与同步 fence，绑定人工停止/恢复和具体许可；工作 fact revision 不能替代控制版本。生产 gate 始终拒绝，未捏造实际 Host 控制版本。
- **持久动作**：仅稳定 ID、操作、规范 digest、目标绑定、message reference、seq、时间、状态和固定原因码。不复制原正文、路径、凭据或图片。输入 digest 保持 Unicode/换行原字节语义，不用脱敏文本执行。
- **状态**：`recorded`（核对并记录、未发送）、`blocked`（当前动作终态，未发送）、`dispatch_unknown`（dispatch fence 已持久、是否受理未知）、`accepted`（有目标持久受理证据，不是开始/完成/人已读）。未通过目标证据绝不返回 accepted。
- **唯一性**：同 action ID 同 digest 返回当前同一动作；内容不同409。request→action 指针防同 request 换 ID。unknown 目标阻止新的动作，不因换 request/action 绕过不确定投递。
- **对账**：unknown 仅查询该 action 最少控制证据，不查会话正文、goal 或全部历史；排除后只在 Host 允许最少回执查询时可对账。拿不到证据保持 unknown，绝不自动重投。无 exactly-once 声明。
- **并发**：最窄实现统一串行真正 dispatch；任一未对账动作由全局持久 unknown fence 阻止其他目标跨重启继续外发，因为资源独立性尚未证明。此串行不证明无外部 actor 冲突；Host gate 必须负责其他 actor、共享写资源、审批与配额。生产 gate 关闭。

## 端点与信任

`POST /session-action` 只接收 `prepare / status / close`：准备及主动封存是人类直接交互，状态只接当前 epoch 与已知 action ID。字段白名单、owner/Origin/epoch 保持；浏览器不能传 actor、grant、工具、URL、provider、原图或任意执行函数。生产准备可以落“已阻断”审计回执，绝不调用 Agent，也不唤醒 cold Session。

回执 `durable:true` 仅说明本地动作记录持久；只有独立目标最小受理证据与 action/digest/message/target 一致才为 `accepted:true`。`recorded/blocked` 的 executed/completed 为 false（未投递）；`dispatch_unknown/accepted` 为 null（未知），绝不把可能已执行描述成未执行，也不把已受理描述成完成。

持久动作不是批准对象。业务回答不是具体工具审批，来源/旧聊天不能生成本次人类授权。若以后启用真实 dispatch，须先证明当前安装版身份/授权/隔离、内容摘要冲突、精确目标证据、原有模型保留、停止/恢复语义和外发审批等，另行审阅最窄真实适配器；本轮不提供启用开关。

## 无记录未知请求的显式关闭

独立 UX 复核证实：定位与准备之间目标事实变化，首次核验会在 journal 前拒绝；若错误或回执丢失，UI 只能unknown+status404，不能靠404放行新动作。

新增 `close` 是**人类显式申请关闭原动作ID**，输入仍为原精确payload（只存digest，不存text）。Host 串行检查当前epoch、request/action冲突和已有journal：已有record只返回现状，尤其dispatch_unknown绝不关闭/释放；确无记录时原子写入 `closed` 墓碑并封死该ID的所有未来prepare。墓碑保存requested target及digest，`bindingVerified:false`，不捏造项目归属或控制许可；status可取回，同ID更内容仍409。请求与动作指针同事务写入，迟到prepare被墓碑拒绝，不能先关后投递。

这不是“404证明未执行”，而是Host以持久fence保证该ID此后不投递；不泛化声称历史已确认。墓碑状态为 `closed`，请求目标 `bindingVerified:false`，executed/completed仍为null，只说明永久封存的准确动作ID。当前服务持久dispatch-before-call、单写锁和同串行队列构成此窄证明前提；真实Host控制未验，不能外推其他存储/进程。仅当前服务尚未提交任何dispatch fence的缺记录动作可封闭；存在未知dispatch的动作仍只对账。UI保留原payload/关闭证据，仅明确closed后可显式新建核对草稿，绝不自动换ID重发。跨epoch沿原有禁止，不借关闭改新epoch：旧epoch未知仍明确阻断新动作，此处尚无获准跨epoch恢复入口，不能宣称全部恢复闭环。

## 当前安装版合同再核实

安装版 `0.2.2-rc.5`，只读源码，非挂载/真实控制验收：

- [prompt](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/index.ts#L468-L491>) 用 `source.rpcId=requestId`；[createUserMessage](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/src/message.ts#L224-L252>) 另建随机 message ID。不能预设 Host 会用 Go messageId；未来真实 adapter 必须映射真实 message ID，本切片的 `go:actionId` 仅合成适配合同。
- [已有去重](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/commands.ts#L390-L412>) 只 Set ID，不比正文 digest。[queue edit/steer](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/commands.ts#L483-L518>) 可保留 source 或移除重插；一次 canceled splice 不证明最终取消。
- [inspect/observe](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session-query/src/index.ts#L140-L156>) / [options](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session-query/src/observation.ts#L44-L49>) 无专门 request→receipt 最小接口。`inspectSession` callback 可接整个 Session；选 projection keys 是数据最小化，不是权限隔离。[projection](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session-projection/src/index.ts#L103-L116>) 自身也见事件。后续最小 receipt 必须由经审阅的 Host-owned adapter 提供，不把插件读取完整日志包装成“不接触正文”。
- [cold read](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session-query/src/cold-read.ts#L31-L55>) 内部加载完整日志并合成 interrupted closers；[persistence revision](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session-persistence/src/index.ts#L189-L203>) 只是同实例/session缓存等值 token，不是控制 revision。
- [cancel](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/commands.ts#L526-L539>) accepted 不等于停止；[idle cancel](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-loop/src/agent.ts#L192-L201>) 可无操作。[turn/end reason](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session/src/types.ts#L193-L227>) 没有取消 actionId/principal，不能证明真人 stop 或恢复许可。当前拒绝假停止/恢复按钮。
- [sessions.flush](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session/src/index.ts#L1409-L1438>) 等监听器后返回是否有监听器；false 不能算持久。[SessionHandle.flush](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session-persistence/src/handle.ts#L85-L109>) 才明示 crash barrier。`whenIdle/turn.end/append` 不能代替耐久证据。

## 切片验证进度

初轮 malformed evidence 3 反例失败：继承对象、带字段数组、额外正文对象错误升级 accepted。已收紧 plain/字段白名单，保留硬断言；合法状态/seq组合、孤 journal/pointer、40字母opaque目标ID精确保留及global unknown回归均补齐。

初步集成定向：动作服务82、精确目标16、runtime27、route7及既有route8，共 **140 tests 通过**，均合成 ports / 独立本地 SQLite。

独立对抗复核另证实目标 binding 在 fence 回调后可变参；已在任何回调前快照并冻结精确绑定、捕获 gate 决定/permit，允许分支在异步 gate 后重新读取精确事实再提交 dispatch fence。新增6反例后动作服务88+精确目标16=**104通过**；accepted后的共享资源互斥继续由Host gate负责，串行不自证资源安全。

UI按定位目标逐层展开核对文本动作，独立目标/epoch/scope/fact草稿与原动作凭据，不动主composer；生产按钮明确只核对、不发送。未知只查原动作状态或显式请求永久封存，404不换ID重试；旧目标/epoch回执保留原归属。首次blocked后不可再用的UI路径已修为显式保留旧证据→新草稿；核对按钮pending保留disabled，可见状态在折叠区外，新草稿有局部焦点目标。UI90项与既有35+8合同通过，均非DOM/视觉证明。

封存服务58项（真实隔离SQLite）覆盖首次target409→status404→显式封存丢回执→重开取证→迟到prepare永不发；旧journal四态不关闭、未知不释放global fence、跨epoch/冲突/损坏、原子回滚、不存正文。Host服务/target/runtime/routes定向共 **205 tests通过**。

G2可安全部分最终全量门禁：**58 files / 959 tests通过**，typecheck / build / client syntax / diff check 均exit0；见[测试日志](<../probes/go/g2-20261121-88V8Ui/test.log>)、[构建日志](<../probes/go/g2-20261121-88V8Ui/build.log>)。打包内容单独以本轮 `pack-content-check.json` 回执为准，不把打包当安装许可。

独立UX复核通过上述三条修复的静态/真实闭包合同：blocked/closed显式新草稿、409/404后主动封存、常驻状态与焦点回调；无浏览器，未作DOM/IME实机/视觉声明。真实Host/GUI、L1/L2隔离、持久最小受理证据适配与跨epoch恢复仍待验，不可由上述测试推论生产普通会话可控。

