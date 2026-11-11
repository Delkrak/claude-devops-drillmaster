const HEALTH_TIMEOUT_MS = 1500

export interface ServerHealth {
  name: string
  version: string
  pid: number
  project: string | null
}

export async function drillmasterServerAt(url: string): Promise<ServerHealth | undefined> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    const health = (await response.json()) as ServerHealth
    return response.ok && health.name === 'drillmaster' ? health : undefined
  } catch {
    return undefined
  }
}

export async function requestJson<T>(url: string, method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${url}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(json.error ?? `${method} ${route} failed with ${response.status}`)
  return json
}
