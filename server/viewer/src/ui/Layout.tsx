import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { href } from '../router'
import { colors, font, layout, shape, space } from '../styles/tokens.stylex'
import { Muted } from './Text'

const styles = stylex.create({
  root: { minHeight: '100vh', backgroundColor: colors.bg, color: colors.text, fontFamily: font.sans, fontSize: font.sizeMd, lineHeight: font.leading },
  topbar: {
    display: 'flex',
    alignItems: 'center',
    gap: space.lg,
    paddingBlock: space.md,
    paddingInline: space.xl,
    borderBottomWidth: shape.borderWidth,
    borderBottomStyle: 'solid',
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  brand: { display: 'flex', alignItems: 'center', gap: space.sm, fontWeight: font.weightBold, color: colors.text, textDecoration: 'none' },
  mark: { width: '12px', height: '12px', borderRadius: shape.radiusPill, backgroundColor: colors.accent },
  spacer: { flex: 1 },
  page: { maxWidth: layout.contentWidth, marginInline: 'auto', padding: space.xl, display: 'flex', flexDirection: 'column', gap: space.xl },
  crumbs: { display: 'flex', gap: space.sm, fontSize: font.sizeSm },
})

export function Layout({ crumbs, children }: { crumbs?: ReactNode; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.root)}>
      <header {...stylex.props(styles.topbar)}>
        <a href={href.projects()} {...stylex.props(styles.brand)}>
          <span {...stylex.props(styles.mark)} aria-hidden />
          Drillmaster
        </a>
        <span {...stylex.props(styles.spacer)} />
        <Muted>read-only, refreshes every few seconds</Muted>
      </header>
      <main {...stylex.props(styles.page)}>
        {crumbs && <nav {...stylex.props(styles.crumbs)}>{crumbs}</nav>}
        {children}
      </main>
    </div>
  )
}
