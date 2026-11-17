import type { RoleToolsContext } from './role-plugin.js'

export const inject = ['tools']
export function apply(_ctx: RoleToolsContext): () => void {
  // Watchdog tool execution is deliberately empty in P2; P4 supplies actions.
  return () => undefined
}
