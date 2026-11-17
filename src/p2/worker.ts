import { workerToolDescriptors } from '../tools/worker.js'
import { registerRoleTools, type RoleToolsContext } from './role-plugin.js'

export const inject = ['tools']
export function apply(ctx: RoleToolsContext): () => void {
  return registerRoleTools(ctx, workerToolDescriptors)
}
