// Serves the built viewer (a React app) from dist/viewer. Read-only, same origin as the API.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

/** dist/viewer next to the built server, or next to src when run through tsx. */
export function viewerRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return [path.join(here, '..', 'viewer'), path.join(here, '..', '..', 'dist', 'viewer')].find((dir) => existsSync(path.join(dir, 'index.html')))
}

export async function serveViewer(res: http.ServerResponse, pathname: string) {
  const root = viewerRoot()
  if (!root) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('The Drillmaster viewer is not built. Run `npm run build` in server/.')
    return
  }
  // Unknown paths get the app itself, which routes on the client.
  const requested = path.normalize(path.join(root, decodeURIComponent(pathname)))
  const inside = requested.startsWith(root + path.sep) && existsSync(requested) && path.extname(requested) !== ''
  const file = inside ? requested : path.join(root, 'index.html')
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  res.end(await readFile(file))
}
