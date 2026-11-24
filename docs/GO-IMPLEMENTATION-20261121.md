# Go 实施核对与证据（2026-11-21）

实施授权：用户要求按 [开发提示词](<superagent-design-20261121-v2/PROMPTS.md>) 开发。设计包原文、既有未提交文档及探针保留；这不是安装、部署、迁移或提交许可。

## G0：只读核实

运行安装版：`@deepseek-ai/dsh 0.2.2-rc.5`，Electron `44.7.0` / Node `24.21.0`。工作区 shell Node 是 `22.23.1`，因此测试、类型检查、构建使用 `ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE"`（安装版 runtime）。没有 Inspect / 浏览器控制，源码合同不是实时挂载和真实 GUI 证据。

| 已知能力 / 缺口 | 证据与处理 |
| --- | --- |
| 已有可信 Host 项目成员、普通会话结构化工作观察、默认纳入与会话排除、异步失效 | [Source](<../src/sources/session-work.ts>)、[Host 接线](<../src/runtime.ts>)。不靠 cwd / 标题猜项目；不读所有聊天来定位。 |
| 现有命令仅文本到超管 / Ticket lineage | [命令](<../src/workspace/commands.ts>)、[投递](<../src/workspace/ingress.ts>)。可复用 digest / CAS / dispatch fence / unknown 对账；不等于普通会话控制已实现。 |
| 普通会话实际控制 API | [controller prompt](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/index.ts#L468>)：`prompt(request, signal): Promise<{accepted:true}>`，请求含 `requestId/sessionId/mode:queue|steer/content`，没有统一 `submit`。`control(signal)` 是投影流而非命令；[agent resolve](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/agent.ts#L151>) 支持普通 cold/live，拒绝 subagent-origin。未做真实控制探针。 |
| 幂等不能直接沿用 Host ID 去重当完成保证 | [commands](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/commands.ts#L389>) 仅按 ID 记忆，不比较正文 digest；适配层须补冲突/版本/fence/最小证据对账。`accepted:true` 不是完成或人已读。 |
| stop 与 queue 管理 | [commands](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/commands.ts#L447-L539>) 的 `updateQueue` 支持 edit/remove/steer，`cancel` 对 live 普通 Agent；不能把申请当已停止。 |
| 模型扩展点 | [LLM prepareCall](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/src/index.ts#L975>) 支持逐次固定配置；[Agent model](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent/src/runtime-types.ts#L71>) 的 `model.select` 影响下一未准备 step。现有 session `selectModel` [写全局默认](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/commands.ts#L180>)，不能当阶段配置入口。 |
| 原图链不能直接复用附件 API 冒称闭环 | [附件读取](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/commands.ts#L427>) 不验证图片归属，不能充当范围闸；[本地图片存储](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-attachment-local/README.md#L88>) 可缩放/重编码，不等于原始字节保真。generic file 保真但视觉能力另验。 |
| 视觉未知不等于支持 | [prompt admission](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-api-session-controller/src/commands.ts#L352>) 仅已知否定时拒绝；[LLM](</Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/src/index.ts#L1120>) 可把 text-only 历史图降占位。Go 需要严格能力与原图引用检查，不能沿此默认放行。 |
| 来源接入 | [当前配置](<../src/config.ts>) 仅 session/inbox/wecom-document。企微连接器不等于 docs.qq.com；腾讯表格/普通文档和本地格式仍须逐类实现/验证，支持矩阵未最终确认。 |
| 权限与安全 | [已知限制](<KNOWN-LIMITS.md>) L1/L2 未通过，生产 Worker 关闭；普通控制不能成为执行旁路。Host/Origin 不是身份，保留既有 owner/Origin/epoch；本轮不修改 profile 或核心。 |

## 首个最窄切片：G1 范围与无副作用定位

使用路径：管理范围 → 完整分页的项目目录（含空项目）→ 当前项目会话 → 排除/恢复回执。范围由真实成员和稳定 ID 计算；项目排除优先，会话显式排除保留；恢复不激活、不重投、不复用批准。归属 unknown 仅呈现元数据，禁止读取工作正文和定位。

复用现有 `kv` 存储独立项目 ID 集与递增 scope version；保持 legacy 会话排除 key 不变，不改 schema、不迁移用户数据。递增序号防止“排除→恢复”把旧授权版本重新变有效（ABA）；版本是撤权 fence，不是新许可。

无副作用定位使用已获准的有限结构化目标与字面检索，不声称自然语言模型定位已实现。显式 session ID 仍重验当前目录、范围与归属；标题独命中只追问，同名不盲投；最多核实 100 项，超出或证据不全显示 partial/blocked，不把首个摘要页当全集。定位结果始终 `controlAvailable:false`，不是控制成功或执行授权。

## 验证记录

- 修改前基线：50 files / 598 tests 通过（Electron Node 24），未连接 provider、未控制用户会话。
- 第一轮范围代码定向：37 tests 通过；typecheck 发现项目目录 DTO 扩大了 `sessionWork` 返回联合类型，旧测试仅以 `items` 判别不足，改为同时判别会话 `scope`。此为类型合同修正，未删测试/降断言；下一轮须重新验证。
- 首轮全量门禁 690/693 通过，3 项失败已调查：旧 Client AST 测试不认识新增非执行定位字段；精确 route 清单缺 `session-locate`；artifact 检测到构建前旧 locale。修正的是精确新接口白名单/清单，命令直投仍禁止；先构建最新资源再完整回归。
- 第二轮：typecheck / build / client syntax 与 54 files / 693 tests 全通过。独立对抗复核补修：定位不复用 15 秒旧事实或 summary 在途读取、定位及项目目录迟到结果重验内部归属/访问/停止状态，均有反例回归。
- 独立 UX 静态复核另发现 3 项，均补修并增加反例：原操作回执独立于导航且标原 epoch；保存后有界重读原已加载项目窗口并恢复项目/tab；同名候选返回脱敏限长命中字段和片段作为文本显示。随后门禁 54 files / 701 tests、typecheck/build/syntax/pack dry-run 通过，包清单 162 项。
- UX 再复核发现同一导航路径的遗漏：同 epoch 的精确保存回执若在 Sources 页到达，旧 Sources 分页缓存未失效。已补同 epoch 失效与观测 generation，拒绝旧在途响应回填；跨 epoch 不清新页缓存。定向 43 tests、noEmit、diff check 通过；全量最终门禁证据位于 [G1 最终证据目录](<../probes/go/g1-final-20261121-TXjpyJ/>)。旧 flight 期间新读取不自动排队；完成后保留显式刷新，不盲重试。
- G1 最终门禁：54 files / **704 tests** 通过；typecheck、build、client syntax、diff check 全部 exit 0。见 [测试日志](<../probes/go/g1-final-20261121-TXjpyJ/test.log>)、[构建日志](<../probes/go/g1-final-20261121-TXjpyJ/build.log>)。所有新旧测试使用本地合成 Host / 隔离 SQLite，无 provider 或用户会话控制。
- 未运行真实 Host 探针、未安装更新，原 GUI 的视觉/点击/IME/焦点/主题/窄屏均 unknown；测试不是 R1—R5 或 A01—A15 完整验收。

### 原 URL 人工检查（均待验）

在原 DSH GUI `http://127.0.0.1:59762`，经另行授权加载新版后：设置 → 管理范围 → 空项目/同名项目 → 单项目纳入/排除；核对真实保存回执与排除不停止提示；回来源确认旧正文消失；项目第二页保存后返回原项目；定位同名候选的目标片段、明确选择重验、partial/blocked 文案；导航和保存并发不改草稿/目标。浅/深主题、窄屏/短高度、Tab/读屏、焦点返回、中文 IME 输入和 Escape 候选取消另验。当前没有浏览器控制，未启动替代服务或伪造截图。

## 需求 / 验收映射（本切片，不代替最终规格）

| 范围 | 当前证据 | 未通过 / 未验 |
| --- | --- | --- |
| R4 / A02 / A11 | 项目目录含空项目；项目与会话排除优先级；持久递增版本；改名/移动/重启与新增会话反例 | 真实安装 Host 项目与 GUI 保存未验；“所有”仅当前 Host，非其他 profile/进程/机器 |
| R1 / A01 / A10 | 有限字面定位；结构化目标命中、同名追问、显式选择重验；伪造ID/注入不能控制 | 完整自然语言定位、普通 cold/live 执行、人类指令→持久目标回执仍未闭环，不能宣称 R1 完成 |
| R4 / A12 / A14 | 读前/读后/发布前范围、归属、访问与内部 lineage 重验；排除迟到拒绝、恢复不重放；范围 ABA fence | 实际已 dispatch 控制、附件撤权、原会话停止与崩溃回执尚待 G2/G3/G6 |
| R2 / A05 / A06 | 保留既有结构化进展与问题观察，不用 idle 当完成 | 集中精确业务回答/操作审批、自由输入联动与全部 legacy 问题投影尚待 G6 |
| R3 / A07—A09 | 保留既有企微来源及其真实类型边界 | 腾讯文档与本地来源目标矩阵/解析未交付，本切片没有裁剪原需求 |
| R5 / A13 | 核实逐次模型合同与全局默认副作用风险 | 六阶段路由设置/实际调用披露未实现 |
| A15 / 页面建议 | 仅新增范围与定位的分层设置路径和契约测试，主题 token 复用 | 总壳/hash/独立主对话等仍未实施；真实焦点、IME、窄屏/主题与当前 URL 未验 |

## G2 可安全验证部分（真实控制仍受阻）

已实现 [动作服务](<../src/workspace/session-actions.ts>)、[精确目标绑定](<../src/sources/session-work.ts>)、Host 与受限端点接线及定位后的渐进核对界面。普通会话仍是目标，不复制为Worker；生产gate常量拒绝，未注入dispatch/evidence，也没有配置或HTTP旁路。`continue/supplement/steer` 当前只核对并保存受阻动作metadata，不能据此说普通会话真实控制通过。

人类直接文本 → 精确目标scope/fact → Host gate → 持久记录/dispatch fence → 独立合成目标受理证据 → 人话回执的合成cold/live链已覆盖。稳定request/action及digest、合法seq迁移、global unknown保留、重启只对账不重投、人工stop/ABA、恶意evidence、绑定/gate回调变参等有回归；不读取私聊全量，不用服务journal自证目标成功。详情与安装版控制/持久性合同见 [G2 协议与核实](<GO-SESSION-ACTIONS.md>)。

界面精确绑定独立草稿与原动作回执，不改主composer/浏览目标；blocked明确未投递，accepted/unknown不谎称未执行或完成。blocked后只经显式点击保留旧证据再建新草稿；初次目标校验前失败的无记录unknown，可明确请求Host永久封存原ID，墓碑与status证据闭环，不能拿404当未执行证明。已有dispatch未知不会被封存释放。旧epoch未知仍禁止新动作，此处尚无跨epoch恢复入口。

G2 可安全部分最终门禁：**58 files / 959 tests、typecheck、build、client syntax、diff check 全部通过**，证据见 [本轮目录](<../probes/go/g2-20261121-88V8Ui/>)。UI/UX已独立静态复核并补上述恢复/可及性路径；实际GUI、真实Host控制、人工停止可靠投影、跨epoch恢复和资源多actor互斥仍未验，不标G2完整通过。

## G3—G6：已集成的安全切片（不是完整功能验收）

### G3 图片

[原图合同](<GO-IMAGE-LIFECYCLE.md>)、[原字节存储](<../src/workspace/image-bytes.ts>) 与 [生命周期](<../src/workspace/images.ts>) 已接 runtime / HTTP / 图片草稿 UI。支持明确受限的 8bit 非交错 PNG 上传与粘贴、原字节 digest、独立缩略列表/单图/放大、当前范围与精确目标绑定、后续访问撤权、in-flight lease 阻止释放。上传不是发送；无真实 original-image provider/目标可访问适配器，不能宣称模型看图或 G3 完整通过。其他图片格式仍是缺口。释放不物理删字节，GC/备份保留与动作/调用关联未闭合。

### G4 来源

[本地来源](<GO-LOCAL-SOURCES.md>)：显式 Host `localSourceRoots`（默认空，不推导为工作区授权）→ 单明确 MD/TXT/CSV 配置 → 手动采集 → 原文/原图 → 稳定候选/变更 → 人类核对 → 独立草稿，不自动 ingest/执行。2026-11-23 新增无图条目的显式带出处计划入口：只在空当前主稿填入固定计划请求，原稿保留，另行发送、来源重验及计划确认；含图入口仍双端阻断，不省图。CSV 强制唯一非空编号与结构化敏感列拒绝，模型证据只取派生选中行并明确非逐字 CSV，不连带其他行。Markdown 根内图片为校验原字节与 digest，不是模型视觉证明。便携 Node 路径防护为检测型，不冒充 openat 内核隔离。草稿到受管目标的真实完整链仍未接通。

[腾讯在线表格](<GO-TENCENT-SOURCE.md>)：独立 docs.qq.com 连接器和配置 UI，不改名企微连接器。精确 fileId/sheetId/A1/字段映射、CAS、后台固定官方 GET 的受限 transport 已实现并合成验证；生产未注入 OAuth/credential/transport，手动读取返回持久 `blocked / tencent_sheet_auth_unavailable` 回执。即使合成读取成功，原图完整性/远端原子 revision 未证，始终 partial、imageSeen false、eligible false，不提供伪承接。腾讯普通文档、本地 Office/PDF 仍未实现，保留目标支持矩阵，未获用户批准删除/缩小需求。

### G5 阶段模型

[模型合同](<GO-STAGE-MODELS.md>)、默认+六阶段继承/覆盖设置、精确 provider/model 元数据与推理档、能力 known/unknown 披露、配置 CAS、revision 能力基线持久化已集成。现有 Agent 模型保留；不调用全局 selectModel。相同配置版本下能力/默认推理档漂移会 blocked，旧无基线配置不能静默补成支持。Host-only prepared call 合同有合成实际 stream/config/receipt 测试；真实 runtime 仅 catalog，不注入外发端口。rc.5 middleware 在本地 checkpoint 后仍可 await，缺最终 provider I/O 原子许可，因此不能启用真实阶段调用，也未接替现有 Router/Worker 工作链。

### G6 进展 / 业务决策 / 结果

[会话事实](<../src/sources/session-work.ts>) 新增最多3条脱敏去重已做、正做、下一步、阻塞和结果声明；goal complete / todo completed 不转为验收成功，`acceptanceVerified:false`。所有普通会话的完整操作审批尚无可靠投影，明确 `approvalCoverage:unavailable`。

[精确业务问题](<GO-DECISIONS.md>) 已接 selected `userQuestions` 投影、独立列表→单组原题→建议/补充条件/自填/显式跳过→精确回执与历史草稿。隐藏条件不提交，问题 ID 支持有限 Unicode 且 prototype-like ID 不读继承属性。approval/plan-review intent 不剥离为业务题；生产 prepare 只留 blocked metadata，不存原题/答案，不注入真实 answer/dispatch/evidence。2026-11-23 已补 G6 缺记录原 ID 封存：完整原 payload 的 digest 墓碑及指针同事务，迟到 prepare 不投递；界面二次确认、严格 closed 回执、超时后只查原 ID。已有真实 receipt 不封存、不降级，跨 epoch 恢复仍保持锁定人工核实，不能把404当未投递。父工作/子任务 drill-down、完整审批和真实验收证据链仍未全交付。

### 共享配置回执与整合修复

[配置 mutation journal](<GO-CONFIG-MUTATIONS.md>) 将 local/Tencent configure/remove/scan、stage save 的真实 core SQL 与 settled 回执放在同一事务；stable UUID + canonical digest + CAS。明确 rejected 可继续编辑但不偷换旧 CAS；丢回执只查原 ID；仅缺记录可显式封存 ID，阻止迟到重做；recorded 不可封存绕过。不靠列表相同猜保存成功。runtime 入队前复制完整请求，避免调用方改写导致摘要与实际配置不一致。

整合已修并回归：Host state root 的 macOS 路径别名与 private child symlink 区分；PNG CRC/高位 chunk 类型/zlib 尾随数据；授权返回对象在后续 fence 前快照；问题与 evidence 先快照后回调；canonical 键排序不导致模型保存永远 unknown；旧 local/model/Tencent 回执留历史但不覆盖刷新后的更新配置；local claim 保留原 requestId。新增 HTTP+真实隔离 SQLite 端到端合同测试，不以 fake provider/工厂 hooks 冒充浏览器或真实外发。

## 最新证据与逐项 A01—A15 核对

**2026-11-23 后续本地来源计划接线：** [验证说明](<../probes/go/local-plan-20261123-1sgYbd/VERIFICATION.md>)、[跨层门禁](<../probes/go/local-plan-20261123-1sgYbd/test-integrated-final.log>) **29 文件／814 项测试通过**；typecheck/build/syntax/diff 通过。无图 MD/TXT/CSV 独立稿可显式携带当前 epoch 出处填入空主稿，另行发送和审阅计划；来源重读、独立命令原子 reserve、settlement 后补链、失效请求恢复隔离已接通。补修 CSV 敏感列与派生行检查，模型只收所选行、不连带全文件。含图材料仍拒绝此桥，不省图。此门禁与前一轮选取文件不同，不相加当全仓库通过；真实控制／阶段调用／GUI／广义来源仍未完成。

**2026-11-23 原稿重构与答案恢复证据：** [验证说明](<../probes/go/unified-20261123-H25Q1F/VERIFICATION.md>)；[最终集成门禁](<../probes/go/unified-20261123-H25Q1F/test-integrated-final.log>) **22 文件／695 项测试通过**。原稿固定壳、hash、项目观察、单项决策、图文入口、范围／导航迟到防护及缺记录答案封存均包含在本轮；typecheck/build/syntax 通过。初轮 4 个旧夹具／断言不匹配、随后 1 个透明 tab 边框断言均保留失败日志并修正；不放宽回执、撤权、发送或主题 token 合同。这是受影响集成门禁，不是全仓库或真实 GUI／控制验收。以下 2026-11-21／22 数字为历史证据，不能当成当前全量结果。

历史证据目录：[G3—G6 集成门禁](<../probes/go/g3-g6-final-20261121-3XwV0v/>)。首轮全量 1385 中26失败，根因 image root OS alias 引起24个旧 runtime 启动失败及2个新 factory 参数 harness 未更新；保留失败日志并修复，不删旧回归。随后71文件/1396测试、typecheck/build/syntax/diff均通过；对抗复核又修队列请求变参并补 Host 单选限制，post-review 全量71文件/1398测试与typecheck/build/syntax/diff通过，见 [完整回归](<../probes/go/g3-g6-final-20261121-3XwV0v/test-post-review.log>)。最后同类 G2 epoch 回调的授权快照顺序亦修复并补反例；主区调整前最终完整回归为71文件/1399测试通过，此结果仅覆盖当时版本。最新主区调整证据在 [2026-11-22 目录](<../probes/go/g3-g6-ui-final-20261122-g51inn/>)：独立复核修复隐藏对话滚动锚点被消耗、Escape越层关闭和peer导航恢复旧焦点，相关 [最终UI与已构建bundle合同81项](<../probes/go/g3-g6-ui-final-20261122-g51inn/test-changed-ui.log>)、typecheck/build/syntax/diff通过。最新全量不通过：一次1397/1403通过、6超时；另一次1398/1403通过、5超时及1个worker RPC错误。超时发生于不同用例，系统有同期睡眠记录但尚不能确定全部根因；备用Node24被原生模块签名校验拒绝。没有提高超时、重试放行或把定向通过替代全量。按同路径失败规则暂停继续重跑，详见 [验证失败与下一条件](<../probes/go/g3-g6-ui-final-20261122-g51inn/VERIFICATION.md>)。实包仅证明内容一致和可分发，不等于发布或完整验收通过。

| 用例 | 已证明的代码 / 合成证据 | 仍未通过 / 阻断 / 未验 |
| --- | --- | --- |
| A01 | 唯一字面定位、同名追问、可信目标绑定、动作 journal | 无项目直接指令→真实普通目标受理未通过；自然语言模型路由未启用 |
| A02 | 可信项目ID归组、空项目、改名/移动及 registry unknown 反例 | 安装 Host 实际业务全集和 GUI 未验 |
| A03 | PNG 原字节上传/预览/绑定/撤权、digest/格式/越权反例 | 原图理解、目标模型访问证据缺失；非支持图片格式仍目标缺口 |
| A04 | cold/live 合成动作、持久未知与独立合成目标回执 | 真实 continue/supplement/steer/stop/activate/resume 仍关闭 |
| A05 | todos/team 已做/正做/下一步、父子来源去重、不把 idle 当成功 | 完整父子工作层级和回流展开未完成，真实进展未验 |
| A06 | 精确原题、建议条件/自填/跳过联动、独立保稿、原回执、HTML纯文本；缺记录同 ID 墓碑和界面二次确认/status 恢复 | 生产真实回答/通用审批阻断；legacy 和跨 epoch 恢复仍缺口 |
| A07 | 腾讯表格独立配置/transport/部分文本合同、缺auth真实blocked回执 | OAuth/原图/remote revision/普通腾讯文档缺口，R3不通过 |
| A08 | 明确授权根/文件、MD/TXT/CSV、原文与原图、越界/秘密/未知格式反例 | Office/PDF未适配；Node检测型非内核读取隔离 |
| A09 | 稳定行ID、重读/排序/重ID、immutable快照和内容/图片changes、claim幂等；本地无图条目带出处→空主稿→独立发送→计划确认，来源重读与恢复隔离 | 跨来源相似提醒、含图计划桥、真实来源→目标控制及完整外部版本/执行重验未接全 |
| A10 | 来源文字/图片只作不可信材料，intent不转批准、外发与执行闸独立 | 不把测试当模型注入免疫或完备秘密识别 |
| A11 | 新项目/会话默认纳入、排除/恢复与重启优先级反例 | 原URL真实保存/新增发现未验 |
| A12 | 后续读/绑定失效、迟到拒绝、scope ABA、恢复不重放 | 已外发撤销/停止未证明；生产无投递，不报已停止 |
| A13 | 默认/覆盖、有效provider/effort/version、能力基线和既有模型保留 | 真实逐次阶段调用和已发数据披露未验/未启用 |
| A14 | 各独立服务journal/CAS/unknown、丢回执/重启/并发/陈旧版本反例 | 跨服务/actor共享写资源与跨epoch恢复未全闭合；不保证exactly-once |
| A15 | 序列化真实bundle、工厂hooks/HTTP合同和双语资源 | 原URL未加载新版；DOM/视觉/IME/键盘/焦点/主题/窄屏均未验 |

## 原 URL 人工验收与下一最小条件

当前 GUI URL 为 `http://127.0.0.1:53162`（此前记录的 59762 为历史实例）。本轮无浏览器能力，没有安装/启用/重启或刷新产品，不能声称用户当前页面已显示本次代码。加载新版须另行授权；不另起服务器。

人工检查：设置分类入口→范围项目/单会话→定位→动作核对；本地与腾讯来源列表/单实例/快照；模型默认→单阶段覆盖；原题列表/详情/补充条件/自填与切页保稿；PNG粘贴/上传/原图校验/放大/释放；pending/unknown/rejected/closed在导航、双击、刷新和epoch切换中不串稿不重投。逐项验浅/深主题、窄屏/短高、Tab顺序/返回焦点/Escape、读屏标签、中文IME组合输入与错误态。随后已将工作、完整超管对话、待决策、来源、设置改为同层主区：一次只显示当前视图，固定壳内当前内容滚动，不再以304px辅对话/绝对定位设置侧栏代替。对话持久挂载保留滚动与未读；设置分类首页只提供范围/来源/模型入口，模型先列表、只编辑当前一项，返回保留全配置草稿；导航不改发送目标或pending ID。2026-11-23 已按原稿重构固定 214px 侧栏/顶栏/面包屑/全局对话入口与 namespaced `#go/` 路由，支持原生返回；概览仅一条下一待决及紧凑项目摘要。可信项目目录→单项目事项观察/关联会话/来源 tabs→当前观察概览/进展/关联/结果已接通，不把会话数当事项数，没有真实事项实体或来源关系时明确缺口。旧 Ticket 台账是次级独立列表，详情为主区域而非侧弹层；待决列表只展开当前选择。聊天图片入口/缩略图/定位上下文已合入持久对话，混合粘贴保留文字；图片存在或仍在本地处理时阻止纯文字发送，避免静默漏图。实际文字＋原图投递清单与父子工作回流仍未闭合，不能凭 CSS/工厂测试宣称真实视觉通过。

真实执行的下一条件是通过 L1/L2 与最小 target durable receipt / 原子最终授权验证；腾讯需要合法 Host OAuth + 图像/版本合同；广义来源格式与最终支持矩阵仍需用户确认。配置/草稿与现有能力可安全运行的代码切片已提交到工作区，但这不是完整 R1—R5 已交付声明。无 git commit、依赖安装、profile变更、生产数据库迁移、真实模型/文档请求或部署。
