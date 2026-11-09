// Small, pure formatting helpers shared by the views.

import type { GateKind } from './types'
import type { Tone } from './ui/Badge'

export function time(iso: string | null | undefined) {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export const number = (value: number | null | undefined) => (value === null || value === undefined ? '-' : String(Math.round(value * 100) / 100))

export const position = (stage: number | null, step: number | null) => (stage === null ? '-' : `${stage}.${step}`)

export const measureLabel = (name: string) => name.replace(/_per_item$/, ' / item').replace(/_/g, ' ')

export const gateTone: Record<GateKind, Tone> = { self: 'neutral', drillmaster: 'accent', owner: 'info' }

export const gateLabel: Record<GateKind, string> = { self: 'Self gate', drillmaster: 'Drillmaster gate', owner: 'Owner gate' }
