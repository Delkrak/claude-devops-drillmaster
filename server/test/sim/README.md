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
   - work item inputs were set (when the workflow has any);
   - Owner gates showed what Owner approves beside the question;
   - the Drillmaster repository holds one squash commit per complete work item;
   - what the scenario's `expects` names: an update, a skip, an input on every delivered work
     item, steps skipped by their `if` with no work item through a step it doesn't meet, a tool
     capture that kept output and gates that link it, and the friction judge's verdicts.

   Two checks are soft, because LLM runs vary: whether Owner's friction per work item fell after
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
  The project's `.drillmaster` names the run's Drillmaster repository.
- `files`: files added to the project before its first commit, such as code with bugs to fix.
- `phases` on an issue: sittings, each a fresh session that works only some stages.
- `expects`: what the run must show (see the checks above).
- `origin`: give the project a local bare `origin`, so Agent can push a branch and merge it.
- `prepared_branch`: work done "in an earlier session", committed on a branch and pushed before the
  run.
- `extra_tools`: more tools Agent may use, such as `Bash(git:*)`.

| Scenario | What it exercises |
|---|---|
| `export-features` | Three issues, one retrospective: the workflow grows from Owner's corrections. |
| `docs-and-gates` | Three issues with documentation rules, one retrospective. |
| `export-features-long` | Four issues, two retrospectives, and the git store from setup. |
| `gated-delivery` | Starts from a workflow with an Owner gate and a work item input; five issues delivered through a pushed branch, merged after Owner's approval; two retrospectives. |
| `phases-update` | Three issues, each in two sittings; a retrospective between them adds a step, and an open work item updates at the step that allows it. |
| `bugs-and-features` | Eight bugs and features through one workflow, with skippable steps and a `kind` input; three retrospectives. |
| `pipeline-bugs-and-features` | Capture -> refine -> build -> test, with steps only for bugs or only for features by their `if`; a spec with an Owner gate for features; tool captures of the test runs; eight issues and three retrospectives. |
