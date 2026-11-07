# claude-devops-drillmaster

Drillmaster is a drill sergeant trained in agile, who runs your agentic development workflow like a
bootcamp: every work item runs through your workflow step by step and gate by gate, and the work
trace and Agent's reports feed the workflow retrospectives that keep it improving.

## Install

```
/plugin marketplace add Delkrak/claude-devops-drillmaster
/plugin install devops-drillmaster@claude-devops-drillmaster
```

## Skills

| Skill | What it does |
|---|---|
| `/devops-drillmaster:drillmaster` | Briefs Agent on Drillmaster: the philosophy, the chain of command and every concept of the workflow. |

The concept lives in [`skills/drillmaster/SKILL.md`](skills/drillmaster/SKILL.md). Everything else
in Drillmaster is built on it.

## Validate

```
claude plugin validate .
```
