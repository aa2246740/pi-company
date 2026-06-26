# OKF Producer Contracts

This file defines who may produce or update each project OKF concept class.

## General producer rules

- Producers preserve source identities: issue id, PR id, branch, head, command, role, and event id where available.
- LLM-authored content defaults to `draft` or `role-authored`, not `project-canonical`.
- Canonical project knowledge requires lead activation or system seed at initialization.
- Runtime facts are referenced, not copied as authority.
- Producers must be idempotent for generated seed files.
- Generated current prose is upserted; history belongs in git/events, not infinite appended sections.

## `/company-init` producer

Inputs:

- project root;
- company id/name;
- default roles, policies, rubrics, and OKF templates.

Outputs:

- `.pi-company/okf/project` bundle;
- `.pi-company/okf/delivery` bundle;
- `.pi-company/okf/imported` directory/policy marker;
- compatibility role prompt cards in `.pi-company/roles/*.md`.

Allowed concept types:

- `BundleManifest`
- `ProjectMission`
- `SourceOfTruthInventory`
- `RoleProfile`
- `EvaluationRubric`
- `ProjectPolicy`

Forbidden:

- overwriting an existing project OKF bundle during idempotent init;
- marking imported content canonical;
- enabling OKF influence on routing, gates, permissions, or merge decisions.

## Lead producer

Allowed:

- activate project-canonical descriptive knowledge;
- create `SprintContract` concepts;
- create/update project mission and constraints;
- approve role profile overrides;
- promote selected imported knowledge after review.

Forbidden:

- using OKF edits to bypass runtime role boundaries or PR gates;
- silently changing an active sprint contract instead of versioning it;
- marking unverified imported content as canonical.

## PM producer

Allowed:

- draft product acceptance criteria;
- draft product rubrics and acceptance findings;
- contribute to sprint contracts before activation.

Forbidden:

- editing runnable deliverables;
- using product concepts to reduce explicit human scope without approval.

## Designer producer

Allowed:

- draft design quality rubrics;
- draft UX/design constraints and acceptance criteria.

Forbidden:

- generating runnable UI assets/code as design knowledge.

## Researcher producer

Allowed:

- import external OKF bundles;
- draft source-linked research concepts;
- propose glossary/constraint updates.

Forbidden:

- making imported content canonical without lead promotion;
- omitting source references for actionable claims.

## Coder producer

Allowed:

- implementation handoffs;
- self-test narrative;
- verification traces from commands the coder ran.

Forbidden:

- defining pass criteria unilaterally;
- editing canonical role profiles, policies, or rubrics;
- marking own implementation as independently validated.

## Tester producer

Allowed:

- tester evaluation findings;
- verification traces;
- blocked/fail/pass evidence against active contract.

Forbidden:

- lowering contract scope;
- submitting caveated pass as pass;
- editing implementation code.

## Reviewer producer

Allowed:

- code review findings;
- review evaluation concepts;
- maintainability/security risk notes.

Forbidden:

- using review concepts to override tester failures;
- editing implementation code.
