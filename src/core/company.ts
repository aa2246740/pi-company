import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type {
  AgentRecord,
  AgentRole,
  AcceptanceRecord,
  AutomatedTestRecord,
  CompanyConfig,
  CompanyEvent,
  CompanyState,
  IssueRecord,
  IssueWorkType,
  MailboxMessage,
  MailboxMessageType,
  MergeabilityRecord,
  MessagePolicy,
  MessagePriority,
  MessageWakeDecision,
  PiModelConfig,
  PullRequestRecord,
  RateLimitKind,
  RateLimitPolicy,
  ReviewRecord,
  TestRecord,
} from "./types.js";
import { appendEvent, appendMailbox, ensureCompanyDirs, readEvents, readMailbox, readYaml, writeJson, writeYaml, atomicWriteText } from "./io.js";
import { companyPaths, issuePath, prPath } from "./paths.js";
import { defaultCoderWorktree, defaultConfig, DEFAULT_MESSAGE_POLICY, DEFAULT_RATE_LIMIT_POLICY, DEFAULT_ROLES, defaultRoster } from "./defaults.js";
import { makeEvent } from "./events.js";
import { newId, nowIso, slug } from "./id.js";
import { evaluatePrGates, hasGateCaveat, reduceEvents } from "./reducer.js";

const AGENT_STALE_MS = 5 * 60_000;
const PENDING_MERGE_REMINDER_PREFIX = "[pi-company pending merge]";

export interface InitOptions {
  root?: string;
  id?: string;
  name?: string;
}

export interface LeadBriefPr {
  id: string;
  title: string;
  status: PullRequestRecord["status"];
  issue_id?: string | null;
  author: string;
  branch: string;
  head?: string | null;
  ready: boolean;
  blockers: string[];
  merge_requested_at?: string | null;
  branch_integrated_in_base: boolean;
  worktree_dirty: string[];
  superseded_by?: string | null;
  evidence: LeadBriefPrEvidence;
}

export interface LeadBriefPrEvidence {
  coder_ready: string;
  automated_tests: string;
  review: string;
  tester: string;
  acceptance: string;
  recent_risks: string[];
}

export interface LeadBrief {
  company: string;
  updated_at: string | null;
  delivery_state: "complete" | "in_progress" | "blocked";
  can_claim_complete: boolean;
  reasons_not_complete: string[];
  incomplete_issues: IssueRecord[];
  prs: LeadBriefPr[];
  root_worktree_changes: string[];
  next_actions: string[];
}

export function initCompany(options: InitOptions = {}): CompanyState {
  const root = path.resolve(options.root ?? process.cwd());
  const id = slug(options.id ?? path.basename(root));
  const paths = companyPaths(root);
  ensureCompanyDirs(paths);
  ensureCompanyGitignore(root);
  if (fs.existsSync(paths.events)) return loadState(root);

  const config = {
    ...defaultConfig(root, id),
    name: options.name ?? id,
  };
  const roster = defaultRoster(root);

  writeYaml(paths.config, config);
  writeYaml(paths.roster, roster);
  for (const [role, body] of Object.entries(DEFAULT_ROLES)) {
    const file = path.join(paths.rolesDir, `${role}.md`);
    if (!fs.existsSync(file)) atomicWriteText(file, body);
  }

  const event = makeEvent("company.initialized", "system", { config, roster });
  appendEvent(paths, event);
  const state = rebuildState(root);
  return state;
}

function ensureCompanyGitignore(root: string): void {
  const ignorePath = path.join(root, ".gitignore");
  const entry = ".pi-company/";
  const existing = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, "utf8") : "";
  const lines = existing.split(/\r?\n/).map((line) => line.trim());
  if (lines.some((line) => line === entry || line === ".pi-company" || line === "/.pi-company/" || line === "/.pi-company")) {
    return;
  }
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(ignorePath, `${prefix}${entry}\n`, "utf8");
}

export function loadConfig(root = process.cwd()): CompanyConfig | null {
  const paths = companyPaths(root);
  return readYaml<CompanyConfig | null>(paths.config, null);
}

export function setModelPolicy(root: string, actor: string, target: "defaults" | "role" | "agent", name: string | null, model: PiModelConfig | null): CompanyConfig {
  requireLead(root, actor, "configure model policy");
  const paths = companyPaths(root);
  const config = loadConfig(root) ?? defaultConfig(root, slug(path.basename(root)));
  const policy = {
    defaults: config.model_policy?.defaults ?? null,
    roles: { ...(config.model_policy?.roles ?? {}) },
    agents: { ...(config.model_policy?.agents ?? {}) },
  };

  if (target === "defaults") {
    policy.defaults = normalizeModelConfig(model);
  } else if (target === "role") {
    if (!name) throw new Error("Role name is required for role model policy.");
    policy.roles[name] = normalizeModelConfig(model);
  } else {
    if (!name) throw new Error("Agent name is required for agent model policy.");
    policy.agents[name] = normalizeModelConfig(model);
  }

  const next = { ...config, model_policy: policy };
  writeYaml(paths.config, next);
  return next;
}

export function resolveAgentModelConfig(root: string, agentName: string): PiModelConfig | null {
  const state = loadState(root);
  const config = loadConfig(root) ?? state.config;
  const agent = state.agents[agentName];
  if (!config || !agent) return null;
  return mergeModelConfigs(
    config.model_policy?.defaults ?? null,
    config.model_policy?.roles?.[agent.role] ?? null,
    config.model_policy?.agents?.[agent.name] ?? null,
  );
}

export function loadState(root = process.cwd()): CompanyState {
  const paths = companyPaths(root);
  if (!fs.existsSync(paths.events)) {
    return reduceEvents([]);
  }
  return rebuildState(root);
}

export function rebuildState(root = process.cwd()): CompanyState {
  const paths = companyPaths(root);
  ensureCompanyDirs(paths);
  const events = readEvents(paths);
  const state = reduceEvents(events);
  state.config = loadConfig(root) ?? state.config;
  refreshPrGitState(root, state);
  refreshPrStatuses(root, state);
  refreshAgentLiveness(state);
  writeJson(paths.state, state);
  return state;
}

export function recordEvent(root: string, event: CompanyEvent): CompanyState {
  const paths = companyPaths(root);
  ensureCompanyDirs(paths);
  appendEvent(paths, event);
  const state = rebuildState(root);
  syncRenderedRecordsForEvent(root, state, event);
  return state;
}

export function syncRenderedRecords(root: string, state: CompanyState = loadState(root)): void {
  const paths = companyPaths(root);
  for (const issue of Object.values(state.issues)) {
    atomicWriteText(issuePath(paths, issue.id), renderIssue(issue));
  }
  for (const pr of Object.values(state.prs)) {
    atomicWriteText(prPath(paths, pr.id), renderPr(pr));
  }
}

function syncRenderedRecordsForEvent(root: string, state: CompanyState, event: CompanyEvent): void {
  const paths = companyPaths(root);
  const issueIds = new Set<string>();
  const prIds = new Set<string>();

  if (event.type === "issue.created") {
    const issue = event.data.issue as IssueRecord | undefined;
    if (issue?.id) issueIds.add(issue.id);
  }
  if (event.type === "issue.assigned" || event.type.startsWith("task.")) {
    const issueId = event.data.issue_id;
    if (typeof issueId === "string") issueIds.add(issueId);
  }
  if (
    event.type === "pr.created" ||
    event.type === "pr.ready" ||
    event.type === "pr.abandoned" ||
    event.type === "pr.automated_tests" ||
    event.type === "review.submitted" ||
    event.type === "test.submitted" ||
    event.type === "acceptance.submitted" ||
    event.type === "merge.requested" ||
    event.type === "merge.blocked" ||
    event.type === "merge.completed"
  ) {
    const pr = event.type === "pr.created" ? event.data.pr as PullRequestRecord | undefined : null;
    const prId = pr?.id ?? event.data.pr_id;
    if (typeof prId === "string") prIds.add(prId);
  }

  for (const prId of prIds) {
    const pr = state.prs[prId];
    if (!pr) continue;
    atomicWriteText(prPath(paths, prId), renderPr(pr));
    if (pr.issue_id) issueIds.add(pr.issue_id);
  }
  for (const issueId of issueIds) {
    const issue = state.issues[issueId];
    if (!issue) continue;
    atomicWriteText(issuePath(paths, issueId), renderIssue(issue));
  }
}

export function registerAgent(root: string, agent: {
  name: string;
  role: AgentRole;
  cwd: string;
  mission?: string | null;
  worktree?: string | null;
  branch?: string | null;
  status?: AgentRecord["status"];
}): CompanyState {
  const state = loadState(root);
  const existing = state.agents[agent.name];
  if (!existing) {
    throw new Error(`Unknown agent ${agent.name}. Lead must spawn the agent before it can register.`);
  }
  requireAgentRegistrationMatchesPlan(existing, agent);
  return recordEvent(root, makeEvent("agent.spawned", agent.name, {
    ...agent,
    status: agent.status ?? "online",
  }));
}

export function recordAgentLaunch(root: string, actor: string, agentName: string, cmuxSurface: string): CompanyState {
  const state = loadState(root);
  if (actor !== "system" && actor !== (state.config?.lead ?? "lead")) {
    throw new Error(`Only ${state.config?.lead ?? "lead"} can record agent launches.`);
  }
  if (!state.agents[agentName]) throw new Error(`Unknown agent ${agentName}.`);
  const surface = cmuxSurface.trim();
  if (!surface) throw new Error("cmux surface is required.");
  return recordEvent(root, makeEvent("agent.launch_recorded", agentName, {
    name: agentName,
    cmux_surface: surface,
  }));
}

function requireAgentRegistrationMatchesPlan(existing: AgentRecord, agent: {
  name: string;
  role: AgentRole;
  branch?: string | null;
  worktree?: string | null;
}): void {
  if (existing.role !== agent.role) {
    throw new Error(`Agent ${agent.name} registered role ${agent.role}, expected ${existing.role}.`);
  }
  if ((agent.branch ?? null) !== (existing.branch ?? null)) {
    throw new Error(`Agent ${agent.name} registered branch ${agent.branch ?? "none"}, expected ${existing.branch ?? "none"}.`);
  }
  if (!sameNullablePath(agent.worktree ?? null, existing.worktree ?? null)) {
    throw new Error(`Agent ${agent.name} registered worktree ${agent.worktree ?? "none"}, expected ${existing.worktree ?? "none"}.`);
  }
}

function sameNullablePath(left: string | null, right: string | null): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return path.resolve(left) === path.resolve(right);
}

function requireLead(root: string, actor: string, action: string): void {
  const lead = loadState(root).config?.lead ?? "lead";
  if (actor !== lead) throw new Error(`Only ${lead} can ${action}.`);
}

function requireIssueOwner(root: string, actor: string, issueId: string, action: string, allowDone = false): IssueRecord {
  return requireIssueOwnerFromState(loadState(root), actor, issueId, action, allowDone);
}

