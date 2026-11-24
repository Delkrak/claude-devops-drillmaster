import type { ShownMeasure } from '../types'
import type { MeasureTone } from '../ui/workflow/marks'

const TONES: readonly string[] = ['orange', 'rose', 'violet', 'sky'] satisfies MeasureTone[]

/** A measure's colour, as the workflow defines it; old friction is drawn dim. */
export function toneOfMeasure(measures: readonly ShownMeasure[], name: string): MeasureTone {
  const measure = measures.find((candidate) => candidate.name === name)
  return measure && !measure.old && TONES.includes(measure.color) ? (measure.color as MeasureTone) : 'old'
}

export const shortOfMeasure = (measures: readonly ShownMeasure[], name: string) => measures.find((measure) => measure.name === name)?.short ?? '?'

export const timesWord = (count: number) => (count === 1 ? 'once' : `${count} times`)

/** What a measure's ring says on hover: how often, where, and what the measure counts. */
export function measureTip(measures: readonly ShownMeasure[], name: string, count: number, where: string) {
  const definition = measures.find((measure) => measure.name === name)?.definition
  return `${name} ${timesWord(count)} ${where}${definition ? `. ${name}: ${definition}` : ''}`
}

/** The key's entries for the measures that left a mark on the page, in the key's order. */
export const keyMeasuresOf = (measures: readonly ShownMeasure[], measuresWithMarks: ReadonlySet<string>) =>
  measures
    .filter((measure) => measuresWithMarks.has(measure.name))
    .map((measure) => ({ name: measure.name, short: measure.short, definition: measure.definition, tone: toneOfMeasure(measures, measure.name) }))
