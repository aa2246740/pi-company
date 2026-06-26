# OKF Operating Layer Implementation Plan

Branch: `feat/okf-operating-layer-v0.2`

Working directory: `~/Documents/cmux/pi-company-okf-v0.2`

## Guardrail

Every major architecture step should be checked through `/advice` before implementation continues. The first consultation converged on this guardrail:

> v0.2 OKF is a perception/context layer, not a decision layer.

## Milestone 0: design docs

Deliverables:

- `OKF_ADOPTION_DECISION.md`
- `SOURCE_OF_TRUTH_INVENTORY.md`
- `DOMAIN_PROFILE.md`
- `BUNDLE_BOUNDARIES.md`
- `PRODUCER_CONTRACTS.md`
- `CONSUMER_POLICIES.md`
- `ROLE_PROFILES_AND_CONTRACTS.md`

Validation:

- docs are committed separately before runtime changes.

## Milestone 1: initialization seed, no behavior change

Goal: `/company-init` creates OKF project/delivery/imported directories and seed concepts.

Implementation sketch:

- add `okfDir`, `okfProjectDir`, `okfDeliveryDir`, `okfImportedDir` to `CompanyPaths`;
- add `src/core/okf.ts` or `src/core/okf/*`;
- seed bundle manifests, project source-of-truth, role profiles, rubrics, and policies;
- preserve idempotency: existing OKF files are never overwritten by `initCompany`;
- continue generating `.pi-company/roles/*.md` for compatibility.

Validation:

- core init test checks OKF files exist;
- idempotent init test checks customized OKF files are not overwritten;
- `npm run check`.

## Milestone 2: role resolution layer, no prompt injection yet

Goal: parse and resolve the current role context while preserving authority order.

Advisor consensus for this milestone:

- OKF RoleProfile is lowest-authority contextual augmentation.
- Legacy `.pi-company/roles/*.md` remains the stable behavioral contract.
- System/extension prompt remains highest authority.
- Conflicts or directive-like OKF text must be tagged, not silently merged.

Implementation sketch:

- parse OKF concept frontmatter safely;
- load current role profile from `.pi-company/okf/project/roles/<role>.md`;
- load legacy role card from `.pi-company/roles/<role>.md`;
- return a structured role resolution object with `legacy`, `okf`, and `conflicts`;
- provide a debug/preview renderer;
- skip missing/invalid profiles without failing startup;
- do not inject OKF RoleProfile into live agent prompt in this milestone.

Validation:

- core tests assert legacy and OKF sources are resolved;
- core tests assert directive-like OKF conflicts are tagged;
- no extension behavior or tool permission changes.

## Milestone 3: sprint contract templates and read path

Goal: delivery bundle can hold sprint contracts, but gates still come from runtime events.

Implementation sketch:

- seed contract/evaluation/handoff templates;
- add read-only status display in lead brief if active contracts exist;
- no merge/gate decision depends on OKF.

Validation:

- lead brief shows contract references as context only;
- PR gates unchanged.

## Milestone 4: writer tools, still non-authoritative

Goal: add tools to create contract/evaluation/handoff concepts with role guards.

Implementation sketch:

- `company_create_sprint_contract` lead-only;
- `company_submit_evaluation` evaluator role scoped;
- `company_write_handoff` owner scoped;
- append related events only if needed for audit, not for gate status.

Validation:

- role tests;
- path traversal tests;
- idempotency and versioning tests.

## Out of scope for first pass

- full OKF import/export CLI;
- signatures;
- vector search;
- OKF-driven routing or scoring;
- OKF-driven permissions;
- replacing existing issue/PR markdown renderers.
