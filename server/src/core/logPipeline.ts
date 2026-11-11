/**
 * A subset of the log pipeline of Grafana Loki's LogQL (https://grafana.com/docs/loki/latest/logql/),
 * run over the lines a command printed:
 * - line filters: |= "text", != "text", |~ "regexp", !~ "regexp";
 * - parsers: | json, | json a, b="path.to.field", | logfmt, | pattern "<name> <_> ...",
 *   | regexp "(?P<name>...)";
 * - field filters: | name = "value", !=, =~, !~, and on numbers >, >=, <, <=, ==;
 * - | line_format "{{.name}} {{__line__}}".
 * Strings are written in double quotes or backticks. There is no stream selector: the command is it.
 */

export class InvalidPipeline extends Error {}

type Comparison = '=' | '!=' | '=~' | '!~' | '>' | '>=' | '<' | '<=' | '=='

type Stage =
  | { kind: 'line_filter'; op: '|=' | '!=' | '|~' | '!~'; text: string; pattern?: RegExp }
  | { kind: 'json'; fields: { name: string; path: string }[] }
  | { kind: 'logfmt' }
  | { kind: 'pattern'; pattern: RegExp; names: string[] }
  | { kind: 'regexp'; pattern: RegExp }
  | { kind: 'field_filter'; field: string; op: Comparison; value: string; pattern?: RegExp }
  | { kind: 'line_format'; template: string }

export interface LogEntry {
  line: string
  fields: Record<string, string>
}

const STRING = /^\s*(?:"((?:[^"\\]|\\.)*)"|`([^`]*)`)/
const NAME = /^\s*([A-Za-z_][\w.]*)/

function compile(source: string, text: string) {
  try {
    return new RegExp(text.replace(/\(\?P</g, '(?<'))
  } catch (error) {
    throw new InvalidPipeline(`"${source}": ${text} is not a regular expression (${error instanceof Error ? error.message : String(error)}).`)
  }
}

/** A pattern like "<what> <count> tests": each <name> captures up to the text that follows it; <_> captures nothing. */
function compilePattern(source: string, text: string) {
  const names: string[] = []
  const parts = text.split(/(<[A-Za-z_]\w*>)/).filter((part) => part !== '')
  if (!parts.some((part) => /^<\w+>$/.test(part) && part !== '<_>')) throw new InvalidPipeline(`"${source}": pattern "${text}" names nothing to capture, like <count>.`)
  const body = parts
    .map((part, index) => {
      const capture = /^<(\w+)>$/.exec(part)
      if (!capture) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const last = index === parts.length - 1
      if (capture[1] === '_') return last ? '.*' : '.*?'
      names.push(capture[1]!)
      return `(?<${capture[1]}>${last ? '.*' : '.*?'})`
    })
    .join('')
  return { pattern: compile(source, `^${body}$`), names }
}

export function parsePipeline(source: string): Stage[] {
  const stages: Stage[] = []
  let rest = source.trim()
  const fail = (what: string): never => {
    throw new InvalidPipeline(`"${source}": ${what} at "${rest.slice(0, 40)}". Drillmaster reads line filters (|=, !=, |~, !~), | json, | logfmt, | pattern, | regexp, field filters and | line_format.`)
  }
  const takeString = (): string => {
    const match = STRING.exec(rest)
    if (!match) return fail('expected a string in "..." or `...`')
    rest = rest.slice(match[0].length)
    return match[1] !== undefined ? match[1].replace(/\\(.)/g, '$1') : match[2]!
  }
  const takeName = (): string => {
    const match = NAME.exec(rest)
    if (!match) return fail('expected a name')
    rest = rest.slice(match[0].length)
    return match[1]!
  }
  const take = (token: string) => {
    const trimmed = rest.trimStart()
    if (!trimmed.startsWith(token)) return false
    rest = trimmed.slice(token.length)
    return true
  }
  const takeWord = (word: string) => {
    const match = new RegExp(`^\\s*${word}\\b`).exec(rest)
    if (!match) return false
    rest = rest.slice(match[0].length)
    return true
  }
  if (rest === '') throw new InvalidPipeline('A tool capture keeps nothing: its pipeline is empty.')
  while (rest.trim() !== '') {
    const lineFilter = (['|=', '!=', '|~', '!~'] as const).find((op) => take(op))
    if (lineFilter) {
      const text = takeString()
      stages.push({ kind: 'line_filter', op: lineFilter, text, ...(lineFilter.endsWith('~') ? { pattern: compile(source, text) } : {}) })
      continue
    }
    if (!take('|')) fail('expected | or a line filter')
    if (takeWord('json')) {
      const fields: { name: string; path: string }[] = []
      while (NAME.test(rest) && !/^\s*\|/.test(rest)) {
        const name = takeName()
        fields.push({ name, path: take('=') ? takeString() : name })
        if (!take(',')) break
      }
      stages.push({ kind: 'json', fields })
    } else if (takeWord('logfmt')) stages.push({ kind: 'logfmt' })
    else if (takeWord('pattern')) stages.push({ kind: 'pattern', ...compilePattern(source, takeString()) })
    else if (takeWord('regexp')) stages.push({ kind: 'regexp', pattern: compile(source, takeString()) })
    else if (takeWord('line_format')) stages.push({ kind: 'line_format', template: takeString() })
    else {
      const field = takeName()
      const op = (['=~', '!~', '!=', '>=', '<=', '==', '=', '>', '<'] as const).find((candidate) => take(candidate))
      if (!op) fail('expected a parser, line_format, or a field filter like count > 0')
      const valueMatch = /^\s*(-?\d+(?:\.\d+)?)/.exec(rest)
      let value: string
      if (valueMatch) {
        rest = rest.slice(valueMatch[0].length)
        value = valueMatch[1]!
      } else value = takeString()
      stages.push({ kind: 'field_filter', field, op: op!, value, ...(op === '=~' || op === '!~' ? { pattern: compile(source, `^(?:${value})$`) } : {}) })
    }
  }
  return stages
}

function flatten(value: unknown, prefix: string, into: Record<string, string>) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, field] of Object.entries(value)) flatten(field, prefix ? `${prefix}_${key}` : key, into)
  } else if (prefix) into[prefix] = typeof value === 'string' ? value : JSON.stringify(value)
}

