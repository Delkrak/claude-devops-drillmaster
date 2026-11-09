import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fixedClock, sequentialIds } from '../../src/adapters/clocks.js'
import { ScriptedReviewer } from '../../src/adapters/reviewers.js'
import { JsonlStore } from '../../src/adapters/stores.js'
import type { DrillmasterEvent } from '../../src/core/events.js'
import { workflowZero } from '../../src/core/workflow.js'
import { projectId } from '../../src/env.js'
import { OBJECTIVE, tempDir } from '../helpers.js'

const event = (n: number): DrillmasterEvent => ({
  id: `ev_${n}`,
  at: '2026-11-09T10:00:00Z',
  type: 'workflow_changed',
  workflow: { ...workflowZero(OBJECTIVE as never), version: n },
  reason: `change ${n}`,
})

describe('JSONL store', () => {
  let cleanup: () => Promise<void> = async () => {}
  afterEach(() => cleanup())

  it('appends one line per event and reads them back in order', async () => {
    const { dir, remove } = await tempDir('store')
    cleanup = remove
    const store = new JsonlStore(dir)
    await store.append('p1', event(1))
    await store.append('p1', event(2))
    expect((await store.read('p1')).map((e) => e.id)).toEqual(['ev_1', 'ev_2'])
    const lines = (await readFile(path.join(dir, 'p1', 'events.jsonl'), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(await store.projects()).toEqual(['p1'])
  })

  it('never interleaves concurrent appends', async () => {
    const { dir, remove } = await tempDir('store')
    cleanup = remove
    const store = new JsonlStore(dir)
    await Promise.all(Array.from({ length: 50 }, (_, i) => store.append('p1', event(i))))
    const events = await store.read('p1')
    expect(events.map((e) => e.id)).toEqual(Array.from({ length: 50 }, (_, i) => `ev_${i}`))
  })

  it('reads an unknown project as empty', async () => {
    const { dir, remove } = await tempDir('store')
    cleanup = remove
    expect(await new JsonlStore(dir).read('nope')).toEqual([])
  })
})

describe('test adapters', () => {
  it('the fixed clock moves one second per call', () => {
    const clock = fixedClock('2026-11-09T10:00:00Z')
    expect([clock.now(), clock.now()]).toEqual(['2026-11-09T10:00:00.000Z', '2026-11-09T10:00:01.000Z'])
  })

  it('sequential ids count per prefix', () => {
    const ids = sequentialIds()
    expect([ids.next('ev'), ids.next('wi'), ids.next('ev')]).toEqual(['ev_1', 'wi_1', 'ev_2'])
  })

  it('the scripted reviewer answers in order and records requests', async () => {
    const reviewer = new ScriptedReviewer({ gate: [{ accepted: false }, { accepted: true }] })
    expect((await reviewer.review({ kind: 'gate', prompt: 'a' })).answer).toEqual({ accepted: false })
    expect((await reviewer.review({ kind: 'gate', prompt: 'b' })).answer).toEqual({ accepted: true })
    await expect(reviewer.review({ kind: 'gate', prompt: 'c' })).rejects.toThrow(/no answer left/)
    expect(reviewer.requests.map((r) => r.prompt)).toEqual(['a', 'b', 'c'])
  })

  it('a project id is stable, readable and case-insensitive on Windows', () => {
    const id = projectId('/repo/My App')
    expect(id).toMatch(/^My_App-[0-9a-f]{12}$|^my_app-[0-9a-f]{12}$/)
    expect(projectId('/repo/My App')).toBe(id)
  })
})
