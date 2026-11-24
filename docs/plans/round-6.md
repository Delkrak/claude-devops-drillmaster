# Plan: Drillmaster round 6 - custom measures

🟥 not built, already in an earlier version of this plan | 🟧 not built, new or changed since then | 🟩 built

## Context

Keeper's Owner asked (through Dispatcher) to split owner friction into policy friction and process
friction. The real request is that a project can define its own measures. Today a workflow can only use
five measures hardcoded in `server/src/core/measures.ts`. Four of them are counted automatically, and one
(owner friction) is judged by a separate friction judge and placed at a step by a second call.

Owner's decisions:
- 🟧 Custom measures are **judged only**: a name and a definition in words.
- 🟧 They are **judged in Drillmaster's post mortem** of each delivered work item. Each occurrence is
  assigned to a step and summed for the delivery. Drillmaster reads the item's whole trace.
- 🟧 They are **added at retrospectives**, with Owner's approval, like any workflow change.
- 🟧 **No re-judging of history.** A new measure counts from the next delivered item, and its first
  experiment waits for the baseline window (5 items).
- 🟧 **The four counted built-ins stay** (gate rejections, review rounds, minutes, tool calls). Owner
  friction leaves the code: the friction judge and the friction placement are removed.
- 🟧 **Each measure has a flag to show it on the pages**, so several measures can be shown to pinpoint
  issues.
- 🟧 **Existing projects keep friction as a custom measure.** A workflow that names
  `owner_friction_per_item` gets a custom measure of that name and definition on upgrade. Keeper
  changes nothing until a retrospective does.
- 🟧 **Old friction stays visible** as "friction (old)" at moments before the upgrade.

Defaults I chose (say if not):
- 🟧 A custom measure counts something that should not happen. Lower is better, and the target is 0.
- 🟧 Its name is plain words (e.g. "policy friction"), unique in the workflow, so the pages show it as
  it is.
