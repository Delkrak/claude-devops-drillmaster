// Builds server/bundle/: what the plugin runs. A marketplace install copies only what git ships and
// runs no npm install, so the bundle is committed, with its runtime dependencies inside it. Run
// `npm run bundle` after changing the server or the viewer.
//
// `node scripts/bundle.mjs --check` fails when the committed bundle was built from other sources than
// the current ones. It compares the sources' fingerprint, not the files: StyleX names CSS variables
// from file paths, so the viewer builds differently on Windows and on Linux.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SERVER = path.resolve(import.meta.dirname, '..')
const BUNDLE = path.join(SERVER, 'bundle')
const FINGERPRINT_FILE = path.join(BUNDLE, 'SOURCES.sha256')
const SOURCES = ['src', 'viewer', 'package-lock.json', 'scripts/bundle.mjs']

/** One hash over every file the bundle is built from, in path order, with line endings as LF. */
async function sourcesFingerprint() {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...SOURCES], { cwd: SERVER })
    .toString()
    .split('\0')
    .filter(Boolean)
    .sort()
  const hash = createHash('sha256')
  for (const file of files) {
    let content
    try {
      content = await readFile(path.join(SERVER, file))
    } catch {
      continue // deleted, not yet committed
    }
    hash.update(`${file}\0`).update(content.toString('binary').replace(/\r\n/g, '\n')).update('\0')
  }
  return hash.digest('hex')
}

if (process.argv.includes('--check')) {
  const committed = (await readFile(FINGERPRINT_FILE, 'utf8').catch(() => '')).trim()
  if (committed !== (await sourcesFingerprint())) {
    console.error('server/bundle was not built from the current sources: run `npm run bundle` in server/ and commit server/bundle.')
    process.exit(1)
  }
  console.log('server/bundle is built from the current sources')
} else {
  const { build } = await import('esbuild')
  await rm(BUNDLE, { recursive: true, force: true })
  await build({
    absWorkingDir: SERVER,
    // The MCP command, and the two modules the hook script loads; shared code goes into chunks beside them.
    entryPoints: { cli: 'src/cli.ts', projectLocator: 'src/projectLocator.ts', projectServer: 'src/projectServer.ts' },
    outdir: BUNDLE,
    // Chunks stay next to cli.js: a chunk finds cli.js and the viewer from its own folder.
    chunkNames: '[name]-[hash]',
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    // A dependency written as CommonJS still finds `require` inside an ES module.
    banner: { js: "import { createRequire as __drillmasterRequire } from 'node:module'; const require = __drillmasterRequire(import.meta.url);" },
    legalComments: 'eof',
    logLevel: 'warning',
  })
  await cp(path.join(SERVER, 'dist', 'viewer'), path.join(BUNDLE, 'viewer'), { recursive: true })
  await writeFile(FINGERPRINT_FILE, `${await sourcesFingerprint()}\n`)
  console.log('bundled into server/bundle')
}
