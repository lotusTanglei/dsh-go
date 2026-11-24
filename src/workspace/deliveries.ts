import { createHash, randomUUID } from 'node:crypto'
import { encodeJson, type Store } from '../store/index.js'
import { WorkspaceError } from './commands.js'
import type { SessionTargetBinding } from './session-actions.js'

export type DeliveryOperation = 'continue' | 'supplement' | 'steer' | 'stop'
/** The only honest interruption evidence this slice accepts from the Host adapter. */
export type DeliveryStopEvidenceKind = 'turn-aborted' | 'cancel-accepted'
/** Host-owned liveness of the exact confirmed target. Never inferred from local metadata. */
export type DeliveryTargetState = 'live' | 'cold' | 'unknown'
/** A model route preserved verbatim from the persisted Session selection projection. */
export interface DeliveryModelSelection { provider: string; model: string; reasoningEffort?: string }
/** Checkable cold→live facts captured by the Host wake adapter. Contains no body, prompt or transcript. */
export interface DeliveryWakeEvidence {
  version: 1; wakeId: string; sessionId: string; from: 'cold'; to: 'live'
  agentPreset?: string; model?: DeliveryModelSelection
}
export type DeliveryWakeState = 'waking' | 'awake' | 'already_live' | 'blocked' | 'wake_unknown'
/** One durable wake fence per confirmed delivery, persisted before any resume side effect. */
export interface DeliveryWakeRecord {
  version: 1; epoch: string; requestId: string; confirmationId: string; wakeId: string; sessionId: string
  seq: number; at: number; updatedAt: number; state: DeliveryWakeState
  evidence?: DeliveryWakeEvidence; code?: string
}
export interface DeliveryImageReference { imageId: string; digest: string; seq: number }
/** Host-only exact visual capability of the confirmed target's current model.
 * `unknown` always blocks an image delivery: absence of proof is never approval.
 */
export type DeliveryImageCapability = 'not-required' | 'supported' | 'unsupported' | 'unknown'
export interface DeliveryTargetInput { sessionId: string; scopeRevision: string; factRevision: string }
export interface DeliveryInput {
  epoch: string; requestId: string; confirmationId: string; operation: DeliveryOperation; text: string
  target: DeliveryTargetInput; images: DeliveryImageReference[]
}
export interface DeliveryConfirmationRecord {
  version: 1; epoch: string; requestId: string; confirmationId: string; operation: DeliveryOperation
  target: SessionTargetBinding; digest: string; bodyBytes: number; images: DeliveryImageReference[]
  seq: number; at: number; updatedAt: number; state: 'prepared' | 'confirmed' | 'canceled'; code?: string
  /** Last Host-read liveness hint; optional so records written before this slice stay valid. */
  targetState?: DeliveryTargetState
  /** Read-only capability hint for the confirmation card; dispatch re-verifies before any upload. */
  imageCapability?: DeliveryImageCapability
}
export type DeliveryConfirmationState = DeliveryConfirmationRecord['state']
export interface DeliveryConfirmationReceipt {
  version: 1; epoch: string; requestId: string; confirmationId: string; operation: DeliveryOperation
  target: SessionTargetBinding; digest: string; bodyBytes: number; images: DeliveryImageReference[]
  seq: number; at: number; updatedAt: number; state: DeliveryConfirmationState
  durable: true; humanConfirmed: boolean; delivered: false; accepted: false; executed: false; completed: false
  /** The hint drives the "this dispatch will wake the conversation" copy; it is not a wake guarantee. */
  targetState: DeliveryTargetState
  /** Exact pre-dispatch visual capability hint. Never an execution grant; dispatch rechecks. */
  imageCapability: DeliveryImageCapability
  disposition: 'not-confirmed' | 'confirmed-pending-delivery' | 'canceled'; code?: string
}
/** One durable dispatch fence per confirmed confirmation. Raw text is never stored. */
export type DeliveryDispatchState = 'dispatching' | 'accepted' | 'interrupted' | 'dispatch_unknown' | 'blocked'
export type DeliveryDispatchTerminalState = Exclude<DeliveryDispatchState, 'dispatching'>
export interface DeliveryDispatchRecord {
  version: 1; epoch: string; requestId: string; confirmationId: string; dispatchId: string; operation: DeliveryOperation
  target: SessionTargetBinding; digest: string; seq: number; at: number; updatedAt: number
  state: DeliveryDispatchState; code?: string
  /** Exact injected message identity for a text delivery; absent for a stop (no message is sent). */
  messageId?: string
  /** Present only for stop, and only once real Host interruption evidence exists. */
  stopEvidence?: DeliveryStopEvidenceKind
  /** True only when this dispatch cold-woke the exact target; stop never wakes. */
  woke?: boolean
  /** Cold→live evidence bound to the wake fence; present exactly when woke is true. */
  wake?: DeliveryWakeEvidence
}
/** accepted means the target has durable evidence of receiving this exact message; never completion.
 * interrupted means a Host cancel was accepted or an aborted turn was observed; neither proves the
 * model has fully stopped, and neither undoes content that was already sent.
 */
export interface DeliveryDispatchReceipt {
  version: 1; epoch: string; requestId: string; confirmationId: string; dispatchId: string
  operation: DeliveryOperation; target: SessionTargetBinding; digest: string; bodyBytes: number; images: DeliveryImageReference[]
  seq: number; at: number; updatedAt: number; state: DeliveryDispatchTerminalState
  durable: true; humanConfirmed: true; delivered: boolean; accepted: boolean; interrupted: boolean
  executed: boolean | null; completed: boolean | null
  disposition: 'not-dispatched' | 'reconcile-only' | 'target-durable-receipt' | 'stop-interrupted'
  /** Whether this dispatch itself woke a cold target before delivering; never a completion claim. */
  woke: boolean
  messageId?: string; stopEvidence?: DeliveryStopEvidenceKind; wake?: DeliveryWakeEvidence; code?: string
}
export interface DeliveryDispatchDecision {
  state: DeliveryDispatchTerminalState
  code?: string
  /** Required for a stop; ignored (and therefore never trusted) for text deliveries. */
  stopEvidence?: DeliveryStopEvidenceKind
}
/** Host answer to one fenced cold wake. `live` means another actor had already woken it: no resume was performed. */
export type DeliveryWakeDecision =
  | { state: 'awake'; agentPreset?: string | null; model?: DeliveryModelSelection | null }
  | { state: 'live' }
  | { state: 'blocked'; code: string }
