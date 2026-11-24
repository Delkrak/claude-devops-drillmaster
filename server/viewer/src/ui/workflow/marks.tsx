// The marks the pipeline is drawn with, in SVG: the line, its stops, work items and measures. Each
// mark that means something carries its explanation in `data-tip`, which Tip shows on hover, on
// focus with the keyboard, and on a tap. A mark that leads somewhere is a door: it opens on a click,
// Enter or Space.

import * as stylex from '@stylexjs/stylex'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { colors, font, shape } from '../../styles/tokens.stylex'
import { AXIS, branchPath, itemBoxWidth, WIDTH } from './geometry'

const styles = stylex.create({
  line: { fill: 'none', stroke: colors.line, strokeWidth: shape.lineWidth, strokeLinecap: 'round' },
  lineAhead: { stroke: colors.notReached },
  lineFaded: { stroke: colors.notReached, opacity: 0.6 },
  afterDelivery: { fill: 'none', stroke: colors.dim, strokeWidth: '2.5px', strokeDasharray: '2 7', strokeLinecap: 'round' },
  rule: { stroke: colors.rule, strokeWidth: shape.borderWidth },
  ruleDotted: { stroke: colors.rule, strokeWidth: shape.borderWidth, strokeDasharray: '2 6', strokeLinecap: 'round' },
  tick: { stroke: colors.line, strokeWidth: shape.lineWidth, strokeLinecap: 'round' },
  deliveryBar: { fill: colors.dim },
  deliveryBarAhead: { fill: colors.notReached },
  stopAlways: { fill: colors.line, stroke: colors.line, strokeWidth: '2.5px' },
  stopIf: { fill: colors.ground, stroke: colors.line, strokeWidth: '2.5px' },
  stopApprove: { fill: colors.ground, stroke: colors.sand, strokeWidth: '2.5px', strokeLinejoin: 'round' },
  reviewRing: { fill: colors.ground, stroke: colors.line, strokeWidth: '2px' },
  reviewCore: { fill: colors.line },
  skipped: { opacity: 0.28 },
  ahead: { opacity: 0.5 },
  // Filled, though see-through, so a click anywhere in the box opens it.
  boxOutline: { fill: 'transparent', stroke: colors.line, strokeWidth: '1.5px' },
  dot: { fill: colors.line },
  count: { fill: colors.line, fontFamily: font.sans, fontSize: font.sizeSm, fontWeight: font.weightHeavy },
  measureRing: { fill: colors.ground, strokeWidth: '2.5px' },
  measureCount: { fontFamily: font.sans, fontSize: font.sizeSm, fontWeight: font.weightHeavy },
  orangeRing: { stroke: colors.orange },
  orangeText: { fill: colors.orange },
  roseRing: { stroke: colors.rose },
  roseText: { fill: colors.rose },
  violetRing: { stroke: colors.violet },
  violetText: { fill: colors.violet },
  skyRing: { stroke: colors.sky },
  skyText: { fill: colors.sky },
  oldRing: { stroke: colors.dim, strokeDasharray: '3 3' },
  oldText: { fill: colors.dim },
  sentBack: { fill: colors.sand, fontFamily: font.sans, fontSize: font.sizeSm, fontWeight: font.weightHeavy },
  stageNumber: { fill: colors.dim, fontFamily: font.sans, fontSize: font.sizeSm, fontWeight: font.weightBold, letterSpacing: '2px' },
  stageName: { fill: colors.dim, fontFamily: font.sans, fontSize: font.sizeMd, fontWeight: font.weightMedium },
  stepName: { fill: colors.line, fontFamily: font.sans, fontSize: font.sizeLg, fontWeight: font.weightBold },
  stepNameDim: { fill: colors.dim },
  stepNameFaded: { fill: colors.dim, opacity: 0.55 },
  note: { fill: colors.dim, fontFamily: font.sans, fontSize: font.sizeSm },
  noteSand: { fill: colors.sand },
  noteFaded: { opacity: 0.75 },
  plainLabel: { fill: colors.dim, fontFamily: font.sans, fontSize: font.sizeMd, fontWeight: font.weightBold },
  explained: { cursor: 'help', outline: { default: 'none', ':focus-visible': `2px solid ${colors.line}` }, outlineOffset: '3px' },
  door: { cursor: 'pointer', outline: { default: 'none', ':focus-visible': `2px solid ${colors.line}` }, outlineOffset: '3px' },
  jump: { cursor: 'pointer', outline: { default: 'none', ':focus-visible': `2px solid ${colors.line}` }, outlineOffset: '-2px' },
  jumpArea: { fill: { default: 'transparent', ':hover': 'rgb(217 222 214 / 0.04)' } },
})

