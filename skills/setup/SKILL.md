---
name: setup
description: Sets up Drillmaster for a project - Owner states the objective and picks its measures, and Drillmaster creates the first workflow, which holds only that objective. Use when Owner wants Drillmaster to run their project, or asks to set it up. Runs once per project.
---

# Setting up Drillmaster

The first workflow holds only Owner's objective: no work stages, work policies or workflow
experiments yet. Agent does its best, Owner steps in where needed, and the workflow grows from that
at each workflow retrospective. Nothing is copied from another workflow.

## Steps

1. **Ask Owner for the objective.** It's what Owner wants Drillmaster to achieve with the workflow,
   in one sentence, for example "ship features without Owner stepping in". Use Owner's own words.
2. **Ask Owner to pick its measures.** A measure counts something that should not happen, per
   delivered work item, so lower is better. Suggest one or two that fit the objective, and let Owner
   choose. Drillmaster counts these itself:

   | Measure | What it counts |
   |---|---|
   | `gate_rejections_per_item` | Work gate rejections per work item |
   | `review_rounds_per_item` | Drillmaster and Owner gate hand-ins per work item |
   | `minutes_per_item` | Minutes from start to delivery |
   | `tool_calls_per_item` | Tool calls per work item |

   Owner can also define a measure in words, which Drillmaster judges in its post mortem of each
   delivered work item: a name in plain words, a definition of what counts as one occurrence, and
   whether the viewer shows where it happened. For example:
   - **policy friction:** Owner caught what a rule should have caught.
   - **process friction:** Owner overruled an earlier decision, or the delivery was not what Owner
     wanted. Back-and-forth while refining the work doesn't count.

   Use Owner's own words for the definition.

3. **Ask Owner for the Drillmaster repository:** a separate, private git repository (a URL or a
   path) that keeps everything of Drillmaster for this project: the workflow and its history, the
   Drillmaster version the project runs on, and every work item's traces. Its main branch is the
   source of truth. Traces can hold tool output, so it must be private. Drillmaster pushes to it, so
   Owner's git credentials must allow that. One repository can hold several projects, each in its
   own folder; the folder defaults to this work folder's name.
4. **Create the first workflow:**
   `workflow_retrospective({action: "setup", objective: "<Owner's words>", measures: [<the names>], define_measures: [{name, definition, show}], drillmaster_repository: "<the repository>", folder: "<optional>"})`.
   - `define_measures` holds the measures Owner defined in words; leave it out when Owner picked
     only counted ones.
   - Drillmaster pushes the pin and workflow `0.0.0` to the repository's main first, then writes
     `.drillmaster` in the work folder: the repository and the folder, nothing else. Commit it with
     the project; it's how Drillmaster knows this folder, on any machine.
   - If the push fails, tell Owner what git said, and ask for another repository or for access.
   - If the project already has a workflow, say so and stop. The objective changes only at a
     workflow retrospective (`/devops-drillmaster:retrospective`).
5. **Tell Owner how it goes from here,** in a few lines:
   - Give me issues as usual. I start each one with Drillmaster (`work_start`) and report as I
     go, and every action I take is recorded.
   - Step in whenever I get something wrong. Where you have to step in is what the workflow is
     built from.
   - Call `/devops-drillmaster:retrospective` when you want the workflow to improve.
