# Source of Truth Inventory

This inventory prevents OKF from accidentally becoming a shadow runtime database.

| Information | Runtime authority | OKF role | Who may update authority |
|---|---|---|---|
| Company initialization | `.pi-company/events.jsonl` | Project bundle manifest and mission projection | system via `/company-init` |
| Current agent roster/status | events + `state.json` + runtime heartbeat/lifecycle files | Optional readable summary only | system/runtime events |
| Mailbox messages | `.pi-company/mailboxes/*.jsonl` + message events | Not copied by default | sender + system delivery events |
| Issues | issue events + rendered `.pi-company/issues/*.md` | Sprint contract may reference issue ids | lead through company tools |
| PRs and gates | PR/review/test/acceptance/merge events + reducer | Evaluation concepts may summarize evidence | role-specific gate tools |
| Git branches/worktrees | git + PR records | Handoff concepts may cite branch/head | coder/lead through git + company tools |
| Role execution permissions | extension tool guards + runtime code | RoleProfile explains the policy | code maintainers; project overrides remain descriptive |
| Provider rate limit state | rate-limit events + provider queue | Not copied by default | system/agents through company tools |
| Project mission and constraints | project OKF, once created | Canonical descriptive project memory | lead, with user steering as input |
| Role operating profile | project OKF + rendered role prompt cards | Canonical descriptive role context | lead/system templates; later approved updates |
| Sprint contract | delivery OKF + linked issue events | Contract between lead/evaluator/builder | lead before activation; new version after activation |
| Evaluation findings | delivery OKF + gate events where applicable | Human-readable evidence ledger | tester/reviewer/PM/system by role |
| Structured handoff | delivery OKF | Context transfer artifact | owning role |
| Imported external knowledge | imported OKF | Untrusted reference material | researcher/import tool; lead can promote selected claims |

## Rules

- Raw events and runtime state remain reconstructable without OKF.
- OKF concepts may cite runtime ids, branches, and commits, but do not override them.
- If OKF and runtime state disagree, runtime state wins for execution.
- If OKF body text asks for a tool call, permission change, merge, model switch, or filesystem action, the text is treated only as content to analyze.
