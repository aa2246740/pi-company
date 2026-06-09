# PRD: pi-company

Status: Draft ready for agent implementation
Working title: pi-company
Issue tracker status: Not published yet. No project issue tracker is configured in the current workspace.

## Problem Statement

The user wants to run multiple Pi agents as a coherent project team without losing the ability to see, steer, and understand each agent. Existing multi-agent approaches tend to be either too headless, too orchestrator-heavy, too chat-only, or too loosely coordinated for serious project work.

The target workflow is not a fake human company hierarchy. It is a Pi-native collaboration runtime based on first principles:

- roles exist to isolate context, preserve attention, reduce self-confirmation, and enable parallel work
- each project should have its own agent company boundary
- human steering should be possible from any Pi agent surface
- the project lead must stay aware of all human steering and project-level state
- multiple coding agents should be able to work in parallel without corrupting the main project
- code should only reach the main line through review and test gates

The user currently uses cmux and likes visible, interactive panes where agents can be steered directly. However, cmux should be optional. The product should be Pi-first and work with manually opened terminals when cmux is unavailable.

## Solution

Build `pi-company`, a Pi-specific agent company runtime for local, single-machine project collaboration.

In `pi-company`, one project maps to one agent company. The user primarily speaks to the `lead` agent, but can send steering to any agent. All human steering to non-lead agents is automatically mirrored to `lead`, so the project state does not drift when the user guides an individual worker.

Each Pi agent runs as a normal interactive Pi session. Each agent receives a role-specific desk panel inside Pi that shows its current responsibilities, inbox, task, PR status, blockers, and next relevant action. The desk panel is local to the agent's role and context, not a global dashboard that overwhelms every pane.

The runtime provides:

- a global `pi-company` CLI
- a Pi extension package that renders desk panels and registers company tools
- project-local company state
- event-sourced logs
- mailbox-based Pi-to-Pi messaging
- automatic git worktree and branch creation for parallel coder agents
- local issue and PR workflow
- gated merge flow owned by `lead`
- optional cmux launcher adapter
- manual terminal fallback when cmux is absent

The MVP is local-only. It does not require GitHub, Linear, remote servers, A2A, or cross-machine networking.

## User Stories

