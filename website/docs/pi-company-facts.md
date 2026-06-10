# pi-company Facts and Feature Reference

This file is the source of truth for website content. Do not invent features
that are not listed here.

## Product Summary

`pi-company` lets Pi users run visible Pi agents like a local project team. It
connects ordinary Pi panes into one project-local workflow: lead keeps the
global brief, workers coordinate through mailboxes, coders edit in isolated git
worktrees, and local PRs cannot merge until review, test, and product
acceptance gates pass. cmux can launch panes automatically, but cmux is
optional.

## Scope

- Pi required
- local single-machine runtime
- one project per company
- project-local `.pi-company/` state
- event log plus reducer plus mailbox files
- local issues and PR gates
- separate coder worktrees for parallel code edits
- human steering mirrored to lead from every interactive Pi session
- organization-level rate-limit backoff and staggered recovery
- provider request gate to reduce provider overload failures
- optional cmux spawn adapter

## Core Workflow

```text
human -> lead -> local issues -> coder worktrees -> local PR
      -> reviewer + tester -> PM/lead acceptance -> gates -> lead merge
```

Every Pi gets a desk panel inside Pi. Agents coordinate through local tools and
mailbox messages. cmux is only a launcher and surface manager.

## Roles

### Lead

Lead protects project direction, throughput, and integration quality. Lead is
the human's local proxy and should make routine default decisions. Lead should
ask the human only for irreversible, expensive, legal/security-sensitive,
external-contract, brand-risk, or mission-changing decisions.

Lead must not absorb role-owned execution work. If the human names a required
skill, tool, or method, lead preserves that requirement in the assignment to the
responsible agent.

Lead must use global truth before completion claims:

- use `company_lead_brief` or `/company-brief`
- do not trust worker prose such as "done", "merged", or "tested"
- if brief says blocked or in progress, report blockers and next owner

### PM

PM protects user value, scope, and acceptance criteria. PM can own product
acceptance when asked. PM should not accept if a key user-facing flow was not
observed or important evidence is missing.

### Researcher

Researcher owns cross-functional unknowns and external facts. Other roles can
research inside their own tasks, but researcher handles cross-role research.

### Coder

Coder owns implementation quality for assigned tasks. Code-changing work is not
done until the local PR flow is complete: commit, create PR, record automated
tests, mark PR ready with self-test evidence and tester brief.

### Reviewer

Reviewer protects code quality, correctness, maintainability, security,
integration risk, and test quality. Reviewer must not approve by treating failed
commands as green.

### Tester

Tester protects user-facing behavior. Tester validates acceptance criteria,
realistic workflows, edge cases, and regressions. Tester should not submit pass
with hidden caveats.

## CLI Commands

Global option:

```bash
pi-company --root <project-root> <command>
```

Commands:

- `init`: initialize `.pi-company`
- `status`: show agents, issues, PRs, pending merges, and rate-limit state
- `brief`: show lead's authoritative global delivery brief
- `reduce`: rebuild state and rendered issue/PR snapshots from events
- `launch-command <agent>`: print a command to launch an existing agent
- `spawn <role>`: plan or launch an agent
- `steer`: record human steering for an agent and mirror to lead
- `inbox`: show or acknowledge mailbox messages
- `issue`: manage local issues
- `task`: record task progress
- `pr`: manage local PRs
- `message`: send a mailbox message
- `rate-limit`: report provider overload/quota pressure
- `rate-limit-clear`: clear a verified false-positive or recovered backoff
- `cmux-status`: set cmux sidebar status
- `cmux-rate-limit-scan`: scan visible cmux pi-company surfaces for provider overload signals

## Try Locally

```bash
npm run build
node dist/src/cli.js init --id demo
node dist/src/cli.js status
node dist/src/cli.js launch-command lead
```

Manual lead launch:

```bash
eval "$(node dist/src/cli.js launch-command lead)"
```

Launch a worker manually:

```bash
node dist/src/cli.js spawn tester --manual
```

Launch a coder with isolated worktree:

```bash
node dist/src/cli.js spawn coder --name coder-api --yes --manual
```

cmux launch examples:

```bash
node dist/src/cli.js spawn tester --cmux
node dist/src/cli.js spawn coder --name coder-api --yes --cmux
```

## Pi Extension Commands

Inside a Pi session loaded with the extension:

- `/company-status`: refresh and show pi-company desk panel
- `/company-brief`: inject the authoritative lead/global delivery brief
- `/company-inbox`: inject unread mailbox messages
- `/company-ack`: acknowledge unread mailbox messages without injecting
- `/company-send <agent> <text>`: send a pi-company message
- `/company-configure-models`: configure role or agent Pi model policy through
  choices

