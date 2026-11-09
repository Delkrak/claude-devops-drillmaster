// Reading Owner's own words. v1: any direct agreement written to Agent is enough.

const REJECT = /\b(no|nope|don'?t|do not|reject(ed)?|decline[ds]?|not (yet|ok|okay|good|approved|done)|wait|stop|wrong|redo|fix|change|nej|vent)\b/i
const APPROVE = /\b(yes|yep|yeah|ok|okay|approved?|lgtm|looks good|go ahead|ship it|merge it|accept(ed)?|fine|good|great|ja|godkendt|fint)\b/i

/** A rejection word wins; unclear words decide nothing. */
export function classifyOwner(prompt: string): 'approve' | 'reject' | 'unclear' {
  if (REJECT.test(prompt)) return 'reject'
  if (APPROVE.test(prompt)) return 'approve'
  return 'unclear'
}

/**
 * Owner's decision on numbered proposals: "approve 1 and 3", "yes" (all), "approve 1 but not 2",
 * "no" (none). Returns undefined when the words decide nothing.
 */
export function decideProposals(prompt: string, open: readonly number[]): { approved: number[]; declined: number[] } | undefined {
  // A question is Owner asking, not deciding.
  if (open.length === 0 || prompt.trim().endsWith('?')) return undefined
  const mentioned: number[] = []
  const excluded: number[] = []
  for (const match of prompt.matchAll(/\d+/g)) {
    const n = Number(match[0])
    if (!open.includes(n)) continue
    const before = prompt.slice(Math.max(0, match.index - 14), match.index)
    if (/\b(not|no|skip|except|without|ikke)\b[^\d]*$/i.test(before)) excluded.push(n)
    else mentioned.push(n)
  }
  const approves = APPROVE.test(prompt)
  const kind = classifyOwner(prompt)
  if (approves && (kind === 'approve' || mentioned.length > 0 || excluded.length > 0)) {
    const approved = mentioned.length ? mentioned : open.filter((n) => !excluded.includes(n))
    return { approved: [...new Set(approved)], declined: [...new Set(excluded)] }
  }
  if (kind === 'reject') {
    const declined = mentioned.length || excluded.length ? [...mentioned, ...excluded] : [...open]
    return { approved: [], declined: [...new Set(declined)] }
  }
  return undefined
}
