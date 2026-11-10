import type { Feedback } from '../types'
import { Badge } from '../ui/Badge'
import { Row, Stack } from '../ui/Box'

const asFeedback = (value: unknown): Feedback[] => (Array.isArray(value) ? (value as Feedback[]) : typeof value === 'string' && value ? [{ refs: [], text: value }] : [])

/** Feedback entries, each with the references it names. A tool reference is feedback on Drillmaster itself. */
export function FeedbackList({ entries, testId }: { entries: unknown; testId?: string }) {
  return (
    <Stack tight testId={testId}>
      {asFeedback(entries).map((entry, index) => (
        <Row key={index}>
          {entry.refs.map((mention) => (
            <Badge key={mention.ref} tone={mention.ref.startsWith('tool ') ? 'accent' : 'info'} testId="feedback-ref">
              {mention.ref}
            </Badge>
          ))}
          <span>{entry.text}</span>
        </Row>
      ))}
    </Stack>
  )
}

export const feedbackText = (value: unknown) =>
  asFeedback(value)
    .map((entry) => [...entry.refs.map((mention) => mention.ref), entry.text].join(' '))
    .join(' ')
