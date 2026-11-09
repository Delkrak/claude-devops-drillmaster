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
   - every proposal, numbered, with its change, its purpose, the measure it must not worsen, and in
     a line or two what it does to the workflow;
   - any dropped proposals, and why they were dropped.
3. **Ask Owner to decide,** in plain words, for example "approve 1 and 3", "yes" for all, "approve
   1, not 2", or "no". Owner's own reply is what approves a proposal. Your words can't.
4. **Apply each approved proposal:** `workflow_retrospective({action: "apply", proposal: n})`.
   - The server refuses anything Owner hasn't approved. When it refuses, tell Owner. Don't try to
     get around it.
5. **Report back:**
   - the new workflow version;
   - each workflow experiment opened, with its measure and baseline;
   - which proposals were declined.

   Then summarize the workflow with `workflow_get({})`.
