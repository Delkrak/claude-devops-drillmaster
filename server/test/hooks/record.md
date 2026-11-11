# Recording real hook payloads

Run two short headless sessions with the plugin, in an isolated home with recording on: one sets
the project up and starts a work item, the next takes it up again. Then turn their work traces into
fixtures.

```sh
cd server && npm run build
export DRILLMASTER_HOME=/tmp/rec-home DRILLMASTER_RECORD=1 DRILLMASTER_REVIEWER=none
git init --bare -q --initial-branch=main /tmp/rec-drillmaster.git
mkdir -p /tmp/rec-project && cd /tmp/rec-project && git init -q
TOOLS="mcp__plugin_devops-drillmaster_drillmaster Bash(git:*) Bash(ls:*) Read"
claude -p --plugin-dir <repo> --allowedTools $TOOLS \
  "Set up Drillmaster with the drillmaster setup skill. Objective: ship features without Owner stepping in. Measure: owner_corrections_per_item. The Drillmaster repository: /tmp/rec-drillmaster.git. Then start issue #1 'add a CONTRIBUTING.md' with work_start, check work_status, and stop there."
claude -p --plugin-dir <repo> --allowedTools $TOOLS \
  "Take up issue #1 'add a CONTRIBUTING.md' again with work_resume, run ls, check work_status, and stop there."
node <repo>/server/dist/cli.js inspect --json > /tmp/rec.json
```

From `/tmp/rec.json`, write one fixture per hook and tool: `{ "event": e.hook, "payload": e.raw }`.
Name each file `recorded-<hook>[-<tool>].json`.

Before you commit, replace your home directory and your username in every string with `user`.
Claude Code also encodes the username into the transcript folder names.