const explainedMarkProps = (tip: string, ...markStyles: stylex.StyleXStyles[]) => ({ ...stylex.props(...markStyles, styles.explained), 'data-tip': tip, 'aria-label': tip, role: 'img', tabIndex: 0 })

const onEnterOrSpace = (open: () => void) => (event: KeyboardEvent) => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  open()
}

const explainedOrDoorProps = (tip: string, onOpen: ((point: { x: number; y: number }) => void) | undefined) =>
  onOpen
    ? {
        ...stylex.props(styles.door),
        'data-tip': tip,
        'aria-label': tip,
        role: 'button',
        tabIndex: 0,
        // A door inside a row that jumps opens only itself.
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
          onOpen({ x: event.clientX, y: event.clientY })
        },
        onKeyDown: (event: KeyboardEvent) => {
          const markBox = (event.currentTarget as Element).getBoundingClientRect()
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
          onEnterOrSpace(() => onOpen({ x: markBox.right, y: markBox.bottom }))(event)
        },
      }
    : explainedMarkProps(tip)

export type LineTone = 'lit' | 'ahead' | 'faded'
const lineToneStyleOf = (tone: LineTone) => (tone === 'ahead' ? styles.lineAhead : tone === 'faded' ? styles.lineFaded : null)

export const Line = ({ from, to, tone = 'lit' }: { from: number; to: number; tone?: LineTone }) => (to > from ? <path d={`M${AXIS} ${from} V${to}`} {...stylex.props(styles.line, lineToneStyleOf(tone))} /> : null)
export const Branch = ({ from, to, x, tone = 'lit' }: { from: number; to: number; x: number; tone?: LineTone }) => <path d={branchPath(from, to, x)} {...stylex.props(styles.line, lineToneStyleOf(tone))} />
export const AfterDeliveryLine = ({ from, to }: { from: number; to: number }) => <path d={`M${AXIS} ${from} V${to}`} {...explainedMarkProps('after delivery', styles.afterDelivery)} />

export const StageRule = ({ y, dotted = false }: { y: number; dotted?: boolean }) => <path d={`M40 ${y + 0.5} H${WIDTH - 40}`} {...stylex.props(dotted ? styles.ruleDotted : styles.rule)} />
export const StageTick = ({ y }: { y: number }) => <path d={`M${AXIS - 8} ${y} H${AXIS + 8}`} {...stylex.props(styles.tick)} />
export const DeliveryBar = ({ y, reached = true }: { y: number; reached?: boolean }) => (
  <rect x={AXIS - 14} y={y - 2} width={28} height={4} rx={2} {...explainedMarkProps(reached ? 'delivered' : 'not delivered yet', reached ? styles.deliveryBar : styles.deliveryBarAhead)} />
)

export function StageLabel({ x, y, n, name }: { x: number; y: number; n: number; name: string }) {
  return (
    <g data-testid="stage-label">
      <text x={x} y={y} {...stylex.props(styles.stageNumber)}>
        {String(n).padStart(2, '0')}
      </text>
      <text x={x + 30} y={y} {...stylex.props(styles.stageName)}>
        {name}
      </text>
    </g>
  )
}

/** The name of a row that is not a stage, where the stages' names stand. */
export const RowName = ({ y, children }: { y: number; children: string }) => (
  <text x={44} y={y} data-testid="row-name" {...stylex.props(styles.stageName)}>
    {children}
  </text>
)

