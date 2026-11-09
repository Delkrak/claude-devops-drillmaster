import { useState } from 'react'
import { formatDateTime, gateLabel, gateTone, measureLabel } from '../format'
import type { PolicyRule, ProjectView, Workflow } from '../types'
import { Badge } from '../ui/Badge'
import { Row, Stack } from '../ui/Box'
import { Card } from '../ui/Card'
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
      <WorkflowBody workflow={shown.workflow} />
    </Card>
  )
}

function WorkflowBody({ workflow }: { workflow: Workflow }) {
  const rulesByRef = new Map<string, PolicyRule>(workflow.policies.flatMap((policy) => policy.rules.map((rule) => [`${policy.name} ${rule.id}`, rule] as const)))
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
                  </Row>
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
      <Heading level={3}>Running workflow experiments</Heading>
      {workflow.experiments.length === 0 ? (
        <Empty>No workflow experiments are running.</Empty>
      ) : (
        workflow.experiments.map((experiment) => (
          <Row key={experiment.id} testId="experiment">
            <Badge tone="warn">experiment {experiment.id}</Badge>
            <span>{experiment.change}</span>
            <Muted>
              Purpose: {experiment.purpose}. Must not worsen {measureLabel(experiment.measure)} (baseline {experiment.baseline}, since {experiment.started}).
            </Muted>
          </Row>
        ))
      )}
    </Stack>
  )
}
