/** Opaque provenance is Host-resolved; document text is never a human command. */
export interface DocumentOrigin {
  readonly kind: 'wecom-document' | 'local-document'
  readonly itemKey: string
  readonly revision: string
  readonly evidenceDigest: string
  readonly configVersion: string
}
export function validDocumentOrigin(value: unknown): value is DocumentOrigin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (![Object.prototype, null].includes(Object.getPrototypeOf(row)) || Object.getOwnPropertySymbols(row).length || Object.getOwnPropertyNames(row).length !== 5) return false
  const fields = ['kind', 'itemKey', 'revision', 'evidenceDigest', 'configVersion']
  if (!fields.every(key => { const property = Object.getOwnPropertyDescriptor(row, key); return property && 'value' in property && property.enumerable })) return false
  return typeof row.kind === 'string' && ['wecom-document', 'local-document'].includes(row.kind) && fields.slice(1).every(key => typeof row[key] === 'string' && /^[a-f0-9]{64}$/.test(row[key] as string))
}
/** Synchronous fresh authority checks bracket every admission transaction/settlement. */
export interface DocumentOriginAuthority {
  validate(origin: DocumentOrigin, requestId: string): void
  /** Participates in the caller's journal transaction; must not open another transaction. */
  reserve(origin: DocumentOrigin, requestId: string): void
  link(origin: DocumentOrigin, requestId: string, ticketId: string): void
  context(origin: DocumentOrigin, requestId: string): unknown
}
