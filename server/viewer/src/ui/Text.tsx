import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font } from '../styles/tokens.stylex'

const styles = stylex.create({
  h1: { fontSize: font.sizeXl, lineHeight: 1.25, fontWeight: font.weightBold },
  h2: { fontSize: font.sizeLg, lineHeight: 1.25, fontWeight: font.weightBold },
  h3: { fontSize: font.sizeMd, lineHeight: 1.25, fontWeight: font.weightBold },
  muted: { color: colors.textMuted, fontSize: font.sizeSm },
  strong: { fontWeight: font.weightBold },
  code: { fontFamily: font.mono, fontSize: font.sizeSm },
  pre: { fontFamily: font.mono, fontSize: font.sizeSm, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  link: { color: colors.accent, textDecoration: { default: 'none', ':hover': 'underline' } },
})

export function Heading({ level, children, testId }: { level: 1 | 2 | 3; children: ReactNode; testId?: string }) {
  const Tag = `h${level}` as const
  return (
    <Tag {...stylex.props(styles[Tag])} data-testid={testId}>
      {children}
    </Tag>
  )
}

export const Muted = ({ children, title }: { children: ReactNode; title?: string }) => (
  <span {...stylex.props(styles.muted)} title={title}>
    {children}
  </span>
)

export const Strong = ({ children }: { children: ReactNode }) => <strong {...stylex.props(styles.strong)}>{children}</strong>

export const Code = ({ children }: { children: ReactNode }) => <code {...stylex.props(styles.code)}>{children}</code>

export const Pre = ({ children }: { children: ReactNode }) => <pre {...stylex.props(styles.pre)}>{children}</pre>

export const Link = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} {...stylex.props(styles.link)}>
    {children}
  </a>
)
