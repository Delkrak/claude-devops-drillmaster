import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import { colors, font, space, shape } from '../../styles/tokens.stylex'

const styles = stylex.create({
  tip: {
    position: 'fixed',
    zIndex: 9,
    maxWidth: '40ch',
    pointerEvents: 'none',
    paddingBlock: space.xs,
    paddingInline: space.md,
    borderRadius: shape.radiusSm,
    backgroundColor: colors.tipGround,
    color: colors.tipText,
    fontFamily: font.sans,
    fontSize: font.sizeSm,
    fontWeight: font.weightBold,
  },
})

const TIP_WIDTH = 320
const EXPLAINED = '[data-tip]'

/** Keeps a tip beside its point and inside the window. */
const placed = (x: number, y: number) => ({ left: Math.max(8, Math.min(x + 14, window.innerWidth - TIP_WIDTH)), top: Math.min(y + 14, window.innerHeight - 40) })

/**
 * Shows the `data-tip` of the mark the pointer rests on, or of the mark the keyboard or a tap has
 * focused, beside it. Scrolling hides it, so it never points at the wrong mark.
 */
export function Tip() {
  const [tip, setTip] = useState<{ text: string; left: number; top: number } | null>(null)
  useEffect(() => {
    const explainedAt = (target: EventTarget | null) => (target instanceof Element ? target.closest(EXPLAINED) : null)
    const onPointer = (event: MouseEvent) => {
      const mark = explainedAt(event.target)
      setTip(mark ? { text: mark.getAttribute('data-tip')!, ...placed(event.clientX, event.clientY) } : null)
    }
    const onFocus = (event: FocusEvent) => {
      const mark = explainedAt(event.target)
      if (!mark) return
      const box = mark.getBoundingClientRect()
      setTip({ text: mark.getAttribute('data-tip')!, ...placed(box.right, box.bottom) })
    }
    const hide = () => setTip(null)
    document.addEventListener('mousemove', onPointer)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', hide)
    window.addEventListener('scroll', hide, { passive: true })
    return () => {
      document.removeEventListener('mousemove', onPointer)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', hide)
      window.removeEventListener('scroll', hide)
    }
  }, [])
  if (!tip) return null
  return (
    <div role="tooltip" data-testid="tip" style={{ left: tip.left, top: tip.top }} {...stylex.props(styles.tip)}>
      {tip.text}
    </div>
  )
}
