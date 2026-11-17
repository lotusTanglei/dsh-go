import { routerToolDescriptors } from '../tools/router.js'
import { registerRoleTools, type RoleToolsContext } from './role-plugin.js'

export const inject = ['tools']
export function apply(ctx: RoleToolsContext): () => void {
  return registerRoleTools(ctx, routerToolDescriptors)
}
