# G4 本地来源：独立 Host 核心

## 先行概念 schema（实施前）

本切片包括本地核心、Host 受限方法、HTTP 与分层 UI 接线；不改 DSH 核心、profile、依赖或数据库 schema，不新增 DDL / migration。使用既有 `kv` 与 codec 的 schemaVersion=1 包装；独立 namespace `local-sources:v1:`。

- **配置实例**：`{id, rootId, relativePath, kind:'md'|'txt'|'csv', csv?:{idColumn}, revision}`。单实例一个明确文件，无目录扫描 / glob / 递归。配置 revision 为 CAS token；新建 expectedRevision=null，更新 / 删除必须精确匹配。
- **授权根**：仅 Host port `roots():[{id,path,name?}]` 提供绝对路径；浏览器只提交 rootId。根身份 dev/ino 持久绑定于私有状态，所有祖先每次核查非 symlink 与读前后身份，DTO 不带根路径。Host 每次读取重新提供 roots，撤销立即拒绝。
- **快照**：`{snapshotId, sourceId, configRevision, revision, text, items, images, capturedAt}`。revision 哈希原始 UTF-8 字节 digest、规范化配置和本地图片原字节 digest；不使用 mtime-only。旧快照只插入不更新；最新观察另有 CAS head，可记录失败但不删除旧证据。
- **条目**：Markdown / TXT 为 instance+relativePath；CSV 必须显式 idColumn，条目 ID 为 instance+relativePath+该列原文 ID；空 ID / 重 ID 整次阻断。行号是位置不是身份。CSV 严格有界解析，无公式求值。
- **图片**：Markdown 引用先解析 metadata，再只读授权根内 PNG/JPEG/GIF/WebP 原字节并校验媒体签名、大小、路径与 digest。外链 / 不支持语法 / 格式保持 blocked；imageSeen 永远 false。原图通过同一个 detail 方法的受限 imageDigest 分支取得，不能把路径当图片能力。
- **承接 claim**：稳定 itemId 独占绑定一个原 requestId；绑定 snapshot/revision/configRevision 和明确 `humanReview:'reviewed-for-draft'`。同 request 同绑定幂等，变更内容冲突，另 request 拒绝。回执是独立新草稿材料，不是执行许可、自动 ingest 或覆盖旧草稿。

## 安全与范围

严格参数白名单；所有方法 epoch + AbortSignal 重验，改变配置 / scan / claim 有 CAS。每次读取以 O_NOFOLLOW 打开所有绝对路径 segment，目录 fstat、最终 regular fstat，读取前后核查文件与目录身份 / ctime / mtime / size，根绑定与 Host roots 重验；拒绝 stale。硬链接（nlink!=1）、隐藏 / 凭据 / 状态库路径、DB / 二进制内容、超过上限、非严格 UTF-8 均拒绝。读取不授予来源文字执行权限。

便携 Node 没有 openat(2)；本实现采用保留目录 fd + 每个 open 前后整个祖先链核查，发现任何目录变更即拒绝且不发布 / 承接。此为检测型保护，不宣称能阻止同权限恶意进程在 syscall 内竞态短暂接触字节；需要内核级「读取本身永不越根」保证时必须另接 Host 原生 openat / sandbox 能力，不可把本核测试当成该保证。

## 支持矩阵

| 子类型 | 状态 |
| --- | --- |
| 本地 Markdown / TXT / CSV（明确文件、有界） | supported |
| Markdown 根内签名验证 PNG / JPEG / GIF / WebP 原图 | supported；metadata 与原图读取分开，未声称模型看图 |
| 本地 Office / PDF / 其他格式 | unsupported / blocked，不伪造解析 |
| 腾讯 docs.qq.com 在线表格、普通文档 | unsupported / blocked；需独立合法接入 / 认证 / 图片 / 版本核验 |
| 企微 doc.weixin.qq.com | 不由本核处理，不改名冒充腾讯通用接入 |

## 集成合同

