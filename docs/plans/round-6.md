# Plan: Drillmaster round 6 - custom measures

🟥 not built, already in an earlier version of this plan | 🟧 not built, new or changed since then | 🟩 built

## Context

Keeper's Owner asked (through Dispatcher) to split owner friction into policy friction and process
friction. The real request is that a project can define its own measures. Today a workflow can only use
five measures hardcoded in `server/src/core/measures.ts`. Four of them are counted automatically, and one
(owner friction) is judged by a separate friction judge and placed at a step by a second call.

Owner's decisions:
- 🟩 Custom measures are **judged only**: a name and a definition in words.
- 🟩 They are **judged in Drillmaster's post mortem** of each delivered work item. Each occurrence is
  assigned to a step and summed for the delivery. Drillmaster reads the item's whole trace.
- 🟩 They are **added at retrospectives**, with Owner's approval, like any workflow change.
- 🟩 **No re-judging of history.** A new measure counts from the next delivered item, and its first
  experiment waits for the baseline window (5 items).
- 🟩 **The four counted built-ins stay** (gate rejections, review rounds, minutes, tool calls). Owner
  friction leaves the code: the friction judge and the friction placement are removed.
- 🟩 **Each measure has a flag to show it on the pages**, so several measures can be shown to pinpoint
  issues.
- 🟩 **Existing projects keep friction as a custom measure.** A workflow that names
  `owner_friction_per_item` gets a custom measure of that name and definition on upgrade. Keeper
  changes nothing until a retrospective does.
- 🟩 **Old friction stays visible** as "friction (old)" at moments before the upgrade.

Defaults I chose (say if not):
- 🟩 A custom measure counts something that should not happen. Lower is better, and the target is 0.
- 🟩 Its name is plain words (e.g. "policy friction"), unique in the workflow, so the pages show it as
  it is.
- 🟩 Each occurrence names the trace events it is about, so the work item page can show what happened
  (e.g. Owner's prompt).
- 🟧 Not in this round: setup writing `.drillmaster` into the work folder (the worktree case). That is
  a separate small fix to do next.

## Build order

Each step ends in one local commit with typecheck and tests green. Nothing is pushed without Owner's OK.

### 0. 🟩 The plan in the repository
Add `docs/plans/round-6.md` and its row in `docs/plans/README.md`.

### 1. 🟩 Measures defined in the workflow (core) (ec6b0ae)
- `core/workflow.ts`: `WorkflowDocument.measures: [{ name, short, color, definition, show }]`; the
  objective and experiments accept a counted measure or a defined one.
- `core/measures.ts`: `COUNTED_MEASURES`; a judged measure an item was not judged on has no value,
  and the averages, baselines and experiments count only items with one.
- `migrateWorkflow`: a workflow naming `owner_friction_per_item` defines it; a measure without a
  short name or colour gets one.

### 2. 🟩 Drillmaster's post mortem judges the measures (ec6b0ae)
- The post mortem judges every defined measure, each occurrence at the step that should have caught
  it, with the events it is about; it records the last event it read (`judged_through`).
- Built beyond the plan: what Owner says after the post mortem is judged at the next retrospective
  (`late_measures_judged`), as the post mortem runs at delivery and would miss it.
- An answer with no judgement leaves the measures unjudged; a failed post mortem is retried at the
  retrospective.
- The friction judge and its placement are gone; their old events stay readable.

### 3. 🟩 Retrospectives and setup define measures (c699f73)
- `add_measure`, `change_measure`, `remove_measure`: a patch, no experiment.
- Setup takes `define_measures`; naming `owner_friction_per_item` there says it is no longer built in.
- An experiment on a judged measure waits for 5 judged work items.

### 4. 🟩 Page data (core) (fdfdf41)
- `core/marks.ts`: each occurrence of a shown measure, and old friction as `friction (old)`.
- Workflow page per stage and "no step covers it"; work item page per step; the list per measure;
  the complaints page what no step covers.

### 5. 🟩 Several measures on the line: Owner decided
- Two variants built and read blind: a colour per measure, and one colour with names. Both read
  right.
- Owner chose: a colour per measure, with its short name and count in a pill (`PF 2`); the colour and
  short name are part of the measure's definition. What no step covers gets a row of its own, as both
  readers took it for "after delivery". A measure's definition shows on hover, on a pill and in the
  key.
- DESIGN.md: the One Alarm Rule now covers the measure colours.

### 6. 🟩 Build the viewer (b95a697)
- Pills, key, tips, the list, step detail, the no-step rows and the complaints source.
- Playwright `viewer.spec.ts` updated; `@screens` saves `measures-*.png`.
- 🟩 A blind read of the built page: every count right.
- 🟧 Owner's review.

### 7. 🟩 Fixture data (0f32e92)
- `reviewed-run.json` defines policy friction (PF) and process friction (PC); `judge-measures.ts`
  judged #1, #2 and #5 to #8 with the Claude reviewer (6 calls). #4 keeps its old friction.

### 8. Finish
- 🟩 `/code-review` on the round's diff: ten findings, all fixed with tests.
- 🟩 A clean-code pass.
- 🟩 README, DESIGN.md, `.impeccable/design.json` and the skills updated.
- 🟩 Version 0.4.0, bundle rebuilt (3828312).
- 🟩 Local CI: Windows, and Linux in Docker on Node 22 and 24 (327 tests each, the bundle check), the
  browser tests on Linux (23).
- 🟩 The plans marked built.

## Verification

- 🟩 Unit and API tests: two defined measures judged per step; late judgement; unjudged answers;
  experiments counting only judged items; old events keep `owner_friction_per_item`'s values.
- 🟩 The marketplace install test passes on 0.4.0.
- 🟩 Playwright: the pages show the measures' pills, the no-step row and `friction (old)`.
- 🟩 The blind read of the built page gets every measure's count right.
- 🟧 Owner accepts it.
- 🟩 A copy of Keeper's project data read by 0.4.0: its workflow parses with owner friction defined,
  its work items keep their friction (7, 16, 8), its six experiments run on the same numbers, and every
  page renders it as friction (old).
- 🟧 Manual: the review server on the fixture, every page (started only when Owner asks).

## Estimates

- Steps 1-4 (core, judging, retro, page data): about 4-5 hours.
- Step 5 (mock, blind read, your decision): about 1 hour, plus 10 minutes of your time.
- Steps 6-7 (viewer, fixture): about 3 hours.
- Step 8 (finish): about 1.5 hours.
