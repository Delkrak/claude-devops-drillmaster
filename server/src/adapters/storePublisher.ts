import path from 'node:path'
import type { DrillmasterEvent } from '../core/events.js'
import { foldState } from '../core/state.js'
import { filesOfWriter, mergeMessage, type Storage } from '../core/storeLayout.js'
import { GitStore } from './gitStore.js'

/** Mirrors one project's events into its git store, and reads the events other writers pushed. */
export class StorePublisher {
  private readonly git: GitStore

  constructor(
    cloneDir: string,
    private readonly storage: Storage,
    private readonly writer: string,
  ) {
    this.git = new GitStore(cloneDir, storage.repo)
  }

  static forProject(storesRoot: string, projectId: string, storage: Storage, writer: string) {
    return new StorePublisher(path.join(storesRoot, projectId), storage, writer)
  }

  private readonly ownsFile = (filePath: string) => filePath.endsWith(`/${this.writer}.jsonl`)

  async publish(events: readonly DrillmasterEvent[]) {
    await this.git.ensureClone()
    const files = filesOfWriter(events, foldState(events), this.storage, this.writer)
    if (await this.git.writeFiles('main', files.project, 'Drillmaster: project events')) await this.git.push('main', this.ownsFile)
    for (const entry of files.items) {
      const workItemId = entry.item.work_item_id
      if (await this.git.hasPath('main', entry.folder)) {
        // Merged already: what comes after (a fix-now added step, a late correction) goes on main.
        if (await this.git.writeFiles('main', entry.files, `${workItemId}: after delivery`)) await this.git.push('main', this.ownsFile)
        continue
      }
      const where = entry.item.stage === null ? 'past its last work step' : `at work step ${entry.item.stage}.${entry.item.step}`
      if (await this.git.writeFiles(entry.branch, entry.files, `${workItemId} (${entry.item.issue}) ${where}`)) await this.git.push(entry.branch, this.ownsFile)
      if (!entry.complete) continue
      await this.git.squashMerge(entry.branch, entry.folder, mergeMessage(entry.item))
      await this.git.push('main', this.ownsFile)
      await this.git.deleteBranch(entry.branch)
    }
  }

  async importEvents(): Promise<DrillmasterEvent[]> {
    await this.git.ensureClone()
    await this.git.fetch()
    const texts = await this.git.readJsonlFiles(this.storage.path)
    return texts.flatMap((text) =>
      text
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as DrillmasterEvent),
    )
  }
}
