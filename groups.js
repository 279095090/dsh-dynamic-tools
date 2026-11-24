export const ACTIVATE_TOOL = 'tool_activate'

/** Tools that remain available without an activation step. Unknown tools also stay available. */
export const CORE_TOOLS = Object.freeze([
  'read',
  'read_image',
  'write',
  'edit',
  'glob',
  'grep',
  'pwsh',
  'working_directory',
  'ask_user_question',
  'todo_write',
  'skill',
])

/**
 * Reviewed DSH 0.2.2-rc.5 capability groups. Tools not listed here are never
 * hidden. Late registrations are reconciled, while native Office render tools
 * deliberately stay under their original skill-load condition.
 */
export const GROUPS = Object.freeze([
  {
    id: 'context',
    summary: 'context/cache inspection and manual compression',
    tools: ['acp_cache', 'acp_read_original_image', 'acp_status', 'compress', 'decompress', 'search_context'],
  },
  {
    id: 'delivery',
    summary: 'final file delivery',
    tools: ['present'],
  },
  {
    id: 'delegation',
    summary: 'subagents, agent messaging, and workflows',
    tools: ['list_agents', 'list_subagent_models', 'send_message', 'subagent', 'subagent_fork', 'wait_agent', 'workflow'],
  },
  {
    id: 'goals',
    summary: 'persistent session goals',
    tools: ['create_goal', 'get_goal', 'update_goal'],
  },
  {
    id: 'jobs',
    summary: 'background job inspection and control',
    tools: ['job_list', 'job_output', 'job_kill'],
  },
  {
    id: 'memory',
    summary: 'Mnemon documents, durable memory, and runtime memory',
    tools: [
      'mnemon_document_create', 'mnemon_document_manage', 'mnemon_document_search',
      'mnemon_forget', 'mnemon_link', 'mnemon_memory_bodies', 'mnemon_memory_body_create',
      'mnemon_memory_body_merge', 'mnemon_memory_body_update', 'mnemon_recall',
      'mnemon_related', 'mnemon_remember', 'mnemon_runtime_memory', 'mnemon_status',
      'mnemon_subagent_result', 'mnemon_view_action', 'mnemon_view_route',
    ],
  },
  {
    id: 'office',
    summary: 'Office workspace dependencies (native Office tools retain their skill gate)',
    tools: ['load_workspace_dependencies'],
  },
  {
    id: 'plugins',
    summary: 'DSH plugin and bundle management',
    tools: ['plugin_manager'],
  },
  {
    id: 'schedule',
    summary: 'scheduled task management',
    tools: ['schedule_create', 'schedule_edit', 'schedule_list', 'schedule_view'],
  },
  {
    id: 'web',
    summary: 'web search and page fetching',
    tools: ['web_search', 'web_fetch'],
  },
].map((group) => Object.freeze({ ...group, tools: Object.freeze([...group.tools]) })))

export const GROUP_IDS = Object.freeze(GROUPS.map((group) => group.id))

export const TOOL_GROUPS = new Map(
  GROUPS.flatMap((group) => group.tools.map((name) => [name, group.id])),
)

export function orderedGroups(names) {
  const selected = new Set(names)
  return GROUP_IDS.filter((id) => selected.has(id))
}