export const LineWord = ({ x, y, children }: { x: number; y: number; children: string }) => (
  <text x={x} y={y + 5} {...stylex.props(styles.plainLabel)}>
    {children}
  </text>
)

export function Jump({ y, height, label, onJump, children }: { y: number; height: number; label: string; onJump: () => void; children: ReactNode }) {
  return (
    <g role="link" tabIndex={0} aria-label={label} onClick={onJump} onKeyDown={onEnterOrSpace(onJump)} {...stylex.props(styles.jump)}>
      <rect x={30} y={y + 1} width={WIDTH - 60} height={height - 1} {...stylex.props(styles.jumpArea)} />
      {children}
    </g>
  )
}

export function Opener({ y, height, label, open, onToggle, testId, children }: { y: number; height: number; label: string; open: boolean; onToggle: () => void; testId?: string; children: ReactNode }) {
  return (
    <g role="button" tabIndex={0} aria-label={label} aria-expanded={open} data-testid={testId} onClick={onToggle} onKeyDown={onEnterOrSpace(onToggle)} {...stylex.props(styles.jump)}>
      <rect x={30} y={y - height / 2} width={WIDTH - 60} height={height} rx={8} {...stylex.props(styles.jumpArea)} />
      {children}
    </g>
  )
}

export type StopKind = 'always' | 'if' | 'approve' | 'review'

export const stopKindOf = (step: { gate: string; if: string | null }): StopKind => (step.gate === 'owner' ? 'approve' : step.gate === 'drillmaster' ? 'review' : step.if ? 'if' : 'always')
export type Reached = 'yes' | 'skipped' | 'ahead'

const STOP_TIPS: Record<StopKind, string> = {
  always: 'always runs',
  if: 'runs only if its condition holds',
  approve: 'you approve this step',
  review: 'Drillmaster reviews this step',
}

export function Stop({ x, y, kind, condition, reached = 'yes' }: { x: number; y: number; kind: StopKind; condition: string | null; reached?: Reached }) {
  const tip = condition ? `${STOP_TIPS[kind]}: ${condition}` : STOP_TIPS[kind]
  const testAttributes = { 'data-testid': 'stop', 'data-kind': kind, 'data-reached': reached }
  const fadeStyle = reached === 'skipped' ? styles.skipped : reached === 'ahead' ? styles.ahead : null
  if (kind === 'approve') return <path d={`M${x} ${y - 14} L${x + 14} ${y} L${x} ${y + 14} L${x - 14} ${y} Z`} {...explainedMarkProps(tip, styles.stopApprove, fadeStyle)} {...testAttributes} />
  if (kind === 'review') {
    return (
      <g {...explainedMarkProps(tip, fadeStyle)} {...testAttributes}>
        <circle cx={x} cy={y} r={15} {...stylex.props(styles.reviewRing)} />
        <rect x={x - 6} y={y - 6} width={12} height={12} rx={2} {...stylex.props(styles.reviewCore)} />
      </g>
    )
  }
  return <rect x={x - 9} y={y - 9} width={18} height={18} rx={4} {...explainedMarkProps(tip, kind === 'if' ? styles.stopIf : styles.stopAlways, fadeStyle)} {...testAttributes} />
}

export function StepLabel({ x, y, side, name, note, reached = 'yes', noteTone = 'dim' }: { x: number; y: number; side: 'left' | 'right'; name: string; note: string | null; reached?: Reached; noteTone?: 'dim' | 'sand' }) {
  const labelX = side === 'left' ? x - 30 : x + 30
  const textAnchor = side === 'left' ? 'end' : 'start'
  return (
    <g>
      <text x={labelX} y={y + 6} textAnchor={textAnchor} {...stylex.props(styles.stepName, reached === 'ahead' && styles.stepNameDim, reached === 'skipped' && styles.stepNameFaded)}>
        {name}
      </text>
      {note && (
        <text x={labelX} y={y + 26} textAnchor={textAnchor} data-testid="step-note" {...stylex.props(styles.note, noteTone === 'sand' && styles.noteSand, reached === 'skipped' && styles.noteFaded)}>
          {note}
        </text>
      )}
    </g>
  )
}

