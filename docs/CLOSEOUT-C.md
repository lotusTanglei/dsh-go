# CLOSE-OUT C · P6 加固

2026-11-18。自动离线证据完成；**不能称“安全通过”或“可上线”**，因为 C1-2 已证明 Ticket `allowWrite/denyWrite` 尚未成为执行级文件/命令隔离。

## C1 提示词注入（6条）

原始汇总：[c-injection-result.json](../probes/closeout/c-injection-result.json)，focused 6/6。所有输入均为合成文本；provider请求0。

| 注入点 | 结果 | 边界 |
|---|---|---|
| 仓库文件 | `unavailable`：Worker prompt 已标明 repo/brief/report 是不可信数据；没有模型调用，不能证明模型免疫 | 不证明恶意文件被模型忽略 |
| brief/allowWrite | **unblocked，RELEASE BLOCKER**：生产 `installRoleGuard` 对越界 write 与 bash 均返回 undefined，stub body 均执行 | 没有真实OS写/进程副作用；但执行闸明确缺失 |
| report.risks | blocked：结构化风险可记录，pending approval 仍 pending，无自动批准审计 | 不证明Router模型不受诱导 |
| panel入参 | blocked：SQL片段和201字符ID均400，表仍在 | 进程内Fetch，不含HTTP owner认证 |
| Channel回复 | blocked：sk/ghp/Bearer合成值写入前脱敏，sent，0模型唤醒 | 不证明浏览器显示 |
| audit.detail | blocked：真实repo insert后物理SQLite detail无秘密 | 不覆盖绕过repo的任意直写SQL |

**必须写清：** prompt标记、schema与redactor不是模型行为证明；allowWrite部分不能用“Worker不越界”表述。

## C2 并发与容量

[c-concurrency-50.json](../probes/closeout/c-concurrency-50.json)、[overflow](../probes/closeout/c-concurrency-overflow.json)、[capacity](../probes/closeout/c-concurrency-capacity.json)。

- Promise.all 50 + replay 50：50 accepted / 50 duplicate，50 unique Trigger/Ticket，50 consumed；89.97ms；RSS增量4,128,768 bytes，为逐操作采样峰值，不是连续OS峰值。
- 225超队列：queueLimit保持200，200 accepted、25 rejected/queue-full；225条Trigger/disposition均持久，未放宽阈值。
- fake Worker容量：maxWorkers=3，5请求即时启动3、排队2，全部完成，liveAgents=0，realModelCalls=0。
- 这些是SQLite/FakeSource/fake activation的产品路径证据，不是50个真实模型并发成本证明；paused/subscription绕队列上限的设计边界仍需后续单独决策。

## C3 故障注入

[c-faults-*.json](../probes/closeout/)。

- SQLite只读：真实写失败，Host activation返回固定安全错误，锁清理。
- 存活持锁子进程：第二进程明确exit2/locked by pid，owner nonce不变，释放后可重开。
- 时钟回拨：6个now样本，stall/duration/waiting均不负、无动作。
- Worker缺失：reconcile将缺失Assignment标orphaned并重开Ticket，live fake Worker保持running。
- 删除持久Router：新增 runtime recovery 离线测试；仅 `SESSION_QUERY_SESSION_NOT_FOUND` 且非显式配置时重建并更新KV，其他corrupt/persistence错误fail-closed；无模型请求。
- 未覆盖：运行中主会话消失的即时failover；Watchdog cancel写ended到stage2 completed之间的崩溃窗口仍可能漏升级。

## C4 成本与预算

现有Watchdog预算测试与 B1 真实结果：预算顺序 `nudge → cancel → escalate` 有离线证据；B1 stall真实1次provider请求、4938 token。没有再做10次真实Ticket模型调用，以免叠加成本和触碰提示词真实请求上限；10-ticket曲线未验，明确标未验。

## C5 安全扫描

四sink合成扫描与9项安全测试通过：日志（固定插件加载日志+合成redactor诊断）、audit.detail、面板JSON、trigger.raw中指定秘密前缀/私有URL/三类用户路径无泄漏。范围不等于所有Host/OS日志；当前路径正则已覆盖带空格的指定Unix/Windows用户路径，任意编码/OS仍未声称覆盖。

## 发布判定

C 自动证据：通过；C1-2：**发布阻断**。原因不是测试失败，而是测试成功证明能力边界尚未满足“Ticket-scoped execution”。要达到可交付，需在保留Worker正常测试/构建能力与逐文件 allowWrite/denyWrite 之间做明确产品/沙箱设计，不能靠文案或只加 write/edit 局部检查冒充完成。