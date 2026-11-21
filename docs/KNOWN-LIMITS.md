# 已知限制（诚实清单）

## 首要发布阻断（看板工作区本轮）

- **L1/L2未通过，真实Worker关闭**：安装版真实spawn仍用父Session sandbox根；正确Ticket根下native/shell对同票未列/deny路径均写入成功。证据见[能力边界](<KANBAN-CAPABILITY.md>)与[本轮进度](<PROGRESS-KANBAN.md>)。生产新启动、旧live恢复、工具guard均fail-closed；不能把fake Spawner测试或看板流转当成真实工作完成。
- **授权范围不可完整审阅时禁批准**：当前Host owner主目录内、无敏感后缀的规范repo可用`~/完整项目后缀`无损审阅（UI明确`~`定义），不改变执行契约、不以opaque hash代替授权；其他用户/非规范/含秘密路径或action仍被脱敏时只能拒绝。首次安全项目选择、跨机器路径映射仍未闭合。
- **GUI设计没有因测试通过而验收**：2026-11-21用户实图已显示跨会话版；新版确实加载但仍被明确否定，不能继续以未刷新解释。此前匿名401诊断已撤回。本轮改为左任务/右辅对话、决策前置、来源短卡、可信零记录单空态、容器1050切完整视图/720两列/440单列，去除四个通高空桶与卡片Token流水；说明见[任务优先版式](<KANBAN-TASK-FIRST.md>)。源码与测试不证明真实视觉/焦点/主题/IME；当前DSH本轮未重启/改profile，不能声称已经验证用户当前页面为此次设计。
- **跨会话来源的真实范围**：按用户“默认纳入，手动排除”已实现当前 Host 普通会话的只读目标/步骤/提问汇总，排除持久保存且可恢复；不自动接管/激活/建票。超管内部/子会话去重，普通 fork 正常纳入。会话按DSH Workspace项目成员分组，不猜cwd或标题；未归属与归属不可用分开。主区仅返回摘要的项目预览，不是全项目目录，来源分页计数仅已加载；不添加项目CRUD或变更原归属。看板只统计 Ticket，不把观察数当任务数；当前Host不等于所有profile/进程/机器。精确 cold 投影会由DSH内部只读重放日志，适配器不返回events；排除后不读其工作投影。timed userQuestions 可展示，legacy问题/通用审批无完整投影，不声称所有决策已汇总。未验真实用户业务全集或GUI点击；详细边界与回执见[会话覆盖](<KANBAN-SESSION-COVERAGE.md>)。
- **产品UX仍有未闭合项**：首次安全项目选择仍需补；unknown/false的精确版本已可显式终止路由，Host重新对账后有受理证据则拒绝，不能当停止模型/已受理任务。人工停止后禁止原地resume，可“以此需求新建任务”铺新草稿并保留来源，必须重新发送/审阅新计划，不继承旧审批。同一pending计划已可显式修改目标/第一步并重新确认，API另支持allow/deny/验收等受限patch；范围/runtime/base不可借修订改变。过期计划已终态释放容量（含跨epoch），103计划分页/第101审批有回归。不能以执行安全阻断掩盖其余普通功能缺项。

## 交付限制

- **任务详情可读性**：最新用户截图证明“交给超管”已加载，但整段指令撑大标题、原始报告字段堆叠仍难读。本轮仅做展示派生短标题+可展开原文、结构化报告首屏，所有原始记录及审批范围保留，测试记录不冒充业务成果；截图是修复前证据，不能说新版布局已验证。
- **视觉验收未闭合**：用户最新截图明确否定整页设计。任务优先重排已完成代码与独立UX静态审查，但没有新实图/交互通过证明。console、焦点、浅/深主题对比度、窄屏/短高度均未实测；不把AST/CSS断言或工厂注册当截图验收。见[版式合同](<KANBAN-TASK-FIRST.md>)与[P5清单](<P5-VISUAL-CHECKLIST.md>)。
- **文档 Source 的真实验收边界**：已新增只读企微文档 Source，可配置实例/文档/工作表/范围/稳定编号/筛选，手动读取与现有计划确认接线，不改调度引擎。连接器明确 raw strike 可解，继承/条件/表格/透视格式仍unknown并阻断自动导入；仅完整且唯一问题为unknown的精确快照允许用户打开原表显式核对，声明不修改原始证据、不授权执行，已知划掉或其他阻断不可覆盖；未重载运行中MCP，未给真实文档样本，没有真实端到端/GUI图片等价证明。见[配置及规则](<WECOM-DOCUMENT-SOURCE.md>)。GitHub/飞书等外部源、验签、持续连接仍不在首版。
- **Desktop当前应用边界**：插件已在desktop启用，源码链接本工作区；本次经用户授权由插件管理器关闭再启用，最终保持启用，但结果为需重启。未手工修改profile/安装包或解除Worker阻断。安装说明见[RELEASE](RELEASE.md)。
- **P4 完整生产链路边界**：真实受控单 Worker 已通过 stall nudge→cancel→escalate；不是自然长任务、多 Worker、完整 Router 模型规划或崩溃窗口恢复证明。20分钟进展反例沿用旧证据，不冒称新实跑。
- **客户端构建预设是自建的**：`scripts/build-client.mjs` 是当前 bundle 构建适配；DSH 升级可能改变 ModuleLoader/Slot/React装配，需重新做静态与人工验收。

## 安全与可靠性限制

- **allowWrite 不是执行级隔离**：C1-2 真实生产 guard+stub 证明越界 write/bash 仍可到达工具 body；shell 可能绕过 brief glob。此项是 RELEASE BLOCKER，不能用 prompt、sandbox workspace 根或“测试通过”替代。
- **Watchdog 崩溃窗口**：cancel 先持久结束 Assignment，stage2 completed 审计稍后写入；该窗口崩溃后可能漏 escalate。当前不宣称完整 crash-safe。
- **主会话恢复边界**：启动时只对精确 `SESSION_QUERY_SESSION_NOT_FOUND` 的旧持久绑定重建；显式配置、corrupt/persistence error fail-closed。运行中主会话消失即时 failover 未实现。
- **分页不是快照**：Threads 按 `source` 主序、变化中的 `lastAt` 降序、`key` 次序进行 offset 分页，跨页期间新事件可能重复/漏项；Health 当前轮询会扫描 audit 后截取20条，大库有规模风险。
- **成本证据不完整**：真实 B1 仅1次 provider 请求/4938 token；10-ticket连续真实成本曲线未验。C2并发使用 FakeSource/fake Worker，不是模型压测。
- **外部日志范围**：C5覆盖固定插件日志、合成 redactor 诊断、audit/detail、panel JSON、trigger.raw 和指定三类用户路径/秘密格式；不代表所有 Host/OS 日志、任意编码或所有操作系统路径。
- **通知语义**：Outbox `sent` 表示持久发布到 DSH Chat 投影，不表示浏览器ACK或人已读；脱离本插件客户端不保证可见。

## 不可自动验证

没有浏览器控制时，不能诚实自动验证页面实际布局、颜色对比度、点击焦点、console、通知人可见。不要创建截图/DOM替身来填补证据空白。