- 🟧 Each occurrence names the trace events it is about, so the work item page can show what happened
  (e.g. Owner's prompt).
- 🟧 Not in this round: setup writing `.drillmaster` into the work folder (the worktree case). That is
  a separate small fix to do next.

## Build order

Each step ends in one local commit with typecheck and tests green. Nothing is pushed without Owner's OK.

### 0. 🟩 The plan in the repository
Add `docs/plans/round-6.md` and its row in `docs/plans/README.md`.

### 1. 🟧 Measures defined in the workflow (core)
- `core/workflow.ts`:
  - `WorkflowDocument.measures: [{ name, definition, show }]`, default `[]`.
  - `Objective.measures` and `WorkflowExperiment.measure` accept a counted built-in or a defined
    measure (a zod refinement on the document, not `z.enum`).
- `core/measures.ts`:
  - `COUNTED_MEASURES` holds the four built-ins.
  - `MeasureName` becomes `string`.
  - `ItemMeasures.values` becomes `Record<string, number | null>`; `null` means not judged.
  - The averages (`averageMeasure`, `measureBaseline`, `measureBaselineSd`, `splitMeasureByInput`)
    skip items without a value.
- `migrateWorkflow` (read-time only):
  - a workflow naming `owner_friction_per_item` in its objective or an experiment, without defining it,
    gets `{ name: 'owner_friction_per_item', definition: <today's text>, show: true }`;
  - `OLD_MEASURE_NAMES` keeps mapping `owner_corrections_per_item` to it.
- Tests in `test/unit/workflow.test.ts` and `measures` and experiment tests:
  - an undefined measure is refused;
  - a defined one is accepted;
  - an old workflow migrates.

### 2. 🟧 Drillmaster's post mortem judges the measures
- `core/retro.ts`:
  - `buildPostMortemPrompt` adds each defined measure's definition, with the JSON contract
    `"measured":[{"measure","step":"3.1"|null,"events":[ids],"why"}]`;
  - `readPostMortemAnswer` drops unknown measures and resolves the step the way
    `readFrictionPlacementAnswer` does (`stepGuidAt`).
- `core/events.ts`: `post_mortem_written` gets an optional `measured`. It is absent when Drillmaster
  could not judge, and `[]` when nothing happened.
- `core/measures.ts` `measureDeliveredItems`:
  - a defined measure's value is the count of its occurrences in the item's Drillmaster post mortem,
    or `null` when there is none;
  - for `owner_friction_per_item` on an item judged before the upgrade (no `measured`), the value is
    the old friction count, as recorded then.
- `app.ts`:
  - the friction judge and placement no longer run (`judgeFriction`, `placeFriction`,
    `placeUnplacedFriction` and their prompts go);
  - the retrospective now writes Drillmaster's post mortem for any delivered item that lacks one. That
    covers a gap: a restart during the background post mortem left none.
- Old `owner_inputs_judged` and `friction_placed` events stay in the event union, read-only and never
  written.
- Tests:
  - `test/api/friction.test.ts` is replaced by `test/api/measures.test.ts`:
    - the post mortem judges two measures;
    - occurrences are placed and summed;
    - a failed post mortem leaves the item unjudged and the retrospective retries it;
  - the scripted reviewer answers `measured`.

### 3. 🟧 Retrospectives and setup define measures
- `core/retro.ts`:
  - new ops `add_measure`, `change_measure`, `remove_measure`, approved by Owner like the others;
  - `change_measure` opens no rebaseline (no re-judging), and its experiments wait for new items;
  - the prompt lists the defined measures;
  - `set_objective` and experiments check names against the workflow.
- `app.ts`: the `workflow_retrospective` tool lists the counted and defined measures instead of a fixed
  enum.
- Skills:
  - `skills/setup/SKILL.md` lists the counted measures and how Owner words a judged one, e.g. policy
    friction and process friction with Owner's definitions;
  - `skills/concept/SKILL.md` and `skills/retrospective/SKILL.md` updated.
- Tests in `test/unit/retro.test.ts` and `test/api/retro.test.ts`.

### 4. 🟧 Page data (core)
- `workflowPage.ts`: per shown measure, occurrences per stage and step, with a `no step` bucket; old
  friction as its own series `friction (old)`.
- `workItemPage.ts`:
  - each step lists its occurrences: measure, why, and the events they name (Owner's prompt shown);
  - old step-ins stay as `friction (old)`;
  - the work items list counts each shown measure.
- `drillmasterPage.ts`: occurrences with no step become complaints "no step covers it", next to the
  old step-ins.
- `changesPage.ts` and the viewer header: a custom measure is shown by its name. "Lower is better"
  stays, because every measure is.
- Unit tests for each view, with inline events.

### 5. 🟧 Mock: several measures on the line (new layout)
- Today one orange ring per stage means friction, and orange means nothing else (DESIGN.md).
- The mock, drawn from the fixture, shows two or three measures on the Workflow page and the work item
  page: a mark per measure next to the line, each measure told apart, plus `friction (old)`.
- One blind read, then Owner decides. The decision is recorded in `docs/design/` and DESIGN.md (the
  One Alarm Rule rewritten).

### 6. 🟧 Build the viewer
- Rings, key, tips, pickers, the items list, step detail and the complaints page, drawn per shown
  measure (`ui/workflow/marks.tsx`, `Key.tsx`, `views/workflow/*`, `views/item/*`,
  `ui/item/List.tsx`).
- Playwright `viewer.spec.ts` updated; `@screens` saves the new screens.
- Then a blind read of the built page, and Owner's review.

### 7. 🟧 Fixture data
- `test/viewer/fixtures/reviewed-run.json` gets two defined measures (policy friction, process friction)
  in its workflow.
- A script `test/viewer/fixtures/judge-measures.ts`, like `place-friction.ts`, writes `measured` into
  Drillmaster's post mortems for items after a chosen moment with the Claude reviewer. That is about 8
  calls, roughly $2-4. The items before that moment keep their old friction, so both show.

### 8. 🟧 Finish
- `/code-review` on the round's diff, with its findings fixed.
- A clean-code pass.
- README, DESIGN.md and PRODUCT.md updated.
- Version 0.4.0, because the workflow schema changes. A project pinned to 0.3.x keeps running 0.3.x
  until `drillmaster upgrade`.
- Bundle rebuilt (`npm run bundle`).
- Local CI on Windows and Linux in Docker.
- The plans marked built.

## Verification

- 🟧 Unit and API tests:
  - a project defines two measures;
  - a delivered item's post mortem judges them per step;
  - the experiment on one uses only items judged after it was defined;
  - Keeper-like old events still give `owner_friction_per_item` the same values as before.
- 🟧 The marketplace install test passes on 0.4.0.
- 🟧 Playwright: the Workflow and work item pages show two measures and `friction (old)`. The changes
  page names a custom measure.
- 🟧 The blind read of the built page gets every measure's count right, and Owner accepts it.
- 🟧 Manual: run the review server on the fixture and check every page. Then upgrade a copy of
  Keeper's project data and check that its pages and running experiment still read.

## Estimates

- Steps 1-4 (core, judging, retro, page data): about 4-5 hours.
- Step 5 (mock, blind read, your decision): about 1 hour, plus 10 minutes of your time.
- Steps 6-7 (viewer, fixture): about 3 hours.
- Step 8 (finish): about 1.5 hours.
