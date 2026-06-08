# pi-company

[English](README.md) | [中文](README.zh-CN.md)

`pi-company` is a Pi-native runtime for running a local agent company inside one project.

It is built for visible, steerable Pi agents. cmux can launch panes automatically, but cmux is optional.

- Source: https://github.com/aa2246740/pi-company
- Website: https://aa2246740.github.io/pi-company/

## What Is It?

`pi-company` is not a Node backend service or a daemon you keep running.

It has two pieces:

- **Pi extension/package**: loaded into Pi agent sessions to add the desk panel, mailbox polling, tools, slash commands, and human-steering mirror.
- **Helper CLI**: used to initialize a project, print launch commands, plan/start agents, inspect status, and handle occasional operations.

Node is only the runtime for the CLI and extension code. In daily use, you enter a project directory and launch Pi with the pi-company extension.

## Current Scope

- Pi required
- Local single-machine
- One project per company
- Project-local `.pi-company/` state
- Event log + reducer + mailboxes
- Local issues and PR gates
- Separate coder worktrees for parallel code edits
- Human steering mirrored to lead from every interactive Pi session
- Organization-level rate-limit backoff and staggered recovery
- Optional cmux spawn adapter

## Workflow

```text
human -> lead -> local issues -> coder worktrees -> local PR
      -> reviewer + tester -> PM/lead acceptance -> gates -> lead merge
```

Every Pi gets its own desk panel inside Pi. Agents coordinate through local tools and mailbox messages. cmux is only a launcher/surface manager.

Lead is the human's local proxy, not a passive dispatcher. PM can define product
scope and acceptance criteria, but when PM needs a routine low-risk default,
lead should make the decision and keep the company moving. Lead should only ask
the human for decisions that are irreversible, expensive, legal/security
sensitive, external-contract dependent, brand-risky, or mission-changing.
Lead should not absorb role-owned execution work. If the human names a required
skill, tool, or method, lead preserves that requirement in the assignment to the
responsible agent instead of doing that work in the lead context.

## Development

```bash
npm install
npm run check
npm run build
```

## Daily Use

If you are used to starting Pi first, install pi-company as a Pi package:

```bash
npm install -g pi-company
pi install npm:pi-company
cd ~/Documents/cmux/tarot-draw
pi
```

Inside Pi, run:

```text
/company-init
```

`/company-init` creates the project-local `.pi-company/` state and attaches the current Pi session as `lead`. After that, starting Pi from that directory is enough: Pi restores the chat session normally, and pi-company automatically attaches to the existing company, shows the desk panel, registers company tools, mirrors human steering, gates provider requests, and refreshes role/lead context before each agent turn.

If you prefer shell-first setup, `pi-company init` does the same initialization before you launch Pi.

If you want to manually push the current role instructions and lead brief into the visible chat, run `/company-start` inside Pi. It is a refresh command, not a required resume step.

Installing the Pi package does not make every `pi` session a company session. In ordinary directories without `.pi-company/`, Pi stays ordinary: pi-company does not create files, register company tools, mirror human input, gate provider requests, or show the company desk panel.

Then talk to lead in natural language:

```text
Continue the tarot draw website. Check current state, decide which roles are needed, and distribute the work.
```

Lead uses pi-company tools to create issues, assign work, coordinate coder/reviewer/tester/PM, and track gates. If you need another visible agent pane, lead can spawn it through tools, or you can run:

```bash
npm install -g pi-company # optional helper CLI
pi-company spawn tester --manual
pi-company spawn coder --name coder-ui --yes --manual
```

If cmux is installed:

```bash
pi-company spawn tester --cmux
pi-company spawn coder --name coder-ui --yes --cmux
```

`--root <project>` is only for operating on a project while your shell is somewhere else:

```bash
pi-company --root ~/Documents/cmux/tarot-draw status
```

When you are already inside the project directory, omit `--root`.

If you prefer to launch lead directly from the shell:

```bash
eval "$(pi-company launch-command lead)"
```

Running `init` again in an existing company is idempotent. It loads the existing
event log instead of resetting roster, issues, PRs, or agent status.
`init` also keeps `.pi-company/` in `.gitignore` so local company state and
managed worktrees do not get committed by `git add .`.

For source development:

```bash
npm install
npm run build
node dist/src/cli.js status
```

Use `spawn` to create a new named agent or to launch an existing roster member.
For an exact shell command without spawn ergonomics, use `launch-command <agent>`.

## Role Model Policy

Pi-company can launch different roles or named agents with different Pi models.
Model choices are not free-form inside the Pi UI: lead uses Pi's configured
available model list, the same source as `/model` and `pi --list-models`.

