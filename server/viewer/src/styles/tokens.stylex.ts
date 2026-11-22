// Design tokens: the only place colors, spacing, type and shape are defined (DESIGN.md). Every ui/
// primitive reads these through StyleX; views never style anything themselves.

import * as stylex from '@stylexjs/stylex'

export const colors = stylex.defineVars({
  ground: '#0f1311',
  rule: '#232a25',
  line: '#d9ded6',
  dim: '#8e998f',
  /** The line where a work item has not been yet. */
  ahead: '#3a443c',
  panelRule: '#2c342e',
  sand: '#e3c97e',
  /** A change that helped, and nothing else. */
  helped: '#a3c27a',
  /** Friction, and nothing else. */
  orange: '#ff7a1a',
  keyGround: 'rgb(20 26 22 / 0.92)',
  tipGround: '#e9ede6',
  tipText: '#111111',
})

export const space = stylex.defineVars({
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
})

export const font = stylex.defineVars({
  sans: "'Barlow', ui-sans-serif, system-ui, sans-serif",
  brand: "'Big Shoulders Stencil Display', 'Barlow', sans-serif",
  sizeXs: '12px',
  sizeSm: '13px',
  sizeMd: '15px',
  sizeLg: '17px',
  sizeBrand: '20px',
  weightMedium: '500',
  weightBold: '600',
  weightHeavy: '700',
})

export const shape = stylex.defineVars({
  radiusSm: '6px',
  radiusLg: '12px',
  borderWidth: '1px',
  lineWidth: '3px',
  headerHeight: '52px',
  pipelineWidth: '900px',
})
