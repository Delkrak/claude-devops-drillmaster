import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { shape } from '../../styles/tokens.stylex'
import { WIDTH } from './geometry'

const styles = stylex.create({
  column: { width: '100%', maxWidth: shape.pipelineWidth, marginInline: 'auto', paddingBottom: `calc(50vh - 120px)` },
  firstScreen: { minHeight: `calc(100vh - ${shape.headerHeight})`, display: 'flex', alignItems: 'center' },
  drawing: { display: 'block', width: '100%', height: 'auto', overflow: 'visible' },
})

/** The pipeline's one column; it scrolls until its end reaches the middle of the screen. */
export const PipelineColumn = ({ children }: { children: ReactNode }) => <div {...stylex.props(styles.column)}>{children}</div>

/** A screen of its own, so the overview never shares the view with the walkthrough. */
export const FirstScreen = ({ children, testId }: { children: ReactNode; testId: string }) => (
  <section data-testid={testId} {...stylex.props(styles.firstScreen)}>
    {children}
  </section>
)

/** One part of the drawing, scaled to the column's width. */
export const Drawing = ({ height, children, testId }: { height: number; children: ReactNode; testId?: string }) => (
  <svg viewBox={`0 0 ${WIDTH} ${height}`} data-testid={testId} {...stylex.props(styles.drawing)}>
    {children}
  </svg>
)
