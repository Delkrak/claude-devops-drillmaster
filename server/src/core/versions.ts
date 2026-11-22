export type VersionLevel = 'major' | 'minor' | 'patch'

/** Whole-number versions from before semver read as major versions. */
export const toSemver = (version: unknown): string => (typeof version === 'number' ? `${version}.0.0` : String(version))

export function bumpVersion(version: string, level: VersionLevel): string {
  const [major, minor, patch] = version.split('.').map(Number) as [number, number, number]
  if (level === 'major') return `${major + 1}.0.0`
  if (level === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

export function compareVersions(a: string, b: string) {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let part = 0; part < 3; part++) {
    const difference = (left[part] ?? 0) - (right[part] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

export const isMajorChange = (from: string, to: string) => from.split('.')[0] !== to.split('.')[0]
