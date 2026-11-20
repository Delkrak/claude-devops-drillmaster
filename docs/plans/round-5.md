# Plan: Drillmaster round 5 - a viewer built from stories, checked by blind agents

🟥 not built, already in an earlier version of this plan | 🟧 not built, new or changed since then | 🟩 built

## Context

Owner started reviewing round 4 and was overloaded: the viewer shows everything at once, worded for
an AI. So the viewer is rebuilt from the top, one story at a time: something Owner comes to do. Each
story is shaped with Owner as a mock drawn from a real recorded run, read by blind agents before
Owner sees it, and then built into the viewer before the next story starts. Owner then reviews
round 4 through the new viewer; the open feedback items come in a later plan.

On approval this plan is saved as `docs/plans/round-5.md` (step 0), with its row in
`docs/plans/README.md`. Owner's choices for this version of the plan: keep accepted mocks in
`docs/design/`; write DESIGN.md now as a seed; commit the new run as a test fixture; build one story
at a time.

## Done so far

- 🟩 **PRODUCT.md** (`impeccable init`): Owner, the CEO, as the user.
- 🟩 **The Workflow story is designed**: the accepted mock goes to `docs/design/workflow.html` in
  step 2, with its decisions in DESIGN.md and the Workflow surface brief.
- 🟩 **A run with peer review**: scenario `server/test/sim/scenarios/pipeline-reviewed.json` (step 4.4
  reviewed by Drillmaster), recorded with the LLM Owner: 8 of 8 delivered, 8 reviews, 3 inputs judged
  friction; cost $98.91. It becomes the fixture `server/test/viewer/fixtures/reviewed-run.json`.
- 🟩 **The mock's moment**: 2026-11-20T19:10:16.785Z, workflow 2.1.0: #5 waiting at Drillmaster's
  review 4.4, 4 delivered, Owner stepped in 2 times after delivery.

## The stories

| Story | Owner comes to... | Status |
|---|---|---|
| 🟩 Workflow (replaces "Is it working?" and "What does Agent do?") | see the pipeline, where the work items are, and where the friction is | designed |
| 🟥 What happened to #N? | understand one piece of work: its steps, the ones it skipped and why, where Owner stepped in | to shape |
| 🟥 Did the change help? | judge the last retrospective: what it changed, and whether that worked | to shape |
| 🟥 What's wrong in Drillmaster? | see what to fix in Drillmaster: the complaint heard most | to shape |

## How a story is shaped and built

1. 🟧 **Ask Owner first**: what the story is for, what the first screen answers, what follows, how
   much detail. Challenge the idea before drawing.
2. 🟧 **A mock from real data**: drawn from the fixture at a moment, never hand-placed.
3. 🟧 **Blind agents before Owner**, fresh, screenshots only: first look (glances in order, what pulls
   attention without mattering), symbols only (the mock as a wireframe), and the story's question
   marked SURE or GUESS. Two options get one agent each.
4. 🟧 **Owner decides**, with steps to follow and the agents' answers side by side.
5. 🟧 **Record it**: the accepted mock in `docs/design/`, its surface brief, DESIGN.md updated.
6. 🟧 **Build it** into the viewer, test it, run the same blind tests on the built page, and give it to
   Owner before the next story starts.

## Build order

Each step ends in one local commit with typecheck and tests green. Nothing is pushed without Owner's
OK.

### 0. 🟩 The plan in the repository (d057677)
`docs/plans/round-5.md` (this plan, without the done-so-far detail) and its row in
`docs/plans/README.md`.

### 1. 🟩 Impeccable `init` (PRODUCT.md)

### 2. 🟩 Record what is settled (80de8cf)
- **The run as a fixture**: `server/test/viewer/fixtures/reviewed-run.json`, copied from the run's
  `events.json` and scrubbed: the project path under `C:\Users\...` replaced by a neutral path (as
  `sim-run.json` does), trace `raw` fields removed. Check: no user name or home path left in it.
- **The scenario**: `server/test/sim/scenarios/pipeline-reviewed.json` committed as it is.
- **The accepted mock**: `docs/design/workflow.html`, a self-contained copy of `workflow-pass-a.html`
  with the moment's data inlined; `docs/design/README.md` says what each file is, the moment it
  shows, and that the build must match it.
