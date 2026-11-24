# Standard Dynamic Tools

Adds an independent experimental `standard-dynamic-tools` preset for DSH `0.2.2-rc.5`.
The original Standard preset and every original tool implementation, description, schema, and execute function remain unchanged.

## Behavior

The initial catalog contains eleven core tools plus `tool_activate`:

- `read`, `read_image`, `write`, `edit`, `glob`, `grep`, `pwsh`
- `working_directory`, `ask_user_question`, `todo_write`, `skill`

`tool_activate` exposes ten capability groups: `context`, `delivery`, `delegation`, `goals`, `jobs`, `memory`, `office`, `plugins`, `schedule`, and `web`.
Activate the smallest set needed for the task. Newly activated schemas appear on the **next model step** and remain active for the rest of the session.

Activation is monotonic by design: tools are not repeatedly hidden and reshown. This preserves historical tool-call validity and avoids unnecessary cache churn.

## How it works

- Each managed Agent receives local registrations containing the **exact original ToolDefinition object** plus a step-time `when` condition.
- An inactive tool is omitted from both model declarations and executable lookup; this is not merely prompt guidance.
- Successful `tool_activate` calls are reconstructed from the existing `tool/call` and `tool/result` session events through a pure projection. No custom Session event type is introduced, and resume/fork replay restores active groups.
- Web activation preserves the original provider-readiness conditions for `web_search` and `web_fetch`.
- Late registrations, removals, and replacements are reconciled by rebuilding the Agent-local shadows against the current inherited catalog; stale definitions are not retained.
- Native Office render/convert/recalculate tools keep their original skill-load gate. The `office` group only defers `load_workspace_dependencies`.
- Unmapped tools fail open and remain available. If a mapped tool is already registered in the exact Agent scope and cannot be shadowed, the plugin logs a warning and leaves it available rather than blocking Agent creation.

## Install

Requires a base-backed DSH `0.2.2-rc.5` profile with the Standard preset services.

```sh
git clone https://github.com/279095090/dsh-dynamic-tools.git
```

In DSH, open **Plugins → Add plugin** and choose the cloned `dsh-dynamic-tools` directory. Alternatively, ask the DSH Agent to call `plugin_manager` with `action: install_bundle` and the absolute cloned directory as `target`. Restart DSH if the manager returns `restart-required`.

Select **Standard (Dynamic Tools)** for a new session. Both creation paths are supported: specify Dynamic Tools while creating the Agent, or create a blank Standard session and switch to Dynamic Tools before the first prompt. The plugin synchronizes already-existing blank Agents and listens to `agent-preset/selected`; changing the default preset is not required. Switching away removes the Agent-local gates. Started sessions retain their existing composition.

Suggested smoke test:

1. Ask the Agent which tool groups are available; it should identify `tool_activate` and the deferred groups.
2. Ask it to search the web. It should activate `web`, then use the web tools on a later step.
3. Ask it to inspect a background job, manage a schedule, or use memory. Each should require the matching group.
4. Resume the session and confirm previously activated groups remain available.

Compare provider-reported prompt tokens against a fresh Standard session with the same model and workspace. Also compare total tokens after activation: a task that needs several groups may consume more overall tokens because activation adds a model step.

## Run tests

Run the test script in a DSH-provided tool shell so `DSH_INSTALL_DIR` and `DSH_NODE_EXECUTABLE` identify the reviewed installation. On Windows Desktop:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& $env:DSH_NODE_EXECUTABLE tests/verify.mjs
```

On POSIX shells:

```sh
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" tests/verify.mjs
```

The suite compares the copied preset with the installed Standard preset and tests activation replay, visibility/execution gates, direct creation, blank-session preset switching, late tool reconciliation, isolation, and cleanup. It writes `tests/verification.json`, which is ignored by Git.

## Limits and rollback

- This is an experiment pinned to the reviewed DSH version. `engines.dsh` prevents silently carrying the reviewed catalog into another DSH release.
- The preset copies the Standard composition; future Standard additions need explicit review. Unknown tools are never hidden automatically.
- Existing Agent-scope tool registrations that cannot be shadowed remain visible, so actual default counts can vary with third-party plugins.
- Some original static prompt sections are registration-scoped rather than step-scoped and may remain as short guidance even while their tool schema is deferred. Tool schemas provide the main savings.
- The automated test uses a scoped-registry fake to validate state and lifecycle mechanics. Real provider token and end-to-end model behavior require fresh-session A/B tests.
- Roll back by selecting the original **Standard** preset. Disable or remove `@local/dsh-dynamic-tools` to remove the experimental preset entirely. No `app.asar` files or original tool packages are edited.

## License

MIT. See [LICENSE](LICENSE).
