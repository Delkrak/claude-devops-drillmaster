# Plan: Drillmaster round 2 - what the simulations taught us (reviewed)

## Context

Phases 1-6 work end to end, and five simulated-Owner runs passed. Reviewing those runs with Owner
gave decisions D1-D15 (`drillmaster-round-2.md`). Owner then asked for the plan to be stress-tested
before anything is built. The review checked it against the code on `phase-1-test-bed` and against
Claude Code's docs (hooks, MCP, headless mode, Agent SDK).

The direction holds. But four parts would have broken the build or its verification, and eight
more had holes. This file replaces `drillmaster-round-2.md`. On approval, the first step is to
copy it back there, so the plan Owner knows by name stays current.
It also replaces the phase 1-7 plan, which is built except publishing to npm (still open, after
round 2).

## What the review changed

Would have broken:
1. **The Owner prompt couldn't be tested.** The sims and the plugin tests drive `claude -p`. In
   `-p`, Claude Code offers AskUserQuestion only when the run has a permission host. Fix: give the
   runs one with `--permission-prompt-tool`, backed by a small sim MCP server that hands each
   AskUserQuestion to the scripted or LLM Owner. The docs don't say AskUserQuestion's answers go
   through that tool, so a spike proves it first. The Agent SDK is documented for this, but needs
   an API key: if the spike fails, stop and ask Owner.
2. **Session files would conflict on merge.** One session can work several items in a row, so
   `events/<date>-<session>.jsonl` would differ on two item branches. Fix: one file per work item
   and session, `items/<work_item_id>/<session>.jsonl`; project events go in
   `project/<session>.jsonl` on main.
3. **One daemon can't check out two branches.** Two active items mean two branches in one store
   repo. Fix: the daemon writes commits with git plumbing into its own bare clone of the store,
   with no checkout.
4. **The main measure would go wrong.** `owner_corrections_per_item` subtracts one for each
   approved Owner gate, because that approval used to arrive as a prompt. Through AskUserQuestion
   there's no prompt, so the count would drop below the truth. Fix: count what Owner did, not the
   channel: every prompt that isn't itself a decision, plus every rejected Owner gate.

