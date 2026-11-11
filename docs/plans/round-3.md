# Plan: Drillmaster round 3 - what reviewing round 2 decided

## Context

Round 2 is built and committed locally on `phase-1-test-bed` (5f0ccb1..50bc9ba, not pushed). Going
through its runs and choices with Owner produced about twenty decisions, listed below. This plan
checks that they fit together, settles where they don't, and builds them in phases. On approval
it's saved in the repository as `docs/plans/round-3.md` (step 0).

The decisions, grouped:
- **Where things live:** the Drillmaster repository holds everything; the work repository holds
  only a `.drillmaster` file; one Drillmaster server per project, at the pinned version.
- **How a work item moves:** in phases across sessions (`work_resume`, stages); updates to a newer
  workflow only at steps that say so, fast-forwarding to the first discrepancy; skippable steps;
  bugs and features in one workflow. The late start and the automatic restart are gone.
- **How things are named:** one reference framework (`step 1.2`, `rule pr 1.1`, ...) resolved to
  GUIDs; feedback as lists that name what they're about.
- **How Owner decides:** approve or not, in AskUserQuestion; anything typed is a rejection with a
  reason.
- **The viewer:** step bars in the timeline, a link to every trace, a history page per component.

## Where the decisions didn't fit, and how this plan settles it

1. **The Drillmaster repository was named in two places.** The workflow key
   `drillmaster_repository` and the `.drillmaster` file both held its URL and folder, and could
   disagree. **(Owner)** Only `.drillmaster` names it. The workflow lives inside that repository
   and doesn't name it. `set_storage` goes away: every project gets its repository at setup, and
   moving one is parked. The work item branch is always `drillmaster/<work_item_id>`.
2. **An update at a passing gate misses changes made between phases.** Gate 1.3 passes on Monday,
   but build starts on Thursday, after Wednesday's retrospective. **(Owner)** `update` belongs to
   the step it guards, and means "update before this step starts". It's checked when the item
   reaches the step, and again whenever the item is resumed at it. In your example it sits on
   2.1, the first step of Build.
3. **"A newer Drillmaster updates the pin" can't happen,** because each project's server runs at
   its pin. **(Owner)** The Drillmaster repository's main branch is always the source of truth,
   the pin included. The pin moves out of the work repository into `<folder>/drillmaster.json` on
   that main, next to `workflow.json`. Upgrading means pushing a new pin there (`drillmaster
   upgrade`), push first like a workflow change. `.drillmaster` names only the repository and the
   folder.
4. **Owner's typed chat words still decided gates and proposals** ("looks good", "approve 1"),
   which needs a word filter. **(Owner)** No word filter. Owner decides only through
   AskUserQuestion. Chat words are prompts, counted as corrections. When Agent is in doubt whether
   Owner meant a decision, it asks Owner in AskUserQuestion. The word classifier and the
   per-number parser (`core/owner.ts`) go away.

Smaller fits, settled by default:
- A skipped step counts as done for fast-forward, as long as it's unchanged.
- Agent can skip only its current step, inside the stages it was asked to do.
- An experiment counts the work items delivered on its version or later (versions now change only
  at update steps).
- Stages are referenced by number (`"stages": ["2", "3"]`). Results show their names, so Agent
  maps Owner's "refine" to a number.
- Retrospective operations use references too: `{"op": "change_step", "step": "1.2"}`,
  `{"op": "add_step", "stage": "1", "after": "1.1"}`.
- GUIDs go on stages, steps, policies, rules and metrics, so every kind of `refs` resolves across
  versions. Tools resolve by name.
- Owner's metric is a choice of category; a typed answer leaves it pending, and it's asked again.
- A changed `skippable` setting is a major change, since it changes the path. A changed `update`
  setting is minor.
- Without `.drillmaster`, a folder isn't traced, and setup is the only tool. It runs on the
  plugin's own version, and writes `.drillmaster`.
- A fast-forward stops at the first discrepancy even when that's before the update step, for
  example a new 1.1. The item goes back to it, and runs everything after it again. That's strict
  on purpose, until it's tried in practice.

## Design

**`.drillmaster`** at the work repository's root, committed with the code:
`{"drillmaster_repository": "<git url>", "folder": "<name>"}`. The project's key is
`<folder>-<hash of url and folder>`.

