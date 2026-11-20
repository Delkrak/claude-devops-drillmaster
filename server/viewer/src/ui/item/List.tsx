import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, shape, space } from '../../styles/tokens.stylex'

const styles = stylex.create({
  list: { width: '100%', maxWidth: '640px', marginInline: 'auto', marginBlock: space.xxl, padding: 0, listStyle: 'none', fontFamily: font.sans },
  row: {
    display: 'grid',
    gridTemplateColumns: '18px 72px 80px 1fr 32px',
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

/** One work item in the list: its dot (dim once delivered), number, kind, where it is, and how often Owner stepped in. */
export function ItemRow({ to, issue, kind, where, delivered, friction }: { to: string; issue: string; kind: string | null; where: ReactNode; delivered: boolean; friction: number }) {
  return (
    <li>
      <a href={to} data-testid="item-row" {...stylex.props(styles.row)}>
        <span aria-hidden {...stylex.props(styles.dot, delivered && styles.dotDelivered)} />
        <span {...stylex.props(styles.issue)}>{issue}</span>
        <span {...stylex.props(styles.kind)}>{kind}</span>
        <span {...stylex.props(styles.where)}>{where}</span>
        {friction > 0 ? (
          <span data-tip={`you stepped in ${friction === 1 ? 'once' : `${friction} times`}`} aria-label={`you stepped in ${friction} times`} {...stylex.props(styles.ring)}>
            {friction}
          </span>
        ) : (
          <span />
        )}
      </a>
    </li>
  )
}
