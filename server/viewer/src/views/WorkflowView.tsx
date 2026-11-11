import { useState } from 'react'
import { formatDateTime, gateLabel, gateTone, measureLabel } from '../format'
import type { ExperimentVerdict, PolicyRule, ProjectView, WorkStage, Workflow } from '../types'
import { Badge } from '../ui/Badge'
import { Row, Stack } from '../ui/Box'
import { Card } from '../ui/Card'
import { Checklist, ChecklistItem } from '../ui/Checklist'
import { Empty } from '../ui/Empty'
import { Flow, FlowStage, FlowStep } from '../ui/Flow'
import { Select } from '../ui/Select'
import { href } from '../router'
import { Code, Heading, Link, Muted, Strong } from '../ui/Text'

export function WorkflowView({ project }: { project: ProjectView }) {
  const [version, setVersion] = useState(project.workflow.version)
  const shown = project.versions.find((candidate) => candidate.version === version) ?? project.versions.at(-1)!
  return (
    <Card
      testId="workflow"
      title={`Workflow version ${shown.version}`}
      subtitle={`${formatDateTime(shown.at)}: ${shown.reason}`}
      actions={
        <Select label="Workflow version" value={version} onChange={(selectedVersion) => setVersion(selectedVersion)}>
          {project.versions.map((workflowVersion) => (
            <option key={workflowVersion.version} value={workflowVersion.version}>
              v{workflowVersion.version}
              {workflowVersion.version === project.workflow.version ? ' (current)' : ''}
            </option>
          ))}
        </Select>
      }
    >
      <WorkflowBody workflow={shown.workflow} verdicts={shown.version === project.workflow.version ? project.experiment_verdicts : []} projectId={project.summary.id} />
    </Card>
  )
}

const verdictTone = { running: 'neutral', keep: 'ok', rethink: 'bad' } as const

