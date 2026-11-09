import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { DrillmasterEvent } from '../core/events.js'
import type { EventStore } from '../ports.js'

export class MemoryStore implements EventStore {
  private readonly eventsByProject = new Map<string, DrillmasterEvent[]>()

  async append(projectId: string, event: DrillmasterEvent) {
    const events = this.eventsByProject.get(projectId) ?? []
    events.push(structuredClone(event))
    this.eventsByProject.set(projectId, events)
  }

  async read(projectId: string) {
    return structuredClone(this.eventsByProject.get(projectId) ?? [])
  }

  async projectIds() {
    return [...this.eventsByProject.keys()]
  }
}

export class JsonlStore implements EventStore {
  private readonly appendQueueByProject = new Map<string, Promise<void>>()

  constructor(private readonly projectsRoot: string) {}

  private eventsFile(projectId: string) {
    return path.join(this.projectsRoot, projectId, 'events.jsonl')
  }

  append(projectId: string, event: DrillmasterEvent) {
    const previousAppend = this.appendQueueByProject.get(projectId) ?? Promise.resolve()
    const thisAppend = previousAppend.then(async () => {
      await mkdir(path.dirname(this.eventsFile(projectId)), { recursive: true })
      await appendFile(this.eventsFile(projectId), JSON.stringify(event) + '\n', 'utf8')
    })
    this.appendQueueByProject.set(projectId, thisAppend.catch(() => {}))
    return thisAppend
  }

  async read(projectId: string) {
    await this.appendQueueByProject.get(projectId)
    let jsonl: string
    try {
      jsonl = await readFile(this.eventsFile(projectId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return jsonl
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as DrillmasterEvent)
  }

  async projectIds() {
    try {
      return await readdir(this.projectsRoot)
    } catch {
      return []
    }
  }
}
