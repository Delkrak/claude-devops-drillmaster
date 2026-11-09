import path from 'node:path'
import type { DrillmasterEvent } from '../core/events.js'
import { foldState } from '../core/state.js'
import { artifactFile, filesOfWriter, mergeMessage, type Storage } from '../core/storeLayout.js'
import { GitStore } from './gitStore.js'

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

  /** A writer's own event files, and the artifacts of the items it delivered (laid down again as they are). */
  private readonly ownsFile = (filePath: string) => filePath.endsWith(`/${this.writer}.jsonl`) || filePath.includes('/artifacts/')

  async publish(events: readonly DrillmasterEvent[], readArtifact: (workItemId: string, name: string) => Promise<Buffer | undefined> = async () => undefined) {
    await this.git.ensureClone()
    const files = filesOfWriter(events, foldState(events), this.storage, this.writer)
    if (await this.git.writeFiles('main', files.project, 'Drillmaster: project events')) await this.git.push('main', this.ownsFile)
    for (const entry of files.items) {
      const workItemId = entry.item.work_item_id
      const itemFiles: Record<string, string | Buffer> = { ...entry.files }
      for (const artifact of entry.artifacts) {
        const bytes = await readArtifact(workItemId, artifact.name)
        if (bytes) itemFiles[artifactFile(this.storage, workItemId, artifact.name)] = bytes
      }
      if (await this.git.hasPath('main', entry.folder)) {
        // Merged already: what comes after (a fix-now added step, a late correction) goes on main.
        if (await this.git.writeFiles('main', itemFiles, `${workItemId}: after delivery`)) await this.git.push('main', this.ownsFile)
        continue
      }
      const where = entry.item.stage === null ? 'past its last work step' : `at work step ${entry.item.stage}.${entry.item.step}`
      if (await this.git.writeFiles(entry.branch, itemFiles, `${workItemId} (${entry.item.issue}) ${where}`)) await this.git.push(entry.branch, this.ownsFile)
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
