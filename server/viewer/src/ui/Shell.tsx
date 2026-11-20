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
    height: shape.headerHeight,
    paddingInline: space.xxl,
    backgroundColor: colors.ground,
    borderBottomWidth: shape.borderWidth,
    borderBottomStyle: 'solid',
    borderBottomColor: colors.rule,
  },
  brand: { fontFamily: font.brand, fontWeight: 800, fontSize: font.sizeBrand, letterSpacing: '0.1em', color: colors.dim, textDecoration: 'none' },
})

/** Every page: the brand in the header, the page below it. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div {...stylex.props(styles.root)}>
      <header {...stylex.props(styles.header)}>
        <a href={href.home()} {...stylex.props(styles.brand)}>
          DRILLMASTER
        </a>
      </header>
      <main>{children}</main>
    </div>
  )
}
