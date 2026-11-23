import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DrillmasterRepositoryPlace, ProjectRef, ProjectResolver } from '../ports.js'

const MAX_READABLE_NAME_LENGTH = 40
export const DRILLMASTER_FILE = '.drillmaster'
const OLD_DRILLMASTER_FOLDER =
  'This folder has a .drillmaster folder, left by an older Drillmaster (claude-coach 0.4 kept its files there). Move it out of the way or delete it, then run setup again: this Drillmaster links a folder to its project with one .drillmaster file.'

const readable = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, MAX_READABLE_NAME_LENGTH) || 'project'
const shortHash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12)

/** A project's key: its folder in the Drillmaster repository, and a hash of where that folder is. */
export const projectKey = (place: DrillmasterRepositoryPlace) => `${readable(place.folder)}-${shortHash(`${place.url}\n${place.folder}`)}`

/** The key of a work folder that isn't linked to a Drillmaster repository: its name, and a hash of its path. */
export function folderKey(projectDir: string) {
  let normalizedDir = path.resolve(projectDir)
  if (process.platform === 'win32') normalizedDir = normalizedDir.toLowerCase()
  return `${readable(path.basename(normalizedDir))}-${shortHash(normalizedDir)}`
}

/** A folder name for the project in the Drillmaster repository, made from the work folder's name. */
export const defaultFolderOf = (projectDir: string) => readable(path.basename(path.resolve(projectDir)))

function readPlace(file: string): DrillmasterRepositoryPlace | undefined {
  try {
    const content = JSON.parse(readFileSync(file, 'utf8')) as { drillmaster_repository?: unknown; folder?: unknown }
    return typeof content.drillmaster_repository === 'string' && typeof content.folder === 'string' && content.folder.trim()
      ? { url: content.drillmaster_repository, folder: content.folder }
      : undefined
  } catch {
    return undefined
  }
}

/**
 * The work repository's `.drillmaster` file, committed with the code, names the Drillmaster
 * repository and the folder in it. Nothing else of Drillmaster lives in the work repository.
 */
export class DotDrillmasterResolver implements ProjectResolver {
  resolve(projectDir: string): ProjectRef | undefined {
    const file = path.join(projectDir, DRILLMASTER_FILE)
    try {
      if (statSync(file).isDirectory()) return undefined
    } catch {
      return undefined
    }
    const place = readPlace(file)
    return place ? { key: projectKey(place), repository: place } : undefined
  }

  linkProblem(projectDir: string) {
    try {
      return statSync(path.join(projectDir, DRILLMASTER_FILE)).isDirectory() ? OLD_DRILLMASTER_FOLDER : undefined
    } catch {
      return undefined
    }
  }

  async link(projectDir: string, repository: DrillmasterRepositoryPlace): Promise<ProjectRef> {
    const problem = this.linkProblem(projectDir)
    if (problem) throw new Error(problem)
    await writeFile(path.join(projectDir, DRILLMASTER_FILE), JSON.stringify({ drillmaster_repository: repository.url, folder: repository.folder }, null, 2) + '\n')
    return { key: projectKey(repository), repository }
  }
}

/** For tests: every folder is a project, keyed by its path, linked only in memory. */
export class FolderResolver implements ProjectResolver {
  private readonly linked = new Map<string, DrillmasterRepositoryPlace>()

  resolve(projectDir: string): ProjectRef {
    return { key: folderKey(projectDir), repository: this.linked.get(path.resolve(projectDir)) ?? null }
  }

  linkProblem() {
    return undefined
  }

  async link(projectDir: string, repository: DrillmasterRepositoryPlace): Promise<ProjectRef> {
    this.linked.set(path.resolve(projectDir), repository)
    return this.resolve(projectDir)
  }
}
