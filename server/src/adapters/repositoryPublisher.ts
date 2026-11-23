import path from 'node:path'
import type { DrillmasterEvent } from '../core/events.js'
import { artifactFile, filesOfWriter, mergeMessage, pinFile, workflowFile } from '../core/repositoryLayout.js'
import { foldState } from '../core/state.js'
import type { WorkflowDocument } from '../core/workflow.js'
import type { DrillmasterRepositoryPlace } from '../ports.js'
import { GitRepository } from './gitRepository.js'

const MAIN = 'main'
const workflowJson = (workflow: WorkflowDocument) => JSON.stringify(workflow, null, 2) + '\n'

/** Another machine changed what this one was about to change. */
export class RepositoryConflict extends Error {}

/** Keeps a project in its Drillmaster repository: one writer's events, and the pin and workflow on main. */
export class RepositoryPublisher {
  private readonly git: GitRepository

  constructor(
    cloneDir: string,
    private readonly place: DrillmasterRepositoryPlace,
    private readonly writer: string,
  ) {
    this.git = new GitRepository(cloneDir, place.url)
  }

  static forProject(projectsRoot: string, projectKey: string, place: DrillmasterRepositoryPlace, writer: string) {
    return new RepositoryPublisher(path.join(projectsRoot, projectKey, 'repository.git'), place, writer)
  }

  /**
   * The files a push lays on top of the remote when another machine pushed first: the writer's own
   * event files, the artifacts of the items it delivered, and only the main file the push is for.
   */
  private readonly ownsEventFile = (filePath: string) => filePath.endsWith(`/${this.writer}.jsonl`) || filePath.includes('/artifacts/')
  private readonly ownsFileOrMainFile = (mainFile: string) => (filePath: string) => this.ownsEventFile(filePath) || filePath === mainFile

  private async mainAsTheRemoteHasIt() {
    await this.git.ensureClone()
    await this.git.fetch()
    await this.git.adoptRemote(MAIN)
  }

  /** Starts the project's folder on main with the pin and workflow 0.0.0, refusing a folder that has a project already. */
  async setUp(workflow: WorkflowDocument, drillmasterVersion: string) {
    await this.mainAsTheRemoteHasIt()
    const workflowOnMain = await this.git.readFile(`refs/remotes/origin/${MAIN}`, workflowFile(this.place.folder))
    if (workflowOnMain) {
      // A setup that pushed, then failed before it linked the work folder, left this very workflow and
      // no history: running setup again finishes it. Anything else is another project's folder.
      const unfinishedSetup = workflowOnMain === workflowJson(workflow) && (await this.git.readJsonlFiles(this.place.folder)).length === 0
      if (unfinishedSetup) return
      throw new RepositoryConflict(`Folder "${this.place.folder}" of ${this.place.url} already holds a Drillmaster project. Pick another folder.`)
    }
    await this.git.writeFiles(
      MAIN,
      { [pinFile(this.place.folder)]: JSON.stringify({ drillmaster_version: drillmasterVersion }, null, 2) + '\n', [workflowFile(this.place.folder)]: workflowJson(workflow) },
      `${this.place.folder}: set up, workflow ${workflow.version}`,
    )
    await this.git.push(MAIN, (filePath) => this.ownsEventFile(filePath) || filePath === pinFile(this.place.folder) || filePath === workflowFile(this.place.folder))
  }

  /**
   * Pushes the next workflow version to main, before it applies anywhere. Refuses when main's
   * workflow is no longer `current`, because another machine changed it first.
   */
  async pushWorkflow(current: WorkflowDocument, next: WorkflowDocument, message: string) {
    await this.mainAsTheRemoteHasIt()
    const onMain = (await this.git.readFile(`refs/remotes/origin/${MAIN}`, workflowFile(this.place.folder))) ?? (await this.git.readFile(`refs/heads/${MAIN}`, workflowFile(this.place.folder)))
    if (onMain !== undefined && JSON.parse(onMain).version !== current.version) {
      throw new RepositoryConflict(`The workflow on main is version ${JSON.parse(onMain).version}, not ${current.version}: another machine changed it first.`)
    }
    await this.git.writeFiles(MAIN, { [workflowFile(this.place.folder)]: workflowJson(next) }, message)
    await this.git.push(MAIN, this.ownsFileOrMainFile(workflowFile(this.place.folder)))
  }

  async pushPin(drillmasterVersion: string) {
    await this.mainAsTheRemoteHasIt()
    await this.git.writeFiles(MAIN, { [pinFile(this.place.folder)]: JSON.stringify({ drillmaster_version: drillmasterVersion }, null, 2) + '\n' }, `${this.place.folder}: Drillmaster ${drillmasterVersion}`)
    await this.git.push(MAIN, this.ownsFileOrMainFile(pinFile(this.place.folder)))
  }

  /** The pin on the remote's main: fetched now, or as last fetched when the remote can't be reached. */
  async readPin(): Promise<string | undefined> {
    await this.git.ensureClone()
    await this.git.fetch().catch(() => {})
    const pin = await this.git.readFile(`refs/remotes/origin/${MAIN}`, pinFile(this.place.folder))
    if (!pin) return undefined
    const version = (JSON.parse(pin) as { drillmaster_version?: unknown }).drillmaster_version
    return typeof version === 'string' ? version : undefined
  }

  async publish(events: readonly DrillmasterEvent[], readArtifact: (workItemId: string, name: string) => Promise<Buffer | undefined> = async () => undefined) {
    await this.git.ensureClone()
    const files = filesOfWriter(events, foldState(events), this.place.folder, this.writer)
    if (await this.git.writeFiles(MAIN, files.project, 'Drillmaster: project events')) await this.git.push(MAIN, this.ownsEventFile)
    for (const entry of files.items) {
      const workItemId = entry.item.work_item_id
      const itemFiles: Record<string, string | Buffer> = { ...entry.files }
      for (const artifact of entry.artifacts) {
        const bytes = await readArtifact(workItemId, artifact.name)
        if (bytes) itemFiles[artifactFile(this.place.folder, workItemId, artifact.name)] = bytes
      }
      if (await this.git.hasPath(MAIN, entry.folder)) {
        // Merged already: what comes after (a fix-now added step, a late correction) goes on main.
        if (await this.git.writeFiles(MAIN, itemFiles, `${workItemId}: after delivery`)) await this.git.push(MAIN, this.ownsEventFile)
        continue
      }
      const where = entry.item.stage === null ? 'past its last work step' : `at work step ${entry.item.stage}.${entry.item.step}`
      if (await this.git.writeFiles(entry.branch, itemFiles, `${workItemId} (${entry.item.issue}) ${where}`)) await this.git.push(entry.branch, this.ownsEventFile)
      if (!entry.complete) continue
      await this.git.squashMerge(entry.branch, entry.folder, mergeMessage(entry.item))
      await this.git.push(MAIN, this.ownsEventFile)
      await this.git.deleteBranch(entry.branch)
    }
  }

  async importEvents(): Promise<DrillmasterEvent[]> {
    await this.git.ensureClone()
    await this.git.fetch()
    const texts = await this.git.readJsonlFiles(this.place.folder)
    return texts.flatMap((text) =>
      text
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as DrillmasterEvent),
    )
  }
}

