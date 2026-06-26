# Role Profiles and Sprint Contracts

This document merges the long-running agent strategy with the project OKF layer.

## RoleProfile model

A role profile is an OKF concept under `.pi-company/okf/project/roles/`.

It is not just personality. It captures:

- mission;
- temperament;
- decision bias;
- evidence policy;
- stop policy;
- handoff policy;
- forbidden actions;
- relevant rubric refs;
- relationship to runtime tool policy.

Example frontmatter:

```yaml
---
type: RoleProfile
title: Tester role profile
role: tester
status: active
authority: project-canonical
owner: lead
content_origin: system-seeded
strategy_mode: descriptive
influence:
  enabled: false
sensitivity: project-internal
---
```

## RoleProfile consumers

- Extension context builder reads the current agent's RoleProfile.
- `.pi-company/roles/*.md` remains as compatibility prompt cards and can be rendered from RoleProfile + package defaults.
- Runtime tool guards remain code-enforced.

## Default role temperaments

| Role | Temperament | Bias |
|---|---|---|
| lead | boring integrator | favor verified runtime truth over worker prose |
| PM | acceptance owner | protect user value and explicit scope |
| designer | originality/craft owner | avoid generic AI slop and specify buildable design intent |
| researcher | source skeptic | separate facts, hypotheses, and recommendations |
| coder | single-sprint builder | implement one active contract in assigned worktree |
| reviewer | maintainability adversary | find correctness, risk, and test-quality gaps |
| tester | adversarial evaluator | assume incomplete until reproduced |

## SprintContract model

A sprint contract is an OKF concept under `.pi-company/okf/delivery/contracts/`.

It bridges a high-level issue and testable work. It should answer:

- linked issue id;
- owning role/agent;
- scope;
- non-goals;
- done criteria;
- required evidence;
- evaluator roles;
- activation state;
- version and supersession.

Example frontmatter:

```yaml
---
type: SprintContract
title: ISSUE-001 Sprint 001
issue_id: ISSUE-001
contract_id: ISSUE-001-SPRINT-001
status: active
authority: project-canonical
owner: lead
activated_at: "2026-06-26T00:00:00Z"
strategy_mode: descriptive
influence:
  enabled: false
---
```

## Contract lifecycle

```text
draft -> active -> fulfilled | superseded | abandoned
```

Rules:

- Draft contracts can be revised.
- Active contracts cannot be silently changed; create a new version.
- Coder consumes active contract but does not own pass criteria.
- Tester/reviewer/PM evaluate against active contract.
- PR gates remain authoritative for merge readiness.

## EvaluationFinding model

Evaluation findings live under `.pi-company/okf/delivery/evaluations/`.

They include:

- linked contract id;
- linked PR id/head when available;
- evaluator role/agent;
- verdict;
- evidence;
- blockers;
- caveats;
- commands/user flows checked.

Findings support lead decisions but do not replace `review.submitted`, `test.submitted`, `acceptance.submitted`, or `pr.automated_tests` events.

## StructuredHandoff model

Handoffs live under `.pi-company/okf/delivery/handoffs/`.

They include:

- current owner;
- next owner;
- runtime ids;
- branch/head/worktree;
- contract status;
- evidence summary;
- blockers;
- next action;
- freshness.

Structured handoffs are the antidote to context compression drift: they preserve the facts the next session needs without treating stale chat as truth.