1. As a project owner, I want to initialize a Pi company inside a project, so that a single project has a clear agent collaboration boundary.
2. As a project owner, I want `pi-company` to be globally installed, so that I can use it across many projects.
3. As a project owner, I want each project to keep its own company state locally, so that agents do not cross-contaminate projects.
4. As a project owner, I want Pi to be the required agent runtime, so that the product is deeply integrated with Pi rather than a generic harness.
5. As a project owner, I want cmux support to be optional, so that I can use automatic panes when available and manual terminals when not.
6. As a project owner, I want to create a lead Pi agent, so that there is a single project-level coordination and merge owner.
7. As a project owner, I want to create a PM Pi agent, so that product intent and acceptance criteria have a dedicated context.
8. As a project owner, I want to create reviewer and tester Pi agents, so that code quality and behavior validation are separated from implementation context.
9. As a project owner, I want to create multiple coder agents, so that independent slices of work can proceed in parallel.
10. As a project owner, I want each coder to use an isolated worktree and branch, so that parallel development does not corrupt or overwrite another agent's work.
11. As a project owner, I want agents to have role cards based on responsibilities, so that roles remain lightweight and do not become fake corporate titles.
12. As a project owner, I want default roles to exist out of the box, so that the first project can start without designing a team from scratch.
13. As a project owner, I want the lead to propose new roles when the company needs them, so that the team can evolve from real project friction.
14. As a project owner, I want new role packs to require human approval before activation, so that agents cannot silently expand their authority.
15. As a project owner, I want each Pi agent to display its own desk panel, so that each agent sees only the information relevant to its responsibility.
16. As a lead agent, I want to see team health, active issues, PRs, blockers, and human steering, so that I can keep the project moving.
17. As a coder agent, I want to see my branch, worktree, task, PR state, owned paths, blockers, and inbox, so that I can stay focused on implementation.
18. As a reviewer agent, I want to see PRs waiting for review and their review brief, so that I can protect code and test quality.
19. As a tester agent, I want to see test briefs and acceptance criteria, so that I can validate behavior without inheriting the coder's implementation context.
20. As a PM agent, I want to see user intent, scope, acceptance criteria, and human steering, so that I can protect product value.
21. As a researcher agent, I want to receive cross-functional research questions, so that unknowns can be explored without polluting implementation context.
22. As a project owner, I want to speak primarily to lead, so that I do not have to maintain issues, PRs, and assignments manually.
23. As a project owner, I want lead to turn my requests into local issues and assignments, so that project management happens inside the agent company.
24. As a project owner, I want to send steering to any agent, so that I can correct drift at the point where I notice it.
25. As a project owner, I want every human steering message to be mirrored to lead, so that lead never loses project context.
26. As a project owner, I want human steering to wake lead, so that project-level implications can be handled promptly.
27. As a worker agent, I want to directly consult peer agents when useful, so that the company remains flat and fast.
28. As a worker agent, I want formal assignments and project direction to remain owned by lead, so that peer consultation does not become uncontrolled task creation.
29. As a lead agent, I want to coordinate only when needed, so that workers can stay autonomous without unnecessary ceremony.
30. As a coder agent, I want to prefer test-first development for behavior changes, so that implementation quality improves.
31. As a coder agent, I want to explain when test-first is not practical, so that reviewers can understand the tradeoff.
32. As a coder agent, I want to provide self-test evidence before marking a PR ready, so that tester does not become responsible for basic correctness.
33. As a reviewer agent, I want to review both code and test quality, so that shallow or fake tests are blocked.
34. As a tester agent, I want to validate acceptance behavior independently, so that PR approval is not based only on implementation reasoning.
35. As a PM or lead agent, I want to submit product acceptance only after checking the implemented user-facing behavior, so that the company does not finish work that only looks complete from worker reports.
36. As a lead agent, I want to preserve human-specified skill/tool/method requirements in assignments to the responsible role, so that lead does not accidentally absorb specialist execution work into its own context.
37. As a lead agent, I want to merge only after gates pass, so that main stays healthy.
38. As a lead agent, I want local PRs to represent work before GitHub is involved, so that the workflow works in any local project.
39. As a project owner, I want optional future GitHub publishing, so that local PRs can become real GitHub PRs when needed.
40. As a project owner, I want issues to be local by default, so that I do not need an external tracker to use the product.
41. As a lead agent, I want to create and assign local issues, so that user requests become tracked work.
42. As a coder agent, I want to create a draft local PR when my implementation begins to take shape, so that work can be reviewed before merge.
43. As a coder agent, I want to mark a PR ready only after self-tests and a test brief exist, so that reviewer and tester have enough context.
44. As a tester agent, I want a test brief for each PR, so that I know what behavior, scope, edges, and evidence matter.
45. As a PM agent, I want to shape acceptance criteria and test brief scope, so that testing reflects product intent.
46. As a reviewer agent, I want unresolved blockers to prevent merge, so that lead cannot accidentally merge known risks.
47. As a lead agent, I want to see merge readiness derived from facts, so that I do not manually inspect every event.
48. As a project owner, I want event logs to be append-only, so that project decisions and agent actions can be audited.
49. As a tool builder, I want derived state separate from raw events, so that dashboards can be rebuilt if reducer logic changes.
50. As a tool builder, I want mailbox messages to be explicit records, so that Pi-to-Pi communication can evolve beyond prompt text.
51. As a Pi user, I want the product to use Pi extensions, tools, commands, and widgets, so that it feels native inside Pi.
52. As a cmux user, I want `pi-company` to spawn panes and send launch commands automatically, so that creating a company is fast.
53. As a non-cmux user, I want `pi-company` to print launch commands, so that I can start agents manually in any terminal.
54. As a project owner, I want cmux not to be required, so that the product can be useful to the wider Pi community.
55. As an open source contributor, I want the project to have clear extension points, so that I can contribute roles, launchers, dashboards, or workflow improvements.
56. As an open source contributor, I want role packs to be reusable, so that teams can share effective agent responsibilities.
57. As an open source contributor, I want the first version to be small and local, so that the product can be tested without infrastructure.
58. As a project owner, I want the runtime to avoid over-specified process rules, so that agents can use judgment like a high-performing flat team.
59. As a project owner, I want only a few hard constraints, so that safety-critical boundaries are enforced without making the team rigid.
60. As a lead agent, I want to classify and act on human steering with judgment, so that the company does not broadcast every small correction unnecessarily.
61. As a worker agent, I want to receive human steering directly, so that the user can correct my current path without routing everything through lead first.
62. As a project owner, I want every company session to reject private worker conversations, so that project facts remain visible to lead.
63. As a tester agent, I want to block PRs with missing or ambiguous test briefs, so that testing does not proceed with unclear success criteria.
64. As a reviewer agent, I want to block PRs with missing self-test evidence, so that coder remains accountable for engineering tests.
65. As a coder agent, I want path ownership guidance for a task, so that parallel coders avoid unnecessary conflicts.
66. As a lead agent, I want to control merge order, so that parallel branches integrate safely.
67. As a project owner, I want the tool to be named `pi-company`, so that its purpose is obvious to Pi users.
68. As a project owner, I want organization-level message backpressure, so that many agents do not trigger provider `429` errors by waking each other too aggressively.
69. As an agent, I want normal chatter to be digestible while urgent steering still wakes the right owner, so that collaboration stays fast without becoming a wake storm.
70. As a lead agent, I want caveated pass/approve reports to block merge, so that known risks cannot slip through as green gates.
71. As a lead agent, I want PR gate evidence bound to the exact branch HEAD it validated, so that a branch cannot change after approval and still merge on stale evidence.