**The Drillmaster repository, under `<folder>/`; its main branch is the source of truth:**
- `drillmaster.json` on main: `{"drillmaster_version": "0.3.0"}`, the pin. Changed only by
  `drillmaster upgrade`, pushed first.
- `workflow.json` on main: the complete current workflow, rewritten with each change, so its git
  log is the workflow's history.
- `project/<writer>.jsonl` and `items/<work_item_id>/<writer>.jsonl`, as built in round 2.
- `items/<work_item_id>/artifacts/`.

A workflow change is pushed to main first, and applies only once the push succeeded.

**One server per project:**
- The MCP process and the hooks read `.drillmaster`, then find that project's running server
  through `~/.drillmaster/projects/<key>/daemon.json`.
- If no server is running, the plugin starts one:
  1. It fetches the Drillmaster repository's main into the project's clone in
     `~/.drillmaster/projects/<key>/`.
  2. It reads the pin.
  3. It starts the pinned version: the plugin's own build if the pin matches it, otherwise
     `npx -y claude-devops-drillmaster@<pin> daemon`. A pin it can't run is refused with a clear
     message.
- When `drillmaster upgrade` pushes a new pin, the running server stops, so the next session
  starts the new version.
- The REST line between the plugin and the server stays stable across versions. Tool lists and
  results come from the server, so skills stay generic.
- Each project's viewer shows only that project. `drillmaster open` opens it.

**References:**
- `<kind> <name>` with the kinds step, stage, rule, policy, metric and tool. Where a key fixes the
  kind, the kind is left out.
