import { ACTIVATE_TOOL, GROUP_IDS, orderedGroups } from './groups.js'

export const PROJECTION_KEY = 'dynamicToolGroups'

export function emptyActivationState() {
  return { activeGroups: [], pendingActivations: {} }
}

function validStringArray(value, allowed) {
  return Array.isArray(value)
    && new Set(value).size === value.length
    && value.every((entry) => typeof entry === 'string' && allowed.has(entry))
}

/** Minimal synchronous parse contract accepted by the projection registry. */
export const activationStateSchema = {
  parse(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('dynamic tool activation state must be an object')
    }
    const keys = Object.keys(value).sort()
    if (keys.join(',') !== 'activeGroups,pendingActivations') {
      throw new TypeError('dynamic tool activation state has unknown or missing fields')
    }
    const allowed = new Set(GROUP_IDS)
    if (!validStringArray(value.activeGroups, allowed)
      || value.activeGroups.join(',') !== orderedGroups(value.activeGroups).join(',')) {
      throw new TypeError('activeGroups must be unique, known, and canonically ordered')
    }
    if (typeof value.pendingActivations !== 'object'
      || value.pendingActivations === null || Array.isArray(value.pendingActivations)) {
      throw new TypeError('pendingActivations must be an object')
    }
    for (const groups of Object.values(value.pendingActivations)) {
      if (!validStringArray(groups, allowed)) throw new TypeError('pending activation groups are invalid')
    }
    return value
  },
}

function requestedGroups(event) {
  if (event.type !== 'tool/call' || event.data.name !== ACTIVATE_TOOL) return undefined
  try {
    const args = JSON.parse(event.data.arguments)
    if (!Array.isArray(args.groups)) return []
    return orderedGroups(args.groups.filter((name) => GROUP_IDS.includes(name)))
  } catch {
    return []
  }
}

/**
 * Pure fold over existing tool call/result events. A successful activation is
 * durable without introducing a new Session event type; failures never enable
 * a group. Replaying the same log restores the same monotonic group set.
 */
export function applyActivationEvent(state, event) {
  if (event.type === 'tool/call') {
    const groups = requestedGroups(event)
    if (groups === undefined) return state
    return {
      ...state,
      pendingActivations: { ...state.pendingActivations, [event.data.callId]: groups },
    }
  }
  if (event.type !== 'tool/result') return state
  const callId = event.data.message?.toolCallId ?? event.data.message?.source?.callId
  if (typeof callId !== 'string' || !Object.hasOwn(state.pendingActivations, callId)) return state
  const pending = { ...state.pendingActivations }
  const groups = pending[callId]
  delete pending[callId]
  if (event.data.message?.isError === true) return { ...state, pendingActivations: pending }
  return {
    activeGroups: orderedGroups([...state.activeGroups, ...groups]),
    pendingActivations: pending,
  }
}

export function createActivationProjectionDefinition() {
  return {
    key: PROJECTION_KEY,
    stateSchema: activationStateSchema,
    init: () => emptyActivationState(),
    apply: applyActivationEvent,
    stateVersion: 1,
  }
}
