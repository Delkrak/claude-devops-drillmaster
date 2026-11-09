import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, shape, space } from '../styles/tokens.stylex'
import { Heading } from './Text'

const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderWidth: shape.borderWidth,
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: shape.radiusLg,
    boxShadow: shape.shadowCard,
    minWidth: 0,
  },
  header: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md },
  subtitle: { color: colors.textMuted, fontSize: font.sizeSm },
})

export function Card({ title, subtitle, actions, children, testId }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section {...stylex.props(styles.card)} data-testid={testId}>
      {(title || actions) && (
        <header {...stylex.props(styles.header)}>
          <div>
            {title && <Heading level={2}>{title}</Heading>}
            {subtitle && <div {...stylex.props(styles.subtitle)}>{subtitle}</div>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}
