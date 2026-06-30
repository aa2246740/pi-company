# Changelog

All notable changes to `pi-company` are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## 0.2.0 — OKF operating layer

The OKF (Open Knowledge Format) layer moves from descriptive-only notes to a
**gate-backed operating layer**, enforced by hooks rather than reminders. See
[`docs/okf/OKF_AGENT_LIFECYCLE.md`](docs/okf/OKF_AGENT_LIFECYCLE.md) for the
portable integration guide distilled from this work.

### Added — OKF lifecycle & enforcement
- **SprintContract / RoleBundle / ConsumptionManifest / EvaluationFinding /
  PreflightReport / StructuredHandoff** delivery OKF concepts with explicit
  lifecycle states (`draft → … → active → consumed → resolved → fulfilled`,
  `stale / retired / archived / abandoned`).
- **Hook/gate-first enforcement** (no daemon):
  - `tool_call` hook blocks a coder's implementation writes until the active
    contract has a fresh ConsumptionManifest.
  - `okf gate install-pre-push` installs a git pre-push hook that runs the export
    gate with `--strict` — the delivery egress is enforced regardless of whether
    extensions are loaded.
- **Export gate** requires: active SprintContract, required RoleBundles produced,
  fresh ConsumptionManifest, no unresolved blocking findings, latest
  PreflightReport verdict `pass` with a `patch_hash` matching the current diff
    (branch diff `main...HEAD` + uncommitted + untracked).
- **Hash-based freshness**: consumption manifests store bundle content hashes so a
  changed bundle is detected as stale and blocks export until re-consumed.
- **Launch-time context injection**: the active role working set is rendered into
  the agent system prompt via `before_agent_start`.

### Added — OpenKnowledge-style discovery UX
Synthesized from reviewing `openknowledge-sh/openknowledge` — their knowledge UX
adopted, our gate-backed operating layer kept:
- `okf list` — delivery OKF inventory with discovery output.
- `okf query` — lexical, source-excerpt retrieval over OKF Markdown (no generated
  summaries, to avoid hallucinated context).
- `okf validate` — OKF Markdown shape + lifecycle hygiene validation.
- `okf use` — role working set that optionally records a coder ConsumptionManifest
  (binds "reading" and "recording" into one action).
- `okf open` — print/open the local OKF folder.
- `okf gate consumption` — surface the freshness check from the CLI.

### Added — tooling
- Extension tools for every OKF concept and gate (`company_create_sprint_contract`,
  `company_okf_list`, `company_okf_query`, `company_okf_validate`,
  `company_okf_use`, `company_record_consumption_manifest`,
  `company_record_preflight_report`, `company_okf_export_gate`, …).
- CLI commands mirroring every tool.

### Docs
- `docs/okf/OKF_AGENT_LIFECYCLE.md` — framework-agnostic guide for binding OK/OKF
  to an agent lifecycle via hooks/gates.
- Updated `docs/okf/OKF_ADOPTION_DECISION.md`, role profiles, and source-of-truth
  inventory.

### Tests
- 233 tests passing; typecheck, privacy scan, and build clean.

### Notes on scope
- OKF remains **descriptive knowledge**; runtime events, state, git, tests, PR
  gates, and tool guards remain authoritative.
- Enforcement guarantees the agent *followed the protocol*, not that the patch is
  *correct*. Reserve "resolved" for the authoritative runtime/harness.

## 0.1.x
- Initial multi-agent company runtime: visible Pi agents, role cards, mailboxes,
  PR gates, provider rate-limit handling, cmux surfaces, lead brief.
