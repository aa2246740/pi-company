import path from "node:path";
import type {
  AgentRecord,
  AcceptanceRecord,
  AutomatedTestRecord,
  CompanyConfig,
  CompanyEvent,
  CompanyState,
  GateEvidenceRecord,
  IssueRecord,
  IssueWorkType,
  PullRequestRecord,
  ReviewRecord,
  TestRecord,
} from "./types.js";

export function emptyState(): CompanyState {
  return {
    config: null,
    agents: {},
    issues: {},
    prs: {},
    inbox_counts: {},
    rate_limit: null,
    human_steering: [],
    updated_at: null,
  };
}

function hasOwn(data: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function nullableEventString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function normalizedEventCaveats(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);
}

function gateEvidenceFromEvent(data: Record<string, unknown>): GateEvidenceRecord {
  const evidence: GateEvidenceRecord = {};
  if (typeof data.clean === "boolean") evidence.clean = data.clean;
  if (Array.isArray(data.caveats)) evidence.caveats = normalizedEventCaveats(data.caveats) ?? [];
  return evidence;
}

function sameNullablePath(left: string | null, right: string | null): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return path.resolve(left) === path.resolve(right);
}

const AGENT_STATUSES: ReadonlySet<AgentRecord["status"]> = new Set([
  "planned", "online", "idle", "running", "blocked", "offline",
]);

function normalizeAgentStatus(value: unknown, fallback: AgentRecord["status"]): AgentRecord["status"] {
  return typeof value === "string" && AGENT_STATUSES.has(value as AgentRecord["status"])
    ? (value as AgentRecord["status"])
    : (value === undefined || value === null ? "online" : fallback);
}

function agentIdentityEventMatches(existing: AgentRecord, event: CompanyEvent): boolean {
  if (hasOwn(event.data, "role") && nullableEventString(event.data.role) !== existing.role) return false;
  if (hasOwn(event.data, "branch") && nullableEventString(event.data.branch) !== (existing.branch ?? null)) return false;
  if (
    hasOwn(event.data, "worktree") &&
    !sameNullablePath(nullableEventString(event.data.worktree), existing.worktree ?? null)
  ) return false;
  return true;
}

function agentCurrentTaskEventMatches(state: CompanyState, name: string, event: CompanyEvent): boolean {
  if (!hasOwn(event.data, "current_task")) return true;
  if (event.data.current_task === null || event.data.current_task === undefined) return true;
  if (typeof event.data.current_task !== "string") return false;
  const issue = state.issues[event.data.current_task];
  return Boolean(issue && issue.owner === name && issue.status !== "done");
}

function issueOwnerCanOwnWorkType(role: string, owner: string, workType: IssueWorkType | null): boolean {
  if (!workType) return true;
  if (workType === "implementation") return role === "coder" || owner.startsWith("coder");
  if (workType === "design") return role === "designer" || owner.startsWith("designer");
  if (workType === "product") return role === "pm" || owner.startsWith("pm");
  if (workType === "test") return role === "tester" || owner.startsWith("tester");
  if (workType === "review") return role === "reviewer" || owner.startsWith("reviewer");
  if (workType === "research") return role === "researcher" || owner.startsWith("researcher");
  return false;
}

