# OKF Adoption Decision

Status: accepted for the `feat/okf-operating-layer-v0.2` branch.

## Decision

pi-company v0.2 will initialize each company project with an OKF-compatible project knowledge layer under `.pi-company/okf/`.

This layer is a human-readable and agent-readable knowledge projection for long-running project work. It is not the runtime source of truth and not an execution policy engine.

## Advisor consensus

Before implementation, this decision was checked through `/advice` with GPTpro Senior Advisor. The consensus was:

- OKF v0.2 must remain a perception/context layer, not a decision layer.
- OKF content may be read by agents as descriptive guidance.
- OKF content must not apply hard routing, gate, permission, or merge decisions in v0.2.
- If later versions let OKF influence scoring, that influence must be explicit, bounded, and auditable.

## Why adopt OKF

The existing event/state/mailbox runtime is good for current operational truth, but long-running visible agents need a stable project memory layer for:

- role operating profiles;
- project mission, constraints, and source-of-truth inventory;
- sprint contracts;
- evaluation rubrics;
- structured handoffs;
- verification traces and evaluator findings;
- safe exchange of imported project knowledge.

Without a project knowledge layer, this information is spread across prompts, chat history, rendered markdown, and ad-hoc reports. That makes long-running work more likely to drift or restart from stale memory.

## Non-goals

OKF will not replace:

- `.pi-company/events.jsonl` as the event source of truth;
- `.pi-company/state.json` as the derived runtime snapshot;
- mailboxes as the reliable message queue;
- provider queue and lifecycle runtime files;
- git worktrees and branches;
- PR gate evaluation;
- code-enforced role/tool permissions;
- user confirmation and safety policy checks.

## Safety boundary

In v0.2, all OKF strategy and role content is descriptive unless explicitly promoted through existing runtime events and code-enforced policy.

The initial OKF metadata will include an influence boundary:

```yaml
strategy_mode: descriptive
influence:
  enabled: false
```

Runtime code may log that OKF context was read, but must not treat OKF body text as permission, authority, or a tool instruction.

## Version scope

This branch targets a minimal vertical slice:

1. `/company-init` creates project and delivery OKF bundles.
2. Role profiles are stored as OKF concepts and rendered into existing role prompt cards for compatibility.
3. Agent context reads the current role profile as descriptive context.
4. Sprint contract, evaluation, and handoff concept templates are present and can be created by pi-company tools in later commits.
5. Existing runtime behavior stays authoritative.
