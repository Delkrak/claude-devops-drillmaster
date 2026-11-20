# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Owner: the CEO who runs a project with Agent (Claude Code) under Drillmaster. Owner needs clarity
of the process, and the ability to drill down and solve problems. Owner opens the viewer after a
work item, around a workflow retrospective, and when something feels off. Owner is easily
overloaded by a lot of information at once.

## Product Purpose

Drillmaster makes an AI process with checks and balances, so that it is followed and reliable, and
so it can be optimized and improved reliably too. Humans struggle with this. The viewer gives Owner
clarity of that process: whether it works, what happened, and where it goes wrong.

Success: Owner sees whether Drillmaster works for them at a glance, and can drill down from
"something is off" to the cause.

## Positioning

The process improves itself from wherever Owner had to step in, and every change is tried as an
experiment and measured.

## Operating Context

- One project at a time, with hundreds of work items (each delivered as a PR) and many workflow
  retrospectives over the coming months.
- Owner works with Agent in Claude Code. A work item moves through work stages and steps, each
  ending in a gate that Agent, Drillmaster or Owner judges.
- Owner decides gates and proposals in AskUserQuestion, inside Claude Code. The viewer is for
  looking, for now; deciding in the viewer comes later, once the process works.
- Solving a problem from the viewer means one of three things:
  - finding the cause: the step, rule or moment where it went wrong, and why;
  - taking it to a retrospective, so the workflow changes;
  - seeing what to fix in Drillmaster itself.

## Capabilities and Constraints

- Served locally per project by the project's Drillmaster server (`drillmaster open`); one project
  per viewer.
- Look-only for now: no decisions are taken in the viewer.
- What Owner comes to do, as stories:
  - Is it working? Whether Owner steps in less than before, and since which change.
  - What happened to a work item? The steps it went through, the ones it skipped and why, and
    where Owner stepped in.
  - What does Agent do? The steps a bug goes through, and the steps a feature goes through.
  - Did the change help? What the last retrospective changed, and whether that worked.
  - What is wrong in Drillmaster? The complaint about Drillmaster itself that is heard most.
- Terms: Owner, Agent, Drillmaster, work item, work stage, work step, work gate, work policy and
  rule, work item input, Owner input, friction, workflow retrospective, workflow experiment.
- Undecided: when the viewer starts letting Owner act.

## Evidence on Hand

- Simulation runs in `server/test/sim/runs/`, for example
  `2026-11-11T23-36-24-pipeline-bugs-and-features-llm-1` (8 bugs and features, 3 retrospectives)
  and `2026-11-11T23-37-22-phases-update-llm-1` (3 work items in two sittings each).
- No real customer project yet; nothing may be presented as one.

## Product Principles

- Clarity first: each view answers one question at a glance, and the details wait until asked for.
- Drill down, don't spread out: from the whole to the cause, one step at a time.
- Every claim traces back to what happened: a sentence links to the work or verdict behind it.
- Checks and balances stay visible: who judged what, by which rule, and why.

## Accessibility & Inclusion

Owner is easily overloaded: keep each screen to what its question needs, and few choices per
decision point.
