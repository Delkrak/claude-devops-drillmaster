import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, shape, space } from '../styles/tokens.stylex'

const styles = stylex.create({
  wrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: font.sizeSm },
  th: {
    textAlign: 'left',
    fontWeight: font.weightMedium,
    color: colors.textMuted,
    paddingBlock: space.sm,
    paddingInline: space.md,
    borderBottomWidth: shape.borderWidth,
    borderBottomStyle: 'solid',
    borderBottomColor: colors.border,
    whiteSpace: 'nowrap',
  },
  td: {
    paddingBlock: space.sm,
    paddingInline: space.md,
    borderBottomWidth: shape.borderWidth,
    borderBottomStyle: 'solid',
    borderBottomColor: colors.border,
    verticalAlign: 'top',
  },
  linked: { cursor: 'pointer', backgroundColor: { default: 'transparent', ':hover': colors.surfaceSunken } },
})

export interface Column<T> {
  header: string
  cell: (row: T) => ReactNode
}

/** A table whose rows can link somewhere: clicking a row follows its href. */
export function Table<T>({ rows, columns, rowKey, rowHref, testId }: { rows: readonly T[]; columns: Column<T>[]; rowKey: (row: T) => string; rowHref?: (row: T) => string; testId?: string }) {
  return (
    <div {...stylex.props(styles.wrap)}>
      <table {...stylex.props(styles.table)} data-testid={testId}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} {...stylex.props(styles.th)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const target = rowHref?.(row)
            return (
              <tr key={rowKey(row)} data-href={target} onClick={target ? () => (window.location.hash = target) : undefined} {...stylex.props(target !== undefined && styles.linked)}>
                {columns.map((c) => (
                  <td key={c.header} {...stylex.props(styles.td)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