## Pi Tools

The extension registers tools:

- `company_status`
- `company_lead_brief`
- `company_inbox`
- `company_report_rate_limit`
- `company_clear_rate_limit`
- `company_configure_model_policy`
- `company_send_message`
- `company_create_issue`
- `company_assign_issue`
- `company_task_update`
- `company_spawn_agent`
- `company_create_pr`
- `company_mark_pr_ready`
- `company_submit_review`
- `company_submit_test`
- `company_submit_acceptance`
- `company_record_auto_tests`
- `company_pr_gates`
- `company_merge_pr`

## Role Model Policy

Lead can configure models through `/company-configure-models` or the
`company_configure_model_policy` tool. Model choices come from Pi's configured
available model list, not free-form text.

Targets:

- default model for future and unconfigured roles
- built-in roles: lead, pm, designer, researcher, coder, reviewer, tester
- existing named agents

Stored in `.pi-company/company.yaml` under `model_policy`.

Example:

```yaml
model_policy:
  roles:
    coder:
      provider: openai-codex
      model: gpt-5.4-mini
      thinking: low
    tester:
      provider: xiaomi-token-plan-cn
      model: mimo-v2.5-pro
```

Running Pi panes keep their current model until restarted or changed inside Pi.

## Messaging and Human Steering

Every message is written to the target agent's mailbox. Message wake metadata
decides whether it should wake the agent immediately or wait for digest.

Human steering from any interactive Pi session is mirrored to lead. This lets
the human steer any worker while lead keeps global context.

The extension warns workers not to duplicate human steering messages to lead
when the input hook already mirrored them.

## Message Backpressure

Default wake policy:

- human steering always wakes lead
- assignments, review requests, test requests, and system messages can wake
  immediately
- ordinary reports, replies, and questions default to digest unless marked high
  priority
- same agent can be woken again after 10 seconds
- up to six immediate wakes per agent per minute
- up to twelve immediate wakes per company per minute

## Provider Request Gate and Rate Limits

Every Pi pane loads the extension. Before each provider request, pi-company
acquires a local provider lease under `.pi-company/provider-queue/`.

Default provider policy:

- at most three concurrent requests per provider
- starts for the same provider spaced by five seconds
- unknown provider names are grouped under `unknown-provider`

When provider overload or quota pressure is observed:

```bash
pi-company rate-limit --actor tester --reason "Retry failed after 3 attempts: 429 Too many requests"
```

cmux scan:

```bash
pi-company cmux-rate-limit-scan --workspace workspace:16
```

The first provider overload report pauses automatic wakes for 60 seconds. A second report
while active backs off to 120 seconds, up to 10 minutes. Quota exhaustion uses
at least 10 minutes. Lead resumes first; other agents resume in staggered
intervals.

## Local PR Gates

A PR is mergeable only when:

- PR author is an existing coder agent
- issue-bound PRs are created by the assigned owner
- PR branch and worktree match the author's registered branch/worktree when
  known
- coder self-test evidence exists
- test brief exists
- automated tests are recorded as passed
- required independent reviewer approvals exist
- independent tester validation is pass
- PM or lead product acceptance is accept
- evidence comes from known agents with the right role or ownership
- self-test, review, tester validation, product acceptance, and automated tests
  match the current PR branch HEAD
- PR branch resolves to a git commit and is not the base branch
- PR branch still merges cleanly against the current base branch
- green evidence is explicitly clean and has no structured caveats; legacy
  summaries are also scanned for caveats, known issues, or unresolved risks

Product acceptance is separate from tester validation and code review.

`company_merge_pr` executes local git merge by default when lead calls it and
gates are green. Non-lead agents can only request a merge.

Tracked or staged root changes block merge. Unrelated untracked files do not.
Lead must not run raw `git stash`, `git reset`, `git clean`, revert, or
checkout-away commands in the project root just to make a merge pass.

## cmux Integration

cmux is optional. With cmux, pi-company can launch visible panes. Without cmux,
users can manually create terminal windows and paste launch commands.

Important operational detail:

- restarting a running Pi TUI by sending a launch command can accidentally send
  that command as chat text
- a clean restart should stop the current `pi` process, return the pane to
  shell, then run the launch command

## Source Code

- Harness: `https://github.com/aa2246740/pi-company`
- Website: `https://aa2246740.github.io/pi-company/`
