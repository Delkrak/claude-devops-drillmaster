import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, shape, space } from '../../styles/tokens.stylex'

const styles = stylex.create({
  title: { display: 'flex', alignItems: 'baseline', gap: '14px', paddingInline: '44px', paddingBottom: '6px', fontFamily: font.sans },
  issue: { margin: 0, color: colors.line, fontSize: '30px', fontWeight: font.weightHeavy },
  kind: { color: colors.dim, fontSize: '16px', fontWeight: font.weightBold },
  state: { marginInlineStart: 'auto', color: colors.dim, fontSize: font.sizeMd, fontWeight: font.weightBold },
  description: {
    margin: 0,
    paddingInline: '44px',
    paddingBottom: '26px',
    color: colors.dim,
    fontFamily: font.sans,
    fontSize: '14px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    borderBottomWidth: shape.borderWidth,
    borderBottomStyle: 'solid',
    borderBottomColor: colors.rule,
  },
  strong: { color: colors.line },
  gap: { height: space.xs },
})

/** A work item's number, kind and state above its route, its description on one line under them. */
export function ItemTitle({ issue, kind, state, description }: { issue: string; kind: string | null; state: ReactNode; description: string }) {
  return (
    <header>
      <div {...stylex.props(styles.title)}>
        <h2 {...stylex.props(styles.issue)}>{issue}</h2>
        {kind && <span {...stylex.props(styles.kind)}>{kind}</span>}
        <span data-testid="item-state" {...stylex.props(styles.state)}>
          {state}
        </span>
      </div>
      <p title={description} {...stylex.props(styles.description)}>
        {description}
      </p>
    </header>
  )
}

/** The part of a state that matters most, such as the time or the step. */
export const Strong = ({ children }: { children: ReactNode }) => <b {...stylex.props(styles.strong)}>{children}</b>
