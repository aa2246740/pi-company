# OKF × Agent Lifecycle — a portable integration guide

> How to bind Open Knowledge (`OK`) bundles and the Open Knowledge Format
> (`OKF`) to an autonomous agent's lifecycle, using **hooks and gates rather than
> reminders or a daemon**.
>
> This document is framework-agnostic. It distills lessons from building and
> benchmarking an OKF operating layer (the `pi-company` OKF v0.2 work). It is
> meant to be copied into any project that wants durable, agent-maintained,
> auditable knowledge without turning that knowledge into a runtime authority.

---

## 0. Read this first: the one rule that prevents every other mistake

> **OKF is descriptive knowledge. It is never runtime truth.**

Events, state files, git, tests, CI, PR gates, tool guards, and the official
evaluation harness are authoritative. OKF bundles are context that agents read,
write, and hand off. The moment you let an OKF document *override* a runtime
check, you have two sources of truth and they will drift.

Everything below is a consequence of this rule.

---

## 1. The four-layer mental model

Keep these strictly separate in vocabulary and in storage:

| Layer | What it is | Where it lives | Authoritative? |
|---|---|---|---|
| **OKF knowledge** | Durable facts, contracts, decisions, research, rubrics | Markdown bundles (`OK` wiki) | No — descriptive |
| **Skill / workflow** | *How* an agent should do a task (procedure) | Agent instructions the agent actually reads (role card / `AGENTS.md` / skill file) | No — guidance |
| **Capability / plugin** | Tools/connectors the agent can call | Tool registry | No — available |
| **Runtime truth** | Events, state, git, tests, gates | State files, CI, VCS | **Yes** |

A common failure is to let OKF ("knowledge") silently absorb workflow and
authority. Resist this. If something must be enforced, it belongs in a hook or a
runtime gate, not in a Markdown paragraph that *says* "you must".

The separation also tells you *where* to put things: skills live where the agent
reads them (repo-scoped `AGENTS.md`, not buried in the wiki); knowledge lives in
the wiki; enforcement lives in code.

---

## 2. What OKF is, and is not

| OKF **is** good for | OKF **cannot** do |
|---|---|
| Being found (`list`, `query`) | Guaranteeing knowledge is *correct* |
| Being maintained (write/retire/refresh) | Guaranteeing a fix is *complete* |
| Being consumed (auditable manifests) | Passing hidden tests it cannot see |
| Making collaboration auditable end-to-end | Improving benchmark accuracy by itself |
| Preventing regressions you already test for | Discovering contracts that only exist in gold tests |

The last two rows are not pessimism — they are the single most expensive lesson
from benchmarking OKF end-to-end. Internalize them before adopting.

---

## 3. Bundle lifecycle

A bundle (or any OKF concept) moves through explicit states. Only
`active`/`accepted` concepts enter an agent's working set; the rest are
historical unless explicitly revived.

```
draft → proposed → accepted → active → consumed → resolved → fulfilled
                                          │
                                          └→ stale ─→ retired ─→ archived
                                            (refresh)  (sprint end)
```

Rules that make the lifecycle actually work:

1. **One active contract at a time** per unit of work. Parallel contracts create
   ambiguous working sets.
2. **Retire sprint-scoped knowledge at delivery.** Promote only durable facts
   into the long-lived project bundle. Otherwise the wiki rots.
3. **Mark `stale` when source facts change**, not when someone notices. A bundle
   whose hash no longer matches its consumption snapshot is stale by definition.
4. **Transitions are lead/maintainer metadata**, not runtime truth. They organize
   the working set; they do not grant permissions.

---

## 4. The six lifecycle binding points

This is the core of the guide. Bind OKF to the agent lifecycle at exactly these
points, each enforced by a **hook** (not a reminder):

### 4.1 Launch — *inject* the working set
- **When:** before the agent's first completion (`before_agent_start` /
  session start).
- **Mechanism:** render the role-scoped active OKF into the system prompt.
- **Guarantees:** the agent *knows* the bundles exist without having to remember
  to look. (Relying on the agent to "go read the wiki" does not work — this is the
  single most reliable lever.)
