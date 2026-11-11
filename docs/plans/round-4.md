# Plan: Drillmaster round 4 - what the round-3 feedback decided

🟥 not built, already in an earlier version of this plan | 🟧 not built, new since then | 🟩 built

## Context

Round 3 is built and committed locally on `phase-1-test-bed` (d733b35..42d2693, not pushed). Its
four simulation runs left 46 post mortems and 10 retrospectives. Going through them with Owner,
and through Owner's own review, produced the decisions below. On approval this plan is saved as
`docs/plans/round-4.md` (step 0), with its row in `docs/plans/README.md`.

Owner's three points:
1. Go through the feedback (done in this planning; the decisions are below).
2. There is no capture -> refine -> build -> test workflow with steps of their own for bugs and
   for features. It is built as a simulation scenario, and run in this round.
3. Skipping should also follow from a work item's inputs, with the flexibility of pipeline YAML
   files (an `if` on a stage or step).

Owner's review of the viewer: it repeats the JSON structure, shows everything at once, tells no
story, and is worded for an AI, not for a person. It gets redesigned in a later round, since Owner
wants the user interface changes later.

## Decisions

**Work item inputs, and conditions (pipeline style):**
- 🟥 The workflow's `metrics` become `inputs`, in the same stored shape:
  `{guid, name, options: [{value, description}], set_at: "start" | "<step>", by, instruction}`.
  `set_at: "start"` means it is given in `work_start`; a step means it is set at that step's
  gate, as metrics are today. Measures are still split by inputs.
- 🟧 Each input's `by` says who sets it (agent, drillmaster or owner), as metrics do today. Work
  can't proceed without it: `work_start` is refused while a `start` input is missing, and a gate
  is refused while an input set at its step is missing. The refusal names the input and its
  options. A retrospective can move `by` when picks go wrong.
- 🟥 A stage or a step may have `"if": "<expression>"`, for example `"kind == 'bug'"`, or
  `"kind == 'feature' || user_visible == 'yes'"`. Operators: `==`, `!=`, `in [...]`, `&&`, `||`,
  `!`, parentheses. A small parser of our own, with no `eval`.
- 🟧 Conditions name inputs as they are (`kind`, not `inputs.kind` or `${{ }}`). The operators are
  those of GitHub's expressions.
- 🟥 A workflow is refused when an `if` reads an input that's unknown, compares it with a value
  that isn't one of its options, or reads it before it is set (`start`, or a step before the
  condition).
- 🟥 When an item reaches a stage or step whose `if` isn't met, Drillmaster skips it and logs it as
  `step_skip_decided {by: "condition", why: "kind is feature"}`. A skipped stage skips all its
  steps. Skipped steps count as done for fast-forward, as in round 3.
- 🟥 A changed `if` is a major change, since it changes the path, like `skippable`.
- 🟥 `skippable` and `work_skip` stay, for skips Agent asks for.
- 🟧 An input can be changed later, with a reason, as a new `input_set`. If a stage or step that
  was skipped by its condition now applies, the item goes back to the first such one: the same rule
  as a fast-forward stopping at its first discrepancy. Steps that still apply and were passed are
  kept.
- 🟥 Migration on read: `metrics` become `inputs` (`categories` become `options`, `at_step` becomes
  `set_at`), and `metric_recorded` events become `input_set`. The retrospective operations
  `add_metric`/`change_metric`/`remove_metric` are renamed to `add_input`/`change_input`/
  `remove_input`, and the old names are still read.

**Owner inputs, and friction:**
- 🟥 Owner's chat prompts are "Owner inputs", not corrections. A work item's values are "work item
  inputs". Every text, tool result, skill and the viewer uses these names.
- 🟥 An Owner input belongs to what it leads to:
  - when Agent's next Drillmaster call is `work_start` or `work_resume`, to that item, as its start
    or resume input;
  - when it is `workflow_retrospective`, to that retrospective;
  - otherwise, to the item the session is on.

  This fixes the inputs listed one item late.