export function reduceEvents(events: CompanyEvent[]): CompanyState {
  const state = emptyState();
  const messageRecipients = new Map<string, string>();
  const deliveredMessages = new Set<string>();
  for (const event of events) {
    state.updated_at = event.ts;
    switch (event.type) {
      case "company.initialized": {
        state.config = event.data.config as CompanyConfig;
        Object.assign(state.agents, event.data.roster as Record<string, AgentRecord>);
        break;
      }
      case "agent.spawn_requested": {
        if (event.actor !== (state.config?.lead ?? "lead")) break;
        const name = String(event.data.name);
        if (state.agents[name]) break;
        state.agents[name] = {
          name,
          role: String(event.data.role),
          cwd: String(event.data.cwd ?? state.config?.root ?? "."),
          worktree: (event.data.worktree as string | undefined) ?? null,
          branch: (event.data.branch as string | undefined) ?? null,
          mission: (event.data.mission as string | undefined) ?? null,
          status: "planned",
        };
        break;
      }
      case "agent.spawned":
      case "agent.heartbeat": {
        const name = String(event.data.name ?? event.actor);
        // An agent can only update its own record. Without this an actor could
        // forge a heartbeat/spawn for another agent (e.g. mark a peer offline or
        // rewrite its mission) on replay.
        if (event.actor !== name) break;
        const existing = state.agents[name];
        if (!existing) break;
        if (!agentIdentityEventMatches(existing, event)) break;
        if (!agentCurrentTaskEventMatches(state, name, event)) break;
        state.agents[name] = {
          ...existing,
          role: existing.role,
          cwd: existing.cwd,
          worktree: existing.worktree ?? null,
          branch: existing.branch ?? null,
          mission: (event.data.mission as string | undefined) ?? existing.mission ?? null,
          cmux_surface: existing.cmux_surface ?? null,
          last_launch_at: existing.last_launch_at ?? null,
          status: normalizeAgentStatus(event.data.status, existing.status),
          current_task: (event.data.current_task as string | undefined) ?? existing.current_task ?? null,
          last_seen_at: event.ts,
        };
        break;
      }
      case "agent.launch_recorded": {
        const name = String(event.data.name ?? event.actor);
        if (event.actor !== name) break;
        const existing = state.agents[name];
        const surface = typeof event.data.cmux_surface === "string" ? event.data.cmux_surface.trim() : "";
        if (!existing || surface.length === 0) break;
        state.agents[name] = {
          ...existing,
          cmux_surface: surface,
          last_launch_at: event.ts,
        };
        break;
      }
      case "human_steering.received": {
        if (!state.agents[String(event.data.target_agent)]) break;
        state.human_steering.push({
          id: event.id,
          ts: event.ts,
          target_agent: String(event.data.target_agent),
          text: String(event.data.text),
        });
        state.human_steering = state.human_steering.slice(-20);
        break;
      }
      case "message.sent": {
        if (!messageParticipantsAreValid(state, event)) break;
        const to = String(event.data.to);
        const id = typeof event.data.id === "string" ? event.data.id : null;
        if (!id || messageRecipients.has(id)) break;
        messageRecipients.set(id, to);
        state.inbox_counts[to] = (state.inbox_counts[to] ?? 0) + 1;
        break;
      }
      case "message.delivered": {
        if (!state.agents[String(event.data.to)]) break;
        const to = String(event.data.to);
        if (event.actor !== to) break;
        const messageId = typeof event.data.message_id === "string" ? event.data.message_id : null;
        if (!messageId) break;
        if (messageRecipients.get(messageId) !== to) break;
        const deliveryKey = `${to}\0${messageId}`;
        if (deliveredMessages.has(deliveryKey)) break;
        deliveredMessages.add(deliveryKey);
        state.inbox_counts[to] = Math.max(0, (state.inbox_counts[to] ?? 0) - 1);
        break;
      }
      case "issue.created": {
        const issue = event.data.issue as IssueRecord;
        if (
          event.actor === (state.config?.lead ?? "lead") &&
          issue &&
          typeof issue.id === "string" &&
          !state.issues[issue.id] &&
          issue.created_by === event.actor &&
          issue.status === "open" &&
          !issue.owner
        ) {
          state.issues[issue.id] = issue;
        }
        break;
      }
      case "issue.assigned": {
        const id = String(event.data.issue_id);
        const issue = state.issues[id];
        const owner = String(event.data.owner);
        if (
          event.actor === (state.config?.lead ?? "lead") &&
          issue &&
          issue.status !== "done" &&
          state.agents[owner] &&
          issueOwnerCanOwnWorkType(state.agents[owner].role, owner, issue.work_type ?? null)
        ) {
          const previousOwner = issue.owner;
          // Release the previous owner from this issue. Otherwise they keep a
          // stale current_task they can no longer act on (the reducer rejects
          // their task events for an issue they no longer own) and stay pinned
          // as "running", which corrupts liveness and hibernation decisions.
          if (previousOwner && previousOwner !== owner) {
            const prev = state.agents[previousOwner];
            if (prev && prev.current_task === id) {
              prev.current_task = null;
              if (prev.status === "running") prev.status = "idle";
            }
          }
          issue.owner = owner;
          issue.status = "assigned";
          issue.updated_at = event.ts;
        }
        break;
      }
      case "task.started":
      case "task.blocked":
      case "task.reported":
      case "task.completed": {
        const issueId = event.data.issue_id ? String(event.data.issue_id) : null;
        const agent = event.actor;
        const issue = issueId ? state.issues[issueId] : null;
        if (!issue || !state.agents[agent]) break;
        if (issue.status === "done") break;
        if (issue.owner && issue.owner !== agent) break;
        if (!issue.owner) issue.owner = agent;
        const completedWithOpenPr = event.type === "task.completed" && issueId ? issueHasUnmergedPr(state, issueId) : false;
        if (state.agents[agent]) {
          state.agents[agent].current_task = issueId;
          state.agents[agent].status =
            event.type === "task.blocked" ? "blocked" :
            event.type === "task.completed" ? "idle" :
            "running";
          if (completedWithOpenPr) state.agents[agent].current_task = null;
        }
        if (issueId && state.issues[issueId]) {
          state.issues[issueId].status =
            event.type === "task.blocked" ? "blocked" :
            event.type === "task.completed" && !completedWithOpenPr ? "done" :
            "in_progress";
          state.issues[issueId].updated_at = event.ts;
        }
        break;
      }
      case "pr.created": {
        const pr = event.data.pr as PullRequestRecord;
        const normalized = event.actor === pr?.author && pr.status === "draft" && !state.prs[pr.id]
          ? normalizePrForReplay(state, pr)
          : null;
        if (normalized) state.prs[normalized.id] = normalized;
        break;
      }
      case "pr.ready": {
        const id = String(event.data.pr_id);
        const pr = state.prs[id];
        const selfTest = typeof event.data.self_test === "string" ? event.data.self_test : "";
        const testBrief = typeof event.data.test_brief === "string" ? event.data.test_brief : "";
        if (pr && pr.status !== "merged" && pr.status !== "abandoned" && event.actor === pr.author && selfTest.trim().length > 0 && testBrief.trim().length > 0) {
          const readyHead = (event.data.head as string | undefined) ?? null;
          pr.status = "ready";
          pr.self_test = selfTest;
          pr.test_brief = testBrief;
          pr.ready_head = readyHead ?? pr.ready_head ?? null;
          if (readyHead) pr.head = readyHead;
          pr.updated_at = event.ts;
        }
        break;
      }
      case "pr.abandoned": {
        const id = String(event.data.pr_id);
        const pr = state.prs[id];
        if (
          pr &&
          pr.status !== "merged" &&
          pr.status !== "abandoned" &&
          (event.actor === (state.config?.lead ?? "lead") || event.actor === pr.author)
        ) {
          pr.status = "abandoned";
          pr.merge_blockers = null;
          pr.merge_blocked_at = null;
          pr.abandoned_at = event.ts;
          pr.abandoned_reason = typeof event.data.reason === "string" ? event.data.reason : null;
          pr.superseded_by = typeof event.data.superseded_by === "string" ? event.data.superseded_by : null;
          pr.updated_at = event.ts;
        }
        break;
      }
      case "pr.automated_tests": {
        const id = String(event.data.pr_id);
        const pr = state.prs[id];
        const status = event.data.status;
        if (pr && pr.status !== "merged" && pr.status !== "abandoned" && automatedTestActorIsValid(state, event.actor, pr) && isAutomatedTestStatus(status)) {
          pr.automated_tests = {
            status,
            command: (event.data.command as string | undefined) ?? null,
            summary: String(event.data.summary ?? ""),
            head: (event.data.head as string | undefined) ?? null,
            ...gateEvidenceFromEvent(event.data),
            ts: event.ts,
          };
          pr.automated_test_history = [...(pr.automated_test_history ?? []), pr.automated_tests];
          pr.updated_at = event.ts;
        }
        break;
      }
      case "review.submitted": {
        const id = String(event.data.pr_id);
        const pr = state.prs[id];
        const decision = event.data.decision;
        if (pr && pr.status !== "merged" && pr.status !== "abandoned" && event.actor !== pr.author && agentHasRole(state.agents, event.actor, "reviewer") && isReviewDecision(decision)) {
          pr.reviews.push({
            reviewer: event.actor,
            decision,
            summary: String(event.data.summary ?? ""),
            head: (event.data.head as string | undefined) ?? null,
            ...gateEvidenceFromEvent(event.data),
            ts: event.ts,
          });
          pr.status = decision === "request_changes" ? "changes_requested" : pr.status;
          pr.updated_at = event.ts;
        }
        break;
      }
      case "test.submitted": {
        const id = String(event.data.pr_id);
        const pr = state.prs[id];
        const status = event.data.status;
        if (pr && pr.status !== "merged" && pr.status !== "abandoned" && event.actor !== pr.author && agentHasRole(state.agents, event.actor, "tester") && isTestStatus(status)) {
          pr.tests.push({
            tester: event.actor,
            status,
            summary: String(event.data.summary ?? ""),
            head: (event.data.head as string | undefined) ?? null,
            ...gateEvidenceFromEvent(event.data),
            ts: event.ts,
          });
          pr.updated_at = event.ts;
        }
        break;
      }
      case "acceptance.submitted": {
        const id = String(event.data.pr_id);
        const pr = state.prs[id];
        const decision = event.data.decision;
        if (pr && pr.status !== "merged" && pr.status !== "abandoned" && event.actor !== pr.author && productAcceptanceActorIsValid(state, event.actor) && isAcceptanceDecision(decision)) {
          pr.acceptances = [...(pr.acceptances ?? []), {
            accepter: event.actor,
            decision,
            summary: String(event.data.summary ?? ""),
            head: (event.data.head as string | undefined) ?? null,
            ...gateEvidenceFromEvent(event.data),
            ts: event.ts,
          }];
          pr.status = decision === "request_changes" ? "changes_requested" : pr.status;
          pr.updated_at = event.ts;
        }
        break;
      }
      case "merge.completed": {
        const id = String(event.data.pr_id);
        const pr = state.prs[id];
        if (pr && pr.status !== "abandoned" && event.actor === (state.config?.lead ?? "lead") && mergeCompletionIsValid(state.config, pr, state.agents, event)) {
          pr.status = "merged";
          pr.merge_blockers = null;
          pr.merge_blocked_at = null;
          pr.merged_at = event.ts;
          pr.updated_at = event.ts;
          if (pr.issue_id && state.issues[pr.issue_id]) {
            state.issues[pr.issue_id].status = "done";
            state.issues[pr.issue_id].updated_at = event.ts;
            const owner = state.issues[pr.issue_id].owner;
            if (owner && state.agents[owner]?.current_task === pr.issue_id) {
              state.agents[owner].current_task = null;
              if (state.agents[owner].status === "running") state.agents[owner].status = "idle";
            }
          }
        }
        break;
      }
      case "merge.requested": {
        const id = String(event.data.pr_id);
        const pr = state.prs[id];
        const gates = pr && pr.status !== "merged" && pr.status !== "abandoned" && state.agents[event.actor]
          ? evaluatePrGates(state.config, pr, state.agents)
          : null;
        if (pr && pr.status !== "merged" && pr.status !== "abandoned" && state.agents[event.actor] && gates?.ready) {
          pr.merge_requested_at = event.ts;
          pr.merge_blockers = null;
          pr.merge_blocked_at = null;
          pr.status = "ready_to_merge";
          pr.updated_at = event.ts;
        }
        break;
      }
      case "merge.blocked": {
        const id = String(event.data.pr_id);
        const pr = state.prs[id];
        if (pr && pr.status !== "merged" && pr.status !== "abandoned" && state.agents[event.actor]) {
          if (event.data.source === "execution") {
            pr.merge_blockers = Array.isArray(event.data.blockers)
              ? event.data.blockers.map(String)
              : ["Merge blocked"];
            pr.merge_blocked_at = event.ts;
          }
          pr.status = "blocked";
          pr.updated_at = event.ts;
        }
        break;
      }
      case "rate_limit.reported": {
        if (event.actor !== "system" && !state.agents[event.actor]) break;
        const pausedUntil = typeof event.data.paused_until === "string" ? event.data.paused_until : null;
        const retryAfterMs = Number(event.data.retry_after_ms);
        if (!pausedUntil || !Number.isFinite(retryAfterMs) || retryAfterMs < 0) break;
        state.rate_limit = {
          kind: isRateLimitKind(event.data.kind) ? event.data.kind : "provider_429",
          reason: String(event.data.reason ?? "rate limit reported"),
          reported_by: event.actor,
          reported_at: event.ts,
          paused_until: pausedUntil,
          retry_after_ms: retryAfterMs,
          incidents: Number.isFinite(Number(event.data.incidents)) ? Number(event.data.incidents) : 1,
        };
        break;
      }
      case "rate_limit.cleared": {
        if (event.actor !== "system" && !state.agents[event.actor]) break;
        state.rate_limit = null;
        break;
      }
    }
  }

  for (const pr of Object.values(state.prs)) {
    if (pr.status !== "merged" && pr.status !== "abandoned" && !pr.merge_blockers?.length) {
      const gate = evaluatePrGates(state.config, pr, state.agents);
      if (gate.ready) pr.status = "ready_to_merge";
      else if (gate.blockers.length > 0 && pr.status !== "draft") {
        pr.status = statusForGateBlockers(gate.blockers);
      }
    }
  }

  for (const agent of Object.values(state.agents)) {
    const task = agent.current_task ? state.issues[agent.current_task] : null;
    if (task?.status === "done") {
      agent.current_task = null;
      if (agent.status === "running") agent.status = "idle";
    }
  }

  return state;
}

