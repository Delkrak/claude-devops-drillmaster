// The marks the pipeline is drawn with, in SVG: the line, its stops, work items and friction. Each
// mark that means something carries its explanation in `data-tip`, which Tip shows on hover.

import * as stylex from '@stylexjs/stylex'
import { colors, font, shape } from '../../styles/tokens.stylex'
import { AXIS, branch, itemBoxWidth, WIDTH } from './geometry'

const styles = stylex.create({
  line: { fill: 'none', stroke: colors.line, strokeWidth: shape.lineWidth, strokeLinecap: 'round' },
  afterDelivery: { fill: 'none', stroke: colors.dim, strokeWidth: '2.5px', strokeDasharray: '2 7', strokeLinecap: 'round' },
  rule: { stroke: colors.rule, strokeWidth: shape.borderWidth },
  ruleDotted: { stroke: colors.rule, strokeWidth: shape.borderWidth, strokeDasharray: '2 6', strokeLinecap: 'round' },
  tick: { stroke: colors.line, strokeWidth: shape.lineWidth, strokeLinecap: 'round' },
  deliveryBar: { fill: colors.dim },
  stopAlways: { fill: colors.line, stroke: colors.line, strokeWidth: '2.5px' },
  stopIf: { fill: colors.ground, stroke: colors.line, strokeWidth: '2.5px' },
  stopApprove: { fill: colors.ground, stroke: colors.sand, strokeWidth: '2.5px', strokeLinejoin: 'round' },
  reviewRing: { fill: colors.ground, stroke: colors.line, strokeWidth: '2px' },
  reviewCore: { fill: colors.line },
  boxOutline: { fill: 'none', stroke: colors.line, strokeWidth: '1.5px' },
  dot: { fill: colors.line },
  count: { fill: colors.line, fontFamily: font.sans, fontSize: font.sizeSm, fontWeight: font.weightHeavy },
  frictionRing: { fill: colors.ground, stroke: colors.orange, strokeWidth: '2.5px' },
  frictionCount: { fill: colors.orange, fontFamily: font.sans, fontSize: font.sizeSm, fontWeight: font.weightHeavy },
  sentBack: { fill: colors.sand, fontFamily: font.sans, fontSize: font.sizeSm, fontWeight: font.weightHeavy },
  stageNumber: { fill: colors.dim, fontFamily: font.sans, fontSize: font.sizeSm, fontWeight: font.weightBold, letterSpacing: '2px' },
  stageName: { fill: colors.dim, fontFamily: font.sans, fontSize: font.sizeMd, fontWeight: font.weightMedium },
  stepName: { fill: colors.line, fontFamily: font.sans, fontSize: font.sizeLg, fontWeight: font.weightBold },
  condition: { fill: colors.dim, fontFamily: font.sans, fontSize: font.sizeSm },
})

const explained = (tip: string) => ({ 'data-tip': tip, role: 'img', 'aria-label': tip, style: { cursor: 'help' } })

export const Line = ({ from, to }: { from: number; to: number }) => (to > from ? <path d={`M${AXIS} ${from} V${to}`} {...stylex.props(styles.line)} /> : null)
export const Branch = ({ from, to, x }: { from: number; to: number; x: number }) => <path d={branch(from, to, x)} {...stylex.props(styles.line)} />
export const AfterDeliveryLine = ({ from, to }: { from: number; to: number }) => <path d={`M${AXIS} ${from} V${to}`} {...stylex.props(styles.afterDelivery)} {...explained('after delivery')} />

/** The line between two stages, or, dotted, between delivery and what came after it. */
export const StageRule = ({ y, dotted = false }: { y: number; dotted?: boolean }) => <path d={`M40 ${y + 0.5} H${WIDTH - 40}`} {...stylex.props(dotted ? styles.ruleDotted : styles.rule)} />
export const StageTick = ({ y }: { y: number }) => <path d={`M${AXIS - 8} ${y} H${AXIS + 8}`} {...stylex.props(styles.tick)} />
export const DeliveryBar = ({ y }: { y: number }) => <rect x={AXIS - 14} y={y - 2} width={28} height={4} rx={2} {...stylex.props(styles.deliveryBar)} {...explained('delivered')} />

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

