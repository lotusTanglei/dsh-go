# 企业微信文档任务 Source（首版）

## 定位与使用

这是 super-agent 的任务来源，不是文档管理器。日常流程：

1. 插件配置中为每个来源设置文档链接、稳定工作表 ID、有界读取范围、编号/标题/正文列及可选筛选规则。
2. 现有工作区“交给超管”→“从企微文档读取”（或系统→来源），点指定来源“读取一次”。没有配置时不显示假来源入口。
3. 查看候选的原文、单元格位置、删除线状态和对应截图。实际图片必须成功显示，用户明确勾选已核对；无图片的纯文本任务允许继续。若唯一问题是删除线无法机器判断，可打开配置中的官方原表，明确确认“原文未划掉，仅生成待审计划”；已知划掉、缺号重号、缺图或读取不完整不能走此入口。人工声明单独留痕，原证据仍显示 unknown，不冒充连接器确认。
4. 点“生成待审阅计划”只准备草稿，不发送、不建单。正文是用户真实的规划请求，不复制外部正文冒充用户指令。
5. 发送后 Router 通过无参数 `task_source_context` 读取当前真实 new-task 请求绑定的外部证据。现有完整 scope/allow/deny/验收/指纹/到期确认不变；只有 owner 单独批准才用既有 `startEval → settleEval` 建任务。
6. 任务、停止及结果仍在现有工作区，不写回企微；生产 Worker 仍被 `SA_EXECUTION_BOUNDARY_UNVERIFIED` 阻断。

打开页面、刷新看板、读取来源健康、列本地候选都不会扫描企微。没有新轮询、定时任务、文档 CRUD 或自动接管功能。

## 具体接口接线

- [Source](<../src/sources/types.ts>) 新增 `wecom-document` kind；[WecomDocumentSource](<../src/sources/wecom-document.ts>) 按 [SourceRegistry](<../src/sources/registry.ts>) 的实例 ID 注册。`start` 只激活；显式 `scan` 才读取；并发读取合并，停止等待未结束读取。
- [配置](<../src/config.ts>) 使用现有 `sources` 数组；真实 Schemastery 验证旧 session/inbox 与嵌套 optional。地址只接受官方 HTTPS sheet URL，工作表使用稳定 ID，不猜第一个表。
- [连接器适配](<../src/sources/wecom-connector.ts>) 通过安装版真实 `ctx.tools.execute` 管线调用固定白名单 `mcp__wecom__list_sheets`、`mcp__wecom__read_task_snapshot`。不调用 definition.execute 绕过 guard，不创建另一套登录/HTTP/解码器。
- [工作区文档协调器](<../src/workspace/documents.ts>) 先存证据再规范化/投递；[runtime](<../src/runtime.ts>) 将外部 Trigger 交给原 `engine.ingest`。其 trust=system、bot=true、addressed=none，默认记录为 filtered；即使 bots=infer，也因 not-addressed 不进入任务队列。没有把文档提升为 human。
- [命令](<../src/workspace/commands.ts>) 和 [准入](<../src/workspace/admission.ts>) 将 Host 解析的 opaque origin 绑定到原真实用户 new-task；digest/fingerprint 包括 item、修订、证据 SHA、配置版本。旧无 origin 的 hash 字节不变；原 human source gate 不放宽。
- [路由](<../src/panel/routes.ts>) 只增 owner-only POST `document-source`（list/scan/detail/review）和 `document-image`。浏览器不能传 doc、URL、工具名、路径、Session、force 或 ignoreStrike。Origin、epoch、当前修订、图片 SHA/MIME/大小继续验证。

## 配置示例

在现有 super-agent 插件 config 中设置；示例不修改 profile，也不是实际可读文档：

```yaml
sources:
  - id: docs:team-bugs                # 一旦启用保持稳定；不要为重读换 ID
    kind: wecom-document
    attended: false
    doc: https://doc.weixin.qq.com/sheet/REPLACE_WITH_DOCUMENT_ID
    sheet: REPLACE_WITH_STABLE_SHEET_ID
    range: A2:F100                   # 明确矩形；最多500行×100列
    idColumn: A                      # 业务稳定编号，不是行号
    titleColumn: B
    textColumns: [B, C, E]
    filter:
      column: F
      values: [待处理, 已确认]         # 字面全等；不执行正则、公式或单元格指令
  - id: docs:another-project
    kind: wecom-document
    attended: false
    doc: https://doc.weixin.qq.com/sheet/REPLACE_WITH_ANOTHER_ID
    sheet: REPLACE_WITH_ANOTHER_SHEET_ID
    range: A2:D50
    idColumn: A
    titleColumn: B
    textColumns: [B, C]
    firstDataRow: 2
```

没有稳定编号或编号重复的条目只能保留为阻断证据。不要把同一业务条目以不同来源 ID 重复配置；来源 ID 变更属于新来源，不声称跨重命名自动归并。

## 证据、修订和停止规则

