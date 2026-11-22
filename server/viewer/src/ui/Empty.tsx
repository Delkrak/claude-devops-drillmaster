import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, space } from '../styles/tokens.stylex'

const styles = stylex.create({
  empty: { padding: space.xxl, textAlign: 'center', color: colors.dim, fontFamily: font.sans, fontSize: font.sizeMd },
})

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div {...stylex.props(styles.empty)} data-testid="empty">
      {children}
    </div>
  )
}
