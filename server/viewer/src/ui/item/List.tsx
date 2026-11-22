import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, shape, space } from '../../styles/tokens.stylex'

const styles = stylex.create({
  list: { width: '100%', maxWidth: '900px', marginInline: 'auto', marginBlock: space.xxl, padding: 0, listStyle: 'none', fontFamily: font.sans },
  row: {
    display: 'grid',
    gridTemplateColumns: '18px 56px 72px 1fr 200px 32px',
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
  ring: {
    boxSizing: 'border-box',
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    borderWidth: '2.5px',
    borderStyle: 'solid',
    borderColor: colors.orange,
    color: colors.orange,
    fontSize: font.sizeSm,
    fontWeight: font.weightHeavy,
    display: 'grid',
    placeItems: 'center',
  },
})

export const ItemList = ({ label, children }: { label: string; children: ReactNode }) => (
  <ul aria-label={label} {...stylex.props(styles.list)}>
    {children}
  </ul>
)

export function ItemRow({ itemHref, issue, kind, summary, where, delivered, frictionCount }: { itemHref: string; issue: string; kind: string | null; summary: string; where: ReactNode; delivered: boolean; frictionCount: number }) {
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
        {frictionCount > 0 ? (
          <span data-tip={`you stepped in ${frictionCount === 1 ? 'once' : `${frictionCount} times`}`} aria-label={`you stepped in ${frictionCount} times`} {...stylex.props(styles.ring)}>
            {frictionCount}
          </span>
        ) : (
          <span />
        )}
      </a>
    </li>
  )
}