In the lead Pi pane, the human can simply say "configure role models" or run:

```text
/company-configure-models
```

Lead opens a choice-based wizard. The human does not need to know role names
ahead of time. The wizard lists:

- default model for future and unconfigured roles
- all built-in supported roles: lead, pm, designer, researcher, coder, reviewer, tester
- existing named agents

For each target, lead chooses one model from Pi's configured models, then an
optional thinking level. After one target is configured, the wizard asks whether
to configure another role.

The selection is saved to `.pi-company/company.yaml` under `model_policy`.
For example:

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

If no explicit default is configured, agents inherit Pi's normal startup model,
which is usually the same model the lead pane was launched with. If default is
changed, dynamically added roles and agents inherit that default unless a role
or named-agent override is set.

The next `launch-command` or `company_spawn_agent` run for that role includes
Pi flags such as `--provider`, `--model`, and `--thinking`. Running Pi panes keep
their current model until they are restarted or changed inside Pi.

Inside Pi, only the configured lead agent can spawn persistent agents. Other
agents should message lead when they need more role context.

Only lead can create or assign formal local issues. Other agents should report
scope changes, blockers, or follow-up work to lead through the mailbox.
Issue assignees must already exist in the company roster; spawn/register new
agents before assigning work to them.

Only the assigned issue owner can start, block, report on, or complete that
issue.

When a mission or message contains shell-sensitive text such as `$impeccable`,
`$grill-me`, or `$PORT`, read it from stdin or a file instead of putting it in
double-quoted shell arguments:

```bash
printf '%s' 'Use $impeccable to polish site/.' \
  | node dist/src/cli.js spawn coder --name coder-ui --yes --manual --mission-stdin

printf '%s' 'Run: PORT=8765; curl http://127.0.0.1:$PORT/' \
  | node dist/src/cli.js message --from lead --to tester --type test --text-stdin
```

Launch a coder with an isolated worktree:

```bash
node dist/src/cli.js spawn coder --name coder-api --yes --manual
```

New coder worktrees branch from `main` when it exists, regardless of the
current checkout in the project root.

If cmux is installed and available:

```bash
node dist/src/cli.js spawn tester --cmux
node dist/src/cli.js spawn coder --name coder-api --yes --cmux
```

## Pi Extension

The package exposes the compiled extension through `package.json`:

```json
{
  "pi": {
    "extensions": ["./dist/extensions/company.js"]
  }
}
```

During development you can also load the source extension:

```bash
pi -e ./extensions/company.ts --company-root "$PWD" --company-agent lead --company-role lead
```

The extension registers:

- UI: status line and desk panel for the current agent
- input hook: mirrors interactive human steering to lead
- mailbox poller: reads local messages; wake metadata tells future launchers whether a message should wake immediately or wait for digest
- commands: `/company-init`, `/company-start` (manual brief refresh), `/company-resume` (compatibility alias), `/company-status`, `/company-brief`, `/company-inbox`, `/company-ack`, `/company-send`, `/company-configure-models`
- tools: status, lead/global brief, inbox, send message, issues, task updates, spawn agent, local PR gates, review, test, product acceptance, automated-test evidence, merge request, rate-limit report, model policy configuration

`company_lead_brief` is the lead's authoritative global delivery view. Lead
must use it before telling the human that work, a feature, a PR, or the project
is complete or merged. Worker prose such as "done", "merged", "tested", or
"basically complete" is not delivery truth until the brief shows the related
issues done, PRs merged, and no dirty tracked worktree blockers.

## Message Backpressure

Every message is still written to the target agent's mailbox. To avoid wake
storms and Pi provider `429` errors, each message also carries a wake decision:

- `immediate`: suitable for waking the target agent now
- `digest`: keep it in inbox; let the target agent read it in the next batch

By default, human steering always wakes lead. Assignments, review requests, test
requests, and system messages can wake immediately, but respect per-agent and
organization-level cooldowns. The default wake policy is light: the same agent
can be woken again after 10 seconds, with up to six immediate wakes per agent
per minute and twelve per company per minute. Normal reports, replies, and
questions default to digest unless marked high priority.

The Pi extension records provider HTTP `429` responses through Pi's
`after_provider_response` hook. It also catches `429` or quota-like failures
while injecting mailbox follow-ups: the message remains unacknowledged, the
company enters backoff, and delivery is retried only after the wake policy says
the target agent can resume.

