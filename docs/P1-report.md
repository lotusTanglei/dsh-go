# P1 骨架、领域与 SQLite 验收报告

日期：2026-11-17。状态：P1 完成；停在 P2 前，等待用户确认。未 commit（工作区不是 Git 仓库，未擅自初始化）。

## 1. 本阶段做了什么

- 完成 S1–S4 真实探针与用户选择的方案 1：preset 分离工具组合，deny-only 执行闸拒绝额外 Host-global 工具；普通会话不受影响。闸/Assignment 绑定目前仅为探针，不冒称产品 P2 完成。
- 包骨架、可调用的真实 Schemastery Config、配置交叉验证、只做装配的 Host 入口与 inert client。P1 不注册业务工具、slots、定时器或模型循环。
- 纯领域：品牌 ID、Trigger/Thread/Policy/Eval/Mandate/Ticket/Assignment/Approval/Outbound 类型、不可变快照、状态转移和 I1–I10 判定。Policy 用规范化 JSON 的 SHA-256。
- 严格采用 rev2 §7：AcceptanceCriterion、TicketBrief、Ticket.brief；未实现 P2 新增 brief/report/prompt 行为。
- SQLite：内置 node:sqlite，WAL，16 张表与 7 个命名索引，初始迁移/版本检查/升级备份/失败回滚/锁/最小 repos。用户确认 initial ticket 增加 brief_json，完整保存 rev2。
- 真实 Desktop 装载、查询实际库、卸载释放锁。无核心包修改、无风险版本豁免、无安全策略放宽。

## 2. 改了哪些文件

包与配置：package.json、pnpm-lock.yaml、tsconfig.json、tsconfig.build.json、vitest.config.ts、.gitignore、host.cjs、host-runtime.json、cordis.patch.yml、icon.svg、locale/en.json、locale/zh.json、README.md。

产品：src/index.ts、src/config.ts、src/client/index.ts；src/domain/{ids,immutable,trigger,thread,policy,eval,mandate,ticket,assignment,approval,outbound,invariants,index}.ts；src/store/{index,db,codec,migrations}.ts、src/store/migrations/001_init.ts、src/store/repos/index.ts。

测试：tests/config.test.ts、tests/plugin.test.ts、tests/boundaries.test.ts、tests/domain/domain.test.ts、tests/domain/immutable.test.ts、tests/domain-bare.test.mjs、tests/store/store.test.ts、tests/store/hardening.test.ts。

设计补充：docs/002-architecture.md、004-persistence.md、005-security-budget.md、007-plan.md（仅探针/P1 区域）、008-dsh-api-map.md、本报告。用户自行更新的 001 rev2 是输入，不计作本轮修改。

