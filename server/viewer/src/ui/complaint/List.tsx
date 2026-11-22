import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, shape, space } from '../../styles/tokens.stylex'

const COLUMNS = '170px 56px 1fr'

const styles = stylex.create({
  list: { width: '100%', maxWidth: '900px', marginInline: 'auto', marginBlock: space.xxl, padding: 0, listStyle: 'none', fontFamily: font.sans },
  head: { display: 'grid', gridTemplateColumns: COLUMNS, columnGap: space.lg, paddingInline: space.lg, paddingBottom: space.sm, borderBottomWidth: shape.borderWidth, borderBottomStyle: 'solid', borderBottomColor: colors.rule, color: colors.dim, fontSize: '11.5px', fontWeight: font.weightHeavy, letterSpacing: '0.08em', textTransform: 'uppercase' },
  headCount: { textAlign: 'end' },
  item: { borderBottomWidth: shape.borderWidth, borderBottomStyle: 'solid', borderBottomColor: colors.rule },
  row: {
    display: 'grid',
    gridTemplateColumns: COLUMNS,
    alignItems: 'center',
    columnGap: space.lg,
    width: '100%',
    minHeight: '52px',
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderWidth: 0,
    borderStyle: 'none',
    outline: 'none',
    backgroundColor: { default: 'transparent', ':hover': 'rgb(217 222 214 / 0.04)', ':focus-visible': 'rgb(217 222 214 / 0.08)' },
    color: colors.line,
    fontFamily: font.sans,
    textAlign: 'start',
    cursor: 'pointer',
  },
  tool: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '14px', fontWeight: font.weightHeavy },
  gap: { color: colors.dim, fontSize: '14px', fontWeight: font.weightHeavy },
  count: { fontSize: '17px', fontWeight: font.weightHeavy, fontVariantNumeric: 'tabular-nums', textAlign: 'end' },
  countFriction: { color: colors.orange },
  latest: { fontSize: '14px', color: colors.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  detail: { display: 'grid', gridTemplateColumns: COLUMNS, columnGap: space.lg, paddingInline: space.lg, paddingBottom: space.lg },
  complaints: { gridColumn: '3', margin: 0, padding: 0, listStyle: 'none', fontSize: '14px', lineHeight: 1.45 },
  complaint: { paddingBlock: space.sm, borderTopWidth: shape.borderWidth, borderTopStyle: 'solid', borderTopColor: colors.panelRule },
  who: { display: 'flex', gap: space.sm, marginBottom: '2px', color: colors.dim, fontSize: '11.5px', fontWeight: font.weightHeavy, letterSpacing: '0.08em', textTransform: 'uppercase' },
  link: { color: colors.line },
  text: { margin: 0 },
})

/** The list, under a header that says what its columns are. */
export const ComplaintList = ({ children }: { children: ReactNode }) => (
  <ul aria-label="complaints about Drillmaster" {...stylex.props(styles.list)}>
    <li aria-hidden {...stylex.props(styles.head)}>
      <span>tool</span>
      <span {...stylex.props(styles.headCount)}>heard</span>
      <span>latest</span>
    </li>
    {children}
  </ul>
)

/**
 * One tool, or `gap` for step-ins no workflow step covers: how often it was complained about, the
 * latest complaint on one line; open, `children` under it.
 */
export function ComplaintGroup({ name, gap = false, count, latest, open, onToggle, children }: { name: string; gap?: boolean; count: number; latest: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <li data-testid="complaint-group" {...stylex.props(styles.item)}>
      <button type="button" aria-expanded={open} onClick={onToggle} {...stylex.props(styles.row)}>
        <span {...stylex.props(gap ? styles.gap : styles.tool)}>{name}</span>
        <span data-testid="heard" {...stylex.props(styles.count, gap && styles.countFriction)}>
          {count}
        </span>
        <span title={latest} {...stylex.props(styles.latest)}>
          {latest}
        </span>
      </button>
      {open && (
        <div {...stylex.props(styles.detail)}>
          <ul data-testid="complaints" {...stylex.props(styles.complaints)}>
            {children}
          </ul>
        </div>
      )}
    </li>
  )
}

/** One complaint in full: who made it, on which work item (a link), when, and what it says. */
export function ComplaintLine({ who, issue, to, when, text }: { who: string; issue: string; to: string; when: string; text: string }) {
  return (
    <li {...stylex.props(styles.complaint)}>
      <span {...stylex.props(styles.who)}>
        <span>{who}</span>
        <a href={to} {...stylex.props(styles.link)}>
          {issue}
        </a>
        <span>{when}</span>
      </span>
      <p {...stylex.props(styles.text)}>{text}</p>
    </li>
  )
}