- **DESIGN.md (seed)** at the repo root, Impeccable's seed form (`reference/document.md`): the SEED
  comment; frontmatter with `name` and `description`; `## Overview` (Creative North Star, key
  characteristics), `## Colors` (ground, line, dim, sand for Owner's approval, orange for friction
  only), `## Typography` (Barlow; stencil for the brand only), `## Layout` (one centred line, work
  items left, problems right, overview first, plain scrolling), `## Shapes` (the four stops, item
  boxes, rings), `## Do's and Don'ts` (the decisions Owner made, e.g. no zoom or snapping, no status
  line yet, no text where a symbol will do). Components left out until code exists.
- **The Workflow surface brief** via `impeccable surface-brief write
  server/viewer/src/views/WorkflowPage.tsx <body>` into `.impeccable/surfaces/`: scope, mode Operate,
  audience and job, constraints, and the `## Direction contract` with THESIS, OWN-WORLD, STORY,
  FIRST VIEWPORT, FORM (`seed: none (pinned)` with Owner's words: "smooth technical, but with hints
  of military"; "the overview is presented first, then i can drill in") and FINISH (verbatim). Read
  back to check all six blocks. The seed key under `.impeccable/questions/` stays uncommitted.
- **PRODUCT.md** committed.

### 3. 🟩 Build the Workflow view (d355990..17d7a3c)
- 🟩 **3a. Core** (d355990): `server/src/core/workflowPage.ts`, `workflowPageView(events, at?)`, pure:
  - fold the events with `at <= T` using `foldState` (`core/state.ts`); the workflow at T;
  - stages and steps with `n`, `guid`, `name`, `gate`, `if`, and `alternative {input, value}` when
    the condition is one `==` comparison (the viewer pairs alternatives into splits);
  - where each active item stands: a new pure `firstApplyingPosition(workflow, from, inputs)` in
    `core/work.ts`, using `applicabilityOf` and `nextPosition`, so an item about to skip a step is
    shown at the step it will take (the skip event lands 1 ms after the verdict); items on an older
    version mapped by step GUID (`stepGuidAt`, `refOfGuid`);
  - per step: items here now; Drillmaster reviews passed and sent back, counted by `step_guid`;
  - delivered count, items waiting to be delivered;
  - friction with the measure's definition (`ownerInputsOf`, `isFriction`,
    `frictionJudgementsOf` in `core/ownerInputs.ts`, plus Owner gates sent back as in
    `core/measures.ts`): per stage (a new `stage` on `OwnerInput`, from its trace), after delivery,
    and unplaced, so the counts add up.
  - Unit tests `server/test/unit/workflow-page.test.ts`: inline events for each rule above, and the
    fixture at the moment: version 2.1.0, #5 at 4.4, 4 delivered, 2 after delivery, 4.4 reviews
    passed 4 and sent back 0; with no `at`: 3.0.0, 5 stages, 8 delivered.
- 🟩 **3b. API** (6973795): `GET /api/projects/:id/workflow?at=ISO` in `server/src/daemon/http.ts` (400 on a bad
  `at`, 404 for another project), `app.workflowPage(projectId, at?)` in `server/src/app.ts`; tests in
  `server/test/api/viewer-api.test.ts`.
- 🟩 **3c. The page, and the old viewer removed** (e1c8dc2):
  - route `#/p/:id/workflow[?at=]` in `viewer/src/router.ts`, the project link pointing to it,
    polling every 4 s only without `at`; `api.workflow` and the `WorkflowPage` type;
  - drawing parts in `viewer/src/ui/workflow/` (Stop, ItemBox, Ring, ReviewMarks, Key, Tip, Shell,
    geometry ported from the mock's generator) and `views/WorkflowPage.tsx` with Overview,
    StageWalk and PipelineEnd; colours only through `styles/tokens.stylex.ts`;
  - tokens replaced by the design's colours; Barlow and the stencil face bundled as woff2 (no
    network fonts);
  - every old view and unused UI part deleted; `HomePage`, `Loading`, `Empty` kept; server
    endpoints kept for the next stories;
  - `server/test/viewer/global-setup.ts` loads `reviewed-run.json` (replacing `sim-run.json`);
    `viewer.spec.ts` rewritten: the landing shows the overview with the walkthrough below the fold;
    at the moment, box 1 at the review stop with #5 in its tooltip, delivered 4, ring 2; hover
    shows explanations; the demo project's sent-back and Owner-gate cases.
  - Defaults where the old code and the design disagree (say if not): dark only (the light theme and
    its test go); no refresh bar and no tabs; the drawing scales to the window instead of a fixed
    900 px.
