import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, shape, space } from '../../styles/tokens.stylex'
import type { MeasureTone } from '../workflow/marks'

const styles = stylex.create({
  list: { width: '100%', maxWidth: '900px', marginInline: 'auto', marginBlock: space.xxl, padding: 0, listStyle: 'none', fontFamily: font.sans },
  row: {
    display: 'grid',
    gridTemplateColumns: '18px 56px 72px 1fr 200px 150px',
    alignItems: 'center',
    minHeight: '46px',
    columnGap: space.md,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderBottomWidth: shape.borderWidth,
    borderBottomStyle: 'solid',
    borderBottomColor: colors.rule,
    color: colors.line,
    textDecoration: 'none',
    outline: 'none',
    backgroundColor: { default: 'transparent', ':hover': 'rgb(217 222 214 / 0.04)', ':focus-visible': 'rgb(217 222 214 / 0.08)' },
  },
  dot: { width: '10px', height: '10px', borderRadius: '50%', backgroundColor: colors.line },
  dotDelivered: { backgroundColor: colors.dim },
  issue: { fontSize: '17px', fontWeight: font.weightHeavy },
  kind: { color: colors.dim, fontSize: font.sizeMd, fontWeight: font.weightBold },
  summary: { color: colors.line, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  where: { color: colors.dim, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  pills: { display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' },
  pill: {
    boxSizing: 'border-box',
    height: '26px',
    paddingInline: '9px',
    borderRadius: '13px',
    whiteSpace: 'nowrap',
    borderWidth: '2.5px',
    borderStyle: 'solid',
    fontSize: font.sizeSm,
    fontWeight: font.weightHeavy,
    display: 'grid',
    placeItems: 'center',
  },
  orange: { borderColor: colors.orange, color: colors.orange },
  rose: { borderColor: colors.rose, color: colors.rose },
  violet: { borderColor: colors.violet, color: colors.violet },
  sky: { borderColor: colors.sky, color: colors.sky },
  old: { borderColor: colors.dim, borderStyle: 'dashed', color: colors.dim },
})

export interface RowPill {
  measure: string
  short: string
  count: number
  tone: MeasureTone
  tip: string
}

export const ItemList = ({ label, children }: { label: string; children: ReactNode }) => (
  <ul aria-label={label} {...stylex.props(styles.list)}>
    {children}
  </ul>
)

export function ItemRow({ itemHref, issue, kind, summary, where, delivered, pills }: { itemHref: string; issue: string; kind: string | null; summary: string; where: ReactNode; delivered: boolean; pills: readonly RowPill[] }) {
  return (
    <li>
      <a href={itemHref} data-testid="item-row" {...stylex.props(styles.row)}>
        <span aria-hidden {...stylex.props(styles.dot, delivered && styles.dotDelivered)} />
        <span {...stylex.props(styles.issue)}>{issue}</span>
        <span {...stylex.props(styles.kind)}>{kind}</span>
        <span title={summary} {...stylex.props(styles.summary)}>
          {summary}
        </span>
        <span {...stylex.props(styles.where)}>{where}</span>
        <span {...stylex.props(styles.pills)}>
          {pills.map((pill) => (
            <span key={pill.measure} data-testid="measure-pill" data-measure={pill.measure} data-tip={pill.tip} aria-label={pill.tip} {...stylex.props(styles.pill, styles[pill.tone])}>
              {pill.short} {pill.count}
            </span>
          ))}
        </span>
      </a>
    </li>
  )
}