[实现](<../src/workspace/local-sources.ts>)：`createLocalSources(store, {roots, requireEpoch, signal})`；所有方法同步、对象参数、严格白名单，错误含稳定 `local_source_*` code 与 status，不能向浏览器转发原生 fs 异常或绝对路径。

| 方法 | 精确参数（均含 epoch） | 返回 / UI DTO |
| --- | --- | --- |
| list | `{epoch}` | roots 仅 `{id,name}`；sources 配置+state/snapshotId/reason；support/limits |
| configure | `{epoch,id,rootId,relativePath,kind,csv?:{idColumn},expectedRevision:null\|hash}` | 新配置 revision；仅读取目录身份，不读文件内容 |
| remove | `{epoch,id,expectedRevision}` | `{id,removed:true,revision}`；tombstone 保留防 ABA，原 revision 可用于显式重配 |
| scan | `{epoch,id,expectedRevision,expectedSnapshot:null\|hash}` | sourceId/snapshotId/revision/configRevision/state；items（稳定 itemId、location、candidate/claimed、draftId?），images metadata，changes（added/changed/removed、imagesChanged） |
| detail | `{epoch,id,expectedRevision,snapshotId,imageDigest?}` | 无 imageDigest：`kind:'snapshot'` 原文+配置+items+metadata+capturedAt+current；有：`kind:'image',bytes:Buffer,digest,mediaType,imageSeen:false`，仅 Host 二进制路由使用 |
| claim | `{epoch,id,expectedRevision,snapshotId,itemId,requestId,humanReview:'reviewed-for-draft'}` | 独立 draftId、原 requestId、完整 origin 版本绑定、text/images metadata、trust/authorization；不含图片字节 |

Host 路由仍须认证 owner / Origin；`humanReview` 只是受认证人类的「核对后承接为草稿」意图，不能让模型或来源自填该字段后视作许可。本核只通过 requireEpoch port 校验 epoch，不替代 owner / Origin。epoch 切换要求重新手动 scan；不复用旧 epoch 的 ready 状态。

UI 顺序：选择 rootId+输入明确相对文件 → 保存 → 显式 scan → detail 原文 → 根据 digest 获取受限原图 → 人工核对 → claim → 打开**独立新草稿**。原图 DTO 仅说明已取得原字节，不说明人或模型已看图；图片依赖原图能力不能用 metadata 代替。内容均 external-untrusted，UI 只按纯文本渲染，不执行 Markdown HTML / CSV 公式，不把来源原文写进普通日志。只允许 `requestId` 相同、绑定相同的幂等 claim 重试；一个稳定条目一旦承接，不因更新再开新 request 重投。列表 / 原文带 `freshness:'manual-snapshot-not-live'`：`current` 只表示当前配置/epoch 下最新成功手动观察，不声明磁盘此刻未变；claim / 原图分支会再次读取校验。旧快照允许原文对照，但 stale/失败刷新/配置变更/根撤销后不能承接或获取原图。删除 / 缺行只作差异，不自动停任务。

固定上限：文件 1 MiB、CSV 500 数据行 / 100 列、10 张图片、单张 5 MiB / 合计 12 MiB、100 个活动实例。敏感过滤保守，可能拒绝包含长密钥样式片段的合法文档；它不是秘密内容识别的完备证明。文件与原图只进入私有 kv 快照，不进行 watcher、联网、模型请求或自动 engine ingest。

## 本地草稿 → 待审阅计划（2026-11-23）

已新增显式 handoff：独立草稿 →「带出处交给超管（只生成待审阅计划）」→ Host 重读核实 → 空的当前主对话填入固定计划请求与 opaque 出处 → 人工审阅后另行发送 → 现有不可变计划与独立确认。没有自动发送、自动批准、自然语言选目标或真实 Worker 启动；已有文字、pending、来源、目标、附件及本地图片处理占用均不能覆盖。独立原稿始终保留。

