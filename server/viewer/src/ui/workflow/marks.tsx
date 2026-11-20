// The marks the pipeline is drawn with, in SVG: the line, its stops, work items and friction. Each
// mark that means something carries its explanation in `data-tip`, which Tip shows on hover, on
// focus with the keyboard, and on a tap. A mark that leads somewhere is a door: it opens on a click,
// Enter or Space.

import * as stylex from '@stylexjs/stylex'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { colors, font, shape } from '../../styles/tokens.stylex'
import { AXIS, branch, itemBoxWidth, WIDTH } from './geometry'

const styles = stylex.create({
  line: { fill: 'none', stroke: colors.line, strokeWidth: shape.lineWidth, strokeLinecap: 'round' },
  lineAhead: { stroke: colors.ahead },
  lineFaded: { stroke: colors.ahead, opacity: 0.6 },
  afterDelivery: { fill: 'none', stroke: colors.dim, strokeWidth: '2.5px', strokeDasharray: '2 7', strokeLinecap: 'round' },
  rule: { stroke: colors.rule, strokeWidth: shape.borderWidth },
  ruleDotted: { stroke: colors.rule, strokeWidth: shape.borderWidth, strokeDasharray: '2 6', strokeLinecap: 'round' },
  tick: { stroke: colors.line, strokeWidth: shape.lineWidth, strokeLinecap: 'round' },
  deliveryBar: { fill: colors.dim },
  deliveryBarAhead: { fill: colors.ahead },
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
  frictionRing: { fill: colors.ground, stroke: colors.orange, strokeWidth: '2.5px' },
  frictionCount: { fill: colors.orange, fontFamily: font.sans, fontSize: font.sizeSm, fontWeight: font.weightHeavy },
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

/** A mark with an explanation: reachable with the keyboard, and read out by a screen reader. */
const marked = (tip: string, ...look: stylex.StyleXStyles[]) => ({ ...stylex.props(...look, styles.explained), 'data-tip': tip, 'aria-label': tip, role: 'img', tabIndex: 0 })

const onEnterOrSpace = (open: () => void) => (event: KeyboardEvent) => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  open()
}

/** A mark that is a door when `onOpen` is given, else only explained. */
const markedOrDoor = (tip: string, onOpen: ((at: { x: number; y: number }) => void) | undefined) =>
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
          const box = (event.currentTarget as Element).getBoundingClientRect()
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
          onEnterOrSpace(() => onOpen({ x: box.right, y: box.bottom }))(event)
        },
      }
    : marked(tip)

/** Where the line runs: lit where a work item has been, dim where it has not been yet, faded on a branch it did not take. */
export type LineTone = 'lit' | 'ahead' | 'faded'
const toneOf = (tone: LineTone) => (tone === 'ahead' ? styles.lineAhead : tone === 'faded' ? styles.lineFaded : null)

export const Line = ({ from, to, tone = 'lit' }: { from: number; to: number; tone?: LineTone }) => (to > from ? <path d={`M${AXIS} ${from} V${to}`} {...stylex.props(styles.line, toneOf(tone))} /> : null)
export const Branch = ({ from, to, x, tone = 'lit' }: { from: number; to: number; x: number; tone?: LineTone }) => <path d={branch(from, to, x)} {...stylex.props(styles.line, toneOf(tone))} />
export const AfterDeliveryLine = ({ from, to }: { from: number; to: number }) => <path d={`M${AXIS} ${from} V${to}`} {...marked('after delivery', styles.afterDelivery)} />

