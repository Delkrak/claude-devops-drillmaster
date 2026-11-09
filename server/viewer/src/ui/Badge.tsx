import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, shape, space } from '../styles/tokens.stylex'

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'accent'

const styles = stylex.create({
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.xs,
    paddingBlock: '1px',
    paddingInline: space.sm,
    borderRadius: shape.radiusPill,
    fontSize: font.sizeXs,
    fontWeight: font.weightMedium,
    whiteSpace: 'nowrap',
  },
  neutral: { backgroundColor: colors.neutralSoft, color: colors.text },
  ok: { backgroundColor: colors.okSoft, color: colors.ok },
  warn: { backgroundColor: colors.warnSoft, color: colors.warn },
  bad: { backgroundColor: colors.badSoft, color: colors.bad },
  info: { backgroundColor: colors.infoSoft, color: colors.info },
  accent: { backgroundColor: colors.accentSoft, color: colors.accent },
})

export function Badge({ tone = 'neutral', children, testId }: { tone?: Tone; children: ReactNode; testId?: string }) {
  return (
    <span {...stylex.props(styles.badge, styles[tone])} data-testid={testId} data-tone={tone}>
      {children}
    </span>
  )
}