function requireIssueOwnerFromState(state: CompanyState, actor: string, issueId: string, action: string, allowDone = false): IssueRecord {
  const issue = state.issues[issueId];
  if (!issue) throw new Error(`Unknown issue ${issueId}`);
  if (!issue.owner) throw new Error(`Issue ${issueId} is unassigned.`);
  if (actor !== issue.owner) throw new Error(`Only ${issue.owner} can ${action} ${issueId}.`);
  if (issue.status === "done" && !allowDone) throw new Error(`Issue ${issueId} is already done.`);
  return issue;
}

function requireAgentRole(state: CompanyState, actor: string, role: "reviewer" | "tester", action: string): void {
  const agent = state.agents[actor];
  if (!agent) throw new Error(`Unknown ${action} actor ${actor}.`);
  if (agent.role !== role) throw new Error(`Only ${role} agents can ${action}. ${actor} has role ${agent.role}.`);
}

export function heartbeatAgent(root: string, agent: {
  name: string;
  role?: AgentRole;
  cwd?: string;
  current_task?: string | null;
  status?: AgentRecord["status"];
}): CompanyState {
  const state = loadState(root);
  const existing = state.agents[agent.name];
  if (!existing) {
    throw new Error(`Unknown agent ${agent.name}. Lead must spawn the agent before heartbeat.`);
  }
  if (agent.role && agent.role !== existing.role) {
    throw new Error(`Agent ${agent.name} heartbeat role ${agent.role}, expected ${existing.role}.`);
  }
  if (agent.current_task !== undefined) {
    requireAgentCurrentTask(state, agent.name, agent.current_task);
  }
  return recordEvent(root, makeEvent("agent.heartbeat", agent.name, {
    ...agent,
    status: agent.status ?? "online",
  }));
}

function requireAgentCurrentTask(state: CompanyState, agent: string, issueId: string | null): void {
  if (issueId === null) return;
  const issue = state.issues[issueId];
  if (!issue) throw new Error(`Unknown current task ${issueId}.`);
  if (!issue.owner) throw new Error(`Issue ${issueId} is unassigned.`);
  if (issue.owner !== agent) throw new Error(`Only ${issue.owner ?? "unassigned owner"} can work on ${issueId}.`);
  if (issue.status === "done") throw new Error(`Issue ${issueId} is already done.`);
}

export function sendCompanyMessage(
  root: string,
  message: Omit<MailboxMessage, "id" | "ts">,
  options: { bypassTargetCooldown?: boolean } = {},
): MailboxMessage {
  const paths = companyPaths(root);
  ensureCompanyDirs(paths);
  const events = readEvents(paths);
  const state = reduceEvents(events);
  // Message wake decisions must honor the current editable company.yaml,
  // not only the historical config captured by the initialization event.
  // This keeps operator-tuned wake policy changes effective immediately.
  state.config = loadConfig(root) ?? state.config;
  if (message.from !== "system" && !state.agents[message.from]) {
    throw new Error(`Unknown message sender ${message.from}.`);
  }
  if (!state.agents[message.to]) {
    throw new Error(`Unknown message recipient ${message.to}.`);
  }
  if (!isMailboxMessageType(message.type)) {
    throw new Error(`Invalid message type ${String(message.type)}.`);
  }
  if (message.priority !== undefined && !isMessagePriority(message.priority)) {
    throw new Error(`Invalid message priority ${String(message.priority)}.`);
  }
  const ts = nowIso();
  const priority = message.priority ?? defaultPriorityForMessage(message.type);
  const rateLimitWake = message.type === "human_steering" ? null : rateLimitWakeDecision(state, message.to, ts);
  const wake = rateLimitWake ?? decideMessageWake(events, normalizeMessagePolicy(state.config?.message_policy), {
    ...message,
    priority,
  }, ts, options);
  const text = appendPrGateSnapshot(state, message);
  const full: MailboxMessage = {
    id: newId("msg"),
    ts,
    ...message,
    text,
    priority,
    wake,
  };
  appendMailbox(paths, full);
  const event = makeEvent("message.sent", message.from, {
    ...full,
  });
  appendEvent(paths, event);
  rebuildState(root);
  return full;
}

export function normalizeMessagePolicy(policy?: Partial<MessagePolicy> | null): MessagePolicy {
  const immediateTypes = Array.isArray(policy?.immediate_types)
    ? policy.immediate_types.filter(isMailboxMessageType)
    : DEFAULT_MESSAGE_POLICY.immediate_types;
  return {
    immediate_types: immediateTypes,
    always_wake_human_steering: typeof policy?.always_wake_human_steering === "boolean"
      ? policy.always_wake_human_steering
      : DEFAULT_MESSAGE_POLICY.always_wake_human_steering,
    agent_cooldown_ms: finiteNonNegativeNumber(policy?.agent_cooldown_ms, DEFAULT_MESSAGE_POLICY.agent_cooldown_ms),
    agent_max_immediate_per_minute: finiteNonNegativeNumber(
      policy?.agent_max_immediate_per_minute,
      DEFAULT_MESSAGE_POLICY.agent_max_immediate_per_minute,
    ),
    org_max_immediate_per_minute: finiteNonNegativeNumber(
      policy?.org_max_immediate_per_minute,
      DEFAULT_MESSAGE_POLICY.org_max_immediate_per_minute,
    ),
  };
}

export function normalizeRateLimitPolicy(policy?: Partial<RateLimitPolicy> | null): RateLimitPolicy {
  return {
    initial_backoff_ms: finitePositiveNumber(policy?.initial_backoff_ms, DEFAULT_RATE_LIMIT_POLICY.initial_backoff_ms),
    max_backoff_ms: finitePositiveNumber(policy?.max_backoff_ms, DEFAULT_RATE_LIMIT_POLICY.max_backoff_ms),
    quota_backoff_ms: finitePositiveNumber(policy?.quota_backoff_ms, DEFAULT_RATE_LIMIT_POLICY.quota_backoff_ms),
    recovery_stagger_ms: finiteNonNegativeNumber(policy?.recovery_stagger_ms, DEFAULT_RATE_LIMIT_POLICY.recovery_stagger_ms),
  };
}

function finiteNonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function finitePositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function reportRateLimit(
  root: string,
  actor: string,
  reason: string,
  kind: RateLimitKind = "provider_429",
  now = nowIso(),
): CompanyState {
  const state = loadState(root);
  if (actor !== "system" && !state.agents[actor]) throw new Error(`Unknown rate-limit reporter ${actor}.`);
  if (!isRateLimitKind(kind)) throw new Error(`Invalid rate-limit kind ${kind}.`);
  const policy = normalizeRateLimitPolicy(state.config?.rate_limit_policy);
  const active = rateLimitIsActive(state, now);
  const previous = active ? state.rate_limit?.retry_after_ms ?? 0 : 0;
  const retryAfterMs = kind === "quota_exhausted"
    ? Math.max(policy.quota_backoff_ms, previous > 0 ? Math.min(previous * 2, policy.max_backoff_ms) : 0)
    : previous > 0
      ? Math.min(previous * 2, policy.max_backoff_ms)
      : policy.initial_backoff_ms;
  const incidents = active ? (state.rate_limit?.incidents ?? 0) + 1 : 1;
  const reported = recordEvent(root, makeEvent("rate_limit.reported", actor, {
    kind,
    reason,
    retry_after_ms: retryAfterMs,
    paused_until: new Date(Date.parse(now) + retryAfterMs).toISOString(),
    incidents,
  }));
  const lead = reported.config?.lead ?? "lead";
  if (reported.agents[lead]) {
    sendCompanyMessage(root, {
      from: actor === lead ? "system" : actor,
      to: lead,
      type: "system",
      priority: "high",
      text: `Rate limit reported by ${actor}: ${reason}. Organization paused until ${reported.rate_limit?.paused_until}. Resume agents gradually after cooldown.`,
    });
  }
  return loadState(root);
}

export function clearRateLimit(root: string, actor: string, reason: string, now = nowIso()): CompanyState {
  if (actor !== "system") requireLead(root, actor, "clear rate-limit backoff");
  const cleared = recordEvent(root, {
    ...makeEvent("rate_limit.cleared", actor, {
      reason,
    }),
    ts: now,
  });
  const lead = cleared.config?.lead ?? "lead";
  if (cleared.agents[lead]) {
    sendCompanyMessage(root, {
      from: "system",
      to: lead,
      type: "system",
      priority: "high",
      text: `Rate-limit backoff cleared by ${actor}: ${reason}. Review queued inbox and resume work deliberately.`,
    });
  }
  return loadState(root);
}

export function rateLimitIsActive(state: CompanyState, now = nowIso()): boolean {
  const pausedUntil = state.rate_limit?.paused_until ? Date.parse(state.rate_limit.paused_until) : Number.NaN;
  const current = Date.parse(now);
  return Number.isFinite(pausedUntil) && Number.isFinite(current) && current < pausedUntil;
}

export function agentRateLimitResumeAt(state: CompanyState, agentName: string): string | null {
  if (!state.rate_limit) return null;
  const pausedUntil = Date.parse(state.rate_limit.paused_until);
  if (!Number.isFinite(pausedUntil)) return null;
  const policy = normalizeRateLimitPolicy(state.config?.rate_limit_policy);
  const lead = state.config?.lead ?? "lead";
  const agents = Object.keys(state.agents).filter((name) => name !== lead).sort();
  const index = agentName === lead ? 0 : agents.indexOf(agentName) + 1;
  if (index < 0) return new Date(pausedUntil + policy.recovery_stagger_ms).toISOString();
  return new Date(pausedUntil + index * policy.recovery_stagger_ms).toISOString();
}

function rateLimitWakeDecision(state: CompanyState, agentName: string, now: string): MessageWakeDecision | null {
  const resumeAt = agentRateLimitResumeAt(state, agentName);
  if (!resumeAt) return null;
  if (Date.parse(now) >= Date.parse(resumeAt)) return null;
  return {
    mode: "digest",
    reason: `organization rate-limit backoff until ${resumeAt}`,
    next_wake_after: resumeAt,
  };
}

