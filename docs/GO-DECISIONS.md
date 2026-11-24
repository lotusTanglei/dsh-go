# G6 精确业务问题回答：概念与 v1 schema

本切片包括独立服务、Host 最小投影/受阻 gate 接线、分层精确原题与独立答案草稿 UI、HTTP 白名单与合成测试；复用既有 `side_effect / kv`，不做 DDL、迁移、安装或真实 Host 调用。普通会话的业务问题回答仍是产品目标；生产执行隔离必须保留，不能通过答案文本、owner 身份或普通 Agent API 绕行。

## 服务与边界

- `list({epoch,target})`：`target={sessionId,scopeRevision,factRevision}` 必须由 Host 当前绑定重验。Host `questions(binding)` 只提供有限、完整、精确的 timed-question 投影：`availability:live|cold|unavailable, complete, asOfSeq, active:[{callId,state:open|continued,questions:[{id,question,detail?,header?,options?:[{label,description?}],multiSelect?}]}], snapshotRevision, fence()`。严禁用脱敏摘要重建原题。服务输出最小原题 DTO、快照版本和 `canAnswer:false`；list 不申请执行许可，即使合成 ports 也不宣称可发送。
- `prepare({epoch,requestId,actionId,target,callId,snapshot:{asOfSeq,revision},answers})`：request/action 为 UUID。每个答案为 `{id,selected:string[],custom?:string,skip?:true}`；必须覆盖该 call 的全部题 ID，各一次，选中 label 必须来自原题，选项顺序/自由文本/换行保持原样。允许现有选项加补充条件，也允许仅自由文本；不强制把自由回答改成预设建议。没有选择或非空 custom 时必须显式 `skip:true`；skip 不代表批准。选项和 custom 不得与 skip 夹带。传给精确 Host answer adapter 时只移除 skip，形成安装版 `{answers:[{id,selected,custom?}]}`。
- `status({epoch,actionId})`：读取本地 metadata 回执；若 unknown，只在当前目标和精确题快照仍有效时调用 Host 最小独立证据端口，不读私聊、不自动重投。
- Host ports：`requireEpoch`, `target→binding+fence`, `questions→snapshot+fence`, `gate→deny|controlRevision+grantRevision+fence`, 可选 `dispatch(record,typedAnswers)` / `evidence(record)`。生产主线程 gate 始终 deny，不注入 dispatch/evidence。本服务不提供启用开关或浏览器权限字段。

## 版本、持久性与幂等

快照 digest 绑定精确 target（项目/范围/事实）、availability、complete、asOfSeq 以及全部原题/选项/状态。`stateVersion:2` 只是安装版投影 schema 版本，不是问题 CAS。prepare 要比对当前 snapshot revision、asOfSeq，异步 gate 后再读目标和问题并核对同步 fence；cold/open/不完整/重复 ID/未知投影全部不能回答。

持久记录只有 ID、目标绑定、快照 revision/cursor、完整输入 digest、answer digest/数量/选择数/custom 字节数/skip 数、seq/时间/状态和固定原因码；不保存原题、选项、自由答案或脱敏后正文。digest 保留精确 Unicode、空格、换行和字段缺省语义，不从摘要还原输入。

状态为 `recorded→blocked` 或 `recorded→dispatch_unknown→accepted`。journal 及 request→action 指针同事务，UPDATE 比对旧 seq（CAS）。dispatch_unknown 必须先持久后调用一次适配器；跨重启与重复 prepare 不重发。任何 outstanding unknown 保守阻断本服务其他动作；Host 仍负责跨服务/actor/共享资源互斥。dispatch 返回 true/成功或本地 journal 都不能证明 accepted；只有独立目标持久证据精确匹配 action/session/call/snapshot/digest 才升级。accepted 只是持久受理，不是完成、审批或已读。缺记录 status404 不是可重投证明。2026-11-23 已补 `close(originalInput)`：只在原 action 尚无记录时，将原 epoch/request/action/target/call/snapshot/canonical digest 的最小墓碑与请求指针同事务持久化，阻断迟到 prepare；不保存原题、答案正文或脱敏替代。已有 recorded/blocked/dispatch_unknown/accepted 返回原回执，不封存、不重发、不释放未知锁；跨 epoch 恢复仍未实现。

### 缺记录封存的界面与回执