- **What it does NOT guarantee:** that the agent will act on the knowledge.

### 4.2 Write — *validate* shape
- **When:** at concept write time.
- **Mechanism:** validate frontmatter, `type`, lifecycle status, required fields.
- **Guarantees:** malformed concepts never enter the working set.
- **Cheap to implement, high payoff.** Do this first.

### 4.3 Consume — *record* the read
- **When:** when implementation begins to rely on a bundle.
- **Mechanism:** a consumption manifest that records consumed bundle ids **and a
  content hash of each at consume time**. Bind "reading" and "recording" into one
  action (`use --consume-as`).
- **Guarantees:** context flow is auditable, and a changed bundle is detectable.
- **Why hashes:** without them, "consumed" is a lie the moment the bundle is
  edited. With them, staleness is mechanical.

### 4.4 Preflight — *verify* before claiming done
- **When:** after implementation, before export.
- **Mechanism:** an evaluator runs focused public tests/reviews and records a
  preflight verdict bound to a **patch hash** (the current diff).
- **Guarantees:** evidence is pinned to a specific patch; editing the patch
  invalidates the preflight.
- **Honest limit:** preflight runs *public* checks. It cannot see hidden tests.

### 4.5 Export — *gate* the delivery egress
- **When:** before any delivery action (push, PR ready, "done" claim).
- **Mechanism:** a strict gate requiring: active contract, required bundles
  produced, fresh consumption, no blocking findings, latest preflight verdict
  `pass` with a hash matching the current patch. Enforce via **git pre-push hook**
  and/or a tool hook — not by asking the agent to run a command.
- **Guarantees:** nothing leaves in a state that skips the protocol.
- **What it does NOT guarantee:** that the patch is correct (see §6).

### 4.6 Handoff / Stop — *transfer* durable context
- **When:** role or session change, or stop.
- **Mechanism:** a structured handoff (current owner, next owner, blockers, next
  actions, contract linkage). Optionally a stop-hook checks obligations.
- **Guarantees:** the next owner can resume without stale chat memory.

---

## 5. Enforcement philosophy: hooks, not reminders; no daemon

The most reliable design is **gate-first, daemon-free**:

- **Hooks** enforce at boundaries (launch, write, consume, preflight, export).
- **No background daemon.** A daemon tempts you to turn OKF into an internal
  message bus, which violates §0. Hooks are cheaper, auditable, and impossible to
  "forget".
- **Two enforcement surfaces, both required:**
  1. An **agent/tool hook** (e.g. `tool_call`) that blocks implementation writes
     until consumption is recorded — enforcement *inside* the agent loop.
  2. A **VCS hook** (e.g. git `pre-push`) that runs the export gate — enforcement
     at the *delivery egress*, independent of whether the agent cooperated.

This mirrors the widely-shared observation that *"hooks and pre-push verification
scripts are how you enforce this."* It is correct **for process reliability**.

### The honest limit of enforcement (do not skip this)

Enforcement guarantees the agent **followed the protocol**. It does **not**
guarantee the **patch is correct**. Concretely, measured against the official
SWE-bench harness:

- A `Ready: yes` export gate + green preflight still produced **unresolved** on
  cases where the research missed a code path (e.g. field-level validation paths
  living in a different test module than the one the research mapped).
- A hook cannot manufacture a code path the research never discovered.

So: use hooks to make the protocol unavoidable; do **not** report a green gate as
"resolved". Only the authoritative runtime (tests/CI/harness) decides resolved.

---

## 6. Freshness & consumption — the mechanism that makes "used" mean something

```
bundle  ──hash──►  consumption manifest
   │                    │
   └── edited ──►  hash mismatch = stale = block export until re-consumed
```

- Every consumed bundle carries a snapshot `{bundle_id, bundle_hash, consumed_at}`.
- The export gate (and the consume-time check) compares the snapshot hash to the
  current bundle hash.
- Outcome: **editing a bundle forces re-consumption**, so stale guidance can never
  silently back an export. This is the difference between "the agent read
  something once" and "the agent is bound to current knowledge".

