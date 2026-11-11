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
the rules the gate checks and how each is verified, what to report, the work item inputs to set,
and the `work_gate` call to fill in. Follow that answer. You rarely need `workflow_get`.

## 1. Start

Call `work_start({issue, description, stages, inputs})` before you touch anything.

- `description` says what the work item is about: the problem, and the result Owner expects.
- `inputs` are the work item inputs that are yours to set at start, such as whether it is a bug or
  a feature: one of each input's options. `workflow_get` lists them; work can't start without
  them.
- `stages` are the work stages Owner asked this session to do, by number (`["1"]`). Owner names
  them in their own words ("capture it", "build and test it"); `workflow_get` lists the stages by
  name. Leave `stages` out only when Owner asks for the whole work item at once.
- Keep the `agent_token` it returns. Every later work tool needs it, for this session.
- **A later session** goes on with an open work item through
  `work_resume({issue, stages})`. It gives a new token (the earlier one stops working) and the step
  to do. If that step allows an update and the workflow changed, the work item updates first.
- When the stages of this session are done, the result says so: stop, and tell Owner where the work
  item is. Don't go on into the next stage.
- If the workflow has no work stages yet, do your best, deliver, and expect Owner to correct you.
  That is how the workflow grows.
- Every work item starts at the first work step that applies to it. There is no starting later:
  the process is the path, and every step is recorded.
- **Steps that apply only to some work items.** A stage or step with an `if` (for example
  `kind == 'bug'`) applies only to work items whose inputs meet it. Drillmaster skips the others
  for you, saying why, and the result lists them. A step whose `if` reads an input that isn't set
  yet waits for it: `work_status` shows who sets it.
- **An input turns out wrong** (the "feature" is a bug): change it with
  `work_input({token, name, value, why})`, if it is yours to set. When the change makes a skipped
  step apply, the work item goes back to it; the steps before it that were done stay done.

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
3. **Or skip the step**, when its result says it is skippable and this work item doesn't need it
   (for example no production test for a docs change): `work_skip({token, step, why})`. Only the
   step you are at can be skipped. The step says who decides: you (skipped at once), Drillmaster,
   or Owner (ask with the AskUserQuestion input the result gives). If the skip is rejected, do the
   step.
4. **Hand in the gate** with `work_gate({token, step, self_check, text, inputs})` (step as in "1.2"),
   filled in from the step's answer:
   - `self_check` holds exactly one `{rule, accepted, evidence}` per rule the gate checks. The
     evidence is what you actually checked, such as a command and its output, not a promise.
   - `text` is what the work step requires reporting.
   - `inputs` sets each work item input that is yours to set at the step: one of its options, and
     why.

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
- Owner either approves or not. Approve with nothing added approves; a note, or an answer Owner
  typed, rejects, with Owner's words as the reason. Drillmaster records it and tells you the outcome
  and what comes next.
- An input needs one of its options. If Owner types something else, it stays open: ask again.
- Owner's chat messages are instructions, never decisions. If one sounds like a decision ("looks
  good", "approve 1"), ask Owner the pending question in AskUserQuestion. When in doubt, ask.
- `work_status` shows any question still waiting for Owner (`ask_owner`).

## 4. Deliver and look back

1. Once every work gate has passed, or there are none, call
   `work_deliver({token, pr, summary, artifacts})`:
   - `summary`: what was delivered, and how it was verified;
   - `artifacts`: files in the work folder that show the result, such as screenshots. They must be
     images or text, at most 5 MB each, and not ignored by git.
2. Then write your workflow post mortem on the work item as a whole with
   `work_post_mortem({token, keep, change, experiment_reflections})`. It's about the workflow, not
   the code: lists of what to keep, what to change, and how each running workflow experiment did.
   Each keep and change entry names what it is about in `refs`: `step 1.2`, `stage 1`,
   `rule pr 1.1`, `policy pr`, `input kind`, or `tool work_deliver` when it is about
   Drillmaster itself. Leave `refs` empty for the workflow as a whole.
3. If the result says a workflow retrospective is due, tell Owner and suggest
   `/devops-drillmaster:retrospective`. Owner decides when.

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

## When the workflow changes under you

A retrospective can change the workflow while a work item is open. The work item stays on its own
version until it reaches a step that allows an update. Then it moves to the latest version, keeps
the steps it did that are unchanged, and resumes at the first step that changed or is still to do,
which can be an earlier one. The result says what changed and shows that step in full. Do it.

## When you're lost

`work_status({token})` shows where the work item is, any pending gate, and the last verdict.

- Add `last: n` for your last work reports.
- Add `step` (e.g. "1.2") or `stage` (e.g. "1") for everything captured there.
