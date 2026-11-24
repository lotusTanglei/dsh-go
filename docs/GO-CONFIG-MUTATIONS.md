# 配置变更持久回执（2026-11-21）

## 边界与 API

`createConfigMutations(store, { requireEpoch })` 只为已有 Host 配置写入提供持久防重放回执，不执行工具、不构造 Host/profile/model，不改变配置权限或原 core 校验。仅使用已有 `kv`，不新增产品 DDL。

- `run({ epoch, requestId, kind, payload }, handler)`：`kind` 仅 `local-configure | local-remove | local-scan | stage-save | tencent-configure | tencent-remove | tencent-scan`。先持久保存 `recorded`，再调用 `handler(commit, checkpoint)`。
- `status({ epoch, requestId })`：只取原回执；缺记录 404 不证明未写入。
- `close({ epoch, requestId, kind, payload })`：显式封存原精确请求；已有任何状态只返回原记录，特别 `recorded` 不释放。确无记录才原子写永久 `closed`，迟到同请求 `run` 不再调用 handler。
- `configMutationDigest(input)`：SHA-256，输入为 deep-key-sorted `canonicalJSON([epoch, requestId, kind, payload])`；数组保序，Unicode/换行原样，不做文本规范化。

三个操作统一实例内串行；请求 ID 是全局持久键。当前 epoch 必须由可信 port 核验；同 ID 改 epoch/kind/payload 返回 409，跨 epoch `status` 返回 404 不泄漏旧结果。一个实例由现有 Store 独占锁保护，不声称支持多进程并行写同一数据库。

## 数据合同

回执严格为：

```ts
{
  mutation: {
    version: 1, epoch, requestId, kind, digest,
    state: 'recorded' | 'settled' | 'rejected' | 'closed',
    at, updatedAt, code?
  },
  value? // 仅 settled；永不放进 mutation 元数据
}
```

`recorded` 表示 handler 可能已进入、没有经同事务核实的完成证据；绝不自动 replay。handler 正常 resolve 但没有同步 `commit` 时仍为 `recorded`，不能靠返回值证明写入完成。`rejected` 是原请求的持久终态：允许人类修改表单后明确新建请求，但不能原 ID 换内容。`closed` 仅封存无记录请求，不取消正在进行或未知写入。

模块只存输入摘要和回执结果，不存输入 payload。caller **必须**传配置 DTO、scan metadata、settings 等 safe JSON payload/result，不传原图、密钥、聊天/文档正文。模块不猜字段或篡改内容、不调用通用脱敏；安全 DTO 的内容所有权在 core/caller，结果会原样持久保存。

输入及结果按 UTF-8 JSON 限制 2 MiB（整个输入/回执元数据也计入限制），最大深度 64。仅有限数字、字符串、布尔、null、稠密普通数组和 plain/null-prototype 对象；拒绝 accessor、symbol、隐藏字段、循环、非 JSON 值及危险对象键 `__proto__ / prototype / constructor` 和控制字符键。读取损坏/非法版本/不合法状态组合一律 503 fail-closed，不自动修复。

## 同事务完成证明

caller 的已有 core SQLite transaction 必须在配置 SQL 成功后、同一事务提交前同步调用 `commit(safeResult)`。安装版 Electron Node `24.21.0` 已验证 `DatabaseSync.isTransaction` 为真实布尔属性；类型声明也提供该属性。模块检查该属性必须 `true`，不编造 PRAGMA、不自行开启/提交事务。`commit` 只对原 `recorded` 行执行精确原始 JSON `v` 的 SQL UPDATE CAS，同时保存 `settled` 与结果。

`checkpoint()` 检查 callback 仍有效及当前 epoch，供 core 在异步边界后与最终写事务中复核。`commit` 自身也调用 checkpoint。handler 结束/抛错后 callback 永久失效；逃逸 callback 不能在后续事务中补写回执。重复 commit 或被改版本/状态的 CAS 失败。

- core SQL 与 commit 同事务成功：run 返回持久 `settled`。
- core 事务中 commit 后抛错：core Store transaction 回滚配置与 settled，run 将原 recorded 持久改为 rejected。
- core 事务成功提交后才抛：run 重新读取已持久 settled，保持成功，不误写 rejected。
- core 已写入但没有 commit（模拟旧路径/crash gap）：仍 recorded，原请求只查状态，不自动重放。
- handler 留下未结束的 SQL transaction：run 503，不暴露未提交 settled；事务生命周期属于可信 core，必须由 caller 修复/回滚。

WorkspaceError 只保存符合固定原因码格式的 `.code`，不保存 message/raw error；其他异常统一 `config_mutation_failed`。本模块不将普通任意对象的 message/code 当可信原因。

## 定向验证

测试仅使用带身份核验清理的真实临时 SQLite、合成 core SQL 与 ports。验证原 core transaction 原子 commit、崩溃间隙 recorded、防 lost reply/replay、415/409 持久 rejected、显式 close/迟到 run、串行队列、epoch、摘要稳定性、损坏 fail-closed、late commit、CAS/回滚及 DTO 隐私边界。未启动 Host/profile/model，不运行 build；服务测试不能代替真实 Host 接线验收。