export function decideMessageWake(
  events: CompanyEvent[],
  policy: MessagePolicy,
  message: Pick<MailboxMessage, "to" | "type" | "priority">,
  ts: string,
  options: { bypassTargetCooldown?: boolean } = {},
): MessageWakeDecision {
  if (message.type === "human_steering" && policy.always_wake_human_steering) {
    return { mode: "immediate", reason: "human steering always wakes lead" };
  }
  const immediateCandidate = message.priority === "high" || message.priority === "urgent" || policy.immediate_types.includes(message.type);
  if (!immediateCandidate) {
    return {
      mode: "digest",
      reason: `${message.type} is digest by default`,
      next_wake_after: new Date(Date.parse(ts) + policy.agent_cooldown_ms).toISOString(),
    };
  }

  const now = Date.parse(ts);
  const oneMinuteAgo = now - 60_000;
  const agentCooldownStart = now - policy.agent_cooldown_ms;
  const immediateEvents = events.filter((event) => {
    if (event.type !== "message.sent") return false;
    if ((event.data.wake as MessageWakeDecision | undefined)?.mode !== "immediate") return false;
    const eventTs = Date.parse(event.ts);
    return Number.isFinite(eventTs) && eventTs >= oneMinuteAgo;
  });
  if (immediateEvents.length >= policy.org_max_immediate_per_minute) {
    return {
      mode: "digest",
      reason: `organization immediate wake limit reached (${policy.org_max_immediate_per_minute}/min)`,
      next_wake_after: nextWakeAfterWindowLimit(immediateEvents, oneMinuteAgo),
    };
  }

  const agentImmediateEvents = immediateEvents.filter((event) => String(event.data.to) === message.to);
  if (agentImmediateEvents.length >= policy.agent_max_immediate_per_minute) {
    return {
      mode: "digest",
      reason: `${message.to} immediate wake limit reached (${policy.agent_max_immediate_per_minute}/min)`,
      next_wake_after: nextWakeAfterWindowLimit(agentImmediateEvents, oneMinuteAgo),
    };
  }

  if (!options.bypassTargetCooldown) {
    const latestAgentWake = agentImmediateEvents
      .map((event) => Date.parse(event.ts))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    if (latestAgentWake && latestAgentWake >= agentCooldownStart) {
      return {
        mode: "digest",
        reason: `${message.to} is cooling down`,
        next_wake_after: new Date(latestAgentWake + policy.agent_cooldown_ms).toISOString(),
      };
    }
  }

  if (message.priority === "urgent") return { mode: "immediate", reason: "urgent priority within rate limits" };
  if (options.bypassTargetCooldown) return { mode: "immediate", reason: "message bypasses target cooldown within rate limits" };
  return { mode: "immediate", reason: "message type and rate limits allow wake" };
}

function nextWakeAfterWindowLimit(events: CompanyEvent[], lowerBound: number): string | null {
  const oldestInWindow = events
    .map((event) => Date.parse(event.ts))
    .filter((ts) => Number.isFinite(ts) && ts >= lowerBound)
    .sort((a, b) => a - b)[0];
  return oldestInWindow ? new Date(oldestInWindow + 60_000).toISOString() : null;
}

function defaultPriorityForMessage(type: MailboxMessage["type"]): MessagePriority {
  if (type === "human_steering") return "urgent";
  if (type === "assignment" || type === "review" || type === "test") return "high";
  return "normal";
}

function appendPrGateSnapshot(
  state: CompanyState,
  message: Omit<MailboxMessage, "id" | "ts">,
): string {
  const task = typeof message.task === "string" ? message.task : null;
  if (!task || !state.prs[task] || message.text.includes("[pi-company PR gate snapshot]")) {
    return message.text;
  }

  const pr = state.prs[task];
  const gates = evaluatePrGates(state.config, pr, state.agents);
  const evidence = buildPrEvidence(state.config, pr, state.agents);
  const gateLine = gates.ready ? "ready" : `blocked: ${gates.blockers.join("; ") || "unknown blocker"}`;
  const risks = evidence.recent_risks.length > 0
    ? `\n- recent risks: ${evidence.recent_risks.slice(0, 2).join(" | ")}`
    : "";

  return `${message.text}

[pi-company PR gate snapshot]
- ${pr.id} head: ${shortHead(pr.head)}
- gate: ${gateLine}
- coder: ${evidence.coder_ready}
- review: ${evidence.review}
- tester: ${evidence.tester}
- acceptance: ${evidence.acceptance}
- automated: ${evidence.automated_tests}${risks}`;
}

const MESSAGE_TYPES = new Set<MailboxMessageType>([
  "assignment",
  "question",
  "reply",
  "report",
  "review",
  "test",
  "human_steering",
  "system",
]);

const MESSAGE_PRIORITIES = new Set<MessagePriority>(["normal", "high", "urgent"]);

function isMailboxMessageType(value: unknown): value is MailboxMessageType {
  return typeof value === "string" && MESSAGE_TYPES.has(value as MailboxMessageType);
}

function isMessagePriority(value: unknown): value is MessagePriority {
  return typeof value === "string" && MESSAGE_PRIORITIES.has(value as MessagePriority);
}

