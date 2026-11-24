import { workerToolDescriptors } from '../tools/worker.js'
import { goBashDescriptor } from '../tools/go-bash.js'
import { registerRoleTools, type RoleToolsContext } from './role-plugin.js'

export const inject = ['tools']
export function apply(ctx: RoleToolsContext): () => void {
  // `go_bash` is registered inside the Worker preset scope, so the Host `bash`
  // tool is neither the documented nor the reachable execution path.
  return registerRoleTools(ctx, [...workerToolDescriptors, goBashDescriptor])
}