- 🟧 A separate judge decides whether each Owner input on the item was friction (Owner had to step
  in), or not. It is a fresh review that sees only the item: its issue, the Owner inputs, and what
  Agent did just before and after each one. It never sees the workflow, its history or the
  retrospectives, so it has no stake in the workflow looking better. It runs at delivery, next to
  Drillmaster's post mortem, and logs `owner_inputs_judged {work_item_id, inputs: [{event,
  friction, why}]}`.
- 🟥 The measure `owner_corrections_per_item` becomes `owner_friction_per_item`: the inputs judged
  friction, plus the Owner gates Owner rejected. Its value is known once the judge has run.
  Objectives and experiments that name the old measure are migrated on read.

**Owner's questions show what they ask about, side by side:**
- 🟥 Every Owner question (gate, skip, proposal, input) puts its content in the options'
  `preview`, which AskUserQuestion shows beside the options.
- 🟥 An Owner gate asks "Is this what you want?", and its preview shows three things:
  - what Agent reported at the step;
  - the assumptions reported on the item;
  - the rules, in words.
- 🟥 A skip shows Agent's reason and the step. A proposal shows its change, purpose and
  hypothesis.
- 🟥 Owner gates take no `self_check` from Agent.
- 🟥 The work skill tells Agent to pass `preview` through as it is.
- 🟧 The `PreToolUse` hook checks it: an AskUserQuestion call during a pending Owner question must
  carry Drillmaster's question, options and previews unchanged. Otherwise the hook blocks the call
  and tells Agent what differs. Owner always sees exactly what Drillmaster wrote.
- 🟧 The hook tells the two apart by the header: a question with the header of a pending
  Drillmaster question (Owner gate, Skip step, Proposal, Input) is checked. Agent's own questions
  pass.

**Tool capture: what Agent's commands print, kept by workflow-level rules in LogQL's syntax:**
- 🟧 The `PostToolUse` hook already receives Agent's `stdout` and `stderr`, for both the Bash and
  the PowerShell tool. By default, a trace keeps the last 20 lines, redacted, and whether Claude
  Code reported the call as failed. The Drillmaster repository stays private; making it publishable
  is not a goal.
- 🟧 The workflow has one `tool_captures` list for the whole project, not one per stage or step. A
  command's output means the same wherever it runs, and the trace already records the step it ran
  at. A retrospective changes the list with `add_tool_capture`, `change_tool_capture`
  and `remove_tool_capture`, each a minor change.
- 🟧 A rule is `{guid, name, command: "<regexp>", keep: "<LogQL pipeline>"}`. The `keep` pipeline
  uses a subset of the log pipeline of Grafana Loki's LogQL
  (https://grafana.com/docs/loki/latest/logql/):
  - line filters: `|=`, `!=`, `|~`, `!~`;
  - parsers: `| pattern`, `| regexp`, `| json` (optionally naming fields), `| logfmt`;
  - field filters: `| count > 0`, `| what = "fail"`;
  - `| line_format` with `{{.field}}`.

  It is implemented in `core/logPipeline.ts`, with no dependency, and the skills link to Loki's
  documentation. A pipeline outside the subset is refused when the workflow changes, with the
  part that isn't supported.
- 🟧 When a rule matches Agent's command, it replaces the default 20 lines. The trace keeps what
  the pipeline yields: fields and lines, still redacted. When it yields nothing, the trace keeps the
  default 20 lines and is marked "the rule found nothing", so a rule that no longer fits shows.
- 🟧 The workflow starts with no rules, like the rest of it. A retrospective adds one when a gate
  claim couldn't be checked.
- 🟧 Claude Code may shorten very long output before the hook sees it. The trace marks that it was
  shortened.
- 🟧 The gate's record links to the tool captures of its step. Showing them in the viewer, as
  "tests: pass 25, fail 0", waits for the viewer round.
- 🟥 Agent keeps full agency. Nothing is run by the gate.

**Per-rule rejection counts:**
- 🟥 The retrospective prompt lists gate rejections per rule.
- 🟥 An experiment's result counts the rejections citing the rules its change touched.

**Fixes from the feedback:**
- 🟥 `work_resume` always includes the stage it resumes at. Today an item stalled when Agent left
  that stage out.
- 🟥 `work_start` and `work_resume` list every step of the session's stages in outline: name, gate,
  `if`, and whether it can be skipped. The current step is shown in full. This stops false
  "missing step" impediments.
- 🟥 `work_deliver` accepts source, test and diff files as text artifacts. A refused call lists the
  accepted types.
- 🟥 An experiment records the GUIDs its change touched (`affects`). Its result counts only the
  items that went through one of them.
- 🟥 An experiment is refused when its baseline can't move toward the target, for example a
  baseline of 0 with sd 0 when lower is better.
- 🟥 Post mortem prompts give the exact count of items under each running experiment.
- 🟥 A Drillmaster-judged skip is rejected when its claim has no trace behind it. There is no
  acceptance with a condition attached.

**Not taken up now:**
- 🟥 a follow-up report kind;
- 🟥 amending `work_start`'s description;
- 🟥 an Owner acceptance event at delivery;
- 🟥 the `.drillmaster` exclude.

**Later, in a round of its own: the viewer, for people.**
- 🟧 Owner wants the user interface changes later. In this round the viewer only follows the
  renames, so it keeps working. The design so far:
- 🟥 Each page opens with the story in plain sentences, and the details come on demand. Ids,
  GUIDs, event types and JSON stay inside "Details" drawers.
- 🟥 **Project home:** "How is it going?"
  - Owner's objective in their words.
  - The headline measure as a sentence plus a small chart per workflow version, for example "Owner
    had to step in 0.4 times per item, down from 1.3 before version 3.0.0".
  - "Now": the open items, each with a pipeline bar of its stages.
  - "Recently": delivered items, one line each.
  - "What we changed": each retrospective as a short chapter: what we learned, what changed, and
    how it turned out.
- 🟥 **Workflow:** drawn like a pipeline. Stages are columns, and steps are cards with:
  - plain gate labels ("Agent checks", "Drillmaster checks", "Owner approves");
  - conditions in words ("only for bugs");
  - rules as sentences.

  Each card links to its history.
- 🟧 **Work item:** a story grouped by stage, for example "Capture: Agent wrote down what's wanted,
  and assumed 3 things. Passed its own check."
  - Owner inputs are shown as speech, marked friction or not, with Drillmaster's reason.
  - 🟧 Skips say why, and tool captures show as "tests: pass 25, fail 0".
  - Agent's actions sit under "Show what Agent did (42 actions)".
- 🟥 **Retrospective:** what should have happened, what happened, why, what to keep, and what to
  improve. Then each proposal with Owner's decision, and later how its experiment turned out.
- 🟥 One wording table (`core/story.ts`) turns events into sentences. It is unit-tested, and the
  views only lay those sentences out.

**The new scenario, `pipeline-bugs-and-features`:**
- 🟥 Inputs:
  - `kind` (bug or feature), set at start by Agent;
  - `user_visible` (yes or no), set at the capture step by Agent.
- 🟥 **Capture** (1.1): write down what's wrong or wanted.
- 🟥 **Refine:**
  - 2.1, for bugs: find the cause and name the line.
  - 2.2, for features: write the spec with examples and the open choices. It has an Owner gate
    showing the spec.
- 🟥 **Build:**
  - 3.1, for bugs: a failing test first.
  - 3.2: the code and its tests.
  - 3.3, if a feature or user-visible: document it.
- 🟧 **Test:**
  - 4.1: the full suite. The workflow's tool capture rules keep the `npm test` totals and the
    failing tests.
  - 4.2, for features: check the spec's examples by hand.
  - 4.3, for bugs: show that the failing test now passes.
- 🟥 8 issues, 4 bugs and 4 features, with retrospectives after 3, 6 and 8. It runs with the
  scripted Owner and with the LLM Owner.

## Build order

Each phase is one local commit, made when its tests are green. Nothing is pushed without Owner's
OK. A review is an agent review, not a stop for Owner.

One round, pressure-tested with both the scripted and the LLM Owner.

0. 🟥 **The plan in the repository:** `docs/plans/round-4.md`, and its row in the README (round 3's
   commits named exactly, d733b35..42d2693).
   - 🟧 The status squares go in a new `~/.claude/CLAUDE.md`, as the rule for every plan:
     - every item starts with 🟥 (not built, in an earlier version), 🟧 (not built, new since the
       version Owner last saw) or 🟩 (built);
     - the legend sits at the top;
     - plan files are ASCII with LF line endings, except for the squares.

     The squares in `docs/plans/round-4.md` turn green as phases are built.
1. 🟥 **Inputs and conditions:**
   - `metrics` become `inputs`, with migration;
   - `core/conditions.ts` (parse, validate, evaluate);
   - `if` on stages and steps, skipped by condition, as a major change;
   - `set_at: "start"` in `work_start`;
   - 🟧 changing an input, and going back;
   - the retrospective operations and their prompt.
2. 🟥 **Owner inputs and friction:**
   - attribution by the call an input leads to;
   - 🟧 the separate friction judge;
   - `owner_friction_per_item`, with migration;
   - the wording everywhere.
3. 🟥 **Owner's questions side by side:** `preview` on every Owner question, the gate question's
   content, no `self_check` on Owner gates, and the skills.
   - 🟧 the PreToolUse check that Owner is shown Drillmaster's question unchanged.
4. 🟧 **Tool capture:**
   - the hook keeps the output's tail, for Bash and PowerShell;
   - `core/logPipeline.ts` (the LogQL subset);
   - the workflow's `tool_captures` rules and their retrospective operations;
   - the gate record links to traces.
5. 🟥 **The fixes:**
   - `work_resume`'s stage;
   - the outline of the stages;
   - artifact types;
   - experiments (`affects`, refusing a baseline that can't move, exact counts);
   - judged skips;
   - per-rule rejection counts.
6. 🟧 **The viewer keeps working:** only the renames (work item inputs, Owner inputs, friction),
   with no new pages, layouts or wording. The Playwright tests pass as they are, apart from the
   renamed words.
7. 🟧 **The new scenario:** `pipeline-bugs-and-features.json`, the checks it needs (skipped by
   condition, tool capture fields, friction judged), and the old scenarios migrated.
8. 🟥 **Review, before the simulations (an agent review):**
   - `/code-review` on the round's diff, with its findings fixed and committed;
   - a check of the build against this plan's decisions, one by one.
9. 🟥 **Simulations:**
   - `pipeline-bugs-and-features`, with the scripted and the LLM Owner;
   - `phases-update` with the LLM Owner again, for the friction judgment across phases.
10. 🟥 **Finish:**
    - a clean-code pass;
    - hook fixtures re-recorded, including a Bash call that fails;
    - plugin tests in real Claude Code, including an Owner gate with a preview;
    - local CI on Windows and Linux;
    - the README, the skills and the concept in the new words;
    - `docs/plans` marked built.

## Verification

- **Unit tests:**
  - 🟥 conditions: parsing, refusals (unknown input, unknown value, read before set), evaluation;
  - 🟥 migration of metrics to inputs, and of the old measure;
  - 🟥 attribution of Owner inputs, including the one-item-late case from the runs;
  - 🟧 the LogQL subset: each filter, parser and `line_format`, and refusals of what's outside it;
  - 🟧 tool capture: the default 20 lines, replaced by a rule's yield, and the fallback when it
    yields nothing;
  - 🟧 changing an input: going back to a step that now applies, keeping passed steps;
  - 🟧 the PreToolUse check of an Owner question: unchanged passes, changed is blocked;
  - 🟥 per-rule counts.
- **API tests:**
  - 🟥 a feature item skips the bug steps by condition, and the other way round;
  - 🟥 a stage skipped as a whole;
  - 🟥 fast-forward over a changed `if`;
  - 🟥 `work_resume` adds its stage;
  - 🟥 artifact types and the refusal message;
  - 🟥 experiment `affects`, and a refused baseline;
  - 🟥 the friction measure from a post mortem.
- 🟧 **Playwright:** the existing tests pass with the renames.
- 🟥 **The plugin in real Claude Code:** an Owner gate whose AskUserQuestion shows the preview.
- 🟧 **The plugin in real Claude Code:** a Bash trace with tool capture fields.
- 🟥 **Simulations:** all hard checks pass in `pipeline-bugs-and-features`, with the scripted and
  the LLM Owner, and in `phases-update` with the LLM Owner.
- 🟥 `claude plugin validate .`, plus local CI on Windows and on Linux in Docker.
