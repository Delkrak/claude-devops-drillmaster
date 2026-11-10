import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, type ReactNode } from 'react'
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
  time: { fontFamily: font.mono, fontSize: font.sizeXs, color: colors.textMuted, textDecoration: 'none' },
  highlighted: { outlineWidth: '2px', outlineStyle: 'solid', outlineColor: colors.accent },
  stepBar: {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
    paddingBlock: space.xs,
    paddingInline: space.md,
    borderRadius: shape.radiusSm,
    backgroundColor: colors.accentSoft,
    color: colors.accent,
    fontSize: font.sizeSm,
    fontWeight: font.weightMedium,
  },
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

/** Marks where the work moved on to another work step, so every entry below it is at that step. */
export const StepBar = ({ children }: { children: ReactNode }) => (
  <div {...stylex.props(styles.stepBar)} data-testid="step-bar" role="separator">
    {children}
  </div>
)

/** One entry. Its time links to the entry itself; a highlighted entry is scrolled into view. */
export function TimelineEntry({ time, tone = 'neutral', kind, link, highlighted = false, children }: { time: string; tone?: Tone; kind: string; link?: string; highlighted?: boolean; children: ReactNode }) {
  const entry = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (highlighted) entry.current?.scrollIntoView({ block: 'center' })
  }, [highlighted])
  return (
    <div ref={entry} {...stylex.props(styles.entry, styles[tone], highlighted && styles.highlighted)} data-testid="timeline-entry" data-kind={kind} data-highlighted={highlighted || undefined}>
      {link ? (
        <a href={link} {...stylex.props(styles.time)} title="Link to this entry">
          {time}
        </a>
      ) : (
        <span {...stylex.props(styles.time)}>{time}</span>
      )}
      <div {...stylex.props(styles.body)}>{children}</div>
    </div>
  )
}