function readInboxMessages(paths: ReturnType<typeof companyPaths>, agent: string): MailboxMessage[] {
  const byId = new Map<string, MailboxMessage>();
  const seenEventIds = new Set<string>();
  for (const event of readEvents(paths)) {
    if (event.type !== "message.sent") continue;
    const id = typeof event.data.id === "string" ? event.data.id : null;
    if (!id || seenEventIds.has(id)) continue;
    seenEventIds.add(id);
    const message = mailboxMessageFromSentEvent(event, agent);
    if (message) byId.set(message.id, message);
  }
  for (const message of readMailbox(paths, agent)) {
    const normalized = normalizeStoredMailboxMessage(message, agent);
    if (normalized && !byId.has(normalized.id)) {
      byId.set(normalized.id, normalized);
    }
  }
  return [...byId.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

function mailboxMessageFromSentEvent(event: CompanyEvent, agent: string): MailboxMessage | null {
  const id = typeof event.data.id === "string" ? event.data.id : null;
  const to = typeof event.data.to === "string" ? event.data.to : null;
  const type = typeof event.data.type === "string" && MESSAGE_TYPES.has(event.data.type as MailboxMessageType)
    ? event.data.type as MailboxMessageType
    : null;
  const from = typeof event.data.from === "string" ? event.data.from : event.actor;
  if (!id || to !== agent || !type || from !== event.actor) return null;
  return {
    id,
    ts: typeof event.data.ts === "string" ? event.data.ts : event.ts,
    from,
    to,
    type,
    task: typeof event.data.task === "string" ? event.data.task : null,
    text: typeof event.data.text === "string" ? event.data.text : "",
    event_id: typeof event.data.event_id === "string" ? event.data.event_id : null,
    priority: isMessagePriority(event.data.priority) ? event.data.priority : undefined,
    wake: event.data.wake as MessageWakeDecision | undefined,
  };
}

function normalizeStoredMailboxMessage(message: MailboxMessage, agent: string): MailboxMessage | null {
  if (message.to !== agent || typeof message.id !== "string" || !isMailboxMessageType(message.type)) return null;
  const from = typeof message.from === "string" ? message.from : null;
  const text = typeof message.text === "string" ? message.text : "";
  if (!from) return null;
  return {
    ...message,
    from,
    to: agent,
    type: message.type,
    text,
    priority: isMessagePriority(message.priority) ? message.priority : undefined,
  };
}

export function markMessageDelivered(root: string, agent: string, messageId: string): CompanyState {
  if (!loadState(root).agents[agent]) throw new Error(`Unknown agent ${agent}.`);
  const paths = companyPaths(root);
  ensureCompanyDirs(paths);
  const messages = readInboxMessages(paths, agent);
  if (!messages.some((message) => message.id === messageId)) {
    throw new Error(`Unknown message ${messageId} in ${agent}'s inbox.`);
  }
  const alreadyDelivered = readEvents(paths).some((event) =>
    event.type === "message.delivered" &&
    event.actor === agent &&
    event.data.to === agent &&
    event.data.message_id === messageId
  );
  if (alreadyDelivered) return loadState(root);
  return recordEvent(root, makeEvent("message.delivered", agent, {
    to: agent,
    message_id: messageId,
  }));
}

export function listInbox(root: string, agent: string, includeDelivered = false): MailboxMessage[] {
  if (!loadState(root).agents[agent]) throw new Error(`Unknown agent ${agent}.`);
  const paths = companyPaths(root);
  ensureCompanyDirs(paths);
  const messages = readInboxMessages(paths, agent);
  if (includeDelivered) return messages;
  const mailboxIds = new Set(messages.map((message) => message.id));
  const delivered = new Set(
    readEvents(paths)
      .filter((event) =>
        event.type === "message.delivered" &&
        event.actor === agent &&
        event.data.to === agent &&
        mailboxIds.has(String(event.data.message_id))
      )
      .map((event) => String(event.data.message_id)),
  );
  return messages.filter((message) => !delivered.has(message.id));
}

export function acknowledgeInbox(root: string, agent: string, messageIds: string[]): CompanyState {
  let state = loadState(root);
  for (const id of messageIds) {
    state = markMessageDelivered(root, agent, id);
  }
  return state;
}

export function shouldAutoDeliverMessage(
  message: MailboxMessage,
  state?: CompanyState,
  agentName = message.to,
  now = nowIso(),
): boolean {
  if (message.wake?.mode === "digest") {
    if (state && isRateLimitBackoffDigest(message) && !agentRateLimitResumeAt(state, agentName)) {
      return true;
    }
    const fallbackWake = state
      ? legacyDigestWakeAfter(message, normalizeMessagePolicy(state.config?.message_policy))
      : null;
    const nextWakeAt = message.wake.next_wake_after ?? fallbackWake;
    if (!nextWakeAt) return false;
    const nextWake = Date.parse(nextWakeAt);
    const current = Date.parse(now);
    return Number.isFinite(nextWake) && Number.isFinite(current) && current >= nextWake;
  }
  if (message.type === "human_steering") return true;
  if (!state) return true;
  const resumeAt = agentRateLimitResumeAt(state, agentName);
  return !resumeAt || Date.parse(now) >= Date.parse(resumeAt);
}

function isRateLimitBackoffDigest(message: MailboxMessage): boolean {
  return /organization rate-limit backoff until/i.test(message.wake?.reason ?? "");
}

function legacyDigestWakeAfter(message: MailboxMessage, policy: MessagePolicy): string | null {
  const sentAt = Date.parse(message.ts);
  if (!Number.isFinite(sentAt)) return null;
  return new Date(sentAt + policy.agent_cooldown_ms).toISOString();
}

export function recordHumanSteering(root: string, targetAgent: string, text: string, streamingBehavior?: string | null): MailboxMessage | null {
  const state = loadState(root);
  if (!state.agents[targetAgent]) throw new Error(`Unknown human steering target ${targetAgent}.`);
  const lead = state.config?.lead ?? "lead";
  const event = makeEvent("human_steering.received", targetAgent, {
    target_agent: targetAgent,
    text,
    streaming_behavior: streamingBehavior ?? null,
  });
  recordEvent(root, event);
  if (targetAgent === lead) return null;
  return sendCompanyMessage(root, {
    from: targetAgent,
    to: lead,
    type: "human_steering",
    task: state.agents[targetAgent]?.current_task ?? null,
    text: `Human steering sent to ${targetAgent}:\n\n${text}`,
    event_id: event.id,
  });
}

export function createIssue(
  root: string,
  actor: string,
  title: string,
  body = "",
  options: { work_type?: IssueWorkType | null } = {},
): IssueRecord {
  requireLead(root, actor, "create issues");
  const workType = options.work_type ?? null;
  const paths = companyPaths(root);
  const id = `ISSUE-${String(Object.keys(loadState(root).issues).length + 1).padStart(3, "0")}`;
  const now = nowIso();
  const issue: IssueRecord = {
    id,
    title,
    body,
    work_type: workType,
    status: "open",
    owner: null,
    created_by: actor,
    created_at: now,
    updated_at: now,
  };
  atomicWriteText(issuePath(paths, id), renderIssue(issue));
  recordEvent(root, makeEvent("issue.created", actor, { issue }));
  return issue;
}

export function assignIssue(root: string, actor: string, issueId: string, owner: string): CompanyState {
  requireLead(root, actor, "assign issues");
  const state = loadState(root);
  const issue = state.issues[issueId];
  if (!issue) throw new Error(`Unknown issue ${issueId}`);
  if (issue.status === "done") throw new Error(`Issue ${issueId} is already done.`);
  if (!state.agents[owner]) throw new Error(`Unknown agent ${owner}. Spawn or register the agent before assigning issues.`);
  assertIssueOwnerRoleCompatible(state, issue, owner);
  const shouldNotifyOwner = issue.owner !== owner && owner !== actor;
  const next = recordEvent(root, makeEvent("issue.assigned", actor, { issue_id: issueId, owner }));
  if (!shouldNotifyOwner) return next;
  sendCompanyMessage(root, {
    from: actor,
    to: owner,
    type: "assignment",
    task: issueId,
    priority: "high",
    text: renderAssignmentMessage(issue),
  });
  return loadState(root);
}

function renderAssignmentMessage(issue: IssueRecord): string {
  return `[pi-company assignment]

You are assigned ${issue.id}: ${issue.title}
Work type: ${issue.work_type ?? "unspecified"}

Start or continue the issue with company_task_update, inspect the local project files you need, and report blockers or PR readiness through the normal pi-company tools.

Issue brief:
${issue.body || "(no issue body provided)"}`;
}

export function inferIssueWorkType(title: string, body = ""): IssueWorkType | null {
  const text = `${title}\n${body}`.toLowerCase();
  if (/(html|css|javascript|typescript|three\.?\s*js|threejs|frontend|backend|\bapi\b|website|web app|\bapp\b|game|build|implement|implementation|code|source|component|server|client|网页|网站|前端|后端|接口|游戏|代码|编码|实现|开发|构建|可运行|交付物)/i.test(text)) return "implementation";
  if (/(impeccable|designer|\bui\b|\bux\b|visual|interaction|prototype|wireframe|layout|style guide|design system|设计师|视觉|交互|原型|线框|设计系统|界面设计)/i.test(text)) return "design";
  if (/(acceptance|requirements?|product|scope|user value|验收|需求|产品|范围|用户价值)/i.test(text)) return "product";
  if (/(test|qa|validation|verify|测试|验证|验收测试)/i.test(text)) return "test";
  if (/(review|code review|审查|评审|代码审查)/i.test(text)) return "review";
  if (/(research|investigate|compare|调研|研究|调查|对比)/i.test(text)) return "research";
  return null;
}

function assertIssueOwnerRoleCompatible(state: CompanyState, issue: IssueRecord, owner: string): void {
  const workType = issue.work_type ?? null;
  if (!workType) return;
  const agent = state.agents[owner];
  const role = agent?.role ?? owner;
  if (issueOwnerCanOwnWorkType(role, owner, workType)) return;
  throw new Error(`Issue ${issue.id} is ${workType} work and cannot be assigned to ${owner} (${role}). ${workType} work must be owned by ${expectedRoleForWorkType(workType)}.`);
}

function issueOwnerCanOwnWorkType(role: string, owner: string, workType: IssueWorkType): boolean {
  if (workType === "implementation") return role === "coder" || owner.startsWith("coder");
  if (workType === "design") return role === "designer" || owner.startsWith("designer");
  if (workType === "product") return role === "pm" || owner.startsWith("pm");
  if (workType === "test") return role === "tester" || owner.startsWith("tester");
  if (workType === "review") return role === "reviewer" || owner.startsWith("reviewer");
  if (workType === "research") return role === "researcher" || owner.startsWith("researcher");
  return false;
}

function expectedRoleForWorkType(workType: IssueWorkType): string {
  return ({
    product: "pm",
    design: "designer",
    implementation: "coder",
    test: "tester",
    review: "reviewer",
    research: "researcher",
  } satisfies Record<IssueWorkType, string>)[workType];
}

export function startTask(root: string, actor: string, issueId: string, note?: string | null): CompanyState {
  requireIssueOwner(root, actor, issueId, "start");
  return recordEvent(root, makeEvent("task.started", actor, {
    issue_id: issueId,
    note: note ?? null,
  }));
}

export function reportTask(root: string, actor: string, issueId: string, note: string): CompanyState {
  requireIssueOwner(root, actor, issueId, "report on");
  return recordEvent(root, makeEvent("task.reported", actor, {
    issue_id: issueId,
    note,
  }));
}

export function blockTask(root: string, actor: string, issueId: string, reason: string): CompanyState {
  requireIssueOwner(root, actor, issueId, "block");
  return recordEvent(root, makeEvent("task.blocked", actor, {
    issue_id: issueId,
    reason,
  }));
}

export function completeTask(root: string, actor: string, issueId: string, summary: string): CompanyState {
  const state = loadState(root);
  const issue = requireIssueOwnerFromState(state, actor, issueId, "complete", true);
  if (issue.status === "done") return loadState(root);
  if (issueHasUnmergedPr(state, issueId)) {
    throw new Error(`Issue ${issueId} has an unmerged PR. It can be marked done only after lead merges the PR.`);
  }
  return recordEvent(root, makeEvent("task.completed", actor, {
    issue_id: issueId,
    summary,
  }));
}

export function planAgentSpawn(root: string, role: AgentRole, name: string, mission?: string | null): {
  name: string;
  role: AgentRole;
  cwd: string;
  worktree: string | null;
  branch: string | null;
  mission: string | null;
} {
  const config = loadConfig(root);
  const projectId = config?.id ?? slug(path.basename(root));
  const isCoder = role === "coder";
  const branch = isCoder ? `pi-company/${slug(name)}` : null;
  const worktree = isCoder ? defaultCoderWorktree(root, name) : null;
  return {
    name,
    role,
    cwd: worktree ?? root,
    worktree,
    branch,
    mission: mission ?? `${role} for ${projectId}`,
  };
}

export function requestAgentSpawn(root: string, actor: string, role: AgentRole, name: string, mission?: string | null): ReturnType<typeof planAgentSpawn> {
  requireLead(root, actor, "spawn agents");
  if (loadState(root).agents[name]) {
    throw new Error(`Agent ${name} already exists. Use launch-command to start existing agents.`);
  }
  const plan = planAgentSpawn(root, role, name, mission);
  recordEvent(root, makeEvent("agent.spawn_requested", actor, plan));
  return plan;
}

export function ensureCoderWorktree(root: string, plan: { worktree: string | null; branch: string | null }, yes = false): void {
  if (!plan.worktree || !plan.branch) return;
  if (fs.existsSync(plan.worktree)) {
    const branch = spawnSync("git", ["-C", plan.worktree, "branch", "--show-current"], { encoding: "utf8" });
    const actual = branch.stdout.trim();
    if (actual !== plan.branch) {
      throw new Error(`Existing worktree ${plan.worktree} is on branch ${actual}, expected ${plan.branch}`);
    }
    return;
  }
  if (!yes) {
    throw new Error(`Refusing to create worktree without confirmation. Re-run with --yes.\nWould run: git worktree add ${plan.worktree} -b ${plan.branch}`);
  }
  ensureGitHeadForWorktree(root);
  const branchExists = gitRefExists(root, plan.branch);
  const baseRef = resolveGitHead(root, "main") ? "main" : "HEAD";
  const args = branchExists
    ? ["-C", root, "worktree", "add", plan.worktree, plan.branch]
    : ["-C", root, "worktree", "add", plan.worktree, "-b", plan.branch, baseRef];
  const result = spawnSync("git", args, {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "git worktree add failed");
  }
}

function ensureGitHeadForWorktree(root: string): void {
  if (resolveGitHead(root, "HEAD")) return;
  const gitDir = spawnSync("git", ["-C", root, "rev-parse", "--git-dir"], { encoding: "utf8" });
  if (gitDir.status !== 0) {
    const init = spawnSync("git", ["-C", root, "init", "-b", "main"], { encoding: "utf8" });
    if (init.status !== 0) {
      throw new Error(init.stderr || init.stdout || "git init failed while preparing initial worktree baseline");
    }
  }

  ensureCompanyGitignore(root);
  const add = spawnSync("git", ["-C", root, "add", ".gitignore"], { encoding: "utf8" });
  if (add.status !== 0) {
    throw new Error(add.stderr || add.stdout || "git add .gitignore failed while preparing initial worktree baseline");
  }
  const commit = spawnSync("git", [
    "-C",
    root,
    "-c",
    "user.name=pi-company",
    "-c",
    "user.email=pi-company@example.local",
    "commit",
    "-m",
    "Initialize pi-company workspace",
    "--",
    ".gitignore",
  ], { encoding: "utf8" });
  if (commit.status !== 0) {
    throw new Error(commit.stderr || commit.stdout || "git commit failed while preparing initial worktree baseline");
  }
}

export function createPr(root: string, actor: string, params: {
  title: string;
  issue_id?: string | null;
  summary: string;
  branch: string;
  worktree: string;
  base?: string;
}): PullRequestRecord {
  const paths = companyPaths(root);
  const state = loadState(root);
  const author = state.agents[actor];
  if (!author) throw new Error(`Unknown PR author ${actor}. Spawn or register the agent before creating PRs.`);
  if (author.role !== "coder") {
    throw new Error(`Only coder agents can create PRs. ${actor} has role ${author.role}.`);
  }
  if (params.issue_id) requirePrIssueOwner(state, actor, params.issue_id);
  const id = `PR-${String(Object.keys(state.prs).length + 1).padStart(3, "0")}`;
  const now = nowIso();
  const branch = normalizePrBranch(root, actor, params.branch, state.agents[actor]?.branch ?? null);
  if (author.branch && branch !== author.branch) {
    throw new Error(`PR branch ${branch} does not match ${actor}'s registered branch ${author.branch}.`);
  }
  if (author.worktree && path.resolve(params.worktree) !== path.resolve(author.worktree)) {
    throw new Error(`PR worktree ${path.resolve(params.worktree)} does not match ${actor}'s registered worktree ${path.resolve(author.worktree)}.`);
  }
  const head = resolveGitHead(root, branch);
  const baseHead = resolveGitHead(root, params.base ?? "main");
  const pr: PullRequestRecord = {
    id,
    title: params.title,
    issue_id: params.issue_id ?? null,
    author: actor,
    branch,
    head,
    base_head: baseHead,
    mergeable: checkPrMergeability(root, params.base ?? "main", branch),
    worktree: params.worktree,
    base: params.base ?? "main",
    status: "draft",
    summary: params.summary,
    self_test: null,
    test_brief: null,
    ready_head: null,
    reviews: [],
    tests: [],
    acceptances: [],
    automated_tests: null,
    automated_test_history: [],
    created_at: now,
    updated_at: now,
  };
  atomicWriteText(prPath(paths, id), renderPr(pr));
  recordEvent(root, makeEvent("pr.created", actor, { pr }));
  return pr;
}

export function abandonPr(root: string, actor: string, prId: string, reason: string, supersededBy?: string | null): CompanyState {
  const state = loadState(root);
  const pr = state.prs[prId];
  if (!pr) throw new Error(`Unknown PR ${prId}`);
  if (pr.status === "merged") throw new Error(`Cannot abandon ${prId}; it is already merged.`);
  if (pr.status === "abandoned") return state;
  const lead = state.config?.lead ?? "lead";
  if (actor !== lead && actor !== pr.author) {
    throw new Error(`Only ${lead} or ${pr.author} can abandon ${prId}.`);
  }
  return recordEvent(root, makeEvent("pr.abandoned", actor, {
    pr_id: prId,
    reason,
    superseded_by: supersededBy ?? null,
  }));
}

export function adoptIntegratedPr(root: string, actor: string, params: {
  title: string;
  author: string;
  issue_id?: string | null;
  summary: string;
  branch: string;
  base?: string;
}): PullRequestRecord {
  const paths = companyPaths(root);
  const state = loadState(root);
  const author = state.agents[params.author];
  if (!author) throw new Error(`Unknown PR author ${params.author}. Spawn or register the agent before creating PRs.`);
  if (author.role !== "coder") throw new Error(`Only coder agents can author PRs. ${params.author} has role ${author.role}.`);
  const lead = state.config?.lead ?? "lead";
  if (actor !== lead && actor !== params.author) {
    throw new Error(`Only ${lead} or ${params.author} can adopt an integrated PR.`);
  }
  if (params.issue_id) requirePrIssueOwner(state, params.author, params.issue_id);
  const base = params.base ?? "main";
  const baseHead = resolveGitHead(root, base);
  if (!baseHead) throw new Error(`Base branch ${base} does not resolve to a git commit.`);
  const branch = params.branch.trim();
  if (!branch) throw new Error("Adopted PR branch is required.");
  if (branch === base) throw new Error("Adopted PR branch must differ from base branch.");
  if (gitRefExists(root, branch)) {
    const branchHead = resolveGitHead(root, branch);
    if (branchHead !== baseHead) {
      throw new Error(`Branch ${branch} already exists at ${shortHead(branchHead)}, expected current ${base} ${shortHead(baseHead)}.`);
    }
  } else {
    const created = spawnSync("git", ["-C", root, "branch", branch, baseHead], { encoding: "utf8" });
    if (created.status !== 0) throw new Error(created.stderr || created.stdout || `git branch ${branch} failed`);
  }
  const id = `PR-${String(Object.keys(state.prs).length + 1).padStart(3, "0")}`;
  const now = nowIso();
  const pr: PullRequestRecord = {
    id,
    title: params.title,
    issue_id: params.issue_id ?? null,
    author: params.author,
    branch,
    head: baseHead,
    base_head: baseHead,
    mergeable: checkPrMergeability(root, base, branch),
    worktree: "",
    base,
    status: "draft",
    summary: params.summary,
    self_test: null,
    test_brief: null,
    ready_head: null,
    reviews: [],
    tests: [],
    acceptances: [],
    automated_tests: null,
    automated_test_history: [],
    created_at: now,
    updated_at: now,
    adopted_from_base: true,
  };
  atomicWriteText(prPath(paths, id), renderPr(pr));
  recordEvent(root, makeEvent("pr.created", params.author, { pr, adopted_by: actor }));
  return pr;
}

function requirePrIssueOwner(state: CompanyState, actor: string, issueId: string): void {
  const issue = state.issues[issueId];
  if (!issue) throw new Error(`Unknown PR issue ${issueId}.`);
  if (!issue.owner) throw new Error(`Issue ${issueId} is unassigned.`);
  if (issue.owner !== actor) throw new Error(`Only ${issue.owner} can create PRs for ${issueId}.`);
  if (issue.status === "done") throw new Error(`Issue ${issueId} is already done.`);
}

export function normalizePrBranch(root: string, actor: string, requestedBranch: string, agentBranch?: string | null): string {
  const requested = requestedBranch.trim();
  if (!agentBranch) return requested;
  if (requested === agentBranch) return requested;
  if (requested === actor || requested === slug(actor)) return agentBranch;
  if (gitRefExists(root, requested)) return requested;
  if (gitRefExists(root, agentBranch)) return agentBranch;
  return requested;
}

function gitRefExists(root: string, ref: string): boolean {
  if (!ref) return false;
  const result = spawnSync("git", ["-C", root, "rev-parse", "--verify", ref], {
    encoding: "utf8",
  });
  return result.status === 0;
}

export function resolveGitHead(root: string, ref: string): string | null {
  if (!ref) return null;
  const result = spawnSync("git", ["-C", root, "rev-parse", "--verify", `${ref}^{commit}`], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

export function checkPrMergeability(root: string, base: string, branch: string): MergeabilityRecord | null {
  if (!resolveGitHead(root, base) || !resolveGitHead(root, branch)) return null;
  const result = spawnSync("git", ["-C", root, "merge-tree", "--write-tree", base, branch], {
    encoding: "utf8",
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (result.status === 0) {
    return {
      status: "clean",
      summary: "merge-tree completed cleanly",
      checked_at: nowIso(),
    };
  }
  if (/CONFLICT|changed in both|Auto-merging/i.test(output)) {
    return {
      status: "conflict",
      summary: output.split("\n").filter(Boolean).slice(-3).join("\n") || "merge-tree reported conflicts",
      checked_at: nowIso(),
    };
  }
  return {
    status: "unknown",
    summary: output || "merge-tree could not verify mergeability",
    checked_at: nowIso(),
  };
}

function refreshPrGitState(root: string, state: CompanyState): void {
  for (const pr of Object.values(state.prs)) {
    if (pr.status === "merged" || pr.status === "abandoned") continue;
    pr.head = resolveGitHead(root, pr.branch) ?? pr.head ?? null;
    pr.base_head = resolveGitHead(root, pr.base) ?? pr.base_head ?? null;
    pr.mergeable = checkPrMergeability(root, pr.base, pr.branch) ?? pr.mergeable ?? null;
  }
}

function refreshPrStatuses(root: string, state: CompanyState): void {
  for (const pr of Object.values(state.prs)) {
    if (pr.status === "merged" || pr.status === "abandoned") continue;
    if (
      pr.merge_requested_at &&
      evaluatePrGates(state.config, pr, state.agents).ready &&
      branchIsAncestor(root, pr.branch, pr.base)
    ) {
      markPrIntegrated(state, pr, pr.merge_requested_at);
      continue;
    }
    if (pr.merge_blockers?.length) {
      pr.status = "blocked";
      continue;
    }
    const gate = evaluatePrGates(state.config, pr, state.agents);
    if (gate.ready) pr.status = "ready_to_merge";
    else if (gate.blockers.length > 0 && pr.status !== "draft") {
      pr.status = statusForGateBlockers(gate.blockers);
    }
  }
}

function statusForGateBlockers(blockers: string[]): PullRequestRecord["status"] {
  return blockers.some(isChangeRequestGateBlocker) ? "changes_requested" : "blocked";
}

function isChangeRequestGateBlocker(blocker: string): boolean {
  return blocker === "Latest review requests changes" || blocker === "Product acceptance is request_changes";
}

function branchIsAncestor(root: string, branch: string, base: string): boolean {
  if (!resolveGitHead(root, branch) || !resolveGitHead(root, base)) return false;
  const result = spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", branch, base], {
    encoding: "utf8",
  });
  return result.status === 0;
}

function rootWorktreeStatus(root: string): string[] {
  const result = spawnSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function issueAssignmentBoundaryFindings(state: CompanyState): string[] {
  return Object.values(state.issues)
    .filter((issue) => issue.status !== "done" && issue.owner && issue.work_type)
    .flatMap((issue) => {
      const owner = issue.owner ?? "";
      const agent = state.agents[owner];
      if (agent && issueOwnerCanOwnWorkType(agent.role, owner, issue.work_type as IssueWorkType)) return [];
      return [`${issue.id} is ${issue.work_type} work but is assigned to ${owner || "nobody"}; reassign it to ${expectedRoleForWorkType(issue.work_type as IssueWorkType)}`];
    });
}

function rootDeliverableBoundaryFindings(root: string): string[] {
  const git = spawnSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (git.status === 0) return [];
  const deliverables = rootDeliverableFiles(root);
  if (deliverables.length === 0) return [];
  return [`project root has runnable deliverables outside git/worktree PR flow: ${deliverables.slice(0, 8).join(", ")}`];
}

function rootDeliverableFiles(root: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.name !== ".pi-company" && entry.name !== ".git")
    .filter((entry) => {
      if (entry.isDirectory()) return ["src", "app", "pages", "components", "server", "client", "public", "assets"].includes(entry.name);
      if (!entry.isFile()) return false;
      return /\.(html|css|js|jsx|ts|tsx|vue|svelte|astro|json|mjs|cjs)$/i.test(entry.name) ||
        /^(package|vite\.config|next\.config|nuxt\.config|webpack\.config|rollup\.config|tsconfig)\b/i.test(entry.name);
    })
    .map((entry) => entry.name)
    .sort();
}

function buildLeadBriefNextActions(
  incompleteIssues: IssueRecord[],
  agents: Record<string, AgentRecord>,
  nonMergedPrs: LeadBriefPr[],
  blockedPrs: LeadBriefPr[],
  dirtyPrs: LeadBriefPr[],
  rootWorktreeChanges: string[],
  roleBoundaryFindings: string[] = [],
): string[] {
  const actions: string[] = [];
  for (const finding of roleBoundaryFindings) {
    actions.push(`Fix role boundary violation: ${finding}`);
  }
  for (const pr of blockedPrs) {
    const blockers = pr.blockers.join("; ") || pr.status;
    if (pr.blockers.some(isCaveatedGateBlocker)) {
      actions.push(`${pr.id}: caveated gate evidence blocks delivery (${blockers}); assign ${pr.author} to resolve it and collect fresh clean review/test/acceptance, or ask the human for an explicit risk waiver. Do not describe this as complete, usable, or only a minor suggestion.`);
    } else {
      actions.push(`${pr.id}: resolve gates before announcing completion (${blockers})`);
    }
  }
  for (const pr of nonMergedPrs.filter((pr) => pr.ready && pr.blockers.length === 0)) {
    actions.push(`${pr.id}: gates are green; lead should merge when the root worktree is clean`);
  }
  if (rootWorktreeChanges.length > 0) {
    actions.push("Resolve tracked, staged, or untracked project-root changes before final delivery");
  }
  for (const pr of dirtyPrs) {
    actions.push(`${pr.id}: ask ${pr.author} to commit or revert PR worktree changes deliberately`);
  }
  for (const issue of incompleteIssues.filter((issue) => !nonMergedPrs.some((pr) => pr.issue_id === issue.id))) {
    const owner = issue.owner ?? null;
    if (owner && agents[owner]?.status === "offline") {
      actions.push(`${issue.id}: relaunch ${owner} before continuing; its last cmux surface is gone or heartbeat is stale`);
    } else {
      actions.push(`${issue.id}: continue assigned work with ${owner ?? "an owner"}`);
    }
  }
  return actions;
}

function isCaveatedGateBlocker(blocker: string): boolean {
  return /\bcontains caveat\b/i.test(blocker);
}

function compareIds(left: { id: string }, right: { id: string }): number {
  return numericSuffix(left.id) - numericSuffix(right.id) || left.id.localeCompare(right.id);
}

function numericSuffix(id: string): number {
  const match = id.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function markPrIntegrated(state: CompanyState, pr: PullRequestRecord, ts: string): void {
  pr.status = "merged";
  pr.merge_blockers = null;
  pr.merge_blocked_at = null;
  pr.merged_at = pr.merged_at ?? ts;
  pr.updated_at = ts;
  if (pr.issue_id && state.issues[pr.issue_id]) {
    state.issues[pr.issue_id].status = "done";
    state.issues[pr.issue_id].updated_at = ts;
    const owner = state.issues[pr.issue_id].owner;
    if (owner && state.agents[owner]?.current_task === pr.issue_id) {
      state.agents[owner].current_task = null;
      if (state.agents[owner].status === "running") state.agents[owner].status = "idle";
    }
  }
}

function refreshAgentLiveness(state: CompanyState, now = nowIso()): void {
  const liveCmuxSurfaces = currentCmuxSurfacesIfNeeded(state);
  const current = Date.parse(now);
  if (!Number.isFinite(current)) return;
  for (const agent of Object.values(state.agents)) {
    if (agent.cmux_surface && liveCmuxSurfaces && !liveCmuxSurfaces.has(agent.cmux_surface)) {
      agent.status = "offline";
      agent.current_task = null;
      continue;
    }
    if (agent.status === "planned" || agent.status === "offline") continue;
    const lastSeen = agent.last_seen_at ? Date.parse(agent.last_seen_at) : Number.NaN;
    if (!Number.isFinite(lastSeen)) continue;
    if (current - lastSeen > AGENT_STALE_MS) {
      agent.status = "offline";
      agent.current_task = null;
    }
  }
}

function currentCmuxSurfacesIfNeeded(state: CompanyState): Set<string> | null {
  if (!Object.values(state.agents).some((agent) => agent.cmux_surface)) return null;
  const result = runCmuxTreeJson();
  if (result.status !== 0 || !result.stdout.trim()) return null;
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    const surfaces = new Set<string>();
    collectCmuxSurfaceRefs(parsed, surfaces);
    return surfaces;
  } catch {
    return null;
  }
}

function runCmuxTreeJson(): { status: number; stdout: string; stderr: string } {
  const candidates = ["cmux", "/Applications/cmux.app/Contents/Resources/bin/cmux"];
  let last = { status: 127, stdout: "", stderr: "cmux not found" };
  for (const command of candidates) {
    const result = spawnSync(command, ["tree", "--json"], { encoding: "utf8" });
    if (result.error && "code" in result.error && result.error.code === "ENOENT") {
      last = { status: 127, stdout: "", stderr: result.error.message };
      continue;
    }
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }
  return last;
}

function collectCmuxSurfaceRefs(value: unknown, surfaces: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectCmuxSurfaceRefs(item, surfaces);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const ref = record.ref;
  const type = record.type;
  if (typeof ref === "string" && ref.startsWith("surface:") && (type === undefined || typeof type === "string")) {
    surfaces.add(ref);
  }
  for (const item of Object.values(record)) collectCmuxSurfaceRefs(item, surfaces);
}

export function markPrReady(root: string, actor: string, prId: string, selfTest: string, testBrief: string): CompanyState {
  const state = loadState(root);
  const pr = state.prs[prId];
  if (!pr) throw new Error(`Unknown PR ${prId}`);
  requirePrNotMerged(pr, "mark ready");
  if (selfTest.trim().length === 0) throw new Error(`Missing self-test evidence for ${prId}.`);
  if (testBrief.trim().length === 0) throw new Error(`Missing test brief for ${prId}.`);
  if (actor !== pr.author) throw new Error(`Only ${pr.author} can mark ${prId} ready.`);
  assertCleanPrWorktreeForEvidence(pr, "mark ready");
  const readyState = recordEvent(root, makeEvent("pr.ready", actor, {
    pr_id: prId,
    self_test: selfTest,
    test_brief: testBrief,
    head: pr ? resolveGitHead(root, pr.branch) : null,
  }));
  const lead = readyState.config?.lead ?? "lead";
  if (actor !== lead && readyState.agents[lead]) {
    sendCompanyMessage(root, {
      from: actor,
      to: lead,
      type: "report",
      task: prId,
      priority: "high",
      text: `${prId} marked ready by ${actor}. Assign reviewer/tester and check gates.`,
    });
  }
  return loadState(root);
}

export function submitReview(root: string, actor: string, prId: string, decision: "approve" | "request_changes" | "comment", summary: string): CompanyState {
  const state = loadState(root);
  const pr = state.prs[prId];
  if (!pr) throw new Error(`Unknown PR ${prId}`);
  requirePrNotMerged(pr, "review");
  if (!isReviewDecision(decision)) throw new Error(`Invalid review decision ${String(decision)}.`);
  requireAgentRole(state, actor, "reviewer", "submit reviews");
  if (actor === pr.author) throw new Error(`PR author ${actor} cannot review their own PR.`);
  if (decision === "approve") assertCleanPrWorktreeForEvidence(pr, "approve");
  const next = recordEvent(root, makeEvent("review.submitted", actor, {
    pr_id: prId,
    decision,
    summary,
    head: pr ? resolveGitHead(root, pr.branch) : null,
  }));
  notifyLeadOfPrGate(root, next, actor, prId, `Review ${decision} submitted by ${actor} for ${prId}. Check gates and route fixes or acceptance.`);
  return loadState(root);
}

export function submitTest(root: string, actor: string, prId: string, status: "pass" | "fail" | "blocked", summary: string): CompanyState {
  const state = loadState(root);
  const pr = state.prs[prId];
  if (!pr) throw new Error(`Unknown PR ${prId}`);
  requirePrNotMerged(pr, "test");
  if (!isTestStatus(status)) throw new Error(`Invalid test status ${String(status)}.`);
  requireAgentRole(state, actor, "tester", "submit tests");
  if (actor === pr.author) throw new Error(`PR author ${actor} cannot test their own PR.`);
  if (status === "pass") assertCleanPrWorktreeForEvidence(pr, "pass");
  const next = recordEvent(root, makeEvent("test.submitted", actor, {
    pr_id: prId,
    status,
    summary,
    head: pr ? resolveGitHead(root, pr.branch) : null,
  }));
  notifyLeadOfPrGate(root, next, actor, prId, `Tester status ${status} submitted by ${actor} for ${prId}. Check gates and route fixes or acceptance.`);
  return loadState(root);
}

export function submitAcceptance(root: string, actor: string, prId: string, decision: "accept" | "request_changes" | "comment", summary: string): CompanyState {
  const state = loadState(root);
  const pr = state.prs[prId];
  if (!pr) throw new Error(`Unknown PR ${prId}`);
  requirePrNotMerged(pr, "accept");
  if (!isAcceptanceDecision(decision)) throw new Error(`Invalid acceptance decision ${String(decision)}.`);
  const lead = state.config?.lead ?? "lead";
  const actorRole = state.agents[actor]?.role;
  if (actor !== lead && actorRole !== "pm") {
    if (!state.agents[actor]) throw new Error(`Unknown acceptance actor ${actor}.`);
    throw new Error(`Only ${lead} or pm agents can accept product behavior. ${actor} has role ${actorRole ?? "unknown"}.`);
  }
  if (actor === pr.author) throw new Error(`PR author ${actor} cannot accept their own PR.`);
  if (decision === "accept") assertCleanPrWorktreeForEvidence(pr, "accept");
  const next = recordEvent(root, makeEvent("acceptance.submitted", actor, {
    pr_id: prId,
    decision,
    summary,
    head: pr ? resolveGitHead(root, pr.branch) : null,
  }));
  notifyLeadOfPrGate(root, next, actor, prId, `Product acceptance ${decision} submitted by ${actor} for ${prId}. Check gates and merge readiness.`);
  return loadState(root);
}

export function recordAutomatedTests(root: string, actor: string, prId: string, status: "passed" | "failed" | "blocked", summary: string, command?: string | null): CompanyState {
  const state = loadState(root);
  const pr = state.prs[prId];
  if (!pr) throw new Error(`Unknown PR ${prId}`);
  requirePrNotMerged(pr, "record automated tests for");
  if (!isAutomatedTestStatus(status)) throw new Error(`Invalid automated test status ${String(status)}.`);
  const actorRole = state.agents[actor]?.role;
  if (actor !== "system" && actor !== pr.author && actorRole !== "tester") {
    if (!state.agents[actor]) throw new Error(`Unknown automated test actor ${actor}.`);
    throw new Error(`Only ${pr.author}, tester agents, or system can record automated tests for ${prId}.`);
  }
  if (status === "passed") assertCleanPrWorktreeForEvidence(pr, "record passing automated tests");
  const next = recordEvent(root, makeEvent("pr.automated_tests", actor, {
    pr_id: prId,
    status,
    summary,
    command: command ?? null,
    head: pr ? resolveGitHead(root, pr.branch) : null,
  }));
  notifyLeadOfPrGate(root, next, actor, prId, `Automated tests ${status} recorded by ${actor} for ${prId}. Check gates and route fixes or acceptance.`);
  return loadState(root);
}

function notifyLeadOfPrGate(root: string, state: CompanyState, actor: string, prId: string, text: string): void {
  const lead = state.config?.lead ?? "lead";
  if (actor === lead || !state.agents[lead]) return;
  sendCompanyMessage(root, {
    from: actor,
    to: lead,
    type: "report",
    task: prId,
    priority: "high",
    text,
  }, {
    bypassTargetCooldown: true,
  });
}

function requirePrNotMerged(pr: PullRequestRecord, action: string): void {
  if (pr.status === "merged") throw new Error(`Cannot ${action} ${pr.id}; it is already merged.`);
  if (pr.status === "abandoned") throw new Error(`Cannot ${action} ${pr.id}; it is abandoned.`);
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

function isAutomatedTestStatus(value: unknown): value is "passed" | "failed" | "blocked" {
  return value === "passed" || value === "failed" || value === "blocked";
}

function isRateLimitKind(value: unknown): value is RateLimitKind {
  return value === "provider_429" || value === "quota_exhausted" || value === "manual";
}

function issueHasUnmergedPr(state: CompanyState, issueId: string): boolean {
  return Object.values(state.prs).some((pr) => pr.issue_id === issueId && pr.status !== "merged" && pr.status !== "abandoned");
}

function assertCleanPrWorktreeForEvidence(pr: PullRequestRecord, action: string): void {
  const status = prWorktreeStatus(pr);
  if (!status) return;
  if (status.branch && status.branch !== pr.branch) {
    throw new Error(`Cannot ${action} ${pr.id}; worktree is on branch ${status.branch}, expected ${pr.branch}.`);
  }
  if (status.dirty.length > 0) {
    throw new Error(`Cannot ${action} ${pr.id}; PR worktree has uncommitted changes:\n${status.dirty.slice(0, 20).join("\n")}`);
  }
}

function prWorktreeStatus(pr: PullRequestRecord): { branch: string | null; dirty: string[] } | null {
  if (!pr.worktree || !fs.existsSync(pr.worktree)) return null;
  const status = spawnSync("git", ["-C", pr.worktree, "status", "--porcelain", "--untracked-files=all"], {
    encoding: "utf8",
  });
  if (status.status !== 0) return null;
  const branch = spawnSync("git", ["-C", pr.worktree, "branch", "--show-current"], {
    encoding: "utf8",
  });
  return {
    branch: branch.status === 0 ? branch.stdout.trim() || null : null,
    dirty: status.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0),
  };
}

export function getPrGateStatus(root: string, prId: string): { ready: boolean; blockers: string[] } {
  const state = loadState(root);
  const pr = state.prs[prId];
  if (!pr) throw new Error(`Unknown PR ${prId}`);
  return evaluatePrGates(state.config, pr, state.agents);
}

export function buildLeadBrief(root: string): LeadBrief {
  const state = loadState(root);
  const incompleteIssues = Object.values(state.issues)
    .filter((issue) => issue.status !== "done")
    .sort(compareIds);
  const prs = Object.values(state.prs)
    .sort(compareIds)
    .map((pr): LeadBriefPr => {
      const gates = pr.status === "merged"
        ? { ready: true, blockers: [] }
        : evaluatePrGates(state.config, pr, state.agents);
      const worktree = prWorktreeStatus(pr);
      return {
        id: pr.id,
        title: pr.title,
        status: pr.status,
        issue_id: pr.issue_id ?? null,
        author: pr.author,
        branch: pr.branch,
        head: pr.head ?? null,
        ready: gates.ready,
        blockers: gates.blockers,
        merge_requested_at: pr.merge_requested_at ?? null,
        branch_integrated_in_base: branchIsAncestor(root, pr.branch, pr.base),
        worktree_dirty: worktree?.dirty ?? [],
        superseded_by: pr.superseded_by ?? null,
        evidence: buildPrEvidence(state.config, pr, state.agents),
      };
    });
  const nonMergedPrs = prs.filter((pr) => pr.status !== "merged" && pr.status !== "abandoned");
  const dirtyPrs = prs.filter((pr) => pr.status !== "abandoned" && pr.worktree_dirty.length > 0);
  const rootWorktreeChanges = rootWorktreeStatus(root);
  const roleBoundaryFindings = [
    ...issueAssignmentBoundaryFindings(state),
    ...rootDeliverableBoundaryFindings(root),
  ];
  const reasons: string[] = [];

  if (incompleteIssues.length > 0) {
    reasons.push(`${incompleteIssues.length} issue(s) are not done`);
  }
  if (nonMergedPrs.length > 0) {
    reasons.push(`${nonMergedPrs.length} PR(s) are not merged`);
  }
  if (rootWorktreeChanges.length > 0) {
    reasons.push("project root has tracked, staged, or untracked changes");
  }
  if (dirtyPrs.length > 0) {
    reasons.push(`${dirtyPrs.length} PR worktree(s) have uncommitted changes`);
  }
  reasons.push(...roleBoundaryFindings);

  const blockedPrs = nonMergedPrs.filter((pr) => pr.blockers.length > 0);
  const canClaimComplete = reasons.length === 0;
  const nextActions = buildLeadBriefNextActions(incompleteIssues, state.agents, nonMergedPrs, blockedPrs, dirtyPrs, rootWorktreeChanges, roleBoundaryFindings);

  return {
    company: state.config?.id ?? "not initialized",
    updated_at: state.updated_at,
    delivery_state: canClaimComplete ? "complete" : blockedPrs.length > 0 || dirtyPrs.length > 0 || rootWorktreeChanges.length > 0 || roleBoundaryFindings.length > 0 ? "blocked" : "in_progress",
    can_claim_complete: canClaimComplete,
    reasons_not_complete: reasons,
    incomplete_issues: incompleteIssues,
    prs,
    root_worktree_changes: rootWorktreeChanges,
    next_actions: nextActions,
  };
}

function buildPrEvidence(
  config: CompanyConfig | null,
  pr: PullRequestRecord,
  agents: Record<string, AgentRecord>,
): LeadBriefPrEvidence {
  const currentHead = pr.head ?? null;
  const currentReviews = currentHead ? pr.reviews.filter((review) => review.head === currentHead) : pr.reviews;
  const currentTests = currentHead ? pr.tests.filter((test) => test.head === currentHead) : pr.tests;
  const currentAcceptances = currentHead ? (pr.acceptances ?? []).filter((acceptance) => acceptance.head === currentHead) : pr.acceptances ?? [];
  const reviews = latestReviewPerReviewer(currentReviews.filter((review) =>
    review.reviewer !== pr.author && agents[review.reviewer]?.role === "reviewer"
  ));
  const tests = currentTests.filter((test) =>
    test.tester !== pr.author && agents[test.tester]?.role === "tester"
  );
  const acceptances = latestAcceptancePerAccepter(currentAcceptances.filter((acceptance) =>
    acceptance.accepter !== pr.author && productAcceptanceActorIsValidForAgents(config, agents, acceptance.accepter)
  ));
  const latestReview = reviews.at(-1) ?? null;
  const latestTest = tests.at(-1) ?? null;
  const latestAcceptance = acceptances.at(-1) ?? null;

  return {
    coder_ready: describeReadyEvidence(pr, currentHead),
    automated_tests: describeAutomatedEvidence(pr.automated_tests ?? null, currentHead),
    review: describeReviewEvidence(latestReview, currentHead),
    tester: describeTestEvidence(latestTest, currentHead),
    acceptance: describeAcceptanceEvidence(latestAcceptance, currentHead),
    recent_risks: recentPrRisks(pr),
  };
}

function latestReviewPerReviewer(reviews: ReviewRecord[]): ReviewRecord[] {
  const latest = new Map<string, ReviewRecord>();
  for (const review of reviews) latest.set(review.reviewer, review);
  return reviews.filter((review) => latest.get(review.reviewer) === review);
}

function latestAcceptancePerAccepter(acceptances: AcceptanceRecord[]): AcceptanceRecord[] {
  const latest = new Map<string, AcceptanceRecord>();
  for (const acceptance of acceptances) latest.set(acceptance.accepter, acceptance);
  return acceptances.filter((acceptance) => latest.get(acceptance.accepter) === acceptance);
}

function productAcceptanceActorIsValidForAgents(
  config: CompanyConfig | null,
  agents: Record<string, AgentRecord>,
  actor: string,
): boolean {
  return actor === (config?.lead ?? "lead") || agents[actor]?.role === "pm";
}

function describeReadyEvidence(pr: PullRequestRecord, currentHead: string | null): string {
  if (!pr.self_test || !pr.test_brief) return "missing coder self-test or tester brief";
  if (currentHead && pr.ready_head !== currentHead) {
    return `stale ready evidence at ${shortHead(pr.ready_head)}, current ${shortHead(currentHead)}`;
  }
  return `ready evidence current at ${shortHead(pr.ready_head ?? currentHead)}`;
}

function describeAutomatedEvidence(record: AutomatedTestRecord | null, currentHead: string | null): string {
  if (!record) return "missing";
  const stale = currentHead && record.head !== currentHead ? ` stale at ${shortHead(record.head)}, current ${shortHead(currentHead)}` : "";
  const caveat = record.status === "passed" && hasGateCaveat(record.summary) ? " caveat=true" : "";
  return `${record.status}${stale}${caveat}${record.command ? ` (${record.command})` : ""}: ${snippet(record.summary)}`;
}

function describeReviewEvidence(record: ReviewRecord | null, currentHead: string | null): string {
  if (!record) return currentHead ? `missing for current head ${shortHead(currentHead)}` : "missing";
  const caveat = record.decision === "approve" && hasGateCaveat(record.summary) ? " caveat=true" : "";
  return `${record.decision} by ${record.reviewer}${caveat}: ${snippet(record.summary)}`;
}

function describeTestEvidence(record: TestRecord | null, currentHead: string | null): string {
  if (!record) return currentHead ? `missing for current head ${shortHead(currentHead)}` : "missing";
  const caveat = record.status === "pass" && hasGateCaveat(record.summary) ? " caveat=true" : "";
  return `${record.status} by ${record.tester}${caveat}: ${snippet(record.summary)}`;
}

function describeAcceptanceEvidence(record: AcceptanceRecord | null, currentHead: string | null): string {
  if (!record) return currentHead ? `missing for current head ${shortHead(currentHead)}` : "missing";
  const caveat = record.decision === "accept" && hasGateCaveat(record.summary) ? " caveat=true" : "";
  return `${record.decision} by ${record.accepter}${caveat}: ${snippet(record.summary)}`;
}

function recentPrRisks(pr: PullRequestRecord): string[] {
  const risks: Array<{ ts: string; text: string }> = [];
  for (const review of pr.reviews) {
    if (review.decision === "request_changes" || hasGateCaveat(review.summary)) {
      risks.push({
        ts: review.ts,
        text: `review ${review.decision} by ${review.reviewer} @${shortHead(review.head)}: ${snippet(review.summary)}`,
      });
    }
  }
  for (const test of pr.tests) {
    if (test.status !== "pass" || hasGateCaveat(test.summary)) {
      risks.push({
        ts: test.ts,
        text: `test ${test.status} by ${test.tester} @${shortHead(test.head)}: ${snippet(test.summary)}`,
      });
    }
  }
  for (const acceptance of pr.acceptances ?? []) {
    if (acceptance.decision !== "accept" || hasGateCaveat(acceptance.summary)) {
      risks.push({
        ts: acceptance.ts,
        text: `acceptance ${acceptance.decision} by ${acceptance.accepter} @${shortHead(acceptance.head)}: ${snippet(acceptance.summary)}`,
      });
    }
  }
  for (const test of pr.automated_test_history ?? []) {
    if (test.status !== "passed" || hasGateCaveat(test.summary)) {
      risks.push({
        ts: test.ts,
        text: `automated ${test.status} @${shortHead(test.head)}: ${snippet(test.summary)}`,
      });
    }
  }
  return risks
    .sort((left, right) => Date.parse(right.ts) - Date.parse(left.ts))
    .map((risk) => risk.text)
    .slice(0, 5);
}

function shortHead(head?: string | null): string {
  return head ? head.slice(0, 7) : "unknown";
}

function snippet(text: string, max = 120): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}...` : compact;
}

export function renderLeadBrief(brief: LeadBrief): string {
  const verdict = brief.can_claim_complete
    ? "COMPLETE - safe to say delivered"
    : `${brief.delivery_state.toUpperCase()} - do not say the project or feature is complete`;
  const reasons = brief.reasons_not_complete.length
    ? brief.reasons_not_complete.map((reason) => `- ${reason}`).join("\n")
    : "- none";
  const issues = brief.incomplete_issues.length
    ? brief.incomplete_issues.map((issue) => `- ${issue.id} ${issue.status}${issue.work_type ? ` ${issue.work_type}` : ""} ${issue.title}${issue.owner ? ` -> ${issue.owner}` : ""}`).join("\n")
    : "- none";
  const prs = brief.prs.length
    ? brief.prs.map((pr) => {
      const blockers = pr.status === "merged"
        ? "merged"
        : pr.status === "abandoned"
          ? `abandoned${pr.superseded_by ? ` superseded_by=${pr.superseded_by}` : ""}`
        : pr.blockers.length > 0
          ? `blocked: ${pr.blockers.join("; ")}`
          : pr.ready
            ? "ready to merge"
            : "not ready";
      const dirty = pr.worktree_dirty.length > 0 ? ` dirty_worktree=${pr.worktree_dirty.length}` : "";
      const integrated = pr.branch_integrated_in_base && pr.status !== "merged" ? " branch_integrated_unrecorded=true" : "";
      return `- ${pr.id} ${pr.status} ${blockers}${dirty}${integrated} ${pr.title}`;
    }).join("\n")
    : "- none";
  const rootChanges = brief.root_worktree_changes.length
    ? brief.root_worktree_changes.slice(0, 20).map((line) => `- ${line}`).join("\n")
    : "- none";
  const evidence = brief.prs.length
    ? brief.prs.map((pr) => {
      const risks = pr.evidence.recent_risks.length > 0
        ? `\n  recent risks:\n${pr.evidence.recent_risks.map((risk) => `  - ${risk}`).join("\n")}`
        : "";
      return `- ${pr.id} head=${shortHead(pr.head)}
  coder: ${pr.evidence.coder_ready}
  automated: ${pr.evidence.automated_tests}
  review: ${pr.evidence.review}
  tester: ${pr.evidence.tester}
  acceptance: ${pr.evidence.acceptance}${risks}`;
    }).join("\n")
    : "- none";
  const nextActions = brief.next_actions.length
    ? brief.next_actions.map((action) => `- ${action}`).join("\n")
    : "- none";

  return `Lead Brief: ${brief.company}
Updated: ${brief.updated_at ?? "never"}
Delivery State: ${verdict}

Reasons Not Complete:
${reasons}

Incomplete Issues:
${issues}

PR Truth:
${prs}

PR Evidence:
${evidence}

Root Worktree Changes:
${rootChanges}

Next Actions:
${nextActions}`;
}

export function pendingMergeRequests(state: CompanyState): PullRequestRecord[] {
  return Object.values(state.prs)
    .filter((pr) =>
      pr.status !== "merged" &&
      pr.status !== "abandoned" &&
      pr.status !== "blocked" &&
      Boolean(pr.merge_requested_at) &&
      evaluatePrGates(state.config, pr, state.agents).ready
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.merge_requested_at ?? "");
      const rightTime = Date.parse(right.merge_requested_at ?? "");
      return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
    });
}

export function ensurePendingMergeReminder(root: string, actor: string): MailboxMessage[] {
  const state = loadState(root);
  const lead = state.config?.lead ?? "lead";
  if (actor !== lead || !state.agents[lead]) return [];

  const existingMessages = listInbox(root, lead, true);
  const created: MailboxMessage[] = [];
  for (const pr of pendingMergeRequests(state)) {
    const alreadyReminded = existingMessages.some((message) =>
      message.to === lead &&
      message.type === "system" &&
      message.task === pr.id &&
      message.text.includes(PENDING_MERGE_REMINDER_PREFIX)
    );
    if (alreadyReminded) continue;
    const message = sendCompanyMessage(root, {
      from: "system",
      to: lead,
      type: "system",
      task: pr.id,
      priority: "high",
      text: `${PENDING_MERGE_REMINDER_PREFIX}

${pr.id} has passed gates and has a pending merge request since ${pr.merge_requested_at ?? "unknown"}.

Lead must either:
- execute company_merge_pr with execute_git true after confirming the root worktree is clean, or
- record/resolve the blocker if merge execution is unsafe.

Do not run raw git stash/reset/clean/revert or checkout-away commands in the project root just to make the merge pass.`,
    });
    created.push(message);
    existingMessages.push(message);
  }
  return created;
}

export function requestMerge(root: string, actor: string, prId: string): CompanyState {
  const state = loadState(root);
  if (!state.agents[actor]) throw new Error(`Unknown merge requester ${actor}.`);
  if (state.prs[prId]?.status === "merged") return state;
  if (state.prs[prId]?.status === "abandoned") return state;
  const gates = getPrGateStatus(root, prId);
  if (!gates.ready) {
    return recordEvent(root, makeEvent("merge.blocked", actor, {
      pr_id: prId,
      blockers: gates.blockers,
      source: "gates",
    }));
  }
  const requested = recordEvent(root, makeEvent("merge.requested", actor, { pr_id: prId }));
  const lead = requested.config?.lead ?? "lead";
  if (actor !== lead && requested.agents[lead]) ensurePendingMergeReminder(root, lead);
  return loadState(root);
}

export function mergePr(root: string, actor: string, prId: string, execute = false): CompanyState {
  const state = loadState(root);
  const pr = state.prs[prId];
  if (!pr) throw new Error(`Unknown PR ${prId}`);
  if (pr.status === "merged") return state;
  if (pr.status === "abandoned") throw new Error(`Cannot merge ${prId}; it is abandoned.`);
  if (!state.agents[actor]) throw new Error(`Unknown merge actor ${actor}.`);
  const lead = state.config?.lead ?? "lead";
  if (execute && actor !== lead) {
    throw new Error(`Only ${lead} can execute merges.`);
  }
  const gates = evaluatePrGates(state.config, pr, state.agents);
  if (!gates.ready) {
    recordEvent(root, makeEvent("merge.blocked", actor, {
      pr_id: prId,
      blockers: gates.blockers,
      source: "gates",
    }));
    throw new Error(`PR ${prId} is blocked:\n${gates.blockers.map((b) => `- ${b}`).join("\n")}`);
  }

  recordEvent(root, makeEvent("merge.requested", actor, { pr_id: prId }));
  if (!execute) return loadState(root);

  const status = spawnSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" });
  if (status.status !== 0) blockMergeAndThrow(root, actor, prId, status.stderr || status.stdout || "git status failed");
  if (status.stdout.trim().length > 0) {
    blockMergeAndThrow(root, actor, prId, "Refusing to merge with tracked or staged changes in the project root.");
  }

  const verify = spawnSync("git", ["-C", root, "rev-parse", "--verify", pr.branch], { encoding: "utf8" });
  if (verify.status !== 0) blockMergeAndThrow(root, actor, prId, `Branch ${pr.branch} does not exist.`);

  const checkout = spawnSync("git", ["-C", root, "checkout", pr.base], { encoding: "utf8" });
  if (checkout.status !== 0) blockMergeAndThrow(root, actor, prId, checkout.stderr || checkout.stdout || `git checkout ${pr.base} failed`);

  const merge = spawnSync("git", ["-C", root, "merge", "--no-ff", pr.branch, "-m", `pi-company: merge ${pr.id} ${pr.title}`], {
    encoding: "utf8",
  });
  if (merge.status !== 0) blockMergeAndThrow(root, actor, prId, merge.stderr || merge.stdout || "git merge failed");

  return recordEvent(root, makeEvent("merge.completed", actor, {
    pr_id: prId,
    head: resolveGitHead(root, pr.branch) ?? pr.head ?? null,
    base_head: resolveGitHead(root, pr.base) ?? pr.base_head ?? null,
  }));
}

function blockMergeAndThrow(root: string, actor: string, prId: string, reason: string): never {
  const message = reason.trim();
  recordEvent(root, makeEvent("merge.blocked", actor, {
    pr_id: prId,
    blockers: [message],
    source: "execution",
  }));
  throw new Error(message);
}

export function renderIssue(issue: IssueRecord): string {
  return `# ${issue.id}: ${issue.title}

Status: ${issue.status}
Owner: ${issue.owner ?? "unassigned"}
Work type: ${issue.work_type ?? "unspecified"}
Created by: ${issue.created_by}

${issue.body}
`;
}

export function renderPr(pr: PullRequestRecord): string {
  return `# ${pr.id}: ${pr.title}

Issue: ${pr.issue_id ?? "none"}
Author: ${pr.author}
Branch: ${pr.branch}
Worktree: ${pr.worktree}
Base: ${pr.base}
Head: ${pr.head ?? "unknown"}
Mergeable: ${pr.mergeable?.status ?? "unknown"}
Status: ${pr.status}
Adopted from base: ${pr.adopted_from_base ? "yes" : "no"}
Abandoned reason: ${pr.abandoned_reason ?? "none"}
Superseded by: ${pr.superseded_by ?? "none"}

## Summary

${pr.summary}

## Self Test

${pr.self_test ?? "pending"}

## Test Brief

${pr.test_brief ?? "pending"}

## Product Acceptance

${(pr.acceptances ?? []).at(-1)?.summary ?? "pending"}
`;
}

export function launchCommand(root: string, agentName: string, extensionPathOverride?: string): string {
  const state = loadState(root);
  const agent = state.agents[agentName];
  if (!agent) throw new Error(`Unknown agent ${agentName}`);
  const extensionPath = extensionPathOverride ?? path.join(root, "extensions", "company.ts");
  const rolePath = path.join(companyPaths(root).rolesDir, `${agent.role}.md`);
  const cwd = agent.worktree ?? agent.cwd;
  const modelConfig = resolveAgentModelConfig(root, agentName);
  return [
    `cd ${shellQuote(cwd)}`,
    "&&",
    `PI_COMPANY_ROOT=${shellQuote(root)}`,
    `PI_COMPANY_AGENT=${shellQuote(agent.name)}`,
    `PI_COMPANY_ROLE=${shellQuote(agent.role)}`,
    `PI_COMPANY_LEAD=${shellQuote(state.config?.lead ?? "lead")}`,
    "pi",
    ...modelArgs(modelConfig),
    "-e",
    shellQuote(extensionPath),
    "--company-root",
    shellQuote(root),
    "--company-agent",
    shellQuote(agent.name),
    "--company-role",
    shellQuote(agent.role),
    "--company-lead",
    shellQuote(state.config?.lead ?? "lead"),
    "--append-system-prompt",
    shellQuote(rolePath),
  ].join(" ");
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function normalizeModelConfig(model: PiModelConfig | null): PiModelConfig | null {
  if (!model) return null;
  const normalized: PiModelConfig = {};
  if (typeof model.provider === "string" && model.provider.trim().length > 0) normalized.provider = model.provider.trim();
  if (typeof model.model === "string" && model.model.trim().length > 0) normalized.model = model.model.trim();
  if (typeof model.models === "string" && model.models.trim().length > 0) normalized.models = model.models.trim();
  if (typeof model.thinking === "string" && model.thinking.trim().length > 0) normalized.thinking = model.thinking.trim();
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function mergeModelConfigs(...configs: Array<PiModelConfig | null | undefined>): PiModelConfig | null {
  const merged: PiModelConfig = {};
  for (const config of configs) {
    const normalized = normalizeModelConfig(config ?? null);
    if (!normalized) continue;
    Object.assign(merged, normalized);
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

function modelArgs(config: PiModelConfig | null): string[] {
  if (!config) return [];
  const args: string[] = [];
  if (config.provider) args.push("--provider", shellQuote(config.provider));
  if (config.model) args.push("--model", shellQuote(config.model));
  if (config.models) args.push("--models", shellQuote(config.models));
  if (config.thinking) args.push("--thinking", shellQuote(config.thinking));
  return args;
}
