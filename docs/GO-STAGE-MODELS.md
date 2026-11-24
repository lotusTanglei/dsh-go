# G5：Host 阶段模型合同（先定 schema）

## 概念与边界

六项 `locate / understand / plan / execute / summarize / verify` 是职责与路由类别，不是固定调用六次。仅 `runStage` 明确调用的一项可运行。默认与阶段覆盖仅作用超管协调器 / 新受控任务的逐次调用；既有 Session 模型永远保留，**覆盖既有 Session 为 unsupported，schema 不提供该字段或方法**。不调用 `session.selectModel`、不写全局默认、不修改 Agent/profile。

使用已有 `kv` 的配置键 `stage-models:v1` 与按 revision 寻址的 `stage-models:baseline:v1:${revision}` 能力基线，无 DDL/迁移。配置：

```ts
type Selection = { provider: string; model: string; reasoningEffort?: string }
type Choice = { mode: 'inherit' } | { mode: 'override'; selection: Selection }
type Config = {
  revision: number // 客户端提交期望版本；保存后原子 +1；初次保存为 0
  default: Selection
  stages: Record<'locate'|'understand'|'plan'|'execute'|'summarize'|'verify', Choice>
}
```

所有层级白名单严格校验，六项必须完整，无额外字段。继承是明确选择而不是失败 fallback。配置不存在时显示未配置，不自动拷贝全局默认。保存先经 Host catalog + 精确 model info 校验，异步后在 SQLite `BEGIN IMMEDIATE` 事务内 CAS；失败不写。`settings()` 返回配置、六项有效 route / blocked 原因、配置版本和固定保留策略。

`resolve(stage, requirements)` 返回冻结 snapshot 及 provider/model/reasoningEffort/configVersion/capabilityProof；缺能力、不兼容、不可用一律 blocked，不换模型。requirements 支持 vision/tools/structured/minContextTokens。视觉取精确 `inputModalities`，上下文取 `context.contextWindow`。tools/structured **不是 DSH model-info 原生字段**，只能由额外 Host evidence+同步失效 fence 证明；无证据为 unknown，有需求则拒绝。推理档必须逐模型精确匹配；省略时披露模型元数据声明的 defaultEffort，不把档位跨 provider 翻译。

`runStage(stage, requirements, {input,context,signal?})` 绑定规范 JSON input 的 SHA-256 与 `requestId/inputRevision/scopeRevision/sourceRevisions/dataCategories`。Host `bind(context).fence()` 同步重验当前输入、范围和来源；每个异步边界后/外发前均重验及 abort。`ports.authorize(snapshot,context,signal)` 是独立真实 Host 外发 gate，不是模型选择；提供 provider、数据类别和固定快照供 Host 做策略/审批，拒绝则 blocked。仅受信任 Host 的 per-call port 可外发；缺 port 则 blocked。调用中配置版本固定，新保存只影响后续调用；旧 scope/来源/许可或迟到结果 blocked 且不发布输出。没有重试/fallback。

逐次 port 必须在自身内部异步边界调用 checkpoint，先记录精确输入与已准备配置（满足安装版 model-visible ⟺ logged），后使用同一 prepared handle 单次 stream。复用适配器将对实际 prepared config、同代视觉/上下文/推理字段做严格检查；模型调用回执绑定实际 config 和输入/版本，不能仅凭设置表声称调用成功。

保存时将默认及每个去重 route 的推理默认档、档位集合、modalities、上下文、defaultMaxTokens、额外 Host 能力证据随配置同事务持久化。随后相同 configVersion 若能力/默认值漂移则 `stage_models_capability_changed`；旧配置缺基线则 `stage_models_baseline_missing`，原配置保留，只能显式重存为新 revision，绝不静默补基线。旧在途快照使用原 revision 基线，不被新设置劫持。

迭代器只在 consumer 真正拉取时创建，每次 `next()` 前后 checkpoint，首次拉流前 consumer 自身 await 后撤权不会 dispatch。**这不是完整原子外发授权保证**：rc.5 的 `llm/stream` middleware 可在本地最终 checkpoint 后、provider I/O 前 await；安装版没有最终 provider dispatch 原子许可接口。prepareCall 默认 maxTokens 等控制项仅记录实际回执，不宣称都已被配置层逐项授权。因此生产只注入 catalog，不注入 bind/authorize/call；真实阶段调用仍 blocked。

## 安装版只读证据

已加载 `dsh-doc`。运行时 `DSH_NODE_EXECUTABLE` 为 Desktop Electron；`process.versions.electron=44.7.0`。ASAR 内 `@deepseek-ai/dsh/package.json:1–4` 确认为 **0.2.2-rc.5**。以下路径均位于 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/`，只读未改：

- `src/types.ts:369–465`：catalog 的 provider/id/name/inputModalities；精确 info 增 context/defaultMaxTokens/reasoning/systemPromptUpdate/toolUpdate。没有 tools 或 structured 支持布尔值；toolUpdate 不是工具支持证明。inputModalities 缺失为 unknown。
- `src/index.ts:775–900`：`resolveModelInfo(provider, model, signal?)` 精确身份校验、正 contextWindow、唯一非空 effort/defaultEffort 校验；catalog 仅 advisory，本核心额外要求 membership。
- `src/index.ts:975–1032`：`prepareCall(config, signal?, configure?)`，configure 同步纯函数，接收冻结 controls 和**同代**精确 model info。捕获 adapter registration，物化默认并冻结 config；stream 一次且 callConfigEquals 严格一致，否则 INVALID_PREPARED_CALL。
- `src/call-config.ts:15–57`：config 为 provider/model + reasoningEffort/temperature/maxTokens/stop；effort 是 adapter-owned opaque string，不能假定 low/high 通用。
- `README.md:129–139`：同代 prepared route 防 HMR 元数据/endpoint 混配；文本模型会将图变占位，因此本核心先拒绝视觉 unknown/negative，不能借该转换去图继续。

仓库 `src/runtime.ts` 所读版本无 `modelAvailable` 符号，只有窄 `RuntimeContext.llm.resolveModelInfo`；现有全局默认读取与 Worker 继承不能当六阶段接口。生产列表/保存 UI、catalog 与 journal 已接线；无真实 call/bind/authorize port，不调用真实模型，不安装依赖。集成构建证据见 [Go 实施记录](<GO-IMPLEMENTATION-20261121.md>)。

## 验证（实现后补充）

定向 fake provider 验证实际 call config/回执、快照版本、换配置隔离、unknown/incompatible/reasoning、权限拒绝、并发、CAS、重启和迟到边界；新增默认能力漂移、旧配置缺基线、consumer 首次拉流前撤权、返回授权对象被回调篡改等反例。完整集成门禁见 [Go 实施记录](<GO-IMPLEMENTATION-20261121.md>)；不把 fake 证据当真实 provider 或 GUI 运行证据。
