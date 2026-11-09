import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, shape, space } from '../styles/tokens.stylex'

const styles = stylex.create({
  empty: {
    padding: space.xxl,
    textAlign: 'center',
    color: colors.textMuted,
    borderWidth: shape.borderWidth,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: shape.radiusLg,
  },
})

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div {...stylex.props(styles.empty)} data-testid="empty">
      {children}
    </div>
  )
}
