---
version: 1
slug: "server-viewer-src-views-workflowpage-tsx"
primary_target: "server/viewer/src/views/WorkflowPage.tsx"
related_targets: ["docs/design/workflow.html"]
---

# Workflow

**Scope:** the viewer's Workflow page, `#/p/:id/workflow`, the first page Owner lands on.
**Mode:** Operate.

**Audience and job:** Owner, the CEO, opens it after a work item, around a retrospective, or when
something feels off. The job: see the pipeline, where the work items are, and where the friction is,
then drill in.

**Content:** the workflow at a moment (now by default, or `?at=`): stages and steps with their gate
and condition, work items in progress at their step, delivered count, Drillmaster's reviews passed
and sent back, and friction per stage and after delivery. All from events, through
`workflowPageView`.

**Constraints:** Owner is easily overloaded: little text, symbols first, a key and hover
explanations. Look-only. The accepted mock is `docs/design/workflow.html`; the build matches it.

**Chosen direction and memorable moment:** the route card: one line through the work, the overview
first, and the detail sliding into frame as Owner scrolls.

**Unresolved:** real step and stage names replace the placeholder bars, kept short; recent
statistics per step come later.

## Direction contract

THESIS: The pipeline is one line Owner reads top to bottom; work items left, problems right. It
refuses the dashboard of cards, tabs and tables.

OWN-WORLD: Olive-black ground, bone line work, safety orange only for friction, sand for Owner's
approvals; Barlow, stencil only in the brand; flat, no shadows.

STORY: Owner understands where work is and where it needed them, believes the counts because they
come from the run, and drills into the stage that matters.

FIRST VIEWPORT: The overview alone, centred: one row per stage on the line, the work-item box
beside its stage, delivered at the end bar, the orange ring after delivery; the key small in the
corner. The detail starts below the fold.

FORM: seed: none (pinned). Owner's words: "smooth technical, but with hints of military"; "i still
like that the overview is presented first, then i can drill in".

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
verdict, DESIGN.md, and every shipping raster carrying its provenance