/** The line between two stages, or, dotted, between delivery and what came after it. */
export const StageRule = ({ y, dotted = false }: { y: number; dotted?: boolean }) => <path d={`M40 ${y + 0.5} H${WIDTH - 40}`} {...stylex.props(dotted ? styles.ruleDotted : styles.rule)} />
export const StageTick = ({ y }: { y: number }) => <path d={`M${AXIS - 8} ${y} H${AXIS + 8}`} {...stylex.props(styles.tick)} />
export const DeliveryBar = ({ y, reached = true }: { y: number; reached?: boolean }) => (
  <rect x={AXIS - 14} y={y - 2} width={28} height={4} rx={2} {...marked(reached ? 'delivered' : 'not delivered yet', reached ? styles.deliveryBar : styles.deliveryBarAhead)} />
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

/** A word on the line, such as "delivered", in the stage names' dim. */
export const LineWord = ({ x, y, children }: { x: number; y: number; children: string }) => (
  <text x={x} y={y + 5} {...stylex.props(styles.plainLabel)}>
    {children}
  </text>
)

/** A row that jumps to where its stage is drawn in full: by click, tap, Enter or Space. */
export function Jump({ y, height, label, onJump, children }: { y: number; height: number; label: string; onJump: () => void; children: ReactNode }) {
  return (
    <g role="link" tabIndex={0} aria-label={label} onClick={onJump} onKeyDown={onEnterOrSpace(onJump)} {...stylex.props(styles.jump)}>
      <rect x={30} y={y + 1} width={WIDTH - 60} height={height - 1} {...stylex.props(styles.jumpArea)} />
      {children}
    </g>
  )
}

/** A row that opens what is under it, and closes it again: by click, tap, Enter or Space. */
export function Opener({ y, height, label, open, onToggle, testId, children }: { y: number; height: number; label: string; open: boolean; onToggle: () => void; testId?: string; children: ReactNode }) {
  return (
    <g role="button" tabIndex={0} aria-label={label} aria-expanded={open} data-testid={testId} onClick={onToggle} onKeyDown={onEnterOrSpace(onToggle)} {...stylex.props(styles.jump)}>
      <rect x={30} y={y - height / 2} width={WIDTH - 60} height={height} rx={8} {...stylex.props(styles.jumpArea)} />
      {children}
    </g>
  )
}

export type StopKind = 'always' | 'if' | 'approve' | 'review'

/** A step's stop: who checks it, or whether it always runs. */
export const stopKindOf = (step: { gate: string; if: string | null }): StopKind => (step.gate === 'owner' ? 'approve' : step.gate === 'drillmaster' ? 'review' : step.if ? 'if' : 'always')
/** How far a work item got at a stop: through it, past it without running it, or not yet. */
export type Reached = 'yes' | 'skipped' | 'ahead'

const STOP_TIPS: Record<StopKind, string> = {
  always: 'always runs',
  if: 'runs only if its condition holds',
  approve: 'you approve this step',
  review: 'Drillmaster reviews this step',
}

export function Stop({ x, y, kind, condition, reached = 'yes' }: { x: number; y: number; kind: StopKind; condition: string | null; reached?: Reached }) {
  const tip = condition ? `${STOP_TIPS[kind]}: ${condition}` : STOP_TIPS[kind]
  const testIds = { 'data-testid': 'stop', 'data-kind': kind, 'data-reached': reached }
  const fade = reached === 'skipped' ? styles.skipped : reached === 'ahead' ? styles.ahead : null
  if (kind === 'approve') return <path d={`M${x} ${y - 14} L${x + 14} ${y} L${x} ${y + 14} L${x - 14} ${y} Z`} {...marked(tip, styles.stopApprove, fade)} {...testIds} />
  if (kind === 'review') {
    return (
      <g {...marked(tip, fade)} {...testIds}>
        <circle cx={x} cy={y} r={15} {...stylex.props(styles.reviewRing)} />
        <rect x={x - 6} y={y - 6} width={12} height={12} rx={2} {...stylex.props(styles.reviewCore)} />
      </g>
    )
  }
  return <rect x={x - 9} y={y - 9} width={18} height={18} rx={4} {...marked(tip, kind === 'if' ? styles.stopIf : styles.stopAlways, fade)} {...testIds} />
}

/** A step's name beside its stop, with a note under it in plain words; on the left of a stop for the left branch. */
export function StepLabel({ x, y, side, name, note, reached = 'yes', noteTone = 'dim' }: { x: number; y: number; side: 'left' | 'right'; name: string; note: string | null; reached?: Reached; noteTone?: 'dim' | 'sand' }) {
  const labelX = side === 'left' ? x - 30 : x + 30
  const anchor = side === 'left' ? 'end' : 'start'
  return (
    <g>
      <text x={labelX} y={y + 6} textAnchor={anchor} {...stylex.props(styles.stepName, reached === 'ahead' && styles.stepNameDim, reached === 'skipped' && styles.stepNameFaded)}>
        {name}
      </text>
      {note && (
        <text x={labelX} y={y + 26} textAnchor={anchor} data-testid="step-note" {...stylex.props(styles.note, noteTone === 'sand' && styles.noteSand, reached === 'skipped' && styles.noteFaded)}>
          {note}
        </text>
      )}
    </g>
  )
}

/** Work items as an aggregate: a rounded box with the count, or one work item's number, left of a dot at `dotX`. */
export function ItemBox({ dotX, y, count, tip, testId = 'item-box', onOpen }: { dotX: number; y: number; count: number | string; tip: string; testId?: string; onOpen?: (at: { x: number; y: number }) => void }) {
  const width = itemBoxWidth(count)
  return (
    <g data-testid={testId} {...markedOrDoor(tip, onOpen)}>
      <rect x={dotX + 12 - width} y={y - 11} width={width} height={22} rx={11} {...stylex.props(styles.boxOutline)} />
      <circle cx={dotX} cy={y} r={5} {...stylex.props(styles.dot)} />
      <text x={dotX - 10} y={y + 5} textAnchor="end" {...stylex.props(styles.count)}>
        {count}
      </text>
    </g>
  )
}

/** Where Owner had to step in: an orange ring with the count. */
export function FrictionRing({ x, y, count, tip, onOpen }: { x: number; y: number; count: number; tip: string; onOpen?: (at: { x: number; y: number }) => void }) {
  return (
    <g data-testid="friction-ring" {...markedOrDoor(tip, onOpen)}>
      <circle cx={x} cy={y} r={14} {...stylex.props(styles.frictionRing)} />
      <text x={x} y={y + 5} textAnchor="middle" {...stylex.props(styles.frictionCount)}>
        {count}
      </text>
    </g>
  )
}

/** Drillmaster's reviews at a step: passed on the work-item side, sent back on the problem side. */
export function ReviewMarks({ passedX, sentBackX, y, passed, sentBack, counted = true }: { passedX: number; sentBackX: number; y: number; passed: number; sentBack: number; counted?: boolean }) {
  return (
    <g>
      {passed > 0 && (
        <text x={passedX} y={y + 5} textAnchor="end" data-testid="reviews-passed" {...marked(counted ? `Drillmaster passed ${passed} work items here` : 'Drillmaster passed it here', styles.count)}>
          {counted ? `✓ ${passed}` : '✓'}
        </text>
      )}
      {sentBack > 0 && (
        <text x={sentBackX} y={y + 5} data-testid="reviews-sent-back" {...marked(`Drillmaster sent work back ${sentBack} times here`, styles.sentBack)}>
          ↩ {sentBack}
        </text>
      )}
    </g>
  )
}
