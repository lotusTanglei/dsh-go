import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  readonly version: number
  readonly up: (db: DatabaseSync) => void
}

/** Initial schema. Published migrations are append-only. */
export const m001: Migration = {
  version: 1,
  up(db) {
    db.exec(`
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
CREATE TABLE source_instance (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, config TEXT NOT NULL, cursor TEXT,
  health TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE trigger (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL,
  thread_key TEXT NOT NULL, actor_id TEXT NOT NULL, actor_bot INTEGER NOT NULL,
  text TEXT NOT NULL, trust TEXT NOT NULL, addressed TEXT NOT NULL,
  at INTEGER NOT NULL, raw TEXT, UNIQUE(source, external_id)
);
CREATE INDEX idx_trigger_thread ON trigger(thread_key, at);
CREATE TABLE trigger_disposition (
  trigger_id TEXT PRIMARY KEY REFERENCES trigger(id), at INTEGER NOT NULL,
  filtered TEXT, eval_id TEXT, decision_id TEXT, ticket_id TEXT,
  delivered_to TEXT, requeued INTEGER NOT NULL DEFAULT 0, acked_by TEXT
);
CREATE TABLE thread (
  key TEXT PRIMARY KEY, source TEXT NOT NULL, ref_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_at INTEGER NOT NULL, seq INTEGER NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0, evaluating TEXT
);
CREATE TABLE thread_trigger (
  thread_key TEXT NOT NULL, trigger_id TEXT NOT NULL, seq INTEGER NOT NULL,
  state TEXT NOT NULL, PRIMARY KEY(thread_key, trigger_id)
);
CREATE TABLE eval (
  id TEXT PRIMARY KEY, thread_key TEXT NOT NULL, policy_version TEXT NOT NULL,
  trigger_ids TEXT NOT NULL, started_at INTEGER NOT NULL, deadline INTEGER NOT NULL,
  state TEXT NOT NULL, requeues INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE decision (
  id TEXT PRIMARY KEY, eval_id TEXT NOT NULL, thread_key TEXT NOT NULL,
  policy_version TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL,
  strength TEXT NOT NULL, ticket_id TEXT, trigger_ids TEXT NOT NULL, at INTEGER NOT NULL
);
CREATE TABLE ticket (
  id TEXT PRIMARY KEY, thread_key TEXT NOT NULL, decision_id TEXT NOT NULL,
  title TEXT NOT NULL, state TEXT NOT NULL, mandate_json TEXT NOT NULL,
  brief_json TEXT NOT NULL, workdir TEXT NOT NULL,
  stopped_by_human INTEGER NOT NULL DEFAULT 0, attention_json TEXT,
  current_assignment TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  ended_at INTEGER, ended_by TEXT, outcome TEXT
);
CREATE INDEX idx_ticket_state ON ticket(state);
CREATE INDEX idx_ticket_thread ON ticket(thread_key);
CREATE TABLE assignment (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES ticket(id),
  session_id TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL,
  started_at INTEGER, ended_at INTEGER, ended_reason TEXT,
  last_progress_at INTEGER NOT NULL, steps INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0, retries INTEGER NOT NULL DEFAULT 0,
  repeated_calls INTEGER NOT NULL DEFAULT 0, report_json TEXT
);
CREATE INDEX idx_assignment_state ON assignment(state);
CREATE TABLE thread_subscription (
  thread_key TEXT NOT NULL, ticket_id TEXT NOT NULL,
  PRIMARY KEY(thread_key, ticket_id)
);
CREATE TABLE approval (
  id TEXT PRIMARY KEY, ticket_id TEXT, kind TEXT NOT NULL, summary TEXT NOT NULL,
  payload_json TEXT NOT NULL, requested_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  state TEXT NOT NULL, decided_by TEXT, decided_at INTEGER, reason TEXT
);
CREATE INDEX idx_approval_state ON approval(state);
CREATE TABLE outbound (
  id TEXT PRIMARY KEY, ticket_id TEXT, thread_key TEXT NOT NULL, channel TEXT NOT NULL,
  kind TEXT NOT NULL, body TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL,
  last_error TEXT
);
CREATE INDEX idx_outbound_due ON outbound(state, next_at);
CREATE TABLE side_effect (
  key TEXT PRIMARY KEY, kind TEXT NOT NULL, ticket_id TEXT, at INTEGER NOT NULL,
  state TEXT NOT NULL, detail TEXT
);
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL, ticket_id TEXT, thread_key TEXT, detail TEXT
);
CREATE INDEX idx_audit_at ON audit(at);
CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`)
  },
}

