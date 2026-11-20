import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import { colors, font, space, shape } from '../../styles/tokens.stylex'

const styles = stylex.create({
  tip: {
    position: 'fixed',
    zIndex: 9,
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

/** Shows the `data-tip` of whatever the pointer rests on, next to the pointer. */
export function Tip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  useEffect(() => {
    const follow = (event: MouseEvent) => {
      const explained = (event.target as Element | null)?.closest?.('[data-tip]')
      setTip(explained ? { text: explained.getAttribute('data-tip')!, x: event.clientX + 14, y: event.clientY + 14 } : null)
    }
    document.addEventListener('mousemove', follow)
    return () => document.removeEventListener('mousemove', follow)
  }, [])
  if (!tip) return null
  return (
    <div role="tooltip" data-testid="tip" style={{ left: tip.x, top: tip.y }} {...stylex.props(styles.tip)}>
      {tip.text}
    </div>
  )
}
