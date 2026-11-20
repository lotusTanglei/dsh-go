# 看板工作区 v1 · 本轮验收

## 判定

**部分完成／不可交付，非生产就绪；不能称工程闭环完成。**

- 本轮已实现后端及单入口工作区，并分阶段提交：`05a8ab8`（命令/确认/结果/安全关门）、`7d55411`（对话四列看板）、`6ceeee6`（过期/分页/计划修订/精确范围展示与证据）、`7d18346`（未知请求终止与来源关联新建）、`4a06ee6/6cd8ff0`（401认证提示与证据收口）。
- 2026-11-20任务详情可读性：用户新截图已加载“交给超管”，但完整测试指令被用作多行大标题、原始报告字段挤占结果页。现改为字面首句/行的64码点展示标题、header单行/close不缩，完整title留正文折叠，不修改DB/按Fixture猜重命名；结果先台账状态/做了什么/报告验收/需人工，attempt元数据/raw/delivery退到折叠。currentAssignment精确优先，否则无可靠唯一开始时间即不猜最新；验收按brief逐ID核对、缺项/重复/未知/缺证据不汇总通过；风险/人工请求混空串不会隐藏有效内容。审批正文/范围/指纹与Worker关闭不变。84项标题/报告纯闭包反例、全量41files/459tests、typecheck/build/pack exit0，见[详情可读性门禁](<../probes/kanban/readable-final-20261120-163300/test.log>)；[真实Host新版资源](<../probes/kanban/s4-readable-20261120-163100-result.json>)仅证明当前资源/工厂注册/路由与安全关门，不证明浏览器布局或真实Worker完成，实机视觉仍未验。
- 2026-11-20统计范围纠正：用户有进行中会话但看板0，核实是其他普通DSH会话未接入超管台账，不是按当前epoch隐藏任务。API新增显式ledger-only scope，界面全局提示“未汇总其他会话”，旧服务范围未知不猜全量；空态/全量入口限定已登记任务，过滤无命中独立文案。此项不宣称跨会话工作汇总已实现，未读取个人会话正文或接管执行。focused94/94、全量40files/374tests、typecheck/build/pack exit0，见[统计口径门禁](<../probes/kanban/coverage-final-20261120-161900/test.log>)；[真实Host范围回执](<../probes/kanban/s4-coverage-final-20261120-161900-result.json>)确认board owner200、非owner/Origin403、ledger-only scope、生产Worker关闭与probe清理。
- 2026-11-20操作台重做：用户截图明确否定旧v2可用性，不能用319项测试推翻实际反馈。本轮以“描述任务→生成计划→完整审阅”为入口，单标题/单历史入口、动作决策卡、动态合计3行、两行输入及模式化发送，安全说明只折叠不撤销；未知/失败不假空、旧draft模式不迁移、新回复水位/归档轮询/焦点恢复已补。40files/372tests、typecheck/build/pack通过，见[最终门禁](<../probes/kanban/desk-final-20261120-160500/test.log>)；[真实Host新版资源回执](<../probes/kanban/s4-control-20261120-160800-result.json>)passed。首轮probe路径触发既有敏感前缀检测，failed回执保留，仅更换probe自有目录后验证，不改安全规则。实机视觉仍待真实页面加载后验证。
- 历史任务摘要修订：38 files / **319 tests**，typecheck/build/pack exit0，日志见[最新测试](<../probes/kanban/briefing-final-20261120-153800/test.log>)；真实Host新增摘要/独立助手回复/当前资源验证见[S4摘要回执](<../probes/kanban/s4-briefing-20261120-153900-result.json>)。默认任务与决策，历史可切换，未筛选账本最多6条/组+完整total，未把Fixture改为业务成果。独立UI/UX复审后已修到期计数、异常文案与未知结果。历史用户授权只重载超管，管理器当时返回需重启DSH，最终保持启用；用户后续截图已证明v2加载但不可用，不能继续以未加载解释。
- 历史完整三闸与打包：37 files / **307 tests**；14:02后认证提示补丁的全量门禁与pack另见`web-auth-20261119-140200/`，typecheck/test/build/pack exit0；[完整日志](<../probes/kanban/supplement-20261118-221200/test.log>)、[构建](<../probes/kanban/supplement-20261118-221200/build.log>)、[打包](<../probes/kanban/supplement-20261118-221200/pack.log>)。后端还验证过精确暂存树，267tests/三闸/pack通过，非借未暂存UI掩盖阶段缺件：[暂存树测试](<../probes/kanban/s1-staged-20261118-212700/test.log>)。
- 真实安装版 L1 spawn 父根、L2 同票未列/deny 可写反证已成立：[S0原始结果](<../probes/kanban/s0-20261118-202300-result.json>)。**真实生产Worker启动、恢复、工具执行全部关闭**，不是通过隔离验收。
- 已完成真实Host“命令→特定计划→确认→建票→同会话唯一持久通知”，但Router为本地确定性适配器、通知为合成Channel fixture；**不是实际Worker报告完成链路**：[S1结果](<../probes/kanban/s1-20261118-211400-result.json>)。外部产品provider请求0，本地适配器3次/fixture，协作代理另计。
- 用户最新截图已证明“交给超管”操作台重做加载，但长标题和原始报告堆叠仍难读；此前以匿名401推断认证故障或以未加载解释的结论撤回。本次详情修复还没有当前GUI实图/点击/IME/主题/console验证，也未擅自重启DSH。没有搜凭据、创建假DOM/截图或启动替代GUI。

