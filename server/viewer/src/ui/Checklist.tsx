import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, shape, space } from '../styles/tokens.stylex'

const styles = stylex.create({
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: space.xs },
  item: { display: 'flex', gap: space.sm, alignItems: 'baseline', fontSize: font.sizeSm },
  box: {
    flexShrink: 0,
    width: '0.9em',
    height: '0.9em',
    borderWidth: shape.borderWidth,
    borderStyle: 'solid',
    borderColor: colors.textMuted,
    borderRadius: shape.radiusSm,
    transform: 'translateY(0.1em)',
  },
})

export const Checklist = ({ children, testId }: { children: ReactNode; testId?: string }) => (
  <ul {...stylex.props(styles.list)} data-testid={testId}>
    {children}
  </ul>
)

export const ChecklistItem = ({ children }: { children: ReactNode }) => (
  <li {...stylex.props(styles.item)}>
    <span {...stylex.props(styles.box)} aria-hidden="true" />
    <span>{children}</span>
  </li>
)