## Implementation Decisions

- Build `pi-company` as a Pi-first product. Pi is required for the MVP. Other agent runtimes are out of scope.
- Package the Pi integration as a Pi extension/package so it can register tools, commands, event handlers, status UI, and desk panel widgets inside Pi.
- Provide a global CLI named `pi-company`.
- Store company state in a project-local company directory. The exact structure is a product contract for the MVP because local state is the persistence layer.
- Use an append-only event log as the source of truth.
- Use a derived state snapshot for desk panels, status views, and merge gate calculation.
- Use per-agent mailbox logs for Pi-to-Pi messaging in the MVP.
- Do not build on top of the `coms` protocol as the main product foundation. The product needs task, PR, gate, role, and dashboard semantics, not only prompt-response messaging.
- Reuse the `coms` insight that Pi can inject follow-up messages into running interactive sessions, but define a company-specific message/event model.
- Keep communication local and single-machine in the MVP.
- Treat cmux as an optional launcher adapter, not as the core runtime.
- When cmux is available, support spawning visible Pi panes or surfaces through the cmux CLI.
- When cmux is unavailable, support manual terminal launch by printing the exact Pi command for each agent.
- Do not require a right-side cmux dashboard for the MVP. Each Pi displays its own role-specific desk panel.
- Keep cmux workspace status updates optional and additive.
- Re-running initialization in an existing company must be idempotent and must not reset roster, issues, PRs, or agent status.
- Initialization must ensure `.pi-company/` is ignored by git so local company state and managed worktrees are not committed by normal project work.
- Default company roles are `lead`, `pm`, `designer`, `researcher`, `coder-*`, `reviewer`, and `tester`.
- Role separation is justified by context isolation and responsibility boundaries, not human company hierarchy.
- Do not include senior/junior coder hierarchy.
- Do not include a permanent architect role in the default roster. Architecture concerns are handled by lead, coder, reviewer, and optional future role packs.
- Keep `researcher` as a cross-functional scout role. Every agent may research within its own responsibility; the dedicated researcher handles cross-role or high-uncertainty exploration.
- Allow lead to draft project-local role packs, but require human approval before activation.
- Human steering is a first-class event. Any interactive human input to a non-lead Pi agent is mirrored to lead and wakes lead.
- Do not support private human-worker messages inside a company session.
- The receiving agent should act on human steering within its responsibility. Lead should coordinate only when the steering affects broader project state.
- Worker agents may directly ask peers questions or request consultation.
- Mailbox delivery is reliable but wake-up is rate-limited. Messages always land in inbox, while wake metadata decides immediate wake versus digest.
- Mailbox recipients and non-system senders must be known agents, so typos cannot create ghost inboxes or impersonate missing workers.
- Human steering remains a control-plane event and wakes lead by default.
- Non-urgent reports, replies, and peer chatter should be digestible when agent or organization wake limits are active.
- Formal project direction, merge decisions, and project-level scope changes belong to lead.
- Non-lead agents may ask lead for more role context, but only lead can activate or spawn persistent agents.
- Spawning creates new agents only. Existing agent identities must be launched or resumed without rewriting their planned role, branch, worktree, or status.
- Agent sessions may register or heartbeat only after the agent exists in the roster or lead-created spawn plan, and registration must match the planned role, branch, and worktree.
- Agent permissions are role-based, not name-based. A non-coder role with a coder-like name must not receive coder branch/worktree privileges or create PRs.
- Non-lead agents may report follow-up work or blockers, but only lead can create or assign formal local issues.
- Issue assignees must already exist in the company roster, so typos or unspawned roles cannot silently own work.
- Assigned issue owners are the only agents that can start, block, report on, or complete their issue.
- Coder agents may work in parallel.
- Every writer must use a dedicated git worktree and branch.
- The CLI automatically creates worktrees and branches for coder agents.
- New coder branches should start from the configured integration branch, defaulting to `main` when it exists, not from whatever branch the project root currently has checked out.
- The default branch naming and worktree naming scheme should be deterministic and derived from company id, agent name, and task identity.
- Existing worktrees may be reused only if they match the expected branch and ownership metadata.
- Writers must not write in the project root during normal company operation.
- Support local issues managed by lead. The user does not manually create issues in the normal workflow.
- Support local PRs as first-class review units before any external GitHub integration.
- Local PR authors must be existing coder agents, so ghost authors and non-writer roles cannot create mergeable PRs.
- Local PRs linked to an issue must be created by that issue's assigned owner, and cannot target unknown, unassigned, or completed issues.
- Local PR branch and worktree metadata must match the author's registered branch and worktree when those are known.
- GitHub PR publishing is a future adapter, not an MVP requirement.
- The default workflow is: user request, lead planning, local issues, development, draft PR, ready PR, review and test in parallel, PM/lead product acceptance, fix loop, gated lead merge.
- A reviewer approval, tester pass, automated-test pass, or product acceptance with structured caveats, known issues, or unresolved risks is not a green gate. New evidence should use explicit `clean` and `caveats` fields; legacy summary text is still scanned as a compatibility fallback. The gate blocks until the caveat is resolved or explicitly converted to an accepted human override.
- Product acceptance is separate from tester validation and code review. PM or lead must verify the implemented user-facing behavior against the human request and acceptance criteria before merge.
- Product acceptance must not accept if a key flow is unobserved, an API request/result is not visible when relevant, a required skill/tool/method was skipped, or important evidence is missing.
- Coder self-test, reviewer approval, tester validation, product acceptance, and automated test evidence are valid only for the PR branch HEAD they recorded. If the branch advances, gates reset until fresh evidence is submitted.
- PR ready, review, test, product acceptance, automated test, and merge-request events must come from known agents with the appropriate role or PR ownership.
- Merged PRs are terminal. Late ready, review, test, automated-test, or merge-request events must not reopen or mutate merged PR state.
- Coder owns engineering tests and self-test evidence.
- The company culture should prefer test-first work for behavior changes, bug fixes, and business logic.
- Tester owns independent acceptance validation and realistic behavior verification.
- Reviewer owns code quality, architecture fit, safety, maintainability, and test quality.
- PM owns user value, scope, acceptance criteria, and product acceptance when delegated by lead.
- Each PR requires a test brief before it can be marked ready.
- A test brief includes behavior under test, acceptance criteria, scope, key flows, edge cases, environment, and expected evidence.
- Merge is lead-owned and gate-controlled.
- Non-lead agents may request a merge, but only the configured lead agent may execute a local git merge.
- Merge gates include PR readiness, coder self-test evidence, automated test results, independent reviewer approval, independent tester pass, PM/lead product acceptance, no unresolved blockers, a resolvable non-base PR branch, mergeability against the current base branch, and lead merge action.
- Merge execution must not bypass dirty-root protection by stashing, resetting, cleaning, reverting, or checking away project-root changes. Dirty tracked/staged root changes are a blocker that lead must resolve deliberately or escalate.
- If no test command is configured, the system should mark automated test status as blocked rather than pretend tests passed.
- Test commands should be detected during initialization when possible and confirmed into company configuration.
- The system should avoid excessive hard-coded process branching. Company rules should be a small set of non-negotiable safety boundaries; role prompts should carry the flexible judgment layer.

