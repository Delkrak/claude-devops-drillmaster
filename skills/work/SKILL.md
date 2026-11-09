---
name: work
description: How Agent runs a work item in a Drillmaster project with the drillmaster tools - start it, do each work step as its result describes, report in real time, hand in every work gate, deliver with a summary and artifacts, and write the workflow post mortem. Use whenever Owner hands you an issue or any piece of work in a project where Drillmaster runs (the session brief says so).
---

# Running a work item

The concept behind every term here is in `/devops-drillmaster:concept`. This skill covers only the
tools.

Every action you take is already recorded in the work traces. The tools are for what only you can
say: your work reports.

Every work tool answers with the next thing to do, in full: the work step's instruction, its gate,
the rules the gate checks and how each is verified, what to report, the metrics to take, and the
`work_gate` call to fill in. Follow that answer. You rarely need `workflow_get`.

## 1. Start

Call `work_start({issue, description})` before you touch anything.

- `description` says what the work item is about: the problem, and the result Owner expects.
- Keep the `agent_token` it returns. Every later work tool needs it, for the whole work item.
- If the workflow has no work stages yet, do your best, deliver, and expect Owner to correct you.
  That is how the workflow grows.

## 2. Each work step

1. **Do the work the step's instruction gives**, and only that step's. Work steps are carried out in
   order.
2. **Report in real time** with `work_report({token, kind, text})`, the moment it happens:
   - `impediment`: anything that slowed the work down or was missing;
   - `better_way`: a way to use fewer tokens, or to get better structure;
   - `decision`: add `chosen`, `by` and `why`;
   - `question`: add `asked` and `answer`, once Drillmaster or Owner has answered;
   - `assumption`: anything you took as true without being told;
   - `required`: anything the work step asks you to report;
   - `added_step`: only after delivery (see below).

   If the workflow is missing work you needed to do, that is an `impediment`: say what was missing.
3. **Hand in the gate** with `work_gate({token, stage, step, self_check, text, metrics})`, filled in
   from the step's answer:
   - `self_check` holds exactly one `{rule, accepted, evidence}` per rule the gate checks. The
     evidence is what you actually checked, such as a command and its output, not a promise.
   - `text` is what the work step requires reporting.
   - `metrics` answers each metric that is yours to take at the step: one of its categories, and why.

## 3. Verdicts

| Verdict | What you do |
|---|---|
| accepted | The answer shows the next work step. Do it. When every gate has passed, it says to deliver. |
| rejected | The answer cites the rule and shows the step the work goes back to. Report the impediment, fix it, and hand the gate in again. |
| pending | A Drillmaster gate or an Owner gate is waiting. At an Owner gate, the answer holds the AskUserQuestion input to ask Owner with (see below). |

## Asking Owner

When a result says **Ask Owner now**, call AskUserQuestion with exactly the input it gives: the
same questions, word for word, and no `answers`. Owner answers; you can't, and an answer you fill
in is refused. Ask from the main conversation, because subagents can't use AskUserQuestion.

- Before asking at an Owner gate, show Owner what they need to judge: the PR, what changed, and how
  it was verified.
- Drillmaster records Owner's choice, and any note or typed answer, and tells you the outcome and
  what comes next.
- If Owner's answer doesn't decide the question, Drillmaster says so: answer Owner, then ask the
  same question again.
- `work_status` shows any question still waiting for Owner (`ask_owner`).

## 4. Deliver and look back

1. Once every work gate has passed, or there are none, call
   `work_deliver({token, pr, summary, artifacts})`:
   - `summary`: what was delivered, and how it was verified;
   - `artifacts`: files in the work folder that show the result, such as screenshots. They must be
     images or text, at most 5 MB each, and not ignored by git.
2. Then write your workflow post mortem on the work item as a whole with
   `work_post_mortem({token, keep, change, experiment_reflections, free_text})`. It's about the
   workflow, not the code: what to keep, what to change, how the running workflow experiments did,
   and anything else.

## When Owner corrects delivered work

Ask Owner first, in one line: **"Fix it now, or create a separate issue?"**

- **Fix now:**
  1. Make the fix.
  2. Report it as an added step:
     `work_report({token, kind: "added_step", text: "<what you did>", why: "<Owner's correction>"})`.

  The work item stays delivered. Owner's correction and the added step are recorded against it, so
  every added step can be found later, and that is how the workflow learns what was missing.
- **Separate issue:** don't touch the code now. Write the issue down for Owner: its title and what
  it must do. It becomes its own work item when Owner hands it to you.

## When you're lost

`work_status({token})` shows where the work item is, any pending gate, and the last verdict.

- Add `last: n` for your last work reports.
- Add `stage` and `step` for everything captured at that work step.
