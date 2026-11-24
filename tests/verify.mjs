import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, inject } from '../index.js'
import { ACTIVATE_TOOL, CORE_TOOLS, GROUP_IDS, GROUPS, TOOL_GROUPS } from '../groups.js'
import { createAgentInstaller } from '../runtime.js'
import {
  activationStateSchema,
  applyActivationEvent,
  createActivationProjectionDefinition,
  emptyActivationState,
} from '../state.js'

const packageDir = fileURLToPath(new URL('../', import.meta.url))
const outputDir = path.join(packageDir, 'tests')
const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'))
const checks = []
const passed = (name) => checks.push({ name, status: 'passed' })

// Packaging, pinned upgrade boundary, and metadata.
assert.equal(packageJson.type, 'module')
assert.equal(packageJson.engines.dsh, '0.2.2-rc.5')
for (const relative of packageJson.files) {
  if (relative === 'locale') continue
  assert.ok(fs.readFileSync(path.join(packageDir, relative), 'utf8').length > 0, relative)
}
for (const locale of ['en', 'zh']) {
  const data = JSON.parse(fs.readFileSync(path.join(packageDir, `locale/${locale}.json`), 'utf8'))
  assert.ok(data.meta.title && data.meta.description)
}
const icon = fs.readFileSync(path.join(packageDir, 'icon.svg'), 'utf8')
assert.match(icon, /width="36" height="36" viewBox="0 0 36 36"/)
assert.doesNotMatch(icon, /<(script|style|image|foreignObject)\b/)
passed('package metadata, version pin, locales, and SVG')

// Every copied Standard row is unchanged except comments and the added local row.
assert.ok(process.env.DSH_INSTALL_DIR)
const standardPath = path.join(path.dirname(process.env.DSH_INSTALL_DIR), 'dsh-web-app/presets/standard.patch.yml')
const standard = fs.readFileSync(standardPath, 'utf8')
const dynamicPatch = fs.readFileSync(path.join(packageDir, 'cordis.patch.yml'), 'utf8')
const startMarker = '          - id: persona'
const dynamicEndMarker = '          - id: dynamic-tools'
const standardBody = standard.slice(standard.indexOf(startMarker)).trimEnd()
const dynamicBody = dynamicPatch.slice(dynamicPatch.indexOf(startMarker), dynamicPatch.indexOf(dynamicEndMarker)).trimEnd()
const withoutComments = (text) => text.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).map((line) => line.trimEnd()).join('\n').trimEnd()
assert.equal(withoutComments(dynamicBody), withoutComments(standardBody))
assert.match(dynamicPatch, /id: standard-dynamic-tools/)
assert.match(dynamicPatch, /name: '@local\/dsh-dynamic-tools'/)
passed('all original Standard plugin/tool rows preserved')

// Tool mappings are unique and disjoint; unmapped future tools remain available.
const grouped = GROUPS.flatMap((group) => group.tools)
assert.equal(new Set(grouped).size, grouped.length, 'duplicate deferred mapping')
assert.equal(new Set(CORE_TOOLS).size, CORE_TOOLS.length, 'duplicate core mapping')
for (const name of CORE_TOOLS) assert.equal(TOOL_GROUPS.has(name), false, `${name} is both core and deferred`)
passed('tool group mappings are unique and core/deferred sets are disjoint')

