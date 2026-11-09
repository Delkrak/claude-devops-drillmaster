import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { space } from '../styles/tokens.stylex'

const styles = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: space.md, minWidth: 0 },
  stackTight: { gap: space.xs },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  grid: { display: 'grid', gap: space.lg, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' },
  gridNarrow: { gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' },
})

export const Stack = ({ children, tight, testId }: { children: ReactNode; tight?: boolean; testId?: string }) => (
  <div {...stylex.props(styles.stack, tight && styles.stackTight)} data-testid={testId}>
    {children}
  </div>
)

export const Row = ({ children, testId }: { children: ReactNode; testId?: string }) => (
  <div {...stylex.props(styles.row)} data-testid={testId}>
    {children}
  </div>
)

export const Grid = ({ children, narrow }: { children: ReactNode; narrow?: boolean }) => <div {...stylex.props(styles.grid, narrow && styles.gridNarrow)}>{children}</div>
