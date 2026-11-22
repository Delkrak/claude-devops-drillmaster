/**
 * The `if` of a work stage or step: a condition on the work item's inputs, in the operators of
 * GitHub's expressions. `kind == 'bug'`, `kind != 'bug'`, `kind in ['bug', 'chore']`, joined with
 * `&&`, `||` and `!`, grouped with parentheses. Inputs are named as they are, without a prefix.
 */

export type Condition =
  | { kind: 'compare'; input: string; op: '==' | '!=' | 'in'; values: string[] }
  | { kind: 'not'; operand: Condition }
  | { kind: 'and' | 'or'; left: Condition; right: Condition }

export class InvalidCondition extends Error {}

type Token = { type: 'name' | 'string' | 'symbol'; text: string; at: number }

const SYMBOLS = ['==', '!=', '&&', '||', '!', '(', ')', '[', ']', ',']

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let at = 0
  while (at < text.length) {
    const rest = text.slice(at)
    const space = /^\s+/.exec(rest)
    if (space) {
      at += space[0].length
      continue
    }
    const name = /^[A-Za-z_][\w-]*/.exec(rest)
    if (name) {
      tokens.push({ type: 'name', text: name[0], at })
      at += name[0].length
      continue
    }
    const quoted = /^'([^']*)'|^"([^"]*)"/.exec(rest)
    if (quoted) {
      tokens.push({ type: 'string', text: quoted[1] ?? quoted[2]!, at })
      at += quoted[0].length
      continue
    }
    const symbol = SYMBOLS.find((candidate) => rest.startsWith(candidate))
    if (!symbol) throw new InvalidCondition(`"${text}": unexpected "${rest[0]}" at ${at + 1}.`)
    tokens.push({ type: 'symbol', text: symbol, at })
    at += symbol.length
  }
  return tokens
}

export function parseCondition(text: string): Condition {
  const tokens = tokenize(text)
  let index = 0
  const fail = (expected: string): never => {
    const token = tokens[index]
    throw new InvalidCondition(`"${text}": expected ${expected} ${token ? `at "${token.text}" (${token.at + 1})` : 'at the end'}.`)
  }
  const peekSymbol = (symbol: string) => tokens[index]?.type === 'symbol' && tokens[index]!.text === symbol
  const takeSymbol = (symbol: string) => (peekSymbol(symbol) ? (index++, true) : false)
  const takeString = () => (tokens[index]?.type === 'string' ? tokens[index++]!.text : fail('a quoted value'))

  const parseOr = (): Condition => {
    let left = parseAnd()
    while (takeSymbol('||')) left = { kind: 'or', left, right: parseAnd() }
    return left
  }
  const parseAnd = (): Condition => {
    let left = parseUnary()
    while (takeSymbol('&&')) left = { kind: 'and', left, right: parseUnary() }
    return left
  }
  const parseUnary = (): Condition => {
    if (takeSymbol('!')) return { kind: 'not', operand: parseUnary() }
    if (takeSymbol('(')) {
      const inner = parseOr()
      if (!takeSymbol(')')) fail('")"')
      return inner
    }
    return parseComparison()
  }
  const parseComparison = (): Condition => {
    const input = tokens[index]?.type === 'name' ? tokens[index++]!.text : fail('an input name')
    if (takeSymbol('==')) return { kind: 'compare', input, op: '==', values: [takeString()] }
    if (takeSymbol('!=')) return { kind: 'compare', input, op: '!=', values: [takeString()] }
    if (tokens[index]?.type === 'name' && tokens[index]!.text === 'in') {
      index++
      if (!takeSymbol('[')) fail('"["')
      const values = [takeString()]
      while (takeSymbol(',')) values.push(takeString())
      if (!takeSymbol(']')) fail('"]"')
      return { kind: 'compare', input, op: 'in', values }
    }
    return fail('==, != or in')
  }

  if (tokens.length === 0) throw new InvalidCondition('A condition is empty.')
  const condition = parseOr()
  if (index < tokens.length) fail('&&, || or the end')
  return condition
}

/** Every comparison in a condition, so a workflow can check the inputs and values it names. */
export function comparisonsOf(condition: Condition): Extract<Condition, { kind: 'compare' }>[] {
  switch (condition.kind) {
    case 'compare':
      return [condition]
    case 'not':
      return comparisonsOf(condition.operand)
    default:
      return [...comparisonsOf(condition.left), ...comparisonsOf(condition.right)]
  }
}

export type InputValues = Readonly<Record<string, string | undefined>>

/**
 * True or false, or the inputs it still needs when an unset input decides it. An input that can't
 * change the outcome doesn't need to be set: `kind == 'bug' || size == 'large'` is true for a bug.
 */
export function evaluateCondition(condition: Condition, inputs: InputValues): boolean | { missing: string[] } {
  switch (condition.kind) {
    case 'compare': {
      const value = inputs[condition.input]
      if (value === undefined) return { missing: [condition.input] }
      const matches = condition.values.includes(value)
      return condition.op === '!=' ? !matches : matches
    }
    case 'not': {
      const operand = evaluateCondition(condition.operand, inputs)
      return typeof operand === 'boolean' ? !operand : operand
    }
    case 'and':
    case 'or': {
      const decisive = condition.kind === 'or'
      const left = evaluateCondition(condition.left, inputs)
      if (left === decisive) return decisive
      const right = evaluateCondition(condition.right, inputs)
      if (right === decisive) return decisive
      if (typeof left === 'boolean' && typeof right === 'boolean') return !decisive
      return { missing: [...new Set([...(typeof left === 'boolean' ? [] : left.missing), ...(typeof right === 'boolean' ? [] : right.missing)])] }
    }
  }
}

export function conditionInWords(condition: Condition): string {
  switch (condition.kind) {
    case 'compare': {
      const inputInWords = condition.input.replace(/[_-]+/g, ' ')
      const valuesInWords = condition.values.join(' or ')
      return condition.op === '!=' ? `${inputInWords} is not ${valuesInWords}` : `${inputInWords} is ${valuesInWords}`
    }
    case 'not':
      return `not (${conditionInWords(condition.operand)})`
    case 'and':
    case 'or': {
      // An operand that joins the other way keeps its brackets, so "a and (b or c)" reads as it runs.
      const operandInWords = (operand: Condition) => (operand.kind !== condition.kind && (operand.kind === 'and' || operand.kind === 'or') ? `(${conditionInWords(operand)})` : conditionInWords(operand))
      return `${operandInWords(condition.left)} ${condition.kind} ${operandInWords(condition.right)}`
    }
  }
}

/** Why a condition isn't met, from the inputs it reads: "kind is feature". */
export const describeInputsOf = (condition: Condition, inputs: InputValues) =>
  [...new Set(comparisonsOf(condition).map((comparison) => comparison.input))].map((input) => `${input} is ${inputs[input] ?? 'not set'}`).join(', ')
