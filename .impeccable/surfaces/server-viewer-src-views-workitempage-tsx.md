---
version: 1
slug: "server-viewer-src-views-workitempage-tsx"
primary_target: "server/viewer/src/views/WorkItemPage.tsx"
related_targets: ["docs/design/work-item.html"]
---

# What happened to #N?

**Scope:** the viewer's work item page, `#/p/:id/items/:issue`, reached from the Workflow page (a
work-item box or ring), by typing the number in the header's find box, and from the work items list.
**Mode:** Operate.

**Audience and job:** Owner, the CEO, opens one work item when something went wrong, to check one in
flight, and to study a finished one at a retrospective. The job: see its route through the workflow,
where it is, what it skipped and why, and where Owner had to step in; then drill in, one level at a
time.

**Content:** the work item at a moment (now, or `?at=`) on the workflow version it ran on: steps
passed, skipped (with the condition in plain words), here now, and still ahead; Drillmaster's
reviews; step-ins pinned at the step Drillmaster placed them, or where they happened when no step
covers them. Drilling into a step: what happened (the step-in, who passed it, Agent's reports), then
the evidence (the rules Agent checked, the output the tool kept), then every tool call.

**Constraints:** Owner is easily overloaded: the route first, text only when Owner drills in. The
Workflow page's shapes, colours and key, so both pages speak one language; the key lists only the
marks on the page. The accepted mock is `docs/design/work-item.html`; the build matches it.

**Chosen direction and memorable moment:** the route card for one item: the Workflow line, lit
where #N went, faded where it skipped, with the orange ring on the step that let Owner's step-in
through.

**Unresolved:** the work items list is not mocked yet; it follows the find box and the Workflow
page's doors.

## Direction contract

THESIS: One work item is one route along the workflow's line, lit where it went; detail unfolds
under a step only when Owner asks. It refuses the event log and the timeline table.

OWN-WORLD: As the Workflow page: olive-black ground, bone line work, dim for what is ahead, faded
for what was skipped, safety orange only for friction, sand for Owner's approvals and for what is
waiting; Barlow, stencil only in the brand; flat.

STORY: Owner sees in one look where #N went and where it needed them, believes it because each mark
opens onto what happened and its proof, and learns which step let the step-in through.

FIRST VIEWPORT: The issue, its kind and its state above the line; the whole route below it, one row
per step, splits as on the Workflow page; the orange ring beside the step that should have caught
the step-in; the key in the corner.

FORM: seed: none (pinned). Owner's words: "Its route"; "3, but not all at once, you can drill down
step by step"; the stop shapes stay as on the Workflow page.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
verdict, DESIGN.md, and every shipping raster carrying its provenance