- `planOrigin({epoch,id,expectedRevision,snapshotId,itemId,requestId})` 的 requestId 是原 claim 请求，不是计划命令 ID。返回仅 `{documentOrigin,draftId,trust:'external-untrusted',authorization:'not-granted',planningOnly:true}`。它只核实证据，不占用计划命令或写准备状态。
- `documentOrigin` 精确五字段：`{kind:'local-document',itemKey:itemId,revision:snapshotId,evidenceDigest,configVersion}`；digest 以 domain-separated tuple 绑定当前 epoch、原 draftId/claimRequestId/sourceId/itemId/snapshot/config。不是可执行授权，不含原文、路径或图片。
- 新计划命令保留原有独立 UUID、正文 digest 和 journal。来源 authority 在所有原有来源校验点重验原 claim、不可变快照与当前磁盘；原配置、根、文件或 epoch 不符即拒绝。`reserve` 仅参加既有 command journal 事务，将一个 item 绑定首个命令；不会再开嵌套事务。同请求幂等，另请求拒绝。无 DDL、依赖或迁移。
- `link` 只在 admission 已完整校验 settlement 的事务中核对 owner、完整出处、命令、epoch 与 Ticket thread 并补链，不重新读取文件或启动任务；来源在 settlement 后变化不能把已发生的结果伪成未发生。
- 模型上下文是显式 `task_source_context` 工具证据，始终不可信、planning-only；不会把来源内容伪装成人类正文。MD/TXT 的 text 为当前所选原文；CSV 的 text 是标为 `csv-row-json` 的派生选中行数据，不冒充逐字 CSV，不把其他行原文随所选条目发送。完整原文仍可在来源快照页复核。CSV 敏感字段提前阻断，不通过删词或脱敏后冒称精确证据。
- 含任意图片的本地草稿目前**不能走此计划桥**；UI 与 Host 都拒绝，不静默省图。图片仍可按既有独立审阅路径查看，不代表原图投递完成。旧 epoch 草稿只读，不因同文件重新 scan 恢复旧出处。
- UI 校验精确字段、digest 和原草稿绑定；返回途中隐藏、切页、往返、换 epoch 或换草稿均不抢占主对话。回调只填稿，未发送；占用时原稿保留。局部 stale 来源错误在恢复中隔离为该请求拒绝，不使整个工作区启动失败。

范围限制不变：同步文件重读是检测型保护，不是内核读取隔离或跨文件系统／数据库原子授权；没有完整原图／真实控制闭环，也没有证明模型不会受提示注入影响。

## 验证

[测试](<../tests/workspace/local-sources.test.ts>)仅真实临时 SQLite 与文件 / PNG fixture，不访问用户实际文件；包含越权、段级 symlink / hardlink、根替换 / 撤销、读中 inode/文件/目录变更、epoch / abort、CSV 重 ID / 缺 ID / 排序、未知格式、大小 / UTF-8 / BOM、同 mtime 修改、图片变更 / 缺图 / 外链、CAS、immutable evidence、claim 防重与重启恢复。只验证独立核心，不代表 GUI、真实模型看图或腾讯接入已验收。

Electron 定向命令：

```sh
ELECTRON_RUN_AS_NODE=1 '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' node_modules/vitest/vitest.mjs run tests/workspace/local-sources.test.ts tests/workspace/documents.test.ts tests/sources/document-evidence.test.ts
```

2026-11-23 本地计划桥与 CSV 对抗修复后，本核 **100 tests** 通过；主线程 [受影响集成](<../probes/go/local-plan-20261123-1sgYbd/test-integrated-final.log>) **29 文件／814 tests 全通过**，包含全部客户端、实际设置工厂、命令／计划／原出处、production panel port＋fake Host、HTTP＋临时 SQLite 与构建 artifact。此前 61／75 为历史初轮数字，不代表当前全仓库结果。测试不证明 GUI／原生 openat 安全隔离／真实模型视觉闭环。

上述为独立核心首轮结果；集成后的 typecheck / build / HTTP / runtime 与完整回归以 [Go 实施记录](<GO-IMPLEMENTATION-20261121.md>) 的最新门禁为准。已接 runtime 配置 `localSourceRoots`，默认空，未修改实际 Host/profile 来授权目录；未执行 DDL / migration。测试初始化临时 SQLite 使用仓库既有 openStore，仅建立 fixture 所需既有 schema。