export type StopKind = 'always' | 'if' | 'approve' | 'review'

const STOP_TIPS: Record<StopKind, string> = {
  always: 'always runs',
  if: 'runs only if its condition holds',
  approve: 'you approve this step',
  review: 'Drillmaster reviews this step',
}

export function Stop({ x, y, kind, condition }: { x: number; y: number; kind: StopKind; condition: string | null }) {
  const tip = condition ? `${STOP_TIPS[kind]}: ${condition}` : STOP_TIPS[kind]
  const mark = { 'data-testid': 'stop', 'data-kind': kind, ...explained(tip) }
  if (kind === 'approve') return <path d={`M${x} ${y - 14} L${x + 14} ${y} L${x} ${y + 14} L${x - 14} ${y} Z`} {...stylex.props(styles.stopApprove)} {...mark} />
  if (kind === 'review') {
    return (
      <g {...mark}>
        <circle cx={x} cy={y} r={15} {...stylex.props(styles.reviewRing)} />
        <rect x={x - 6} y={y - 6} width={12} height={12} rx={2} {...stylex.props(styles.reviewCore)} />
      </g>
    )
  }
  return <rect x={x - 9} y={y - 9} width={18} height={18} rx={4} {...stylex.props(kind === 'if' ? styles.stopIf : styles.stopAlways)} {...mark} />
}

/** A step's name beside its stop, with its condition under it; on the left of a stop for the left branch. */
export function StepLabel({ x, y, side, name, condition }: { x: number; y: number; side: 'left' | 'right'; name: string; condition: string | null }) {
  const labelX = side === 'left' ? x - 30 : x + 30
  const anchor = side === 'left' ? 'end' : 'start'
  return (
    <g>
      <text x={labelX} y={y + 6} textAnchor={anchor} {...stylex.props(styles.stepName)}>
        {name}
      </text>
      {condition && (
        <text x={labelX} y={y + 26} textAnchor={anchor} {...stylex.props(styles.condition)}>
          if {condition}
        </text>
      )}
    </g>
  )
}

/** Work items as an aggregate: a rounded box with the count left of a dot at `dotX`. */
export function ItemBox({ dotX, y, count, tip, testId = 'item-box' }: { dotX: number; y: number; count: number; tip: string; testId?: string }) {
  const width = itemBoxWidth(count)
  return (
    <g data-testid={testId} {...explained(tip)}>
      <rect x={dotX + 12 - width} y={y - 11} width={width} height={22} rx={11} {...stylex.props(styles.boxOutline)} />
      <circle cx={dotX} cy={y} r={5} {...stylex.props(styles.dot)} />
      <text x={dotX - 10} y={y + 5} textAnchor="end" {...stylex.props(styles.count)}>
        {count}
      </text>
    </g>
  )
}

/** Where Owner had to step in: an orange ring with the count. */
export function FrictionRing({ x, y, count, tip }: { x: number; y: number; count: number; tip: string }) {
  return (
    <g data-testid="friction-ring" {...explained(tip)}>
      <circle cx={x} cy={y} r={14} {...stylex.props(styles.frictionRing)} />
      <text x={x} y={y + 5} textAnchor="middle" {...stylex.props(styles.frictionCount)}>
        {count}
      </text>
    </g>
  )
}

/** Drillmaster's reviews at a step: passed on the work-item side, sent back on the problem side. */
export function ReviewMarks({ passedX, sentBackX, y, passed, sentBack }: { passedX: number; sentBackX: number; y: number; passed: number; sentBack: number }) {
  return (
    <g>
      {passed > 0 && (
        <text x={passedX} y={y + 5} textAnchor="end" data-testid="reviews-passed" {...stylex.props(styles.count)} {...explained(`Drillmaster passed ${passed} work items here`)}>
          ✓ {passed}
        </text>
      )}
      {sentBack > 0 && (
        <text x={sentBackX} y={y + 5} data-testid="reviews-sent-back" {...stylex.props(styles.sentBack)} {...explained(`Drillmaster sent work back ${sentBack} times here`)}>
          ↩ {sentBack}
        </text>
      )}
    </g>
  )
}