Key MVP event types should include:

- company.initialized
- agent.spawn_requested
- agent.spawned
- agent.heartbeat
- role.proposed
- role.approved
- human_steering.received
- message.sent
- message.delivered
- issue.created
- issue.assigned
- task.started
- task.blocked
- task.reported
- pr.created
- pr.ready
- review.submitted
- test.submitted
- acceptance.submitted
- gate.updated
- merge.requested
- merge.completed
- merge.blocked

Key MVP tools exposed inside Pi should include:

- report progress or blockers
- ask a peer agent
- reply to a peer
- mark task done
- create or update local PR metadata
- submit review
- submit test result
- submit product acceptance
- request a new role
- request or perform lead-owned merge depending on role

Key MVP CLI capabilities should include:

- initialize a company in the current project
- spawn agents by role and name
- create or reuse coder worktrees
- print manual launch commands
- show company status
- rebuild derived state from events
- inspect local issues and PRs
- run gate checks
- perform lead-owned merge

## Testing Decisions

- Test external behavior at the CLI, Pi extension, and local project-state boundaries. Avoid tests that assert private reducer internals unless the reducer has a public event-to-state contract.
- Use event-log replay tests to verify that derived state can be rebuilt deterministically.
- Use mailbox delivery tests to verify that messages sent to an agent become visible in that agent's inbox and are not delivered to the wrong company or role.
- Use human steering tests to verify that interactive input to a non-lead agent writes a global steering event and queues a lead notification.
- Use role authorization tests to verify that non-lead agents cannot perform lead-only actions such as merge or role activation.
- Use worktree tests to verify that coder spawn creates or validates isolated worktrees and branches.
- Use local PR lifecycle tests to verify transitions from draft to ready, review, test, ready-to-merge, and merged.
- Use gate tests to verify that merge is blocked when tests, review, tester validation, or current-base mergeability are missing.
- Use merge dry-run and conflict tests where practical to verify that failed integration does not corrupt the project root.
- Use desk panel rendering tests at the highest available seam: given derived company state and agent identity, the panel should show the correct role-specific projection.
- Use cmux adapter tests behind an interface so the core can be tested without launching cmux.
- Use manual launcher tests to verify the generated Pi command includes the correct role, company id, project root, and extension flags.
- Use fixture projects to test package-manager detection for common ecosystems.
- Use golden or snapshot-style tests carefully for desk panel output, focusing on stable content rather than terminal styling details.
- Use integration smoke tests that initialize a company, spawn a lead and coder in non-interactive/manual mode, create a local issue, create a PR, run gates, and block merge until required evidence exists.
- A good test proves user-visible collaboration behavior, not implementation details like exact JSON formatting unless the JSONL event schema is the public contract.

