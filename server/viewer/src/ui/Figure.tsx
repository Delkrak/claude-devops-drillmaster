import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, shape, space } from '../styles/tokens.stylex'

const styles = stylex.create({
  figure: { margin: 0, display: 'flex', flexDirection: 'column', gap: space.xs, minWidth: 0 },
  image: {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '28rem',
    objectFit: 'contain',
    backgroundColor: colors.surfaceSunken,
    borderWidth: shape.borderWidth,
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: shape.radiusMd,
  },
  caption: { color: colors.textMuted, fontSize: font.sizeSm, overflowWrap: 'anywhere' },
})

export const Figure = ({ src, alt, caption, testId }: { src: string; alt: string; caption: ReactNode; testId?: string }) => (
  <figure {...stylex.props(styles.figure)} data-testid={testId}>
    <img src={src} alt={alt} loading="lazy" {...stylex.props(styles.image)} />
    <figcaption {...stylex.props(styles.caption)}>{caption}</figcaption>
  </figure>
)
