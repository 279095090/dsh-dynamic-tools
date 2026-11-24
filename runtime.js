import { createActivationTool } from './activation-tool.js'
import { GROUPS } from './groups.js'

/**
 * Install agent-local shadows of the exact original ToolDefinition objects.
 * This adds step-time `when` gates without changing schemas, execute bodies,
 * result rendering, or any source package. Unknown tools stay untouched.
 */
export function createAgentInstaller(ctx, projection) {
  const records = new Map()
  let changing = false

  const active = (agent, group) => projection.stateOf(agent.session).activeGroups.includes(group)

  const whenTool = (agent, name, group) => async (activation) => {
    activation.signal.throwIfAborted()
    if (!active(agent, group)) return false
    // Preserve the original conditional registrations shadowed by this gate.
    if (name === 'web_search') return ctx.web.searchReady(activation.modelSelection.provider)
    if (name === 'web_fetch') return ctx.web.fetchReady(activation.modelSelection.provider)
    return true
  }

  function clearShadows(record) {
    for (const dispose of record.shadowDisposers.splice(0).reverse()) dispose()
    record.handled.clear()
    record.shadows.clear()
    record.unmanaged.clear()
  }

  function reconcile(record, rebuild = false) {
    if (record.disposed) return
    changing = true
    try {
      // External registrations may replace or remove a source tool (Mnemon does
      // this as Sources change). Drop our shadows first so definitions() reveals
      // the current inherited catalog rather than our stale shadow copies.
      if (rebuild) clearShadows(record)
      const definitions = new Map(ctx.tools.definitions(record.agent).map((definition) => [definition.name, definition]))
      for (const group of GROUPS) {
        for (const name of group.tools) {
          if (record.handled.has(name)) continue
          const definition = definitions.get(name)
          if (definition === undefined) continue
          try {
            // Registering on agent.ctx deliberately shadows the inherited/preset
            // registration while retaining its exact definition object.
            const dispose = record.agent.ctx.tools.register(definition, {
              when: whenTool(record.agent, name, group.id),
            })
            record.handled.add(name)
            record.shadows.set(name, definition)
            record.shadowDisposers.push(dispose)
          } catch (error) {
            // A tool already owned by this exact Agent scope cannot be shadowed.
            // Fail open for capability availability and make the limitation visible.
            record.handled.add(name)
            record.unmanaged.add(name)
            ctx.logger.warn(`dynamic-tools: cannot defer "${name}"; leaving it available: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
    } finally {
      changing = false
    }
  }

  function install(agent) {
    if (records.has(agent)) return
    const record = {
      agent,
      handled: new Set(),
      shadows: new Map(),
      unmanaged: new Set(),
      disposers: [],
      shadowDisposers: [],
      disposed: false,
      cleanup: undefined,
    }
    records.set(agent, record)
    record.cleanup = agent.ctx.effect(() => {
      record.disposers.push(agent.ctx.tools.register(createActivationTool((session) => projection.stateOf(session))))
      record.disposers.push(agent.ctx.systemPrompt.section({
        name: 'dynamic-tools:policy',
        order: 450,
        text: 'Some tools are deferred by capability group. When a task needs one, call tool_activate with the smallest necessary group(s), then use the newly visible tools on the next model step. Core tools need no activation. Activated groups remain stable for this session.',
      }))
      reconcile(record)
      return () => {
        record.disposed = true
        clearShadows(record)
        for (const dispose of record.disposers.splice(0).reverse()) dispose()
        records.delete(agent)
      }
    }, 'dynamic-tools.agent')
  }

  function reconcileAll() {
    if (changing) return
    for (const record of [...records.values()]) reconcile(record, true)
  }

  async function remove(agent) {
    const record = records.get(agent)
    if (record === undefined) return
    records.delete(agent)
    await record.cleanup?.()
  }

  async function dispose() {
    for (const agent of [...records.keys()]) await remove(agent)
  }

  return { install, reconcileAll, remove, dispose, records }
}
