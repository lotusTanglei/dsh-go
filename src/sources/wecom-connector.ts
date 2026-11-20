import { randomUUID } from 'node:crypto'

/** Actual installed ToolsService batch contract; guards and MCP ownership stay in DSH. */
export interface WecomToolsPort {
  execute(input: { calls: readonly { type: 'tool-call'; id: string; name: string; arguments: string }[]; signal: AbortSignal }): Promise<{ results: readonly { result: { isError?: boolean; value?: unknown } }[] }>
}
export function createWecomConnector(tools: WecomToolsPort | undefined, signal: AbortSignal) {
  async function call(tool: 'list_sheets' | 'read_task_snapshot', args: Record<string, unknown>): Promise<unknown> {
    if (!tools || signal.aborted) throw new Error('wecom_connector_unavailable')
    const batch = await tools.execute({ calls: [{ type: 'tool-call', id: `wecom-source-${randomUUID()}`, name: `mcp__wecom__${tool}`, arguments: JSON.stringify(args) }], signal })
    const result = batch.results.length === 1 ? batch.results[0]?.result : undefined
    if (!result || result.isError) throw new Error('wecom_connector_read_failed')
    const value = result.value as { structuredContent?: unknown } | undefined
    // No scraping titles/CSV into a made-up typed snapshot. Old connectors fail closed.
    if (!value?.structuredContent || typeof value.structuredContent !== 'object') throw new Error('wecom_connector_contract_required')
    return value.structuredContent
  }
  return {
    async read(config: { doc: string; sheet: string; range: string }) {
      await call('list_sheets', { doc: config.doc })
      return call('read_task_snapshot', { doc: config.doc, sheet: config.sheet, range: config.range, max_images: 5 })
    },
  }
}
