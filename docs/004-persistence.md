# 004 · 持久化与恢复

## 1. 选型

**用 `node:sqlite`（Node 内置），不用 DSH 的 storage 服务，不引 better-sqlite3。**

| 选项 | 结论 |
|---|---|
| `node:sqlite` | ✅ 已实测可用（Electron 44.7.0 / Node 24.21.0）。零原生依赖、零编译、跨平台 |
| better-sqlite3 | ✗ 需要 per-platform 原生二进制，桌面版升级 Electron 就要重编 |
| DSH storage 服务 | ✗ 面向键值/文档，做不了"一个事务改三张表"，面板查询也不方便 |

**边界**：DSH 会话日志是**消息历史的唯一真相**，我们不复制聊天记录。
本地库只存**领域状态**（Trigger/Ticket/Assignment/Approval/Outbox）。
两者是"事实"与"账本"的关系，不是一份数据存两遍。

---

## 2. 表结构（migration 001）

```sql
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- 来源实例（为 v2 多源预留，v1 只有 session 一条）
CREATE TABLE source_instance (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  config     TEXT NOT NULL,          -- JSON，不含密钥
  cursor     TEXT,
  health     TEXT,
  updated_at INTEGER NOT NULL
);

-- 去重键在这里
CREATE TABLE trigger (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  external_id TEXT NOT NULL,
  thread_key  TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  actor_bot   INTEGER NOT NULL,
  text        TEXT NOT NULL,
  trust       TEXT NOT NULL,
  addressed   TEXT NOT NULL,
  at          INTEGER NOT NULL,
  raw         TEXT,
  UNIQUE (source, external_id)
);
CREATE INDEX idx_trigger_thread ON trigger(thread_key, at);

CREATE TABLE trigger_disposition (
  trigger_id   TEXT PRIMARY KEY REFERENCES trigger(id),
  at           INTEGER NOT NULL,
  filtered     TEXT,
  eval_id      TEXT,
  decision_id  TEXT,
  ticket_id    TEXT,
  delivered_to TEXT,
  requeued     INTEGER NOT NULL DEFAULT 0,
  acked_by     TEXT
);

CREATE TABLE thread (
  key        TEXT PRIMARY KEY,
  source     TEXT NOT NULL,
  ref_json   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_at    INTEGER NOT NULL,
  seq        INTEGER NOT NULL,
  paused     INTEGER NOT NULL DEFAULT 0,
  evaluating TEXT                    -- 非空 = 有 running 的 Eval
);

CREATE TABLE thread_trigger (
  thread_key TEXT NOT NULL,
  trigger_id TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  state      TEXT NOT NULL,          -- pending | evaluating | consumed
  PRIMARY KEY (thread_key, trigger_id)
);

CREATE TABLE eval (
  id             TEXT PRIMARY KEY,
  thread_key     TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  trigger_ids    TEXT NOT NULL,      -- JSON 数组
  started_at     INTEGER NOT NULL,
  deadline       INTEGER NOT NULL,
  state          TEXT NOT NULL,
  requeues       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE decision (
  id             TEXT PRIMARY KEY,
  eval_id        TEXT NOT NULL,
  thread_key     TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  kind           TEXT NOT NULL,
  reason         TEXT NOT NULL,
  strength       TEXT NOT NULL,
  ticket_id      TEXT,
  trigger_ids    TEXT NOT NULL,
  at             INTEGER NOT NULL
);

CREATE TABLE ticket (
  id                 TEXT PRIMARY KEY,
  thread_key         TEXT NOT NULL,
  decision_id        TEXT NOT NULL,
  title              TEXT NOT NULL,
  state              TEXT NOT NULL,
  mandate_json       TEXT NOT NULL,
  brief_json         TEXT NOT NULL, -- rev2 TicketBrief；首次发布前经用户确认加入 migration 001
  workdir            TEXT NOT NULL,
  stopped_by_human   INTEGER NOT NULL DEFAULT 0,
  attention_json     TEXT,
  current_assignment TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  ended_at           INTEGER,
  ended_by           TEXT,
  outcome            TEXT
);
CREATE INDEX idx_ticket_state ON ticket(state);
CREATE INDEX idx_ticket_thread ON ticket(thread_key);

CREATE TABLE assignment (
  id               TEXT PRIMARY KEY,
  ticket_id        TEXT NOT NULL REFERENCES ticket(id),
  session_id       TEXT NOT NULL,
  state            TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  started_at       INTEGER,
  ended_at         INTEGER,
  ended_reason     TEXT,
  last_progress_at INTEGER NOT NULL,
  steps            INTEGER NOT NULL DEFAULT 0,
  tokens           INTEGER NOT NULL DEFAULT 0,
  retries          INTEGER NOT NULL DEFAULT 0,
  repeated_calls   INTEGER NOT NULL DEFAULT 0,
  report_json      TEXT
);
CREATE INDEX idx_assignment_state ON assignment(state);

CREATE TABLE thread_subscription (
  thread_key TEXT NOT NULL,
  ticket_id  TEXT NOT NULL,
  PRIMARY KEY (thread_key, ticket_id)
);

CREATE TABLE approval (
  id           TEXT PRIMARY KEY,
  ticket_id    TEXT,
  kind         TEXT NOT NULL,
  summary      TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  state        TEXT NOT NULL,
  decided_by   TEXT,
  decided_at   INTEGER,
  reason       TEXT
);
CREATE INDEX idx_approval_state ON approval(state);

CREATE TABLE outbound (
  id              TEXT PRIMARY KEY,
  ticket_id       TEXT,
  thread_key      TEXT NOT NULL,
  channel         TEXT NOT NULL,
  kind            TEXT NOT NULL,
  body            TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,   -- 防重复发送
  state           TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_at         INTEGER NOT NULL,
  last_error      TEXT
);
CREATE INDEX idx_outbound_due ON outbound(state, next_at);

CREATE TABLE side_effect (
  key       TEXT PRIMARY KEY,      -- 幂等键
  kind      TEXT NOT NULL,
  ticket_id TEXT,
  at        INTEGER NOT NULL,
  state     TEXT NOT NULL,         -- claimed | done | failed
  detail    TEXT
);

CREATE TABLE audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  actor      TEXT NOT NULL,        -- router | worker:<id> | watchdog | human:<id> | panel
  action     TEXT NOT NULL,
  ticket_id  TEXT,
  thread_key TEXT,
  detail     TEXT                  -- JSON，禁止写入密钥
);
CREATE INDEX idx_audit_at ON audit(at);

CREATE TABLE kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
```

