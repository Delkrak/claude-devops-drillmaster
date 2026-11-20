// The pipeline's drawing grid, in SVG units: one line down the middle of a 900-wide drawing.

export const WIDTH = 900
export const AXIS = 450
/** How far the two branches of a split stand from the line. */
export const SPLIT = 64
export const OVERVIEW_ROW = 58
export const STAGE_HEADER = 70
export const STEP_ROW = 80
export const SPLIT_HEIGHT = 2 * SPLIT + 40
export const AFTER_SPLIT = 30
/** Work-item dots stand in one column left of the line; friction rings right of it. */
export const ITEM_COLUMN = AXIS - 70
export const PROBLEM_COLUMN = AXIS + 44

/** A branch of a split: leaves the line at y0, runs at x, and joins the line again at y1. */
export function branch(y0: number, y1: number, x: number) {
  const r = 34
  return `M${AXIS} ${y0} C${AXIS} ${y0 + r / 2} ${x} ${y0 + r / 2} ${x} ${y0 + r} V${y1 - r} C${x} ${y1 - r / 2} ${AXIS} ${y1 - r / 2} ${AXIS} ${y1}`
}

/** The width of a rounded box that holds a count, or a work item's number, and a dot. */
export const itemBoxWidth = (count: number | string) => 36 + String(count).length * 8

/** One work item's route: a row per step, a little tighter than the walkthrough. */
export const ROUTE_ROW = 46
export const ROUTE_SPLIT = 34

interface Alternative {
  alternative: { input: string; value: string } | null
}

/** Steps in order, where two neighbours that run on different values of the same input become a split. */
export function splitAlternatives<Step extends Alternative>(steps: readonly Step[]): (Step | [Step, Step])[] {
  const placed: (Step | [Step, Step])[] = []
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!
    const next = steps[index + 1]
    const pairs = step.alternative && next?.alternative && step.alternative.input === next.alternative.input && step.alternative.value !== next.alternative.value
    if (pairs) {
      placed.push([step, next!])
      index++
    } else placed.push(step)
  }
  return placed
}
