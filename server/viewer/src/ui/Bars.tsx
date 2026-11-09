import * as stylex from '@stylexjs/stylex'
import { colors, shape, space } from '../styles/tokens.stylex'

const styles = stylex.create({
  bars: { display: 'flex', alignItems: 'flex-end', gap: space.xs, height: '64px' },
  bar: { flex: 1, minWidth: '6px', maxWidth: '28px', backgroundColor: colors.accent, borderTopLeftRadius: shape.radiusSm, borderTopRightRadius: shape.radiusSm },
  height: (percent: number) => ({ height: `${percent}%` }),
})

/** A tiny bar chart: one bar per value, scaled to the largest. */
export function Bars({ values, label }: { values: { key: string; value: number; title: string }[]; label: string }) {
  const max = Math.max(1, ...values.map((v) => v.value))
  return (
    <div {...stylex.props(styles.bars)} role="img" aria-label={label}>
      {values.map((v) => (
        <div key={v.key} title={v.title} {...stylex.props(styles.bar, styles.height(Math.max(4, (v.value / max) * 100)))} />
      ))}
    </div>
  )
}
