# Simulated Owner

The main end-to-end test runs a real Drillmaster session against an agent that plays Owner.

```
cd server
npm run sim -- test/sim/scenarios/export-features.json                 # scripted Owner
npm run sim -- test/sim/scenarios/*.json --owner llm --runs 2          # LLM Owner, twice each
```

Each run takes 15 to 40 minutes and costs a few dollars of Claude usage. It needs a signed-in
`claude` CLI.

## How a run works

1. **Fresh copy.** The scenario's project (`projects/<name>/`) is copied to a temp folder and
   committed to a new git repo. The run gets its own `DRILLMASTER_HOME`, so it never touches your
   real Drillmaster data.
2. **Agent.** Agent is a headless Claude Code session, `claude -p --plugin-dir <repo>`, resumed
   turn by turn. Its tools are limited to the drillmaster MCP tools, file editing, and
   `npm test`/`node`/read-only git.
3. **Owner** comes in two modes:
   - **scripted:** the scenario's fixed lines, in order. It's repeatable enough to catch
     regressions.
   - **llm:** a second Claude session with the persona and the hidden rules. It has read-only
     tools, so it checks Agent's files before approving anything.
4. **Relay.** The harness relays between them. Every Owner message enters Agent's session as a real
   user turn, so the UserPromptSubmit hook records it exactly as it would yours. That includes
   corrections, Owner-gate approvals, and decisions on retrospective proposals.
5. **Order.** The harness runs the setup, then each issue, until it's delivered with Agent's post
   mortem or hits the turn cap. A workflow retrospective comes after the issues named in
   `retro_after`.
6. **Checks.** At the end, `assertions.ts` checks the server's events:
   - the workflow was set up;
   - every issue was delivered, with both post mortems;
   - sessions were bound to their work items;
   - Owner's words and the tool calls were traced;
   - every rejection cites a rule;
   - no token was stored;
   - the retrospective ran, and the workflow grew with experiments and baselines.

   One check is soft, because LLM runs vary: whether Owner corrections per work item fell after the
   retrospective.

## Output

`runs/<time>-<scenario>-<owner>-<n>/` holds three files:
- `transcript.md`: every Owner and Agent message;
- `events.json`: everything the server stored;
- `result.json`: the checks and the metrics.

A run summary is written to `runs/summary-*.json`. The `runs/` folder is git-ignored.

## Scenarios

A scenario is one JSON file holding:
- the project template;
- Owner's objective and measures;
- the issues;
- the hidden rules Owner cares about but never states up front;
- `retro_after`;
- a turn cap;
- the scripted Owner's lines (`{text}` is the issue's text).