探针：probes/RESULTS.md、probes/s1-bundle/*、probes/s2-s3-s4/*（历史失败输出也保留；最新 guard/activation 输出明确标注）。lib 为构建产物，node_modules 为已授权安装的开发依赖，不是源码交付。

## 3. 新增/修改的公开接口

```ts
createConfigSchema(schema: SchemaFactory): SchemaNode<Config>
resolveConfig(config: Config): Config
apply(ctx: PluginContext, config: Config): void

openStore(options: OpenStoreOptions): Store
// options: dbPath, lockPath?, now?, migrations?, staleLockMs?, busyTimeoutMs?
// Store: db, repos, version, migrateVersion, close()
Store.transaction<T>(fn: (db: DatabaseSync) => T): T // 同步；Promise 拒绝并回滚
TableRepo.insert(row: Row): void
TableRepo.insertOrIgnore(row: Row): void
TableRepo.get(key: unknown): Row | undefined
TableRepo.all(): Row[]
TableRepo.updateByState(key, expectedState, nextState, extra?): boolean

createTicket(input: TicketInput): Ticket // brief 必填
validateTicketBrief(brief: TicketBrief): boolean
validateAcceptanceCriterion(criterion: AcceptanceCriterion): boolean
transition(ticket: Ticket, event: TicketEvent): Ticket
canInvokeAssignmentTool(ticket, assignment, boundAssignmentId): boolean
policyVersion(input: Omit<Policy,'version'> | Policy): string
```

其余领域导出签名见 src/domain/index.ts 及 lib/domain/*.d.ts。以上是 P1 公开接口，不是未发布 DSH 服务声明。

## 4. 测试与实际输出

最终门禁：`pnpm typecheck && pnpm test && pnpm build`。使用依赖工具提供的 Node/pnpm 脚本执行 pnpm；其 scripts 调用本机普通 Node。退出码 0。

```text
$ tsc --noEmit -p tsconfig.json
$ vitest run
✓ tests/store/hardening.test.ts (9 tests)
✓ tests/config.test.ts (4 tests)
✓ tests/store/store.test.ts (6 tests)
✓ tests/plugin.test.ts (2 tests)
✓ tests/boundaries.test.ts (3 tests)
✓ tests/domain/domain.test.ts (10 tests)
✓ tests/domain/immutable.test.ts (2 tests)
Test Files 7 passed (7)
Tests 36 passed (36)
$ tsc -p tsconfig.build.json
```

额外裸跑：`node --test tests/domain-bare.test.mjs`，不 import DSH/Vitest。

```text
ok 1 - built domain runs without DSH or Vitest
# tests 1
# pass 1
# fail 0
```

覆盖：Trigger 三次写入去重；Thread 单 Eval/暂停；Ticket 恢复与人类永久 stop；旧 Assignment；旧 Policy 裁决拒绝/64hex hash；Mandate grant/withdraw/revalidation；I1–I10；Brief 完整性/不可变；16 表/7 索引；状态 CAS/SQL 参数绑定；NOT NULL 不冒充重复；未来 schema/历史缺口拒绝；迁移失败/重试/备份不覆盖；事务回滚/拒绝 async；文件锁竞争/死 owner 恢复/恢复互斥 SIGKILL 自动释放；敏感数据脱敏/可信契约拒绝敏感值不静默篡改；配置真实 Schemastery；插件卸载释放。

Electron 新进程 smoke（当前最终构建）：

```text
[superagent] loaded
VERSION 1
TABLES 16
WAL wal
RECOVERY_MUTEX true
LOCK_RELEASED true
```

Desktop Plugin Manager：原 `>=0.2.2 <0.3.0` 被拒绝，不含 rc.3；经用户确认修改为 `>=0.2.2-rc.3 <0.3.0` 后 install_bundle receipt application=applied、packageResult.exitCode=0、warnings=[]。list_plugins 行 superagent-foundation active。真实库只读检查：

```text
DB_VERSION 1
USER_TABLES 16
WAL wal
BRIEF_NOT_NULL 1
HOST_LOCK_PRESENT true
FINAL_RECOVERY_MUTEX_PRESENT true
```

卸载 receipt application=applied、packageResult.exitCode=0；最终锁不存在。桌面安装证明功能装载，不等同视觉面板完成。图标/资源可解析，未提供浏览器视觉验收。

## 5. 没做什么、已知风险

- 不做 P2 会话、结构化汇报/审批协议、真实领域库 Assignment 执行闸；不做 P3 管线、P4 Watchdog、P5 面板或 P6 压测，更不做 P7/P8。
- I1–I10 在 P1 是领域谓词/状态机与存储约束；engine policy-changed 推送、实际外部发送一次、产品 ended-Assignment 全工具拦截仍须各阶段真实验收，不用这些单测冒充端到端。
- 所有身份/路径契约保持原文；raw/text/audit 等不可信数据脱敏。保守 URL 脱敏会牺牲不可信消息中的链接；契约 JSON 若检测敏感值会拒绝而非静默改变。安全规则 P6 仍需进一步注入集。
- SQLite 是当前运行时的 experimental 模块，会输出该官方 warning。普通 Node 与 Electron 双环境均实际跑过核心路径。
- 卸载保留工作区 SQLite/备份/恢复互斥文件用于证据，不删除数据。损坏且无法确认归属的锁拒绝启动，需人工核实恢复。
- 兼容引导路径保存在 host-runtime.json，是部署配置，不是可移植打包；换机器须配置路径。不包含 DSH 包副本。
- 工作区无 Git，未初始化/commit/push；因此没有 Git diff/提交 hash。已逐文件审查修改并运行门禁。

## 6. 下一阶段建议

等待用户确认 P1 后进入 P2。先读 P2 的 rev2 brief/report/prompt 变更，再实现三个会话角色、数据库绑定的拒绝闸、结构化汇报与自建审批。不自动推进。
