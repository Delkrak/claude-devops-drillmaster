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
   `npm test`/`node`/read-only git (a scenario can add more).
   - The run has a permission host: `--permission-prompt-tool mcp__owner__answer`, served by
     `ownerMcp.mjs`. In `claude -p`, that is what makes AskUserQuestion available. The tool posts
     each AskUserQuestion to the harness, which answers as Owner; any other unlisted tool is denied.
3. **Owner** comes in two modes:
   - **scripted:** the scenario's fixed lines, in order. It's repeatable enough to catch
     regressions. In AskUserQuestion it picks Approve, or the first option.
   - **llm:** a second Claude session with the persona and the hidden rules. It has read-only
     tools, so it checks Agent's files before approving anything. AskUserQuestion goes to it too,
     and it answers with an option, its own words, and a note.
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
   - the retrospective ran, and the workflow grew with experiments and baselines;
   - Owner decided through AskUserQuestion;
   - every work stage has a work step with an instruction;
   - metrics were recorded (when the workflow has any), and a late start was judged (when the
     scenario expects one);
   - the git store holds one squash commit per complete work item (when the scenario uses one).

   Two checks are soft, because LLM runs vary: whether Owner corrections per work item fell after
   the retrospective, and whether Agent reported the workflow missing its work.

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
- the scripted Owner's lines (`{text}` is the issue's text, `{store}` the run's git store repo).

Optional fields:
- `seed_workflow`: start from this workflow instead of setup, for example one with an Owner gate.
  It gets the run's git store.
- `origin`: give the project a local bare `origin`, so Agent can push a branch and merge it.
- `prepared_branch`: work done "in an earlier session", committed on a branch and pushed before the
  run, for a late start.
- `expects_late_start`: check that a late start was judged.
- `extra_tools`: more tools Agent may use, such as `Bash(git:*)`.

| Scenario | What it exercises |
|---|---|
| `export-features` | Three issues, one retrospective: the workflow grows from Owner's corrections. |
| `docs-and-gates` | Three issues with documentation rules, one retrospective. |
| `export-features-long` | Four issues, two retrospectives, and the git store from setup. |
| `gated-delivery` | Starts from a workflow with an Owner gate and a metric; five issues delivered through a pushed branch, merged after Owner's approval; a late start on prepared work; two retrospectives. |
