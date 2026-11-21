# 超管看板与单一对话工作区 · 真实执行记录

## 执行边界

用户通过本轮确认正式下达完整开发（此前任务稿中“不启动执行”已由本轮明确确认替代）。按 S0→S4 执行；安全未证明不启动产品真实写入，不改 DDL/已发布 m001、不装依赖、不改核心/运行 profile、不部署 Desktop。普通开发代码修改与自有合成 fixture 验收已授权；真实产品 provider 请求当前 **0**，协作代理不混算。

## 2026-11-18T20:07:17+08:00 · S0 开工

- 实际 cwd：`/Users/dundundebaba/sync/dsh-s-p`，HEAD `22ebffe`，前五提交 `22ebffe / 9ff03eb / d81fdc6 / 221e47e / 2ca3529`。
- 用户 dirty：`docs/prompts/CLOSE-OUT.md`、`DEV-ALL.md`、`NIGHT.md`。用户 untracked：`docs/KANBAN-WORKSPACE-DESIGN.md`、`docs/panel-mockups.html`、`docs/panel-option-01.html` 至 `04.html`、`docs/prompts/KANBAN-WORKSPACE-DEV.md`、`SAFETY-BLOCK-2.md`、`SAFETY-BLOCK.md`。全数保留，不改、不移、不暂存。
- 已读设计 v1、最终验收2、已知限制、安全提示2/原安全提示、领域/流程/持久化；旧完成数字不是本轮验收。
- 当前工具没有 `cordis_inspect_list/query`，不能冒称 live Inspect。已加载 dsh-doc，按安装版文档/源码核实；安装 `@deepseek-ai/dsh@0.2.2-rc.3`，Electron `44.7.0` / Node `24.21.0` / `node:sqlite` 可用。
- PATH Node 为 `v22.23.1`（虽支持 SQLite，但不满足本包 Node>=24）；pnpm `10.33.0`。将用安装版 Electron Node24 运行 pnpm/门禁及脚本，不改用户 PATH 配置。
- 并行只读：safety-scout（安装版执行边界/生命周期）；ingress-scout（命令/路由/建单确认/结果链）。两者不修改源码；公共 runtime/ports 由集成者负责；构建串行。
- 下一步：保存完整三闸原始输出；S0 实证与能力文档；然后后端纵切（不先堆 UI）。

### 失败/限制诊断（不删除原始事实）

