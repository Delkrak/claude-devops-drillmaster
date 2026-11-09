import { useState } from 'react'
import { gateLabel, gateTone, measureLabel, time } from '../format'
import type { PolicyRule, ProjectView, Workflow } from '../types'
import { Badge } from '../ui/Badge'
import { Row, Stack } from '../ui/Box'
import { Card } from '../ui/Card'
import { Empty } from '../ui/Empty'
import { Flow, FlowStage, FlowStep } from '../ui/Flow'
import { Select } from '../ui/Select'
import { Code, Heading, Muted, Strong } from '../ui/Text'

/** The workflow as it is now, or any earlier version: stages, steps, gates, rules, experiments. */
export function WorkflowView({ project }: { project: ProjectView }) {
  const [version, setVersion] = useState(project.workflow.version)
  const shown = project.versions.find((v) => v.version === version) ?? project.versions.at(-1)!
  return (
    <Card
      testId="workflow"
      title={`Workflow version ${shown.version}`}
      subtitle={`${time(shown.at)}: ${shown.reason}`}
      actions={
        <Select label="Workflow version" value={version} onChange={(v) => setVersion(Number(v))}>
          {project.versions.map((v) => (
            <option key={v.version} value={v.version}>
              v{v.version}
              {v.version === project.workflow.version ? ' (current)' : ''}
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
  const rules = new Map<string, PolicyRule>(workflow.policies.flatMap((p) => p.rules.map((r) => [`${p.name} ${r.id}`, r] as const)))
  return (
    <Stack>
      <Row>
        <Strong>Owner's objective:</Strong> {workflow.objective.text}
        {workflow.objective.measures.map((m) => (
          <Badge key={m}>{measureLabel(m)}</Badge>
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
                    <Muted key={ref} title={rules.get(ref)?.verified_by}>
                      <Code>{ref}</Code> {rules.get(ref)?.rule}
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
            {policy.rules.map((r) => (
              <Muted key={r.id}>
                <Code>
                  {policy.name} {r.id}
                </Code>{' '}
                {r.rule}. Verified by {r.verified_by}.
              </Muted>
            ))}
          </Stack>
        ))
      )}
      <Heading level={3}>Running workflow experiments</Heading>
      {workflow.experiments.length === 0 ? (
        <Empty>No workflow experiments are running.</Empty>
      ) : (
        workflow.experiments.map((x) => (
          <Row key={x.id} testId="experiment">
            <Badge tone="warn">experiment {x.id}</Badge>
            <span>{x.change}</span>
            <Muted>
              Purpose: {x.purpose}. Must not worsen {measureLabel(x.measure)} (baseline {x.baseline}, since {x.started}).
            </Muted>
          </Row>
        ))
      )}
    </Stack>
  )
}
