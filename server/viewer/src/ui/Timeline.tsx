import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, shape, space } from '../styles/tokens.stylex'
import type { Tone } from './Badge'

const styles = stylex.create({
  timeline: { display: 'flex', flexDirection: 'column', gap: space.sm },
  entry: {
    display: 'grid',
    gridTemplateColumns: '84px 1fr',
    gap: space.md,
    paddingBlock: space.sm,
    paddingInline: space.md,
    borderLeftWidth: '3px',
    borderLeftStyle: 'solid',
    borderLeftColor: colors.border,
    backgroundColor: colors.surface,
    borderTopRightRadius: shape.radiusSm,
    borderBottomRightRadius: shape.radiusSm,
  },
  time: { fontFamily: font.mono, fontSize: font.sizeXs, color: colors.textMuted },
  body: { display: 'flex', flexDirection: 'column', gap: space.xs, minWidth: 0 },
  neutral: {},
  ok: { borderLeftColor: colors.ok },
  bad: { borderLeftColor: colors.bad },
  warn: { borderLeftColor: colors.warn },
  info: { borderLeftColor: colors.info },
  accent: { borderLeftColor: colors.accent },
})

export const Timeline = ({ children }: { children: ReactNode }) => (
  <div {...stylex.props(styles.timeline)} data-testid="timeline">
    {children}
  </div>
)

export function TimelineEntry({ time, tone = 'neutral', kind, children }: { time: string; tone?: Tone; kind: string; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.entry, styles[tone])} data-testid="timeline-entry" data-kind={kind}>
      <span {...stylex.props(styles.time)}>{time}</span>
      <div {...stylex.props(styles.body)}>{children}</div>
    </div>
  )
}