1. 运行环境定位路径第1次：`require.resolve('pnpm/package.json')` 在 Electron Node24 返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`，exit1。原因：已读 pnpm manifest 仅导出 `.`，不导出子路径。改为 `realpathSync('/opt/homebrew/bin/pnpm')` 定位实际 `bin/pnpm.cjs`，exit0，已取得进展，不涉及安装/依赖修改。
2. watcher 检查第1次：`ps -axo pid,command` 被 workspace-write 沙箱拒绝，exit1。未另路绕过/重试；真实 watcher 仍未核实，因此不承诺热更新。该限制不阻挡本地构建和后端验收；如确需检查再申请原命令授权。

## 2026-11-18T20:14:02+08:00 · S0 能力核实 / S1 离线基础

- 基线实际三闸完成：31 files / 165 tests，typecheck/test/build全部exit0；完整原始日志在 `probes/kanban/baseline-20261118-200717/`。使用Node24.21.0/pnpm10.33.0/SQLite3.53.4，不依赖PATH Node22。
- 已锁定安装版反证：spawn child header.cwd继承Router父根；spec.cwd仅workingDirectory.change，不改变权限。沙箱根按header.cwd解析。activation返回后set既不保证首工具前，也不能纠正immutable根。
- L2目录policy没有逐glob强制限制；真实模型与产品Worker尚未启动。自有非temp目录0token fs/shell反例probe开始准备；不会删bash或stub冒充通过。
- 新增窄command journal/ingress离线模块与测试：既有side_effect PK+版本CAS/dispatch fence、真实splice与admit对账、flush=true才accepted、同ID冲突/重试、独立Thread、旧epoch只读元数据；尚未runtime接线，不能声称已实现单入口。
- conversation-builder独占两新文件实现纯投影及测试；公共runtime/routes与所有构建仍由集成者串行控制。两个只读调查已收齐。
- 当前GUI匿名请求401；不搜索token/cookie，不启动替代GUI，不声称有热更新watcher。
- 下一步：收集S0真实probe与聚焦测试；完成S1命令/确认/结果接线和真实Host最小fixture；之后才做UI。
- 成本：产品provider请求0；无安装、迁移、profile或权限变更。

### S0探针失败诊断与已取得证据（2026-11-18T20:20:26+08:00）

- 第1次启动：workspace-write拦截superagent-dev生成`cordis.yml`，Host尚未启动；原日志`s0-20261118-201402-host.log`保留。用户同意原命令临时更宽权限重试。
- 第2次启动：探针runner拒绝覆盖第1次同名原始日志（EEXIST）；未启动Host。修正为每次启动UUID日志名，原错误不删除。此后用户将开发会话改为danger-full-access/never，不当作产品权限放宽或Desktop部署授权。
- 第3次启动取得实质进展：真实fs/shell provider在正确meta.cwd下允许src合法写，拒绝邻票与symlink；heredoc/后台跨票没有文件产生。**同Ticket未授权private与deny路径native/shell均成功写入，L2反证成立。** providerRequests0、liveAgents0、3preset无broken。完整结果`s0-20261118-201402-result.json`。末尾spawn descriptor缺项被安装版JSON校验拒绝，故整份回执failed，绝不重写为passed；下一步核准descriptor必填字段后独立新fixture复测。
- 新命令服务typecheck与聚焦7 tests全部通过（假Host+真实SQLite，不外推真实发消息）。尚未runtime/GUI接线。

## 2026-11-18T20:25:17+08:00 · S0反证落地 / S1接线

- S0独立第4次探针已完成，`s0-20261118-202300-result.json`为evidence-recorded，不是安全passed：生产spawn继承父header根；native/shell L2未列/deny路径均可写；直接meta Ticket根下跨票/符号链接/heredoc/后台无文件产生。3preset无broken、providerRequests0、liveAgents0。此前failed回执保留。
- 第3次probe末尾失败原因已核实为必填label缺失，补准确label后新fixture取得上述进展；不是继续盲试同一路径5次无进展。
- 新workspace command/admission/conversation已接runtime与15条POST路由，当前44新模块tests/typecheck通过。尚未完成真实Host新接口/纵切/GUI，不能标S1完成。
- 产品startAssignment无执行级边界证据时返回SA_EXECUTION_BOUNDARY_UNVERIFIED；仅测试显式fake Spawner注入可驱动合成验收，HTTP/Config不能获得绕过。
- 全量集成门禁第1次typecheck绿、test 202 passed/7 failed+1 unhandled、build因fail-fast未运行。失败为旧审批测试缺新fingerprint、旧fake Host缺flush、异步假inject拒绝未处理；下一步精确修合同并重跑，原始失败输出在`s1-integration-20261118-203100/`，不提交失败。
- 基线测试发现9个旧closeout JSON被既有测试覆盖：已将新输出完整保存到本轮baseline子目录后按HEAD恢复原件；本轮后续将改为独立test-runs路径。不丢弃新失败或更改旧结论。此为本轮发现并修正的数据保留偏差，不能冒称全程未覆盖过。
- 一次edit误传相同old/new被工具拒绝，无文件变更；无需重试该无效操作。
- 成本仍0产品provider；未改DDL/依赖/安装包/Desktop配置，S0隔离profile启动按用户批准。

## 2026-11-18T20:34:52+08:00 · S1回归推进

- 旧7项失败已修：新指纹合同/15路由计数、明确fake flush participant，fake注入按void合同同步抛错；58项聚焦测试/typecheck通过，无unhandled。
- 新增端到端合成回归（真实SQLite+fake Host/activation），第二次全量227 passed/3 failed：新板approval衍生状态未计入cursor revision（已修）、旧恢复fake查询对新Router也throw（已定位）、A定向用例时序待独立测试作者诊断。不是原路径无进展盲试；build仍由fail-fast未跑，尚不提交。
- ticket-input改为canonical真实source=user单次inject，不唤醒Router；flush后按真实inbox insertion经Source归一化→明确Ticket，避免为补充再唤醒Router。普通message/new-task仍单次followup；后续admit按id合并/去重，不伪造user/message。
- 已启动S1只读对抗审查；作者各自文件范围与集成分离。真实Host新接口fixture使用仅本地deterministic adapter，不触外部provider，待构建绿后跑。
- 当前总产品外部provider请求0；真实Worker仍关门；无部署/迁移。

## 2026-11-18T20:48:02+08:00 · S1独立审查修正

- 已在20:42:18独立三闸通过：36 files / 231 tests、typecheck/build exit0（原始日志`s1-integration-20261118-204400/`）。随后审查发现需修复的问题，因此该绿闸不是最终提交门禁。
- S1真实Host第1次失败：绝对路径probe被Client loader视为同bundle不同来源，启动失败；已改本bundle明确export `./kanban-s1-probe`，不是安装依赖/profile包修改。第2次Host已启动但runtime因读取未inject的agentDefaultModel失败，localAdapterCalls0/externalProviderRequests0/liveAgents0。已读Cordis optional get合同改只读`ctx.get('agentDefaultModel')`，无default时不阻塞激活；新fixture再跑，旧failed回执保留。
- 独立对抗审查找到并修复：容量并集/异步后预留；rejected/canceled终态不重放；拒绝建单崩溃补偿扫描；legacy同Thread定向必须在intake事务内绑定目标而不是提交后才比对；旧epoch票按Host归档绑定+Decision lineage验证；审批完整action schema+safe details，不可审阅/脱敏动作只能拒绝不能批准；production恢复路径也阻断旧Worker并guard拒绝未验证执行。
- 真实Workspace focus 73项/typecheck/build通过；新增审查修复仍在跑聚焦回归。未宣称S1全部完成，UI尚未开始。
- watcher检查在用户改开发会话权限后执行成功，未见`pnpm run dev:web`；因此不承诺当前GUI热更新。
- 工具辅助edit若无匹配/相同文本均fail-closed，无源码被覆盖；不重试无效替换。具体缺陷均有证据推进，不因第5次简单计数绕过门禁。
- 外部provider请求仍0。下一步：收S1真实Host/新回归绿→阶段review/三闸/pack/提交，再做S2单入口布局。

## 2026-11-18T20:52:16+08:00 · S1真实Host通过 / S2启动

- 独立S1 Host第3次fixture passed：真实Agent/inbox/owner handler/flush、Origin403、固定request重试唯一user-message、payload改动409、confirm=always精确计划批准后1票、生产Worker门禁拒绝、同对话唯一持久Channel通知。`s1-20261118-205000-result.json`明确本地deterministic adapter3 calls、外部provider0/liveAgents0，**不是实际Worker完成**。
- 审查修复后92聚焦tests/typecheck/build绿；新增对抗回归作者仅独占一新测试，尚未运行；UI作者独占workspace两新模块+locale新增键，Host/公共合同与构建仍主线程集成。
- 已进入S2单入口对话+四列看板实现，S1阶段提交待新增审查反例/最终diff/三闸/pack，尚无提交，不push。
- 修复production旧live Worker恢复绕行：来源接入前先持久结束Assignment/票再interrupt；全生产Worker工具guard能力阻断，非超管preset不受影响；停止/拒批控制不被普通queueLimit饿死。
- approval action schema未知原型键已收紧hasOwn；执行不审阅不批准。后续审批分页/expiry接UI不会把首100条假装全量。
- 外部provider总0；无生产/安装/DDL变更；后续仍需完整GUI人工验收、L2架构授权/修复，当前只能部分实现不可交付口径。

## 2026-11-18T21:08:10+08:00 · S1补充门禁 / S2接线中

- 新29项审查反例已通过（共享Thread A/B事务定向、非法target无写、容量混合集合/await竞态、取消/拒绝不重放、未知审批schema/隐藏内容、生产guard）。四项追加runtime恢复用例已通过：拒绝计划SQLite恢复仍终态/释放容量、先持久结束旧live Worker再interrupt、missing canonical换epoch后归档只读且当前epoch旧票归属重验、普通chat连续7次/重启不耗容量。
- 21:10:38完整三闸与pack：37 files / 265 tests passed，typecheck/build/pack全部exit0，目录`s1-commit-20261118-211000/`，本轮新证据独立wx写入旧closeout原件未再覆盖。待只stage后端与自有证据，不stageUI/locale或用户dirty资料。
- UI子任务因子agent中断已接手，workspace/style完整落盘但尚未接入口；词典由独立小任务补全，不冒称完成。已知UI待修：旧draft禁发、待办更多、配置分组、卡片非交互正文、factory显式序列化、实际artifact/Host加载与人工视觉。
- 审查发现私有repo范围被安全脱敏时owner无法完整审阅，前后端都应禁止approve；新增handler回归通过。此前Host第3次passed只是当时合同证据，**不足以证明该私有scope授权可审阅**，保留旧回执并独立新fixture用完全可见的合成规划root复测；不伪造生产可交付。
- 未解决L1/L2仍关真实Worker，provider总0，无Desktop部署/DDL/依赖修改。

## 2026-11-18T21:18:14+08:00 · S1审查闭合 / UI构建

- 真实Host第4次以完全可见合成scope通过同链（`s1-20261118-211400-result.json`），保留第3次私有scope未完整可审阅的证据不足说明。provider0/local adapter3/liveAgents0。
- 独立审查最后指出flush等待期间追加cancel被旧snapshot漏看；已加deferred-flush真实splice反例并修：成功flush后重新读日志，只有flush前watermark覆盖的入站证据才可驱动业务，新取消仍优先拒绝。新30项adversarial与全部workspace/panel相关127tests/typecheck已通过；未把新取消存在自动解释成durability证明。
- UI main已改真正单一Workspace factory，保留3个自有slot（channel、sidebar、main），无root替换；builder显式序列化workspace/css避免跨模块闭包丢失，248对中英键补齐。typecheck/build通过，静态产物/注册测试正在更新到新设计；独立UI交互审查并行，均不等价视觉验收。
- 补修旧draft禁发/待办加载更多/设置归组/卡片attention非交互正文；UI子任务数次runtime中断但完整源码已保留，lead接手集成，不重复整项重做。
- 无生产provider/部署/核心依赖DDL修改，未提交失败；阶段commit待当前最后门禁+完整diffreview，不push。

## 2026-11-18T21:26:37+08:00 · S1提交 / S2独立review通过

- 后端已独立提交 `05a8ab8 feat(runtime): add durable scoped workspace input`。不是拿未暂存UI的绿灯替后端提交：将精确index tree导出自有`.probe/s1-staged-20261118-212700`、链接既有依赖、独立build/typecheck/267tests/build/pack全部exit0才提交；证据在`s1-staged-20261118-212700/`。源代码whitespace检查绿；失败原始日志含尾空格/EOF空行，专用git-check选项忽略其格式但原字节保留，没有为了绿闸清洗证据。
- S2新完整集成272tests/typecheck/build/pack exit0；VM真实client artifact只验证factory/3slots注册，不模拟DOM。UI独立review已冻结；修复404不得解锁新ID（原超时请求仍可能晚受理）、终态false flush不锁死草稿、stop超时后可重试、ticket审批135条全态分页、board409避免0delay忙循环、button内块元素改phrasing span。
- 两次git check因原始日志whitespace退出2均已诊断、未commit；只对证据路径临时忽略blank-at-eol/eof后检查通过，不改git持久配置；保护资料与S2文件仍未混入S1。
- 正在独立S4 Host probe验证3preset、真实client bundle资源、owner/Origin与清理；先前6个自有Host SQLite均assignment/trigger/eval/outbox非终态0、lock不存在，无superagent-dev进程。
- 私有scope可审阅问题与生产L1/L2阻断保持，不把UI完成写为工程闭环。

## 2026-11-18T21:41:34+08:00 · 真实Host/间接shell证据与普通功能补洞

- S2已独立提交`7d55411`，272tests/typecheck/build/pack绿，无push。
- S4 Host第1回执failed保持：仅错误假设单次local adapter，实际安装版自动标题另调一次。已读`dsh-session-title-llm/src/index.ts:265–284`确认purpose=session-title，独立第2fixture按purpose分计，结果passed（`s4-20261118-214000-result.json`）：main1/title1/外部provider0，owner200/unknown realPeer403/Origin403，3preset无broken，当前client exact artifact bytes由Host200提供，3slot factory注册，agents0/SQLite各非终态0。
- S0补齐24个真实native/Node/Python/heredoc/间接script/background case，全部allowed成功、crossTicket无文件、同票unlisted/deny均可写，full sandbox，provider0/agentsteps0/agents0，`s0-indirect-20261118-213300-result.json`为evidence-recorded。L2反证更完整，**不是执行安全通过**。
- 自有9个Host SQLite只读核查Assignment/Trigger/Eval/Outbox非终态0、lock均不存在，未删除历史与sentinel。
- 最后普通UX缺口未借安全阻断跳过：补pending计划expiry终态释放容量（跨epoch本地终态补偿）、计划>100分页、owner显式修改目标/第一步生成新指纹重新确认。准确项目身份可用Host owner home-relative完整后缀显示，不是hash别名；只隐藏home个人前缀，其他范围完整，secret/其他用户路径继续禁批。新功能仍在独立回归，未宣称通过。
- 原始S4失败、查询错误/工具无效替换保留诊断；安装包路径误用复数包名ENOENT已改准确单数定位。无修改DSH核心/依赖/DDL/profile/额外可写根或生产provider调用。

## 2026-11-18T21:53:20+08:00 · S3/S4最终回归与清理

- 最后普通功能修订独立审查已冻结；focused145/145、完整37files/283tests、typecheck/build/pack全部exit0，原始日志`final-20261118-215400/`。新增owner-home-relative规范repo无损审阅、同计划显式修改新fingerprint/旧版409、过期真实SQLite重开与跨epoch容量释放、103plans分页/第101精准审批。
- 最新产物再次真实Host：`s3-20261118-215400-result.json`passed（main2/title1/provider0）：精确home相对scope可审阅，owner改计划、旧指纹409、scope patch400，批准新brief只建一票、生产start仍SA_EXECUTION_BOUNDARY_UNVERIFIED、agents0。`s4-20261118-215400-result.json`passed（main1/title1/provider0）：3preset无broken、当前factory105920bytes/hash a2b74e2e…、Host资源200精确包含、owner/nonowner/Origin、单条user+assistant、dispose全0；不是浏览器/真实Worker证明。
- `cleanup-20261118-215800.json` actual21:53:20只读检查11个自有Host SQLite：非终态Assignment/Trigger/Eval/Outbox均0、lock无、dev profile进程0、dev:web watcher0。CLI未新建GUI监听服务器；所有历史/脚本/反例sentinel/SQLite/pack产物保留，不删用户资料。
- 最后保护检查脚本第1次exit1：全局把所有` 2 `替换为` 5 `作为期望误伤其他数字，不是原文被覆盖；改为逐文件准确原用户那一处阈值替换，再验证三文件字节一致exit0。无源码或用户稿修改。
- 新增完整逐项矩阵`KANBAN-ACCEPTANCE.md`、人工步骤`KANBAN-MANUAL.md`；当前只可称部分完成/不可交付，首次项目选择、unknown人工处置、带来源一键重建等普通UX缺项也明确列出，不借安全阻断掩盖。下一步仅最新文档包三闸/pack和选择性提交，不再扩范围。

## 2026-11-18T22:13:25+08:00 · 最后普通交互补齐，源码冻结

- 前三阶段已提交`05a8ab8 / 7d55411 / 6ceeee6`，无push；最终核对后继续补两个不受执行沙箱阻断的必需交互，未以“最后提交”提前停工。
- unknown请求可显式二次确认终止**路由**：先逐request串行真实Session/flush对账，只unknown+durablefalse+exact seq可CAS canceled，late日志仍可显示但不得ingest/唤醒/建票。queued/admitted/processing拒绝；不清Session/不停止模型/不宣称任务已停。28项command测试含并发flush/late log/旧epoch/终态不复活；await ingest后补读避免覆盖终态。
- 人工停止后“以此需求新建任务”只铺新草稿，不覆盖原草稿，不自动发送/执行；recreateFrom纳入digest（旧无字段hash不变），Host验证stopped+owned Decision lineage，journal originTicket持久、新Thread/新plan重新确认、不承袭审批，详情显示来源。SQLite reopen/归档/外国lineage篡改回归通过。
- 补充focused第1轮2失败：新增测试把raw SQLite stopped_by_human INTEGER1/0误写true/false；已按已核Repo表示修三断言，产品停止语义未放宽。后focused83/83、全量37files/**307tests**、typecheck/build均exit0，原始完整三闸日志`supplement-20261118-221200/`。独立快审无新增明显P0/P1，不等于浏览器验收。
- 最新真实Host补充`s3-20261118-221200-result.json`passed：main4/title1/外部0，owner修订/旧指纹409、已受理请求cancel409、停止原票、新request新Thread新plan明确批准后新票open+origin，旧票仍stopped，agents0；S4同标签passed，当前client109484bytes/hash d822109f…、Host200精确字节、3preset/owner/非owner/Origin及cleanup。未真实执行Worker。
- `cleanup-20261118-221500.json` actual22:12:56，13自有Host SQLite非终态Assignment/Trigger/Eval/Outbox0、lock无、dev进程0、watcher0；保留历史/sentinel/数据库/pack，未开启新GUI服务器或修改Desktop。
- 目标当前disarmed，尝试resume被Host拒绝“需direct human turn”；未重复绕过，未mark complete/blocked。源码冻结，最后文档同步/pack/提交后仅报告部分完成与明确执行安全/实际GUI阻断，剩首次项目选择等普通UX限制也单列。

## 2026-11-19T14:02:00+08:00 · GUI认证失败诊断与明确提示

- 用户提供截图显示工作区外壳已加载，但会话/四列都停在加载态。对当前 `127.0.0.1:52446` 裸地址实测：`POST /api/superagent/workspace`、`/board`、`/conversation` 均返回401，正文为 `dsh web authentication required`；因此不是空任务或SQLite数据为空，而是DSH Web认证层未放行。
- 安装版源码核实：Web首次访问必须使用DSH打印的authenticated URL（根URL带launch token，之后换签名cookie）；只开裸URL不会自动认证。未读取/搜索token/cookie，未修改Desktop profile，也未绕过认证。
- 为避免误导，客户端现在将HTTP401映射为`web_auth_required`，工作区明确提示“请从DSH打印的带认证URL重新打开”，而不是无限显示笼统连接失败。源码/locale/客户端合同focused **19/19**通过；完整门禁307/307、typecheck/build/pack均已exit0，原始日志在`web-auth-20261119-140200/`。
- 此修复只改善错误可见性，不把401变成成功，不伪造数据；当前页面仍需通过支持的DSH认证URL重新打开后，才能继续人工验证实际GUI。浏览器视觉/IME/键盘和生产Worker L1/L2阻断保持不变。

## 2026-11-20T15:35:00+08:00 · 从日志栏改为任务与决策

- 用户截图已显示“已连接”与真实历史，故撤回此前“匿名curl 401证明用户标签页未认证”的因果推断：匿名401只证明未带凭据请求被拒绝，不证明浏览器请求失败。历史认证记录保留，但不再列为当前页面已证实阻断。
- 用户两次指出左栏仍为Fixture/UUID/投递流水；前次只解释未修改。本次实际实现默认“任务与决策”，分待决策、任务进展记录、最近结果记录；从未筛选账本读取，最多6条/组且显示完整total、快照和全部入口。没有删除历史、按Fixture名称猜删数据或把测试记录改名为业务成果。
- 对话历史显式切换保留；投递阶段折入技术详情。最新真实助手回复独立于30条历史窗口，避免被通知淹没；只当原始沟通，不凭正文推断任务/审批。回摘要恢复当前交互上下文但不迁移旧草稿/请求/目标；摘要滚动不再跟随历史自动滚到底部。
- 计划摘要可展开完整范围后复用原确认/CAS；过期显示过期、不可批准，已批准未建票不再提示待批准。审批、补答、状态异常分开，孤儿审批导航全局审阅；结果不凭report.ready改Ticket outcome。全字段脱敏，恶意文本仍为React文本。
- 一次focused失败仅因旧测试要求会话标题，更新为任务摘要合同；后focused57/57、全量38files/319tests、typecheck/build/pack全部exit0，最后门禁在`briefing-final-20261120-153800/`（此前两轮也保留）。独立UI/UX复审无新增P1，两个P2（到期显示、兜底语言/未知结果）已修。
- 用户明确允许只关闭再启用超管插件。受支持plugin_manager两次均返回`application=restart-required / restartReason=unmanaged-plugin`，未热应用；已恢复enabled=true，live fiber仍active。未重启DSH、未改其他插件或安全门。当前进程需完整重启后加载本次后端和revisioned客户端资源，不能把构建成功宣称当前GUI已变。
- 本次可识别标志：左栏标题“任务与决策”，默认“业务摘要视图 · v2”，旁边“对话历史”。真实Host摘要/独立助手回复/新版资源回执`s4-briefing-20261120-153900-result.json`passed，artifact123021bytes/hash99f67dca…、owner200/非owner403/Origin403、agents0与probe锁清理通过；当前安装link指向本工作区。重启后用户截图仍待核。无浏览器控制，不造DOM/截图补证。

## 2026-11-20T16:02:00+08:00 · 按真实使用流程重做左栏

- 用户截图已证明v2加载但难用：重复标题/切换、两次历史入口、版本/口径大段说明、空决策、庞大编辑区。认可这是设计失败，不归咎用户或缓存，也不以测试数量辩解。旧v2与原始证据保留。
- 默认左栏“交给超管”，唯一历史/返回次级入口；无待办时给“有什么事想交给我→描述任务”的行动空态；有事项只呈具体计划/问题/授权卡与明确审阅按钮。动态合计最多3行，只有截断才给更多，隐藏的已确认计划/审批/补答各有入口。新增纯deriveDeskState，不从文字猜审批/Fixture，不用未知或陈旧数据宣称没事。
- 编辑区两行、紧凑footer，明确“规划任务/问一问→生成计划/发送”，目标补充保持显式；仅全新状态default new-task，合法旧草稿（包括空白）原intent不迁移，pending原payload/id不可变。安全一行“仅规划·执行关闭”可展开，缺能力显示未知，后端/执行门不改。
- 最近旧回复不在日常主屏重复露出；新回复短预览+全文/回复入口，实际打开才本标签标记已查看（非服务端已读ACK）。空历史/首条澄清、发送抢先首读、刷新未读、归档均新增执行闭包反例；每tick也同步当前epoch，收起/窄屏保留提示，旧草稿不被回复覆盖。
- UI/UX独立复审找到并修首条回复漏提示P1、collapsed提示、total>0假空、归档poll、关闭面板焦点（含disabled input fallback）、隐藏计划导航P2；全文/计划面板内部不在inert子树，背后消息/输入暂不可聚焦；完整范围/CAS仍在。没有假DOM/截图验证。
- 首轮build失败为actionTotal nullable，修为显式null处理；focused一次失败为旧boundary静态合同，改验可展开安全提示后通过。最终client76/76、全量40files/372tests、typecheck/build/pack exit0，证据`desk-final-20261120-160500/`。Host资源+序列化依赖+摘要/助手回复见`s4-control-20261120-160800-result.json`passed，artifact140319bytes/SHA256 3d0f4711…、owner200/nonowner403/Origin403、agents0。首个desk命名state路径因`desk-`包含敏感前缀`sk-`被既有契约拒绝，failed原始回执`s4-desk-20261120-160300-result.json`保留；只换新probe路径为control，未削弱生产敏感检测或重跑未知投递。
- 未再次改profile或擅自重启DSH；之前管理器返回restart-required/unmanaged-plugin的回执仍成立。源码build不等于当前页面更新，当前无dev:web watcher/浏览器控制；重做版识别为“交给超管/历史”和“规划任务/问一问”，不再有v2版本横幅。待用户加载后核实真实视觉/交互。

## 2026-11-20T16:19:00+08:00 · 纠正跨会话统计口径

- 用户指出其他DSH会话有正在进行的工作、看板却全0。源码核实不是当前epoch过滤：readBoard读取整个超管Ticket台账；SessionSource只绑定Router、普通会话未接入。原“全部任务总数”误导，不能要求用户重复描述工作或将空台账解释为没有工作。
- board DTO新增显式`scope.kind=superagent-ledger / otherSessions=not-included`，全局header提示未汇总其他会话，mobile默认chat也可见。统计/查看全部/空态限定已登记任务，旧无scope响应显示范围未知，辅助空态也不猜覆盖；区分筛选无命中、真实零、非零总数却无加载记录。去掉包含已确认计划的recordTotal→Ticket导航数字，避免有计划却看板0的另一次误导。
- 未添加跨会话扫描、正文读取、模型摘要、自动导入/重复建票或任何会话控制。安装版只读契约研究已记录在[会话覆盖](<KANBAN-SESSION-COVERAGE.md>)：header目录+Agent状态可被动读取；列表projection可能含内容；标准导航follow activate:true可能激活cold Agent，不能后台逐个打开充当观察。后续任务/决策汇总的读取范围与控制必须另行明确，不从本次询问或旧自动目标推定。
- 独立UI/UX只读评审无新增阻断；initial focused94/94，final全量40files/374tests、typecheck/build/pack exit0（`coverage-final-20261120-161900/`）。新增真实SQLite只读反例：不同session lineage任务同板可见、scope不随零数/筛选/分页变、SELECT无DB写、浏览器任意session/epoch拒绝；执行真实scope谓词验证旧/未知服务failclosed，没有DOM模拟。
- 真实Host最终资源+board scope/owner200/非owner403/Origin403回执`s4-coverage-final-20261120-161900-result.json`passed；外部产品provider0，Router为本地确定性fixture，agents0/锁释放/DB静止。早一轮scopeHost回执也保留。新版实际页面/主题/IME/焦点仍不可验，未重启或改profile，生产Worker仍关闭；整体目标继续未完成，不能把统计口径修复称为跨会话汇总交付。

## 2026-11-20T16:33:00+08:00 · 长标题与结果的阅读路径

- 用户实图证明“交给超管”已加载，但详情header把完整Harmless acceptance fixture指令当h2占多行，结果首屏又是attempt日期/steps/token/ready/todo嵌套字段。原因是直接绑定Ticket.title和valueView(report)，不能把本次问题再解释为未更新。
- 仅展示层派生字面首句/首行、64码点短label；详情header单行ellipsis、close不缩，卡片两行、动态短标题。四tab共用正文“查看完整任务原文”可展开，不改DB/原始title/brief，不按Fixture猜重命名为业务任务、删除或筛掉测试记录。
- 结果阅读顺序改台账权威状态→做了什么→报告验收→需人工，风险/后续非空或未知时仍显示；attempt元数据、原始report及投递状态退次级折叠。完整报告、changedFiles、记录仍保留，不把report.ready/passed晋升Ticket完成/真实验收，需人工还核对ticket attention/pendingApprovals/anomaly。
- 精确currentAssignment优先；没有当前指向才在全部startedAt有效且唯一最新时选，日期缺失/并列/指向缺失都不猜，最新无report不拿旧ready顶替。验收逐brief ID比对，缺项/重复/未知/结果或证据无效不显示通过汇总；schema允许的混空字符串风险/人工项过滤空白但保留有效原文。
- 独立UI/UX复审找到并修“多attempt缺日期误选旧报告”“混空串隐藏关键信息”两项，收口无剩余阻断。firstfocused1fail是新静态测试把ternary label断言为固定调用，修测试语义后78/78；新增纯闭包84tests，最终41files/459tests、typecheck/build/pack exit0（`readable-final-20261120-163300/`）。无React/DOM/截图模拟。
- 真实Host当前bundle/序列化helper/3slot/board口径/持久对话/Worker关闭回执`s4-readable-20261120-163100-result.json`passed，外部产品provider0（Router本地确定性适配器）、agents0/DB静止/锁释放。没有真实用户会话扫描、模型标题翻译、profile/restart或安全门变更；本轮修复尚无实机视觉证明，整体S0→S4仍未交付。

## 2026-11-20T17:25:00+08:00 · 企业微信文档任务来源

- 按用户要求先读types/registry/session/config及runtime/workspace准入链，明确沿Source→Trigger，不做文档管理。真实连接器原响应是display text+images，无稳定rowID/删除线；经用户“实现完整功能”反馈一并授权最小连接器增强，不以空metadata冒充没有删除线。
- 新manual Source/config、ctx.tools.execute固定只读MCP契约、私有原文与图片SHA工件、工作区本地候选/分页/原文/实际图像、真实human new-task+request-bound readonlycontexttool和现有计划确认。外部trustsystem bottrue addressednone原engine只filtered，不伪造human，不自动授予mandate。文档规划turn额外禁cancel/start/stop/resume工具，不让提示注入控制其它任务。
- 独立审查4项均接纳：claim+journal之间崩溃→同事务beforeInsert；staleorigin全局recover异常→只拒绝本请求；final证据文件半写永久失败→temp+fsync+原子publish及精确owned损坏文件修复；非空来源allowlist导致归档任务补充静默filtered→增精确ownedbindings并拒假成功。真实SQLite定向反例已通过。
- 协议研究只读腾讯官方公共bundle，静态typeTable+property路径证明CTFontfield11wrappedbool/field12null；未执行remoteJS。最终render默认false不等于partialdecoder可断言false，继承/条件/表格/透视格式有否证，不隐去限制。受限connector补丁/typedmodule/tests纳入可审查工件，未重载运行中MCP/改profile/读取私人文档。
- 补明确人工核对路径：未知删除线不冒充no，只有其他证据完整且无已知yes时，owner可打开官方原表后精确快照留核对声明；原unknown不改、不升信任，后续仍真实new-task与完整计划批准。Source重提取校验、原warnings保存批次否决；scan开始撤销receipt，digest变化/失败/不完整/配置epoch变化均不能复用旧声明。新Source68focused/UI63focused、unknown/no两路生产模式SQLite准入均通过；最终46files/569tests、typecheck/build通过（`wecom-final-review-20261120-173400/`）。首次fullgate失败为未先重建新的locale，与真实artifact新旧不一致；先build再完整门禁通过，不放宽测试。连接器165passed125skipped，真实SDK离线工具调用证实str list_sheets自动{result:str} structuredContent，typed snapshot直接结构，普通content仅摘要。真实Hostconfiguredsource冷启动不remote读、owner本地list200/nonowner与Origin403、任意doc字段400、无证据image409、新人工核对未知snapshot409/nonowner和Origin403；最终155项pack内容检查通过，生产Worker关闭；firstseam文案拼错探针failed保留后修probe重新passed。外部产品provider0、agents0、SQLite静止。不是GUI或真实企微端到端，整体安全闭环仍未完成。

## 2026-11-21T11:25:00+08:00 · 默认跨会话来源、手动排除

- 用户截图来源仅一个超管Session，再次指正跨会话缺失；确认范围“默认纳入，手动排除”，不是仅更换覆盖提示。新read-only SessionWorkSource注册、当前Host目录先身份/内部归属/排除过滤再selectedprojection，默认包括普通fork，不把其parent误当subagent。
- 复用原workspace/source抽屉，不做会话管理器。已有目标/步骤/下一步/阻塞/明确问题只读卡；已登记任务/审批数字不混观察数。排除/恢复只改原kv稳定ID偏好，重启仍效；无原会话写入、激活、建单、自动模型摘要。
- 安装版源码精确核实listSessions/inspectSession/selectedsnapshot，cold内部会重放完整日志但不resume；不虚称metadataonly。userQuestions.continued仍可答，legacy和通用审批仍缺；raw events/历史答案不下发。15s缓存、每页20/并发4、preview6/运行优先，页revision冲突重同步。scope当前Host，不跨profile/机器。
- Source5组反例、UI215focused及主45focused通过，最终49files/585tests、typecheck/build/pack均exit0（包158项内容检查通过）（`sessions-verified-20261121-113000/`）。首次全量门禁因独立fallback类型未声明revision触发tsc2，补显式返回类型后整体通过。独立审查唯一P2为并发排除触发summary409拖主workspace，已以summary独立降级及发送仍可用回归关闭。首Hostprobe403纯文本解析失败，二次probe变量重名未激活，修probe后[实际Host受控验证](<../probes/kanban/session-work-20261121-112300-result.json>)passed；只读普通/fork/child去重、exclude无再读、restore仅membership、owner/Origin/epoch/字段边界、零Ticket/Trigger/Assignment/模型completion。未读取私人业务全集，未修改profile/重启当前GUI，视觉仍未验。

## 2026-11-21T11:38:00+08:00 · 任务优先整页重设计

- 用户实图确认新版已加载，仍丑且层级混乱；撤销继续以未刷新解释的口径。沿已选03看板方向，从看任务/做决策/描述新目标重新排整页，不添新管理页面。
- 主区左、沟通304px辅区右；决策主区前置、来源最多3短卡、recent折叠；整页主区统一纵滚，四列minmax0不截断末列。1050实际容器切完整任务/对话默认任务、720两列、440单列；打开完整审阅临时扩大辅区。空台账全列精确0/空items/无分页/无错误才单短空态；unknown优先筛选文案，不宣称无工作。
- 顶部去除范围长声明和独立全宽安全横条，安全位仍常显可展开；发送不可用靠近输入，来源失败一行局部可达。Budget与raw attention不再撑卡，完整字段仍在详情；来源管理不截目标/问题。原草稿、unknown请求、显式target、完整审批和Worker关闭不变。
- 独立UX终审确认根因方向，两项收尾均修：来源完整文本路径、非空卡技术噪声；新增AST/CSS7组含12个真实空态initializer反例，postcommit focus守卫不当作真人焦点证据。focused179通过；最终50files/592tests、typecheck/build/pack均exit0（159项包内容校验通过）（`workspace-task-first-20261121-113800/`）。初focused失败含过时布局断言/新增CSS注释解析和不允许的transparent/currentColor声明，定位后对齐布局语义、保留token门禁修改产品，不弱化安全测试。无浏览器控制，不启动shellbrowser/替代服务/假DOM，无新实机截图，不声称视觉验收已通过。见[版式合同](<KANBAN-TASK-FIRST.md>)。

## 2026-11-21T11:52:00+08:00 · 会话以项目为第一层

- 用户纠正“会话要按项目来”，按人使用层级重排工作区和来源管理；项目标题→会话目标/进展/问题，不新增项目CRUD、scope选择器或另套会话管理。
- 安装版真实API核实WorkspaceRegistry.id/title/sessionIds，主界面也按精确成员关系归组；不用headercwd/currentworkingdir/Gitroot猜。Host注入与TypeScript一致，只读list同步索引、无新日志读取；raw path不出adapter。成功无匹配unassigned，缺服务/异常/歧义/deny unknown且partial，零ordinary亦不造ready。
- 项目快照纳入revision，cache前/内容异步后复核，项目名称/成员/权限变化409重同步不发布旧关联。UI精确key聚合已加载页，同名项目短ID碰撞延长；预览返回6条中最多3组/各1条，来源已加载计数与global更多，不假项目全集。同名无归属来源短ref及可展开完整ref可辨识，默认纳入/持久exclude/restore不变。
- 两个只读子审查收尾均采纳：同名来源区分、emptyroster registry错误partial。focused82、最终50files/598tests/typecheck/build/pack通过（159项包内容校验通过）（`project-groups-final-20261121-115200/`）；firsttsc显式回调类型补后通过。真实Host[registry受控回执](<../probes/kanban/project-groups-20261121-115000-result.json>)passed：probe自有未attach会话即使有cwd也unassigned，不创建/attach真实workspace；私会话正文0、模型completion0，owner/Origin/epoch/任意字段、子会话去重与exclude无再读仍通过。多项目join是明确fake registry+真实SQLite回归，不称用户项目端到端。GUI/视觉未验，不改core/profile/执行安全门。

## 尚未通过的强制门禁

- L1 生产spawn首工具前Ticket根与L2逐路径强制 **实证失败**：真实native/Node/Python/脚本/后台同票unlisted/deny可写；生产Worker保持关闭。不是仅缺证据，不以prompt/删shell/stub代替。
- 无浏览器控制工具；当前连接 GUI 视觉/IME/主题/console 必须保留人工验收，不自造 DOM/截图。
- 未开始真实产品模型调用、Desktop部署、迁移或权限提升。
