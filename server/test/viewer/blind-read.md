# Blind read of the Workflow page

A fresh agent reads the screens `screens.spec.ts` saves, and nothing else: no code, no HTML, no page
text. Run `npx playwright test --grep @screens` first; the screens land in `test-results/screens/`.
Compare its answers with the truth below, and with the same read of the accepted mock,
`docs/design/workflow.html`.

## Prompt

> You are a first-time user testing a web page. You get four screenshots taken top to bottom as you
> scroll the page once: `workflow-0-landing.png` (when the page opens), then `workflow-1-scrolled.png`,
> `workflow-2-scrolled.png` and `workflow-3-scrolled.png` (the bottom). Use the Read tool on exactly
> these files and nothing else. The page shows the current status of the pipeline an AI agent's work
> items go through.
>
> Answer briefly, marking each answer SURE or GUESS:
> 1. Your first glances when the page opens, in order, and why each caught your eye.
> 2. What the page tells you, stage by stage: where work is in progress right now, and what it waits for.
> 3. What the stop shapes mean, and what the marks beside them tell you.
> 4. Where the work items are, and where the person had to step in.
> 5. What pulls attention without mattering, what matters but is easy to miss, and what is confusing.

## The truth at the mock's moment (2026-11-20T19:10:16.785Z, workflow 2.1.0)

- One work item in progress, #5, waiting at step 4.4, which Drillmaster reviews; 4 reviews passed there.
- 4 work items delivered.
- Owner stepped in 2 times, both after delivery; no friction inside a stage.
- Splits: 2.1 (bugs) or 2.2 (features, Owner approves); 4.2 (features) or 4.3 (bugs).
