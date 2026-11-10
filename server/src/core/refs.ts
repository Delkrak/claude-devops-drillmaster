import { createHash, randomUUID } from 'node:crypto'
import type { WorkflowDocument } from './workflow.js'

/**
 * One reference framework for every component of a workflow: `<kind> <name>`, such as
 * `step 1.2`, `stage 1`, `rule pr 1.1`, `policy pr`, `metric size` or `tool work_gate`. Where a
 * field fixes the kind (a step's `rules`, work_gate's `step`), the kind may be left out.
 * Behind each reference is a GUID that stays with the component across workflow versions.
 */
export const REF_KINDS = ['step', 'stage', 'rule', 'policy', 'metric', 'tool'] as const
export type RefKind = (typeof REF_KINDS)[number]

export class InvalidReference extends Error {}

export interface ParsedRef {
  kind: RefKind
  name: string
}

export interface ResolvedRef extends ParsedRef {
  /** The reference as Drillmaster writes it, e.g. "step 1.2". */
  ref: string
  /** Null for a tool, which has no versions. */
  guid: string | null
  /** What the component is called, e.g. "run the tests". */
  title: string
}

const isRefKind = (word: string): word is RefKind => (REF_KINDS as readonly string[]).includes(word)

const STEP_NAME = /^(\d+)\.(\d+)$/
const STAGE_NAME = /^\d+$/

export const stepName = (stage: number, step: number) => `${stage}.${step}`

export function parseRef(text: string, impliedKind?: RefKind): ParsedRef {
  const words = text.trim().split(/\s+/)
  const [first, ...rest] = words
  if (impliedKind && first === impliedKind && rest.length) return { kind: impliedKind, name: rest.join(' ') }
  if (impliedKind) return { kind: impliedKind, name: words.join(' ') }
  if (first && isRefKind(first) && rest.length) return { kind: first, name: rest.join(' ') }
  throw new InvalidReference(`"${text}" is not a reference. Write <kind> <name>, e.g. "step 1.2" or "rule pr 1.1"; the kinds are ${REF_KINDS.join(', ')}.`)
}

/** Where a work step is, from its name "1.2". */
export function stepPosition(name: string): { stage: number; step: number } | undefined {
  const match = STEP_NAME.exec(name.trim())
  return match ? { stage: Number(match[1]), step: Number(match[2]) } : undefined
}

export interface ResolveOptions {
  impliedKind?: RefKind
  /** The tools a `tool` reference may name. */
  toolNames?: readonly string[]
}

export function resolveRef(workflow: WorkflowDocument, text: string, options: ResolveOptions = {}): ResolvedRef {
  const { kind, name } = parseRef(text, options.impliedKind)
  const missing = (what: string) => new InvalidReference(`There is no ${what} in workflow ${workflow.version}.`)
  switch (kind) {
    case 'step': {
      const position = stepPosition(name)
      if (!position) throw new InvalidReference(`"${name}" is not a work step: write it as <stage>.<step>, e.g. "1.2".`)
      const step = workflow.stages.find((stage) => stage.n === position.stage)?.steps.find((candidate) => candidate.n === position.step)
      if (!step) throw missing(`step ${name}`)
      return { kind, name, ref: `step ${name}`, guid: step.guid, title: step.name }
    }
    case 'stage': {
      if (!STAGE_NAME.test(name)) throw new InvalidReference(`"${name}" is not a work stage: write its number, e.g. "1".`)
      const stage = workflow.stages.find((candidate) => candidate.n === Number(name))
      if (!stage) throw missing(`stage ${name}`)
      return { kind, name, ref: `stage ${name}`, guid: stage.guid, title: stage.name }
    }
    case 'rule': {
      const [policyName, ruleId, ...extra] = name.split(' ')
      const policy = workflow.policies.find((candidate) => candidate.name === policyName)
      const rule = extra.length === 0 ? policy?.rules.find((candidate) => candidate.id === ruleId) : undefined
      if (!rule) throw missing(`rule "${name}"`)
      return { kind, name, ref: `rule ${name}`, guid: rule.guid, title: rule.rule }
    }
    case 'policy': {
      const policy = workflow.policies.find((candidate) => candidate.name === name)
      if (!policy) throw missing(`policy "${name}"`)
      return { kind, name, ref: `policy ${name}`, guid: policy.guid, title: name }
    }
    case 'metric': {
      const metric = workflow.metrics.find((candidate) => candidate.name === name)
      if (!metric) throw missing(`metric "${name}"`)
      return { kind, name, ref: `metric ${name}`, guid: metric.guid, title: metric.instruction }
    }
    case 'tool': {
      if (!options.toolNames?.includes(name)) throw new InvalidReference(`There is no Drillmaster tool "${name}"${options.toolNames ? `; the tools are ${options.toolNames.join(', ')}` : ''}.`)
      return { kind, name, ref: `tool ${name}`, guid: null, title: name }
    }
  }
}

/** What a GUID is called in this workflow version, or undefined when the version has no such component. */
export function refOfGuid(workflow: WorkflowDocument, guid: string): ResolvedRef | undefined {
  for (const stage of workflow.stages) {
    if (stage.guid === guid) return { kind: 'stage', name: String(stage.n), ref: `stage ${stage.n}`, guid, title: stage.name }
    for (const step of stage.steps) {
      if (step.guid === guid) return { kind: 'step', name: stepName(stage.n, step.n), ref: `step ${stepName(stage.n, step.n)}`, guid, title: step.name }
    }
  }
  for (const policy of workflow.policies) {
    if (policy.guid === guid) return { kind: 'policy', name: policy.name, ref: `policy ${policy.name}`, guid, title: policy.name }
    for (const rule of policy.rules) {
      if (rule.guid === guid) return { kind: 'rule', name: `${policy.name} ${rule.id}`, ref: `rule ${policy.name} ${rule.id}`, guid, title: rule.rule }
    }
  }
  const metric = workflow.metrics.find((candidate) => candidate.guid === guid)
  return metric ? { kind: 'metric', name: metric.name, ref: `metric ${metric.name}`, guid, title: metric.instruction } : undefined
}

export const stepGuidAt = (workflow: WorkflowDocument, stage: number, step: number) =>
  workflow.stages.find((candidate) => candidate.n === stage)?.steps.find((candidate) => candidate.n === step)?.guid

export const newGuid = (): string => randomUUID()

/** The same seed always gives the same GUID, so a document from before GUIDs reads the same every time. */
export function guidFromSeed(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
