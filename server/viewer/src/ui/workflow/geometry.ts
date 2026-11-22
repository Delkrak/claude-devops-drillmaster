// The pipeline's drawing grid, in SVG units: one line down the middle of a 900-wide drawing.

export const WIDTH = 900
export const AXIS = 450
export const BRANCH_OFFSET = 64
export const OVERVIEW_ROW = 58
export const STAGE_HEADER = 70
export const STEP_ROW = 80
export const SPLIT_HEIGHT = 2 * BRANCH_OFFSET + 40
export const AFTER_SPLIT = 30
export const ITEM_COLUMN = AXIS - 70
export const FRICTION_COLUMN = AXIS + 44

export function branchPath(leaveY: number, joinY: number, x: number) {
  const curveHeight = 34
  return `M${AXIS} ${leaveY} C${AXIS} ${leaveY + curveHeight / 2} ${x} ${leaveY + curveHeight / 2} ${x} ${leaveY + curveHeight} V${joinY - curveHeight} C${x} ${joinY - curveHeight / 2} ${AXIS} ${joinY - curveHeight / 2} ${AXIS} ${joinY}`
}

export const itemBoxWidth = (boxText: number | string) => 36 + String(boxText).length * 8

export const ROUTE_ROW = 46
export const ROUTE_SPLIT = 34

interface Alternative {
  alternative: { input: string; value: string } | null
}

export function splitAlternatives<Step extends Alternative>(steps: readonly Step[]): (Step | [Step, Step])[] {
  const rows: (Step | [Step, Step])[] = []
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!
    const nextStep = steps[index + 1]
    const isSplit = step.alternative && nextStep?.alternative && step.alternative.input === nextStep.alternative.input && step.alternative.value !== nextStep.alternative.value
    if (isSplit) {
      rows.push([step, nextStep!])
      index++
    } else rows.push(step)
  }
  return rows
}