// Pure durable fold: success activates, failure does not, replay is deterministic.
const definition = createActivationProjectionDefinition()
assert.equal(definition.key, 'dynamicToolGroups')
assert.equal(definition.stateVersion, 1)
const call = (callId, groups) => ({ type: 'tool/call', data: { callId, name: ACTIVATE_TOOL, arguments: JSON.stringify({ groups }) } })
const result = (callId, isError = false) => ({
  type: 'tool/result',
  data: { message: { toolCallId: callId, source: { kind: 'tool', callId }, ...isError ? { isError: true } : {} } },
})
let replayed = emptyActivationState()
replayed = applyActivationEvent(replayed, call('call-web', ['web', 'web']))
assert.deepEqual(replayed.activeGroups, [])
replayed = applyActivationEvent(replayed, result('call-web'))
assert.deepEqual(replayed.activeGroups, ['web'])
replayed = applyActivationEvent(replayed, call('call-jobs', ['jobs']))
replayed = applyActivationEvent(replayed, result('call-jobs', true))
assert.deepEqual(replayed.activeGroups, ['web'])
assert.deepEqual(replayed.pendingActivations, {})
replayed = applyActivationEvent(replayed, call('call-memory', ['memory', 'web']))
replayed = applyActivationEvent(replayed, result('call-memory'))
assert.deepEqual(replayed.activeGroups, ['memory', 'web'])
assert.equal(activationStateSchema.parse(replayed), replayed)
let replayCopy = emptyActivationState()
for (const event of [call('call-web', ['web', 'web']), result('call-web'), call('call-jobs', ['jobs']), result('call-jobs', true), call('call-memory', ['memory', 'web']), result('call-memory')]) {
  replayCopy = applyActivationEvent(replayCopy, event)
}
assert.deepEqual(replayCopy, replayed)
assert.throws(() => activationStateSchema.parse({ activeGroups: ['unknown'], pendingActivations: {} }))
const untouched = emptyActivationState()
assert.equal(applyActivationEvent(untouched, { type: 'turn/start', data: {} }), untouched)
passed('durable activation fold, failed calls, idempotence, replay, and schema validation')

function tool(name) {
  return { name, description: `original ${name}`, parameters: { type: 'object' }, marker: `original:${name}` }
}
class FakeTools {
  constructor(definitions) {
    this.globals = new Map(definitions.map((definition) => [definition.name, { definition }]))
  }
  definitions(agent) {
    const visible = new Map([...this.globals].map(([name, registration]) => [name, registration.definition]))
    for (const [name, registration] of agent.local) visible.set(name, registration.definition)
    return [...visible.values()]
  }
  register(agent, definition, options = {}) {
    if (agent.local.has(definition.name)) throw new Error(`tool "${definition.name}" is already registered in this scope`)
    const registration = { definition, when: options.when }
    agent.local.set(definition.name, registration)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (agent.local.get(definition.name) === registration) agent.local.delete(definition.name)
    }
  }
}
function makeAgent(tools, id) {
  const agent = {
    id,
    local: new Map(),
    session: { state: emptyActivationState() },
    cleanups: [],
    sections: new Map(),
  }
  agent.ctx = {
    tools: { register: (definition, options) => tools.register(agent, definition, options) },
    systemPrompt: {
      section: (section) => {
        agent.sections.set(section.name, section)
        return () => agent.sections.delete(section.name)
      },
    },
    effect: (setup) => {
      const cleanup = setup()
      let active = true
      const dispose = async () => {
        if (!active) return
        active = false
        await cleanup?.()
      }
      agent.cleanups.push(dispose)
      return dispose
    },
  }
  return agent
}
async function visibleNames(tools, agent, modelSelection = { provider: 'test' }) {
  const names = []
  for (const definition of tools.definitions(agent)) {
    const registration = agent.local.get(definition.name) ?? tools.globals.get(definition.name)
    const enabled = registration.when === undefined
      || await registration.when({ agent, modelSelection, signal: new AbortController().signal })
    if (enabled) names.push(definition.name)
  }
  return names.sort()
}

const initialNames = [
  ...CORE_TOOLS,
  ...GROUPS.flatMap((group) => group.tools).filter((name) => name !== 'mnemon_related'),
  'custom_future',
]
const tools = new FakeTools([...new Set(initialNames)].map(tool))
const warnings = []
const webReadiness = { search: true, fetch: true }
const ctx = {
  tools,
  web: {
    searchReady: async () => webReadiness.search,
    fetchReady: async () => webReadiness.fetch,
  },
  logger: { warn: (message) => warnings.push(message) },
}
const projection = { stateOf: (session) => session.state }
const installer = createAgentInstaller(ctx, projection)
const agentA = makeAgent(tools, 'A')
const agentB = makeAgent(tools, 'B')
installer.install(agentA)
installer.install(agentB)