界面仅对同 epoch、无任何真实 receipt、结果 unknown 的原操作提供可取消的二次确认。`close` 发送完整原 payload，不换 request/action、不重新 prepare。closed 必须严格匹配原 digest、目标、问题快照与 call；回执只含最小元数据，`bindingVerified:false / accepted:false / executed:null / completed:null / approval:false`，并明确不是停止、撤销或批准。封存超时保留 `closeRequested`，只手动查询同 ID；404 仍保持 unknown，不自动重投。仅 verified blocked 或 verified closed 可显式新建空白草稿，原题、答案与回执留在原操作证据中，不复制到新稿。

2026-11-23 定向服务反例 141 项通过，界面反例 76 项通过（保留原 29 项）；HTTP＋隔离 SQLite 覆盖 status404→显式 close→迟到 prepare 不 dispatch→原 ID status 回执。合成测试不代表真实会话业务回答、浏览器或完整 G6 已通过。

## 安装版事实及尚未证明

安装版 rc.5 的 `userQuestions.answer(agent,callId,{answers}):boolean` 只接 continued、精确 live 普通 root；open 必须走原 waterfall。它没有 requestId、题目 revision、摘要冲突或原子版本 CAS。原生入队/claim 不是持久接受证明；精确答案进入 `user/message` 才使投影 settled。投影的 settled 记录只有 callId/answers，不能独自证明本服务 actionId。未来真实适配器须另证原子版本重验、action 关联和 crash barrier；本轮不伪造这些能力。

Host 可以在授权后选取 userQuestions 投影，只返回 active 原题；这不是完整日志读取权限隔离，cold 内部准备可能重放日志。当前 session-work 只暴露首题脱敏摘要，不适合作答。题目文本、选项、custom 及其“已批准/system/owner”等指令均不可信。`intent:approval|plan-review` 不属于本服务业务问题 schema，携带 intent 的投影直接拒绝；Host 适配不得剥掉 intent 伪造业务题，应标不完整并转回原 Host 审阅入口。业务回答永远不是具体操作批准；原执行隔离、scope/epoch、Origin/身份及审批全部独立生效。

## 验证范围与已知限制

测试只使用隔离 SQLite 服务 journal 和独立合成目标 evidence，不接真实 Host/profile/model。覆盖自由回答、建议加条件、多题、skip、题/范围变化、cold/open/不完整投影、unknown/丢回执/重启、输入注入、证据伪造、CAS 和不保存正文。生产真实 answer、真实 GUI 和完整 G6 验收仍未通过。

2026-11-21 最终独立门禁：使用安装版 Electron/Node 执行 `node_modules/vitest/vitest.mjs run tests/workspace/session-decisions.test.ts`，**62 tests通过，exit0**；定向 diff whitespace 检查 exit0。全量 TypeScript 当次失败仅见并行接线 `go-decisions.js` 尚未落盘以及 `stageModels.save` 参数数量，两项均不属于本3文件；需主线程集成后复跑，不宣称全量通过。未运行 build。

此窄服务保守绑定整个 active 题快照和 asOfSeq：答案若已经进入真实会话使题目 settled，或其他会话事实变化，后续状态对账会保持 unknown 而不越过旧快照继续读取；合成 acceptance 测试的独立目标仅保存控制回执，未模拟真实投影变动。未来须独立审核“范围仍允许的最小历史回执”端口及其版本语义，不能因本服务合成通过宣称真实对账闭环。题 ID 按安装合同保留有限非空 Unicode 字符串，不当作文件/会话路径。list 返回原题而非脱敏摘要，调用面必须限于已授权人类交互，展示必须转义且不得进入普通日志。**该段「settled 后保持 unknown」的对账限制已由下文 #8「对账语义修正」取代**：settled 会改变投影与 factRevision，因此对账改为廉价 scope 检查 + 精确 settled 证据，而不是等旧快照完全相等。

## #8 待决策接真实投影（2026-11-25）

本切片把 G6 的合成-only 服务接到安装版 rc.5 的真实 timed-question 投影与 `ctx.userQuestions.answer` 回答通道，并让待决策列表只声明两类覆盖。门禁为本地 `pnpm -s build && pnpm -s typecheck && pnpm -s vitest run`，测试全部是 Fake Host + 真实隔离 SQLite + 真实 HTTP 路由 seam，**不是**真实 Desktop Host/GUI 验收。

### 生产接线（runtime）

