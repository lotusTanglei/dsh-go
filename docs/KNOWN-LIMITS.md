# 已知限制（诚实清单）

## 交付限制

- **视觉验收未做**：当前连接 GUI 未安装/挂载此 bundle；侧栏点击、React/DOM渲染、console slot crash、焦点、浅/深主题对比度、浏览器通知实际显示均未验证。见[P5-VISUAL-CHECKLIST](P5-VISUAL-CHECKLIST.md)。
- **v2 Source 未接入**：GitHub/飞书等外部源、验签、持续连接不在 v1；当前主要是 attended session source。
- **desktop profile 未安装**：本轮只使用 superagent-dev/命令行临时 overlay；没有修改 Desktop profile 或 DSH 安装包。安装说明见[RELEASE](RELEASE.md)。
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
