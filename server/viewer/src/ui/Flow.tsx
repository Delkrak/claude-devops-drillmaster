// The workflow drawn as columns: one per work stage, a card per work step.

import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, layout, shape, space } from '../styles/tokens.stylex'

const styles = stylex.create({
  flow: { display: 'flex', gap: space.lg, overflowX: 'auto', paddingBottom: space.sm },
  stage: { flexGrow: 0, flexShrink: 0, flexBasis: layout.columnWidth, display: 'flex', flexDirection: 'column', gap: space.sm, padding: space.md, backgroundColor: colors.surfaceSunken, borderRadius: shape.radiusLg },
  step: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
    padding: space.md,
    backgroundColor: colors.surface,
    borderWidth: shape.borderWidth,
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: shape.radiusMd,
  },
})

export const Flow = ({ children }: { children: ReactNode }) => (
  <div {...stylex.props(styles.flow)} data-testid="stages">
    {children}
  </div>
)

export const FlowStage = ({ children }: { children: ReactNode }) => (
  <div {...stylex.props(styles.stage)} data-testid="stage">
    {children}
  </div>
)

export const FlowStep = ({ children }: { children: ReactNode }) => (
  <div {...stylex.props(styles.step)} data-testid="step">
    {children}
  </div>
)