function jsonFields(line: string, wanted: { name: string; path: string }[]): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return {}
  }
  if (wanted.length === 0) {
    const all: Record<string, string> = {}
    flatten(parsed, '', all)
    return all
  }
  const fields: Record<string, string> = {}
  for (const { name, path } of wanted) {
    const value = path
      .split(/\.|(?=\[)/)
      .reduce<unknown>((node, key) => {
        if (!node || typeof node !== 'object') return undefined
        const index = /^\[(\d+)\]$/.exec(key)
        return index ? (Array.isArray(node) ? node[Number(index[1])] : undefined) : (node as Record<string, unknown>)[key]
      }, parsed)
    if (value !== undefined) fields[name] = typeof value === 'string' ? value : JSON.stringify(value)
  }
  return fields
}

const logfmtFields = (line: string) =>
  Object.fromEntries([...line.matchAll(/([\w.-]+)=(?:"((?:[^"\\]|\\.)*)"|(\S*))/g)].map((match) => [match[1]!, match[2] ?? match[3] ?? '']))

function compare(fieldValue: string | undefined, stage: Extract<Stage, { kind: 'field_filter' }>) {
  if (fieldValue === undefined) return false
  switch (stage.op) {
    case '=':
      return fieldValue === stage.value
    case '!=':
      return fieldValue !== stage.value
    case '=~':
      return stage.pattern!.test(fieldValue)
    case '!~':
      return !stage.pattern!.test(fieldValue)
    default: {
      const [left, right] = [Number(fieldValue), Number(stage.value)]
      if (Number.isNaN(left) || Number.isNaN(right)) return false
      return { '>': left > right, '>=': left >= right, '<': left < right, '<=': left <= right, '==': left === right }[stage.op]
    }
  }
}

/** The named groups that took part in the match: one that didn't is no field. */
const matchedGroups = (pattern: RegExp, line: string) =>
  Object.fromEntries(Object.entries(pattern.exec(line)?.groups ?? {}).filter((group): group is [string, string] => group[1] !== undefined))

const formatLine = (template: string, entry: LogEntry) =>
  template.replace(/\{\{\s*(?:\.([\w.]+)|(__line__))\s*\}\}/g, (_match, field: string | undefined) => (field ? (entry.fields[field] ?? '') : entry.line))

/** Runs a parsed pipeline over a command's output, one entry per line. */
export function runPipeline(stages: readonly Stage[], output: string): LogEntry[] {
  let entries: LogEntry[] = output
    .split(/\r?\n/)
    .filter((line, index, lines) => line !== '' || index < lines.length - 1)
    .map((line) => ({ line, fields: {} }))
  for (const stage of stages) {
    switch (stage.kind) {
      case 'line_filter':
        entries = entries.filter(({ line }) => {
          const matches = stage.pattern ? stage.pattern.test(line) : line.includes(stage.text)
          return stage.op === '|=' || stage.op === '|~' ? matches : !matches
        })
        break
      case 'json':
        entries = entries.map((entry) => ({ ...entry, fields: { ...entry.fields, ...jsonFields(entry.line, stage.fields) } }))
        break
      case 'logfmt':
        entries = entries.map((entry) => ({ ...entry, fields: { ...entry.fields, ...logfmtFields(entry.line) } }))
        break
      case 'pattern':
      case 'regexp':
        entries = entries.map((entry) => ({ ...entry, fields: { ...entry.fields, ...matchedGroups(stage.pattern, entry.line) } }))
        break
      case 'field_filter':
        entries = entries.filter((entry) => compare(entry.fields[stage.field], stage))
        break
      case 'line_format':
        entries = entries.map((entry) => ({ ...entry, line: formatLine(stage.template, entry) }))
        break
    }
  }
  return entries
}
