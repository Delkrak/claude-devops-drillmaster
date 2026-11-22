# Design references

Mocks Owner accepted, kept as the reference each built view must match. A built view may differ only
where it is better or where real text replaces the grey placeholder bars.

| File | Story | What it shows |
|---|---|---|
| [workflow.html](workflow.html) | Workflow: the pipeline, where the work items are, where the friction is | The reviewed-run fixture (`server/test/viewer/fixtures/reviewed-run.json`) at 2026-11-20T19:10:16.785Z, workflow 2.1.0: #5 waiting at Drillmaster's review 4.4, 4 delivered, Owner stepped in 2 times after delivery |
| [work-item.html](work-item.html) | What happened to #N? | The same fixture, with its step-ins placed: #2 (`?item=2`, the default), a bug, delivered, Owner stepped in after delivery at the step that should have caught it (3.1); #5 (`?item=5`) in flight at 19:10, at Drillmaster's review 4.4. Click a step to drill in one level at a time |

Open a file in a browser. Grey rounded bars stand for text that is not written yet.

The decisions behind each mock are in [DESIGN.md](../../DESIGN.md) and in its surface brief under
`.impeccable/surfaces/`.
