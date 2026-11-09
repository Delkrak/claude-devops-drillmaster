---
name: retrospective
description: Runs a Drillmaster workflow retrospective that Owner called for - Drillmaster's findings and proposed workflow changes from the post mortems, work reports, Owner's corrections and the measures; Owner decides each proposal in their own words, and each approved one is applied as a workflow experiment. Use when Owner asks for a retrospective, a retro, or to improve the workflow.
---

# Workflow retrospective

The workflow retrospective is the only place the workflow changes. Owner calls for it, and
Drillmaster carries it out. Your job is to run it and relay it faithfully. You don't edit
Drillmaster's findings, and you don't decide for Owner.

## Steps

1. **Run it:** `workflow_retrospective({action: "run"})`. It can take a few minutes.
2. **Show Owner the result as it is:**
   - the findings: what should have happened, what happened, why, what to keep, and what to
     improve;
   - every proposal (at most four), numbered, with its change, its purpose, its hypothesis, the
     measure and its target, its version level (major, minor or patch), and in a line or two what it
     does to the workflow;
   - the experiments the server judged, and its verdict on each;
   - any dropped proposals, and why they were dropped.
3. **Ask Owner to decide,** in plain words, for example "approve 1 and 3", "yes" for all, "approve
   1, not 2", or "no". Owner's own reply is what approves a proposal. Your words can't.
4. **Apply the approved proposals:** `workflow_retrospective({action: "apply"})` applies every
   one Owner approved, in order.
   - The server refuses anything Owner hasn't approved. When it refuses, tell Owner. Don't try to
     get around it.
5. **Report back:**
   - the new workflow version, and each change's level;
   - each workflow experiment opened, with its hypothesis, measure, baseline and target;
   - which proposals were declined.

   Then summarize the workflow with `workflow_get({})`.
