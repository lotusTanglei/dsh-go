# G4 腾讯在线表格：独立最窄来源核心

## 先行概念 schema（实施前）

不改 Host/profile/依赖，不执行 DDL/migration，仅使用既有 kv+codec，namespace `tencent-sheet:v1:`。只读取配置的一个明确 A1 矩形，不列文档、不遍历、不写表、不执行来源内容。

- 配置：`{id,fileId,sheetId,range,idColumn,titleColumn,textColumns,revision}`。不收 URL、AccessToken、ClientSecret 或浏览器 credential handle。expectedRevision=null 新建；更新/删除 CAS。
- Host-only grant：`{handle,fence,scope:'scope.sheet.readonly',fileId,sheetId,range,wire:'documented-v3'|'example-v3'}`，由 `authorize(config,epoch)` 提供并在每个异步边界 `requireGrant(grant,config,epoch)` 重验。根本无授权 port 时返回 blocked/auth-unavailable，不联网。handle/fence/headers 不进入 DTO 或持久证据。
- 固定 transport：GET `https://docs.qq.com/openapi/spreadsheet/v3/files/{fileId}/{sheetId}/{range}`。三元 headers 仅后台 resolver(handle) 提供；redirect:error；响应 streaming 严格 bytes 上限和 UTF-8；限定 JSON 媒体。Host 可注入合成 transport 测试，但不能接受来源 URL 作为 transport 目标。
- 响应适配：官方文字 `code/message/gridData` 与示例 `ret/msg/data.gridData` 不一致。Host grant 显式选择一个 wire；禁止 shape 猜测、双包装混用或静默 fallback。范围起点与完整行/列数必须精确对应配置，不从稀疏结果猜空单元格。
- snapshot：不可变 raw UTF-8 JSON 字节证据 + config + items + image digests；revision 为本地内容哈希，绝不冒充远端版本。该 GET/model 未声明远端 revision / 原图字段 / 图片完整性，所以 `remoteRevision:'unknown'`、`images.state:'unknown'`、`imageSeen:false`、partial 固定保留。
- item：instance+fileId+sheetId+显式idColumn+原文行ID稳定哈希；row只是位置。ID空/重、未支持cell类型/未知格式字段阻断，不伪造候选。strikethrough 显式 true 阻断，缺失 unknown。
- claim：保留合同但该最窄切片不能证明远端原子版本及完整图片，始终 blocked，不生成可执行任务。未来合法原图与版本能力经独立审查后才能闭合；不加可伪造 `imagesComplete:true` 字段放行。

## 官方核实（2026-11-21）

- [OAuth 授权](https://docs.qq.com/open/document/app/oauth2/)：应用审核获得 Client ID/Secret；用户授权码交换 AccessToken；后台获取 OpenId；必须后台发起 API，不能让用户在聊天提供 token。
- [请求头](https://docs.qq.com/open/document/app/openapi/v2/file/common/req_headers.html)：Access-Token、Client-Id、Open-Id。
- [范围查询](https://docs.qq.com/open/document/app/openapi/v3/sheet/get/get_range.html)：固定 GET；scope.sheet.readonly；≤1000行、≤200列、≤10000格；响应正文与示例包装不一致。
- [表格模型](https://docs.qq.com/open/document/app/openapi/v3/sheet/model/spreadsheet.html)：GridData/CellData、cellValue.text/number、textFormat.strikethrough。未列原图字节、图片完整性或远端revision；禁止推定无图/未划掉。
- [A1表示法](https://docs.qq.com/open/document/app/openapi/v3/sheet/model/a1_notation.html)：明确左上:右下，例如 A1:B5，不支持无界整行/整列。

## 支持矩阵

腾讯 docs.qq.com 在线表格：配置与合法后台有界读取实现；生产 OAuth/credentials 缺失则 blocked；文本观察为 partial，不满足完整图片/版本承接。普通腾讯文档、企微 doc.weixin.qq.com、本地Office/PDF：本核 unsupported。普通文档 GET /openapi/doc/v3/{fileId} 不在本轮实现，不改名企微连接器。

## 集成与测试

[核心](<../src/sources/tencent-sheet.ts>)：`createTencentSheets(store,{signal,requireEpoch,authorize?,requireGrant?,transport?})`。

- `list({epoch})` → sources配置+head、connection(host-configured / blocked-auth-unavailable)、支持矩阵。
- `configure({epoch,id,fileId,sheetId,range,idColumn,titleColumn,textColumns,expectedRevision:null|hash},onCommit?)` → `TencentSheetConfig`。
- `remove({epoch,id,expectedRevision},onCommit?)` → `{id,removed:true}`；tombstone防ABA。
- `scan({epoch,id,expectedRevision,expectedSnapshot:null|hash},onCommit?)` → Promise<TencentSheetScanResult>；`state:'partial'|'blocked'`、reason、snapshotId、revision?、items、images unknown、remoteRevision unknown、changes。
- `detail({epoch,id,expectedRevision,snapshotId})` → 不可变配置/条目预览、capturedAt、current（仅最新手动观察）、partial原因；不下发原始响应raw、grant或密钥。
- `claim({epoch,id,expectedRevision,snapshotId,itemId,requestId,humanReview:'reviewed-for-draft'})` → 始终抛 `tencent_sheet_evidence_incomplete`，不伪造草稿承接成功。

configure/remove及scan成功partial、缺auth blocked回执均可注入同步 `onCommit(result)`：与配置/head同一store事务，throw则回滚，禁止callback自行嵌套事务；适合Host持久action journal。scan callback失败不会另写blocked head。其余解析/授权失败抛稳定 `tencent_sheet_*` code/status，不向浏览器泄露远端msg/原生异常。正式Host仍须owner/Origin认证；核心epoch不替代该闸。

`createTencentSheetTransport({credentials(handle),fetch?})` 返回Host-only读函数；合法后台三元组仅在请求headers中使用，不进kv/日志/UI。最多4 MiB响应、100实例，严UTF-8/JSON，两个wire必须显式选一个。本轮不提供原图port，因为官方原图字段/合法获取合同未核实；所有观察保留images unknown，不能拿外链代替原图。

UI 必须保留 partial 与阻断，不把原文/图片metadata当看图、不把来源当执行授权；原文只作转义纯文本展示。所有 fake grants、transport 与数据均为明确合成 fixture，不调用真实用户文档。本独立核心阶段未 build；后续 runtime/HTTP/独立配置 UI 与构建的最新证据见 [Go 实施记录](<GO-IMPLEMENTATION-20261121.md>)。

[测试](<../tests/sources/tencent-sheet.test.ts>)：Electron Vitest **44/44，exit0，1.08s**。覆盖固定origin/三headers/redirect拒绝、字节上限/媒体/UTF-8、两种显式wire、越权与late epoch/config/grant/abort、CAS/重启、稳定ID/重ID、unknown图片/版本、immutable快照、并发scan、onCommit四类事务回滚。全量noEmit检查核心与本测试无错误；并发他人UI/模型文件的类型报错交集成方处理。