Holes:
5. **Artifacts and trace tails could leak secrets into a pushed repo.**
   - Artifacts must be files inside the linked work folder, not ignored by git, images or text,
     at most 5 MB each.
   - Traces also redact well-known secret formats: private key blocks, `ghp_`, `github_pat_`,
     `sk-`, `AKIA`, `xox?-` and `password=`. The list becomes configurable later (D2's note).
6. **Agent could answer for Owner.** AskUserQuestion's input has an `answers` field.
   - The PreToolUse hook refuses an AskUserQuestion for a pending decision whose input already
     carries answers.
   - PostToolUse accepts answers only for a call (`tool_use_id`) that PreToolUse saw without them.
     If PreToolUse was missed, the decision stays pending: fail closed.
   - An answer counts only when its question text matches what the server issued.
7. **The merge might never happen.** It waits for both post mortems, but Drillmaster's can fail,
   or the reviewer can be off. Fix: merge once Agent's post mortem is in and Drillmaster's is
   written or recorded as failed.
8. **Events after the merge had no home.** A fix-now `added_step` or a late correction comes after
   the merge. Fix: once an item is merged, its events go on main.
9. **Two machines could both make workflow version n+1.** Fix: a workflow change takes effect only
   once it's pushed to the store's main. If the push is rejected, the daemon fetches, re-checks
   the proposal and retries. The daemon fetches at SessionStart and every few minutes.
10. **AskUserQuestion takes 1-4 questions, with 2-4 options each.** Five proposals don't fit in
    one question. **(Owner)** At most 4 proposals per retrospective, each its own Approve/Decline
    question with its own notes.
11. **Rules left undefined:**
    - when a null hypothesis counts as rejected;
    - when a metric is answered;
    - when a retrospective is due.

    The definitions are in D8-D10.
12. **The phase order caused rework, and the sims came last.** D1 was built on `work_report(gate)`
    and the old skills, which phase 3 replaced. Fix: tools and rendering first, then the Owner
    prompt on top, D7 and D15 together, and a sim checkpoint before the storage work.

Owner then decided four more points, marked **(Owner)** below:
- Elicitation is parked.
- Owner approves skipping an Owner gate.
- A retrospective makes at most 4 proposals, one question each.
- Versions follow semver, and only a major workflow version restarts work.

## Decisions

| # | Area | Decision |
|---|---|---|
| D1 | Owner's decisions | Owner decides through **AskUserQuestion**. The server issues the exact question, the PostToolUse hook records the answer, and a typed prompt still works. Owner can add notes or type an answer (Other), and both are recorded. Covers retrospective proposals, the Owner gate, Owner's metrics, and skipping Owner gates. Fixes "Approve 1, decline 2." **(Owner)** MCP elicitation is parked: multi-select isn't documented, it holds the tool call open, it's cancelled in non-interactive runs, and it would be a second path to test. |
| D2 | Work traces | Each tool call's trace keeps its exit status or error flag, the **last 20 lines of output**, and inputs up to 2,000 characters. Tokens and well-known secret formats are redacted. A note in code and docs: the rules may become configurable regexes. |
| D3 | Work stages | **Stages hold the work.** A stage gets a `purpose`, and a step gets an `instruction`: the work to do, which its gate checks. The retrospective is told to propose work, not only checks. |
| D4 | Tools | **One tool per action:** `work_start`, `work_report`, `work_gate`, `work_deliver` and `work_post_mortem`, plus `workflow_get`, `work_status` and `workflow_retrospective`. |
| D5 | Results | **Self-driving results.** Every work tool returns short markdown: the verdict, then the next step in full (stage purpose, instruction, gate kind, each rule with how it's verified, what to report, running experiments, metrics due, a self-check skeleton), and the exact AskUserQuestion to ask when an Owner decision is pending. |
| D6 | Work item story | `work_start` takes `issue` and `description`. `work_deliver` takes `pr`, a `summary` and `artifacts` (file paths; limits in finding 5). Artifacts are copied into the store, and the viewer shows images inline. |
| D7 | Late start | `work_start` may take `start_at`, a `justification` and `evidence`. Drillmaster judges skipped self and Drillmaster gates, using the evidence and the project's traces, including traces from earlier workflow versions. **(Owner)** A skipped Owner gate needs Owner's approval through AskUserQuestion, so the chain of command holds. Approved skips are recorded as "skipped, justified". A rejection starts at the first step and cites the unmet rule. |
| D8 | Metrics | The workflow defines categorical **metrics**: each category has a description, and the metric is taken at a work step, by agent, drillmaster or owner, following its instruction, with an optional explanation. Metrics due at a step are answered with its gate. Agent's go in `work_gate`, which is refused without them. Owner's are asked with AskUserQuestion. Drillmaster's are judged in the gate's review, or in the background when there isn't one, so they never hold a gate. Measures can be split by a metric. The retrospective can add, change or remove metrics. |
| D9 | Experiments | Experiments get a `hypothesis`, a `null_hypothesis`, a `target` and `judge_after` (delivered items). The server computes the verdict: the null hypothesis is rejected when the mean over the `judge_after` items beats the baseline by more than the baseline's standard deviation. An experiment is kept only if that holds and the target is met; otherwise it's rethought. Verdicts name experiments on the same measure that ran at the same time. |
| D10 | Retrospective | Every retrospective **opens by judging the last one's actions**. A retrospective is **due** when a running experiment reaches `judge_after`, or 5 items after the last one. Drillmaster says so in the SessionStart brief and the `work_deliver` result. Owner calls it. **(Owner)** At most 4 proposals per retrospective, one question each. |
| D11 | Viewer | Shows each stage's **Definition of Done** (its rules as a checklist), descriptions, results, artifacts (images inline), metrics, skipped steps, restarts and hypotheses. |
| D12 | Delivery | Delivery is the **workflow's job**, not built in. |
| D13 | Storage | **A separate git repo is the store**, and the only external dependency for now. A work item's events go on its own branch, which is committed and pushed at each stage end. The branch is squash-merged into main and pushed once the item's workflow is complete. The work repo holds `.drillmaster/drillmaster.json` and a generated `.drillmaster/workflow.json`. Design below. |
| D14 | Simulation | Longer scenarios: 4-5 issues and two retrospectives, and one scenario is seeded with an Owner gate. Realistic delivery: a feature branch pushed to a local bare remote, merged after the Owner gate; the store is another local bare repo. Owner answers AskUserQuestion through the permission-prompt tool. New checks: every stage has a work step; no Agent reports missing work; Owner decides through AskUserQuestion; metrics are recorded; a late start is judged; the store holds one squash commit per complete item. |
| D15 | Versions | Every event carries the `workflow_version` and `drillmaster_version` it was made under. **(Owner)** Both follow **semver**. The server sets a workflow change's level from what changed (table below). Only a **major** version restarts active work items from the first step. A minor version applies from each item's next step. A patch changes nothing Agent does. A Drillmaster upgrade never restarts work: it updates the pin, and a Drillmaster older than the pin refuses to write. Old work and traces stay valid evidence: a restart is a late start (D7). |
| - | Parked | MCP elicitation, limiting experiments in progress, and trend charts in the viewer. |

## Design notes

**Workflow document (v2).**
- `version`: semver string. `0.0.0` holds only Owner's objective. Old whole-number versions `n`
  are read as `n.0.0`.
- `objective`: `{text, measures: [measure name]}`.
- `storage` (new): `{repo: <git url or path>, path, branch: {pattern}}`.
  - `repo` is required, and the work repo itself isn't supported.
  - `path` is the project's folder in the store (default: the project name).
  - `branch.pattern` defaults to `drillmaster/{work_item_id}`.
- `stages[]`: `{n, name, purpose (new), steps[]}`.
- `stages[].steps[]`: `{n, name, instruction (new), gate: self|drillmaster|owner, rules:
  ["<policy> <rule id>"], report: [text]}`.
- `policies[]`: `{name, rules: [{id, rule, verified_by}]}`.
- `metrics[]` (new): `{name, categories: [{value, description}], at: {stage, step},
  by: agent|drillmaster|owner, instruction}`.
- `experiments[]`: `{id, change, purpose, hypothesis, null_hypothesis, measure, baseline,
  baseline_sd, target, judge_after, started}`. Everything after `purpose` is new except
  `measure`, `baseline` and `started`.

Rules: stages and steps count 1, 2, 3 in order; every rule ref and every `metrics[].at` points at
something that exists; category values are unique within a metric; measure names are the server's.
Older documents are migrated on read: missing text becomes an empty string, and the retrospective
is asked to fill it in.

**Owner prompt (D1).**
- A pending Owner decision has an id, a kind (Owner gate, proposals, Owner metric, gate skip) and
  the exact AskUserQuestion input the server wants asked.
- The work tool's result renders that input, and Agent passes it on unchanged. The work skill says
  to ask from the main conversation, because AskUserQuestion isn't available in subagents.
- PreToolUse on AskUserQuestion: an input that already carries `answers` for a pending question is
  denied. A clean call's `tool_use_id` is recorded.
- PostToolUse on AskUserQuestion: `tool_response.answers` is keyed by question text, and counts
  only for a recorded `tool_use_id`. The server matches each question to its pending decision and
  records the verdict or decision, with Owner's notes (`annotations`) as the comment. The hook's
  `additionalContext` tells Agent the outcome and the next step.
- Other (typed text): the per-number parser and `classifyOwnerWords` decide it. If it's unclear,
  the decision stays pending, and Agent gets Owner's text to answer before asking again.
- A typed prompt (UserPromptSubmit) still decides a pending decision, as today.

**Traces (D2).** PostToolUse summarizes `tool_response`: exit code, the tail of stdout and stderr,
and the error, all redacted. The Drillmaster gate prompt and the viewer timeline show the tail.

**Git store (D13).**
- The daemon's local JSONL log stays its working copy: fast, works offline, and the tests keep the
  memory store. A **store publisher** mirrors the log into git:
  - It keeps its own bare clone of the store under `$DRILLMASTER_HOME/stores/<project>/`.
  - It writes commits with plumbing (`hash-object`, a temporary index, `commit-tree`,
    `update-ref`), so it writes any number of item branches with no checkout.
  - Item events go in `{path}/items/<work_item_id>/<session>.jsonl` on the item's branch, and
    project events (setup, retrospectives, workflow changes, Owner's decisions) in
    `{path}/project/<session>.jsonl` on main. Artifacts go in `{path}/items/<work_item_id>/artifacts/`.
  - At each stage end (the stage's last gate passes, or delivery), it commits and pushes the branch.
  - When the item is **complete** (delivered; Agent's post mortem written; Drillmaster's written or
    failed), it squash-merges: main's tree plus the item's folder, as one commit on main whose
    message names the work item, its issue and its outcome. Then it pushes main and deletes the
    item branch, locally and on the remote.
  - It pushes in the background with `GIT_TERMINAL_PROMPT=0`, a timeout and retries. A failing push
    shows in the SessionStart brief and in the viewer.
- At start and on every fetch, the daemon imports events from the store (main and every
  `drillmaster/*` branch), deduplicated by event id.
- Measures and retrospectives count a work item once it's **complete**, so every machine counts
  the same items.
- Setup checks that git is installed and that the store accepts a push (it pushes the setup
  commit), and tells Owner the store repo should be private.
- `.drillmaster/drillmaster.json` (version pin, project name, store) points people and new machines
  at the store. The daemon keeps its own record of each link, and it flags and ignores a file that
  disagrees, so Agent can't re-link a folder to an empty store.
- `.drillmaster/workflow.json` is regenerated at SessionStart and after each workflow change, and
  Agent commits it with its next work. If someone edits it by hand, the edit is overwritten and
  reported.
- Projects are resolved from the linked folder's `drillmaster.json`, no longer from a hash of the
  path. Existing `~/.drillmaster` stores can be imported.

**Versions (D15).**
- The envelope becomes `{id, at, workflow_version, drillmaster_version, type, ...}`. Old events get
  their versions from the fold.
- Each retrospective operation has a level, set by the server. A proposal's level is the highest
  of its operations, and each applied proposal makes one new version.

  | Level | What changed | Active work items |
  |---|---|---|
  | major | The path or its checks: a stage, step, gate or rule ref is added, removed or moved | Restart at the first step, with the offer to skip steps already met |
  | minor | What Agent is told, not the path: purpose, instruction, rule text, report, metrics, a new experiment | Carry on; the change applies from their next step |
  | patch | Nothing Agent does: an experiment's result recorded, storage settings | No effect |

- On a major version, the server appends `work_item_restarted {work_item_id, from_version,
  to_version}` for each active item. The item's next result renders:
  - the new first step;
  - a short diff of the two versions;
  - the offer to skip steps already met, which is judged as a late start.
- An experiment counts only work items started, or restarted, on its version or later. An item
  counts under the version it's delivered on.
- A Drillmaster newer than the pin updates the pin. One older than the pin refuses to write, and
  says to upgrade, because it may not read newer events.

**Retrospective operations.**
- `add_stage` and `add_step` require `purpose` and `instruction`.
- New operations: `add_metric`, `change_metric` and `remove_metric`.
- A proposal that opens an experiment must carry `hypothesis`, `null_hypothesis`, `target` and
  `judge_after`.
- `end_experiment` cites the server's verdict.
- `workflow_retrospective(apply)` applies every approved proposal in dependency order in one call.

**Tools (D4/D5).** Rendering is a pure function in `core/render.ts`, with unit-tested snapshots.
`workflow_get` stays JSON for looking around. Session binding moves from `work_report(start)` to
`work_start` (`startedWorkItemId` in `core/hooks.ts`).

## How this round runs

Owner asked for an unattended run: work through as many phases as possible without asking, then
put the computer to sleep, as last time. Then Owner and Agent discuss what's missing.
- No questions during the run. A choice that would have gone to Owner is decided by the plan's
  recommended default, and written down in `round-2-for-discussion.md` in the job's scratch folder.
- If the AskUserQuestion spike (phase 3.1) fails, don't add an API key. Record why, keep the typed
  prompt path, and go on with the other phases.
- A phase that can't go green within reason is left uncommitted, written down, and the next
  independent phase starts.
- At the end: run the full suite, write the report (phases done, commits, what's missing, the open
  choices), then put the computer to sleep 90 seconds later, in the background with PowerShell:
  `Start-Sleep -Seconds 90; Add-Type -AssemblyName System.Windows.Forms;
  [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend,
  $false, $false)`.

## Build order

Each phase is one local commit on `phase-1-test-bed`, made only when its tests are green. Nothing
is pushed without Owner's OK.

1. **Decline fix and traces (D1 parser, D2).** First a test for "Approve 1, decline 2.", then the
   fix in `core/owner.ts`. Then result tails and secret redaction in `core/hooks.ts`.
2. **Workflow v2, tools and rendering (D3, D4, D5, D6, D8, D9, D12).** Schema with semver
   versions, migration, operations, the tool split, `core/render.ts`, artifacts with their limits, metrics, hypotheses
   and the null-hypothesis verdict. Rewrite the work skill.
3. **Owner prompt (D1).**
   1. Spike: in `claude -p` with `--permission-prompt-tool`, a sim MCP server answers
      AskUserQuestion, and the plugin's PostToolUse hook sees the answers and annotations.
      Pre-filled answers are refused. If this fails, stop and ask Owner.
   2. Pending decisions, both hook paths, Owner's notes, and the measure fix (finding 4).
   3. Update the work and retrospective skills.
4. **Late start, versions on events, semver levels and restart (D7, D15).**
5. **Retrospective opening and "due" (D10).**
6. **Sim checkpoint.** Move the harness and the plugin tests to the permission-prompt tool. The
   sim MCP server asks the harness over local HTTP, and the harness answers from the script or
   runs an Owner turn. Then run the two existing scenarios with the scripted and the LLM Owner,
   and fix what breaks before the storage work.
7. **Git store (D13).** Store publisher, link and setup, pin and mirror, drift check, import from
   `~/.drillmaster`.
8. **Viewer (D11).** The new elements, with Playwright tests.
9. **Simulations (D14).** New scenarios and checks, realistic delivery and a store bare repo. Run
   scripted and LLM Owner until they pass.
10. **Clean-code pass, local CI (Windows and Linux), docs.**

## Verification

- Unit, API, MCP and hook tests for every decision:
  - render snapshots;
  - the parser, including "Approve 1, decline 2.";
  - AskUserQuestion matching, pre-filled answers refused, and free text left pending;
  - the measure, with Owner gates decided both ways and on both channels;
  - redaction, and the artifact limits;
  - the null-hypothesis verdict;
  - the semver level of every retrospective operation;
  - a major version restarting an active item, while a minor one doesn't;
  - late start, including an Owner-gate skip that Owner decides;
  - the git store against a local bare remote: stage commits, two items in flight at once, squash
    merge once complete, merge when Drillmaster's post mortem failed, a push rejected and retried,
    and import deduplicated by event id.
- Playwright: the new viewer elements.
- The plugin layer in real Claude Code: an Owner gate decided through AskUserQuestion, and
  `work_start` and `work_deliver` with an image artifact.
- Simulations: every check passes with the scripted and the LLM Owner, in both scenarios, and
  corrections per item still fall after the retrospectives.
- `claude plugin validate .` in both profiles, plus local CI on Windows and on Linux in Docker.
