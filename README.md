# claude-devops-drillmaster

Drillmaster is a drill sergeant trained in agile, who runs your agentic development workflow like a
bootcamp: every work item runs through your workflow step by step and gate by gate, and the work
traces and work reports feed the workflow retrospectives that keep it improving.

## Install

```
/plugin marketplace add Delkrak/claude-devops-drillmaster
/plugin install devops-drillmaster@claude-devops-drillmaster
```

## Skills

| Skill | What it does |
|---|---|
| `/devops-drillmaster:concept` | Explains the Drillmaster concept: the philosophy, the chain of command and the workflow. |
| `/devops-drillmaster:work` | How Agent runs a work item with the drillmaster tools: start it, report, hand in each gate, deliver, then write the post mortem. |

The concept lives in [`skills/concept/SKILL.md`](skills/concept/SKILL.md). Everything else in
Drillmaster is built on it.

## The Drillmaster server

`server/` is the npm package `claude-devops-drillmaster`. It is the only thing that stores anything:

- the plugin's MCP server (`drillmaster mcp`) forwards Agent's tool calls to it;
- the hooks send their traces to its REST endpoints.

It runs as one shared local server and starts on its own the first time it's needed.

| MCP tool | What it does |
|---|---|
| `workflow_get` | Describes the workflow: the objective, the work stages and work steps, the rules, and the experiments. |
| `work_report` | Agent's only write tool, with five actions: `start`, `report`, `gate`, `deliver` and `post_mortem`. |
| `work_status` | Shows where a work item is, with its work reports and work traces. |

Each work gate is judged by the level of the chain of command it belongs to:
- **Self gate:** Agent's own self check decides it at once.
- **Drillmaster gate:** a headless `claude -p` reviewer judges it. It gets the rules, the new and
  past work reports, and the work traces. It runs with no tools and no MCP, and needs no API key.
- **Owner gate:** it stays pending until Owner's own words to Agent decide it. In v1, plain
  agreement such as "looks good" approves it, and words like "no" or "fix" reject it.

The hooks (`hooks/hooks.json`) record every action and every Owner prompt as a work trace. They
cover SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop and SubagentStop. A project
without a workflow is never traced.

Until the package is published, build it once, then load the plugin from this folder:

```
cd server && npm install && npm run build
claude --plugin-dir <path to this repo>
```

The CLI:

```
drillmaster init --objective "<Owner's objective>" --measure owner_corrections_per_item
drillmaster inspect [--json]
```

`DRILLMASTER_HOME` sets where the server keeps its port file and store. It defaults to
`~/.drillmaster`.

## Development

```
cd server
npm test            # unit, api, mcp and hooks layers
npm run typecheck
claude plugin validate ..
```
