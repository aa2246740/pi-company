import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  acknowledgeInbox,
  agentRateLimitResumeAt,
  assignIssue,
  blockTask,
  buildLeadBrief,
  clearRateLimit,
  completeTask,
  createIssue,
  createPr,
  ensureCoderWorktree,
  ensurePendingMergeReminder,
  getPrGateStatus,
  heartbeatAgent,
  launchCommand,
  listInbox,
  loadConfig,
  loadState,
  markPrReady,
  mergePr,
  pendingMergeRequests,
  planAgentSpawn,
  reportRateLimit,
  recordAutomatedTests,
  recordHumanSteering,
  registerAgent,
  reportTask,
  requestAgentSpawn,
  requestMerge,
  rateLimitIsActive,
  renderLeadBrief,
  sendCompanyMessage,
  shouldAutoDeliverMessage,
  startTask,
  setModelPolicy,
  submitAcceptance,
  submitReview,
  submitTest,
} from "../src/core/company.js";
import { parseCmuxSurfaceRef } from "../src/core/cmux.js";
import {
  acquireProviderRequestLease,
  releaseProviderRequestLease,
  type ProviderRequestLease,
} from "../src/core/provider-queue.js";
import { classifyRateLimitText } from "../src/core/rate-limit.js";
import { DEFAULT_ROLES } from "../src/core/defaults.js";
import { companyPaths } from "../src/core/paths.js";
import type { AgentRecord, CompanyState, IssueRecord, MailboxMessage, PiModelConfig } from "../src/core/types.js";

const currentExtensionPath = fileURLToPath(import.meta.url);

const messageTypeSchema = Type.Union([
  Type.Literal("assignment"),
  Type.Literal("question"),
  Type.Literal("reply"),
  Type.Literal("report"),
  Type.Literal("review"),
  Type.Literal("test"),
  Type.Literal("human_steering"),
  Type.Literal("system"),
]);

const messagePrioritySchema = Type.Union([
  Type.Literal("normal"),
  Type.Literal("high"),
  Type.Literal("urgent"),
]);

const reviewDecisionSchema = Type.Union([
  Type.Literal("approve"),
  Type.Literal("request_changes"),
  Type.Literal("comment"),
]);

const testStatusSchema = Type.Union([
  Type.Literal("pass"),
  Type.Literal("fail"),
  Type.Literal("blocked"),
]);

const acceptanceDecisionSchema = Type.Union([
  Type.Literal("accept"),
  Type.Literal("request_changes"),
  Type.Literal("comment"),
]);

const automatedTestStatusSchema = Type.Union([
  Type.Literal("passed"),
  Type.Literal("failed"),
  Type.Literal("blocked"),
]);

const rateLimitKindSchema = Type.Union([
  Type.Literal("provider_429"),
  Type.Literal("quota_exhausted"),
  Type.Literal("manual"),
]);

const AUTOMATIC_RATE_LIMIT_DEDUPE_MS = 15_000;
const HEARTBEAT_MS = 30_000;

