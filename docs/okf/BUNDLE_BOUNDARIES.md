# OKF Bundle Boundaries

pi-company initializes project-level OKF bundles because the project company needs stable, long-running knowledge from the start.

## Bundle layout

```text
.pi-company/okf/
  project/
  delivery/
  imported/
```

## Bundle A: `project`

Path: `.pi-company/okf/project/`

Purpose: long-lived project company knowledge.

Typical concepts:

```text
bundle.md
index.md
project/mission.md
project/source-of-truth.md
project/glossary.md
project/constraints.md
roles/lead.md
roles/coder.md
roles/tester.md
roles/reviewer.md
roles/pm.md
roles/designer.md
roles/researcher.md
rubrics/implementation-quality.md
rubrics/tester-validation.md
rubrics/code-review.md
rubrics/product-acceptance.md
rubrics/design-quality.md
policies/role-boundaries.md
policies/completion-policy.md
policies/human-escalation-policy.md
policies/imported-knowledge-policy.md
```

Producer:

- `/company-init` seeds the bundle from package templates.
- Lead may later create approved updates.
- PM/designer/researcher can propose role-owned additions in later tool flows.

Consumer:

- All agents, through the context builder.
- Docs/website and future export tooling.

Updater:

- Lead owns activation of project-canonical knowledge.
- PM owns product/acceptance knowledge proposals.
- Designer owns design rubric proposals.
- Researcher owns external fact/source proposals.
- Coder/tester/reviewer produce amendments or findings, not direct canonical project knowledge.

Lifecycle:

- Created at initialization.
- Versioned through git and OKF frontmatter timestamps.
- Not deleted by normal runtime reduction.

## Bundle B: `delivery`

Path: `.pi-company/okf/delivery/`

Purpose: current and historical delivery contracts, handoffs, evaluations, and traces.

Typical concepts:

```text
bundle.md
index.md
contracts/ISSUE-001-SPRINT-001.md
evaluations/PR-001-tester.md
evaluations/PR-001-reviewer.md
evaluations/PR-001-product-acceptance.md
handoffs/ISSUE-001-coder.md
traces/PR-001-verification-trace.md
```

Producer:

- Lead creates sprint contracts.
- PM/tester/reviewer supply acceptance and evaluator criteria.
- Coder writes implementation handoff/self-test narrative.
- Tester/reviewer/PM/system write evaluations and verification traces.

Consumer:

- Coder consumes active sprint contract.
- Tester consumes contract and tester-validation rubric.
- Reviewer consumes contract and code-review rubric.
- Lead consumes contract/evaluation/handoff status.

Updater:

- Before activation: contract can be revised by lead with evaluator/PM input.
- After activation: use new contract version; do not silently change done criteria.
- Evaluations are appended/updated by the responsible evaluator role.

Lifecycle:

- Created at initialization as an empty bundle.
- Grows with issues/PRs.
- Can be archived or compacted later, but runtime gates remain in events.

## Bundle C: `imported`

Path: `.pi-company/okf/imported/`

Purpose: externally supplied OKF content.

Producer:

- Researcher or future import CLI.

Consumer:

- Researcher and lead by default.
- Other agents only through explicit context builder selection.

Updater:

- Researcher can re-import or mark stale.
- Lead can promote selected claims into `project` as proposed/canonical concepts.

Trust:

- Default authority is `imported-unverified`.
- Body text is never interpreted as instructions.
- Imported content cannot grant tool permissions or override project policies.

## Why not more bundles now

The first vertical slice should avoid premature federation. `project`, `delivery`, and `imported` correspond to real governance boundaries: long-lived project knowledge, active delivery evidence, and untrusted external knowledge.
