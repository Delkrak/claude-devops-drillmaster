import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef } from 'react'
import { colors, font, shape, space } from '../../styles/tokens.stylex'

const styles = stylex.create({
  picker: {
    position: 'fixed',
    zIndex: 8,
    minWidth: '160px',
    maxWidth: '320px',
    margin: 0,
    paddingBlock: space.sm,
    paddingInline: 0,
    listStyle: 'none',
    borderRadius: shape.radiusLg,
    borderWidth: shape.borderWidth,
    borderStyle: 'solid',
    borderColor: colors.rule,
    backgroundColor: colors.keyGround,
    fontFamily: font.sans,
    fontSize: '14px',
  },
  title: { paddingInline: space.lg, paddingBottom: space.xs, color: colors.dim, fontSize: font.sizeXs, fontWeight: font.weightHeavy },
  link: {
    display: 'block',
    paddingBlock: space.xs,
    paddingInline: space.lg,
    color: colors.line,
    fontWeight: font.weightBold,
    textDecoration: 'none',
    outline: 'none',
    backgroundColor: { default: 'transparent', ':hover': colors.rule, ':focus-visible': colors.rule },
  },
})

const PICKER_WIDTH = 220
const CLOSING_SCROLL_DISTANCE = 40

export function Picker({ title, items, point, onClose }: { title: string; items: readonly { label: string; to: string }[]; point: { x: number; y: number }; onClose: () => void }) {
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('a')?.focus({ preventScroll: true })
    // Only a real scroll closes it: the one that brought its mark into view may still be on its way.
    const openedAt = window.scrollY
    const onScroll = () => Math.abs(window.scrollY - openedAt) > CLOSING_SCROLL_DISTANCE && onClose()
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    const onMouseDown = (event: MouseEvent) => listRef.current && !listRef.current.contains(event.target as Node) && onClose()
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('scroll', onScroll)
    }
  }, [onClose])
  const left = Math.max(8, Math.min(point.x + 12, window.innerWidth - PICKER_WIDTH))
  const top = Math.min(point.y + 12, window.innerHeight - 40 - items.length * 30)
  return (
    <ul ref={listRef} role="menu" aria-label={title} data-testid="picker" style={{ left, top }} {...stylex.props(styles.picker)}>
      <li role="presentation" {...stylex.props(styles.title)}>
        {title}
      </li>
      {items.map((item) => (
        <li key={item.to} role="presentation">
          <a role="menuitem" href={item.to} onClick={onClose} {...stylex.props(styles.link)}>
            {item.label}
          </a>
        </li>
      ))}
    </ul>
  )
}
