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
import { Code, Heading, Muted, Strong } from '../ui/Text'

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
      <WorkflowBody workflow={shown.workflow} verdicts={shown.version === project.workflow.version ? project.experiment_verdicts : []} />
    </Card>
  )
}

const verdictTone = { running: 'neutral', keep: 'ok', rethink: 'bad' } as const

function WorkflowBody({ workflow, verdicts }: { workflow: Workflow; verdicts: ExperimentVerdict[] }) {
  const rulesByRef = new Map<string, PolicyRule>(workflow.policies.flatMap((policy) => policy.rules.map((rule) => [`${policy.name} ${rule.id}`, rule] as const)))
  const definitionOfDone = (stage: WorkStage) => [...new Set(stage.steps.flatMap((step) => step.rules))]
  const metrics = workflow.metrics ?? []
  return (
    <Stack>
      <Row>
        <Strong>Owner's objective:</Strong> {workflow.objective.text}
        {workflow.objective.measures.map((measure) => (
          <Badge key={measure}>{measureLabel(measure)}</Badge>
        ))}
      </Row>
      {workflow.stages.length === 0 ? (
        <Empty>No work stages yet. Agent does its best, Owner corrects it, and the workflow grows from those corrections.</Empty>
      ) : (
        <Flow>
          {workflow.stages.map((stage) => (
            <FlowStage key={stage.n}>
              <Heading level={3}>
                {stage.n}. {stage.name}
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
                        <Code>{ref}</Code> {rulesByRef.get(ref)?.rule}
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
                    {step.name}
                  </Row>
                  <Row>
                    <Badge tone={gateTone[step.gate]}>{gateLabel[step.gate]}</Badge>
                    {metrics
                      .filter((metric) => metric.at.stage === stage.n && metric.at.step === step.n)
                      .map((metric) => (
                        <Badge key={metric.name} tone="info">
                          metric {metric.name}
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
            <Strong>{policy.name} work policy</Strong>
            {policy.rules.map((rule) => (
              <Muted key={rule.id}>
                <Code>
                  {policy.name} {rule.id}
                </Code>{' '}
                {rule.rule}. Verified by {rule.verified_by}.
              </Muted>
            ))}
          </Stack>
        ))
      )}
      <Heading level={3}>Metrics</Heading>
      {metrics.length === 0 ? (
        <Empty>No metrics yet.</Empty>
      ) : (
        metrics.map((metric) => (
          <Stack key={metric.name} tight testId="metric">
            <Row>
              <Strong>{metric.name}</Strong>
              <Muted>
                taken by {metric.by} at work step {metric.at.stage}.{metric.at.step}
              </Muted>
            </Row>
            <Muted>{metric.instruction}</Muted>
            <Row>
              {metric.categories.map((category) => (
                <Badge key={category.value} testId="metric-category">
                  {category.value}: {category.description}
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
