import { ACTIVATE_TOOL, GROUP_IDS, GROUPS, orderedGroups } from './groups.js'

function catalogDescription() {
  return GROUPS.map((group) => `${group.id}: ${group.summary}`).join('; ')
}

/** Build the only new model-facing tool. No original definition is rewritten. */
export function createActivationTool(readState) {
  return {
    name: ACTIVATE_TOOL,
    description: 'Enable deferred tool groups for this Agent when the task needs them. Prefer the smallest necessary set; activated schemas appear on the next model step and remain active for the session, including resume. '
      + `Groups — ${catalogDescription()}.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['groups'],
      properties: {
        groups: {
          type: 'array',
          description: 'One or more capability groups to activate. Duplicates and already-active groups are harmless.',
          items: { type: 'string', enum: [...GROUP_IDS] },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['activeGroups', 'newlyActivated'],
        properties: {
          activeGroups: { type: 'array', items: { type: 'string', enum: [...GROUP_IDS] } },
          newlyActivated: { type: 'array', items: { type: 'string', enum: [...GROUP_IDS] } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Active tool groups: ${value.activeGroups.join(', ') || '(none)'}. Newly activated: ${value.newlyActivated.join(', ') || '(none)'}. Newly activated tools are available from the next model step.`,
      }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('tool_activate requires an owning Agent session')
      exec.signal.throwIfAborted()
      if (!Array.isArray(args.groups) || args.groups.length === 0
        || args.groups.some((name) => typeof name !== 'string' || !GROUP_IDS.includes(name))) {
        throw new Error(`groups must be a non-empty array containing only: ${GROUP_IDS.join(', ')}`)
      }
      const current = readState(exec.agent.session).activeGroups
      const activeGroups = orderedGroups([...current, ...args.groups])
      const currentSet = new Set(current)
      return {
        activeGroups,
        newlyActivated: activeGroups.filter((name) => !currentSet.has(name)),
      }
    },
  }
}