- One resolver, `core/refs.ts`: a reference goes to a GUID, in the version that applies (a work
  item's own version, or the current one for a retrospective).
- Events store the GUID and the number. Old documents and events get GUIDs on read, following
  steps through versions by name.

**Work tools:**
- `work_start({issue, description, stages})` and `work_resume({issue, stages})`. A resume issues a
  new token and voids the old one. Both stop when the last named stage is done.
- `work_gate({token, step, self_check, text, metrics})`, which refuses a step outside the named
  stages.
- `work_skip({token, step, why})`, only for a step marked `skippable`. Agent decides a `self`
  skip at once, Drillmaster judges a `drillmaster` one, and Owner decides an `owner` one, through
  AskUserQuestion.
- `work_report`, `work_deliver` and `work_post_mortem` are unchanged, except that the post
  mortem's fields become lists.

**Updates:**
- A step's `"update": "patch" | "minor" | "major" | "none"` (default `none`) is checked when the
  item reaches the step, or is resumed at it.
- If a newer version is at least that level, the item moves to the latest version. It keeps the
  steps it passed or skipped whose step, rules, policies and stage are unchanged, matched by GUID,
  and stops at the first discrepancy.
- This is logged as `work_item_updated {from_version, to_version, kept, resumes_at}`. The result
  shows what changed (`describeWorkflowChange`, reused from `core/lateStart.ts`).

**Feedback:**
- Post mortem `keep` and `change`, and the retrospective findings `keep` and `improve`, become
  lists of `{refs, text}`. Experiment reflections are `{experiment, text}`. `free_text` goes away.
- A proposal lists `relies_on` references. One that isn't in the current workflow, and isn't added
  by the proposal itself, must be added by another proposal of the same retrospective, which then
  becomes a `depends_on`.
- The retrospective prompt states the tools' contracts, for example the artifact types
  `work_deliver` accepts.
- `tool` references are collected as feedback on Drillmaster itself.

**Owner's decisions:**
- Each is one AskUserQuestion: Approve, or Reject (Decline for a proposal). A typed answer is a
  rejection, with the text as its reason.
- `owner_corrections_per_item` counts every chat prompt during a work item, plus every rejected
  Owner gate.

**Removed:**
- `core/lateStart.ts` (late start, restart and judged skips), keeping `describeWorkflowChange`;
- `start_at`, and the `gate_skip` question;
- the `.drillmaster/` mirror and link record, `storage` in the workflow, the projects list, and
  the events-based "newer Drillmaster" check;
- the typed decision path in `core/hooks.ts`, and `core/owner.ts`.

**Tests:**
- A `ProjectResolver` port: production reads `.drillmaster`, and tests map folders directly, so
  the unit and API tests need no files.

## Build order

Each phase is one local commit, made when its tests are green. Nothing is pushed without Owner's
OK.

0. **The plans in the repository.** (done: d733b35) `docs/plans/` holds every plan, so the decisions are on record
   while we work:
   - `docs/plans/README.md`: the list of plans, each with its status and commits.

     | Round | Plan | Status |
     |---|---|---|
     | 1 | `round-1.md`: build the plugin around the concept | built (publishing open) |
     | 2 | `round-2.md`: what the simulations taught us | built, local |
     | 3 | `round-3.md`: what reviewing round 2 decided | in progress |

   - `round-1.md`: the first plan (phases 1-7). `round-2.md`: the reviewed round-2 plan.
     `round-3.md`: this plan.
   - Each plan is kept as approved. Its build order marks each phase with its commit when the
     phase is done, and the README's status follows.
   - Only plans are stored. Discussion notes and corrections are not.

1. **References and GUIDs:** (done: 9d1b224)
   - IDs in the workflow schema, and `core/refs.ts`;
   - tool arguments, events, metrics' `at_step`, operations and rendering all use references;
   - migration on read.
2. **Owner decides approve or not:** (done: 4b98ef3)
   - one question per decision, and typed means reject;
   - remove the chat decision path;
   - the measure.
3. **Feedback with references:** (done: 3a7d31a) post mortems and findings as lists, `relies_on` and `depends_on`,
   tool contracts in the prompt, `tool` feedback.
4. **Update steps and skippable steps:** (done: 01ca49e)
   - fast-forward, and `work_item_updated`;
   - the new `work_skip`;
   - remove the late start and the restart.
5. **Phases across sessions:** (done: 4194c50) `work_resume`, `stages`, stopping at the end, rotating tokens, and
   binding a resumed session.
6. **The Drillmaster repository:** (done: 516ae46)
   - the `.drillmaster` file;
   - `workflow.json` and the pin (`drillmaster.json`) on main;
   - push first, then apply, for workflow changes and pins;
   - remove `storage`, the mirror and the link record;
   - rename "store" everywhere.
7. **One server per project:** (done: a8624cd)
   - per-project `daemon.json`, with the shim and hooks routing by `.drillmaster`;
   - reading the pin from main before starting the server, then starting the pinned version (the
     plugin's own build, or npx);
   - `drillmaster upgrade`;
   - setup before `.drillmaster` exists;
   - the viewer per project, and `drillmaster open`.
8. **Viewer:** (done: 8d1716b) step bars, trace links (`?event=`), history pages per component, feedback on
   Drillmaster, skips and updates.
9. **Review, before the simulations.** (done: 0eac82e) An agent review, not a stop for Owner
   (corrected by Owner; it was first written as a stop):
   - a code review of phases 1-8 (`/code-review` on the round's diff), with its findings fixed
     and committed;
   - a check of the build against this plan's decisions, one by one, noting anything built
     differently.
10. **Simulations:**
   - phases across fresh sessions, each phase a new `claude -p` session using `work_resume`;
   - a bugs-and-features scenario, with skippable steps and a `kind` metric;
   - an update scenario, where a retrospective adds a step between two phases of an open item and
     the item fast-forwards;
   - new checks.
11. **Finish:** a clean-code pass, re-recorded hook fixtures, local CI on Windows and Linux, docs.

## Verification

- Unit and API tests for every decision, including:
  - the resolver (round trips, refusals, migration);
  - fast-forward (kept, discrepancy, going back, skipped steps);
  - stopping at stages, and voided tokens;
  - typed means reject, and the measure;
  - `relies_on` turning into `depends_on`;
  - push first, against a rejected push;
  - routing to per-project servers;
  - the pin read from the Drillmaster repository's main, `drillmaster upgrade` (pushed first,
    stopping the running server), and a pin the plugin can't run.
- Playwright: step bars, trace links, history pages, and per-project viewers.
- The plugin layer in real Claude Code: setup writes `.drillmaster`; a second session resumes a
  work item; an Owner gate is decided in AskUserQuestion.
- Sims: all hard checks pass for the scripted and the LLM Owner in the three new scenarios.
- `claude plugin validate .`, plus local CI on Windows and on Linux in Docker.