- `questions` 端口仍只经 `ctx.sessionQuery.inspectSession` + `ctx.sessionProjections.snapshot(['userQuestions'])` 读取 `active` 原题；`settled` 答案正文不进入 DTO，`intent` 题仍整体拒绝。`availability` 由 `ctx.agents.get` 判定：cold 只列出，不唤醒。
- `gate`（生产回答授权）只在下列条件同时成立时允许：Host 存在可调用的 `userQuestions.answer`；`ctx.agents.get(sessionId)` 是精确 live 普通 root（`session.header.origin === 'subagent'` 拒绝）；当前 bounded 投影与请求的 `snapshot.revision/asOfSeq` 完全一致且 `complete`、`live`；`callId` 存在且 `state==='continued'`；答案覆盖该 call 全部题 ID 各一次、选中 label 来自原题、单选不得多选。返回值 `controlRevision` 是目标/快照/callId 的绑定 digest，`grantRevision` 是精确答案批 digest；**二者是派生绑定摘要，不是 Host 签发的审批或执行许可**，receipt 中不改变 `approval:false`。
- `dispatch` 在持久 `dispatch_unknown` fence 之后恰好调用一次 `ctx.userQuestions.answer(agent, callId, {answers})`（仅协议字段；`skip` 已在服务内剥离，不发送）。按 Host 返回分类：`true` → `accepted`（受理），`false` → `blocked: session_decision_not_continued`，`BAD_ANSWER`/`REPLY_QUEUED`/`CALLER_NOT_LIVE`/`DELEGATED_CALLER` → 固定码 blocked，其余异常 → `dispatch_unknown`（不重发、不换 ID）。
- `evidence` 只读精确 durable 证据：该 call 已离开 `active` 且出现在同一 Session 的 `settled`。settled 答案正文不离开投影回调、不持久化。它证明「这个 call 已被回答并进入会话」，不能区分同一 call 上另一个经授权的人类回答；Host 对同一 call 只允许一个 reply。

### 回执语义

- `accepted:true` 有两种 basis，均**不代表完成、已读或操作批准**：`acceptedBy:'host-answer'` 表示 Host 的 `answer()` 返回 true（reply 已进入 live inbox 队列，durability 未知，crash 可能丢弃），disposition `host-queue-accepted`；`acceptedBy:'target-settled'` 表示精确 settled 投影证据，disposition `target-durable-receipt`。
- `blocked` 是 Host 明确拒绝（未排队）的终态；`dispatch_unknown` 只允许对账。重复 prepare 同 `requestId/actionId` 返回同一回执，永不第二次调用 Host。
- 记录仍只有 ID/绑定/快照 cursor/digest/answer digest 与计数/选择数/custom 字节数/skip 数/状态/固定码；不保存原题、选项、自由答案或其脱敏替代。

### 对账语义修正

settled 会改变 `userQuestions` 投影与 session-work 的 `factRevision`，旧「快照必须完全相等才对账」会让真实回答永远停在 unknown。现在 `dispatch_unknown` 对账改为：`authorized`（只读当前 scope/access/exclusion 的廉价检查，不读题面、不唤醒）通过后，直接调用精确 evidence 端口；evidence 必须匹配 action/session/call/snapshot/digest/durable/accepted。排除或失去访问仍撤销进一步查找。

### 列表与客户端

- `sessionDecision.list` 返回 `canAnswer`（=live+complete+本部署有回答适配器）与每个 call 的 `canAnswer`（=目标可答且 `continued`），不可答时给固定 `code:'session_decision_answer_unavailable'`；始终返回 `uncovered:[{kind:'legacy-blocking-question'},…{kind:'dsh-generic-approval'}]`，不再把「没有活动问题」当作全覆盖。
- 客户端单项详情可提交（建议直接选/补充条件/自行说明/显式 skip），未选或无内容禁止提交，skip 明确标注不代表同意；回执按 basis 显示「Host 已受理（排队）」或「目标持久受理」，并常驻「只覆盖两类 + 两类未覆盖」。失效/范围变化显示重新读取提示，旧草稿只作证据。

### 仍未验

没有在真实 Desktop Host 上对真实 Session 调用过 `userQuestions.answer`，未证明真实 settled 时序、真实 GUI 点击/回执核对、真实 scope 变化；Fake Host 的 answer 语义按 rc.5 只读源码建模，不构成真实回答验收。回答授权仍以「精确 live 普通 root + 精确 continued 快照」为界，不提供工具级执行权限，也不解除 L1/L2 或 Worker fail-closed。