interface DeliveryMessageEvidence {
  dispatchId: string; confirmationId: string; sessionId: string; digest: string; messageId: string; durable: true; accepted: true
}
interface DeliveryStopEvidence {
  dispatchId: string; confirmationId: string; sessionId: string; digest: string; durable: true; interrupted: true; stopEvidence: DeliveryStopEvidenceKind
}
export type DeliveryDispatchEvidence = DeliveryMessageEvidence | DeliveryStopEvidence
export interface DeliveryPorts {
  requireEpoch(epoch: string): void
  /** Must read current authorized facts. A returned binding is not an execution grant. */
  target(input: DeliveryTargetInput): Promise<{ binding: SessionTargetBinding; fence(): void }>
  /** Host-only exact reference check for already bound images; no bytes, no new binding. */
  images?(input: { epoch: string; references: readonly DeliveryImageReference[]; target: DeliveryTargetInput }): Promise<{ references: readonly DeliveryImageReference[]; fence(): void }>
  /**
   * Read-only Host capability probe for the card: the target's current model route resolved through
   * `resolveModelInfo`. `supported` requires exact `inputModalities` containing `image`; anything
   * missing, exceptional or unknown stays `unknown`. It has no side effect and grants nothing.
   */
  imageCapability?(input: { epoch: string; references: readonly DeliveryImageReference[]; target: DeliveryTargetInput }): Promise<DeliveryImageCapability>
  /**
   * Read-only Host liveness of the exact bound target. It must not wake, create or persist anything;
   * an unavailable probe stays `unknown` and never fabricates `cold`.
   */
  liveness?(sessionId: string): DeliveryTargetState | Promise<DeliveryTargetState>
  /**
   * Host-owned single cold wake, invoked only after the durable wake fence and only for a text
   * operation. It must load the persisted Session, mount its recorded agent preset in `setup`, and
   * never create a new Session. Failures return a fixed blocked code instead of a new conversation.
   */
  wake?(record: Readonly<DeliveryDispatchRecord>, wakeId: string): Promise<DeliveryWakeDecision>
  /**
   * Host-owned live control adapter, invoked once after the durable dispatch fence (and after one
   * successful wake for a cold text target). A text delivery is `accepted` only with durable target
   * evidence; a stop is `interrupted` only with observed interruption evidence; a still-cold target
   * is `blocked` without any resume; an ambiguous Host call is `dispatch_unknown`, never retried.
   */
  dispatch?(record: Readonly<DeliveryDispatchRecord>, text: string, images: readonly DeliveryImageReference[]): Promise<DeliveryDispatchDecision>
  /** Read-only durable target evidence lookup by exact dispatch identity; never resends or wakes. */
  evidence?(record: Readonly<DeliveryDispatchRecord>): Promise<DeliveryDispatchEvidence | undefined>
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/, CODE = /^[A-Za-z][A-Za-z0-9_]{0,95}$/
const STOP_EVIDENCE_KINDS: readonly DeliveryStopEvidenceKind[] = ['turn-aborted', 'cancel-accepted']
const TARGET_STATES: readonly DeliveryTargetState[] = ['live', 'cold', 'unknown']
const ops: readonly DeliveryOperation[] = ['continue', 'supplement', 'steer', 'stop']
const KIND = 'delivery-confirmation-v1', DISPATCH_KIND = 'delivery-dispatch-v1', WAKE_KIND = 'delivery-wake-v1'
const key = (id: string) => `delivery-confirmation:v1:${id}`
const dispatchKey = (id: string) => `delivery-dispatch:v1:${id}`
const wakeKey = (id: string) => `delivery-wake:v1:${id}`
const requestKey = (epoch: string, requestId: string) => `delivery-request:v1:${hash([epoch, requestId])}`
const MAX_TEXT = 16_384, MAX_STOP_REASON = 2000, MAX_IMAGES = 5, MAX_LABEL = 200
const plain = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
const only = (value: Record<string, any>, keys: string[]) => Object.keys(value).every(name => keys.includes(name)) && Object.getOwnPropertySymbols(value).length === 0
const id = (value: unknown): value is string => typeof value === 'string' && ID.test(value) && !value.includes('://')
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)
const digestValid = (value: unknown): value is string => typeof value === 'string' && HASH.test(value)
const codeValid = (value: unknown): value is string => typeof value === 'string' && CODE.test(value)
const stopEvidenceValid = (value: unknown): value is DeliveryStopEvidenceKind => typeof value === 'string' && (STOP_EVIDENCE_KINDS as readonly string[]).includes(value)
const targetStateValid = (value: unknown): value is DeliveryTargetState => typeof value === 'string' && (TARGET_STATES as readonly string[]).includes(value)
const IMAGE_CAPABILITIES: readonly DeliveryImageCapability[] = ['not-required', 'supported', 'unsupported', 'unknown']
const imageCapabilityValid = (value: unknown): value is DeliveryImageCapability => typeof value === 'string' && (IMAGE_CAPABILITIES as readonly string[]).includes(value)
/** Bounded provider/model/preset identity text; never a URL or control character. */
const label = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_LABEL && !/[\u0000-\u001f\u007f]/.test(value) && !value.includes('://')
const selectionValid = (value: unknown): value is DeliveryModelSelection => plain(value) && only(value, ['provider', 'model', 'reasoningEffort'])
  && label(value.provider) && label(value.model) && (value.reasoningEffort === undefined || label(value.reasoningEffort))
const copySelection = (value: DeliveryModelSelection): DeliveryModelSelection => ({ provider: value.provider, model: value.model,
  ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort }) })
const wakeEvidenceValid = (value: unknown): value is DeliveryWakeEvidence => plain(value) && only(value, ['version', 'wakeId', 'sessionId', 'from', 'to', 'agentPreset', 'model'])
  && value.version === 1 && uuid(value.wakeId) && id(value.sessionId) && value.from === 'cold' && value.to === 'live'
  && (value.agentPreset === undefined || label(value.agentPreset))
  && (value.model === undefined || selectionValid(value.model))
const copyWakeEvidence = (value: DeliveryWakeEvidence): DeliveryWakeEvidence => ({ version: 1, wakeId: value.wakeId, sessionId: value.sessionId, from: 'cold', to: 'live',
  ...(value.agentPreset === undefined ? {} : { agentPreset: value.agentPreset }), ...(value.model === undefined ? {} : { model: copySelection(value.model) }) })
const messageTextValid = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()) && !value.includes('\0') && Buffer.byteLength(value, 'utf8') <= MAX_TEXT
const stopReasonValid = (value: unknown): value is string => typeof value === 'string' && !value.includes('\0') && Buffer.byteLength(value, 'utf8') <= MAX_STOP_REASON
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && (value as number) >= min
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function fail(code: string, status = 409): never { throw new WorkspaceError(code, status) }
const targetValid = (value: unknown): value is DeliveryTargetInput => plain(value) && only(value, ['sessionId', 'scopeRevision', 'factRevision'])
  && id(value.sessionId) && digestValid(value.scopeRevision) && digestValid(value.factRevision)
const bindingValid = (value: unknown): value is SessionTargetBinding => plain(value) && only(value, ['sessionId', 'scopeRevision', 'factRevision', 'project'])
  && targetValid({ sessionId: value.sessionId, scopeRevision: value.scopeRevision, factRevision: value.factRevision })
  && plain(value.project) && only(value.project, ['kind', 'key']) && ['project', 'unassigned'].includes(value.project.kind) && id(value.project.key)
  && (value.project.kind !== 'unassigned' || value.project.key === 'unassigned')
const imageValid = (value: unknown): value is DeliveryImageReference => plain(value) && only(value, ['imageId', 'digest', 'seq'])
  && uuid(value.imageId) && digestValid(value.digest) && integer(value.seq, 1)