**约束**

- 时间戳一律 epoch ms 整数。
- `*_json` 为紧凑 JSON，读取时校验 schema 版本字段。
- 不存密钥/token/私有 URL：`raw` 入库前过 redactor。
- 单进程独占：启动取文件锁，第二个进程失败并给出明确日志。

---

## 3. 迁移

```ts
interface Migration { version: number; up(db: DatabaseSync): void }
const migrations: Migration[] = [m001, m002 /* … */]
```

1. **只增不改**：已发布的 migration 永不修改，修正走新版本。
2. 每个 migration 在**一个事务**内执行，成功才写 `schema_migrations`。
3. 启动时若 `db 版本 > 代码已知最大版本` → 拒绝启动（禁止降级打开）。
4. 迁移前备份：`<db>.bak.<version>`（WAL checkpoint 后复制）。
5. 每条 migration 有单测：空库 → migrate → 断言表与索引。

---

## 4. 写路径与事务边界

| 操作 | 同一事务内 |
|---|---|
| ingest | `trigger` + `trigger_disposition` + `thread`(upsert) + `thread_trigger` |
| accept | `decision` + `ticket` + `thread_subscription` + `trigger_disposition` + `audit` |
| assignment_start | `assignment` + `ticket.state` + `audit` |
| report | `assignment`(进展) + `ticket.attention?` + `audit` |
| end | `ticket` + 释放订阅 + `assignment` + `audit` |
| approval | `approval` + `ticket.state` + `audit` |
| outbound 发送 | `outbound.state` + `side_effect` |

**原则**：一次用户可见的状态变化 = 一个事务。最终一致只允许出现在 Outbox。

---

## 5. 幂等与副作用

| 副作用 | 幂等键 | 失败处理 |
|---|---|---|
| 发送消息（Outbox） | `outbound.idempotency_key`（唯一索引） | 重试 N 次 → `dropped` + 告警 |
| 危险动作（v2：合并 PR 等） | `approval_id` | 执行前 `side_effect` 占位；恢复时 `claimed` 视为"不确定" |
| 启动 Worker | `assignment.id` | 新 Assignment = 新键，天然不重复 |

**"不确定"必须显式建模**：发送超时 ≠ 失败。`side_effect.state='claimed'` 在恢复时要先核对远端状态再决定。v1 没有远端动作，只有 Outbox 本地发送。

---

## 6. 启动恢复（与 003-F8 对应）

```
main():
  db = open(config.dbPath)          // 失败：打印路径与原因，退出
  migrate(db)                        // 失败：回滚当前 migration，退出，不动旧数据
  policy = loadPolicy(db)            // 版本 = sha256(规范化 JSON)
  mainSession = ensureMainSession()  // 不存在则创建，写 kv
  reconcileAssignments()             // running → orphan
  reconcileOutbox()                  // pending → 到期重发
  reconcileEvals()                   // running → 过期判定
  reconcileQueue()                   // thread.pending → 重新入队
  startWatchdog()
  registerSources()
```

**幂等证明**：重复执行 `main()` 不新增 Trigger、不新建 Ticket、不重复发送 Outbound。

---

## 7. 备份与保留

- 每日 `VACUUM INTO` 备份一次，保留 7 份。
- 保留策略：`audit` 永久；`trigger`/`decision` 90 天；`outbound(sent)` 30 天。
- 面板提供"导出审计"（JSON Lines）。
