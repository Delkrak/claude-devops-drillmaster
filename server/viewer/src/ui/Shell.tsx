import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { href } from '../router'
import { colors, font, shape, space } from '../styles/tokens.stylex'

const styles = stylex.create({
  root: { minHeight: '100vh', backgroundColor: colors.ground, color: colors.line, fontFamily: font.sans },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 5,
    display: 'flex',
    alignItems: 'center',
    gap: space.lg,
    height: shape.headerHeight,
    paddingInline: space.xxl,
    backgroundColor: colors.ground,
    borderBottomWidth: shape.borderWidth,
    borderBottomStyle: 'solid',
    borderBottomColor: colors.rule,
  },
  brand: { fontFamily: font.brand, fontWeight: 800, fontSize: font.sizeBrand, letterSpacing: '0.1em', color: colors.dim, textDecoration: 'none' },
  aside: { marginInlineStart: 'auto', display: 'flex', alignItems: 'baseline', gap: space.md, color: colors.dim, fontSize: font.sizeSm },
  link: { color: colors.line, fontWeight: font.weightBold },
  hidden: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' },
})

/** Every page: the brand in the header, anything `aside` says at the header's far end, the page below. */
export function Shell({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.root)}>
      <header {...stylex.props(styles.header)}>
        <a href={href.home()} {...stylex.props(styles.brand)}>
          DRILLMASTER
        </a>
        {aside && <div {...stylex.props(styles.aside)}>{aside}</div>}
      </header>
      <main>
        <h1 {...stylex.props(styles.hidden)}>{title}</h1>
        {children}
      </main>
    </div>
  )
}

/** Which past moment a page shows, and the way back to now. */
export function MomentLabel({ at, version, nowHref }: { at: string; version: string; nowHref: string }) {
  const when = new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
  return (
    <>
      <span data-testid="moment">
        {when} UTC · workflow {version}
      </span>
      <a href={nowHref} {...stylex.props(styles.link)}>
        now
      </a>
    </>
  )
}