/** Every component links to its history across versions. */
function WorkflowBody({ workflow, verdicts, projectId }: { workflow: Workflow; verdicts: ExperimentVerdict[]; projectId: string }) {
  const historyOf = (guid: string) => href.history(projectId, guid)
  const rulesByRef = new Map<string, PolicyRule>(workflow.policies.flatMap((policy) => policy.rules.map((rule) => [`${policy.name} ${rule.id}`, rule] as const)))
  const definitionOfDone = (stage: WorkStage) => [...new Set(stage.steps.flatMap((step) => step.rules))]
  const inputs = workflow.inputs ?? []
  return (
    <Stack>
      <Row>
        <Strong>Owner's objective:</Strong> {workflow.objective.text}
        {workflow.objective.measures.map((measure) => (
          <Badge key={measure}>{measureLabel(measure)}</Badge>
        ))}
      </Row>
      {workflow.stages.length === 0 ? (
        <Empty>No work stages yet. Agent does its best, Owner steps in where needed, and the workflow grows from that.</Empty>
      ) : (
        <Flow>
          {workflow.stages.map((stage) => (
            <FlowStage key={stage.n}>
              <Heading level={3}>
                <Link href={historyOf(stage.guid)}>
                  {stage.n}. {stage.name}
                </Link>
              </Heading>
              {stage.purpose ? <Muted>{stage.purpose}</Muted> : <Badge tone="warn">no purpose yet</Badge>}
              <Stack tight>
                <Strong>Definition of Done</Strong>
                {definitionOfDone(stage).length === 0 ? (
                  <Muted>No rules yet.</Muted>
                ) : (
                  <Checklist testId="definition-of-done">
                    {definitionOfDone(stage).map((ref) => (
                      <ChecklistItem key={ref}>
                        <Link href={historyOf(rulesByRef.get(ref)?.guid ?? '')}>
                          <Code>{ref}</Code>
                        </Link>{' '}
                        {rulesByRef.get(ref)?.rule}
                      </ChecklistItem>
                    ))}
                  </Checklist>
                )}
              </Stack>
              {stage.steps.map((step) => (
                <FlowStep key={step.n}>
                  <Row>
                    <Strong>
                      {stage.n}.{step.n}
                    </Strong>
                    <Link href={historyOf(step.guid)} testId="step-history">
                      {step.name}
                    </Link>
                  </Row>
                  <Row>
                    <Badge tone={gateTone[step.gate]}>{gateLabel[step.gate]}</Badge>
                    {step.skippable && (
                      <Badge tone="info" testId="skippable">
                        skippable: {step.skippable} decides
                      </Badge>
                    )}
                    {step.update && step.update !== 'none' && (
                      <Badge tone="accent" testId="update-step">
                        updates first on a {step.update} change
                      </Badge>
                    )}
                    {inputs
                      .filter((input) => input.set_at === `${stage.n}.${step.n}`)
                      .map((input) => (
                        <Badge key={input.name} tone="info">
                          sets {input.name}
                        </Badge>
                      ))}
                  </Row>
                  {step.instruction ? <span data-testid="instruction">{step.instruction}</span> : <Badge tone="warn">no instruction yet</Badge>}
                  {step.rules.map((ref) => (
                    <Muted key={ref} title={rulesByRef.get(ref)?.verified_by}>
                      <Code>{ref}</Code> {rulesByRef.get(ref)?.rule}
                    </Muted>
                  ))}
                  {step.report.length > 0 && <Muted>Report: {step.report.join('; ')}</Muted>}
                </FlowStep>
              ))}
            </FlowStage>
          ))}
        </Flow>
      )}
      <Heading level={3}>Work policies</Heading>
      {workflow.policies.length === 0 ? (
        <Empty>No work policies yet.</Empty>
      ) : (
        workflow.policies.map((policy) => (
          <Stack key={policy.name} tight>
            <Link href={historyOf(policy.guid)}>
              <Strong>{policy.name} work policy</Strong>
            </Link>
            {policy.rules.map((rule) => (
              <Muted key={rule.id}>
                <Link href={historyOf(rule.guid)}>
                  <Code>
                    {policy.name} {rule.id}
                  </Code>
                </Link>{' '}
                {rule.rule}. Verified by {rule.verified_by}.
              </Muted>
            ))}
          </Stack>
        ))
      )}
      <Heading level={3}>Work item inputs</Heading>
      {inputs.length === 0 ? (
        <Empty>No work item inputs yet.</Empty>
      ) : (
        inputs.map((input) => (
          <Stack key={input.name} tight testId="input">
            <Row>
              <Link href={historyOf(input.guid)}>
                <Strong>{input.name}</Strong>
              </Link>
              <Muted>
                set by {input.by} {input.set_at === 'start' ? 'at the start' : `at step ${input.set_at}`}
              </Muted>
            </Row>
            <Muted>{input.instruction}</Muted>
            <Row>
              {input.options.map((option) => (
                <Badge key={option.value} testId="input-option">
                  {option.value}: {option.description}
                </Badge>
              ))}
            </Row>
          </Stack>
        ))
      )}
      <Heading level={3}>Running workflow experiments</Heading>
      {workflow.experiments.length === 0 ? (
        <Empty>No workflow experiments are running.</Empty>
      ) : (
        workflow.experiments.map((experiment) => {
          const verdict = verdicts.find((candidate) => candidate.id === experiment.id)
          return (
            <Stack key={experiment.id} tight testId="experiment">
              <Row>
                <Badge tone="warn">experiment {experiment.id}</Badge>
                <span>{experiment.change}</span>
                {verdict && (
                  <Badge tone={verdictTone[verdict.status]} testId="experiment-verdict">
                    {verdict.status === 'running' ? `running, ${verdict.counted} of ${verdict.judge_after} items` : `${verdict.status} (mean ${verdict.mean})`}
                  </Badge>
                )}
              </Row>
              <Muted>
                Purpose: {experiment.purpose}. Must not worsen {measureLabel(experiment.measure)} (baseline {experiment.baseline}
                {experiment.baseline_sd ? ` ± ${experiment.baseline_sd}` : ''}, since {experiment.started}
                {experiment.target !== undefined && experiment.target !== null ? `, target ${experiment.target}` : ''}).
              </Muted>
              {experiment.hypothesis && <Muted>Hypothesis: {experiment.hypothesis}</Muted>}
              {experiment.null_hypothesis && <Muted>Null hypothesis: {experiment.null_hypothesis}</Muted>}
            </Stack>
          )
        })
      )}
    </Stack>
  )
}