---

## 7. Honest limits (what OKF will not buy you)

Distilled from benchmarking, so you do not have to re-discover them:

1. **Green preflight ≠ resolved.** Public tests can pass while hidden tests fail.
   Reserve "resolved" for the authoritative harness.
2. **Enforcement ≠ correctness.** Hooks make the protocol unavoidable; they do
   not make the patch right (see §5).
3. **Minimality can be harmful.** On issues where the public text is a narrow
   description of a broad hidden contract, a "smallest fix that satisfies the
   visible issue" systematically under-covers. An Occam/minimality gate would
   *reinforce* this failure, not prevent it. Prefer explicit invariant matrices
   that enumerate affected paths over blind minimality.
4. **Orchestration cost is real.** A multi-role pipeline makes more model calls
   than a single plain run, so on a flaky provider it is *more* exposed to stalls.
   Reliability gains depend on provider stability, not on OKF design.
5. **OKF does not improve benchmark score by itself.** Across every case tried,
   OKF improved process reliability and auditability; it did not beat a plain
   single-agent baseline on score. Treat OKF as a knowledge/process layer, not an
   accuracy booster.

---

## 8. Adoption checklist (wire into a new project)

1. **Decide storage.** OKF = Markdown + YAML frontmatter in a colocated folder
   (e.g. `knowledge/` or `.ok/`). No database.
2. **Define the concept types you need.** Start tiny: `BundleManifest`,
   `SprintContract`, `RoleBundle`, `ConsumptionManifest`, `PreflightReport`,
   `StructuredHandoff`. Add `RoleProfile`/`EvaluationRubric` only if useful.
3. **Implement §4.2 write-time validation first.** Highest payoff, lowest cost.
4. **Implement §4.1 launch-time injection.** Render active OKF into the system
   prompt per role.
5. **Implement §4.3 consumption with hashes.** Without hashes, skip this — it
   would be theater.
6. **Implement §4.5 export gate on a VCS hook** (git `pre-push`). This is the
   egress that makes the whole thing real.
7. **Add a `validate` + `list` + `query` CLI** for discovery (lexical,
   source-excerpt retrieval — no generated summaries, to avoid hallucinated
   context).
8. **Document the boundary (§0) where agents read it.** Put it in `AGENTS.md` or
   the role card, not only in the wiki.
9. **Set the lifecycle expectation:** retire sprint-scoped knowledge at delivery;
   promote only durable facts.
10. **Never report a gate verdict as "resolved".** Wire resolved-status to the
    authoritative runtime only.

---

## 9. Minimal concept schemas (copy-paste starting point)

```markdown
---
type: SprintContract
contract_id: <id>
status: active
owner: <agent>
done_criteria: [...]
required_evidence: [...]
---

# Scope
...

# Done criteria
...

# Runtime authority boundary
This contract is descriptive. Tests, git, CI, and review remain authoritative.
```

```markdown
---
type: ConsumptionManifest
manifest_id: <id>
contract_id: <id>
implementation_owner: <agent>
consumed_bundles: [<bundle_id>, ...]
consumed_bundle_snapshots:
  - { bundle_id: <id>, bundle_hash: <sha256>, consumed_at: <iso> }
status: active
---
```

```markdown
---
type: PreflightReport
preflight_id: <id>
contract_id: <id>
evaluator: <agent>
verdict: pass | fail | blocked
patch_hash: <sha256 of current diff>
status: active
---
```

The `patch_hash` and `bundle_hash` fields are not optional ornament — they are what
make the lifecycle enforceable rather than aspirational.

---

## 10. One-paragraph summary

Bind OKF to the agent lifecycle at six points (launch-inject, write-validate,
consume-record, preflight-verify, export-gate, handoff-transfer), enforce each
with a hook instead of a reminder, keep no daemon, store knowledge as Markdown
with hashed consumption, and never confuse a green gate with a correct patch.
That yields durable, agent-maintained, auditable knowledge — which is what OKF is
for — without overpromising that it is an oracle.
