const REJECTION_WORDS = /\b(no|nope|don'?t|do not|reject(ed)?|decline[ds]?|not (yet|ok|okay|good|approved|done)|wait|stop|wrong|redo|fix|change|nej|vent)\b/i
const APPROVAL_WORDS = /\b(yes|yep|yeah|ok|okay|approved?|lgtm|looks good|go ahead|ship it|merge it|accept(ed)?|fine|good|great|ja|godkendt|fint)\b/i

const APPROVE_VERB = /^(yes|yep|yeah|ok|okay|approved?|approving|accept(ed)?|keep|lgtm|fine|good|great|apply|ja|godkend|godkendt|fint)$/i
const DECLINE_VERB = /^(no|nope|reject(ed)?|decline[ds]?|drop|nej|afvis|afvist)$/i
const NEGATION = /^(not|except|skip|without|ikke|undtagen)$/i
const EVERY_OTHER = /^(all|rest|others|everything|alle|resten)$/i

type Verdict = 'approve' | 'decline'

export function classifyOwnerWords(ownerWords: string): 'approve' | 'reject' | 'unclear' {
  if (REJECTION_WORDS.test(ownerWords)) return 'reject'
  if (APPROVAL_WORDS.test(ownerWords)) return 'approve'
  return 'unclear'
}

const opposite = (verdict: Verdict): Verdict => (verdict === 'approve' ? 'decline' : 'approve')

// Each proposal number takes the verdict of the nearest decision word before it, so
// "Approve 1, decline 2." approves 1 and declines 2. "Not", "except" and the like flip it.
export function decideProposals(ownerWords: string, openProposalIds: readonly number[]): { approved: number[]; declined: number[] } | undefined {
  if (openProposalIds.length === 0 || ownerWords.trim().endsWith('?')) return undefined
  const approved = new Set<number>()
  const declined = new Set<number>()
  let verb: Verdict | null = null
  let negated = false
  let approvalSeen = false
  let restVerdict: Verdict | null = null

  for (const [, number, word] of ownerWords.matchAll(/(\d+)|([\p{L}']+)/gu)) {
    if (word) {
      if (APPROVE_VERB.test(word)) {
        verb = 'approve'
        approvalSeen = true
        negated = false
      } else if (DECLINE_VERB.test(word)) {
        verb = 'decline'
        negated = false
      } else if (NEGATION.test(word)) {
        negated = true
      } else if (EVERY_OTHER.test(word) && verb) {
        restVerdict = negated ? opposite(verb) : verb
      }
      continue
    }
    const proposalId = Number(number)
    if (!openProposalIds.includes(proposalId)) continue
    const base = verb ?? (negated ? 'approve' : null)
    if (!base) continue
    const verdict = negated ? opposite(base) : base
    ;(verdict === 'approve' ? approved : declined).add(proposalId)
    ;(verdict === 'approve' ? declined : approved).delete(proposalId)
  }

  const mentioned = approved.size + declined.size > 0
  if (!mentioned && !restVerdict) {
    const classification = classifyOwnerWords(ownerWords)
    if (classification === 'unclear') return undefined
    return classification === 'approve' ? { approved: [...openProposalIds], declined: [] } : { approved: [], declined: [...openProposalIds] }
  }
  const unmentioned = openProposalIds.filter((id) => !approved.has(id) && !declined.has(id))
  const rest = restVerdict ?? (approvalSeen && approved.size === 0 ? 'approve' : null)
  for (const id of unmentioned) {
    if (rest === 'approve') approved.add(id)
    if (rest === 'decline') declined.add(id)
  }
  return { approved: [...approved].sort((a, b) => a - b), declined: [...declined].sort((a, b) => a - b) }
}