export function evaluatePrGates(config: CompanyConfig | null, pr: PullRequestRecord, agents: Record<string, AgentRecord> = {}): {
  ready: boolean;
  blockers: string[];
} {
  const blockers: string[] = [];
  if (pr.status === "abandoned") return { ready: false, blockers: ["PR abandoned"] };
  const requiredReviews = config?.quality_gates.required_reviews ?? 1;
  const blockCaveatedPasses = config?.quality_gates.block_caveated_passes !== false;
  const currentHead = pr.head ?? null;
  const currentReviews = currentHead ? pr.reviews.filter((r) => r.head === currentHead) : pr.reviews;
  const currentTests = currentHead ? pr.tests.filter((t) => t.head === currentHead) : pr.tests;
  const currentAcceptances = currentHead ? (pr.acceptances ?? []).filter((a) => a.head === currentHead) : pr.acceptances ?? [];
  const eligibleReviews = currentReviews.filter((r) => r.reviewer !== pr.author && agentHasRole(agents, r.reviewer, "reviewer"));
  const eligibleTests = currentTests.filter((t) => t.tester !== pr.author && agentHasRole(agents, t.tester, "tester"));
  const eligibleAcceptances = currentAcceptances.filter((a) => a.accepter !== pr.author && productAcceptanceActorIsValidForAgents(config, agents, a.accepter));
  const latestEligibleReviews = latestReviewPerReviewer(eligibleReviews);
  const latestEligibleAcceptances = latestAcceptancePerAccepter(eligibleAcceptances);
  const approvedReviews = latestEligibleReviews.filter((r) => r.decision === "approve");
  const approved = approvedReviews.length;
  const anyReviewerRequestsChanges = latestEligibleReviews.some((r) => r.decision === "request_changes");
  const lastTest = eligibleTests.at(-1);
  const lastAcceptance = latestEligibleAcceptances.at(-1);

  if (pr.status === "draft") blockers.push("PR is still draft");
  if (!pr.self_test || pr.self_test.trim().length === 0) blockers.push("Missing coder self-test evidence");
  if (!pr.test_brief || pr.test_brief.trim().length === 0) blockers.push("Missing test brief");
  if (currentHead && pr.ready_head !== currentHead) blockers.push("Coder self-test/test brief are stale for current head");
  if (approved < requiredReviews) blockers.push(`Needs ${requiredReviews} reviewer approval(s)`);
  // Any reviewer's standing request_changes blocks the merge. A later approval
  // from a *different* reviewer must not silently override an unresolved
  // objection, so this checks every reviewer's latest decision, not just the
  // chronologically last one.
  if (anyReviewerRequestsChanges) blockers.push("Latest review requests changes");
  // Evaluate caveat resolution per reviewer so one reviewer's clean approval
  // cannot clear another reviewer's caveated approval.
  if (blockCaveatedPasses && approvedReviews.some((review) => hasUnresolvedCaveatedEvidence([review]))) {
    blockers.push("Reviewer approval contains caveat");
  }

  if (config?.quality_gates.require_tester_pass !== false) {
    if (!lastTest) blockers.push("Missing tester validation");
    else if (lastTest.status !== "pass") blockers.push(`Tester status is ${lastTest.status}`);
    else if (blockCaveatedPasses && evidenceHasGateCaveat(lastTest)) {
      blockers.push("Tester pass contains caveat");
    }
  }

  if (config?.quality_gates.require_tests !== false) {
    if (!pr.automated_tests) blockers.push("Missing automated test result");
    else if (pr.automated_tests.status !== "passed") blockers.push(`Automated tests are ${pr.automated_tests.status}`);
    else if (currentHead && pr.automated_tests.head !== currentHead) blockers.push("Automated tests are stale for current head");
    else if (blockCaveatedPasses && evidenceHasGateCaveat(pr.automated_tests)) {
      blockers.push("Automated test pass contains caveat");
    }
  }

  if (config?.quality_gates.require_product_acceptance !== false) {
    if (!lastAcceptance) blockers.push("Missing PM/lead product acceptance");
    else if (lastAcceptance.decision !== "accept") blockers.push(`Product acceptance is ${lastAcceptance.decision}`);
    else if (currentHead && lastAcceptance.head !== currentHead) blockers.push("Product acceptance is stale for current head");
    else if (blockCaveatedPasses && evidenceHasGateCaveat(lastAcceptance)) {
      blockers.push("Product acceptance contains caveat");
    } else if (blockCaveatedPasses && productAcceptanceHasUnresolvedPriorCaveat(pr, eligibleAcceptances, currentHead)) {
      blockers.push("Product acceptance prior caveat lacks fresh validation");
    }
  }

  if (config?.quality_gates.require_diff_check !== false && (pr.base_head || currentHead)) {
    if (pr.branch === pr.base) blockers.push("PR branch must differ from base branch");
    if (!pr.base_head) blockers.push(`Base branch ${pr.base} does not resolve to a git commit`);
    if (!currentHead) blockers.push(`Branch ${pr.branch} does not resolve to a git commit`);
    if (pr.mergeable?.status === "conflict") blockers.push(`Branch has merge conflicts with ${pr.base}`);
  }

  return { ready: blockers.length === 0, blockers };
}