const imagesValid = (value: unknown): value is DeliveryImageReference[] => Array.isArray(value) && value.length <= MAX_IMAGES
  && new Set(value.map(item => item?.imageId)).size === value.length && value.every(imageValid)
const copyTarget = (value: DeliveryTargetInput): DeliveryTargetInput => ({ sessionId: value.sessionId, scopeRevision: value.scopeRevision, factRevision: value.factRevision })
const copyBinding = (value: SessionTargetBinding): SessionTargetBinding => ({ ...copyTarget(value), project: { kind: value.project.kind, key: value.project.key } })
const copyImages = (value: readonly DeliveryImageReference[]): DeliveryImageReference[] => value.map(item => ({ imageId: item.imageId, digest: item.digest, seq: item.seq }))
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child) }
  return value
}
const sameTarget = (a: DeliveryTargetInput, b: DeliveryTargetInput) => a.sessionId === b.sessionId && a.scopeRevision === b.scopeRevision && a.factRevision === b.factRevision

export function validDeliveryInput(value: unknown): value is DeliveryInput {
  if (!(plain(value) && only(value, ['epoch', 'requestId', 'confirmationId', 'operation', 'text', 'target', 'images'])
    && id(value.epoch) && uuid(value.requestId) && uuid(value.confirmationId) && ops.includes(value.operation)
    && targetValid(value.target) && imagesValid(value.images))) return false
  // A stop carries no delivered body. Its text is an optional human reason, never a message.
  if (value.operation === 'stop') return stopReasonValid(value.text) && value.images.length === 0
  return messageTextValid(value.text)
}
export function deliveryDigest(value: DeliveryInput): string {
  // Exact Unicode/newline semantics. No normalization or redacted replay copy.
  return hash([value.epoch, value.requestId, value.confirmationId, value.operation, value.text,
    value.target.sessionId, value.target.scopeRevision, value.target.factRevision,
    value.images.map(item => [item.imageId, item.digest, item.seq])])
}
function recordValid(value: unknown): value is DeliveryConfirmationRecord {
  if (!plain(value) || !only(value, ['version', 'epoch', 'requestId', 'confirmationId', 'operation', 'target', 'digest', 'bodyBytes', 'images', 'seq', 'at', 'updatedAt', 'state', 'code', 'targetState', 'imageCapability'])
    || value.version !== 1 || !id(value.epoch) || !uuid(value.requestId) || !uuid(value.confirmationId) || !ops.includes(value.operation)
    || !bindingValid(value.target) || !digestValid(value.digest) || !integer(value.bodyBytes) || value.bodyBytes > MAX_TEXT
    || value.operation !== 'stop' && value.bodyBytes < 1 || value.operation === 'stop' && value.bodyBytes > MAX_STOP_REASON
    || !imagesValid(value.images) || value.operation === 'stop' && value.images.length > 0
    || !integer(value.at) || !integer(value.updatedAt) || value.updatedAt < value.at
    || (value.targetState !== undefined && !targetStateValid(value.targetState))
    || (value.imageCapability !== undefined && !imageCapabilityValid(value.imageCapability))) return false
  const sequence = { prepared: 1, confirmed: 2, canceled: 2 } as Record<string, number>
  if (!(value.state in sequence) || value.seq !== sequence[value.state]) return false
  return (value.code === undefined || codeValid(value.code))
}
const dispatchSequence: Record<DeliveryDispatchState, readonly number[]> = { dispatching: [1], accepted: [2, 3], interrupted: [2, 3], dispatch_unknown: [2], blocked: [2] }
function dispatchRecordValid(value: unknown): value is DeliveryDispatchRecord {
  if (!plain(value) || !only(value, ['version', 'epoch', 'requestId', 'confirmationId', 'dispatchId', 'operation', 'target', 'digest', 'messageId', 'stopEvidence', 'woke', 'wake', 'seq', 'at', 'updatedAt', 'state', 'code'])
    || value.version !== 1 || !id(value.epoch) || !uuid(value.requestId) || !uuid(value.confirmationId) || !uuid(value.dispatchId) || !ops.includes(value.operation)
    || !bindingValid(value.target) || !digestValid(value.digest)
    || typeof value.state !== 'string' || !(value.state in dispatchSequence) || !dispatchSequence[value.state as DeliveryDispatchState].includes(value.seq)
    || !integer(value.at) || !integer(value.updatedAt) || value.updatedAt < value.at
    || !(value.code === undefined || codeValid(value.code))) return false
  const stopEvidence = value.stopEvidence
  if (stopEvidence !== undefined && !stopEvidenceValid(stopEvidence)) return false
  // Wake evidence is never inferred: present exactly when this dispatch claims it woke the target.
  if (value.woke !== undefined && typeof value.woke !== 'boolean') return false
  if (value.woke === true ? !wakeEvidenceValid(value.wake) || value.wake.sessionId !== value.target.sessionId : value.wake !== undefined) return false
  if (value.operation === 'stop') {
    // A stop never produces a message identity, never claims message acceptance and never wakes.
    return value.messageId === undefined && value.state !== 'accepted' && value.woke !== true
      && (value.state === 'interrupted' ? stopEvidenceValid(stopEvidence) : stopEvidence === undefined)
  }
  return value.messageId === `go:${value.dispatchId}` && stopEvidence === undefined && value.state !== 'interrupted'
}
const wakeSequence: Record<DeliveryWakeState, readonly number[]> = { waking: [1], awake: [2], already_live: [2], blocked: [2], wake_unknown: [2] }
function wakeRecordValid(value: unknown): value is DeliveryWakeRecord {
  if (!plain(value) || !only(value, ['version', 'epoch', 'requestId', 'confirmationId', 'wakeId', 'sessionId', 'seq', 'at', 'updatedAt', 'state', 'evidence', 'code'])
    || value.version !== 1 || !id(value.epoch) || !uuid(value.requestId) || !uuid(value.confirmationId) || !uuid(value.wakeId) || !id(value.sessionId)
    || typeof value.state !== 'string' || !(value.state in wakeSequence) || !wakeSequence[value.state as DeliveryWakeState].includes(value.seq)
    || !integer(value.at) || !integer(value.updatedAt) || value.updatedAt < value.at
    || !(value.code === undefined || codeValid(value.code))) return false
  if (value.state === 'awake') return wakeEvidenceValid(value.evidence) && value.evidence.wakeId === value.wakeId && value.evidence.sessionId === value.sessionId && value.code === undefined
  if (value.evidence !== undefined) return false
  return value.state === 'waking' || value.state === 'already_live' ? value.code === undefined : codeValid(value.code)
}
function messageEvidenceValid(value: unknown): value is DeliveryMessageEvidence {
  return plain(value) && only(value, ['dispatchId', 'confirmationId', 'sessionId', 'digest', 'messageId', 'durable', 'accepted'])
    && uuid(value.dispatchId) && uuid(value.confirmationId) && id(value.sessionId) && digestValid(value.digest)
    && typeof value.messageId === 'string' && value.messageId === `go:${value.dispatchId}`
    && value.durable === true && value.accepted === true
}
function stopDispatchEvidenceValid(value: unknown): value is DeliveryStopEvidence {
  return plain(value) && only(value, ['dispatchId', 'confirmationId', 'sessionId', 'digest', 'durable', 'interrupted', 'stopEvidence'])
    && uuid(value.dispatchId) && uuid(value.confirmationId) && id(value.sessionId) && digestValid(value.digest)
    && value.durable === true && value.interrupted === true && stopEvidenceValid(value.stopEvidence)
}
function dispatchEvidenceMatches(record: DeliveryDispatchRecord, evidence: DeliveryDispatchEvidence): boolean {
  return evidence.dispatchId === record.dispatchId && evidence.confirmationId === record.confirmationId
    && evidence.sessionId === record.target.sessionId && evidence.digest === record.digest
    // A stop may only cite interruption evidence; a text delivery may only cite a committed message.
    && (record.operation === 'stop' ? stopDispatchEvidenceValid(evidence) : messageEvidenceValid(evidence) && evidence.messageId === record.messageId)
}
function receipt(record: DeliveryConfirmationRecord): DeliveryConfirmationReceipt {
  return freeze({ version: 1 as const, epoch: record.epoch, requestId: record.requestId, confirmationId: record.confirmationId,
    operation: record.operation, target: copyBinding(record.target), digest: record.digest, bodyBytes: record.bodyBytes,
    images: copyImages(record.images), seq: record.seq, at: record.at, updatedAt: record.updatedAt, state: record.state,
    durable: true as const, humanConfirmed: record.state === 'confirmed', delivered: false as const, accepted: false as const,
    executed: false as const, completed: false as const, targetState: record.targetState ?? 'unknown' as const,
    imageCapability: record.imageCapability ?? (record.images.length ? 'unknown' as const : 'not-required' as const),
    disposition: record.state === 'confirmed' ? 'confirmed-pending-delivery' as const : record.state === 'canceled' ? 'canceled' as const : 'not-confirmed' as const,
    ...(record.code ? { code: record.code } : {}) })
}
function dispatchReceipt(record: DeliveryDispatchRecord, confirmation: DeliveryConfirmationRecord): DeliveryDispatchReceipt {
  // `dispatching` is an internal fence; a reader must reconcile it to an honest unknown first.
  if (record.state === 'dispatching') return fail('delivery_dispatch_record_invalid', 503)
  const accepted = record.state === 'accepted', blocked = record.state === 'blocked', interrupted = record.state === 'interrupted'
  return freeze({ version: 1 as const, epoch: record.epoch, requestId: record.requestId, confirmationId: record.confirmationId,
    dispatchId: record.dispatchId, ...(record.messageId === undefined ? {} : { messageId: record.messageId }),
    operation: record.operation,
    target: copyBinding(record.target), digest: record.digest, bodyBytes: confirmation.bodyBytes, images: copyImages(confirmation.images),
    seq: record.seq, at: record.at, updatedAt: record.updatedAt, state: record.state,
    durable: true as const, humanConfirmed: true as const, delivered: accepted, accepted, interrupted,
    executed: blocked ? false : null, completed: blocked ? false : null, woke: record.woke === true && record.wake !== undefined,
    disposition: accepted ? 'target-durable-receipt' as const : interrupted ? 'stop-interrupted' as const : blocked ? 'not-dispatched' as const : 'reconcile-only' as const,
    ...(record.stopEvidence === undefined ? {} : { stopEvidence: record.stopEvidence }),
    ...(record.wake === undefined ? {} : { wake: copyWakeEvidence(record.wake) }),
    ...(record.code ? { code: record.code } : {}) })
}
function metadata(record: DeliveryConfirmationRecord): DeliveryConfirmationRecord {
  // Strict allowlist contains no body text and no raw caller payload.
  return { version: 1, epoch: record.epoch, requestId: record.requestId, confirmationId: record.confirmationId, operation: record.operation,
    target: copyBinding(record.target), digest: record.digest, bodyBytes: record.bodyBytes, images: copyImages(record.images),
    seq: record.seq, at: record.at, updatedAt: record.updatedAt, state: record.state, ...(record.code ? { code: record.code } : {}),
    ...(record.targetState === undefined ? {} : { targetState: record.targetState }),
    ...(record.imageCapability === undefined ? {} : { imageCapability: record.imageCapability }) }
}
function dispatchMetadata(record: DeliveryDispatchRecord): DeliveryDispatchRecord {
  // Strict allowlist contains no body text and no raw caller payload.
  return { version: 1, epoch: record.epoch, requestId: record.requestId, confirmationId: record.confirmationId, dispatchId: record.dispatchId,
    operation: record.operation, target: copyBinding(record.target), digest: record.digest,
    ...(record.messageId === undefined ? {} : { messageId: record.messageId }), ...(record.stopEvidence === undefined ? {} : { stopEvidence: record.stopEvidence }),
    ...(record.woke === true ? { woke: true as const } : {}), ...(record.wake === undefined ? {} : { wake: copyWakeEvidence(record.wake) }),
    seq: record.seq, at: record.at, updatedAt: record.updatedAt, state: record.state, ...(record.code ? { code: record.code } : {}) }
}

