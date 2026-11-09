import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { DrillmasterEvent } from '../core/events.js'
import type { EventStore } from '../ports.js'

/** Keeps events in memory: for tests, and for nothing else. */
export class MemoryStore implements EventStore {
  private readonly streams = new Map<string, DrillmasterEvent[]>()

  async append(project: string, event: DrillmasterEvent) {
    const stream = this.streams.get(project) ?? []
    stream.push(structuredClone(event))
    this.streams.set(project, stream)
  }

  async read(project: string) {
    return structuredClone(this.streams.get(project) ?? [])
  }

  async projects() {
    return [...this.streams.keys()]
  }
}

/**
 * One append-only events.jsonl per project, under <root>/<project id>/. Appends are serialized per
 * project, so concurrent requests never interleave half lines.
 */
export class JsonlStore implements EventStore {
  private readonly queues = new Map<string, Promise<void>>()

  constructor(private readonly root: string) {}

  private file(project: string) {
    return path.join(this.root, project, 'events.jsonl')
  }

  append(project: string, event: DrillmasterEvent) {
    const previous = this.queues.get(project) ?? Promise.resolve()
    const next = previous.then(async () => {
      await mkdir(path.dirname(this.file(project)), { recursive: true })
      await appendFile(this.file(project), JSON.stringify(event) + '\n', 'utf8')
    })
    this.queues.set(project, next.catch(() => {}))
    return next
  }

  async read(project: string) {
    await this.queues.get(project)
    let text: string
    try {
      text = await readFile(this.file(project), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as DrillmasterEvent)
  }

  async projects() {
    try {
      return await readdir(this.root)
    } catch {
      return []
    }
  }
}