const initialVisible = await visibleNames(tools, agentA)
assert.deepEqual(initialVisible, [...CORE_TOOLS, ACTIVATE_TOOL, 'custom_future'].sort())
assert.equal(initialVisible.length, 13) // 11 core + activation + unknown fail-open tool
assert.equal(initialVisible.includes('web_search'), false)
assert.equal(initialVisible.includes('mnemon_recall'), false)
assert.equal(initialVisible.includes('schedule_create'), false)
assert.ok(agentA.sections.has('dynamic-tools:policy'))
passed('default catalog exposes only core + activation; deferred tools and execution gates close')

const activationDefinition = agentA.local.get(ACTIVATE_TOOL).definition
assert.equal(activationDefinition.parameters.type, 'object')
await assert.rejects(() => activationDefinition.execute({ groups: [] }, { agent: agentA, signal: new AbortController().signal }))
await assert.rejects(() => activationDefinition.execute({ groups: ['not-a-group'] }, { agent: agentA, signal: new AbortController().signal }))
const activationValue = await activationDefinition.execute({ groups: ['web'] }, { agent: agentA, signal: new AbortController().signal })
assert.deepEqual(activationValue, { activeGroups: ['web'], newlyActivated: ['web'] })
agentA.session.state = applyActivationEvent(agentA.session.state, call('live-web', ['web']))
agentA.session.state = applyActivationEvent(agentA.session.state, result('live-web'))
assert.ok((await visibleNames(tools, agentA)).includes('web_search'))
assert.ok((await visibleNames(tools, agentA)).includes('web_fetch'))
assert.equal((await visibleNames(tools, agentB)).includes('web_search'), false)
assert.equal(agentA.local.get('web_search').definition, tools.globals.get('web_search').definition)
assert.equal(agentA.local.get('web_search').definition.marker, 'original:web_search')
webReadiness.search = false
const withSearchUnavailable = await visibleNames(tools, agentA)
assert.equal(withSearchUnavailable.includes('web_search'), false)
assert.equal(withSearchUnavailable.includes('web_fetch'), true)
webReadiness.search = true
const repeated = await activationDefinition.execute({ groups: ['web'] }, { agent: agentA, signal: new AbortController().signal })
assert.deepEqual(repeated.newlyActivated, [])
passed('activation result, original definition identity, Agent isolation, and web readiness preservation')

// Late source registrations are captured; removals and replacements rebuild
// shadows from the inherited catalog instead of retaining stale definitions.
assert.equal(TOOL_GROUPS.has('office_render'), false)
assert.equal(TOOL_GROUPS.has('office_convert'), false)
assert.equal(TOOL_GROUPS.has('office_recalculate'), false)
tools.globals.set('mnemon_related', { definition: tool('mnemon_related') })
installer.reconcileAll()
assert.ok(agentA.local.has('mnemon_related'))
assert.equal((await visibleNames(tools, agentA)).includes('mnemon_related'), false)
agentA.session.state = applyActivationEvent(agentA.session.state, call('live-memory', ['memory']))
agentA.session.state = applyActivationEvent(agentA.session.state, result('live-memory'))
assert.ok((await visibleNames(tools, agentA)).includes('mnemon_related'))
tools.globals.delete('mnemon_related')
installer.reconcileAll()
assert.equal(agentA.local.has('mnemon_related'), false)
assert.equal((await visibleNames(tools, agentA)).includes('mnemon_related'), false)
tools.globals.set('mnemon_related', { definition: { ...tool('mnemon_related'), marker: 'replacement:mnemon_related' } })
installer.reconcileAll()
assert.equal(agentA.local.get('mnemon_related').definition.marker, 'replacement:mnemon_related')
assert.ok((await visibleNames(tools, agentA)).includes('custom_future'))
passed('late registration, removal, replacement, and native Office skill gates are preserved')