export default function companyExtension(pi: ExtensionAPI): void {
  pi.registerFlag("company-root", {
    description: "Project root containing .pi-company",
    type: "string",
    default: "",
  });
  pi.registerFlag("company-agent", {
    description: "Current pi-company agent name",
    type: "string",
    default: "lead",
  });
  pi.registerFlag("company-role", {
    description: "Current pi-company role",
    type: "string",
    default: "lead",
  });
  pi.registerFlag("company-lead", {
    description: "Lead agent name",
    type: "string",
    default: "lead",
  });
  pi.registerFlag("company-poll-ms", {
    description: "Mailbox polling interval in milliseconds",
    type: "string",
    default: "3000",
  });

  const explicitRoot = configString(pi, "company-root", "PI_COMPANY_ROOT", "");
  const root = explicitRoot ? path.resolve(explicitRoot) : findCompanyRoot(process.cwd()) ?? process.cwd();
  const agentName = configString(pi, "company-agent", "PI_COMPANY_AGENT", "lead");
  const role = configString(pi, "company-role", "PI_COMPANY_ROLE", "lead");
  const lead = configString(pi, "company-lead", "PI_COMPANY_LEAD", "lead");
  const pollMs = Math.max(1000, Number(configString(pi, "company-poll-ms", "PI_COMPANY_POLL_MS", "3000")) || 3000);
  const deliveredThisSession = new Set<string>();
  let pollTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let delivering = false;
  let manuallyRefreshedThisSession = false;
  let lastAutomaticRateLimitReportAt = 0;
  const activeProviderLeases: ProviderRequestLease[] = [];

  function isCompanyActive(): boolean {
    return loadConfig(root) !== null;
  }

  function requireCompany(): void {
    if (!isCompanyActive()) throw new Error(noCompanyMessage(root));
  }

  function notifyNoCompany(ctx: ExtensionContext): void {
    if (ctx.hasUI) ctx.ui.notify(noCompanyMessage(root), "error");
  }

  function recordLiveHeartbeat(): void {
    const current = loadState(root).agents[agentName];
    const status = current?.status && current.status !== "offline" ? current.status : "online";
    heartbeatAgent(root, { name: agentName, status });
  }

  function reportAutomaticRateLimit(kind: "provider_429" | "quota_exhausted", reason: string) {
    const now = Date.now();
    if (now - lastAutomaticRateLimitReportAt < AUTOMATIC_RATE_LIMIT_DEDUPE_MS) {
      return loadState(root);
    }
    lastAutomaticRateLimitReportAt = now;
    return reportRateLimit(root, agentName, reason, kind);
  }

  async function releaseOldestProviderLease(): Promise<void> {
    const lease = activeProviderLeases.shift();
    if (!lease) return;
    await releaseProviderRequestLease(root, lease);
  }

  async function releaseAllProviderLeases(): Promise<void> {
    while (activeProviderLeases.length > 0) {
      await releaseOldestProviderLease();
    }
  }

  async function refreshUi(ctx: ExtensionContext): Promise<void> {
    if (!isCompanyActive()) return;
    const state = loadState(root);
    const current = state.agents[agentName];
    if (!ctx.hasUI) return;
    const inbox = state.inbox_counts[agentName] ?? 0;
    const displayRole = current?.role ?? role;
    ctx.ui.setTitle(`pi-company ${agentName}`);
    const contextHint = manuallyRefreshedThisSession ? "brief refreshed" : "active";
    ctx.ui.setStatus("pi-company", `${agentName}/${displayRole} inbox:${inbox} · ${contextHint}`);
    ctx.ui.setWidget("pi-company", renderDeskPanel(state, agentName, manuallyRefreshedThisSession), { placement: "belowEditor" });
  }

  async function deliverInbox(ctx: ExtensionContext, mode: "auto" | "manual" = "auto"): Promise<void> {
    if (!isCompanyActive()) return;
    if (delivering) return;
    if (mode === "auto" && !canAutoDeliverFollowUp(ctx)) {
      await refreshUi(ctx);
      return;
    }
    delivering = true;
    try {
      requireCompany();
      ensurePendingMergeReminder(root, agentName);
      const state = loadState(root);
      const messages = listInbox(root, agentName)
        .filter((message) => mode === "manual" || shouldAutoDeliverMessage(message, state, agentName))
        .filter((message) => !deliveredThisSession.has(message.id))
        .slice(0, 5);
      for (const message of messages) {
        try {
          await pi.sendUserMessage(formatMailboxMessage(message), { deliverAs: "followUp" });
          deliveredThisSession.add(message.id);
          acknowledgeInbox(root, agentName, [message.id]);
        } catch (error) {
          const classification = classifyRateLimitError(error);
          if (!classification) throw error;
          const reported = reportAutomaticRateLimit(classification.kind, classification.reason);
          if (ctx.hasUI) {
            ctx.ui.setStatus("pi-company", `rate-limit: paused until ${reported.rate_limit?.paused_until ?? "unknown"}`);
          }
          break;
        }
      }
      await refreshUi(ctx);
    } finally {
      delivering = false;
    }
  }

  function canAutoDeliverFollowUp(ctx: ExtensionContext): boolean {
    try {
      return ctx.isIdle() && !ctx.hasPendingMessages();
    } catch {
      return false;
    }
  }

  function startPolling(ctx: ExtensionContext): void {
    if (!isCompanyActive()) return;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      void deliverInbox(ctx, "auto").catch((error) => {
        if (ctx.hasUI) ctx.ui.setStatus("pi-company", `mailbox error: ${errorMessage(error)}`);
      });
    }, pollMs);
  }

  function startHeartbeat(): void {
    if (!isCompanyActive()) return;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      try {
        requireCompany();
        recordLiveHeartbeat();
      } catch {
        // Heartbeat should not interrupt an agent turn.
      }
    }, HEARTBEAT_MS);
  }

  pi.on("session_start", async (_event, ctx) => {
    try {
      if (!isCompanyActive()) return;
      const state = loadState(root);
      const existing = state.agents[agentName];
      registerAgent(root, {
        name: agentName,
        role: existing?.role ?? role,
        cwd: existing?.cwd ?? ctx.cwd ?? root,
        worktree: existing?.worktree ?? null,
        branch: existing?.branch ?? null,
        mission: existing?.mission ?? null,
        status: "online",
      });
      await refreshUi(ctx);
      startPolling(ctx);
      startHeartbeat();
      await deliverInbox(ctx, "auto");
    } catch (error) {
      if (ctx.hasUI) {
        const message = `pi-company startup error: ${errorMessage(error)}`;
        ctx.ui.setStatus("pi-company", message);
        ctx.ui.notify(message, "error");
      }
      throw error;
    }
  });

  pi.on("session_shutdown", async () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    await releaseAllProviderLeases();
    try {
      if (!isCompanyActive()) return;
      heartbeatAgent(root, { name: agentName, status: "offline" });
    } catch {
      // Shutdown must not fail because state cleanup failed.
    }
  });

  pi.on("before_provider_request", async (event, ctx) => {
    if (!isCompanyActive()) return undefined;
    await waitForProviderBackoff(ctx);
    const state = loadState(root);
    const provider = providerNameFromRequest(event, ctx);
    const lease = await acquireProviderRequestLease(root, provider, agentName, state.config?.provider_request_policy);
    activeProviderLeases.push(lease);
    if (ctx.hasUI) {
      const waited = lease.waited_ms > 0 ? ` waited ${Math.round(lease.waited_ms / 1000)}s` : "";
      ctx.ui.setStatus("pi-company", `provider gate: ${lease.provider}${waited}`);
    }
    return undefined;
  });

  pi.on("after_provider_response", async (event, ctx) => {
    if (event.status !== 429) return;
    if (!isCompanyActive()) return;
    const retryAfter = typeof event.headers?.["retry-after"] === "string"
      ? ` retry-after=${event.headers["retry-after"]}`
      : "";
    const state = reportAutomaticRateLimit("provider_429", `Provider HTTP 429.${retryAfter}`.trim());
    await releaseOldestProviderLease();
    await refreshUi(ctx);
    if (ctx.hasUI) {
      ctx.ui.setStatus("pi-company", `rate-limit: paused until ${state.rate_limit?.paused_until ?? "unknown"}`);
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (!isCompanyActive()) return;
    await releaseOldestProviderLease();
    await refreshUi(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!isCompanyActive()) return;
    await releaseAllProviderLeases();
    await refreshUi(ctx);
  });

  pi.on("input", async (event, ctx) => {
    if (event.source !== "interactive") return { action: "continue" };
    if (!isCompanyActive()) return { action: "continue" };
    recordHumanSteering(root, agentName, event.text, event.streamingBehavior ?? null);
    await refreshUi(ctx);
    if (agentName !== lead) {
      return {
        action: "transform",
        text: `${event.text}

[pi-company: This interactive human steering was already mirrored to ${lead} automatically. Do not send a duplicate human_steering message to ${lead}; only message ${lead} if you are adding a new decision, blocker, or synthesized update.]`,
      };
    }
    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!isCompanyActive()) return undefined;
    await refreshUi(ctx);
    return {
      systemPrompt: `${event.systemPrompt}

${renderCompanySystemPrompt(root, agentName, role, lead)}`,
    };
  });

  async function waitForProviderBackoff(ctx: ExtensionContext): Promise<void> {
    for (;;) {
      const state = loadState(root);
      const resumeAt = agentRateLimitResumeAt(state, agentName) ?? state.rate_limit?.paused_until ?? null;
      const resumeAtMs = resumeAt ? Date.parse(resumeAt) : Number.NaN;
      const waitMs = Number.isFinite(resumeAtMs) ? resumeAtMs - Date.now() : 0;
      if (waitMs <= 0) return;
      if (ctx.hasUI) {
        ctx.ui.setStatus("pi-company", `provider gate: paused until ${resumeAt}`);
      }
      await delay(Math.min(waitMs, 30_000), ctx.signal);
    }
  }

  pi.registerCommand("company-status", {
    description: "Refresh and show pi-company desk panel",
    handler: async (_args, ctx) => {
      if (!isCompanyActive()) {
        notifyNoCompany(ctx);
        return;
      }
      await refreshUi(ctx);
      if (ctx.hasUI) ctx.ui.notify(`pi-company status refreshed for ${agentName}`, "info");
    },
  });

  async function startCompanyContext(ctx: ExtensionContext): Promise<void> {
    if (!isCompanyActive()) {
      notifyNoCompany(ctx);
      return;
    }
    manuallyRefreshedThisSession = true;
    recordLiveHeartbeat();
    await refreshUi(ctx);
    await pi.sendUserMessage(renderManualBriefRefreshPrompt(root, agentName, role, lead), { deliverAs: "followUp" });
    if (ctx.hasUI) ctx.ui.notify(`pi-company brief refreshed for ${agentName}`, "info");
  }

  pi.registerCommand("company-start", {
    description: "Manually refresh pi-company role instructions and lead brief in this Pi session",
    handler: async (_args, ctx) => {
      await startCompanyContext(ctx);
    },
  });

  pi.registerCommand("company-resume", {
    description: "Compatibility alias for /company-start",
    handler: async (_args, ctx) => {
      await startCompanyContext(ctx);
    },
  });

  pi.registerCommand("company-brief", {
    description: "Inject the authoritative lead/global delivery brief",
    handler: async (_args, ctx) => {
      if (!isCompanyActive()) {
        notifyNoCompany(ctx);
        return;
      }
      await pi.sendUserMessage(renderLeadBrief(buildLeadBrief(root)), { deliverAs: "followUp" });
      await refreshUi(ctx);
    },
  });

  pi.registerCommand("company-inbox", {
    description: "Inject unread pi-company mailbox messages into this agent",
    handler: async (_args, ctx) => {
      if (!isCompanyActive()) {
        notifyNoCompany(ctx);
        return;
      }
      await deliverInbox(ctx, "manual");
      if (ctx.hasUI) ctx.ui.notify(`Checked inbox for ${agentName}`, "info");
    },
  });

  pi.registerCommand("company-ack", {
    description: "Acknowledge unread pi-company mailbox messages without injecting them",
    handler: async (_args, ctx) => {
      if (!isCompanyActive()) {
        notifyNoCompany(ctx);
        return;
      }
      const messages = listInbox(root, agentName);
      acknowledgeInbox(root, agentName, messages.map((message) => message.id));
      await refreshUi(ctx);
      if (ctx.hasUI) ctx.ui.notify(`Acknowledged ${messages.length} message(s)`, "info");
    },
  });

  pi.registerCommand("company-send", {
    description: "Send a pi-company message: /company-send <agent> <text>",
    handler: async (args, ctx) => {
      if (!isCompanyActive()) {
        notifyNoCompany(ctx);
        return;
      }
      const [to, ...rest] = args.trim().split(/\s+/);
      const text = rest.join(" ").trim();
      if (!to || !text) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /company-send <agent> <text>", "error");
        return;
      }
      const message = sendCompanyMessage(root, {
        from: agentName,
        to,
        type: "system",
        task: loadState(root).agents[agentName]?.current_task ?? null,
        text,
      });
      await refreshUi(ctx);
      if (ctx.hasUI) ctx.ui.notify(`Sent ${message.id} to ${to}`, "info");
    },
  });

  pi.registerCommand("company-configure-models", {
    description: "Configure role or agent Pi model policy through choices",
    handler: async (_args, ctx) => {
      if (!isCompanyActive()) {
        notifyNoCompany(ctx);
        return;
      }
      const result = await configureModelPolicyInteractively(root, agentName, lead, ctx);
      await refreshUi(ctx);
      if (ctx.hasUI) ctx.ui.notify(result, "info");
    },
  });

  if (isCompanyActive()) {
    registerTools(pi, {
      root,
      agentName,
      lead,
      refreshUi,
    });
  }
}

