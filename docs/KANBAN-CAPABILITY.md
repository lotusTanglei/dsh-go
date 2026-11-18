# KANBAN · 安装版能力与执行边界

当前结论：**未通过执行安全门禁，非生产就绪。** 本文件记录本轮核实，不把文档/单测当作真实执行证明。安装版 DSH `0.2.2-rc.3`，Electron `44.7.0` / Node `24.21.0`。无 live `cordis_inspect_list/query` 工具，故没有伪称 Inspect；下列为已读取安装版 README/src 合同。当前连接 GUI 地址是运行态提供的 `http://127.0.0.1:52446`，匿名HTTP返回401，不搜索用户凭据。

## 1. 已核实合同

安装版包路径根为 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/`；可用 Host read 与 ASAR-aware Electron Node 读取，不改安装包。

| 能力 | 已核实定义 | 结论 |
|---|---|---|
| Client main | `dsh-client-ui-layout/src/client/index.ts:70–75` | keyed/root，conversation保留；插件只注册superagent键，无Session props |
| 侧栏 | `dsh-client-ui-sidebar/src/client/index.ts:88–107` | sidebar.panellist list/root，id→main key；不替换sidebar/root |
| followup/inject | `dsh-agent/README.md:56–69`，`dsh-agent-loop/src/agent.ts:180` | followup排队并唤醒，inject不唤醒；void不是接收屏障 |
| inbox | `dsh-agent-loop/src/inbox.ts:108–112,185–229` | claim为删除splice；pending内去重，不全历史幂等；canceled才是明确取消 |
| pre-step | `dsh-agent-loop/src/agent.ts:289–323,335–428` | claim先于pre-step，reject→turn/end blocked；pre-step enter仍不是admitted |
| admitted | `dsh-agent-loop/src/agent.ts:451–485` | prepareCall/refresh成功后才真实append user/message，之后调用provider |
| session event | `dsh-session/src/index.ts:79,897–906,968–984` | commit后观察者通知，不能等价await领域落盘 |
| durability | `dsh-session/src/index.ts:1409–1438` | flush返回true且成功才有持久监听者参与；false不够 |
| Session读取 | `dsh-session-query/src/index.ts:134–156,190–209` | 精确id readSession有重放校验；readSession全日志非有界底层；observeSession是caller-owned lease |
| 默认模型 | `dsh-agent-default-model/src/index.ts:63–73` | currentSelection只读，不能改用户default；agent.model.current优先持久选择 |
| 模型校验 | `dsh-llm/src/index.ts:766–789,858–884` | resolveModelInfo校验准确provider/model、reasoning metadata；不能接受浏览器任意agentOptions |
| 权限 | `dsh-permission-presets/src/index.ts:288–298,398–417` | catalog/resolve/set(session,name)；set同时改sandbox与approval，不可只看preset名字 |
| sandbox根 | `dsh-sandbox-policy/src/index.ts:208–229` | 取immutable Session header.cwd，不取effective workingDirectory；额外roots另算 |
| 工作目录改变 | `dsh-working-directory/src/index.ts:177–194` | 不改变permissions或既有process |
| 首工具窗口 | `dsh-subagent/src/manager.ts:382–417` | materialize后submit/followup在startActivation返回前；返回后set不提供首工具前保证 |
| child header | `dsh-subagent/src/child-agent.ts:135–153` | childSessionMeta复制parent.header.cwd，不把spec.cwd写入header；本项目spawn cwd不能证明Ticket沙箱 |
| 工具实测入口 | `dsh-tools/src/executor.ts:18–60`，`src/index.ts:369–376` | tools.execute批调用，非Inspect；无log可turn外执行但依旧agent scope；无tools.invoke |
| 原生写/真实shell | `dsh-fs/src/index.ts:271–289`；`dsh-shell/src/types.ts:61–104,226–237` | fs.writeText per-call policy；shell.resolve/execute+result；裸backend可能忽略policy，需核sandboxMode |

## 2. L1 与 L2 分开结论

### L1：当前生产spawn路径未证明且存在具体反证

Worker虽然传`cwd=<ticketDir>`，安装版child header仍继承Router原始workRoot。单纯activation返回后set workspace-write，不但没有首工具前屏障，沙箱根还可能是共同父目录。不能用preset名字或有效cwd截图宣布跨票隔离。

正常路径的角色guard从DB读预先分配sessionId/Assignment，因此不指控其必然“首工具无binding”。但角色绑定不构成文件边界。

此外安装版workspace-write允许平台临时区域；不能用`/tmp`必须拒绝作为无条件正确预期。Ticket根若在整个获准temp区域，其兄弟票也可能被允许，真实反例必须使用自有**非temp**目录。

### L2：安装版目录policy不支持allowWrite/denyWrite逐glob

policy字段仅mode/workspaceRoot/additionalWritableRoots/sessionId，不含逐路径glob拒绝。native显式路径guard只是副防线，无法对任意shell/间接脚本/heredoc/python/node/后台process形成执行级glob限制。目录隔离即使通过也不能满足L2。

`probes/kanban/s0-capability.cjs`仅在独立superagent-dev overlay测试真实fs/shell provider与生命周期，包含同Ticket内未授权/deny路径可写反证，结果以新回执为准。该probe不冒充完整产品工具链安全验收，真实模型请求应为0。独立结果见 `probes/kanban/s0-20261118-202300-result.json`：L2 native/shell未列与deny均能写入；direct meta root的跨票/native symlink/shell/heredoc/后台未产生目标文件；spawn headerMatchesParent=true、policyMatchesTicket=false，providerRequests0、liveAgents0。状态evidence-recorded不是产品安全通过。先前失败结果保留。

## 3. 实现选择

- 新命令服务使用既有side_effect主键/CAS+版本seq保存**无正文**requestId、hash、目标/Thread、messageId、阶段、durability；不改DDL，不复制聊天数据库，不从脱敏detail重放正文。
- followup前持久dispatch fence；若崩溃后没有Session证据，标unknown，不盲重followup。持久splice/claim/user-message都需要对账，不仅查pending inbox。
- Session source归一化/入库与工具前catch-up合流；只使用当前Router真实admitted user-message限定命令ID，不使用浏览器role/sessionId或全局lastRequest。
- 确认计划与危险审批分离；confirm策略不改never来演示。
- 结构化报告校验后确定性摘要用Outbox发布，sent必须flush=true；不依赖Router再次总结或下一条用户消息。
- 未验证L1/L2不开放生产Worker执行。可独立的对话、只读看板、计划确认与合成fake activation测试继续；不能据此称闭环完成。

## 4. 需要单独授权/用户决定

未申请或执行核心/依赖/DDL/profile/权限扩大变更。若要求恢复真实写Worker：

1. L1可评估插件自有agents.create(meta.cwd=ticketDir, unpublished setup绑定权限+never审批)并重新证明结构化结果/子关系/停止后台进程/恢复生命周期；不能静默替换成没有真实结构化报告的假Worker。
2. L2需新的强制执行架构（例如明确隔离工作副本+可写路径映射/OS级逐路径限制），覆盖shell和后台进程、保留正常测试构建；如需要依赖/核心/权限/数据迁移，必须单独报告影响、备份/回滚并取得授权。不以prompt、删bash、正则shell或stub拒绝代替。
3. Desktop部署未授权，不改运行profile；没有浏览器控制，VIS-01保留人工项。