// If an original tool is already owned by the exact Agent scope, retain it rather than break creation.
const agentC = makeAgent(tools, 'C')
tools.register(agentC, tool('plugin_manager'))
installer.install(agentC)
assert.ok(warnings.some((message) => message.includes('plugin_manager')))
assert.ok((await visibleNames(tools, agentC)).includes('plugin_manager'))
assert.ok((await visibleNames(tools, agentC)).includes(ACTIVATE_TOOL))
passed('same-scope collision fails open with a diagnostic')

await installer.remove(agentA)
assert.equal(agentA.local.size, 0)
assert.equal(installer.records.has(agentA), false)
assert.equal(agentB.local.get('web_search') !== undefined, true)
await installer.dispose()
assert.equal(installer.records.size, 0)
passed('per-agent and plugin disposal restore inherited tools without affecting peers')

// Root composition handles both direct creation and post-creation blank switching.
const listeners = new Map()
let rootInstallerDisposed = false
const liveAgents = new Map()
let composedPreset = 'standard-dynamic-tools'
const existing = makeAgent(tools, 'existing-blank')
liveAgents.set(existing.id, existing)
const rootCtx = {
  sessionProjections: {
    register: async (unit) => {
      assert.equal(unit.key, 'dynamicToolGroups')
      return { stateOf: (session) => session.state }
    },
  },
  tools,
  agents: {
    list: () => [...liveAgents.values()],
    get: (id) => liveAgents.get(id),
  },
  agentPresets: { composedPreset: () => composedPreset },
  web: ctx.web,
  logger: ctx.logger,
  on: (name, listener) => listeners.set(name, listener),
  effect: () => { rootInstallerDisposed = true },
}
await apply(rootCtx)
assert.deepEqual([...listeners.keys()].sort(), ['agent-preset/selected', 'agent/created', 'agent/disposed', 'tools/change'])
assert.deepEqual(inject, ['tools', 'sessionProjections', 'systemPrompt', 'web', 'agents', 'agentPresets'])
assert.equal(rootInstallerDisposed, true)
assert.ok((await visibleNames(tools, existing)).includes(ACTIVATE_TOOL))
assert.equal((await visibleNames(tools, existing)).includes('web_search'), false)
passed('plugin activation synchronizes an already-existing matching blank Agent')

composedPreset = 'standard'
await listeners.get('agent-preset/selected')(existing.id)
assert.equal(existing.local.size, 0)
composedPreset = 'standard-dynamic-tools'
await listeners.get('agent-preset/selected')(existing.id)
assert.ok((await visibleNames(tools, existing)).includes(ACTIVATE_TOOL))
assert.equal((await visibleNames(tools, existing)).includes('web_search'), false)
passed('blank-session selection installs gates and switching away removes them')

const direct = makeAgent(tools, 'direct-dynamic')
liveAgents.set(direct.id, direct)
listeners.get('agent/created')({ agent: direct })
assert.ok((await visibleNames(tools, direct)).includes(ACTIVATE_TOOL))
assert.equal((await visibleNames(tools, direct)).includes('web_search'), false)
passed('direct creation with the Dynamic preset installs gates before the first step')

const report = {
  status: 'passed',
  dshVersion: packageJson.engines.dsh,
  coreOriginalToolCount: CORE_TOOLS.length,
  activationToolCount: 1,
  expectedDefaultCurrentTools: CORE_TOOLS.length + 1,
  groups: GROUPS.map((group) => ({ id: group.id, mappedTools: group.tools.length, tools: group.tools })),
  checks,
}
fs.writeFileSync(path.join(outputDir, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
