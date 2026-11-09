Hook payload fixtures: `{ "event": "<HookEvent>", "payload": { ... } }`, one per file.

Files named `recorded-*.json` were captured from real Claude Code sessions with
`DRILLMASTER_RECORD=1` (see `server/test/hooks/record.md`). Every fixture here is replayed through
the real `scripts/hook.mjs` by `hook-client.test.ts`.
