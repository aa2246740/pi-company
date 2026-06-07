export type AgentRole = "lead" | "pm" | "designer" | "researcher" | "coder" | "reviewer" | "tester" | string;

export type IssueWorkType = "product" | "design" | "implementation" | "test" | "review" | "research";

export type EventType =
  | "company.initialized"
  | "agent.spawn_requested"
  | "agent.spawned"
  | "agent.launch_recorded"
  | "agent.heartbeat"
  | "role.proposed"
  | "role.approved"
  | "human_steering.received"
  | "message.sent"
  | "message.delivered"
  | "issue.created"
  | "issue.assigned"
  | "task.started"
  | "task.blocked"
  | "task.reported"
  | "task.completed"
  | "pr.created"
  | "pr.ready"
  | "pr.abandoned"
  | "pr.automated_tests"
  | "review.submitted"
  | "test.submitted"
  | "acceptance.submitted"
  | "gate.updated"
  | "merge.requested"
  | "merge.completed"
  | "merge.blocked"
  | "rate_limit.reported"
  | "rate_limit.cleared";

export interface CompanyEvent<T = Record<string, unknown>> {
  id: string;
  ts: string;
  type: EventType;
  actor: string;
  data: T;
}

export interface CompanyConfig {
  id: string;
  name: string;
  root: string;
  lead: string;
  quality_gates: {
    required_reviews: number;
    require_tests: boolean;
    require_tester_pass: boolean;
    require_product_acceptance?: boolean;
    require_diff_check: boolean;
    block_caveated_passes: boolean;
    test_command: string | null;
    merge_strategy: "no-ff";
  };
  message_policy?: MessagePolicy;
  rate_limit_policy?: RateLimitPolicy;
  provider_request_policy?: ProviderRequestPolicy;
  model_policy?: ModelPolicy;
}

export interface PiModelConfig {
  provider?: string | null;
  model?: string | null;
  /**
   * Comma-separated Pi model cycling patterns passed to `pi --models`.
   */
  models?: string | null;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | string | null;
}

export interface ModelPolicy {
  defaults?: PiModelConfig | null;
  roles?: Record<string, PiModelConfig | null> | null;
  agents?: Record<string, PiModelConfig | null> | null;
}

export interface MessagePolicy {
  /**
   * Message types that may wake an agent immediately when rate limits allow it.
   * All messages still land in the mailbox.
   */
  immediate_types: MailboxMessageType[];
  /**
   * Human steering is a control-plane event. Keep it immediate unless the user
   * changes this deliberately.
   */
  always_wake_human_steering: boolean;
  agent_cooldown_ms: number;
  agent_max_immediate_per_minute: number;
  org_max_immediate_per_minute: number;
}

export type MailboxMessageType =
  | "assignment"
  | "question"
  | "reply"
  | "report"
  | "review"
  | "test"
  | "human_steering"
  | "system";

export type MessagePriority = "normal" | "high" | "urgent";

export interface MessageWakeDecision {
  mode: "immediate" | "digest";
  reason: string;
  next_wake_after?: string | null;
}

export type RateLimitKind = "provider_429" | "quota_exhausted" | "manual";

export interface RateLimitPolicy {
  initial_backoff_ms: number;
  max_backoff_ms: number;
  quota_backoff_ms: number;
  recovery_stagger_ms: number;
}

export interface ProviderRequestPolicy {
  max_concurrent_per_provider: number;
  min_start_interval_ms: number;
  lease_timeout_ms: number;
  poll_interval_ms: number;
}

export interface RateLimitState {
  kind: RateLimitKind;
  reason: string;
  reported_by: string;
  reported_at: string;
  paused_until: string;
  retry_after_ms: number;
  incidents: number;
}

export interface AgentRecord {
  name: string;
  role: AgentRole;
  cwd: string;
  worktree?: string | null;
  branch?: string | null;
  mission?: string | null;
  status: "planned" | "online" | "idle" | "running" | "blocked" | "offline";
  current_task?: string | null;
  last_seen_at?: string | null;
  last_launch_at?: string | null;
  cmux_surface?: string | null;
}

export interface IssueRecord {
  id: string;
  title: string;
  body: string;
  work_type?: IssueWorkType | null;
  status: "open" | "assigned" | "in_progress" | "blocked" | "done";
  owner?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ReviewRecord {
  reviewer: string;
  decision: "approve" | "request_changes" | "comment";
  summary: string;
  head?: string | null;
  ts: string;
}

export interface TestRecord {
  tester: string;
  status: "pass" | "fail" | "blocked";
  summary: string;
  head?: string | null;
  ts: string;
}

export interface AutomatedTestRecord {
  status: "passed" | "failed" | "blocked";
  command?: string | null;
  summary: string;
  head?: string | null;
  ts: string;
}

export interface AcceptanceRecord {
  accepter: string;
  decision: "accept" | "request_changes" | "comment";
  summary: string;
  head?: string | null;
  ts: string;
}

export interface MergeabilityRecord {
  status: "clean" | "conflict" | "unknown";
  summary: string;
  checked_at: string;
}

export interface PullRequestRecord {
  id: string;
  title: string;
  issue_id?: string | null;
  author: string;
  branch: string;
  head?: string | null;
  base_head?: string | null;
  mergeable?: MergeabilityRecord | null;
  worktree: string;
  base: string;
  status: "draft" | "ready" | "changes_requested" | "approved" | "ready_to_merge" | "merged" | "blocked" | "abandoned";
  summary: string;
  self_test?: string | null;
  test_brief?: string | null;
  ready_head?: string | null;
  reviews: ReviewRecord[];
  tests: TestRecord[];
  acceptances?: AcceptanceRecord[];
  automated_tests?: AutomatedTestRecord | null;
  automated_test_history?: AutomatedTestRecord[];
  merge_requested_at?: string | null;
  merge_blocked_at?: string | null;
  merge_blockers?: string[] | null;
  created_at: string;
  updated_at: string;
  merged_at?: string | null;
  abandoned_at?: string | null;
  abandoned_reason?: string | null;
  superseded_by?: string | null;
  adopted_from_base?: boolean;
}

export interface MailboxMessage {
  id: string;
  ts: string;
  from: string;
  to: string;
  type: MailboxMessageType;
  task?: string | null;
  text: string;
  event_id?: string | null;
  priority?: MessagePriority;
  wake?: MessageWakeDecision;
}

export interface CompanyState {
  config: CompanyConfig | null;
  agents: Record<string, AgentRecord>;
  issues: Record<string, IssueRecord>;
  prs: Record<string, PullRequestRecord>;
  inbox_counts: Record<string, number>;
  rate_limit: RateLimitState | null;
  human_steering: Array<{
    id: string;
    ts: string;
    target_agent: string;
    text: string;
  }>;
  updated_at: string | null;
}

export interface CompanyPaths {
  root: string;
  dir: string;
  events: string;
  state: string;
  config: string;
  roster: string;
  rolesDir: string;
  mailboxesDir: string;
  issuesDir: string;
  prsDir: string;
  worktreesDir: string;
}