- 🟩 **3d. Screenshot check**: a `@screens` Playwright spec at 1440x900, the fixed moment, fonts loaded,
  saving the overview and a full-page shot to the git-ignored `test-results/`; the blind agents'
  questions committed next to it as a prompt file.
- 🟩 **Then** (d5c0f9f, 8bd9e8d): a blind agent read the built page and got every fact right;
  `impeccable critique` scored it 22/40. Fixed: friction with no known stage drawn, a failed refresh
  keeps the page, opens at the top, the key names reviews passed and sent back, the tab icon not
  orange. Owner's answers built: overview rows jump to their stage, a past moment names itself,
  conditions in plain words, keyboard and touch reach every explanation.
- 🟩 **Owner reviewed the built page**: "looks good".

### 4. 🟩 "What happened to #N?" shaped and built
Owner's answers: Owner opens #N when something went wrong, to check one in flight, and to study a
finished one at a retrospective. The first screen is its route. Owner reaches it from the Workflow
page, by typing #N, and from a list. Every detail is there, revealed one level at a time.
- 🟩 **Mock** `.impeccable/mocks/work-item.html`, drawn from the fixture, two moments: #2 (a bug,
  delivered, Owner stepped in after delivery) and #5 in flight at the Workflow mock's moment.
  - First screen: the same line as the Workflow page with only #N's path lit: steps it passed
    bright, steps it skipped faded with why, steps still ahead dim, where it is now, and where Owner
    stepped in. Its issue, kind and status above the line.
  - Drilling in, one level per click on a step: what happened (Agent's reports, the gate's
    verdict and who gave it, a skip and why, Owner's input), then the evidence (what the tool
    captures kept), then every tool call at that step.
  - Ways in: on the Workflow page a box or ring opens the item, or a short list when it holds
    several; `#` search in the header; a "Work items" list, latest first.
- 🟩 **Blind agent** before Owner saw it: every fact right. Fixed from it: who checked a rule, test
  output in plain words and once, "in progress at" in the header, the check beside its stop, a key
  with only the marks on the page.
- 🟩 **Owner decided**: the stop shapes stay as on the Workflow page (one language); a step-in is
  pinned to the step that should have caught it.
- 🟩 **Step-ins placed** (ecd4ed7): the friction judge stays blind to the workflow; Drillmaster places
  each input judged friction in a call of its own (`friction_placed`). The fixture's three step-ins
  placed with the Claude reviewer by `test/viewer/fixtures/place-friction.ts`.
- 🟩 **The mock pins step-ins** at their step; a step-in with no step stays where it happened.
- 🟩 **Recorded** (acb8d93): `docs/design/work-item.html` and its surface brief.
- 🟩 **Built** (ef520d4, 38c3c05):
  - core `workItemPageView` and `workItemsListView`, served at
    `GET /api/projects/:id/work-items[/:workItemId][?at=]`;
  - the work item page, the work items list, the header's find box, and the Workflow page's boxes
    and rings as doors;
  - 183 unit, 76 API and 18 browser tests green; `@screens` saves the item page's screens.
- 🟩 **Blind read of the built page**: every fact right.
- 🟩 **Owner reviewed it**: no one-line summary under the header (the route shows it); the list
  says what each work item is about.

### 5. 🟧 "Did the change help?" shaped and built
Owner's pace from here: ask Owner first, then build, with one blind read of the built page; a
separate mock round only when the layout is new.
### 6. 🟧 "What's wrong in Drillmaster?" shaped and built, the same way
A story that needs data the fixture lacks gets a new run only with Owner's OK, given the cost.

### 7. 🟥 Agent review
`/code-review` on the round's diff, with its findings fixed.

### 8. 🟥 Owner's review
Owner walks the stories in the new viewer; then the round-4 review goes on through it.

### 9. 🟥 Finish
DESIGN.md rewritten from the built viewer (`impeccable document`, with tokens and
`.impeccable/design.json`); a clean-code pass; local CI on Windows and on Linux in Docker; docs; the
plans marked built.

## Verification

- 🟧 Each story's mock passes its blind tests before Owner sees it, and Owner accepts it.
- 🟧 Each built view: unit, API and Playwright tests green; its blind tests on the built page match
  the mock's; Owner accepts it.
- 🟧 The fixture holds no user name or home path.
- 🟥 Local CI on Windows and on Linux in Docker.
