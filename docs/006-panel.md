# 006 · Web 面板

## 1. 与 DSH 的集成方式（已核实）

| 目的 | DSH 机制 |
|---|---|
| 左侧栏入口 | slot `sidebar.panellist`（kind `list`，scope `root`），必须用 `ctx.slots.inject('sidebar.panellist', …)` 注册 |
| 页面容器 | slot `main`（kind `keyed`，scope `root`），`key` 与侧栏 `id` 相同 |
| 切页 | `ctx.layout.selectPanel(id)`；**只有活动 key 会渲染**，切走即卸载 |
| 前端调后端 | `ctx.connection.fetch.register({ path:'/api/superagent/…', methods:['POST'], requestBody:'buffered', fetch })` |
| Electron 下取数 | 页面用 `fetch(new URL(path, document.baseURI))`，实际走 `__DSH_TRANSPORT__` 的 IPC 桥，不是真打 127.0.0.1 |

**不能做的事**

- 不能自建 `@Remote` 命名空间：需要构建期代码生成 + 客户端装配显式挂载，第三方包两样都控不了。
- 不要往 `root` slot 注册：会以"后来的注册优先级更高"顶掉框架自己的座位。
- 不能依赖任何 URL 路由：面板选择状态在 client 端 store 里，没有 `history.pushState`。

**样式**：用主题 token，禁止硬编码颜色。`--dsw-alias-bg-base/-layer-1/-layer-2`、`--dsw-alias-border-l1/l2`、`--dsw-alias-label-primary/secondary`、`--dsw-alias-state-{success,warn,error}-primary`、`--dsw-specific-sidebar-fill`。深浅色通过 `body[data-ds-dark-theme]` 切换，token 会自动跟随。

---

## 2. 信息架构

七个页面，全部只读，只有审批页与详情页有动作按钮。

### Overview（首屏）
- 顶部四张卡：进行中 Ticket / 等待人处理 / 今日成本 / 队列长度
- 中部：活动列表（最近 20 条领域事件，可点进 Ticket）
- 底部：系统健康（DB 可写、主会话存活、Worker 数、Watchdog 心跳）

### Tickets
列表列：状态、标题、负责人（Assignment）、最后进展、Token、需要人做什么、来源、链接。
行内动作：`stop` / `resume`（仅 ended 且非人工停止时可 resume）。
筛选：状态、来源、时间段。

### Threads
按来源分组的会话/话题列表：最后消息时间、消息数、是否有订阅、当前 Eval 状态。
点进去看时间线（Trigger → Decision → Ticket），**不含原文聊天记录**（原文在 DSH 会话里）。

### Sources
已注册来源实例：id、kind、attended、健康、最后事件时间、暂停开关。
v1 只有一条 `session:<mainSessionId>`。

### Approvals
待审批列表：类型、摘要、申请人、Ticket、创建时间、剩余超时。
动作：`approve` / `deny`（必填理由）；批量审批需逐个确认。
历史：已决记录，可导出。

### Health
DB 大小与迁移版本、Watchdog 最近 20 次判定、Outbox 积压与失败、最近错误。
一键导出诊断包（脱敏）。

### Settings
只读展示当前生效配置（来自 `cordis.patch.yml` 与环境变量），标注哪个值来自哪里。
**不可在面板改配置**（v1）：配置改动走 patch 文件，避免"面板改了但重启丢失"的错觉。
显式展示：`router.readScope`、`confirm`、`maxWorkers`、`watchdogIntervalMs`、`paused`。

---

## 3. Host 路由 API

前缀 `/api/superagent`，全部 POST，`requestBody: 'buffered'`，仅接受同源。

| 路径 | 入参 | 出参 |
|---|---|---|
| `/overview` | `{}` | `{ counts, activities, health }` |
| `/tickets` | `{ state?, source?, cursor? }` | `{ items[], next? }` |
| `/ticket` | `{ id }` | `{ ticket, assignments, approvals, timeline }` |
| `/threads` | `{ cursor? }` | `{ items[] }` |
| `/approvals` | `{ state? }` | `{ items[] }` |
| `/approval` | `{ id, decision:'approve'\|'deny', reason }` | `{ ok, approval }` |
| `/ticket-action` | `{ id, action:'stop'\|'resume' }` | `{ ok, ticket }` |
| `/health` | `{}` | `{ db, watchdog, outbox, errors }` |
| `/settings` | `{}` | `{ effective: { key, value, origin }[] }` |

统一响应：`{ ok: true, data }` / `{ ok: false, code, message }`。错误码稳定，前端按 code 分支，不解析文案。

**安全**：路由注册即带 `ctx.connection` 的同源校验（owner-only）；额外校验 `Origin` 与 `Host`。入参白名单校验，禁止把用户输入拼进 SQL（全部走参数绑定）。

---

## 4. 交互细节

| 场景 | 行为 |
|---|---|
| 切页 | 面板卸载重建；状态存于注册时的 `store`，切回不丢筛选 |
| 刷新 | 页面每 5s 拉一次 `/overview` 与 `/approvals`；其它页进入时拉一次 |
| 审批 | 二次确认弹层显示完整摘要 + payload 的关键字段（不含密钥）+ 影响范围 |
| 失败 | 顶部条 + 重试按钮；4xx 不重试，5xx 指数退避 |
| 空状态 | 明确文案 + 下一步操作（例如"没有待审批项"） |

**为什么轮询而不是 SSE**：DSH 没有面板级订阅 helper；本机场景 5s 轮询足够，实现简单、无连接管理成本。若后续需要实时，再走 `webServer` 的 SSE 路由（Electron 下需确认可用性）。

---

## 5. 前端约束（硬性）

1. 不存任何密钥，不把 token 写进 localStorage。
2. 不拼 SQL、不拼 shell；所有请求走固定路由 + 结构化入参。
3. 不在前端做权限判断——按钮是否可用由后端返回的 `allowed` 字段决定。
4. 不展示原始事件正文（`raw` 字段），只展示摘要与链接。
5. 颜色/间距只用主题 token，硬编码色值在评审时不通过。
6. 国际化：文案进 `locale/{en,zh}.json`，不写死在组件里。
