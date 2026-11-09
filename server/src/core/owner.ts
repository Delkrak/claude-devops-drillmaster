const REJECTION_WORDS = /\b(no|nope|don'?t|do not|reject(ed)?|decline[ds]?|not (yet|ok|okay|good|approved|done)|wait|stop|wrong|redo|fix|change|nej|vent)\b/i
const APPROVAL_WORDS = /\b(yes|yep|yeah|ok|okay|approved?|lgtm|looks good|go ahead|ship it|merge it|accept(ed)?|fine|good|great|ja|godkendt|fint)\b/i
const NEGATION_BEFORE_NUMBER = /\b(not|no|skip|except|without|ikke)\b[^\d]*$/i
const NEGATION_LOOKBACK_CHARS = 14

export function classifyOwnerWords(ownerWords: string): 'approve' | 'reject' | 'unclear' {
  if (REJECTION_WORDS.test(ownerWords)) return 'reject'
  if (APPROVAL_WORDS.test(ownerWords)) return 'approve'
  return 'unclear'
}

export function decideProposals(ownerWords: string, openProposalIds: readonly number[]): { approved: number[]; declined: number[] } | undefined {
  if (openProposalIds.length === 0 || ownerWords.trim().endsWith('?')) return undefined
  const mentionedIds: number[] = []
  const excludedIds: number[] = []
  for (const match of ownerWords.matchAll(/\d+/g)) {
    const proposalId = Number(match[0])
    if (!openProposalIds.includes(proposalId)) continue
    const textBeforeNumber = ownerWords.slice(Math.max(0, match.index - NEGATION_LOOKBACK_CHARS), match.index)
    if (NEGATION_BEFORE_NUMBER.test(textBeforeNumber)) excludedIds.push(proposalId)
    else mentionedIds.push(proposalId)
  }
  const classification = classifyOwnerWords(ownerWords)
  if (APPROVAL_WORDS.test(ownerWords) && (classification === 'approve' || mentionedIds.length > 0 || excludedIds.length > 0)) {
    const approved = mentionedIds.length ? mentionedIds : openProposalIds.filter((id) => !excludedIds.includes(id))
    return { approved: [...new Set(approved)], declined: [...new Set(excludedIds)] }
  }
  if (classification === 'reject') {
    const declined = mentionedIds.length || excludedIds.length ? [...mentionedIds, ...excludedIds] : [...openProposalIds]
    return { approved: [], declined: [...new Set(declined)] }
  }
  return undefined
}