/**
 * Human pre-delivery confirmation, then one durable, non-replaying dispatch to the exact confirmed
 * target. A `confirmed` record has no external effect; `dispatch` performs at most one durable wake
 * fence plus one Host wake for a cold text target, then the single Host control call, and returns
 * only accepted / interrupted / unknown / blocked evidence. A failed wake is a terminal blocked
 * outcome for this confirmation: it never falls back to a new Session and never drops the draft.
 * `stop` sends no message and never wakes a cold target: it asks the live Host to cancel, and
 * reports `interrupted` only when the Host adapter returns real interruption evidence (an aborted
 * turn or an accepted cancel). No Agent, Worker, message or Session API is reachable from the
 * confirmation service itself.
 */
export function createDeliveries(store: Store, ports: DeliveryPorts) {
  let tail = Promise.resolve()
  const serialize = <T>(fn: () => Promise<T>) => { const next = tail.then(fn); tail = next.then(() => {}, () => {}); return next }
  function read(confirmationId: string): DeliveryConfirmationRecord | undefined {
    const row = store.repos.side_effect.get(key(confirmationId))
    if (!row) return undefined
    const value = row.detail
    if (row.kind !== KIND || !recordValid(value) || value.confirmationId !== confirmationId || row.state !== `v1:${value.seq}`) fail('delivery_confirmation_record_invalid', 503)
    const pointer = store.repos.kv.get(requestKey(value.epoch, value.requestId))?.v
    if (!plain(pointer) || !only(pointer, ['version', 'confirmationId']) || pointer.version !== 1 || pointer.confirmationId !== confirmationId) fail('delivery_confirmation_record_invalid', 503)
    return value
  }
  function pointerFor(epoch: string, requestId: string) {
    const value = store.repos.kv.get(requestKey(epoch, requestId))?.v
    if (value === undefined) return undefined
    if (!plain(value) || !only(value, ['version', 'confirmationId']) || value.version !== 1 || !uuid(value.confirmationId)) fail('delivery_confirmation_record_invalid', 503)
    return value as { version: 1; confirmationId: string }
  }
  /** Classify idempotent replay, request conflict and corrupted pointer before any side effect. */
  function existing(input: DeliveryInput): DeliveryConfirmationRecord | undefined {
    const pointer = pointerFor(input.epoch, input.requestId)
    const current = read(input.confirmationId)
    if (pointer && pointer.confirmationId !== input.confirmationId) fail('delivery_request_conflict')
    if (current && (current.epoch !== input.epoch || current.requestId !== input.requestId)) fail('delivery_request_conflict')
    if (current && current.digest !== deliveryDigest(input)) fail('delivery_request_conflict')
    if (Boolean(pointer) !== Boolean(current)) fail('delivery_confirmation_record_invalid', 503)
    return current
  }
  function update(record: DeliveryConfirmationRecord, state: 'confirmed' | 'canceled', patch: { targetState?: DeliveryTargetState; imageCapability?: DeliveryImageCapability } = {}): DeliveryConfirmationRecord {
    const next: DeliveryConfirmationRecord = { ...metadata(record), state, seq: record.seq + 1, updatedAt: Math.max(Date.now(), record.updatedAt),
      ...(patch.targetState === undefined ? {} : { targetState: patch.targetState }),
      ...(patch.imageCapability === undefined ? {} : { imageCapability: patch.imageCapability }) }
    if (!recordValid(next)) fail('delivery_confirmation_record_invalid', 503)
    const changed = store.db.prepare('UPDATE side_effect SET state=?, detail=? WHERE key=? AND state=?')
      .run(`v1:${next.seq}`, encodeJson(next, false), key(record.confirmationId), `v1:${record.seq}`)
    if (Number(changed.changes) !== 1) fail('delivery_confirmation_conflict')
    return next
  }
  /** Read-only Host liveness hint; absence or a failed probe is honest `unknown`, never `cold`. */
  async function probeTarget(sessionId: string): Promise<DeliveryTargetState> {
    if (!ports.liveness) return 'unknown'
    try {
      const value = await ports.liveness(sessionId)
      return targetStateValid(value) ? value : 'unknown'
    } catch { return 'unknown' }
  }
  function readDispatch(confirmationId: string): DeliveryDispatchRecord | undefined {
    if (!uuid(confirmationId)) return undefined
    const row = store.repos.side_effect.get(dispatchKey(confirmationId))
    if (!row) return undefined
    const value = row.detail
    if (row.kind !== DISPATCH_KIND || !dispatchRecordValid(value) || value.confirmationId !== confirmationId || row.state !== `v1:${value.seq}`) fail('delivery_dispatch_record_invalid', 503)
    return value
  }
  function updateDispatch(record: DeliveryDispatchRecord, state: DeliveryDispatchTerminalState, patch: { code?: string; stopEvidence?: DeliveryStopEvidenceKind; wake?: DeliveryWakeEvidence } = {}): DeliveryDispatchRecord {
    const transitions: Record<DeliveryDispatchState, readonly DeliveryDispatchState[]> = {
      dispatching: ['accepted', 'interrupted', 'dispatch_unknown', 'blocked'], dispatch_unknown: ['accepted', 'interrupted'], accepted: [], interrupted: [], blocked: [],
    }
    if (!transitions[record.state].includes(state)) fail('delivery_dispatch_conflict')
    const next: DeliveryDispatchRecord = { ...dispatchMetadata(record), state, seq: record.seq + 1, updatedAt: Math.max(Date.now(), record.updatedAt),
      ...(patch.code === undefined ? {} : { code: patch.code }), ...(patch.stopEvidence === undefined ? {} : { stopEvidence: patch.stopEvidence }),
      ...(patch.wake === undefined ? {} : { woke: true as const, wake: copyWakeEvidence(patch.wake) }) }
    if (patch.code === undefined) delete next.code
    if (state !== 'interrupted') delete next.stopEvidence
    if (!dispatchRecordValid(next)) fail('delivery_dispatch_record_invalid', 503)
    // Strict schema contains only bounded metadata. Raw text is never persisted or redacted into a record.
    const changed = store.db.prepare('UPDATE side_effect SET state=?, detail=? WHERE key=? AND state=?')
      .run(`v1:${next.seq}`, encodeJson(next, false), dispatchKey(record.confirmationId), `v1:${record.seq}`)
    if (Number(changed.changes) !== 1) fail('delivery_dispatch_conflict')
    return next
  }
  function readWake(confirmationId: string): DeliveryWakeRecord | undefined {
    if (!uuid(confirmationId)) return undefined
    const row = store.repos.side_effect.get(wakeKey(confirmationId))
    if (!row) return undefined
    const value = row.detail
    if (row.kind !== WAKE_KIND || !wakeRecordValid(value) || value.confirmationId !== confirmationId || row.state !== `v1:${value.seq}`) fail('delivery_wake_record_invalid', 503)
    return value
  }
  function updateWake(record: DeliveryWakeRecord, state: Exclude<DeliveryWakeState, 'waking'>, patch: { code?: string; evidence?: DeliveryWakeEvidence } = {}): DeliveryWakeRecord {
    const transitions: Record<DeliveryWakeState, readonly DeliveryWakeState[]> = { waking: ['awake', 'already_live', 'blocked', 'wake_unknown'], awake: [], already_live: [], blocked: [], wake_unknown: [] }
    if (!transitions[record.state].includes(state)) fail('delivery_wake_conflict')
    const next: DeliveryWakeRecord = { version: 1, epoch: record.epoch, requestId: record.requestId, confirmationId: record.confirmationId, wakeId: record.wakeId, sessionId: record.sessionId,
      seq: record.seq + 1, at: record.at, updatedAt: Math.max(Date.now(), record.updatedAt), state,
      ...(patch.evidence === undefined ? {} : { evidence: copyWakeEvidence(patch.evidence) }), ...(patch.code === undefined ? {} : { code: patch.code }) }
    if (!wakeRecordValid(next)) fail('delivery_wake_record_invalid', 503)
    const changed = store.db.prepare('UPDATE side_effect SET state=?, detail=? WHERE key=? AND state=?')
      .run(`v1:${next.seq}`, encodeJson(next, false), wakeKey(record.confirmationId), `v1:${record.seq}`)
    if (Number(changed.changes) !== 1) fail('delivery_wake_conflict')
    return next
  }
  /** Persist the wake fence before the one resume side effect. Never replaces an existing fence. */
  function insertWake(dispatch: DeliveryDispatchRecord): DeliveryWakeRecord {
    const at = Date.now()
    const value: DeliveryWakeRecord = { version: 1, epoch: dispatch.epoch, requestId: dispatch.requestId, confirmationId: dispatch.confirmationId,
      wakeId: randomUUID(), sessionId: dispatch.target.sessionId, seq: 1, at, updatedAt: at, state: 'waking' }
    if (!wakeRecordValid(value)) return fail('delivery_wake_record_invalid', 503)
    store.db.prepare('INSERT INTO side_effect(key,kind,ticket_id,at,state,detail) VALUES (?,?,NULL,?,?,?)').run(wakeKey(dispatch.confirmationId), WAKE_KIND, at, 'v1:1', encodeJson(value, false))
    return value
  }
  /** A crash-left waking fence is an unknown wake outcome: normalize it once and never resume again. */
  function reconcileWake(confirmationId: string): void {
    const record = readWake(confirmationId)
    if (!record || record.state !== 'waking') return
    store.transaction(() => {
      const current = readWake(confirmationId)
      if (!current || current.state !== 'waking') return current
      return updateWake(current, 'wake_unknown', { code: 'delivery_wake_unknown' })
    })
  }
  /** Build canonical evidence from a trusted Host awake answer; invalid values fail closed. */
  function buildWakeEvidence(wake: DeliveryWakeRecord, decision: Record<string, any>): DeliveryWakeEvidence | undefined {
    if (!plain(decision) || !only(decision, ['state', 'agentPreset', 'model'])) return undefined
    const preset = decision.agentPreset, model = decision.model
    if (preset !== undefined && preset !== null && !label(preset)) return undefined
    if (model !== undefined && model !== null && !selectionValid(model)) return undefined
    return { version: 1, wakeId: wake.wakeId, sessionId: wake.sessionId, from: 'cold', to: 'live',
      ...(typeof preset === 'string' ? { agentPreset: preset } : {}),
      ...(model === undefined || model === null ? {} : { model: copySelection(model) }) }
  }
  async function targetCut(requested: DeliveryTargetInput): Promise<{ binding: SessionTargetBinding; fence(): void }> {
    let resolved: Awaited<ReturnType<DeliveryPorts['target']>>
    try { resolved = await ports.target({ ...requested }) } catch { return fail('delivery_target_changed') }
    if (!plain(resolved) || !bindingValid(resolved.binding) || typeof resolved.fence !== 'function') return fail('delivery_target_changed')
    const binding = freeze(copyBinding(resolved.binding)), fence = resolved.fence.bind(resolved)
    if (!sameTarget(binding, requested)) return fail('delivery_target_changed')
    try { fence() } catch { return fail('delivery_target_changed') }
    return { binding, fence }
  }
  async function imageCut(epoch: string, references: readonly DeliveryImageReference[], target: DeliveryTargetInput): Promise<{ references: DeliveryImageReference[]; fence(): void }> {
    const snapshot = copyImages(references)
    if (!snapshot.length) return { references: [], fence() {} }
    if (!ports.images) return fail('delivery_images_unavailable', 503)
    let resolved: Awaited<ReturnType<NonNullable<DeliveryPorts['images']>>>
    try { resolved = await ports.images({ epoch, references: snapshot.map(item => ({ ...item })), target: copyTarget(target) }) }
    catch (error) {
      if (error instanceof WorkspaceError && error.status === 503) throw error
      return fail('delivery_image_changed')
    }
    if (!plain(resolved) || !Array.isArray(resolved.references) || resolved.references.length !== snapshot.length || typeof resolved.fence !== 'function') return fail('delivery_image_changed')
    const canonical = freeze(resolved.references.map(item => ({ imageId: item?.imageId, digest: item?.digest, seq: item?.seq })))
    for (let index = 0; index < snapshot.length; index++) {
      const expected = snapshot[index]!, actual = canonical[index]
      if (!imageValid(actual) || actual.imageId !== expected.imageId || actual.digest !== expected.digest || actual.seq !== expected.seq) return fail('delivery_image_changed')
    }
    const fence = resolved.fence.bind(resolved)
    try { fence() } catch { return fail('delivery_image_changed') }
    return { references: canonical, fence }
  }
  /** Read-only capability hint; a missing port or any failure is honest `unknown`, never support. */
  async function probeImageCapability(epoch: string, references: readonly DeliveryImageReference[], target: DeliveryTargetInput): Promise<DeliveryImageCapability> {
    if (!references.length) return 'not-required'
    if (!ports.imageCapability) return 'unknown'
    try {
      const value = await ports.imageCapability({ epoch, references: copyImages(references), target: copyTarget(target) })
      return value === 'supported' || value === 'unsupported' ? value : 'unknown'
    } catch { return 'unknown' }
  }
  function insert(input: DeliveryInput, binding: SessionTargetBinding, images: readonly DeliveryImageReference[], targetState: DeliveryTargetState, imageCapability: DeliveryImageCapability): DeliveryConfirmationRecord {
    const at = Date.now()
    const value: DeliveryConfirmationRecord = { version: 1, epoch: input.epoch, requestId: input.requestId, confirmationId: input.confirmationId,
      operation: input.operation, target: copyBinding(binding), digest: deliveryDigest(input), bodyBytes: Buffer.byteLength(input.text, 'utf8'),
      images: copyImages(images), seq: 1, at, updatedAt: at, state: 'prepared', targetState, imageCapability }
    if (!recordValid(value)) return fail('delivery_confirmation_record_invalid', 503)
    store.repos.kv.insert({ k: requestKey(input.epoch, input.requestId), v: { version: 1, confirmationId: input.confirmationId } })
    store.db.prepare('INSERT INTO side_effect(key,kind,ticket_id,at,state,detail) VALUES (?,?,NULL,?,?,?)').run(key(input.confirmationId), KIND, at, 'v1:1', encodeJson(value, false))
    return value
  }
  function confirmedForDispatch(input: DeliveryInput): DeliveryConfirmationRecord {
    const current = read(input.confirmationId)
    if (!current || current.epoch !== input.epoch) return fail('delivery_confirmation_not_found', 404)
    if (current.requestId !== input.requestId) return fail('delivery_request_conflict')
    if (current.operation !== input.operation || !sameTarget(current.target, input.target) || current.digest !== deliveryDigest(input)) return fail('delivery_confirmation_changed')
    if (current.state === 'canceled') return fail('delivery_confirmation_canceled')
    if (current.state !== 'confirmed') return fail('delivery_confirmation_not_confirmed')
    return current
  }
  /** Reconcile one fence: dispatching means the previous process died before a result was known. */
  async function reconcile(record: DeliveryDispatchRecord): Promise<DeliveryDispatchRecord> {
    // A crash-left wake fence is reconciled first: unknown means "never resume again", not "retry".
    if (record.state === 'dispatching') {
      try { reconcileWake(record.confirmationId) } catch { /* keep the durable wake fence */ }
    }
    if (record.state === 'dispatching') {
      try {
        record = store.transaction(() => {
          const current = readDispatch(record.confirmationId)
          if (!current) return fail('delivery_dispatch_record_invalid', 503)
          return current.state === 'dispatching' ? updateDispatch(current, 'dispatch_unknown', { code: 'delivery_dispatch_unknown' }) : current
        })
      } catch (error) {
        if (error instanceof WorkspaceError) throw error
        return record
      }
    }
    if (record.state !== 'dispatch_unknown' || !ports.evidence) return record
    let evidence: DeliveryDispatchEvidence | undefined
    try { evidence = await ports.evidence(freeze(record)) } catch { return record }
    try { ports.requireEpoch(record.epoch) } catch { return record }
    if (!plain(evidence) || !dispatchEvidenceMatches(record, evidence as DeliveryDispatchEvidence)) return record
    return store.transaction(() => {
      const current = readDispatch(record.confirmationId)!
      if (current.state !== 'dispatch_unknown') return current
      return current.operation === 'stop'
        ? updateDispatch(current, 'interrupted', { stopEvidence: (evidence as DeliveryStopEvidence).stopEvidence })
        : updateDispatch(current, 'accepted')
    })
  }
  return {
    async prepare(raw: DeliveryInput) {
      if (!validDeliveryInput(raw)) return fail('delivery_invalid', 400)
      const input = freeze(structuredClone(raw))
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        const prior = existing(input)
        if (prior) return receipt(prior)
        const cut = await targetCut(input.target)
        ports.requireEpoch(input.epoch)
        const images = await imageCut(input.epoch, input.images, cut.binding)
        ports.requireEpoch(input.epoch)
        // Read-only liveness and visual-capability hints for the confirmation card. Neither is a wake
        // decision or an execution grant; dispatch re-reads both before any upload or message.
        const targetState = await probeTarget(input.target.sessionId)
        const imageCapability = await probeImageCapability(input.epoch, images.references, cut.binding)
        cut.fence(); images.fence()
        const record = store.transaction(() => {
          ports.requireEpoch(input.epoch)
          const replay = existing(input)
          if (replay) return replay
          return insert(input, cut.binding, images.references, targetState, imageCapability)
        })
        return receipt(record)
      })
    },
    async confirm(raw: DeliveryInput) {
      if (!validDeliveryInput(raw)) return fail('delivery_invalid', 400)
      const input = freeze(structuredClone(raw))
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        const current = read(input.confirmationId)
        if (!current || current.epoch !== input.epoch) return fail('delivery_confirmation_not_found', 404)
        if (current.requestId !== input.requestId) return fail('delivery_request_conflict')
        if (current.digest !== deliveryDigest(input)) return fail('delivery_confirmation_changed')
        if (current.state === 'confirmed') return receipt(current)
        if (current.state === 'canceled') return fail('delivery_confirmation_canceled')
        const cut = await targetCut(input.target)
        ports.requireEpoch(input.epoch)
        const images = await imageCut(input.epoch, input.images, cut.binding)
        ports.requireEpoch(input.epoch)
        const targetState = await probeTarget(input.target.sessionId)
        const imageCapability = await probeImageCapability(input.epoch, images.references, cut.binding)
        const record = store.transaction(() => {
          ports.requireEpoch(input.epoch)
          const latest = read(input.confirmationId)
          if (!latest) return fail('delivery_confirmation_not_found', 404)
          if (latest.state === 'confirmed') return latest
          if (latest.state === 'canceled') return fail('delivery_confirmation_canceled')
          if (latest.digest !== deliveryDigest(input) || latest.requestId !== input.requestId) return fail('delivery_request_conflict')
          try { cut.fence() } catch { return fail('delivery_target_changed') }
          try { images.fence() } catch { return fail('delivery_image_changed') }
          return update(latest, 'confirmed', { targetState, imageCapability })
        })
        return receipt(record)
      })
    },
    /**
     * Dispatch the exact confirmed payload once. The caller must resend the full confirmed content;
     * the server never persists or rehydrates body text for replay.
     */
    async dispatch(raw: DeliveryInput) {
      if (!validDeliveryInput(raw)) return fail('delivery_invalid', 400)
      const input = freeze(structuredClone(raw))
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        const confirmation = confirmedForDispatch(input)
        const prior = readDispatch(input.confirmationId)
        // A durable fence exists: report its honest state and never invoke the Host again.
        if (prior) {
          if (prior.epoch !== input.epoch || prior.requestId !== confirmation.requestId || prior.digest !== confirmation.digest
            || prior.operation !== confirmation.operation || !sameTarget(prior.target, confirmation.target)) return fail('delivery_dispatch_record_invalid', 503)
          return dispatchReceipt(await reconcile(prior), confirmation)
        }
        const cut = await targetCut(input.target)
        ports.requireEpoch(input.epoch)
        const images = await imageCut(input.epoch, input.images, cut.binding)
        ports.requireEpoch(input.epoch)
        let record: DeliveryDispatchRecord
        try {
          record = store.transaction(() => {
            ports.requireEpoch(input.epoch)
            const current = read(input.confirmationId)
            if (!current || current.epoch !== input.epoch) return fail('delivery_confirmation_not_found', 404)
            if (current.state !== 'confirmed' || current.requestId !== input.requestId || current.digest !== confirmation.digest) return fail('delivery_confirmation_changed')
            const replay = readDispatch(input.confirmationId)
            if (replay) return replay
            try { cut.fence() } catch { return fail('delivery_target_changed') }
            try { images.fence() } catch { return fail('delivery_image_changed') }
            const at = Date.now(), dispatchId = randomUUID()
            const value: DeliveryDispatchRecord = { version: 1, epoch: input.epoch, requestId: input.requestId, confirmationId: input.confirmationId,
              dispatchId, operation: input.operation, target: copyBinding(current.target), digest: current.digest,
              ...(input.operation === 'stop' ? {} : { messageId: `go:${dispatchId}` }),
              seq: 1, at, updatedAt: at, state: 'dispatching' }
            if (!dispatchRecordValid(value)) return fail('delivery_dispatch_record_invalid', 503)
            store.db.prepare('INSERT INTO side_effect(key,kind,ticket_id,at,state,detail) VALUES (?,?,NULL,?,?,?)').run(dispatchKey(input.confirmationId), DISPATCH_KIND, at, 'v1:1', encodeJson(value, false))
            return value
          })
        } catch (error) {
          if (error instanceof WorkspaceError) throw error
          return fail('delivery_target_changed')
        }
        if (record.state !== 'dispatching') return dispatchReceipt(await reconcile(record), confirmation)
        if (!ports.dispatch) return dispatchReceipt(updateDispatch(record, 'blocked', { code: 'delivery_adapter_unavailable' }), confirmation)
        // Cold wake: one durable wake fence before the one resume side effect, then the exact
        // confirmed delivery. A wake failure is terminal for this confirmation and never creates
        // a new Session. A leftover wake fence is never resumed again.
        let wakeEvidence: DeliveryWakeEvidence | undefined
        let wakeFailure: { state: DeliveryDispatchTerminalState; code: string } | undefined
        if (record.operation !== 'stop' && ports.liveness && ports.wake) {
          let targetState: DeliveryTargetState = 'unknown'
          try { const value = await ports.liveness(record.target.sessionId); targetState = targetStateValid(value) ? value : 'unknown' } catch { targetState = 'unknown' }
          if (targetState === 'cold') {
            let wake: DeliveryWakeRecord
            try {
              wake = store.transaction(() => {
                const existing = readWake(record.confirmationId)
                return existing ?? insertWake(record)
              })
            } catch (error) {
              if (error instanceof WorkspaceError) throw error
              return dispatchReceipt(updateDispatch(record, 'blocked', { code: 'delivery_wake_record_invalid' }), confirmation)
            }
            if (wake.state !== 'waking') {
              // A wake already exists for this confirmation: only its recorded outcome is reported.
              wakeFailure = wake.state === 'blocked'
                ? { state: 'blocked', code: wake.code ?? 'delivery_wake_failed' }
                : { state: 'dispatch_unknown', code: 'delivery_wake_unknown' }
            } else {
              let decision: unknown
              try { decision = await ports.wake(freeze(record), wake.wakeId) } catch { decision = undefined }
              const state = plain(decision) ? decision.state : undefined
              try {
                if (state === 'awake') {
                  const evidence = buildWakeEvidence(wake, decision as Record<string, any>)
                  if (!evidence) {
                    updateWake(wake, 'blocked', { code: 'delivery_wake_failed' })
                    wakeFailure = { state: 'blocked', code: 'delivery_wake_failed' }
                  } else wakeEvidence = updateWake(wake, 'awake', { evidence }).evidence
                } else if (state === 'live' && only(decision as Record<string, any>, ['state'])) {
                  // Another actor woke it between the liveness read and the fence: no resume happened.
                  updateWake(wake, 'already_live')
                } else if (state === 'blocked') {
                  const code = plain(decision) && codeValid(decision.code) ? decision.code : 'delivery_wake_failed'
                  updateWake(wake, 'blocked', { code })
                  wakeFailure = { state: 'blocked', code }
                } else {
                  // An ambiguous wake answer may already have resumed the session: reconcile only.
                  updateWake(wake, 'wake_unknown', { code: 'delivery_wake_unknown' })
                  wakeFailure = { state: 'dispatch_unknown', code: 'delivery_wake_unknown' }
                }
              } catch (error) {
                if (!(error instanceof WorkspaceError)) throw error
                wakeFailure = { state: 'dispatch_unknown', code: 'delivery_wake_unknown' }
              }
            }
          }
        }
        if (wakeFailure) {
          const updated = store.transaction(() => {
            const current = readDispatch(input.confirmationId)
            if (!current) return fail('delivery_dispatch_record_invalid', 503)
            if (current.state !== 'dispatching') return current
            return updateDispatch(current, wakeFailure!.state, { code: wakeFailure!.code })
          })
          return dispatchReceipt(updated, confirmation)
        }
        // Each external side effect has its own durable fence; the delivery call is still exactly one.
        let decision: DeliveryDispatchDecision | undefined
        try { decision = await ports.dispatch(freeze(record), input.text, images.references) } catch { /* possibly accepted: reconcile only */ }
        const stop = input.operation === 'stop'
        let state: DeliveryDispatchTerminalState
        let code: string | undefined
        let stopEvidence: DeliveryStopEvidenceKind | undefined
        if (stop) {
          // A stop is never `accepted` (no message) and never `interrupted` without Host evidence.
          if (decision?.state === 'interrupted' && stopEvidenceValid(decision.stopEvidence)) { state = 'interrupted'; stopEvidence = decision.stopEvidence }
          else if (decision?.state === 'blocked') { state = 'blocked'; code = codeValid(decision.code) ? decision.code : 'delivery_dispatch_blocked' }
          else { state = 'dispatch_unknown'; code = codeValid(decision?.code) ? decision!.code : 'delivery_dispatch_unknown' }
        } else {
          state = decision?.state === 'accepted' ? 'accepted' : decision?.state === 'blocked' ? 'blocked' : 'dispatch_unknown'
          // A Host adapter may attach a more exact fixed reason to an uncertain outcome; it is metadata only.
          code = state === 'blocked' ? (codeValid(decision?.code) ? decision!.code : 'delivery_dispatch_blocked')
            : state === 'dispatch_unknown' ? (codeValid(decision?.code) ? decision!.code : 'delivery_dispatch_unknown') : undefined
        }
        const updated = store.transaction(() => {
          const current = readDispatch(input.confirmationId)
          if (!current) return fail('delivery_dispatch_record_invalid', 503)
          if (current.state !== 'dispatching') return current
          return updateDispatch(current, state, { ...(code === undefined ? {} : { code }), ...(stopEvidence === undefined ? {} : { stopEvidence }), ...(wakeEvidence === undefined ? {} : { wake: wakeEvidence }) })
        })
        return dispatchReceipt(updated, confirmation)
      })
    },
    /** Startup-only reconciliation: reads exact target evidence; never resends and never wakes a cold target. */
    async reconcile() {
      return serialize(async () => {
        // Crash-left wake fences become honest unknown outcomes first and are never resumed again.
        const wakeRows = store.db.prepare('SELECT key FROM side_effect WHERE kind=?').all(WAKE_KIND) as { key: string }[]
        for (const row of wakeRows) {
          const confirmationId = typeof row.key === 'string' && row.key.startsWith('delivery-wake:v1:') ? row.key.slice('delivery-wake:v1:'.length) : ''
          if (!uuid(confirmationId)) continue
          try { reconcileWake(confirmationId) } catch { /* keep the durable wake fence */ }
        }
        const rows = store.db.prepare('SELECT key FROM side_effect WHERE kind=?').all(DISPATCH_KIND) as { key: string }[]
        let accepted = 0, interrupted = 0, unknown = 0, blocked = 0
        for (const row of rows) {
          const confirmationId = typeof row.key === 'string' && row.key.startsWith('delivery-dispatch:v1:') ? row.key.slice('delivery-dispatch:v1:'.length) : ''
          if (!uuid(confirmationId)) continue
          let record = readDispatch(confirmationId)
          if (!record || !['dispatching', 'dispatch_unknown'].includes(record.state)) { if (record?.state === 'accepted') accepted++; else if (record?.state === 'interrupted') interrupted++; else if (record?.state === 'blocked') blocked++; continue }
          try { record = await reconcile(record) } catch { /* keep the durable unknown fence */ }
          if (record.state === 'accepted') accepted++; else if (record.state === 'interrupted') interrupted++; else if (record.state === 'dispatch_unknown') unknown++; else if (record.state === 'blocked') blocked++
        }
        return { accepted, interrupted, unknown, blocked }
      })
    },
    async cancel(raw: { epoch: string; confirmationId: string }) {
      if (!plain(raw) || !only(raw, ['epoch', 'confirmationId']) || !id(raw.epoch) || !uuid(raw.confirmationId)) return fail('delivery_invalid', 400)
      const input = { epoch: raw.epoch, confirmationId: raw.confirmationId }
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        const current = read(input.confirmationId)
        if (!current || current.epoch !== input.epoch) return fail('delivery_confirmation_not_found', 404)
        if (current.state === 'canceled') return receipt(current)
        if (current.state === 'confirmed') return fail('delivery_confirmation_confirmed')
        const record = store.transaction(() => {
          const latest = read(input.confirmationId)
          if (!latest) return fail('delivery_confirmation_not_found', 404)
          if (latest.state === 'canceled') return latest
          if (latest.state === 'confirmed') return fail('delivery_confirmation_confirmed')
          return update(latest, 'canceled')
        })
        return receipt(record)
      })
    },
    async status(raw: { epoch: string; confirmationId: string }) {
      if (!plain(raw) || !only(raw, ['epoch', 'confirmationId']) || !id(raw.epoch) || !uuid(raw.confirmationId)) return fail('delivery_invalid', 400)
      const input = { epoch: raw.epoch, confirmationId: raw.confirmationId }
      return serialize(async () => {
        ports.requireEpoch(input.epoch)
        const record = read(input.confirmationId)
        if (!record || record.epoch !== input.epoch) return fail('delivery_confirmation_not_found', 404)
        return receipt(record)
      })
    },
  }
}
