# P5 · 面板实现报告

## 主流程

按 DEV-ALL 允许的最小切片交付 Overview、Tickets、Approvals 三页；其余四页为只读简版或明确占位，不宣称七页完整运维功能。

- Overview：Ticket/待审批数量、最近活动、系统健康。
- Tickets：安全列表、详情（Ticket/Assignments/Approvals/Timeline）、后端 allowed 驱动 stop/resume。
- Approvals：摘要、申请人、Ticket、经白名单提取的影响字段；必填理由和二次确认；approve/deny。
- Threads：只读基本列表，无分组/完整时间线交互。
- Sources/Health：占位，Host 诊断接口仍返回来源/健康数据。
- Settings：只读 effective 列表；配置来源只能确认是已解析 Host 配置，未伪造 patch/default provenance。

## DSH 集成

- React 由 Host 模块表提供；无 DSH Client 包运行时 import。
- `scripts/build-client.mjs` 复用 tsc 编译输出，生成 `window.__ModuleLoader__.load({id:'dsh-superagent',factory...})`；无新打包依赖。
- 仅注册 `sidebar.panellist` 与 keyed `main`，id/key 均 `superagent`；不占 root。
- 主题 token，无硬编码色值；中英文 locale。
- 固定根 API、same-origin、15 秒超时、5 秒轮询、4xx 不自动重试、5xx 退避；卸载取消请求/定时器。
- 原生 dialog：二次确认、理由、Escape/关闭/焦点恢复。

## 九条 Host API

全部 POST buffered：overview、tickets、ticket、threads、approvals、approval、ticket-action、health、settings。

Owner-only 身份由 DSH connection carrier 保证，路由额外校验 Origin；字段白名单和参数化 SQL。统一 ok/data 或稳定 code/message 错误。

审批：领域转换+CAS+审计同事务；过期 fail-closed；任意其他 pending/denied/expired 审批均不能释放等待状态；不返回原始 payload/raw/密钥。审计身份固定为连接的 panel-owner，不接受 body 中 actor 冒名。

## 已验证与未验证

- Host 八条单测通过：路由契约、攻击字段/Origin、审批 CAS/replay/过期、重启、linked Ticket、安全 impact/detail、多审批与身份。
- Client 两条契约测试通过：slot/locale 注册与释放、资源/主题/模块格式；未模拟 DOM/renderer。
- 专门 UI/UX 只读审查完成，已修固定路径、超时/非JSON、详情/影响范围、resume理由、对话框与接口差异。
- **无浏览器控制工具**：尚不能证明实际侧栏出现、点击、控制台无 slot crash、深浅主题正确；不会用自制截图/DOM 模拟代替。

- 修复 Router setup 后，隔离 `superagent-dev` 三个预设无 broken，runtime ready/1 source健康；未认证 API 401，跨Origin403，owner健康与列表200。
- Host 页面包含插件资源引用，真实客户端脚本200、19334bytes、module-loader factory正确；未执行DOM/React模拟。
- 受控审批fixture经HTTP approve200、replay409；payload secret未泄漏，SQLite持久approved。重启后HTTP仍approved，Router恢复原session id。
- 仍无视觉点击/主题证据。用户明确选择“继续e2e，视觉待人工”，只豁免阻塞顺序，不把视觉标为通过。

最终真实 profile/HTTP/资源加载及视觉限制见 [FINAL-VERIFY](FINAL-VERIFY.md)。