## Out of Scope

- Cross-machine agent communication.
- Remote hub or hosted coordination service.
- A2A, MCP, AG-UI, or other external protocol bridges.
- Non-Pi agent runtimes.
- Automatic GitHub PR creation in the MVP.
- Linear, Jira, or GitHub issue sync in the MVP.
- Cloud execution.
- Full sandbox or permission isolation beyond local worktree and role gates.
- Automatic production deployment.
- Automatic merge without lead action.
- A full web dashboard.
- A required cmux sidebar or dock UI.
- Heavy task-management UI beyond local issue, PR, event, and desk panel views.
- Simulating human company titles, manager ladders, seniority, or department hierarchy.
- Making `researcher` the only role allowed to research.
- Default permanent architect role.
- Complex role-pack marketplace.
- Multi-project company sessions.

## Further Notes

The most important product principle is that roles are context boundaries, not human organization theater. The system should not imitate a traditional company for its own sake. It should use role separation only when it improves focus, accountability, validation quality, or parallel throughput.

The initial product should feel like a Pi-native runtime, not a generic multi-agent framework with a Pi adapter bolted on. Pi extension capabilities should be used directly for desk panels, tools, commands, input handling, and agent-local status.

The user should not need to maintain issues or PRs manually. The normal interaction is to tell lead the project goal or steering feedback; lead converts that into local project work.

The product should remain flexible enough for lead and workers to use judgment. Avoid turning the company into a rigid workflow engine. Enforce only the hard safety boundaries that prevent context drift, main-branch damage, and hidden human steering.

The MVP should be strong enough to run real local projects, but small enough to open source early and invite community role packs, launcher adapters, and workflow improvements.
