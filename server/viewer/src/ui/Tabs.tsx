import * as stylex from '@stylexjs/stylex'
import { colors, font, shape, space } from '../styles/tokens.stylex'

const styles = stylex.create({
  tabs: { display: 'flex', gap: space.xs, borderBottomWidth: shape.borderWidth, borderBottomStyle: 'solid', borderBottomColor: colors.border, overflowX: 'auto' },
  tab: {
    paddingBlock: space.sm,
    paddingInline: space.md,
    borderWidth: 0,
    borderBottomWidth: '2px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'transparent',
    backgroundColor: 'transparent',
    color: colors.textMuted,
    cursor: 'pointer',
    fontWeight: font.weightMedium,
    whiteSpace: 'nowrap',
  },
  selected: { color: colors.text, borderBottomColor: colors.accent },
})

export function Tabs<T extends string>({ tabs, current, label, onSelect }: { tabs: readonly { id: T; label: string }[]; current: T; label: string; onSelect: (id: T) => void }) {
  return (
    <div {...stylex.props(styles.tabs)} role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" aria-selected={tab.id === current} onClick={() => onSelect(tab.id)} {...stylex.props(styles.tab, tab.id === current && styles.selected)}>
          {tab.label}
        </button>
      ))}
    </div>
  )
}
