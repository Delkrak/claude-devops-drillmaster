import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, shape, space } from '../../styles/tokens.stylex'
import type { MeasureTone } from './marks'

const styles = stylex.create({
  key: {
    position: 'fixed',
    right: space.xl,
    bottom: space.lg,
    zIndex: 4,
    display: 'flex',
    flexDirection: 'column',
    gap: '7px',
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: shape.radiusLg,
    backgroundColor: colors.keyGround,
    borderWidth: shape.borderWidth,
    borderStyle: 'solid',
    borderColor: colors.rule,
    color: colors.dim,
    fontFamily: font.sans,
    fontSize: font.sizeXs,
    fontWeight: font.weightBold,
  },
  entry: { display: 'flex', alignItems: 'center', gap: space.sm },
  sand: { color: colors.sand },
  orange: { color: colors.orange },
  rose: { color: colors.rose },
  violet: { color: colors.violet },
  sky: { color: colors.sky },
  old: { color: colors.dim },
  lineFill: { fill: colors.line },
  lineStroke: { fill: 'none', stroke: colors.line, strokeWidth: '1.6px' },
  sandStroke: { fill: 'none', stroke: colors.sand, strokeWidth: '1.8px' },
  orangeStroke: { fill: 'none', stroke: colors.orange, strokeWidth: '2px' },
  roseStroke: { fill: 'none', stroke: colors.rose, strokeWidth: '2px' },
  violetStroke: { fill: 'none', stroke: colors.violet, strokeWidth: '2px' },
  skyStroke: { fill: 'none', stroke: colors.sky, strokeWidth: '2px' },
  pillText: { fontFamily: font.sans, fontSize: '9px', fontWeight: font.weightHeavy, fill: 'currentColor' },
  oldStroke: { fill: 'none', stroke: colors.dim, strokeWidth: '2px', strokeDasharray: '2.5 2.5' },
  dimFill: { fill: colors.dim },
  dimDotted: { stroke: colors.dim, strokeWidth: '2px', strokeDasharray: '2 4' },
  glyph: { fontFamily: font.sans, fontSize: font.sizeSm, fontWeight: font.weightHeavy, fill: colors.line },
  sandGlyph: { fill: colors.sand },
  faded: { opacity: 0.28 },
  notReachedLine: { stroke: colors.notReached, strokeWidth: '3px' },
})

type KeyTone = 'sand' | MeasureTone

function KeyEntry({ swatch, word, tone, tip, swatchWidth = 18 }: { swatch: ReactNode; word: string; tone?: KeyTone; tip?: string; swatchWidth?: number }) {
  return (
    <span data-tip={tip} {...stylex.props(styles.entry, tone && styles[tone])}>
      <svg width={swatchWidth} height="18" viewBox={`0 0 ${swatchWidth} 18`} aria-hidden>
        {swatch}
      </svg>
      {word}
    </span>
  )
}

export type KeyMark = 'always' | 'if' | 'approve' | 'review' | 'passed' | 'sentBack' | 'skipped' | 'ahead' | 'workItem' | 'here' | 'delivered' | 'afterDelivery'

const KEY_ENTRIES: Record<KeyMark, { swatch: ReactNode; word: string; tone?: KeyTone }> = {
  always: { swatch: <rect x="4" y="4" width="10" height="10" rx="2.5" {...stylex.props(styles.lineFill)} />, word: 'always' },
  if: { swatch: <rect x="4" y="4" width="10" height="10" rx="2.5" {...stylex.props(styles.lineStroke)} />, word: 'if' },
  approve: { swatch: <path d="M9 2 L16 9 L9 16 L2 9 Z" {...stylex.props(styles.sandStroke)} />, word: 'you approve', tone: 'sand' },
  review: {
    swatch: (
      <>
        <circle cx="9" cy="9" r="7" {...stylex.props(styles.lineStroke)} />
        <rect x="6" y="6" width="6" height="6" rx="1" {...stylex.props(styles.lineFill)} />
      </>
    ),
    word: 'Drillmaster reviews',
  },
  passed: { swatch: <text x="9" y="14" textAnchor="middle" {...stylex.props(styles.glyph)}>✓</text>, word: 'Drillmaster passed' },
  sentBack: { swatch: <text x="9" y="14" textAnchor="middle" {...stylex.props(styles.glyph, styles.sandGlyph)}>↩</text>, word: 'Drillmaster sent back', tone: 'sand' },
  skipped: { swatch: <rect x="4" y="4" width="10" height="10" rx="2.5" {...stylex.props(styles.lineFill, styles.faded)} />, word: 'skipped' },
  ahead: { swatch: <path d="M9 1 V17" {...stylex.props(styles.notReachedLine)} />, word: 'not reached yet' },
  workItem: { swatch: <circle cx="9" cy="9" r="4.5" {...stylex.props(styles.lineFill)} />, word: 'work item' },
  here: { swatch: <circle cx="9" cy="9" r="4.5" {...stylex.props(styles.lineFill)} />, word: 'where it is now' },
  delivered: { swatch: <rect x="3" y="8" width="12" height="3" rx="1.5" {...stylex.props(styles.dimFill)} />, word: 'delivered' },
  afterDelivery: { swatch: <path d="M9 1 V17" {...stylex.props(styles.dimDotted)} />, word: 'after delivery' },
}

const PILL_STROKES: Record<MeasureTone, stylex.StyleXStyles> = { orange: styles.orangeStroke, rose: styles.roseStroke, violet: styles.violetStroke, sky: styles.skyStroke, old: styles.oldStroke }
const KEY_PILL_WIDTH = 30

const WORKFLOW_MARKS: KeyMark[] = ['always', 'if', 'approve', 'review', 'passed', 'sentBack', 'workItem', 'delivered', 'afterDelivery']
/** The measures' rings come after the marks of the work and before delivery. */
const MARKS_BEFORE_MEASURES = new Set<KeyMark>(['always', 'if', 'approve', 'review', 'passed', 'sentBack', 'skipped', 'ahead', 'workItem', 'here'])

export interface KeyMeasure {
  name: string
  short: string
  definition: string
  tone: MeasureTone
}

export function Key({ marks = WORKFLOW_MARKS, measures = [] }: { marks?: readonly KeyMark[]; measures?: readonly KeyMeasure[] }) {
  const shownMarks = (Object.keys(KEY_ENTRIES) as KeyMark[]).filter((mark) => marks.includes(mark))
  const entryOf = (mark: KeyMark) => <KeyEntry key={mark} {...KEY_ENTRIES[mark]} />
  return (
    <aside aria-label="key" data-testid="key" {...stylex.props(styles.key)}>
      {shownMarks.filter((mark) => MARKS_BEFORE_MEASURES.has(mark)).map(entryOf)}
      {measures.map((measure) => (
        <KeyEntry
          key={`measure-${measure.name}`}
          swatchWidth={KEY_PILL_WIDTH}
          swatch={
            <>
              <rect x="1" y="2" width={KEY_PILL_WIDTH - 2} height="14" rx="7" {...stylex.props(PILL_STROKES[measure.tone])} />
              <text x={KEY_PILL_WIDTH / 2} y="12.5" textAnchor="middle" {...stylex.props(styles.pillText)}>
                {measure.short}
              </text>
            </>
          }
          word={measure.name}
          tone={measure.tone}
          tip={`${measure.name}: ${measure.definition}`}
        />
      ))}
      {shownMarks.filter((mark) => !MARKS_BEFORE_MEASURES.has(mark)).map(entryOf)}
    </aside>
  )
}
