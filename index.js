import { createAgentInstaller } from './runtime.js'
import { createActivationProjectionDefinition } from './state.js'

export const name = 'dynamic-tools'
export const PRESET_ID = 'standard-dynamic-tools'
export const inject = ['tools', 'sessionProjections', 'systemPrompt', 'web', 'agents', 'agentPresets']

/** Independent preset-scoped dynamic tool catalog; original tools stay mounted. */
export async function apply(ctx) {
  const projection = await ctx.sessionProjections.register(createActivationProjectionDefinition())
  const installer = createAgentInstaller(ctx, projection)
  const usesDynamicPreset = (agent) => ctx.agentPresets.composedPreset(agent.ctx) === PRESET_ID
  const reportSyncError = (agent, error) => {
    ctx.logger.warn(`dynamic-tools: Agent ${agent.id} preset synchronization failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const sync = async (agent) => {
    if (usesDynamicPreset(agent)) installer.install(agent)
    else await installer.remove(agent)
  }

  // Direct creation binds the preset during setup, before agent/created.
  ctx.on('agent/created', ({ agent }) => {
    if (usesDynamicPreset(agent)) installer.install(agent)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    void installer.remove(agent).catch((error) => reportSyncError(agent, error))
  })
  // Switching an existing blank Agent recomposes it without another created event.
  ctx.on('agent-preset/selected', (sessionId) => {
    const agent = ctx.agents.get(sessionId)
    if (agent === undefined) return
    return sync(agent).catch((error) => reportSyncError(agent, error))
  })
  // Skills and late providers can introduce mapped tools after agent creation.
  ctx.on('tools/change', installer.reconcileAll)
  // A blank Agent may already exist when this preset/plugin is first activated.
  ctx.effect(() => () => installer.dispose(), 'dynamic-tools.agents')
  await Promise.all(ctx.agents.list().map(sync))
}
