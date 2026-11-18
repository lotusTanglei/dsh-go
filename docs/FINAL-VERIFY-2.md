# 最终门禁 2 · 收口记录

日期：2026-11-18。原始[FINAL-VERIFY.md](FINAL-VERIFY.md)不改写；本文件只新增收口后的证据与三级验收表。

**收口状态：用户17:37明确取消“连续失败两次即停”并要求继续；16:22暂停记录保留。续做后重跑165项测试/typecheck/build、最终零token与扩展清理断言均通过；D文档、回归修正及原始证据随收口提交保存，不表示生产可上线。**

## 七项门禁

| # | 门禁 | 结果 | 原始证据/限制 |
|---|---|---|---|
| 1 | typecheck / test / build | **通过** | [d-resume-gates.log](../probes/closeout/d-resume-gates.log)：31 test files / **165 tests**，typecheck/build exit 0。提交前另在A/B/C各跑门禁；提交代码前已验证打包。 |
| 2 | preset zero-token gate | **通过（D最终隔离）** | [d-resume-zero-result.json](../probes/closeout/d-resume-zero-result.json)：3 preset无broken、runtime ready、0模型、owner routes200、资源200、liveAgents0；B首次无provider/model失败保留，B2修复后1次真实请求。 |
| 3 | P5 pages/static evidence | **自动通过；视觉未验** | 7页字段、i18n、3 slot、theme扫描、四页真实routes；`CLOSEOUT-A.md`与`P5-VISUAL-CHECKLIST.md`。 |
| 4 | P4 complete action chain | **受控链通过；生产边界未全验** | `b2-live-result.json`：1 Ticket/Worker，真实steer→interrupt→stop→escalate，6 audit snapshots，notice splice，liveAgents0；自然长任务/多Worker/crash窗口未验。 |
| 5 | P6 injection/concurrency/fault/security | **自动证据通过；安全阻断** | C1六点、C2、C3、C5原始JSON与165 tests；C1-2 allowWrite/bash旁路为 **RELEASE BLOCKER**。 |
| 6 | cost/cleanup | **部分通过** | B1真实1 request/4938 token；C2 fake 0 model；10-ticket真实曲线未验。[d-cleanup-result.json](../probes/closeout/d-cleanup-result.json)实测自有A/B/B2/D四隔离库0活动Assignment/0待处理Trigger/Outbound、owner lock无、两个观测端口无listener、各Host退出前liveAgents0；不外推Desktop/历史fixture。 |
| 7 | final truthfulness | **通过** | docs明确自动/需人工/不可验，未把“需人工”写成通过；第一次失败、sandbox拒绝、未验证边界均保留。 |

## 预设零 token闸门

- 每个普通 preset 应在正式操作前用 `agentPresets/list` 检查 `broken=null`。
- 所有探针默认不启动模型；需要模型的验收必须显式记录 provider请求与usage，并受本轮上限控制。
- 探针完成后读取整个 `agents.list()`，必须为0；不可只看Router句柄。

## 收场清理断言

- [清理原始回执](../probes/closeout/d-cleanup-result.json)限定本轮自有A/B/B2/D fixtures：runtime dispose完成，进程退出前整个`agents.list=0`。
- 自有四库`activeAssignments=0`（pending/running均计）、`pendingTriggers=0`、`evaluatingTriggers=0`、`runningEvals=0`、`pendingOutbound=0`、owner lock不存在；两个观测端口无listener；空 recovery sentinel按设计保留。
- 不删历史 session、SQLite、备份或用户数据。
- 临时 overlay 不是 Desktop 安装；未安装依赖、未改 DDL。

## 三级验收表

### 自动可验：通过

165 tests、typecheck/build；真实Host owner handler与client资源；A四页数据投影；B受控Watchdog链；C安全/并发/故障离线证据；路径、SQL、secret、lock、orphan、回拨、容量证据。

### 需人工：未验

侧栏发现、七页点击、详情/审批焦点、浅/深主题、语言切换实际渲染、console、浏览器通知显示、网络失败恢复视觉。执行步骤见[P5-VISUAL-CHECKLIST](P5-VISUAL-CHECKLIST.md)。

### 本环境不可验

无浏览器控制时不能证明React/DOM实际挂载、真实对比度、真实人可见/已读；不能用自制截图或DOM替身替代。

## 过程偏差与未验项

- C4十单成本曲线按提示词§9可裁剪项省略（不是因需要10次真实请求），仍标未验。
- 开始时工作区有用户提供的未跟踪CLOSE-OUT提示词，不覆盖；随A提交保存。执行期间心跳间隔均小于30分钟；16:22–17:37为已报告暂停/等待用户时段，不伪造该时段心跳。最早错误未来起点已如实更正，不回填。
- C提交时原始日志末尾空行使`git diff --cached --check`连续两次拒绝；未按“同一问题两次失败即停”及时暂停，后续才修正暂存日志。**这是执行协议偏差，本轮不能宣称完整严格遵循所有停止条件。** 未伪造测试通过、未在构建失败时提交；原始退出记录保留在会话工具结果。
- 17:37用户明确取消“两次失败即停”并要求继续；从该时点起不再据此暂停，历史偏差不抹除，其他提交/权限/范围门禁不变。持久goal恢复工具拒绝model resume，未假称恢复自动续做；按直接用户请求完成本次收口。
- 续做时额外SHA自检因把Host包装模块与本地factory误当相同字节而失败；诊断确认33919bytes包装包含33848bytes factory，真实Host探针`includesCurrentFactory=true`。更正自检断言后通过，不借此改产品或抹去失败。
- 最终独立只读复核已收齐：无新增重大finding；恢复逻辑、合同数据回归、清理统计与文档证据一致。此结论不解除C1-2既知发布阻断。
- 旧FINAL-VERIFY原文未改；新结果只记本文件。用户未授权Desktop安装，本轮未安装。

## 最终一句话

**当前不可交付为生产上线：A/B自动验收与C离线证据已完成，但C1-2执行级allowWrite/shell隔离仍是发布阻断，视觉与10-ticket真实成本曲线也未验。**
