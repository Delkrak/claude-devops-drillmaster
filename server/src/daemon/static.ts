import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ONE_YEAR_SECONDS = 31_536_000

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

export function findBuiltViewerDir() {
  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  // The plugin's bundle keeps the viewer beside its code; the build keeps it a folder up from daemon/.
  const builtInBundle = path.join(thisDir, 'viewer')
  const builtNextToServer = path.join(thisDir, '..', 'viewer')
  const builtWhenRunFromSource = path.join(thisDir, '..', '..', 'dist', 'viewer')
  return [builtInBundle, builtNextToServer, builtWhenRunFromSource].find((dir) => existsSync(path.join(dir, 'index.html')))
}

export async function serveViewer(response: http.ServerResponse, pathname: string) {
  const viewerDir = findBuiltViewerDir()
  if (!viewerDir) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('The Drillmaster viewer is not built. Run `npm run build` in server/.')
    return
  }
  const indexFile = path.join(viewerDir, 'index.html')
  const requestedFile = path.normalize(path.join(viewerDir, decodeURIComponent(pathname)))
  const isServableFile = requestedFile.startsWith(viewerDir + path.sep) && existsSync(requestedFile) && path.extname(requestedFile) !== ''
  const servedFile = isServableFile ? requestedFile : indexFile
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[path.extname(servedFile)] ?? 'application/octet-stream',
    'cache-control': servedFile === indexFile ? 'no-cache' : `public, max-age=${ONE_YEAR_SECONDS}, immutable`,
  })
  response.end(await readFile(servedFile))
}
