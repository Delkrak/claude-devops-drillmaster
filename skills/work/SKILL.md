---
name: work
description: How Agent runs a work item in a Drillmaster project with the drillmaster tools - start it, follow the workflow step by step, report in real time, hand in every work gate, deliver, and write the workflow post mortem. Use whenever Owner hands you an issue or any piece of work in a project where Drillmaster runs (the session brief says so).
---

# Running a work item

The concept behind every term here is in `/devops-drillmaster:concept`. This skill covers only the
tools.

Every action you take is already recorded in the work traces. The tools are for what only you can
say: your work reports.

## 1. Start

Call `work_report` with `{action: "start", issue}` before you touch anything.

- Keep the `agent_token` it returns. Every later call needs it, for the whole work item.
- The answer gives your first work stage and work step.
- If both are `null`, the workflow has no work stages yet. Do your best, deliver, and expect Owner
  to correct you. That is how the workflow grows.

## 2. Each work step

1. Read the work stage with `workflow_get({stage})`: its work steps, each step's work gate, the full
   text of the rules the gate references, and what the step requires you to report.
2. Do the work of the current work step only. Work steps are carried out in order.
3. Report in real time with `work_report({token, action: "report", kind, text})`, the moment it
   happens:
   - `impediment`: anything that slowed the work down or was missing;
   - `better_way`: a way to use fewer tokens, or to get better structure;
   - `decision`: add `chosen`, `by` and `why`;
   - `question`: add `asked` and `answer`, once Drillmaster or Owner has answered;
   - `assumption`: anything you took as true without being told;
   - `required`: anything the work step asks you to report;
   - `added_step`: only after delivery (see below).
4. Hand in the gate with `work_report({token, action: "gate", stage, step, self_check, text})`:
   - `self_check` holds exactly one `{rule, accepted, evidence}` per referenced rule. The evidence is
     what you actually checked, not a promise.
   - `text` is what the work step requires reporting.

## 3. Verdicts

| Verdict | What you do |
|---|---|
| `accepted` | Go to `next`. When `done` is true, every work gate has passed. |
| `rejected` | Go back to `next`, where the verdict sends you. Report the impediment, fix it, and hand the gate in again. |
| `pending` | A Drillmaster gate or an Owner gate is waiting. At an Owner gate, ask Owner to approve, in plain words, with what they need to judge. Check `work_status` for the verdict. |

## 4. Deliver and look back

1. Once every work gate has passed, or there are none, call
   `work_report({token, action: "deliver", pr})`.
2. Then write your workflow post mortem on the work item as a whole:
   `work_report({token, action: "post_mortem", keep, change, experiment_reflections, free_text})`.
   It's about the workflow, not the code: what to keep, what to change, how the running workflow
   experiments did, and anything else.

## When Owner corrects delivered work

Ask Owner first, in one line: **"Fix it now, or create a separate issue?"**

- **Fix now:**
  1. Make the fix.
  2. Report it as an added step:
     `work_report({token, action: "report", kind: "added_step", text: "<what you did>", why: "<Owner's correction>"})`.

  The work item stays delivered. Owner's correction and the added step are recorded against it, so
  every added step can be found later, and that is how the workflow learns what was missing.
- **Separate issue:** don't touch the code now. Write the issue down for Owner: its title and what
  it must do. It becomes its own work item when Owner hands it to you.

## When you're lost

`work_status({token})` shows where the work item is, any pending gate, and the last verdict.

- Add `last: n` for your last work reports.
- Add `stage` and `step` for everything captured at that work step.
