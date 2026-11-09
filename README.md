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

The concept lives in [`skills/concept/SKILL.md`](skills/concept/SKILL.md). Everything else in
Drillmaster is built on it.

## The Drillmaster server

`server/` is the npm package `claude-devops-drillmaster`. It is the only thing that stores anything:

- the plugin's MCP server (`drillmaster mcp`) forwards Agent's tool calls to it;
- the hooks send their traces to its REST endpoints.

It runs as one shared local server and starts on its own the first time it's needed.

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
npm test            # unit, api and mcp layers
npm run typecheck
claude plugin validate ..
```
