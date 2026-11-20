// One work item's route: rows of drawing, each followed by what Owner opened under it. The line runs
// on through the opened text, so the route never breaks.

import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, shape, space } from '../../styles/tokens.stylex'
import type { LineTone } from '../workflow/marks'

const lineThrough = (color: string) => ({
  backgroundImage: `linear-gradient(${color}, ${color})`,
  backgroundSize: `${shape.lineWidth} 100%`,
  backgroundPosition: 'center top',
  backgroundRepeat: 'no-repeat',
})

const styles = stylex.create({
  column: { width: '100%', maxWidth: shape.pipelineWidth, marginInline: 'auto', paddingTop: space.xxl, paddingBottom: `calc(50vh - 120px)` },
  under: { display: 'flow-root', paddingBottom: space.lg },
  underLit: lineThrough(colors.line),
  underAhead: lineThrough(colors.ahead),
  text: {
    // Under the step's name: from (AXIS + 30) / WIDTH of the drawing, 390 drawing units wide.
    marginInlineStart: '53.333%',
    width: '43.333%',
    color: colors.line,
    fontFamily: font.sans,
    fontSize: '14px',
    lineHeight: 1.45,
  },
  level: { paddingTop: space.xs, paddingBottom: space.sm },
  nextLevel: { borderTopWidth: shape.borderWidth, borderTopStyle: 'solid', borderTopColor: colors.panelRule, paddingTop: space.md, marginTop: space.xs },
  label: { display: 'block', marginTop: space.sm, marginBottom: '2px', color: colors.dim, fontSize: '11.5px', fontWeight: font.weightHeavy, letterSpacing: '0.08em', textTransform: 'uppercase' },
  sand: { color: colors.sand },
  orange: { color: colors.orange },
  para: { marginTop: 0, marginBottom: '6px' },
  quiet: { color: colors.dim },
  quote: { fontWeight: font.weightBold },
  kept: { margin: 0, marginBottom: space.sm, color: colors.dim, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: font.sizeXs, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  more: {
    marginTop: '6px',
    paddingBlock: space.xs,
    paddingInline: space.md,
    borderRadius: '14px',
    borderWidth: shape.borderWidth,
    borderStyle: 'solid',
    borderColor: { default: colors.rule, ':hover': colors.dim, ':focus-visible': colors.line },
    outline: 'none',
    backgroundColor: 'transparent',
    color: colors.line,
    fontFamily: font.sans,
    fontSize: font.sizeSm,
    fontWeight: font.weightHeavy,
    cursor: 'pointer',
  },
  call: { display: 'grid', gridTemplateColumns: '44px 1fr', columnGap: space.sm, paddingBlock: '3px', borderBottomWidth: shape.borderWidth, borderBottomStyle: 'solid', borderBottomColor: colors.panelRule, fontSize: '12.5px' },
  callTime: { color: colors.dim },
  callTool: { fontWeight: font.weightHeavy },
  callDid: { gridColumn: 2, color: colors.dim, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '11.5px', overflowWrap: 'anywhere' },
})

export const RouteColumn = ({ children }: { children: ReactNode }) => <div {...stylex.props(styles.column)}>{children}</div>

/** What Owner opened under a row, with the line running on beside it in the tone below the row. */
export function UnderRow({ tone, children }: { tone: LineTone; children: ReactNode }) {
  return <div {...stylex.props(styles.under, tone === 'lit' ? styles.underLit : styles.underAhead)}>{children}</div>
}

/** The text opened under one step, right of the line, under the step's name. */
export const UnderStep = ({ testId, children }: { testId?: string; children: ReactNode }) => (
  <section data-testid={testId} {...stylex.props(styles.text)}>
    {children}
  </section>
)

/** One level of what is opened; each deeper level is set off by a rule. */
export const Level = ({ deeper = false, children }: { deeper?: boolean; children: ReactNode }) => <div {...stylex.props(styles.level, deeper && styles.nextLevel)}>{children}</div>

export const Label = ({ tone, children }: { tone?: 'sand' | 'orange'; children: ReactNode }) => <span {...stylex.props(styles.label, tone === 'sand' && styles.sand, tone === 'orange' && styles.orange)}>{children}</span>
export const Para = ({ quiet = false, children }: { quiet?: boolean; children: ReactNode }) => <p {...stylex.props(styles.para, quiet && styles.quiet)}>{children}</p>
export const Quote = ({ children }: { children: ReactNode }) => <p {...stylex.props(styles.para, styles.quote)}>“{children}”</p>
/** Lines as a tool printed them. */
export const Kept = ({ lines }: { lines: readonly string[] }) => <pre {...stylex.props(styles.kept)}>{lines.join('\n')}</pre>

/** The button that opens the next level down. */
export const Deeper = ({ onOpen, children }: { onOpen: () => void; children: ReactNode }) => (
  <button type="button" onClick={onOpen} {...stylex.props(styles.more)}>
    {children}
  </button>
)

export function CallLine({ time, tool, failed, did }: { time: string; tool: string; failed: boolean; did: string }) {
  return (
    <div data-testid="call" {...stylex.props(styles.call)}>
      <span {...stylex.props(styles.callTime)}>{time}</span>
      <span {...stylex.props(styles.callTool)}>
        {tool}
        {failed && <span {...stylex.props(styles.sand)}> failed</span>}
      </span>
      <span {...stylex.props(styles.callDid)}>{did}</span>
    </div>
  )
}
