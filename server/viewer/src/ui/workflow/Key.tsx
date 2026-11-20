import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, shape, space } from '../../styles/tokens.stylex'

const styles = stylex.create({
  key: {
    position: 'fixed',
    right: space.xl,
    bottom: space.lg,
    zIndex: 4,
    display: 'flex',
    flexDirection: 'column',
    gap: '7px',
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: shape.radiusLg,
    backgroundColor: colors.keyGround,
    borderWidth: shape.borderWidth,
    borderStyle: 'solid',
    borderColor: colors.rule,
    color: colors.dim,
    fontFamily: font.sans,
    fontSize: font.sizeXs,
    fontWeight: font.weightBold,
  },
  entry: { display: 'flex', alignItems: 'center', gap: space.sm },
  sand: { color: colors.sand },
  orange: { color: colors.orange },
  lineFill: { fill: colors.line },
  lineStroke: { fill: 'none', stroke: colors.line, strokeWidth: '1.6px' },
  sandStroke: { fill: 'none', stroke: colors.sand, strokeWidth: '1.8px' },
  orangeStroke: { fill: 'none', stroke: colors.orange, strokeWidth: '2px' },
  dimFill: { fill: colors.dim },
  dimDotted: { stroke: colors.dim, strokeWidth: '2px', strokeDasharray: '2 4' },
  glyph: { fontFamily: font.sans, fontSize: font.sizeSm, fontWeight: font.weightHeavy, fill: colors.line },
  sandGlyph: { fill: colors.sand },
})

function Entry({ swatch, word, tone }: { swatch: ReactNode; word: string; tone?: 'sand' | 'orange' }) {
  return (
    <span {...stylex.props(styles.entry, tone === 'sand' && styles.sand, tone === 'orange' && styles.orange)}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        {swatch}
      </svg>
      {word}
    </span>
  )
}

/** One word for each symbol of the pipeline. */
export function Key() {
  return (
    <aside aria-label="key" data-testid="key" {...stylex.props(styles.key)}>
      <Entry swatch={<rect x="4" y="4" width="10" height="10" rx="2.5" {...stylex.props(styles.lineFill)} />} word="always" />
      <Entry swatch={<rect x="4" y="4" width="10" height="10" rx="2.5" {...stylex.props(styles.lineStroke)} />} word="if" />
      <Entry swatch={<path d="M9 2 L16 9 L9 16 L2 9 Z" {...stylex.props(styles.sandStroke)} />} word="you approve" tone="sand" />
      <Entry
        swatch={
          <>
            <circle cx="9" cy="9" r="7" {...stylex.props(styles.lineStroke)} />
            <rect x="6" y="6" width="6" height="6" rx="1" {...stylex.props(styles.lineFill)} />
          </>
        }
        word="Drillmaster reviews"
      />
      <Entry swatch={<text x="9" y="14" textAnchor="middle" {...stylex.props(styles.glyph)}>✓</text>} word="Drillmaster passed" />
      <Entry swatch={<text x="9" y="14" textAnchor="middle" {...stylex.props(styles.glyph, styles.sandGlyph)}>↩</text>} word="Drillmaster sent back" tone="sand" />
      <Entry swatch={<circle cx="9" cy="9" r="4.5" {...stylex.props(styles.lineFill)} />} word="work item" />
      <Entry swatch={<circle cx="9" cy="9" r="6.5" {...stylex.props(styles.orangeStroke)} />} word="you stepped in" tone="orange" />
      <Entry swatch={<rect x="3" y="8" width="12" height="3" rx="1.5" {...stylex.props(styles.dimFill)} />} word="delivered" />
      <Entry swatch={<path d="M9 1 V17" {...stylex.props(styles.dimDotted)} />} word="after delivery" />
    </aside>
  )
}
