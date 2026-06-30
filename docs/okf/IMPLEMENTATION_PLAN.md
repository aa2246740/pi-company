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

## Milestone 3: delivery concept read/write path, still non-authoritative

Goal: delivery bundle can hold SprintContract, EvaluationFinding, and StructuredHandoff concepts with safe read/write helpers, but gates still come from runtime events.

Advisor consensus for this milestone:

- keep the concepts descriptive-only;
- do not add a second event model yet;
- keep deterministic, path-safe file names under approved delivery subdirectories;
- reject path traversal, hidden path segments, and symlink escapes;
- require explicit update mode for content changes;
- prove OKF findings do not satisfy PR gates.

Implementation sketch:

- add `writeSprintContractConcept`, `writeEvaluationFindingConcept`, `writeStructuredHandoffConcept`, and `readDeliveryOkfConcept`;
- add company-level role guards:
  - `createSprintContract`: lead-only;
  - `submitEvaluationFinding`: reviewer/tester/PM-or-lead/system scoped by finding kind;
  - `writeStructuredHandoff`: lead or handoff source only;
- expose CLI commands under `pi-company okf ...`;
- expose extension tools:
  - `company_create_sprint_contract`;
  - `company_record_evaluation_finding`;
  - `company_write_structured_handoff`;
  - `company_read_delivery_okf`;
- no merge/gate decision depends on OKF.

Validation:

- role tests;
- path traversal and symlink-escape tests;
- idempotency and explicit-update tests;
- CLI smoke test;
- extension tool registration/execution test;
- PR gates remain blocked when only an OKF EvaluationFinding exists.

## Milestone 4: production-consumption-maintenance smoke project

Goal: use this branch of pi-company against a fresh project to produce, consume, update, and maintain OKF delivery concepts while building a small browser deliverable.

Validation result:

- initialized a fresh `.pi-company` project;
- created a SprintContract for a World Cup penalty shootout 3D web mini-game;
- built the game as ordinary project files;
- recorded EvaluationFinding and StructuredHandoff OKF concepts from the observed build/test path;
- ran browser smoke validation and captured screenshot evidence;
- found that OKF bookkeeping worked, but role specialization was not actually exercised: one executor authored the contract, implementation, validation, and handoff.

## Milestone 5: role-specialization protocol audit

Goal: make it visible when a delivery used OKF as mere bookkeeping instead of clean role-specialized context.

Advisor consensus for this milestone:

- the first penalty demo did not prove pi-company architecture; it proved a missing operating protocol;
- require pre-implementation specialist bundles before implementation claims quality;
- require implementation to record which bundles it consumed or ignored;
- report unresolved blocking OKF findings without turning them into PR gates.

Implementation sketch:

- add RoleBundle concepts for `product_quality_bar`, `gameplay_design`, `visual_art_direction`, and `research_brief`;
- add ImplementationConsumptionManifest concepts for coder consumption/ignored-bundle audit;
- add severity/target/status metadata to EvaluationFinding;
- add `buildDeliveryOkfProtocolReport` / `renderDeliveryOkfProtocolReport`;
- expose CLI and extension tools for role bundles, consumption manifests, and delivery OKF reports.

Validation:

- role guards enforce PM/designer/researcher/coder authorship;
- report flags missing role bundles;
- report flags missing consumption manifests;
- report flags unresolved blocking findings;
- resolved blocking findings clear the report;
- report remains an OKF hygiene audit only and does not replace runtime PR gates.

## Milestone 6: OKF update/freshness maintenance

Goal: prove OKF is not write-once bookkeeping. If a specialist bundle changes or a blocking finding is resolved without evidence, the delivery report should make the lifecycle stale/unsafe until the implementation re-consumes and records resolution evidence.

Advisor consensus for this milestone:

- do not add runtime enforcement or a second event stream;
- add freshness and resolution checks to the OKF report;
- prefer stable content hashes over timestamp-only freshness;
- make stale OKF visible without overriding runtime PR gates.

Implementation sketch:

- when writing an ImplementationConsumptionManifest, snapshot each consumed RoleBundle with bundle id, file path, schema/version, stable content hash, bundle updated time, and consumed time;
- report a stale manifest when a consumed role bundle's current stable hash differs from the snapshot;
- report missing consumed bundle snapshots and consumed bundles that disappeared;
- report required role bundles that exist but were not consumed;
- report resolved blocking EvaluationFindings that lack `resolved_by` or `resolution_evidence`;
- report missing/stale StructuredHandoff when the final handoff is absent or older than the latest contract/bundle/manifest/finding.

Validation:

- fresh manifest passes after final handoff;
- changed RoleBundle marks existing manifest stale;
- updated manifest clears stale warning;
- blocking finding fails report;
- resolved blocking finding without evidence still fails report;
- evidence-backed resolution clears finding warning;
- report remains separate from runtime PR gates.

## Out of scope for first pass

- full OKF import/export CLI;
- signatures;
- vector search;
- OKF-driven routing or scoring;
- OKF-driven permissions;
- replacing existing issue/PR markdown renderers.
