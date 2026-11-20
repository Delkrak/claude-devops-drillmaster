import * as stylex from '@stylexjs/stylex'
import { useState, type FormEvent, type ReactNode } from 'react'
import { href } from '../router'
import { colors, font, shape, space } from '../styles/tokens.stylex'
import { dayAndTime } from '../time'

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
  aside: { marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: space.lg, color: colors.dim, fontSize: font.sizeSm },
  link: { color: colors.line, fontWeight: font.weightBold },
  find: {
    width: '96px',
    height: '30px',
    paddingInline: space.md,
    borderRadius: '15px',
    borderWidth: shape.borderWidth,
    borderStyle: 'solid',
    borderColor: { default: colors.rule, ':focus-visible': colors.dim },
    outline: 'none',
    backgroundColor: 'transparent',
    color: colors.line,
    fontFamily: font.sans,
    fontSize: '14px',
    fontWeight: font.weightBold,
    '::placeholder': { color: colors.dim },
  },
  notFound: { color: colors.sand },
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

export const HeaderLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <a href={to} {...stylex.props(styles.link)}>
    {children}
  </a>
)

/** Which past moment a page shows, and the way back to now. */
export function MomentLabel({ at, version, nowHref }: { at: string; version?: string; nowHref: string }) {
  return (
    <>
      <span data-testid="moment">
        {dayAndTime(at)} UTC{version ? ` · workflow ${version}` : ''}
      </span>
      <HeaderLink to={nowHref}>now</HeaderLink>
    </>
  )
}

/** A box to type a work item's number into; `find` says where it is, or null when there is none. */
export function FindBox({ find }: { find: (number: string) => Promise<string | null> }) {
  const [missing, setMissing] = useState<string | null>(null)
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const typed = new FormData(event.currentTarget).get('number')?.toString().replace(/\D/g, '') ?? ''
    if (!typed) return
    const to = await find(typed)
    if (to) {
      setMissing(null)
      window.location.hash = to
    } else setMissing(typed)
  }
  return (
    <form role="search" onSubmit={onSubmit}>
      {missing && <span {...stylex.props(styles.notFound)}>no #{missing} </span>}
      <input name="number" inputMode="numeric" placeholder="# find" aria-label="find a work item by its number" {...stylex.props(styles.find)} />
    </form>
  )
}
