# Recording real hook payloads

Run a short headless session with the plugin, in an isolated home with recording on. Then turn its
work traces into fixtures.

```sh
cd server && npm run build
export DRILLMASTER_HOME=/tmp/rec-home DRILLMASTER_RECORD=1
mkdir -p /tmp/rec-project && cd /tmp/rec-project && git init -q
node <repo>/server/dist/cli.js init --objective "ship features without Owner stepping in" --measure owner_corrections_per_item
claude -p "Use the drillmaster work_report tool to start a work item for issue #1. Then run the bash command: echo hello. Then call the drillmaster work_status tool with your token." \
  --plugin-dir <repo> --allowedTools "mcp__plugin_devops-drillmaster_drillmaster" "Bash(echo:*)"
node <repo>/server/dist/cli.js inspect --json > /tmp/rec.json
```

From `/tmp/rec.json`, write one fixture per hook and tool: `{ "event": e.hook, "payload": e.raw }`.
Name each file `recorded-<hook>[-<tool>].json`.

Before you commit, replace your home directory and your username in every string with `user`.
Claude Code also encodes the username into the transcript folder names.
