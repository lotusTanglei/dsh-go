import type { Store } from '../store/index.js'
/** Single durable union shared by ingress reservations and source intake. */
export function queueCapacityUsed(store: Store, admittingExternalId?: string): number {
  const active = store.repos.side_effect.all().filter(row => row.kind === 'workspace-command-v1')
    .map(row => row.detail as { stage?: string; messageId?: string })
    .filter(row => !['published', 'canceled', 'rejected'].includes(String(row.stage)))
  const reserved = new Set(active.map(row => row.messageId).filter((id): id is string => typeof id === 'string'))
  const pending = store.db.prepare("SELECT t.external_id FROM thread_trigger q JOIN trigger t ON t.id=q.trigger_id WHERE q.state IN ('pending','evaluating')").all()
  const total = active.length + pending.filter(row => !reserved.has(String(row.external_id))).length
  // This input already owns a slot; admission transfers it, never reserves twice.
  return total - (admittingExternalId && reserved.has(admittingExternalId) ? 1 : 0)
}
