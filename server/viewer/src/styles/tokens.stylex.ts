// Design tokens: the only place colors, spacing, type and shape are defined. Every ui/ primitive
// reads these through StyleX; views never style anything themselves.

import * as stylex from '@stylexjs/stylex'

const DARK = '@media (prefers-color-scheme: dark)'

export const colors = stylex.defineVars({
  bg: { default: '#f6f5f2', [DARK]: '#151412' },
  surface: { default: '#ffffff', [DARK]: '#1d1b18' },
  surfaceSunken: { default: '#efede8', [DARK]: '#121110' },
  border: { default: '#dcd8cf', [DARK]: '#34312b' },
  text: { default: '#1c1a17', [DARK]: '#ece9e2' },
  textMuted: { default: '#6b665c', [DARK]: '#a39d90' },
  accent: { default: '#c2410c', [DARK]: '#fb923c' },
  accentSoft: { default: '#fde7da', [DARK]: '#3b2415' },
  onAccent: { default: '#ffffff', [DARK]: '#1c1a17' },
  ok: { default: '#15803d', [DARK]: '#4ade80' },
  okSoft: { default: '#dcfce7', [DARK]: '#14301f' },
  warn: { default: '#a16207', [DARK]: '#facc15' },
  warnSoft: { default: '#fef3c7', [DARK]: '#3a3010' },
  bad: { default: '#b91c1c', [DARK]: '#f87171' },
  badSoft: { default: '#fee2e2', [DARK]: '#3d1717' },
  info: { default: '#1d4ed8', [DARK]: '#60a5fa' },
  infoSoft: { default: '#dbeafe', [DARK]: '#172a45' },
  neutralSoft: { default: '#ebe8e1', [DARK]: '#2a2723' },
})

export const space = stylex.defineVars({
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
  xxxl: '48px',
})

export const font = stylex.defineVars({
  sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "ui-monospace, 'Cascadia Code', 'SFMono-Regular', Consolas, monospace",
  sizeXs: '12px',
  sizeSm: '13px',
  sizeMd: '15px',
  sizeLg: '18px',
  sizeXl: '24px',
  size2xl: '32px',
  weightRegular: '400',
  weightMedium: '550',
  weightBold: '700',
  leading: '1.5',
})

export const shape = stylex.defineVars({
  radiusSm: '4px',
  radiusMd: '8px',
  radiusLg: '12px',
  radiusPill: '999px',
  borderWidth: '1px',
  shadowCard: { default: '0 1px 2px rgb(0 0 0 / 0.06), 0 1px 1px rgb(0 0 0 / 0.04)', [DARK]: 'none' },
})

export const layout = stylex.defineVars({
  contentWidth: '1180px',
  columnWidth: '280px',
})
