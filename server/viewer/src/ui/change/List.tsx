import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, shape, space } from '../../styles/tokens.stylex'

const styles = stylex.create({
  list: { width: '100%', maxWidth: '900px', marginInline: 'auto', marginBlock: space.xxl, padding: 0, listStyle: 'none', fontFamily: font.sans },
  item: { borderBottomWidth: shape.borderWidth, borderBottomStyle: 'solid', borderBottomColor: colors.rule },
  row: {
    display: 'grid',
    gridTemplateColumns: '56px 1fr 130px 100px',
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
  head: { display: 'grid', gridTemplateColumns: '56px 1fr 130px 100px', columnGap: space.lg, paddingInline: space.lg, paddingBottom: space.sm, borderBottomWidth: shape.borderWidth, borderBottomStyle: 'solid', borderBottomColor: colors.rule, color: colors.dim, fontSize: '11.5px', fontWeight: font.weightHeavy, letterSpacing: '0.08em', textTransform: 'uppercase' },
  // One line, reaching left over the change column when it is longer than the numbers.
  headMeasure: { gridColumn: '3 / span 2', justifySelf: 'end', whiteSpace: 'nowrap' },
  version: { color: colors.dim, fontSize: font.sizeSm, fontWeight: font.weightHeavy, letterSpacing: '1px' },
  change: { fontSize: '15px', fontWeight: font.weightBold, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  numbers: { display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: space.sm, fontSize: '17px', fontWeight: font.weightHeavy, fontVariantNumeric: 'tabular-nums' },
  before: { color: colors.dim },
  arrow: { color: colors.dim, fontSize: font.sizeSm },
  verdict: { color: colors.dim, fontSize: '14px', fontWeight: font.weightHeavy, cursor: 'help' },
  verdictHelped: { color: colors.line },
  sand: { color: colors.sand },
  detail: { display: 'grid', gridTemplateColumns: '56px 1fr', columnGap: space.lg, paddingInline: space.lg, paddingBottom: space.lg, fontSize: '14px', lineHeight: 1.45 },
  detailBody: { gridColumn: 2, maxWidth: '640px' },
  label: { display: 'block', marginTop: space.sm, marginBottom: '2px', color: colors.dim, fontSize: '11.5px', fontWeight: font.weightHeavy, letterSpacing: '0.08em', textTransform: 'uppercase' },
  para: { marginTop: 0, marginBottom: '6px' },
  edits: { margin: 0, padding: 0, listStyle: 'none' },
  edit: { display: 'grid', gridTemplateColumns: '72px 120px 1fr', columnGap: space.sm, paddingBlock: '3px' },
  editWhat: { color: colors.dim, fontWeight: font.weightHeavy },
  editRef: { color: colors.dim },
})

/** The list, under a header that names what its numbers measure. */
export const ChangeList = ({ measure, children }: { measure: string; children: ReactNode }) => (
  <ul aria-label="changes to the workflow" {...stylex.props(styles.list)}>
    <li aria-hidden data-testid="changes-header" {...stylex.props(styles.head)}>
      <span />
      <span>change</span>
      <span {...stylex.props(styles.headMeasure)}>{measure}</span>
      <span />
    </li>
    {children}
  </ul>
)

/**
 * One change: the version it made, what it changed, its measure before → after, and the verdict in
 * a word with what it rests on in `tip`; open, it shows `children` under it.
 */
export function ChangeItem({ version, change, before, after, verdict, tip, helped, worse, open, onToggle, children }: { version: string; change: string; before: string; after: string; verdict: string; tip: string; helped: boolean; worse: boolean; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <li data-testid="change" {...stylex.props(styles.item)}>
      <button type="button" aria-expanded={open} onClick={onToggle} {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.version)}>{version}</span>
        <span title={change} {...stylex.props(styles.change)}>
          {change}
        </span>
        <span data-testid="measure" {...stylex.props(styles.numbers)}>
          <span {...stylex.props(styles.before)}>{before}</span>
          <span {...stylex.props(styles.arrow)}>→</span>
          <span {...stylex.props(worse && styles.sand)}>{after}</span>
        </span>
        <span data-tip={tip} data-testid="verdict" {...stylex.props(styles.verdict, helped && styles.verdictHelped)}>
          {verdict}
        </span>
      </button>
      {open && (
        <div data-testid="change-detail" {...stylex.props(styles.detail)}>
          <div {...stylex.props(styles.detailBody)}>{children}</div>
        </div>
      )}
    </li>
  )
}

export const DetailLabel = ({ children }: { children: ReactNode }) => <span {...stylex.props(styles.label)}>{children}</span>
export const DetailPara = ({ children }: { children: ReactNode }) => <p {...stylex.props(styles.para)}>{children}</p>
export const Edits = ({ children }: { children: ReactNode }) => <ul {...stylex.props(styles.edits)}>{children}</ul>

/** One thing the change did to the workflow: "new", "step 5.1", its name. */
export const EditLine = ({ what, refName, name }: { what: string; refName: string; name: string }) => (
  <li {...stylex.props(styles.edit)}>
    <span {...stylex.props(styles.editWhat)}>{what}</span>
    <span {...stylex.props(styles.editRef)}>{refName}</span>
    <span>{name}</span>
  </li>
)