## 证据层级

- **自动（离线）**：真实SQLite+明确fake Host/Spawner，证明业务合同/恢复，不外推执行沙箱或真实用户可见。
- **真实Host（合成）**：安装版Agent、Session/inbox、owner handler、flush、Client资源，Router模型/通知仍是合成fixture。
- **阻断**：真实执行安全反证、未实现或不可完整授权；不使用“待人工”掩盖实现缺口。
- **需人工**：浏览器真实行为，必须在安全隔离且经授权的部署后验证。

## 设计§8逐项矩阵

所有“实现”列的commit以功能引入提交为准；后续修订与最终门禁另附，不追溯改写旧failed结果。

| ID | 本轮结论 | 实现与原始证据 | 边界/剩余 |
|---|---|---|---|
| UX-01 | 部分实现 | `05a8ab8/7d55411`；[S1真实Host](<../probes/kanban/s1-20261118-211400-result.json>)、[runtime tests](<../tests/workspace/runtime.test.ts>) | 单入口new-task可生成计划/显式确认；[最新Host修订](<../probes/kanban/s3-20261118-221200-result.json>)通过owner home-relative精确scope。真实Worker关门，其他不可审阅scope继续禁批；首次安全项目选择/配置UX未闭合 |
| UX-02 | 静态接线；需人工 | `7d55411`；[workspace](<../src/client/workspace.ts>)、[客户端合同](<../tests/client/pages.test.ts>) | 同界面补充/审批/结果、草稿/目标/滚动持有；实际焦点/滚动/窄屏行为未验 |
| MSG-01 | 自动通过；Host合成通过 | `05a8ab8`；[命令测试](<../tests/workspace/commands.test.ts>)、[并发反例](<../tests/workspace/adversarial.test.ts>)、[S1结果](<../probes/kanban/s1-20261118-211400-result.json>) | 同ID串行锁+payload摘要409；unknown不换ID。不是跨库物理exactly-once |
| MSG-02 | 自动通过 | `05a8ab8`；[runtime定向A/B/C](<../tests/workspace/runtime.test.ts>)、[legacy共享Thread](<../tests/workspace/adversarial.test.ts>) | new-task独立Thread；target在intake事务内绑定。真实并行Worker未验 |
| MSG-03 | 自动通过；Host合成通过 | `05a8ab8`；[当前turn catch-up](<../src/workspace/runtime.ts>)、[S1唯一messageEvents](<../probes/kanban/s1-20261118-211400-result.json>) | 真实user-message归一化后建单；补充单次inject不唤醒Router。不把postcommit observer当barrier |
| MSG-04 | 自动通过选定崩溃窗 | `05a8ab8`；[commands](<../tests/workspace/commands.test.ts>)、[admission恢复](<../tests/workspace/admission.test.ts>)、[flush取消竞态](<../tests/workspace/adversarial.test.ts>)、[结果SQLite重启](<../tests/workspace/runtime.test.ts>) | dispatch fence无证据保持unknown不盲发；owner可对unknown/false精确seq二次确认终止路由，先对账并拒绝queued/admitted，晚证据不得驱动业务；不取消模型或宣称任务已停。报告settlement后pump以确定键补Outbox。未声称所有Host/OS崩溃窗已穷尽 |
| MSG-05 | 自动通过 | `05a8ab8`；[归档与lineage](<../tests/workspace/runtime.test.ts>)、[恢复错误分类](<../tests/runtime-recovery.test.ts>) | exact-notfound换epoch，corrupt failclosed；旧epoch只读；运行中canonical即时failover未实现 |
| RESULT-01 | 自动通过；真实产品阻断 | `05a8ab8`；[fake Spawner结构化结果](<../tests/workspace/runtime.test.ts>)、[Host持久Channel](<../probes/kanban/s1-20261118-211400-result.json>) | 无下一条人消息即可确定性摘要；真实Worker链因执行安全未运行，不勾真实端到端通过 |
| RESULT-02 | 自动通过 | `05a8ab8`；[报告校验](<../tests/engine/brief-report.test.ts>)、[runtime](<../tests/workspace/runtime.test.ts>)、[注入/停止](<../tests/closeout/injection.test.ts>) | failed/not-run/不全不completed，人工stop晚报告不复活；sent是flush持久发布不是已读 |
| BOARD-01 | 自动通过 | `05a8ab8/7d55411`；[看板测试](<../tests/panel/kanban.test.ts>) | 每票一列；unknown可见/禁动作；预算不当完成百分比。实际布局未验 |
| BOARD-02 | 自动通过 | `05a8ab8/7d55411`；[每列107/135时间线/135审批](<../tests/panel/kanban.test.ts>)、[UI分页合同](<../tests/client/pages.test.ts>) | revision包括Ticket/Assignment/Approval；变化409重新同步不假快照；后端全表扫描存在规模限制 |
| ACTION-01 | 自动通过；真实执行阻断 | `05a8ab8/7d55411`；[生命周期](<../tests/domain/domain.test.ts>)、[runtime停止/恢复](<../tests/workspace/runtime.test.ts>)、[UI停止重试](<../tests/client/pages.test.ts>) | 先持久终止再interrupt/dispose；生产guard拒绝旧Worker；任意后台进程组收敛未由真实产品证明。无人工stop原地resume；带来源新建仅铺新草稿，发送后独立Thread/新计划确认、不继承旧审批，有SQLite重开与归档归属反例 |
| ACTION-02 | 自动通过 | `05a8ab8/7d55411`；[多审批与过期](<../tests/panel/routes.test.ts>)、[指纹/双标签](<../tests/panel/kanban.test.ts>)、[隐藏action反例](<../tests/workspace/adversarial.test.ts>) | owner身份来自Host链，不信任actor；聊天/报告不能批准。业务批准不授权Host权限变化 |
| ACTION-03 | 自动通过；Host合成通过 | `05a8ab8/7d55411`及最终修订；[plan CAS/修订/过期](<../tests/workspace/admission.test.ts>)、[owner修改实际Host](<../probes/kanban/s3-20261118-221200-result.json>) | 不改confirm默认，更保守地均显式确认；同界面owner修改目标/第一步产生新plan/指纹，旧指纹409；API受限patch不改scope/runtime/base，绝不隐式批准。过期跨epoch释放容量已验；其余不可审阅scope禁批 |
| S1 | 未通过/阻断 | [S0真实provider](<../probes/kanban/s0-20261118-202300-result.json>) | direct meta Ticket根允许合法/拒跨票及symlink；生产spawn继承父header根，因此不能算产品L1通过 |
| S2 | 部分反例/阻断 | [24个真实间接执行case](<../probes/kanban/s0-indirect-20261118-213300-result.json>) | native/Node/Python/heredoc/间接script/background全部allowed成功、crossTicket无文件、同票unlisted/deny均写入；full sandbox=true，仅direct constrained fixture，不外推生产Worker或网络/进程隔离 |
| S3 | 未通过/阻断 | [同Ticket unlisted/deny实写](<../probes/kanban/s0-20261118-202300-result.json>) | native+shell均可写；不以prompt、删bash或字符串parse冒充逐glob限制 |
| S4 | 未通过/阻断（产品关门） | `05a8ab8`；[能力文档](<KANBAN-CAPABILITY.md>)、[旧live恢复先结束](<../tests/workspace/runtime.test.ts>)、[生产guard](<../tests/workspace/adversarial.test.ts>) | 没有已证实的首工具前安全启动方案；只证明拒绝执行，不证明允许执行安全 |
| SAFE-01 | 自动选定范围通过 | `05a8ab8/7d55411`；[store安全](<../tests/store/closeout-security.test.ts>)、[panel注入](<../tests/panel/kanban.test.ts>)、[文本投影](<../tests/workspace/conversation.test.ts>) | 固定错误/参数SQL/UTF8上限/文本React/secret-path；shell网络策略未强化，真实浏览器XSS/任意秘密编码未全面证明 |
| REL-01 | 自动通过选定回归 | `05a8ab8`；[并发/背压](<../tests/closeout/concurrency.test.ts>)、[故障](<../tests/closeout/faults.test.ts>)、[容量并集](<../tests/workspace/adversarial.test.ts>) | paused/subscription容量、maxWorkers、clock/readonly/lock/orphan保留；真实高并发成本、长时间watchdog新运行未做 |
| BUILD-01 | 自动通过 | `05a8ab8/7d55411`；[307tests](<../probes/kanban/supplement-20261118-221200/test.log>)、[typecheck](<../probes/kanban/supplement-20261118-221200/typecheck.log>)、[build](<../probes/kanban/supplement-20261118-221200/build.log>)、[pack](<../probes/kanban/supplement-20261118-221200/pack.log>) | Electron Node24.21.0/pnpm10.33.0；真artifact VM只做factory注册，无DOM替身 |
| LIVE-01 | 真实Host合同通过；非浏览器认证证明 | [S4最终Host](<../probes/kanban/s4-20261119-140300-result.json>)、[artifact VM](<../tests/client/artifact.test.ts>) | 3preset无broken、current artifact资源200/字节匹配、3slots、owner200/真实unknown Peer403/Origin403；1main+1title本地调用/外部0。不是浏览器真实cookie认证或视觉证明 |
| VIS-01 | 需人工；未验 | [人工步骤](<KANBAN-MANUAL.md>) | 深浅/中英/宽窄/IME/键盘/焦点/网络/console无证据；独立代码UI/UX审查不替代视觉 |
| CLEAN-01 | 自动通过自有fixture范围 | [最终清理回执](<../probes/kanban/cleanup-20261118-221500.json>)、[S3 agents0](<../probes/kanban/s3-20261118-221200-result.json>)、[S4 agents0](<../probes/kanban/s4-20261118-221200-result.json>) | 13个Host SQLite只读非终态Assignment/Trigger/Eval/Outbox均0、锁无；自有dev进程0/无dev:web watcher；CLI无新GUI服务器。保留历史/sentinel/产物，不动用户服务；无浏览器视觉证明 |