pi-company also gates provider requests before they are sent. Every Pi pane
loads the extension, and `before_provider_request` acquires a local provider
lease under `.pi-company/provider-queue/`. By default, one company allows at
most three concurrent requests per provider and spaces starts for the same
provider by five seconds. If Pi does not expose a provider name for a request,
the request is conservatively grouped under `unknown-provider`.

If an agent, human, or external supervisor sees provider `429`, quota
exhaustion, or repeated retry failures outside those hooks, report the incident
instead of retrying in a loop:

```bash
pi-company rate-limit --actor tester --reason "Retry failed after 3 attempts: 429 Too many requests"
```

For cmux-based companies, an external supervisor can scan visible pi-company
surfaces and report screen-visible provider failures:

```bash
pi-company cmux-rate-limit-scan --workspace workspace:16
```

The scan ignores pi-company's own `rate-limit: active/recent` status lines and
does not extend an already active backoff unless `--force` is passed.
If a scan or human observation is verified as a false positive, lead can clear
the backoff with `pi-company rate-limit-clear --actor lead --reason "..."` or
the `company_clear_rate_limit` Pi tool.

Inside Pi, agents can use the `company_report_rate_limit` tool for the same
purpose. The first provider `429` pauses automatic wakes for 60 seconds. A second
report while the pause is active backs off to 120 seconds, up to a 10 minute cap.
Quota exhaustion uses at least a 10 minute pause. Lead is resumed first; other
agents are resumed in 30 second staggered intervals so recovery does not wake the
whole company at once.

The wake policy is not the main provider-safety mechanism. It only prevents
message storms. Provider safety comes from the request gate: at most three
concurrent requests per provider, with starts spaced by five seconds by default.
Extra messages are queued as digest wakes only when they would repeatedly wake
the same agent or exceed the company wake budget.

This is harness-level buffering for mailbox delivery and follow-up wakes. It
does not replace Pi's provider retry logic for a model request that is already
running. When that request fails, the agent records the rate-limit incident and
lets pi-company delay the next wave of work.

Mailbox participants and inbox readers must be known agents. The special sender
`system` is allowed for system notices, but recipients are always validated
against the company roster so typo inboxes do not silently absorb work.

Agent registration must match the lead-created plan for role, branch, and
worktree. A spawned Pi session can mark itself online, but it cannot silently
turn into another role or claim another worker's branch.

## Local PR Gates

CLI `pr ready` and `pr auto-test` default to the PR author when `--actor` is
omitted. Pass `--actor tester` or `--actor system` explicitly when those actors
actually produced the automated test evidence.

A PR is mergeable only when:

- the PR author is an existing coder agent
- issue-bound PRs are created by the assigned owner of that issue
- the PR branch and worktree match the author's registered branch/worktree when they are known
- coder self-test evidence exists
- test brief exists
- automated tests are recorded as passed
- required independent reviewer approvals exist
- independent tester validation is pass
- PM or lead product acceptance is accept
- PR ready, review, test, product acceptance, automated test, and merge-request events come from known agents with the right role or ownership
- self-test, review, tester validation, product acceptance, and automated test evidence all match the current PR branch HEAD
- the PR branch resolves to a git commit and is not the base branch
- the PR branch still merges cleanly against the current base branch
- pass/approve summaries do not contain caveats, known issues, or unresolved risks

Product acceptance is a product-level gate, separate from tester validation and
code review. PM or lead must verify that the user-facing behavior matches the
human request and acceptance criteria. If a required flow was not observed, an
API request/result was not visible, a named skill/tool/method was skipped, or
evidence is missing, product acceptance must request changes or record a caveat;
it cannot green-light the merge.

`company_merge_pr` executes the local git merge by default when lead calls it and
the gates are green. Non-lead agents can only request a merge, and lead can pass
`execute_git: false` to record a dry merge request. Tracked or staged root
changes block merge. Unrelated untracked files do not. Lead must not run raw
`git stash`, `git reset`, `git clean`, revert, or checkout-away commands in the
project root just to make a merge pass. Dirty tracked/staged root changes are a
merge blocker that must be resolved deliberately or escalated to the human. If
another PR lands first and creates a conflict, the remaining PR becomes blocked
before the project root is checked out or merged.

For UI work, tester should prefer deterministic local checks first: static file
serving, DOM/content assertions, console/error checks, and targeted browser
verification. Avoid repeated cmux browser viewport or screenshot loops in the
user's main workspace; use them sparingly because they exercise cmux's WebView
surface management, not just the website under test.

## License

Apache-2.0. Contributions are accepted under the same Apache-2.0 license unless
explicitly stated otherwise.