function findCompanyRoot(start: string): string | null {
  let current = path.resolve(start);
  for (;;) {
    if (loadConfig(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function noCompanyMessage(root: string): string {
  return `No pi-company project found at ${root}. Run pi-company init first, or start Pi from a directory that already contains .pi-company.`;
}

function renderCompanySystemPrompt(root: string, agentName: string, fallbackRole: string, lead: string): string {
  const state = loadState(root);
  const agent = state.agents[agentName];
  const role = agent?.role ?? fallbackRole;
  const rolePrompt = readRolePrompt(root, role);
  const brief = renderLeadBrief(buildLeadBrief(root));
  const currentTask = agent?.current_task ? `Current task: ${agent.current_task}` : "Current task: idle";
  const inboxCount = state.inbox_counts[agentName] ?? 0;
  const roleSpecific =
    agentName === lead
      ? "You are the lead. Use the lead brief as authoritative project truth before declaring completion, routing gates, or merging."
      : `You are ${agentName}. Read your inbox before continuing. Coordinate with ${lead} for scope, sequencing, blockers, and completion claims.`;

  return `[pi-company context]

You are operating inside an active pi-company project. Pi owns chat session resume; pi-company owns local company state, role context, inboxes, issues, PR gates, and provider coordination.

Agent: ${agentName}
Role: ${role}
${currentTask}
Unread inbox messages: ${inboxCount}

${roleSpecific}

Role instructions:
${rolePrompt}

Authoritative project brief:
${brief}

Next step:
Summarize the current state briefly, name blockers and owners, then continue through pi-company tools. Do not rely on stale chat memory or say the project is complete unless the authoritative brief allows it.`;
}

function renderManualBriefRefreshPrompt(root: string, agentName: string, fallbackRole: string, lead: string): string {
  return renderCompanySystemPrompt(root, agentName, fallbackRole, lead).replace("[pi-company context]", "[pi-company brief refresh]");
}

function readRolePrompt(root: string, role: string): string {
  const customPath = path.join(companyPaths(root).rolesDir, `${role}.md`);
  try {
    return fs.readFileSync(customPath, "utf8").trim() || DEFAULT_ROLES[role] || `# ${role}`;
  } catch {
    return DEFAULT_ROLES[role] || `# ${role}`;
  }
}

function registerTools(pi: ExtensionAPI, runtime: {
  root: string;
  agentName: string;
  lead: string;
  refreshUi(ctx: ExtensionContext): Promise<void>;
}): void {
  const { root, agentName, lead, refreshUi } = runtime;

  pi.registerTool({
    name: "company_status",
    label: "Company Status",
    description: "Read the local pi-company state for this project.",
    promptSnippet: "Inspect local pi-company agents, issues, PRs, gates, and inbox counts.",
    promptGuidelines: [
      "Use company_status before coordinating multi-agent work if current ownership, PR gates, or inbox state is unclear.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      await refreshUi(ctx);
      const state = loadState(root);
      return toolResult(renderStatus(state), { state });
    },
  });

  pi.registerTool({
    name: "company_lead_brief",
    label: "Lead Brief",
    description: "Read the authoritative global delivery brief before completion, merge, or handoff decisions.",
    promptSnippet: "Inspect the global project truth: incomplete issues, non-merged PRs, gate blockers, dirty root/worktrees, and next lead actions.",
    promptGuidelines: [
      "Lead must use company_lead_brief before telling the human that work, a feature, a PR, or the project is complete or merged.",
      "Treat worker statements such as 'done', 'merged', 'tested', or 'basically complete' as unverified until company_lead_brief agrees.",
      "If company_lead_brief says can_claim_complete is false, report the blockers and next owner instead of saying the work is complete.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      await refreshUi(ctx);
      const brief = buildLeadBrief(root);
      return toolResult(renderLeadBrief(brief), { brief });
    },
  });

  pi.registerTool({
    name: "company_inbox",
    label: "Company Inbox",
    description: "Read or acknowledge this agent's local mailbox.",
    promptSnippet: "Read unread pi-company mailbox messages for the current agent.",
    promptGuidelines: [
      "Use company_inbox when another pi-company agent may have assigned, replied, reviewed, or escalated something to you.",
    ],
    parameters: Type.Object({
      acknowledge: Type.Optional(Type.Boolean({ description: "Mark unread messages delivered after reading." })),
      include_delivered: Type.Optional(Type.Boolean({ description: "Include delivered mailbox messages." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const messages = listInbox(root, agentName, params.include_delivered === true);
      if (params.acknowledge === true) {
        acknowledgeInbox(root, agentName, messages.map((message) => message.id));
      }
      await refreshUi(ctx);
      return toolResult(messages.length ? messages.map(formatMailboxMessage).join("\n\n") : "No messages", { messages });
    },
  });

  pi.registerTool({
    name: "company_report_rate_limit",
    label: "Report Rate Limit",
    description: "Report provider 429/quota pressure and pause automatic wakes with exponential backoff.",
    promptSnippet: "Report a rate-limit incident so pi-company pauses wakes and recovers gradually.",
    promptGuidelines: [
      "Use company_report_rate_limit when you see provider 429, quota exhausted, repeated retry failures, or rate-limit pressure.",
      "After reporting, stop retrying immediately. Wait for the cooldown or for lead to coordinate a staggered recovery.",
    ],
    parameters: Type.Object({
      kind: Type.Optional(rateLimitKindSchema),
      reason: Type.String(),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = reportRateLimit(root, agentName, params.reason, params.kind ?? "provider_429");
      await refreshUi(ctx);
      return toolResult(`Rate-limit backoff active until ${state.rate_limit?.paused_until ?? "unknown"}`, { rate_limit: state.rate_limit });
    },
  });

  pi.registerTool({
    name: "company_clear_rate_limit",
    label: "Clear Rate Limit",
    description: "Lead-only tool to clear a false-positive or manually verified rate-limit backoff.",
    promptSnippet: "Clear pi-company rate-limit backoff after lead verifies the provider is safe to resume.",
    promptGuidelines: [
      "Only lead should use company_clear_rate_limit, and only after verifying the backoff was a false positive or the provider is safe to resume.",
      "Do not clear real quota exhaustion just to continue work; switch models/providers or wait for quota recovery.",
    ],
    parameters: Type.Object({
      reason: Type.String(),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = clearRateLimit(root, agentName, params.reason);
      await refreshUi(ctx);
      return toolResult("Rate-limit backoff cleared.", { rate_limit: state.rate_limit });
    },
  });

  pi.registerTool({
    name: "company_configure_model_policy",
    label: "Configure Models",
    description: "Lead-only interactive selector for role or agent Pi models. Uses Pi's configured available models; it does not accept free-form model names.",
    promptSnippet: "Configure pi-company role or agent model policy through Pi UI choices.",
    promptGuidelines: [
      "Use company_configure_model_policy when the human asks lead to set model/provider choices for roles or agents.",
      "This tool is interactive: pick from Pi's configured available models instead of inventing provider or model strings.",
      "Model changes affect newly launched or relaunched agents; running Pi panes keep their current model until restarted or changed inside Pi.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const message = await configureModelPolicyInteractively(root, agentName, lead, ctx);
      await refreshUi(ctx);
      return toolResult(message, { config: loadConfig(root) });
    },
  });

  pi.registerTool({
    name: "company_send_message",
    label: "Company Message",
    description: "Send a local mailbox message to another pi-company agent.",
    promptSnippet: "Send a local mailbox message to another pi-company role agent.",
    promptGuidelines: [
      "Use company_send_message when another pi-company agent needs context, a question, a review request, test request, or a handoff.",
      "Use company_send_message to notify lead when local coordination affects scope, sequencing, or project direction.",
      "Do not use company_send_message to duplicate interactive human steering; pi-company mirrors that to lead automatically.",
    ],
    parameters: Type.Object({
      to: Type.String({ description: "Target agent name, for example lead, pm, tester, reviewer, coder." }),
      type: Type.Optional(messageTypeSchema),
      text: Type.String(),
      task: Type.Optional(Type.String({ description: "Related issue or PR id." })),
      priority: Type.Optional(messagePrioritySchema),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const message = sendCompanyMessage(root, {
        from: agentName,
        to: params.to,
        type: params.type ?? "system",
        task: params.task ?? loadState(root).agents[agentName]?.current_task ?? null,
        text: params.text,
        priority: params.priority ?? undefined,
      });
      await refreshUi(ctx);
      return toolResult(`Sent ${message.id} to ${message.to} (${message.wake?.mode ?? "digest"}: ${message.wake?.reason ?? "no wake metadata"})`, { message });
    },
  });

  pi.registerTool({
    name: "company_create_issue",
    label: "Create Issue",
    description: "Create a local pi-company issue and optionally assign it.",
    promptSnippet: "Create a lead-owned local issue and optionally assign it.",
    promptGuidelines: [
      "Use company_create_issue only when lead is creating concrete work with clear acceptance criteria or investigation goals.",
      "Non-lead agents should message lead with proposed follow-up work instead of creating formal issues directly.",
    ],
    parameters: Type.Object({
      title: Type.String(),
      body: Type.Optional(Type.String()),
      owner: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.owner && !loadState(root).agents[params.owner]) {
        throw new Error(`Unknown agent ${params.owner}. Spawn or register the agent before assigning issues.`);
      }
      const issue = createIssue(root, agentName, params.title, params.body ?? "");
      if (params.owner) assignIssue(root, agentName, issue.id, params.owner);
      await refreshUi(ctx);
      return toolResult(`${issue.id}: ${issue.title}`, { issue: loadState(root).issues[issue.id] });
    },
  });

  pi.registerTool({
    name: "company_assign_issue",
    label: "Assign Issue",
    description: "Assign a local pi-company issue to an agent.",
    promptSnippet: "Assign a lead-owned local issue to a pi-company agent.",
    promptGuidelines: [
      "Use company_assign_issue only when lead routes work to the agent that should own it.",
    ],
    parameters: Type.Object({
      issue_id: Type.String(),
      owner: Type.String(),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      assignIssue(root, agentName, params.issue_id, params.owner);
      await refreshUi(ctx);
      return toolResult(`Assigned ${params.issue_id} to ${params.owner}`, { issue: loadState(root).issues[params.issue_id] });
    },
  });

  pi.registerTool({
    name: "company_task_update",
    label: "Task Update",
    description: "Record task start, progress, block, or non-code completion for an issue.",
    promptSnippet: "Record progress against a local pi-company issue.",
    promptGuidelines: [
      "Use company_task_update when starting assigned work, reporting meaningful progress, becoming blocked, or completing an issue.",
      "Coders with code changes must not use a task report or completion as a substitute for local PR flow.",
      "For code changes, commit the work, create a PR, record automated tests, and mark the PR ready with self-test evidence and a tester brief.",
    ],
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("start"),
        Type.Literal("report"),
        Type.Literal("block"),
        Type.Literal("complete"),
      ]),
      issue_id: Type.String(),
      note: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const note = params.note ?? "";
      if (params.action === "start") startTask(root, agentName, params.issue_id, note);
      if (params.action === "report") reportTask(root, agentName, params.issue_id, note);
      if (params.action === "block") blockTask(root, agentName, params.issue_id, note || "blocked");
      if (params.action === "complete") completeTask(root, agentName, params.issue_id, note || "completed");
      await refreshUi(ctx);
      return toolResult(`${agentName} ${params.action} ${params.issue_id}`, { issue: loadState(root).issues[params.issue_id] });
    },
  });

  pi.registerTool({
    name: "company_spawn_agent",
    label: "Spawn Agent",
    description: "Plan and optionally launch another pi-company agent.",
    promptSnippet: "Create or launch a role agent with optional coder worktree isolation.",
    promptGuidelines: [
      "Use company_spawn_agent when lead needs another persistent role context for project work.",
      "Use coder worktrees for agents that will edit code in parallel.",
    ],
    parameters: Type.Object({
      role: Type.String({ description: "Role name, for example coder, tester, reviewer, pm, researcher." }),
      name: Type.String({ description: "Agent name, for example coder-api or tester." }),
      mission: Type.Optional(Type.String()),
      create_worktree: Type.Optional(Type.Boolean({ description: "Create git worktree when this is a coder." })),
      launch_in_cmux: Type.Optional(Type.Boolean({ description: "Open a cmux pane and run Pi automatically when cmux is available." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const existing = loadState(root).agents[params.name];
      if (existing) {
        if (existing.role !== params.role) {
          throw new Error(`Agent ${params.name} already exists as role ${existing.role}, not ${params.role}.`);
        }
        const command = launchCommand(root, existing.name, currentExtensionPath);
        const shouldLaunch = params.launch_in_cmux !== false && existing.status !== "online" && existing.status !== "running";
        const briefing = shouldLaunch || params.launch_in_cmux === false
          ? sendLaunchBriefingIfNeeded(root, agentName, existing)
          : null;
        const cmux = shouldLaunch ? launchInCmux(command) : null;
        await refreshUi(ctx);
        if (cmux) return toolResult(`Launched existing ${existing.name} in ${cmux}`, { plan: existing, command, cmux, existing: true, briefing });
        if (existing.status === "online" || existing.status === "running") {
          return toolResult(`Agent ${existing.name} is already ${existing.status}. Launch command:\n${command}`, { plan: existing, command, cmux, existing: true, briefing });
        }
        return toolResult(command, { plan: existing, command, cmux, existing: true, briefing });
      }
      const plan = planAgentSpawn(root, params.role, params.name, params.mission ?? null);
      const shouldCreateWorktree = (params.role === "coder" || params.name.startsWith("coder")) && params.create_worktree !== false;
      if (shouldCreateWorktree) ensureCoderWorktree(root, plan, true);
      requestAgentSpawn(root, agentName, params.role, params.name, params.mission ?? null);
      registerAgent(root, {
        name: plan.name,
        role: plan.role,
        cwd: plan.cwd,
        worktree: plan.worktree,
        branch: plan.branch,
        mission: plan.mission,
        status: "planned",
      });
      const command = launchCommand(root, plan.name, currentExtensionPath);
      let cmux: string | null = null;
      if (params.launch_in_cmux !== false) cmux = launchInCmux(command);
      await refreshUi(ctx);
      return toolResult(cmux ? `Launched ${plan.name} in ${cmux}` : command, { plan, command, cmux });
    },
  });

  pi.registerTool({
    name: "company_create_pr",
    label: "Create PR",
    description: "Create a local pi-company PR record for a branch/worktree.",
    promptSnippet: "Create a local PR for a coder branch and worktree.",
    promptGuidelines: [
      "Use company_create_pr when implementation is ready to enter local review and test flow.",
      "Coders should create a PR for every code-changing implementation issue before claiming it is complete.",
    ],
    parameters: Type.Object({
      title: Type.String(),
      summary: Type.String(),
      branch: Type.Optional(Type.String()),
      worktree: Type.Optional(Type.String()),
      issue_id: Type.Optional(Type.String()),
      base: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const agent = loadState(root).agents[agentName];
      const pr = createPr(root, agentName, {
        title: params.title,
        summary: params.summary,
        branch: params.branch ?? agent?.branch ?? agentName,
        worktree: params.worktree ?? agent?.worktree ?? agent?.cwd ?? root,
        issue_id: params.issue_id ?? null,
        base: params.base ?? "main",
      });
      await refreshUi(ctx);
      return toolResult(`${pr.id}: ${pr.title}`, { pr });
    },
  });

  pi.registerTool({
    name: "company_mark_pr_ready",
    label: "Mark PR Ready",
    description: "Move a local PR out of draft with coder self-test evidence and a tester brief.",
    promptSnippet: "Mark a local PR ready with self-test evidence and a test brief.",
    promptGuidelines: [
      "Use company_mark_pr_ready only after the coder has meaningful self-test evidence and can tell tester what to validate.",
      "For code-changing implementation work, this is the correct way to announce completion readiness.",
      "company_mark_pr_ready automatically notifies lead; do not send a duplicate ready report unless you are adding new context.",
    ],
    parameters: Type.Object({
      pr_id: Type.String(),
      self_test: Type.String(),
      test_brief: Type.String(),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      markPrReady(root, agentName, params.pr_id, params.self_test, params.test_brief);
      await refreshUi(ctx);
      return toolResult(`${params.pr_id} marked ready`, { pr: loadState(root).prs[params.pr_id] });
    },
  });

  pi.registerTool({
    name: "company_submit_review",
    label: "Submit Review",
    description: "Submit reviewer approval, comment, or request changes for a local PR.",
    promptSnippet: "Submit local PR review result.",
    promptGuidelines: [
      "Use company_submit_review after reviewing diff, implementation quality, risks, and test quality.",
    ],
    parameters: Type.Object({
      pr_id: Type.String(),
      decision: reviewDecisionSchema,
      summary: Type.String(),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      submitReview(root, agentName, params.pr_id, params.decision, params.summary);
      await refreshUi(ctx);
      return toolResult(`${agentName} submitted ${params.decision} for ${params.pr_id}`, { pr: loadState(root).prs[params.pr_id] });
    },
  });

  pi.registerTool({
    name: "company_submit_test",
    label: "Submit Test",
    description: "Submit independent tester validation for a local PR.",
    promptSnippet: "Submit local PR tester result.",
    promptGuidelines: [
      "Use company_submit_test after validating the test brief, user behavior, edge cases, and relevant regressions.",
      "Do not submit pass with hidden caveats. If validation has failures, partial coverage, or pre-existing issues, submit blocked/fail or state the caveat plainly.",
    ],
    parameters: Type.Object({
      pr_id: Type.String(),
      status: testStatusSchema,
      summary: Type.String(),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      submitTest(root, agentName, params.pr_id, params.status, params.summary);
      await refreshUi(ctx);
      return toolResult(`${agentName} submitted test ${params.status} for ${params.pr_id}`, { pr: loadState(root).prs[params.pr_id] });
    },
  });

  pi.registerTool({
    name: "company_submit_acceptance",
    label: "Submit Acceptance",
    description: "Submit PM/lead product acceptance for a local PR.",
    promptSnippet: "Submit product acceptance after checking the implemented user-facing behavior against the original request.",
    promptGuidelines: [
      "Use company_submit_acceptance only as PM or lead after product-level validation.",
      "Acceptance is not a replacement for tester validation or code review; it verifies that the delivered behavior matches the human request and acceptance criteria.",
      "Do not accept if a key user flow is unobserved, an interface request is not visibly satisfied, a required skill/tool/method was skipped, or important evidence is missing. Request changes or comment instead.",
    ],
    parameters: Type.Object({
      pr_id: Type.String(),
      decision: acceptanceDecisionSchema,
      summary: Type.String(),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      submitAcceptance(root, agentName, params.pr_id, params.decision, params.summary);
      await refreshUi(ctx);
      return toolResult(`${agentName} submitted product acceptance ${params.decision} for ${params.pr_id}`, { pr: loadState(root).prs[params.pr_id] });
    },
  });

  pi.registerTool({
    name: "company_record_auto_tests",
    label: "Record Tests",
    description: "Record automated test command outcome for a local PR.",
    promptSnippet: "Record automated test command outcome for a local PR.",
    promptGuidelines: [
      "Use company_record_auto_tests whenever automated tests are run for a local PR, whether they pass or fail.",
      "Record the command outcome truthfully. Any failed tests, partial pass counts, warnings, or pre-existing failures must be recorded as failed/blocked or stated plainly; never rewrite them as a clean pass.",
    ],
    parameters: Type.Object({
      pr_id: Type.String(),
      status: automatedTestStatusSchema,
      summary: Type.String(),
      command: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      recordAutomatedTests(root, agentName, params.pr_id, params.status, params.summary, params.command ?? null);
      await refreshUi(ctx);
      return toolResult(`Automated tests ${params.status} for ${params.pr_id}`, { pr: loadState(root).prs[params.pr_id] });
    },
  });

  pi.registerTool({
    name: "company_pr_gates",
    label: "PR Gates",
    description: "Check whether a local PR is ready to merge.",
    promptSnippet: "Check local PR merge gates.",
    promptGuidelines: [
      "Use company_pr_gates before asking lead to merge a local PR.",
    ],
    parameters: Type.Object({
      pr_id: Type.String(),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const pr = loadState(root).prs[params.pr_id];
      if (pr?.status === "merged") {
        await refreshUi(ctx);
        return toolResult(`${params.pr_id} is already merged`, { pr });
      }
      const gates = getPrGateStatus(root, params.pr_id);
      await refreshUi(ctx);
      return toolResult(gates.ready ? `${params.pr_id} is ready to merge` : `${params.pr_id} blocked:\n${gates.blockers.map((b) => `- ${b}`).join("\n")}`, { gates });
    },
  });

  pi.registerTool({
    name: "company_merge_pr",
    label: "Merge PR",
    description: "Request or execute a gated local PR merge.",
    promptSnippet: "Request or execute a gated local PR merge.",
    promptGuidelines: [
      "When you are lead and gates are green, call company_merge_pr to execute the local git merge unless there is an explicit reason to defer.",
      "Workers should use company_merge_pr with execute_git false to request a lead merge decision.",
      "Lead can pass execute_git false for a dry merge request, but normal gated delivery should execute the merge.",
      "Do not run raw git stash/reset/clean/revert or checkout-away commands in the project root to make this tool pass. Dirty tracked or staged root changes are a blocker that must be resolved deliberately.",
    ],
    parameters: Type.Object({
      pr_id: Type.String(),
      execute_git: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const executeGit = params.execute_git ?? agentName === lead;
      if (executeGit && agentName !== lead) {
        throw new Error(`Only ${lead} can execute merges. Request merge with execute_git false instead.`);
      }
      const existing = loadState(root).prs[params.pr_id];
      if (!executeGit && existing?.status === "merged") {
        await refreshUi(ctx);
        return toolResult(`${params.pr_id} is already merged`, { pr: existing });
      }
      const state = executeGit
        ? mergePr(root, agentName, params.pr_id, true)
        : requestMerge(root, agentName, params.pr_id);
      const gates = executeGit ? { ready: true, blockers: [] } : getPrGateStatus(root, params.pr_id);
      await refreshUi(ctx);
      const message = executeGit
        ? `${params.pr_id} merged`
        : gates.ready
          ? `${params.pr_id} merge requested`
          : `${params.pr_id} merge blocked:\n${gates.blockers.map((blocker) => `- ${blocker}`).join("\n")}`;
      return toolResult(message, { pr: state.prs[params.pr_id], gates });
    },
  });
}

function configString(pi: ExtensionAPI, name: string, envName: string, fallback: string): string {
  const argvValue = readArgValue(name);
  if (argvValue) return argvValue;
  const value = pi.getFlag(name);
  if (typeof value === "string" && value.trim().length > 0) return value;
  const envValue = process.env[envName];
  if (envValue && envValue.trim().length > 0) return envValue;
  return fallback;
}

async function configureModelPolicyInteractively(root: string, agentName: string, lead: string, ctx: ExtensionContext): Promise<string> {
  if (agentName !== lead) throw new Error(`Only ${lead} can configure model policy.`);
  if (!ctx.hasUI || typeof ctx.ui.select !== "function") {
    throw new Error("Model policy configuration requires Pi UI selection.");
  }

  const modelOptions = await availableModelOptions(ctx);
  const changes: string[] = [];
  while (true) {
    const targetOptions = modelPolicyTargetOptions(loadState(root));
    const doneLabel = changes.length > 0 ? "Done" : "Cancel";
    const targetChoice = await selectRequired(ctx, "Choose role or agent to configure:", [
      ...targetOptions.map((option) => option.label),
      doneLabel,
    ]);
    if (targetChoice === doneLabel) break;
    const target = targetOptions.find((option) => option.label === targetChoice);
    if (!target) throw new Error("Unknown model policy target.");

    const change = await configureOneModelPolicy(root, agentName, ctx, target, modelOptions);
    changes.push(change);

    const next = await selectRequired(ctx, "Configure another model policy?", ["Configure another role", "Done"]);
    if (next === "Done") break;
  }

  if (changes.length === 0) return "No model policy changes.";
  return `${changes.join("\n")}\nRelaunch affected agents for changes to take effect.`;
}

function modelPolicyTargetOptions(state: CompanyState): Array<{ label: string; scope: "defaults" | "role" | "agent"; name: string | null }> {
  const roles = [...new Set([
    "lead",
    "pm",
    "researcher",
    "coder",
    "reviewer",
    "tester",
    ...Object.values(state.agents).map((agent) => agent.role),
  ])].sort();
  const agents = Object.values(state.agents).map((agent) => agent.name).sort();
  return [
    { label: "Default model (future and unconfigured roles)", scope: "defaults", name: null },
    ...roles.map((role) => ({ label: `Role: ${role}`, scope: "role" as const, name: role })),
    ...agents.map((agent) => ({ label: `Agent: ${agent}`, scope: "agent" as const, name: agent })),
  ];
}

async function configureOneModelPolicy(
  root: string,
  agentName: string,
  ctx: ExtensionContext,
  target: { label: string; scope: "defaults" | "role" | "agent"; name: string | null },
  modelOptions: Array<{ label: string; provider: string; model: string; reasoning: boolean }>,
): Promise<string> {
  const clearLabel = target.scope === "defaults"
    ? "Use Pi/lead current model by default"
    : "Use default model / clear this override";
  const modelChoice = await selectRequired(ctx, `Choose Pi model for ${target.label}:`, [clearLabel, ...modelOptions.map((option) => option.label)]);
  if (modelChoice === clearLabel) {
    setModelPolicy(root, agentName, target.scope, target.name, null);
    return `Cleared ${target.label}.`;
  }

  const selectedModel = modelOptions.find((option) => option.label === modelChoice);
  if (!selectedModel) throw new Error("Unknown model choice.");

  const thinkingChoices = selectedModel.reasoning
    ? ["inherit Pi default", "off", "minimal", "low", "medium", "high", "xhigh"]
    : ["inherit Pi default", "off"];
  const thinkingChoice = await selectRequired(ctx, `Choose thinking for ${target.label}:`, thinkingChoices);
  const modelConfig: PiModelConfig = {
    provider: selectedModel.provider,
    model: selectedModel.model,
  };
  if (thinkingChoice !== "inherit Pi default") modelConfig.thinking = thinkingChoice;

  setModelPolicy(root, agentName, target.scope, target.name, modelConfig);
  const thinking = modelConfig.thinking ? `:${modelConfig.thinking}` : "";
  return `Configured ${target.label} to ${modelConfig.provider}/${modelConfig.model}${thinking}.`;
}

async function availableModelOptions(ctx: ExtensionContext): Promise<Array<{ label: string; provider: string; model: string; reasoning: boolean }>> {
  const registryModels = await availableModelsFromRegistry(ctx);
  const models = registryModels.length > 0 ? registryModels : availableModelsFromPiCli();
  const unique = new Map<string, { label: string; provider: string; model: string; reasoning: boolean }>();
  for (const model of models) {
    unique.set(`${model.provider}/${model.model}`, model);
  }
  return [...unique.values()].sort((left, right) => left.label.localeCompare(right.label));
}

async function availableModelsFromRegistry(ctx: ExtensionContext): Promise<Array<{ label: string; provider: string; model: string; reasoning: boolean }>> {
  const registry = ctx.modelRegistry as unknown as { getAvailable?: () => unknown[] | Promise<unknown[]> };
  if (typeof registry.getAvailable !== "function") return [];
  const models = await registry.getAvailable();
  return models
    .map(modelOptionFromRegistryModel)
    .filter((model): model is { label: string; provider: string; model: string; reasoning: boolean } => Boolean(model));
}

function modelOptionFromRegistryModel(value: unknown): { label: string; provider: string; model: string; reasoning: boolean } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.provider !== "string" || typeof record.id !== "string") return null;
  const name = typeof record.name === "string" && record.name !== record.id ? ` (${record.name})` : "";
  const context = typeof record.contextWindow === "number" ? ` context:${formatTokenCount(record.contextWindow)}` : "";
  const thinking = record.reasoning === false ? " thinking:no" : " thinking:yes";
  return {
    label: `${record.provider}/${record.id}${name}${context}${thinking}`,
    provider: record.provider,
    model: record.id,
    reasoning: record.reasoning !== false,
  };
}

function availableModelsFromPiCli(): Array<{ label: string; provider: string; model: string; reasoning: boolean }> {
  const result = spawnSync("pi", ["--list-models"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "pi --list-models failed.");
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("provider "))
    .map((line) => {
      const [provider, model, context, _maxOut, thinking] = line.split(/\s+/);
      if (!provider || !model) return null;
      return {
        label: `${provider}/${model}${context ? ` context:${context}` : ""} thinking:${thinking ?? "unknown"}`,
        provider,
        model,
        reasoning: thinking !== "no",
      };
    })
    .filter((model): model is { label: string; provider: string; model: string; reasoning: boolean } => Boolean(model));
}

function providerNameFromRequest(event: unknown, ctx: ExtensionContext): string {
  const eventRecord = isRecord(event) ? event : {};
  const model = isRecord(eventRecord.model) ? eventRecord.model : null;
  const request = isRecord(eventRecord.request) ? eventRecord.request : null;
  const payload = isRecord(eventRecord.payload) ? eventRecord.payload : null;
  const ctxModel = isRecord((ctx as unknown as Record<string, unknown>).model)
    ? (ctx as unknown as Record<string, unknown>).model as Record<string, unknown>
    : null;
  const candidates = [
    eventRecord.provider,
    model?.provider,
    request?.provider,
    ctxModel?.provider,
    payload?.provider,
  ];
  const provider = candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return provider?.trim() ?? "unknown-provider";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

async function selectRequired(ctx: ExtensionContext, prompt: string, options: string[]): Promise<string> {
  const choice = await ctx.ui.select(prompt, options);
  if (!choice) throw new Error("Selection cancelled.");
  return choice;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1000) return `${Math.round(value / 100) / 10}K`;
  return String(value);
}

function readArgValue(name: string): string | null {
  const long = `--${name}`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === long) {
      const next = process.argv[index + 1];
      return next && !next.startsWith("--") ? next : null;
    }
    if (arg.startsWith(`${long}=`)) return arg.slice(long.length + 1);
  }
  return null;
}

function toolResult(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Operation aborted."));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Operation aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function classifyRateLimitError(error: unknown): { kind: "provider_429" | "quota_exhausted"; reason: string } | null {
  return classifyRateLimitText(errorMessage(error));
}

function renderDeskPanel(state: ReturnType<typeof loadState>, agentName: string, manuallyRefreshedThisSession: boolean): string[] {
  const agent = state.agents[agentName];
  const activeIssue = agent?.current_task ? state.issues[agent.current_task] : null;
  const ownedIssues = Object.values(state.issues)
    .filter((issue) => issue.owner === agentName)
    .sort((left, right) => issuePanelRank(right, activeIssue?.id) - issuePanelRank(left, activeIssue?.id));
  const authoredPrs = Object.values(state.prs)
    .filter((pr) => pr.author === agentName)
    .sort((left, right) => prPanelRank(right) - prPanelRank(left));
  const blockedPrs = Object.values(state.prs).filter((pr) => pr.status === "blocked" || pr.status === "changes_requested");
  const pendingMerges = pendingMergeRequests(state);
  const lines = [
    `pi-company ${state.config?.id ?? "uninitialized"} | ${agentName} (${agent?.role ?? "unknown"})`,
    manuallyRefreshedThisSession
      ? "context: active | brief refreshed in chat"
      : "context: active | Pi resumes chat; company context updates each turn",
    activeIssue ? `focus: ${activeIssue.id} ${activeIssue.title}` : "focus: idle",
    `task: ${agent?.current_task ?? "idle"} | inbox: ${state.inbox_counts[agentName] ?? 0}`,
  ];
  const rateLimitLine = renderRateLimitPanelLine(state);
  if (rateLimitLine) {
    lines.push(rateLimitLine);
  }
  if (ownedIssues.length > 0) {
    lines.push(`issues: ${ownedIssues.slice(0, 3).map((issue) => `${issue.id}:${issue.status}`).join(" ")}`);
  }
  if (authoredPrs.length > 0) {
    lines.push(`prs: ${authoredPrs.slice(0, 3).map((pr) => `${pr.id}:${pr.status}`).join(" ")}`);
  }
  if (pendingMerges.length > 0) {
    lines.push(`pending merges: ${pendingMerges.slice(0, 3).map((pr) => pr.id).join(" ")}`);
  }
  if (blockedPrs.length > 0) {
    lines.push(`blocked prs: ${blockedPrs.slice(0, 3).map((pr) => `${pr.id}:${pr.status}`).join(" ")}`);
  }
  return lines;
}

function issuePanelRank(issue: { id: string; status: string }, activeIssueId?: string): number {
  if (issue.id === activeIssueId) return 3_000_000 + numericSuffix(issue.id);
  if (issue.status !== "done") return 2_000_000 + numericSuffix(issue.id);
  return numericSuffix(issue.id);
}

function prPanelRank(pr: { id: string; status: string }): number {
  if (pr.status !== "merged") return 2_000_000 + numericSuffix(pr.id);
  return numericSuffix(pr.id);
}

function numericSuffix(id: string): number {
  const match = id.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function renderStatus(state: ReturnType<typeof loadState>): string {
  const agents = Object.values(state.agents)
    .map((agent) => `- ${agent.name} (${agent.role}) ${agent.status}${agent.current_task ? ` task=${agent.current_task}` : ""}`)
    .join("\n");
  const issues = Object.values(state.issues)
    .map((issue) => `- ${issue.id} ${issue.status} ${issue.title}${issue.owner ? ` -> ${issue.owner}` : ""}`)
    .join("\n") || "- none";
  const prs = Object.values(state.prs)
    .map((pr) => {
      const pending = pr.merge_requested_at && pr.status !== "merged" && pr.status !== "blocked"
        ? ` pending_merge_since=${pr.merge_requested_at}`
        : "";
      return `- ${pr.id} ${pr.status}${pending} ${pr.title}`;
    })
    .join("\n") || "- none";
  const pendingMerges = pendingMergeRequests(state)
    .map((pr) => `- ${pr.id} requested_at=${pr.merge_requested_at} author=${pr.author} branch=${pr.branch}`)
    .join("\n") || "- none";
  const rateLimit = state.rate_limit
    ? `- ${rateLimitIsActive(state) ? "active" : "recent"} ${state.rate_limit.kind} until ${state.rate_limit.paused_until} (${state.rate_limit.retry_after_ms}ms)
- incidents=${state.rate_limit.incidents} reported_by=${state.rate_limit.reported_by}
- reason: ${state.rate_limit.reason}`
    : "- none";
  return `Company: ${state.config?.id ?? "not initialized"}

Agents:
${agents || "- none"}

Issues:
${issues}

PRs:
${prs}

Pending Merges:
${pendingMerges}

Rate Limit:
${rateLimit}`;
}

function renderRateLimitPanelLine(state: ReturnType<typeof loadState>): string | null {
  if (!state.rate_limit) return null;
  const status = rateLimitIsActive(state) ? "active" : "recent";
  return `rate-limit: ${status} ${state.rate_limit.kind} until ${state.rate_limit.paused_until}`;
}

function formatMailboxMessage(message: MailboxMessage): string {
  return `[pi-company message ${message.id}]
from: ${message.from}
to: ${message.to}
type: ${message.type}
task: ${message.task ?? "none"}
wake: ${message.wake?.mode ?? "digest"}${message.wake?.reason ? ` (${message.wake.reason})` : ""}
time: ${message.ts}

${message.text}`;
}

function sendLaunchBriefingIfNeeded(root: string, from: string, agent: AgentRecord): MailboxMessage | null {
  const state = loadState(root);
  const issues = outstandingIssuesForAgent(state, agent.name);
  if (issues.length === 0) return null;

  const primary = issues[0];
  const alreadyQueued = listInbox(root, agent.name).some((message) =>
    message.type === "assignment" &&
    message.task === primary.id &&
    message.text.includes("[pi-company launch briefing]")
  );
  if (alreadyQueued) return null;

  const workContext = [
    agent.worktree ? `Worktree: ${agent.worktree}` : null,
    agent.branch ? `Branch: ${agent.branch}` : null,
  ].filter(Boolean).join("\n");
  const issueList = issues.map(formatIssueBrief).join("\n");
  const text = `[pi-company launch briefing]

You were launched with assigned work.

Assigned work:
${issueList}
${workContext ? `\n${workContext}\n` : ""}
Start or continue the appropriate issue with company_task_update, inspect the local project files you need, and report blockers or PR readiness through the normal pi-company tools.`;

  return sendCompanyMessage(root, {
    from,
    to: agent.name,
    type: "assignment",
    task: primary.id,
    priority: "high",
    text,
  });
}

function outstandingIssuesForAgent(state: CompanyState, agentName: string): IssueRecord[] {
  return Object.values(state.issues)
    .filter((issue) => issue.owner === agentName && issue.status !== "done")
    .sort((a, b) => a.id.localeCompare(b.id));
}

function formatIssueBrief(issue: IssueRecord): string {
  return `- ${issue.id} ${issue.status}: ${issue.title}`;
}

function launchInCmux(command: string): string | null {
  const pane = runCmux(["--json", "new-pane", "--type", "terminal", "--direction", "right", "--focus", "false"]);
  if (pane.status !== 0) return null;
  const surface = parseCmuxSurfaceRef(pane.stdout);
  if (!surface) return null;
  const send = runCmux(["send", "--surface", surface, `${command}\n`]);
  if (send.status !== 0) return null;
  return surface;
}

function runCmux(args: string[]): { status: number; stdout: string; stderr: string } {
  const candidates = ["cmux", "/Applications/cmux.app/Contents/Resources/bin/cmux"];
  let last = { status: 127, stdout: "", stderr: "cmux not found" };
  for (const command of candidates) {
    const result = spawnSync(command, args, { encoding: "utf8" });
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