- `itemKey = SHA256(source instance ID, canonical document ID, business ID)`；工作表、行号、位置和正文不作为条目身份。行移动不建新任务，不产生新语义修订。
- `revision` 覆盖配置版本、相关列原文/公式/删除线/runs 和原图 SHA；图片漏取、格式未知、读取不完整使资格 blocked，而不是假设“没有删除线/截图”。
- 原文位置、所有相关原图和格式证据以 hash 工件保存到独立私有 evidence 目录（0700，文件0600，no-follow、写齐/fsync 后原子发布、读取校验 SHA）。不关闭现有 DB 脱敏。DB 仅存 opaque 标识、摘要和 claim/link；不是另一套文档库。
- 读取中先使上次候选不可批准；失败/不完整不能继续把旧快照当新证据。完整读取消失/不再匹配的条目只失效候选，不自动删除/停止任务；部分读取不推断删除。
- 选择条目时，稳定 item-level claim 与命令 journal 原子提交；不是按 revision 反复领取。重复读取、并发 request、进程恢复不会建第二张票。
- 已关联任务的后续文档修订仅更新外部观测，**不改 Ticket brief、mandate、审批、不 steer Worker、不新建票**。停止以原 Ticket 的 `stopped_by_human` 为准；claim/link 跨修订保留，不自动复活。
- 首版被拒绝/过期/已领取而后来修订的条目不会自动释放并新开计划。旧计划可拒绝；重新开展必须通过已有人工新任务流程重新说明并确认，不把重复扫描当重新授权。没有 TTL 自动释放授权。
- 确认针对最后一次完整手动读取的快照，不承诺企微在确认瞬间未发生变化；UI 显示快照时间。行移动保留旧证据，当前语义相同仍可核对；内容/相关格式变化使旧计划不能继续消费。

## 连接器增强及必须诚实保留的限制

现有连接器原先丢失 strike、返回展示文本而非 typed snapshot。本轮在其原只读客户端内补 `read_task_snapshot`，可审查补丁及部署边界见 [连接器契约](<../integrations/wecom-readonly/PROTOCOL.md>) 和 [最小补丁](<../integrations/wecom-readonly/connector.patch>)。

腾讯官方公开的 [ultrabuf](https://docs.gtimg.com/sheet/js/initial_ultrabuf.80dabae0fc44bd60.js) 与 [property](https://docs.gtimg.com/sheet/js/initial_property.9c1299857f7e8966.js) 明确 CTFont field11 是 wrapped bool、field12 是 null 标记。显式 true/false、空 BoolValue 已可识别；**外层字段缺失、继承、无效引用、条件/表格/透视格式以及不确定 run 仍为 unknown，禁止自动导入**。当前连接器不输出有效样式 `no`；raw false 只作为原始格式证据保留，不作为未划掉的证明。仅完整且无其他阻断的 unknown 可由 owner 显式核对原表，声明绑定 item/revision/evidenceDigest/configVersion/epoch；重读、位置/证据变化、失败/不完整扫描均清除此声明，仍须后续完整计划确认。不能将最终渲染器 default=false 移植为部分解码器的默认假设。

因此首版不是任意企微样式的完整渲染器。当前运行中的 MCP 没有被重启或修改 profile；须在正常重载连接器后发现新工具。未提供真实文档链接/稳定编号列/工作表样本，本轮未登录、未扫描私有文档，真实企微与 GUI 图片/删除线等价验收仍待指定样本验证。旧连接器或缺 structuredContent 时明确失败，不降级到 CSV 猜格式。

## 验证范围

- 主项目最终 46文件 / **569 tests**，typecheck/build均通过，日志见[完整门禁](<../probes/kanban/wecom-final-review-20261120-173400/test.log>)。其中工厂/closure测试不冒充React DOM或浏览器交互验证。
- TypeScript：配置切换/多实例、筛选提取、移动稳定性、缺号/重号、截图 SHA/位置、strike yes/unknown 阻断、重复读取、claim 原子性、旧修订失效、停止不复活、真实用户上下文、计划指纹确认、普通/归档任务回归、未绕过 Worker 关闭。
- 连接器：165 passed / 125 skipped（原库 native Rust 等未装；本机连接器强制 Python）；仅 fake backend 与描述符派生 wire 样本，不冒充真实文档。
- 真实安装版 Host：[最终回执](<../probes/kanban/s4-wecom-20261120-173600-result.json>)验证配置来源冷启动不读取、当前 bundle/slot 注册、owner 路由、非 owner/Origin、任意外部地址字段拒绝、未授权图片/未知快照review拒绝；本地确定性 Router，无外部模型请求。不是浏览器布局/真实企微登录证明。
- 最终 `pnpm pack` 通过，并核对155个条目含新增Source/runtime、连接器patch及本文，无 node_modules/状态库/锁/凭据；[打包日志](<../probes/kanban/wecom-final-review-20261120-173400/pack.log>)。
