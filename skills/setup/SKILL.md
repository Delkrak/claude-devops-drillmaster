---
name: setup
description: Sets up Drillmaster for a project - Owner states the objective and picks its measures, and Drillmaster creates the first workflow, which holds only that objective. Use when Owner wants Drillmaster to run their project, or asks to set it up. Runs once per project.
---

# Setting up Drillmaster

The first workflow holds only Owner's objective: no work stages, work policies or workflow
experiments yet. Agent does its best, Owner corrects it, and the workflow grows from those
corrections at each workflow retrospective. Nothing is copied from another workflow.

## Steps

1. **Ask Owner for the objective.** It's what Owner wants Drillmaster to achieve with the workflow,
   in one sentence, for example "ship features without Owner stepping in". Use Owner's own words.
2. **Ask Owner to pick its measures.** These are the ones Drillmaster can compute today. Suggest one
   that fits the objective, and let Owner choose:

   | Measure | What it counts |
   |---|---|
   | `owner_corrections_per_item` | Owner's prompts during a work item that were not approvals |
   | `gate_rejections_per_item` | Work gate rejections per work item |
   | `review_rounds_per_item` | Drillmaster and Owner gate hand-ins per work item |
   | `minutes_per_item` | Minutes from start to delivery |
   | `tool_calls_per_item` | Tool calls per work item |

3. **Create the first workflow:**
   `workflow_retrospective({action: "setup", objective: "<Owner's words>", measures: [...]})`.
   - If the project already has a workflow, say so and stop. The objective changes only at a
     workflow retrospective (`/devops-drillmaster:retrospective`).
4. **Tell Owner how it goes from here,** in a few lines:
   - Give me issues as usual. I start each one with Drillmaster and report as I go, and every
     action I take is recorded.
   - Correct me whenever I get something wrong. Your corrections are what the workflow is built
     from.
   - Call `/devops-drillmaster:retrospective` when you want the workflow to improve.
