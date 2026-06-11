import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  acknowledgeInbox,
  abandonPr,
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
  inferIssueWorkType,
  initCompany,
  launchCommand,
  listInbox,
  loadConfig,
  loadState,
  markPrReady,
  maintainCompany,
  mergePr,
  normalizeLifecyclePolicy,
  pendingMergeRequests,
  planAgentSpawn,
  reportRateLimit,
  recordAgentLaunch,
  recordAgentRuntime,
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
import type { AgentRecord, CompanyState, GateEvidenceRecord, IssueRecord, IssueWorkType, MailboxMessage, PiModelConfig, PullRequestRecord } from "../src/core/types.js";

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

const issueWorkTypeSchema = Type.Union([
  Type.Literal("product"),
  Type.Literal("design"),
  Type.Literal("implementation"),
  Type.Literal("test"),
  Type.Literal("review"),
  Type.Literal("research"),
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
const BUSY_DELIVERY_BACKOFF_MS = 15_000;
const WATCHDOG_FALLBACK_MS = 60_000;

interface LiveCmuxSurface {
  ref: string;
  title: string | null;
  window_ref?: string | null;
  workspace_ref?: string | null;
  pane_ref?: string | null;
  active?: boolean;
  focused?: boolean;
}

interface CmuxLaunchResult {
  surface: string;
  reused: boolean;
}

interface CmuxContext {
  window_ref?: string | null;
  workspace_ref?: string | null;
}

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
  let watchdogTimer: NodeJS.Timeout | null = null;
  let delivering = false;
  let manuallyRefreshedThisSession = false;
  let lastAutomaticRateLimitReportAt = 0;
  const activeProviderLeases: ProviderRequestLease[] = [];
  let toolsRegistered = false;
  let companyPaused = false;
  let busyDeliveryBackoffUntil = 0;

  function isCompanyActive(): boolean {
    return loadConfig(root) !== null;
  }

  function requireCompany(): void {
    if (!isCompanyActive()) throw new Error(noCompanyMessage(root));
  }

  function notifyNoCompany(ctx: ExtensionContext): void {
    if (ctx.hasUI) ctx.ui.notify(noCompanyMessage(root), "info");
  }

  function ensureCompanyToolsRegistered(): void {
    if (!isCompanyActive() || toolsRegistered) return;
    registerTools(pi, {
      root,
      agentName,
      lead,
      refreshUi,
    });
    toolsRegistered = true;
  }

  function registerCurrentAgent(ctx: ExtensionContext): void {
    const state = loadState(root);
    const existing = state.agents[agentName];
    const currentSurface = currentCmuxSurfaceRef(root, agentName);
    registerAgent(root, {
      name: agentName,
      role: existing?.role ?? role,
      cwd: existing?.cwd ?? ctx.cwd ?? root,
      worktree: existing?.worktree ?? null,
      branch: existing?.branch ?? null,
      mission: existing?.mission ?? null,
      status: "online",
    });
    if (currentSurface && existing) {
      recordAgentLaunch(root, "system", agentName, currentSurface);
    }
    recordLiveRuntime({ status: "online", cmux_surface: currentSurface ?? existing?.cmux_surface ?? null });
  }

  function recordLiveRuntime(patch: Parameters<typeof recordAgentRuntime>[2] = {}): void {
    const current = loadState(root).agents[agentName];
    if (!current) return;
    const currentSurface = currentCmuxSurfaceRef(root, agentName);
    recordAgentRuntime(root, agentName, {
      status: patch.status ?? (current?.status === "offline" ? "online" : undefined),
      cmux_surface: patch.cmux_surface ?? currentSurface ?? current?.cmux_surface ?? null,
      current_task: patch.current_task !== undefined ? patch.current_task : current?.current_task ?? null,
      note: patch.note,
      progress: patch.progress,
      turn_started: patch.turn_started,
      turn_ended: patch.turn_ended,
    });
  }

  function reportAutomaticRateLimit(kind: "provider_429" | "quota_exhausted", reason: string) {
    const now = Date.now();
    if (now - lastAutomaticRateLimitReportAt < AUTOMATIC_RATE_LIMIT_DEDUPE_MS) {
      return loadState(root);
    }
    // Stamp the dedupe window only after a successful report. If reportRateLimit
    // throws (e.g. lock contention), a failed report must not suppress the next
    // 429 and leave the org hammering a rate-limited provider with no backoff.
    const state = reportRateLimit(root, agentName, reason, kind);
    lastAutomaticRateLimitReportAt = now;
    return state;
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
    if (companyPaused) {
      ctx.ui.setStatus("pi-company", `${agentName}/${displayRole} paused`);
      ctx.ui.setWidget("pi-company", renderPausedDeskPanel(state, agentName), { placement: "belowEditor" });
      return;
    }
    const contextHint = manuallyRefreshedThisSession ? "brief refreshed" : "active";
    ctx.ui.setStatus("pi-company", `${agentName}/${displayRole} inbox:${inbox} · ${contextHint}`);
    ctx.ui.setWidget("pi-company", renderDeskPanel(state, agentName, manuallyRefreshedThisSession), { placement: "belowEditor" });
  }

  async function deliverInbox(ctx: ExtensionContext, mode: "auto" | "manual" = "auto"): Promise<void> {
    if (companyPaused) return;
    if (!isCompanyActive()) return;
    if (delivering) return;
    if (mode === "auto" && Date.now() < busyDeliveryBackoffUntil) {
      await refreshUi(ctx);
      return;
    }
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
          busyDeliveryBackoffUntil = 0;
          deliveredThisSession.add(message.id);
          acknowledgeInbox(root, agentName, [message.id]);
        } catch (error) {
          if (isAgentBusyError(error)) {
            busyDeliveryBackoffUntil = Date.now() + BUSY_DELIVERY_BACKOFF_MS;
            break;
          }
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
    if (companyPaused) return;
    if (!isCompanyActive()) return;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      void deliverInbox(ctx, "auto").catch((error) => {
        if (ctx.hasUI) ctx.ui.setStatus("pi-company", `mailbox error: ${errorMessage(error)}`);
      });
    }, pollMs);
  }

  function startWatchdog(ctx: ExtensionContext): void {
    if (companyPaused) return;
    if (!isCompanyActive()) return;
    if (agentName !== lead) return;
    if (watchdogTimer) clearInterval(watchdogTimer);
    const interval = normalizeLifecyclePolicy(loadState(root).config?.lifecycle_policy).watchdog_interval_ms || WATCHDOG_FALLBACK_MS;
    watchdogTimer = setInterval(() => {
      try {
        requireCompany();
        const result = maintainCompany(root, agentName);
        if (result.actions.length > 0 && ctx.hasUI) {
          ctx.ui.setStatus("pi-company", `watchdog: ${result.actions.length} action(s)`);
        }
        void deliverInbox(ctx, "auto").catch(() => undefined);
      } catch {
        // Watchdog should not interrupt an agent turn.
      }
    }, interval);
  }

  pi.on("session_start", async (_event, ctx) => {
    try {
      if (!isCompanyActive()) return;
      registerCurrentAgent(ctx);
      ensureCompanyToolsRegistered();
      await refreshUi(ctx);
      startPolling(ctx);
      startWatchdog(ctx);
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
    if (watchdogTimer) clearInterval(watchdogTimer);
    watchdogTimer = null;
    await releaseAllProviderLeases();
    try {
      if (!isCompanyActive()) return;
      recordAgentRuntime(root, agentName, { status: "offline", note: "Pi session shutdown" });
    } catch {
      // Shutdown must not fail because state cleanup failed.
    }
  });

  pi.on("before_provider_request", async (event, ctx) => {
    if (!isCompanyActive()) return undefined;
    if (companyPaused) return undefined;
    await waitForProviderBackoff(ctx);
    recordLiveRuntime({ status: "busy", turn_started: true });
    const state = loadState(root);
    const provider = providerNameFromRequest(event, ctx);
    const lease = await acquireProviderRequestLease(root, provider, agentName, state.config?.provider_request_policy);
    activeProviderLeases.push(lease);
    // The acquire can block for seconds behind the concurrency/spacing gate. If
    // the company was paused while we waited, release immediately rather than
    // holding a slot for a request that pause may suppress.
    if (companyPaused) {
      await releaseOldestProviderLease();
      return undefined;
    }
    if (ctx.hasUI) {
      const waited = lease.waited_ms > 0 ? ` waited ${Math.round(lease.waited_ms / 1000)}s` : "";
      ctx.ui.setStatus("pi-company", `provider gate: ${lease.provider}${waited}`);
    }
    return undefined;
  });

  pi.on("after_provider_response", async (event, ctx) => {
    if (!isCompanyActive()) return;
    // Always release the lease, even if the company was paused mid-request;
    // otherwise the acquired provider slot leaks until turn_end and starves
    // other agents of the limited concurrent-request budget.
    await releaseOldestProviderLease();
    if (companyPaused) return;
    recordLiveRuntime({ status: "idle", turn_ended: true });
    if (event.status !== 429) return;
    const retryAfter = typeof event.headers?.["retry-after"] === "string"
      ? ` retry-after=${event.headers["retry-after"]}`
      : "";
    const state = reportAutomaticRateLimit("provider_429", `Provider HTTP 429.${retryAfter}`.trim());
    await refreshUi(ctx);
    if (ctx.hasUI) {
      ctx.ui.setStatus("pi-company", `rate-limit: paused until ${state.rate_limit?.paused_until ?? "unknown"}`);
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (!isCompanyActive()) return;
    await releaseAllProviderLeases();
    if (!companyPaused) recordLiveRuntime({ status: "idle", turn_ended: true });
    await refreshUi(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!isCompanyActive()) return;
    await releaseAllProviderLeases();
    if (!companyPaused) recordLiveRuntime({ status: "idle", turn_ended: true });
    await refreshUi(ctx);
  });

  pi.on("input", async (event, ctx) => {
    if (event.source !== "interactive") return { action: "continue" };
    if (!isCompanyActive()) return { action: "continue" };
    if (companyPaused) return { action: "continue" };
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

  pi.on("tool_call", async (event) => {
    if (!isCompanyActive()) return undefined;
    if (companyPaused) return undefined;
    const state = loadState(root);
    const agent = state.agents[agentName];
    const blockReason = agentName === lead
      ? leadToolBlockReason(event, root)
      : workerToolBlockReason(event, agent, root);
    return blockReason ? { block: true, reason: blockReason } : undefined;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!isCompanyActive()) return undefined;
    if (companyPaused) return undefined;
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

  pi.registerCommand("company-init", {
    description: "Initialize pi-company in the current project and attach this Pi session",
    handler: async (args, ctx) => {
      if (isCompanyActive()) {
        await refreshUi(ctx);
        if (ctx.hasUI) ctx.ui.notify(`pi-company is already active at ${root}`, "info");
        return;
      }
      const requestedId = args.trim();
      initCompany({ root, id: requestedId || path.basename(root) });
      registerCurrentAgent(ctx);
      ensureCompanyToolsRegistered();
      startPolling(ctx);
      startWatchdog(ctx);
      await refreshUi(ctx);
      if (ctx.hasUI) {
        ctx.ui.notify(`Initialized pi-company at ${root}. Tell lead what you want to build next.`, "info");
      }
    },
  });

  async function startCompanyContext(ctx: ExtensionContext): Promise<void> {
    if (!isCompanyActive()) {
      notifyNoCompany(ctx);
      return;
    }
    companyPaused = false;
    manuallyRefreshedThisSession = true;
    recordLiveRuntime({ status: "online" });
    startPolling(ctx);
    startWatchdog(ctx);
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
    description: "Resume pi-company in this Pi session and refresh role instructions",
    handler: async (_args, ctx) => {
      await startCompanyContext(ctx);
    },
  });

  pi.registerCommand("company-pause", {
    description: "Pause pi-company guards and automation in this Pi session",
    handler: async (_args, ctx) => {
      if (!isCompanyActive()) {
        notifyNoCompany(ctx);
        return;
      }
      companyPaused = true;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      if (watchdogTimer) clearInterval(watchdogTimer);
      watchdogTimer = null;
      recordAgentRuntime(root, agentName, { status: "paused", note: "company automation paused in this Pi session" });
      await releaseAllProviderLeases();
      await refreshUi(ctx);
      if (ctx.hasUI) ctx.ui.notify("pi-company paused for this Pi session. Run /company-resume to restore company guards and context.", "info");
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

  pi.registerCommand("company-maintain", {
    description: "Run pi-company lifecycle maintenance now (lead only)",
    handler: async (_args, ctx) => {
      if (!isCompanyActive()) {
        notifyNoCompany(ctx);
        return;
      }
      const result = maintainCompany(root, agentName);
      await refreshUi(ctx);
      if (ctx.hasUI) ctx.ui.notify(`pi-company maintenance: ${result.actions.length} action(s)`, "info");
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
    description: "Configure default and role Pi model policy through choices",
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

  ensureCompanyToolsRegistered();
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
  return `This is an ordinary Pi session. To create a pi-company project here, run /company-init. You can also exit Pi and run: pi-company init. Checked: ${root}`;
}

function leadToolBlockReason(event: { toolName: string; input: Record<string, unknown> }, root: string): string | null {
  if (event.toolName === "write" || event.toolName === "edit") {
    const target = typeof event.input.path === "string" ? resolveToolPath(event.input.path, root) : "";
    if (target) {
      const rel = projectRelativePath(root, target);
      if (rel && isNonRunnableDocumentationPath(rel)) return null;
    }
    return "pi-company lead cannot write runnable or behavior-changing project files directly. Delegate implementation/config/test/assets to the responsible worker, or run /company-pause for an explicit ordinary-Pi maintenance escape hatch.";
  }
  if (event.toolName === "bash") {
    const command = typeof event.input.command === "string" ? event.input.command : "";
    if (isAllowedNonCoderDocBashCommand(command)) return null;
    if (isAllowedNonCoderOperationalBashCommand(command)) return null;
    if (isAllowedNonCoderValidationCleanupBashCommand(command)) return null;
    if (isMutatingLeadBashCommand(command)) {
      return "pi-company lead cannot mutate runnable or behavior-changing project files through raw bash. Use pi-company issue/spawn/PR/merge tools, delegate implementation to workers, or run /company-pause for explicit ordinary-Pi maintenance.";
    }
  }
  return null;
}

function workerToolBlockReason(event: { toolName: string; input: Record<string, unknown> }, agent: AgentRecord | undefined, root: string): string | null {
  if (!agent) return null;
  if (event.toolName === "write" || event.toolName === "edit") {
    const target = typeof event.input.path === "string" ? resolveToolPath(event.input.path, agent.cwd) : "";
    if (!target) return null;
    if (agent.role === "coder" || agent.name.startsWith("coder")) {
      if (!agent.worktree) return `pi-company coder ${agent.name} has no assigned worktree. Ask lead to spawn a coder with worktree isolation before writing implementation files.`;
      const worktree = path.resolve(agent.worktree);
      if (isPathInside(target, worktree)) return null;
      return `pi-company coder ${agent.name} must write inside its assigned worktree (${worktree}). Use the same relative output path inside the worktree, not the project root.`;
    }
    const allowed = nonCoderAllowedWriteReason(agent, target, root);
    if (!allowed.allowed) return allowed.reason;
  }
  if (event.toolName === "bash") {
    const command = typeof event.input.command === "string" ? event.input.command : "";
    if (agent.role === "coder" || agent.name.startsWith("coder")) {
      return coderBashBlockReason(command, agent);
    }
    if (isAllowedNonCoderDocBashCommand(command)) return null;
    if (isAllowedNonCoderOperationalBashCommand(command)) return null;
    if (isAllowedNonCoderValidationCleanupBashCommand(command)) return null;
    if (isMutatingLeadBashCommand(command)) {
      return `pi-company ${agent.role} ${agent.name} cannot mutate runnable or behavior-changing project files through raw bash. Non-runnable Markdown/docs are allowed; implementation/config/test/assets must go to coder, or use /company-pause for explicit ordinary-Pi maintenance.`;
    }
  }
  return null;
}

function coderBashBlockReason(command: string, agent: AgentRecord): string | null {
  if (!isMutatingLeadBashCommand(command)) return null;
  if (!agent.worktree) {
    return `pi-company coder ${agent.name} has no assigned worktree. Ask lead to spawn a coder with worktree isolation before mutating files or git state.`;
  }
  const worktree = path.resolve(agent.worktree);
  const cwd = path.resolve(agent.cwd || worktree);
  for (const token of shellWordsLite(command)) {
    const candidate = pathCandidateFromShellToken(token);
    if (!candidate) continue;
    const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(cwd, candidate);
    if (!isPathInside(resolved, worktree)) {
      return `pi-company coder ${agent.name} can mutate files and git state only inside its assigned worktree (${worktree}). The bash command references ${candidate}, which resolves outside that worktree.`;
    }
  }
  return null;
}

function shellWordsLite(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;
  for (const char of command.replace(/\\\n/g, " ")) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      continue;
    }
    if (quote === char) {
      quote = null;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function pathCandidateFromShellToken(token: string): string | null {
  const cleaned = token
    .replace(/^\d*[<>]+/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "-" || cleaned === "/dev/null" || cleaned.startsWith("$") || cleaned.startsWith("&")) return null;
  const value = cleaned.startsWith("--") && cleaned.includes("=") ? cleaned.slice(cleaned.indexOf("=") + 1) : cleaned;
  if (!value || value === "/dev/null" || value.startsWith("$") || value.startsWith("&") || /^[a-z]+:\/\//i.test(value)) return null;
  if (value === ".." || value.startsWith("../") || value.includes("/../")) return value;
  if (path.isAbsolute(value) || value.startsWith("./") || value.includes("/")) return value;
  return null;
}

function isPathInside(target: string, parent: string): boolean {
  const relative = path.relative(parent, target);
  return relative === "" || Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function nonCoderAllowedWriteReason(agent: AgentRecord, target: string, root: string): { allowed: true } | { allowed: false; reason: string } {
  const rel = projectRelativePath(root, target);
  if (!rel) {
    return { allowed: false, reason: `pi-company ${agent.role} ${agent.name} cannot write outside its project. Ask lead to route the work deliberately.` };
  }
  if (isNonRunnableDocumentationPath(rel)) return { allowed: true };
  return {
    allowed: false,
    reason: `pi-company ${agent.role} ${agent.name} can write non-runnable Markdown/docs, but ${rel} looks runnable or behavior-changing. Assign implementation/config/test/assets to coder, or run /company-pause for an explicit ordinary-Pi maintenance escape hatch.`,
  };
}

function projectRelativePath(root: string, target: string): string | null {
  const rel = path.relative(path.resolve(root), path.resolve(target)).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel;
}

function isNonRunnableDocumentationPath(rel: string): boolean {
  const normalized = normalizeRelativePath(rel);
  if (!normalized || isRunnableOrBehaviorChangingPath(normalized)) return false;
  const base = path.posix.basename(normalized);
  if (!isDocumentationExtension(base)) return false;
  if (!normalized.includes("/")) return true;
  if (/^(docs|\.scratch|notes)(\/|$)/i.test(normalized)) return true;
  if (/^\.github\/(ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)(\/|$)/i.test(normalized)) return true;
  return false;
}

function isDocumentationExtension(fileName: string): boolean {
  return /\.(md|mdx|txt|rst|adoc)$/i.test(fileName);
}

function normalizeRelativePath(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isRunnableOrBehaviorChangingPath(rel: string): boolean {
  const normalized = normalizeRelativePath(rel);
  const segments = normalized.split("/");
  const first = segments[0]?.toLowerCase() ?? "";
  const base = path.posix.basename(normalized);
  if (!normalized) return false;
  if (first === ".pi-company" || first === ".git") return true;
  if (first === ".github" && segments[1]?.toLowerCase() === "workflows") return true;
  const behaviorDirs = new Set([
    "src",
    "app",
    "pages",
    "components",
    "server",
    "lib",
    "scripts",
    "bin",
    "test",
    "tests",
    "__tests__",
    "cypress",
    "playwright",
    "public",
    "static",
    "assets",
    "styles",
  ]);
  if (behaviorDirs.has(first)) return true;
  if (/\.(html?|css|scss|sass|less|js|jsx|mjs|cjs|ts|tsx|vue|svelte|astro|py|rb|go|rs|java|kt|swift|php|sh|bash|zsh|fish|ps1|sql|ya?ml|toml|json|jsonc|lock|env|png|jpe?g|gif|webp|svg|ico|pdf|wasm)$/i.test(base)) {
    return true;
  }
  if (/^(package(-lock)?|pnpm-lock|yarn\.lock|bun\.lockb|tsconfig|vite\.config|webpack\.config|rollup\.config|eslint\.config|prettier\.config|tailwind\.config|postcss\.config|dockerfile|compose|makefile|justfile|procfile|\.env|\.gitignore|\.npmrc)/i.test(base)) {
    return true;
  }
  return false;
}

function resolveToolPath(inputPath: string, cwd: string): string {
  return path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(cwd, inputPath);
}

function isAllowedNonCoderDocBashCommand(command: string): boolean {
  const normalized = command.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || !isMutatingLeadBashCommand(normalized)) return false;
  if (hasDangerousNonCoderMutation(normalized)) return false;
  const writtenFiles = [
    ...extractRedirectTargets(normalized),
    ...extractTeeTargets(normalized),
    ...extractTouchTargets(normalized),
  ];
  const writtenDirs = extractMkdirTargets(normalized);
  if (writtenFiles.length === 0 && writtenDirs.length === 0) return false;
  return writtenFiles.every(isSafeRelativeDocumentationFile) && writtenDirs.every(isSafeRelativeDocumentationDirectory);
}

function isAllowedNonCoderOperationalBashCommand(command: string): boolean {
  const normalized = command.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || !isMutatingLeadBashCommand(normalized)) return false;
  if (hasDangerousNonCoderMutation(normalized)) return false;
  if (extractTeeTargets(normalized).length > 0) return false;
  const redirects = extractRedirectTargets(normalized);
  return redirects.length > 0 && redirects.every(isSafeTempRedirectTarget);
}

function isAllowedNonCoderValidationCleanupBashCommand(command: string): boolean {
  const normalized = command.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || !/(^|[;&|]\s*)rm\b/i.test(normalized)) return false;
  if (extractTeeTargets(normalized).length > 0) return false;
  const redirects = extractRedirectTargets(normalized);
  if (redirects.some((target) => !isSafeTempRedirectTarget(target))) return false;
  const rmTargets = extractRmTargets(normalized);
  if (rmTargets.length === 0 || !rmTargets.every(isSafeGeneratedArtifactTarget)) return false;
  const withoutRm = normalized.replace(/(^|[;&|]\s*)rm\s+[^;&|]+/gi, "$1 true");
  return !hasDangerousNonCoderMutation(withoutRm);
}

function hasDangerousNonCoderMutation(command: string): boolean {
  const dangerousPatterns = [
    /(^|[;&|]\s*)(rm|mv|cp|install|chmod|chown|truncate)\b/i,
    /(^|[;&|]\s*)(npm|pnpm|yarn|bun)\s+(install|add|remove|update|upgrade|dlx)\b/i,
    /(^|[;&|]\s*)git\s+(init|add|commit|merge|rebase|checkout|switch|reset|clean|stash|restore|rm|mv|worktree\s+(add|remove|prune|move|repair))\b/i,
    /(^|[;&|]\s*)(sed|perl)\s+[^;&|]*\s-i\b/i,
  ];
  return dangerousPatterns.some((pattern) => pattern.test(command));
}

function extractRedirectTargets(command: string): string[] {
  const targets: string[] = [];
  const pattern = /(?:^|[\s;&|])(?:\d?>|>>)\s*("[^"]+"|'[^']+'|[^\s;&|]+)/g;
  for (const match of command.matchAll(pattern)) {
    const target = cleanShellPathToken(match[1]);
    if (target && target !== "/dev/null" && !target.startsWith("&")) targets.push(target);
  }
  return targets;
}

function extractTeeTargets(command: string): string[] {
  const targets: string[] = [];
  const pattern = /(?:^|[\s;&|])tee(?:\s+-a)?\s+([^;&|]+)/g;
  for (const match of command.matchAll(pattern)) {
    for (const token of shellWordsLite(match[1])) {
      if (token.startsWith("<")) break;
      if (token.startsWith("-")) continue;
      const target = cleanShellPathToken(token);
      if (target && target !== "/dev/null") {
        targets.push(target);
        break;
      }
    }
  }
  return targets;
}

function extractTouchTargets(command: string): string[] {
  return extractCommandPathArgs(command, "touch");
}

function extractMkdirTargets(command: string): string[] {
  return extractCommandPathArgs(command, "mkdir")
    .filter((target) => target !== "-p");
}

function extractRmTargets(command: string): string[] {
  const targets: string[] = [];
  const pattern = /(?:^|[;&|]\s*)rm\s+([^;&|]+)/gi;
  for (const match of command.matchAll(pattern)) {
    for (const token of shellWordsLite(match[1])) {
      if (token.startsWith("-")) continue;
      const target = cleanShellPathToken(token);
      if (target) targets.push(target);
    }
  }
  return targets;
}

function extractCommandPathArgs(command: string, commandName: "mkdir" | "touch"): string[] {
  const targets: string[] = [];
  const pattern = new RegExp(`(?:^|[;&|]\\s*)${commandName}\\s+([^;&|]+)`, "gi");
  for (const match of command.matchAll(pattern)) {
    for (const token of shellWordsLite(match[1])) {
      if (token.startsWith("-")) continue;
      const target = cleanShellPathToken(token);
      if (target) targets.push(target);
    }
  }
  return targets;
}

function cleanShellPathToken(token: string): string {
  return token.replace(/^["']|["']$/g, "").trim();
}

function isSafeRelativeDocumentationFile(target: string): boolean {
  if (!isSafeRelativeProjectToken(target)) return false;
  return isNonRunnableDocumentationPath(target);
}

function isSafeRelativeDocumentationDirectory(target: string): boolean {
  if (!isSafeRelativeProjectToken(target)) return false;
  const normalized = normalizeRelativePath(target).replace(/\/+$/, "");
  return /^(docs|docs\/.+|\.scratch|\.scratch\/.+|notes|notes\/.+|\.github\/ISSUE_TEMPLATE|\.github\/PULL_REQUEST_TEMPLATE)(\/.*)?$/i.test(normalized);
}

function isSafeRelativeProjectToken(target: string): boolean {
  const normalized = normalizeRelativePath(target);
  if (!normalized || normalized.startsWith("-") || normalized.startsWith("$")) return false;
  if (path.isAbsolute(normalized)) return false;
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) return false;
  if (/^[a-z]+:\/\//i.test(normalized)) return false;
  return true;
}

function isSafeTempRedirectTarget(target: string): boolean {
  const cleaned = cleanShellPathToken(target);
  if (!cleaned || cleaned.startsWith("&")) return true;
  if (cleaned === "/dev/null") return true;
  if (!path.isAbsolute(cleaned)) return false;
  const resolved = path.resolve(cleaned);
  return resolved.startsWith("/tmp/") || resolved.startsWith("/private/tmp/");
}

function isSafeGeneratedArtifactTarget(target: string): boolean {
  const cleaned = cleanShellPathToken(target);
  if (!cleaned || cleaned.startsWith("-") || cleaned.startsWith("$")) return false;
  if (/[!*?[{\]}]/.test(cleaned)) return false;
  if (/^[a-z]+:\/\//i.test(cleaned)) return false;
  if (cleaned === ".." || cleaned.startsWith("../") || cleaned.includes("/../")) return false;

  const unix = cleaned.replace(/\\/g, "/").replace(/\/+$/, "");
  if (path.isAbsolute(cleaned)) {
    const resolved = path.resolve(cleaned).replace(/\\/g, "/");
    return resolved.includes("/.pi-company/worktrees/") && isGeneratedArtifactPath(resolved);
  }
  if (!isSafeRelativeProjectToken(unix)) return false;
  return isGeneratedArtifactPath(unix);
}

function isGeneratedArtifactPath(target: string): boolean {
  const normalized = target.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  const last = segments.at(-1)?.toLowerCase() ?? "";
  const generatedDirs = new Set([
    ".cache",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".vite",
    "build",
    "coverage",
    "dist",
    "out",
    "target",
    "tmp",
  ]);
  if (!generatedDirs.has(last)) return false;
  if (normalized.includes("/.pi-company/worktrees/")) return true;
  return segments.length <= 3;
}

function isMutatingLeadBashCommand(command: string): boolean {
  const normalized = command
    .replace(/\\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;
  const mutatingPatterns = [
    /(^|[;&|]\s*)(mkdir|touch|rm|mv|cp|install|chmod|chown|truncate)\b/i,
    /(^|[;&|]\s*)(npm|pnpm|yarn|bun)\s+(install|add|remove|update|upgrade|dlx)\b/i,
    /(^|[;&|]\s*)git\s+(init|add|commit|merge|rebase|checkout|switch|reset|clean|stash|restore|rm|mv|worktree\s+(add|remove|prune|move|repair))\b/i,
  ];
  return mutatingPatterns.some((pattern) => pattern.test(normalized))
    || extractRedirectTargets(normalized).length > 0
    || extractTeeTargets(normalized).length > 0;
}

function isAgentBusyError(error: unknown): boolean {
  return /already processing/i.test(errorMessage(error));
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
      return toolResult(renderStatus(root, state), { state });
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
      "If a PR is blocked by caveated gate evidence, route a fix or ask the human for an explicit risk waiver; do not call it complete, usable, or only a minor suggestion.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      await refreshUi(ctx);
      const brief = buildLeadBrief(root);
      return toolResult(renderLeadBrief(brief), { brief });
    },
  });

  pi.registerTool({
    name: "company_maintain",
    label: "Company Maintenance",
    description: "Lead-only lifecycle watchdog pass: capture terminal text, detect stale/offline workers, and hibernate idle surfaces.",
    promptSnippet: "Run pi-company lifecycle maintenance when a worker may be offline, stale, or when too many cmux surfaces are open.",
    promptGuidelines: [
      "Lead should use company_maintain before waiting silently for a worker that has not reported progress.",
      "Use the returned recovery terminal text and actions to relaunch the same owner or reassign deliberately.",
      "This reads cmux terminal text through read-screen; it does not use screenshots or vision.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const result = maintainCompany(root, agentName);
      await refreshUi(ctx);
      return toolResult(`Maintenance checked at ${result.checked_at}. Actions: ${result.actions.length}.`, { maintenance: result });
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
    description: "Lead-only interactive selector for default and role-level Pi models. Uses Pi's configured available models; it does not accept free-form model names.",
    promptSnippet: "Configure pi-company default and role model policy through Pi UI choices.",
    promptGuidelines: [
      "Use company_configure_model_policy when the human asks lead to set company-wide model/provider choices for roles.",
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
      "Set work_type by real responsibility: product for PM specs, design for designer specs, implementation for coder work, test for tester validation, review for reviewer review, research for researcher work.",
      "If a request mixes design and implementation, create separate design and implementation issues.",
      "Non-lead agents should message lead with proposed follow-up work instead of creating formal issues directly.",
    ],
    parameters: Type.Object({
      title: Type.String(),
      body: Type.Optional(Type.String()),
      work_type: Type.Optional(issueWorkTypeSchema),
      owner: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.owner && !loadState(root).agents[params.owner]) {
        throw new Error(`Unknown agent ${params.owner}. Spawn or register the agent before assigning issues.`);
      }
      const workType = (params.work_type as IssueWorkType | undefined) ?? inferIssueWorkType(params.title, params.body ?? "");
      const issue = createIssue(root, agentName, params.title, params.body ?? "", { work_type: workType });
      const launch = params.owner ? assignAndLaunchIfNeeded(root, agentName, params.owner, issue.id) : null;
      await refreshUi(ctx);
      const launchText = launch?.cmux ? `\n${launch.cmux_reused ? "Reused live" : "Launched"} ${params.owner} in ${launch.cmux}` : "";
      return toolResult(`${issue.id}: ${issue.title}${launchText}`, { issue: loadState(root).issues[issue.id], launch });
    },
  });

  pi.registerTool({
    name: "company_assign_issue",
    label: "Assign Issue",
    description: "Assign a local pi-company issue to an agent.",
    promptSnippet: "Assign a lead-owned local issue to a pi-company agent.",
    promptGuidelines: [
      "Use company_assign_issue only when lead routes work to the agent that should own it.",
      "Implementation work belongs to coder, design work to designer, product work to PM, test work to tester, review work to reviewer, research work to researcher.",
    ],
    parameters: Type.Object({
      issue_id: Type.String(),
      owner: Type.String(),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const launch = assignAndLaunchIfNeeded(root, agentName, params.owner, params.issue_id);
      await refreshUi(ctx);
      const launchText = launch?.cmux ? `\n${launch.cmux_reused ? "Reused live" : "Launched"} ${params.owner} in ${launch.cmux}` : "";
      return toolResult(`Assigned ${params.issue_id} to ${params.owner}${launchText}`, { issue: loadState(root).issues[params.issue_id], launch });
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
      recordAgentRuntime(root, agentName, {
        status: params.action === "complete" ? "idle" : "online",
        current_task: params.action === "complete" ? null : params.issue_id,
        progress: true,
        note: note || params.action,
      });
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
      "Spawning a worker should include a concrete mission. For implementation work, pass issue_id or create/assign an issue before launch.",
      "If the human asks to restart, relaunch, wake, or recover an agent window, set force_launch to true.",
      "Use coder worktrees for agents that will edit code in parallel.",
      "Use built-in roles unless a project-local role pack exists in .pi-company/roles/<role>.md. Do not use force_role for ordinary typos or speculative roles.",
    ],
    parameters: Type.Object({
      role: Type.String({ description: "Role name, for example coder, tester, reviewer, pm, researcher." }),
      name: Type.String({ description: "Agent name, for example coder-api or tester." }),
      mission: Type.Optional(Type.String()),
      issue_id: Type.Optional(Type.String({ description: "Issue to assign to this agent before launch." })),
      create_worktree: Type.Optional(Type.Boolean({ description: "Create git worktree when this is a coder." })),
      launch_in_cmux: Type.Optional(Type.Boolean({ description: "Open a cmux pane and run Pi automatically when cmux is available." })),
      force_launch: Type.Optional(Type.Boolean({ description: "Open a fresh cmux pane even if pi-company state still marks the agent online." })),
      force_role: Type.Optional(Type.Boolean({ description: "Allow a custom role without an existing .pi-company/roles/<role>.md file. Use only after explicit human approval." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const existing = loadState(root).agents[params.name];
      if (existing) {
        if (existing.role !== params.role) {
          throw new Error(`Agent ${params.name} already exists as role ${existing.role}, not ${params.role}.`);
        }
        const assignedIssue = assignSpawnIssueIfNeeded(root, agentName, existing, params.issue_id ?? null);
        const command = launchCommand(root, existing.name, currentExtensionPath);
        const shouldLaunch = params.launch_in_cmux !== false && (params.force_launch === true || (existing.status !== "online" && existing.status !== "running"));
        const briefing = shouldLaunch || params.launch_in_cmux === false || params.mission || assignedIssue
          ? sendLaunchBriefingIfNeeded(root, agentName, loadState(root).agents[existing.name] ?? existing, params.mission ?? null)
          : null;
        const cmuxLaunch = shouldLaunch ? launchInCmux(root, agentName, existing.name, command) : null;
        const cmux = cmuxLaunch?.surface ?? null;
        await refreshUi(ctx);
        if (cmux) {
          const verb = cmuxLaunch?.reused ? "Reused live" : "Launched existing";
          return toolResult(`${verb} ${existing.name} in ${cmux}`, { plan: existing, command, cmux, cmux_reused: cmuxLaunch?.reused ?? false, existing: true, briefing, assigned_issue: assignedIssue });
        }
        if (existing.status === "online" || existing.status === "running") {
          const notice = briefing ? `\nQueued launch briefing ${briefing.id}.` : "";
          return toolResult(`Agent ${existing.name} is already ${existing.status}.${notice} Launch command:\n${command}`, { plan: existing, command, cmux, cmux_reused: false, existing: true, briefing, assigned_issue: assignedIssue });
        }
        return toolResult(command, { plan: existing, command, cmux, cmux_reused: false, existing: true, briefing, assigned_issue: assignedIssue });
      }
      const plan = planAgentSpawn(root, params.role, params.name, params.mission ?? null, { allowUnknownRole: params.force_role === true });
      const shouldCreateWorktree = (params.role === "coder" || params.name.startsWith("coder")) && params.create_worktree !== false;
      if (shouldCreateWorktree) ensureCoderWorktree(root, plan, true);
      requestAgentSpawn(root, agentName, params.role, params.name, params.mission ?? null, { allowUnknownRole: params.force_role === true });
      registerAgent(root, {
        name: plan.name,
        role: plan.role,
        cwd: plan.cwd,
        worktree: plan.worktree,
        branch: plan.branch,
        mission: plan.mission,
        status: "planned",
      });
      const registered = loadState(root).agents[plan.name] ?? plan;
      const assignedIssue = assignSpawnIssueIfNeeded(root, agentName, registered, params.issue_id ?? null);
      const briefing = sendLaunchBriefingIfNeeded(root, agentName, loadState(root).agents[plan.name] ?? registered, params.mission ?? plan.mission);
      const command = launchCommand(root, plan.name, currentExtensionPath);
      let cmuxLaunch: CmuxLaunchResult | null = null;
      if (params.launch_in_cmux !== false) cmuxLaunch = launchInCmux(root, agentName, plan.name, command);
      const cmux = cmuxLaunch?.surface ?? null;
      await refreshUi(ctx);
      const verb = cmuxLaunch?.reused ? "Reused live" : "Launched";
      return toolResult(cmux ? `${verb} ${plan.name} in ${cmux}` : command, { plan, command, cmux, cmux_reused: cmuxLaunch?.reused ?? false, briefing, assigned_issue: assignedIssue });
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
      "For approval, set clean true only when there are no known merge blockers or caveats. If any approval caveat remains, put it in caveats instead of burying it in prose.",
    ],
    parameters: Type.Object({
      pr_id: Type.String(),
      decision: reviewDecisionSchema,
      summary: Type.String(),
      clean: Type.Optional(Type.Boolean({ description: "Explicitly mark green review evidence clean. Clean evidence must not include caveats." })),
      caveats: Type.Optional(Type.Array(Type.String({ description: "Structured caveat that blocks a green approval until resolved." }))),
      head: Type.Optional(Type.String({ description: "Commit actually reviewed; pins this evidence to that head." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      submitReview(root, agentName, params.pr_id, params.decision, params.summary, gateEvidenceParams(params), params.head ?? null);
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
      "For pass, set clean true only when validation has no caveats. Put partial coverage, skipped checks, or unresolved issues in caveats.",
    ],
    parameters: Type.Object({
      pr_id: Type.String(),
      status: testStatusSchema,
      summary: Type.String(),
      clean: Type.Optional(Type.Boolean({ description: "Explicitly mark green tester evidence clean. Clean evidence must not include caveats." })),
      caveats: Type.Optional(Type.Array(Type.String({ description: "Structured caveat that blocks a green tester pass until resolved." }))),
      head: Type.Optional(Type.String({ description: "Commit actually tested; pins this evidence to that head." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      submitTest(root, agentName, params.pr_id, params.status, params.summary, gateEvidenceParams(params), params.head ?? null);
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
      "For accept, set clean true only when product acceptance has no caveats. Put unobserved flows, skipped scope, or missing evidence in caveats.",
    ],
    parameters: Type.Object({
      pr_id: Type.String(),
      decision: acceptanceDecisionSchema,
      summary: Type.String(),
      clean: Type.Optional(Type.Boolean({ description: "Explicitly mark green acceptance evidence clean. Clean evidence must not include caveats." })),
      caveats: Type.Optional(Type.Array(Type.String({ description: "Structured caveat that blocks green product acceptance until resolved." }))),
      head: Type.Optional(Type.String({ description: "Commit actually accepted; pins this evidence to that head." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      submitAcceptance(root, agentName, params.pr_id, params.decision, params.summary, gateEvidenceParams(params), params.head ?? null);
      await refreshUi(ctx);
      return toolResult(`${agentName} submitted product acceptance ${params.decision} for ${params.pr_id}`, { pr: loadState(root).prs[params.pr_id] });
    },
  });

  pi.registerTool({
    name: "company_record_automated_tests",
    label: "Record Automated Tests",
    description: "Record automated test command outcome for a local PR.",
    promptSnippet: "Record automated test command outcome for a local PR.",
    promptGuidelines: [
      "Use company_record_automated_tests whenever automated tests are run for a local PR, whether they pass or fail.",
      "Record the command outcome truthfully. Any failed tests, partial pass counts, warnings, or pre-existing failures must be recorded as failed/blocked or stated plainly; never rewrite them as a clean pass.",
      "For passed, set clean true only when the command result has no blocking caveats. Put skipped suites, partial counts, or unresolved failures in caveats.",
    ],
    parameters: Type.Object({
      pr_id: Type.String(),
      status: automatedTestStatusSchema,
      summary: Type.String(),
      command: Type.Optional(Type.String()),
      clean: Type.Optional(Type.Boolean({ description: "Explicitly mark green automated-test evidence clean. Clean evidence must not include caveats." })),
      caveats: Type.Optional(Type.Array(Type.String({ description: "Structured caveat that blocks green automated-test evidence until resolved." }))),
      head: Type.Optional(Type.String({ description: "Commit automated tests ran against; pins this evidence to that head." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      recordAutomatedTests(root, agentName, params.pr_id, params.status, params.summary, params.command ?? null, gateEvidenceParams(params), params.head ?? null);
      await refreshUi(ctx);
      return toolResult(`Automated tests ${params.status} for ${params.pr_id}`, { pr: loadState(root).prs[params.pr_id] });
    },
  });

  pi.registerTool({
    name: "company_record_auto_tests",
    label: "Record Tests",
    description: "Record automated test command outcome for a local PR.",
    promptSnippet: "Record automated test command outcome for a local PR.",
    promptGuidelines: [
      "Backward-compatible alias for company_record_automated_tests.",
      "Record the command outcome truthfully. Any failed tests, partial pass counts, warnings, or pre-existing failures must be recorded as failed/blocked or stated plainly; never rewrite them as a clean pass.",
      "For passed, set clean true only when the command result has no blocking caveats. Put skipped suites, partial counts, or unresolved failures in caveats.",
    ],
    parameters: Type.Object({
      pr_id: Type.String(),
      status: automatedTestStatusSchema,
      summary: Type.String(),
      command: Type.Optional(Type.String()),
      clean: Type.Optional(Type.Boolean({ description: "Explicitly mark green automated-test evidence clean. Clean evidence must not include caveats." })),
      caveats: Type.Optional(Type.Array(Type.String({ description: "Structured caveat that blocks green automated-test evidence until resolved." }))),
      head: Type.Optional(Type.String({ description: "Commit automated tests ran against; pins this evidence to that head." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      recordAutomatedTests(root, agentName, params.pr_id, params.status, params.summary, params.command ?? null, gateEvidenceParams(params), params.head ?? null);
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
      return toolResult(formatPrGateToolText(params.pr_id, pr, gates), { pr, gates });
    },
  });

  pi.registerTool({
    name: "company_abandon_pr",
    label: "Abandon PR",
    description: "Abandon a stale or superseded local PR so it no longer blocks delivery.",
    promptSnippet: "Abandon a stale, duplicate, or superseded local PR.",
    promptGuidelines: [
      "Lead should use company_abandon_pr when a PR is obsolete, duplicate, or already integrated through a later PR on the same branch.",
      "Do not abandon active work to bypass review, testing, product acceptance, or known defects.",
      "When abandoning because a later PR superseded it, set superseded_by to the later PR id and explain the integration evidence in reason.",
    ],
    parameters: Type.Object({
      pr_id: Type.String(),
      reason: Type.String(),
      superseded_by: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = abandonPr(root, agentName, params.pr_id, params.reason, params.superseded_by ?? null);
      await refreshUi(ctx);
      return toolResult(`${params.pr_id} abandoned`, { pr: state.prs[params.pr_id] });
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

function gateEvidenceParams(params: { clean?: boolean; caveats?: string[] }): { clean?: boolean; caveats?: string[] } {
  return {
    clean: params.clean === true ? true : params.clean === false ? false : undefined,
    caveats: params.caveats ?? [],
  };
}

function formatPrGateToolText(prId: string, pr: PullRequestRecord | undefined, gates: { ready: boolean; blockers: string[] }): string {
  if (!pr) return `Unknown PR ${prId}`;
  const lines = [
    gates.ready ? `${prId} is ready to merge` : `${prId} blocked:`,
  ];
  if (!gates.ready) lines.push(...gates.blockers.map((blocker) => `- ${blocker}`));
  lines.push(
    "",
    "PR:",
    `- title: ${pr.title}`,
    `- issue: ${pr.issue_id ?? "none"}`,
    `- author: ${pr.author}`,
    `- branch: ${pr.branch}`,
    `- head: ${pr.head ?? "unknown"}`,
    `- status: ${pr.status}`,
    "",
    "Gate evidence:",
    `- coder_ready: ${pr.self_test && pr.test_brief ? `ready_head=${pr.ready_head ?? "unknown"}` : "missing self-test or test brief"}`,
    `  self_test: ${formatGateSummary(pr.self_test)}`,
    `  test_brief: ${formatGateSummary(pr.test_brief)}`,
    `- automated_tests: ${formatAutomatedGateEvidence(pr.automated_tests ?? null, pr.head ?? null)}`,
    ...formatReviewGateEvidence(pr.reviews, pr.head ?? null),
    ...formatTestGateEvidence(pr.tests, pr.head ?? null),
    ...formatAcceptanceGateEvidence(pr.acceptances ?? [], pr.head ?? null),
  );
  return lines.join("\n");
}

function formatReviewGateEvidence(records: PullRequestRecord["reviews"], head: string | null): string[] {
  const current = records.filter((record) => !head || record.head === head);
  if (current.length === 0) return [`- reviews: missing for current head ${shortHeadForTool(head)}`];
  return [
    "- reviews:",
    ...current.map((record) =>
      `  - ${record.decision} by ${record.reviewer} head=${shortHeadForTool(record.head)} clean=${record.clean ?? "unset"}${formatGateCaveats(record)}\n    summary: ${formatGateSummary(record.summary)}`
    ),
  ];
}

function formatTestGateEvidence(records: PullRequestRecord["tests"], head: string | null): string[] {
  const current = records.filter((record) => !head || record.head === head);
  if (current.length === 0) return [`- tests: missing for current head ${shortHeadForTool(head)}`];
  return [
    "- tests:",
    ...current.map((record) =>
      `  - ${record.status} by ${record.tester} head=${shortHeadForTool(record.head)} clean=${record.clean ?? "unset"}${formatGateCaveats(record)}\n    summary: ${formatGateSummary(record.summary)}`
    ),
  ];
}

function formatAcceptanceGateEvidence(records: NonNullable<PullRequestRecord["acceptances"]>, head: string | null): string[] {
  const current = records.filter((record) => !head || record.head === head);
  if (current.length === 0) return [`- acceptances: missing for current head ${shortHeadForTool(head)}`];
  return [
    "- acceptances:",
    ...current.map((record) =>
      `  - ${record.decision} by ${record.accepter} head=${shortHeadForTool(record.head)} clean=${record.clean ?? "unset"}${formatGateCaveats(record)}\n    summary: ${formatGateSummary(record.summary)}`
    ),
  ];
}

function formatAutomatedGateEvidence(record: PullRequestRecord["automated_tests"], head: string | null): string {
  if (!record) return `missing for current head ${shortHeadForTool(head)}`;
  const stale = head && record.head !== head ? ` stale_at=${shortHeadForTool(record.head)} current=${shortHeadForTool(head)}` : "";
  return `${record.status} head=${shortHeadForTool(record.head)} clean=${record.clean ?? "unset"}${stale}${formatGateCaveats(record)} command=${record.command ?? "none"} summary=${formatGateSummary(record.summary)}`;
}

function formatGateCaveats(record: GateEvidenceRecord): string {
  const caveats = (record.caveats ?? []).filter((item) => item.trim().length > 0);
  if (record.clean === false && caveats.length === 0) return " caveats=[clean=false]";
  if (caveats.length === 0) return "";
  return ` caveats=[${caveats.map((item) => formatGateSummary(item, 500)).join(" | ")}]`;
}

function formatGateSummary(value: string | null | undefined, max = 1200): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "none";
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function shortHeadForTool(head?: string | null): string {
  return head ? head.slice(0, 7) : "unknown";
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
    const targetChoice = await selectRequired(ctx, "Choose default or role to configure:", [
      ...targetOptions.map((option) => option.label),
      doneLabel,
    ]);
    if (targetChoice === doneLabel) break;
    const target = targetOptions.find((option) => option.label === targetChoice);
    if (!target) throw new Error("Unknown model policy target.");

    const change = await configureOneModelPolicy(root, agentName, ctx, target, modelOptions);
    changes.push(change);

    const next = await selectRequired(ctx, "Configure another model policy?", ["Configure another role/default", "Done"]);
    if (next === "Done") break;
  }

  if (changes.length === 0) return "No model policy changes.";
  return `${changes.join("\n")}\nRelaunch affected agents for changes to take effect.`;
}

function modelPolicyTargetOptions(state: CompanyState): Array<{ label: string; scope: "defaults" | "role"; name: string | null }> {
  const roles = [...new Set([
    "lead",
    "pm",
    "researcher",
    "coder",
    "reviewer",
    "tester",
    ...Object.values(state.agents).map((agent) => agent.role),
  ])].sort();
  return [
    { label: "Default model (future and unconfigured roles)", scope: "defaults", name: null },
    ...roles.map((role) => ({ label: `Role default: ${role}`, scope: "role" as const, name: role })),
  ];
}

async function configureOneModelPolicy(
  root: string,
  agentName: string,
  ctx: ExtensionContext,
  target: { label: string; scope: "defaults" | "role"; name: string | null },
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

function renderPausedDeskPanel(state: ReturnType<typeof loadState>, agentName: string): string[] {
  const agent = state.agents[agentName];
  return [
    `pi-company ${state.config?.id ?? "uninitialized"} | ${agentName} (${agent?.role ?? "unknown"})`,
    "context: paused | ordinary Pi mode in this session",
    "automation: inbox delivery, provider gates, tool guards, and company system prompt are paused",
    "resume: run /company-resume to restore company context",
  ];
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

function renderStatus(root: string, state: ReturnType<typeof loadState>): string {
  const agents = Object.values(state.agents)
    .map((agent) => `- ${agent.name} (${agent.role}) ${agent.status}${agent.current_task ? ` task=${agent.current_task}` : ""}`)
    .join("\n");
  const issues = Object.values(state.issues)
    .map((issue) => `- ${issue.id} ${issue.status}${issue.work_type ? ` ${issue.work_type}` : ""} ${issue.title}${issue.owner ? ` -> ${issue.owner}` : ""}`)
    .join("\n") || "- none";
  const prs = Object.values(state.prs)
    .map((pr) => {
      const pending = pr.merge_requested_at && pr.status !== "merged" && pr.status !== "blocked"
        ? ` pending_merge_since=${pr.merge_requested_at}`
        : "";
      const gates = getPrGateStatus(root, pr.id);
      const hasCoderReadyEvidence = Boolean(pr.self_test?.trim() && pr.test_brief?.trim());
      const coderReady = hasCoderReadyEvidence ? " coder_ready=yes" : " coder_ready=no";
      const blockers = gates.ready
        ? " gates=green"
        : ` gate_blockers=${gates.blockers.join("; ") || "unknown"}`;
      return `- ${pr.id} ${pr.status}${coderReady}${pending} ${blockers} ${pr.title}`;
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

function assignSpawnIssueIfNeeded(root: string, actor: string, agent: AgentRecord, requestedIssueId: string | null): IssueRecord | null {
  const state = loadState(root);
  const requestedIssue = requestedIssueId ? state.issues[requestedIssueId] : null;
  if (requestedIssueId && !requestedIssue) throw new Error(`Unknown issue ${requestedIssueId}`);
  const issue = requestedIssue ?? inferSpawnIssue(state, agent);
  if (!issue) return null;
  if (issue.owner === agent.name) return issue;
  if (issue.owner && !requestedIssueId) return null;
  assignIssue(root, actor, issue.id, agent.name);
  return loadState(root).issues[issue.id] ?? issue;
}

function assignAndLaunchIfNeeded(root: string, actor: string, owner: string, issueId: string): { command: string; cmux: string | null; cmux_reused: boolean; briefing: MailboxMessage | null } | null {
  assignIssue(root, actor, issueId, owner);
  const state = loadState(root);
  const agent = state.agents[owner];
  if (!agent || owner === actor || agent.status === "online" || agent.status === "running") return null;
  const briefing = sendLaunchBriefingIfNeeded(root, actor, agent);
  const command = launchCommand(root, owner, currentExtensionPath);
  const delaySeconds = autoLaunchDelaySeconds(state, owner);
  const delayedCommand = delaySeconds > 0 ? `sleep ${delaySeconds}; ${command}` : command;
  const launch = launchInCmux(root, actor, owner, delayedCommand);
  return { command, cmux: launch?.surface ?? null, cmux_reused: launch?.reused ?? false, briefing };
}

function autoLaunchDelaySeconds(state: CompanyState, owner: string): number {
  const lead = state.config?.lead ?? "lead";
  const activeNonLead = Object.values(state.agents)
    .filter((agent) => agent.name !== lead && agent.name !== owner && (agent.status === "online" || agent.status === "running"))
    .length;
  return Math.min(45, activeNonLead * 12);
}

function inferSpawnIssue(state: CompanyState, agent: AgentRecord): IssueRecord | null {
  const isCoder = agent.role === "coder" || agent.name.startsWith("coder");
  if (!isCoder) return null;
  const unownedOpenIssues = Object.values(state.issues)
    .filter((issue) => issue.status !== "done" && !issue.owner)
    .sort((left, right) => left.id.localeCompare(right.id));
  return unownedOpenIssues.length === 1 ? unownedOpenIssues[0] : null;
}

function sendLaunchBriefingIfNeeded(root: string, from: string, agent: AgentRecord, mission?: string | null): MailboxMessage | null {
  const state = loadState(root);
  const issues = outstandingIssuesForAgent(state, agent.name);
  const explicitMission = (mission ?? "").trim();
  const fallbackMission = issues.length === 0 ? (agent.mission ?? "").trim() : "";
  const missionText = explicitMission || fallbackMission;
  if (issues.length === 0 && !missionText) return null;

  const primary = issues[0] ?? null;
  const alreadyQueued = listInbox(root, agent.name).some((message) =>
    message.type === "assignment" &&
    (primary ? message.task === primary.id : message.task === null) &&
    message.text.includes("[pi-company launch briefing]")
  );
  if (alreadyQueued) return null;

  const workContext = [
    agent.worktree ? `Worktree: ${agent.worktree}` : null,
    agent.branch ? `Branch: ${agent.branch}` : null,
  ].filter(Boolean).join("\n");
  const issueList = issues.length > 0 ? issues.map(formatIssueBrief).join("\n") : "(no issue assigned yet)";
  const text = `[pi-company launch briefing]

You were launched with work context.

Mission:
${missionText || "(use the assigned work below)"}

Assigned work:
${issueList}
${workContext ? `\n${workContext}\n` : ""}
${agent.worktree ? `Write implementation files inside your assigned worktree. If an issue or mission names an absolute path under the project root, translate it to the same relative path inside the worktree before writing or editing.\n` : ""}
Start or continue the appropriate issue with company_task_update, inspect the local project files you need, and report blockers or PR readiness through the normal pi-company tools.`;

  return sendCompanyMessage(root, {
    from,
    to: agent.name,
    type: "assignment",
    task: primary?.id ?? null,
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
  return `- ${issue.id} ${issue.status}${issue.work_type ? ` ${issue.work_type}` : ""}: ${issue.title}`;
}

function launchInCmux(root: string, actor: string, agentName: string, command: string): CmuxLaunchResult | null {
  const state = loadState(root);
  const existing = state.agents[agentName];
  const liveSurface = findLiveCmuxSurfaceForAgent(root, state.config?.id ?? "not initialized", agentName, existing?.cmux_surface ?? null);
  if (liveSurface) {
    recordAgentLaunch(root, actor, agentName, liveSurface.ref);
    return { surface: liveSurface.ref, reused: true };
  }
  const context = currentCmuxContext();
  const newPaneArgs = ["--json", "new-pane", "--type", "terminal", "--direction", "right", "--focus", "false"];
  appendCmuxContextArgs(newPaneArgs, context);
  const pane = runCmux(newPaneArgs);
  if (pane.status !== 0) return null;
  const surface = parseCmuxSurfaceRef(pane.stdout);
  if (!surface) return null;
  const sendArgs = ["send", "--surface", surface];
  appendCmuxContextArgs(sendArgs, context);
  sendArgs.push(command);
  const send = runCmux(sendArgs);
  const enterArgs = ["send-key", "--surface", surface];
  appendCmuxContextArgs(enterArgs, context);
  enterArgs.push("Enter");
  const enter = send.status === 0 ? runCmux(enterArgs) : send;
  if (send.status !== 0 || enter.status !== 0) {
    closeCmuxSurface(surface, context);
    return null;
  }
  if (!waitForCmuxSurfaceReadable(surface, context)) {
    closeCmuxSurface(surface, context);
    return null;
  }
  recordAgentLaunch(root, actor, agentName, surface);
  return { surface, reused: false };
}

function currentCmuxContext(): CmuxContext {
  const identified = runCmux(["identify", "--json"]);
  if (identified.status !== 0 || !identified.stdout.trim()) return {};
  try {
    const parsed = JSON.parse(identified.stdout) as Record<string, unknown>;
    const caller = parsed.caller && typeof parsed.caller === "object" ? parsed.caller as Record<string, unknown> : null;
    return {
      window_ref: typeof caller?.window_ref === "string" ? caller.window_ref : null,
      workspace_ref: typeof caller?.workspace_ref === "string" ? caller.workspace_ref : null,
    };
  } catch {
    return {};
  }
}

function appendCmuxContextArgs(args: string[], context: CmuxContext): void {
  if (context.workspace_ref) args.push("--workspace", context.workspace_ref);
  if (context.window_ref) args.push("--window", context.window_ref);
}

function waitForCmuxSurfaceReadable(surface: string, context: CmuxContext): boolean {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const args = ["read-screen", "--surface", surface, "--lines", "20"];
    appendCmuxContextArgs(args, context);
    const read = runCmux(args);
    if (read.status === 0) return true;
    sleepSync(400);
  }
  return false;
}

function closeCmuxSurface(surface: string, context: CmuxContext): void {
  const args = ["close-surface", "--surface", surface];
  appendCmuxContextArgs(args, context);
  runCmux(args);
}

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function currentCmuxSurfaceRef(root: string, agentName: string): string | null {
  const identified = runCmux(["identify", "--json"]);
  if (identified.status === 0 && identified.stdout.trim()) {
    try {
      const parsed = JSON.parse(identified.stdout) as Record<string, unknown>;
      const caller = parsed.caller && typeof parsed.caller === "object" ? parsed.caller as Record<string, unknown> : null;
      const surface = caller?.surface_ref;
      if (typeof surface === "string" && surface.trim()) {
        const liveSurface: LiveCmuxSurface = {
          ref: surface.trim(),
          title: null,
          window_ref: typeof caller?.window_ref === "string" ? caller.window_ref : null,
          workspace_ref: typeof caller?.workspace_ref === "string" ? caller.workspace_ref : null,
          pane_ref: typeof caller?.pane_ref === "string" ? caller.pane_ref : null,
        };
        if (cmuxSurfaceLooksLikeCurrentAgent(liveSurface, root, agentName)) return liveSurface.ref;
      }
    } catch {
      // Fall back to cmux environment variables below.
    }
  }
  const envSurface = process.env.CMUX_SURFACE_ID?.trim();
  if (!envSurface) return null;
  const liveSurface: LiveCmuxSurface = { ref: envSurface, title: null };
  return cmuxSurfaceLooksLikeCurrentAgent(liveSurface, root, agentName) ? envSurface : null;
}

function cmuxSurfaceLooksLikeCurrentAgent(surface: LiveCmuxSurface, root: string, agentName: string): boolean {
  const args = ["read-screen", "--surface", surface.ref, "--scrollback", "--lines", "240"];
  if (surface.workspace_ref) args.push("--workspace", surface.workspace_ref);
  if (surface.window_ref) args.push("--window", surface.window_ref);
  const read = runCmux(args);
  if (read.status !== 0 || !read.stdout.trim()) return false;
  const resolvedRoot = path.resolve(root);
  const normalized = read.stdout.replace(/\s+/g, " ");
  const compact = read.stdout.replace(/\s+/g, "");
  const compactRoot = resolvedRoot.replace(/\s+/g, "");
  const hasRoot = compact.includes(compactRoot) ||
    normalized.includes(`PI_COMPANY_ROOT='${resolvedRoot}'`) ||
    normalized.includes(`--company-root '${resolvedRoot}'`) ||
    normalized.includes(`--company-root ${resolvedRoot}`);
  const hasAgent = normalized.includes(`PI_COMPANY_AGENT='${agentName}'`) ||
    normalized.includes(`--company-agent '${agentName}'`) ||
    normalized.includes(`--company-agent ${agentName}`) ||
    compact.includes(`|${agentName}(`);
  return hasRoot && hasAgent;
}

function findLiveCmuxSurfaceForAgent(root: string, companyId: string, agentName: string, preferredRef: string | null): LiveCmuxSurface | null {
  const surfaces = currentLiveCmuxSurfaces();
  if (surfaces.length === 0) return null;
  const title = `pi-company ${agentName}`;
  const matches = surfaces.filter((surface) =>
    (surface.ref === preferredRef && surface.title === title) ||
    surface.title === title && cmuxSurfaceBelongsToCompany(surface, root, companyId, agentName)
  );
  if (matches.length === 0) return null;
  if (preferredRef) {
    const preferred = matches.find((surface) => surface.ref === preferredRef);
    if (preferred) return preferred;
  }
  return matches.find((surface) => surface.active || surface.focused) ?? matches.at(-1) ?? null;
}

function cmuxSurfaceBelongsToCompany(surface: LiveCmuxSurface, root: string, companyId: string, agentName: string): boolean {
  const args = ["read-screen", "--surface", surface.ref, "--scrollback", "--lines", "200"];
  if (surface.workspace_ref) args.push("--workspace", surface.workspace_ref);
  if (surface.window_ref) args.push("--window", surface.window_ref);
  const read = runCmux(args);
  if (read.status !== 0 || !read.stdout.trim()) return false;
  const normalized = read.stdout.replace(/\s+/g, " ");
  const compact = read.stdout.replace(/\s+/g, "");
  const resolvedRoot = path.resolve(root);
  const compactRoot = resolvedRoot.replace(/\s+/g, "");
  const compactCompanyAgent = `pi-company${companyId}|${agentName}`;
  return compact.includes(compactCompanyAgent) ||
    compact.includes(compactRoot) ||
    normalized.includes(`PI_COMPANY_ROOT='${resolvedRoot}'`) ||
    normalized.includes(`--company-root '${resolvedRoot}'`) ||
    normalized.includes(`--company-root ${resolvedRoot}`);
}

function currentLiveCmuxSurfaces(): LiveCmuxSurface[] {
  const tree = runCmux(["tree", "--all", "--json"]);
  if (tree.status !== 0 || !tree.stdout.trim()) return [];
  try {
    const parsed = JSON.parse(tree.stdout) as unknown;
    const surfaces: LiveCmuxSurface[] = [];
    collectLiveCmuxSurfaces(parsed, surfaces, {});
    return surfaces;
  } catch {
    return [];
  }
}

function collectLiveCmuxSurfaces(
  value: unknown,
  surfaces: LiveCmuxSurface[],
  context: { window_ref?: string | null; workspace_ref?: string | null; pane_ref?: string | null },
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectLiveCmuxSurfaces(item, surfaces, context);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const ref = record.ref;
  const nextContext = { ...context };
  if (typeof ref === "string") {
    if (ref.startsWith("window:")) nextContext.window_ref = ref;
    if (ref.startsWith("workspace:")) nextContext.workspace_ref = ref;
    if (ref.startsWith("pane:")) nextContext.pane_ref = ref;
  }
  if (typeof ref === "string" && ref.startsWith("surface:")) {
    surfaces.push({
      ref,
      title: typeof record.title === "string" ? record.title : null,
      window_ref: nextContext.window_ref ?? null,
      workspace_ref: nextContext.workspace_ref ?? null,
      pane_ref: typeof record.pane_ref === "string" ? record.pane_ref : nextContext.pane_ref ?? null,
      active: typeof record.active === "boolean" ? record.active : undefined,
      focused: typeof record.focused === "boolean" ? record.focused : undefined,
    });
  }
  for (const item of Object.values(record)) collectLiveCmuxSurfaces(item, surfaces, nextContext);
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