export function ItemBox({ dotX, y, boxText, tip, testId = 'item-box', onOpen }: { dotX: number; y: number; boxText: number | string; tip: string; testId?: string; onOpen?: (point: { x: number; y: number }) => void }) {
  const width = itemBoxWidth(boxText)
  return (
    <g data-testid={testId} {...explainedOrDoorProps(tip, onOpen)}>
      <rect x={dotX + 12 - width} y={y - 11} width={width} height={22} rx={11} {...stylex.props(styles.boxOutline)} />
      <circle cx={dotX} cy={y} r={5} {...stylex.props(styles.dot)} />
      <text x={dotX - 10} y={y + 5} textAnchor="end" {...stylex.props(styles.count)}>
        {boxText}
      </text>
    </g>
  )
}

export type MeasureTone = 'orange' | 'rose' | 'violet' | 'sky' | 'old'

const PILL_STYLES: Record<MeasureTone, { ring: stylex.StyleXStyles; text: stylex.StyleXStyles }> = {
  orange: { ring: styles.orangeRing, text: styles.orangeText },
  rose: { ring: styles.roseRing, text: styles.roseText },
  violet: { ring: styles.violetRing, text: styles.violetText },
  sky: { ring: styles.skyRing, text: styles.skyText },
  old: { ring: styles.oldRing, text: styles.oldText },
}

export interface MeasurePill {
  measure: string
  short: string
  count: number
  tone: MeasureTone
  tip: string
  onOpen?: (point: { x: number; y: number }) => void
}

const PILL_HEIGHT = 28
const PILL_GAP = 8
const pillWidth = (text: string) => 22 + Math.ceil(text.length * 7.4)

/** A pill per measure, left to right from x: its short name and count, in the measure's colour. */
export function MeasurePills({ x, y, pills }: { x: number; y: number; pills: readonly MeasurePill[] }) {
  let left = x - PILL_HEIGHT / 2
  return (
    <g>
      {pills.map((pill) => {
        const text = `${pill.short} ${pill.count}`
        const width = pillWidth(text)
        const pillLeft = left
        left += width + PILL_GAP
        return (
          <g key={pill.measure} data-testid="measure-pill" data-measure={pill.measure} {...explainedOrDoorProps(pill.tip, pill.onOpen)}>
            <rect x={pillLeft} y={y - PILL_HEIGHT / 2} width={width} height={PILL_HEIGHT} rx={PILL_HEIGHT / 2} {...stylex.props(styles.measureRing, PILL_STYLES[pill.tone].ring)} />
            <text x={pillLeft + width / 2} y={y + 5} textAnchor="middle" {...stylex.props(styles.measureCount, PILL_STYLES[pill.tone].text)}>
              {text}
            </text>
          </g>
        )
      })}
    </g>
  )
}

export function ReviewMarks({ passedX, sentBackX, y, passedCount, sentBackCount, showsPassedCount = true }: { passedX: number; sentBackX: number; y: number; passedCount: number; sentBackCount: number; showsPassedCount?: boolean }) {
  return (
    <g>
      {passedCount > 0 && (
        <text x={passedX} y={y + 5} textAnchor="end" data-testid="reviews-passed" {...explainedMarkProps(showsPassedCount ? `Drillmaster passed ${passedCount} work items here` : 'Drillmaster passed it here', styles.count)}>
          {showsPassedCount ? `✓ ${passedCount}` : '✓'}
        </text>
      )}
      {sentBackCount > 0 && (
        <text x={sentBackX} y={y + 5} data-testid="reviews-sent-back" {...explainedMarkProps(`Drillmaster sent work back ${sentBackCount} times here`, styles.sentBack)}>
          ↩ {sentBackCount}
        </text>
      )}
    </g>
  )
}
