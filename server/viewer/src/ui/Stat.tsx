import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, space } from '../styles/tokens.stylex'

const styles = stylex.create({
  stat: { display: 'flex', flexDirection: 'column', gap: space.xs },
  label: { fontSize: font.sizeXs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' },
  value: { fontSize: font.size2xl, fontWeight: font.weightBold },
  hint: { fontSize: font.sizeSm, color: colors.textMuted },
})

export function Stat({ label, value, hint, testId }: { label: string; value: ReactNode; hint?: ReactNode; testId?: string }) {
  return (
    <div {...stylex.props(styles.stat)} data-testid={testId}>
      <span {...stylex.props(styles.label)}>{label}</span>
      <span {...stylex.props(styles.value)}>{value}</span>
      {hint && <span {...stylex.props(styles.hint)}>{hint}</span>}
    </div>
  )
}