function statusForGateBlockers(blockers: string[]): PullRequestRecord["status"] {
  return blockers.some(isChangeRequestGateBlocker) ? "changes_requested" : "blocked";
}

function isChangeRequestGateBlocker(blocker: string): boolean {
  return blocker === "Latest review requests changes" || blocker === "Product acceptance is request_changes";
}

function latestReviewPerReviewer(reviews: ReviewRecord[]): ReviewRecord[] {
  const latest = new Map<string, ReviewRecord>();
  for (const review of reviews) {
    latest.set(review.reviewer, review);
  }
  return reviews.filter((review) => latest.get(review.reviewer) === review);
}

function latestAcceptancePerAccepter(acceptances: AcceptanceRecord[]): AcceptanceRecord[] {
  const latest = new Map<string, AcceptanceRecord>();
  for (const acceptance of acceptances) {
    latest.set(acceptance.accepter, acceptance);
  }
  return acceptances.filter((acceptance) => latest.get(acceptance.accepter) === acceptance);
}

export function hasGateCaveat(summary: string): boolean {
  const normalized = stripNonCaveatRiskPhrases(summary);
  if (/(\bcaveat\b|\bexcept\b|\bhowever\b|\bbut\b|\brisk\b|\bwarning\b|\bknown issue\b|\bpre[- ]?existing\b|\bunrelated\b|\bnot related\b|\bminor\b|\bnon[- ]?blocking\b|\bfollow[- ]?up\b|\bdeferred?\b|\bfuture iteration\b|\bbacklog\b|\bplaceholder\b|\bpartial\b|\bscope reduction\b|注意事项|但|不过|风险|警告|已知问题|既有|预存|預存|无关|無關|失败|失敗|未通过|未通過|不通过|不通過|非阻塞|建议|建議|仍需|尚未|未验证|未驗證|不可见|不可見|依赖 JS|依赖 javascript|依賴 JS|依賴 javascript|后续|後續|后續|后续迭代|後續迭代|待完善|待改进|待改進|剩余|剩餘|占位符|占位|降级|降級|cannot|can't|fail(?:ed|s)?|blocked)/i.test(normalized)) {
    return true;
  }
  for (const match of normalized.matchAll(/(\d+)\s*\/\s*(\d+)\s*(?:passed|pass|通过|通過)?/gi)) {
    if (Number(match[1]) < Number(match[2])) return true;
  }
  return false;
}

type GateEvidenceLike = Pick<GateEvidenceRecord, "clean" | "caveats"> & { summary: string };

export function evidenceHasGateCaveat(evidence: GateEvidenceLike): boolean {
  if (evidence.clean === false) return true;
  if ((evidence.caveats ?? []).some((caveat) => caveat.trim().length > 0)) return true;
  if (evidence.clean === true) return false;
  return hasGateCaveat(evidence.summary);
}

function hasUnresolvedCaveatedEvidence(records: Array<ReviewRecord | TestRecord | AutomatedTestRecord | AcceptanceRecord>): boolean {
  let unresolved = false;
  for (const record of records) {
    if (evidenceHasGateCaveat(record)) {
      unresolved = true;
    } else if (record.clean === true || mentionsResolvedHistoricalCaveat(record.summary)) {
      unresolved = false;
    }
  }
  return unresolved;
}

function productAcceptanceHasUnresolvedPriorCaveat(
  pr: PullRequestRecord,
  acceptances: AcceptanceRecord[],
  currentHead: string | null,
): boolean {
  let unresolvedSince: string | null = null;
  for (const acceptance of acceptances) {
    if (acceptance.decision !== "accept" || evidenceHasGateCaveat(acceptance)) {
      unresolvedSince = acceptance.ts;
      continue;
    }
    if (!unresolvedSince) continue;
    if (
      hasFreshSupportingGateEvidence(pr, currentHead, unresolvedSince, acceptance.ts) ||
      mentionsFreshProductValidationOrWaiver(acceptance.summary)
    ) {
      unresolvedSince = null;
    }
  }
  return unresolvedSince !== null;
}

function hasFreshSupportingGateEvidence(
  pr: PullRequestRecord,
  currentHead: string | null,
  afterTs: string,
  beforeOrAtTs: string,
): boolean {
  const after = Date.parse(afterTs);
  const beforeOrAt = Date.parse(beforeOrAtTs);
  if (!Number.isFinite(after) || !Number.isFinite(beforeOrAt)) return false;
  const isFresh = (record: ReviewRecord | TestRecord | AutomatedTestRecord): boolean => {
    if (currentHead && record.head !== currentHead) return false;
    const ts = Date.parse(record.ts);
    return Number.isFinite(ts) && ts > after && ts <= beforeOrAt;
  };
  const isFreshValidation = (record: TestRecord | AutomatedTestRecord): boolean =>
    !evidenceHasGateCaveat(record) && isFresh(record) && mentionsFreshProductValidationOrWaiver(record.summary);
  if (pr.tests.some((test) => test.status === "pass" && isFreshValidation(test))) return true;
  if (pr.automated_tests && pr.automated_tests.status === "passed" && isFreshValidation(pr.automated_tests)) return true;
  if ((pr.automated_test_history ?? []).some((record) => record.status === "passed" && isFreshValidation(record))) return true;
  return false;
}

function mentionsFreshProductValidationOrWaiver(summary: string): boolean {
  return /(?:observed|saw|clicked|opened|ran|retested|re-tested|validated|verified|playwright|browser|rendered|api request|screenshot|human (?:waiver|waived)|explicit (?:human|user) (?:waiver|approval)|risk (?:accepted|waived))/i.test(summary) ||
    /(?:实测|實測|已实测|已實測|浏览器|瀏覽器|打开页面|打開頁面|点击|點擊|观察到|觀察到|已观察|已觀察|渲染|API 请求|API 請求|截图|截圖|Playwright|重新验证|重新驗證|人类明确豁免|人類明確豁免|用户明确豁免|用戶明確豁免|接受风险|接受風險)/.test(summary);
}

function mentionsResolvedHistoricalCaveat(summary: string): boolean {
  return /(?:previous|earlier|prior|old|historical)[^.\n。]*(?:caveat|fail(?:ed|ures?|s)?|pre[- ]?existing)[^.\n。]*(?:resolved|fixed|no longer)/i.test(summary) ||
    /(?:resolved|fixed)[^.\n。]*(?:caveat|fail(?:ed|ures?|s)?|pre[- ]?existing)/i.test(summary) ||
    /(?:之前|前一版|上一版|历史|歷史)[^.\n。]*(?:caveat|失败|失敗|预存|預存)[^.\n。]*(?:已解决|已解決|已修复|已修復|不再构成|不再構成)/.test(summary) ||
    /(?:已解决|已解決|已修复|已修復|不再构成|不再構成)[^.\n。]*(?:caveat|失败|失敗|预存|預存)/.test(summary);
}

function stripNonCaveatRiskPhrases(summary: string): string {
  return summary
    .replace(/\b(?:no|zero)\s+(?:known\s+)?(?:regression\s+)?risks?\b/gi, "")
    .replace(/\bwarnings?[^.\n。]*(?:expected|normal|benign|intentional|acceptable)[^.\n。]*/gi, "")
    .replace(/\b(?:no|zero)\s+warnings?\b/gi, "")
    .replace(/\bwithout\s+warnings?\b/gi, "")
    .replace(/\b(?:no|zero)\s+(?:layout\s+)?regressions?\b/gi, "")
    .replace(/\b0\s+(?:tests?\s+)?fail(?:ed|ures?|s)?\b/gi, "")
    .replace(/\b(?:no|zero)\s+(?:build\s+|test\s+)?errors?\b/gi, "")
    .replace(/0\s*(?:个|項|项)?\s*(?:失败|失敗)/g, "")
    .replace(/警告[^.\n。]*(?:预期|預期|正常|可接受|不影响|不影響)[^.\n。]*/g, "")
    .replace(/(?:无|無|没有|沒有|零)(?:构建|構建|测试|測試)?(?:错误|錯誤|警告)/g, "")
    .replace(/(?:构建|構建|测试|測試)?(?:错误|錯誤|警告)[：:\s]*(?:无|無|没有|沒有|零)/g, "")
    .replace(/(?:previous|earlier|prior|old|historical)[^.\n。]*(?:caveat|fail(?:ed|ures?|s)?|pre[- ]?existing)[^.\n。]*(?:resolved|fixed|no longer)[^.\n。]*/gi, "")
    .replace(/(?:resolved|fixed)[^.\n。]*(?:caveat|fail(?:ed|ures?|s)?|pre[- ]?existing)[^.\n。]*/gi, "")
    .replace(/(?:之前|前一版|上一版|历史|歷史)[^.\n。]*(?:caveat|失败|失敗|预存|預存)[^.\n。]*(?:已解决|已解決|已修复|已修復|不再构成|不再構成)[^.\n。]*/g, "")
    .replace(/(?:已解决|已解決|已修复|已修復|不再构成|不再構成)[^.\n。]*(?:caveat|失败|失敗|预存|預存)[^.\n。]*/g, "")
    .replace(/(?:回归|回歸)?风险[：:\s]*(?:无|無|没有|沒有|零|为零|爲零)/g, "")
    .replace(/(?:无|無|没有|沒有|零)(?:回归|回歸)?风险/g, "");
}

function agentHasRole(agents: Record<string, AgentRecord>, agent: string, role: "reviewer" | "tester"): boolean {
  return agents[agent]?.role === role;
}

function productAcceptanceActorIsValid(state: CompanyState, actor: string): boolean {
  return productAcceptanceActorIsValidForAgents(state.config, state.agents, actor);
}

function productAcceptanceActorIsValidForAgents(config: CompanyConfig | null, agents: Record<string, AgentRecord>, actor: string): boolean {
  return actor === (config?.lead ?? "lead") || agents[actor]?.role === "pm";
}

function messageParticipantsAreValid(state: CompanyState, event: CompanyEvent): boolean {
  const from = event.actor;
  const to = String(event.data.to);
  const dataFrom = typeof event.data.from === "string" ? event.data.from : from;
  return dataFrom === from &&
    isMailboxMessageType(event.data.type) &&
    (from === "system" || Boolean(state.agents[from])) &&
    Boolean(state.agents[to]);
}

function normalizePrForReplay(state: CompanyState, pr: PullRequestRecord): PullRequestRecord | null {
  const author = state.agents[pr.author];
  if (author?.role !== "coder") return null;
  if (!prIssueMatchesAuthor(state, pr)) return null;
  if (pr.adopted_from_base) return { ...pr, acceptances: pr.acceptances ?? [] };
  const branch = author.branch && legacyBranchMatchesAuthor(pr, author.name) ? author.branch : pr.branch;
  if (author.branch && branch !== author.branch) return null;
  if (author.worktree && pr.worktree !== author.worktree) return null;
  return { ...pr, branch, acceptances: pr.acceptances ?? [] };
}

function prIssueMatchesAuthor(state: CompanyState, pr: PullRequestRecord): boolean {
  if (!pr.issue_id) return true;
  const issue = state.issues[pr.issue_id];
  if (!issue?.owner) return false;
  return issue.owner === pr.author;
}

function legacyBranchMatchesAuthor(pr: PullRequestRecord, authorName: string): boolean {
  return pr.branch === pr.author || pr.branch === authorName;
}

function automatedTestActorIsValid(state: CompanyState, actor: string, pr: PullRequestRecord): boolean {
  return actor === "system" || actor === pr.author || state.agents[actor]?.role === "tester";
}

function issueHasUnmergedPr(state: CompanyState, issueId: string): boolean {
  return Object.values(state.prs).some((pr) => pr.issue_id === issueId && pr.status !== "merged" && pr.status !== "abandoned");
}

function isAutomatedTestStatus(value: unknown): value is "passed" | "failed" | "blocked" {
  return value === "passed" || value === "failed" || value === "blocked";
}

function mergeCompletionIsValid(
  config: CompanyConfig | null,
  pr: PullRequestRecord,
  agents: Record<string, AgentRecord>,
  event: CompanyEvent,
): boolean {
  const fullGates = evaluatePrGates(config, pr, agents);
  const nonDiffGates = evaluatePrGates(withoutDiffCheck(config), pr, agents);
  if (!fullGates.ready && !nonDiffGates.ready) return false;
  if (typeof event.data.head === "string" && event.data.head === pr.head) return true;
  return !pr.head && fullGates.ready;
}

function withoutDiffCheck(config: CompanyConfig | null): CompanyConfig | null {
  if (!config) return null;
  return {
    ...config,
    quality_gates: {
      ...config.quality_gates,
      require_diff_check: false,
    },
  };
}

function isReviewDecision(value: unknown): value is "approve" | "request_changes" | "comment" {
  return value === "approve" || value === "request_changes" || value === "comment";
}

function isTestStatus(value: unknown): value is "pass" | "fail" | "blocked" {
  return value === "pass" || value === "fail" || value === "blocked";
}

function isAcceptanceDecision(value: unknown): value is "accept" | "request_changes" | "comment" {
  return value === "accept" || value === "request_changes" || value === "comment";
}

function isMailboxMessageType(value: unknown): boolean {
  return value === "assignment" ||
    value === "question" ||
    value === "reply" ||
    value === "report" ||
    value === "review" ||
    value === "test" ||
    value === "human_steering" ||
    value === "system";
}

function isRateLimitKind(value: unknown): value is "provider_429" | "quota_exhausted" | "manual" {
  return value === "provider_429" || value === "quota_exhausted" || value === "manual";
}
