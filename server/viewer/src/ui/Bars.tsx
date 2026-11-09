import * as stylex from '@stylexjs/stylex'
import { colors, shape, space } from '../styles/tokens.stylex'

const styles = stylex.create({
  bars: { display: 'flex', alignItems: 'flex-end', gap: space.xs, height: '64px' },
  bar: { flex: 1, minWidth: '6px', maxWidth: '28px', backgroundColor: colors.accent, borderTopLeftRadius: shape.radiusSm, borderTopRightRadius: shape.radiusSm },
  height: (percent: number) => ({ height: `${percent}%` }),
})

export function Bars({ values, label }: { values: { key: string; value: number; title: string }[]; label: string }) {
  const largest = Math.max(1, ...values.map((bar) => bar.value))
  return (
    <div {...stylex.props(styles.bars)} role="img" aria-label={label}>
      {values.map((bar) => (
        <div key={bar.key} title={bar.title} {...stylex.props(styles.bar, styles.height(Math.max(4, (bar.value / largest) * 100)))} />
      ))}
    </div>
  )
}