## 已做独立审查及闭合

- 后端：容量并集/自身slot转移、legacy共享Thread目标原子性、跨epoch归属、拒绝复活/取消投递、flush等待取消、恢复旧live Worker绕行、隐藏action指纹授权均被找到、修复并新增反例。具体用例在[对抗测试](<../tests/workspace/adversarial.test.ts>)与[runtime恢复](<../tests/workspace/runtime.test.ts>)。
- UI/UX代码：404不能允许换ID、stop失败解除本地锁、终态不锁死草稿、超过100审批可查历史、409不0delay重扫、button使用phrasing元素均已修。仅代码审查，未浏览器操作。
- 保留全部失败结果与日志。原始日志尾空格/EOF空行不清洗；源码独立whitespace门禁保持。

## 最小后续决定

1. **执行安全**：按[能力方案](<KANBAN-CAPABILITY.md#L55-L61>)批准后再实施首工具前独立Agent安全根与shell/后台逐路径强制架构；如涉及核心/依赖/DDL/权限必须单独授权。不能把现在关门改成放行。
2. **完整授权UX**：补首次安全项目选择、owner之外/跨机器路径的精确身份方案。当前Host owner主目录内规范repo已支持无损`~/完整后缀`，显式修订/过期/分页已完成；仍不能忽略隐私脱敏批准隐藏scope。未知请求显式路由终止、人工stop后带来源新建草稿已补；二者不授权执行、不复用旧审批；仍需实际浏览器验收。
3. **当前GUI更新与验收**：本次用户已授权只重载超管；管理器返回需重启DSH，已恢复启用。完整重启后核实“业务摘要视图 · v2”，执行人工清单的只读/规划交互；真实执行必须先解决安全阻断。不由代理手改运行profile或擅自杀进程。

以上未做项均保持阻断或未验，不用“静态看板已完成”替代完整交付。
