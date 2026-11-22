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
const TIPPED_MARK = '[data-tip]'

const tipPositionNear = (x: number, y: number) => ({ left: Math.max(8, Math.min(x + 14, window.innerWidth - TIP_WIDTH)), top: Math.min(y + 14, window.innerHeight - 40) })

export function Tip() {
  const [tip, setTip] = useState<{ text: string; left: number; top: number } | null>(null)
  useEffect(() => {
    const tippedMarkOf = (target: EventTarget | null) => (target instanceof Element ? target.closest(TIPPED_MARK) : null)
    const onMouseMove = (event: MouseEvent) => {
      const mark = tippedMarkOf(event.target)
      setTip(mark ? { text: mark.getAttribute('data-tip')!, ...tipPositionNear(event.clientX, event.clientY) } : null)
    }
    const onFocus = (event: FocusEvent) => {
      const mark = tippedMarkOf(event.target)
      if (!mark) return
      const markBox = mark.getBoundingClientRect()
      setTip({ text: mark.getAttribute('data-tip')!, ...tipPositionNear(markBox.right, markBox.bottom) })
    }
    const hideTip = () => setTip(null)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', hideTip)
    // Scrolling hides the tip, so it never points at the wrong mark.
    window.addEventListener('scroll', hideTip, { passive: true })
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', hideTip)
      window.removeEventListener('scroll', hideTip)
    }
  }, [])
  if (!tip) return null
  return (
    <div role="tooltip" data-testid="tip" style={{ left: tip.left, top: tip.top }} {...stylex.props(styles.tip)}>
      {tip.text}
    </div>
  )
}
