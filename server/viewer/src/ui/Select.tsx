import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { colors, font, shape, space } from '../styles/tokens.stylex'

const styles = stylex.create({
  field: {
    paddingBlock: space.xs,
    paddingInline: space.sm,
    borderWidth: shape.borderWidth,
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: shape.radiusMd,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: font.sizeSm,
  },
  chip: {
    paddingBlock: '2px',
    paddingInline: space.md,
    borderWidth: shape.borderWidth,
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: shape.radiusPill,
    backgroundColor: colors.surface,
    fontSize: font.sizeSm,
    cursor: 'pointer',
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent, color: colors.onAccent },
})

export function Select({ label, value, onChange, children }: { label: string; value: string | number; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <select aria-label={label} value={value} onChange={(changeEvent) => onChange(changeEvent.target.value)} {...stylex.props(styles.field)}>
      {children}
    </select>
  )
}

export function SearchField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(changeEvent) => onChange(changeEvent.target.value)} {...stylex.props(styles.field)} />
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} {...stylex.props(styles.chip, on && styles.chipOn)}>
      {children}
    </button>
  )
}
