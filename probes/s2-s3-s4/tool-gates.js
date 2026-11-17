// Static S3 sketch using documented tool registration/conditional admission.
// No live Agent or model is required to inspect this file.
export const roleToolNames = {
  router: ['ticket_create', 'ticket_status'],
  worker: ['report_progress', 'report_result'],
}

export function registerRoleTool(ctx, isRole, definition) {
  return ctx.tools.register(definition, {
    when: ({ agent, signal }) => {
      if (signal.aborted) return false
      // `isRole` is product-owned; no role field/API is invented here.
      return Boolean(agent) && isRole(agent)
    },
  })
}
