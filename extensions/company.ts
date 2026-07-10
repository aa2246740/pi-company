import fs from "node:fs";
import os from "node:os";
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
  buildOkfExportGateReport,
  clearRateLimit,
  completeTask,
  createIssue,
  createPr,
  createSprintContract,
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
  normalizeAdvisorPolicy,
  normalizeLifecyclePolicy,
  pendingMergeRequests,
  planAgentSpawn,
  recordConsumptionManifest,
  recordEvent,
  recordPreflightReport,
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
  renderDeliveryOkfReport,
  renderOkfExportGateReport,
  renderRoleOkfWorkingSet,
  renderLeadBrief,
  sendCompanyMessage,
  shouldAutoDeliverMessage,
  startTask,
  setModelPolicy,
  submitAcceptance,
  submitEvaluationFinding,
  submitReview,
  submitTest,
  transitionDeliveryOkfLifecycle,
  writeRoleBundle,
  writeStructuredHandoff,
} from "../src/core/company.js";
import {
  AdvisorRuntimeError,
  resolveAdvisorTarget,
  runAdvisorCompletion,
  type AdvisorModelRegistry,
} from "../src/core/advisor-runtime.js";
import {
  ADVISOR_AUTHORITY_GUIDANCE,
  ADVISOR_INVOCATION_GUIDANCE,
  buildAdvisorTranscript,
  type PiSessionEntry,
} from "../src/core/advisor.js";
import {
  activeRoleBundleIds,
  listDeliveryOkfInventory,
  queryOkfBundle,
  readDeliveryOkfConcept,
  renderDeliveryOkfInventory,
  renderOkfQueryReport,
  renderOkfValidationReport,
  validateOkfBundle,
} from "../src/core/okf.js";
import { checkOkfConsumption } from "../src/core/company.js";
import { parseCmuxSurfaceRef } from "../src/core/cmux.js";
import {
  acquireProviderRequestLease,
  releaseProviderRequestLease,
  type ProviderRequestLease,
} from "../src/core/provider-queue.js";
import { classifyRateLimitText } from "../src/core/rate-limit.js";
import { DEFAULT_ROLES } from "../src/core/defaults.js";
import { makeEvent } from "../src/core/events.js";
import { companyPaths } from "../src/core/paths.js";
import type { AgentRecord, CompanyState, GateEvidenceRecord, IssueRecord, IssueWorkType, MailboxMessage, PiModelConfig, PullRequestRecord } from "../src/core/types.js";

const currentExtensionPath = fileURLToPath(import.meta.url);
const ADVISOR_TOOL_NAME = "company_consult_advisor";
const ADVISOR_SESSION_ENTRY_TYPE = "pi-company.advisor-mode";

type AdvisorSessionOverride = "default" | "off" | "auto" | "once";
type EffectiveAdvisorMode = Exclude<AdvisorSessionOverride, "default">;

interface AdvisorModeState {
  effective: EffectiveAdvisorMode;
  override: AdvisorSessionOverride;
  projectDefault: Exclude<EffectiveAdvisorMode, "once">;
  eligible: boolean;
}

interface AdvisorUseState {
  use: number;
  oneShotConsumed: boolean;
  persistenceError: string | null;
}

interface AdvisorUseReservation {
  revision: number;
}

type AdvisorUseClaimErrorCode = "advisor_mode_changed" | "advisor_disabled" | "limit_reached";

class AdvisorUseClaimError extends Error {
  constructor(readonly code: AdvisorUseClaimErrorCode, message: string) {
    super(message);
    this.name = "AdvisorUseClaimError";
  }
}

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

const okfDeliveryKindSchema = Type.Union([
  Type.Literal("contract"),
  Type.Literal("evaluation"),
  Type.Literal("handoff"),
  Type.Literal("role-bundle"),
  Type.Literal("consumption"),
  Type.Literal("preflight"),
]);

const sprintContractStatusSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("active"),
  Type.Literal("fulfilled"),
  Type.Literal("superseded"),
  Type.Literal("abandoned"),
]);

const evaluationFindingKindSchema = Type.Union([
  Type.Literal("review"),
  Type.Literal("test"),
  Type.Literal("acceptance"),
  Type.Literal("system"),
]);

const evaluationFindingVerdictSchema = Type.Union([
  Type.Literal("pass"),
  Type.Literal("fail"),
  Type.Literal("blocked"),
  Type.Literal("comment"),
  Type.Literal("approve"),
  Type.Literal("request_changes"),
  Type.Literal("accept"),
]);

const evaluationFindingSeveritySchema = Type.Union([
  Type.Literal("blocking"),
  Type.Literal("improvement"),
  Type.Literal("note"),
]);

const evaluationFindingStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("resolved"),
  Type.Literal("superseded"),
]);

const preflightVerdictSchema = Type.Union([
  Type.Literal("pass"),
  Type.Literal("fail"),
  Type.Literal("blocked"),
]);

const okfLifecycleStatusSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("proposed"),
  Type.Literal("accepted"),
  Type.Literal("active"),
  Type.Literal("consumed"),
  Type.Literal("resolved"),
  Type.Literal("fulfilled"),
  Type.Literal("stale"),
  Type.Literal("superseded"),
  Type.Literal("retired"),
  Type.Literal("archived"),
  Type.Literal("abandoned"),
]);

const roleBundleKindSchema = Type.Union([
  Type.Literal("product_quality_bar"),
  Type.Literal("gameplay_design"),
  Type.Literal("visual_art_direction"),
  Type.Literal("research_brief"),
]);

const rateLimitKindSchema = Type.Union([
  Type.Literal("provider_429"),
  Type.Literal("quota_exhausted"),
  Type.Literal("manual"),
]);

const AUTOMATIC_RATE_LIMIT_DEDUPE_MS = 15_000;
const BUSY_DELIVERY_BACKOFF_MS = 15_000;
const WATCHDOG_FALLBACK_MS = 60_000;
const CMUX_COMMAND_TIMEOUT_MS = 2_000;

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
  let advisorUsesThisTurn = 0;
  let advisorSessionOverride: AdvisorSessionOverride = "default";
  let advisorModeRevision = 0;
  let advisorToolAllowedAtStartup: boolean | null = null;
  const advisorUseReservations = new Set<AdvisorUseReservation>();

  function isCompanyActive(): boolean {
    return loadConfig(root) !== null;
  }

  function requireCompany(): void {
    if (!isCompanyActive()) throw new Error(noCompanyMessage(root));
  }

  function notifyNoCompany(ctx: ExtensionContext): void {
    if (ctx.hasUI) ctx.ui.notify(noCompanyMessage(root), "info");
  }

  function currentRole(): string {
    return loadState(root).agents[agentName]?.role ?? role;
  }

  function advisorModeState(): AdvisorModeState {
    const projectDefault = normalizeAdvisorPolicy(loadConfig(root)?.advisor_policy).enabled ? "auto" : "off";
    const eligible = isAdvisorExecutor(agentName, currentRole(), lead);
    return {
      effective: !eligible
        ? "off"
        : advisorSessionOverride === "default"
          ? projectDefault
          : advisorSessionOverride,
      override: advisorSessionOverride,
      projectDefault,
      eligible,
    };
  }

  function syncAdvisorToolAvailability(options: {
    forceEnable?: boolean;
    respectStartupSelection?: boolean;
  } = {}): void {
    if (!toolsRegistered) return;
    const state = advisorModeState();
    const activeTools = pi.getActiveTools();
    const isActive = activeTools.includes(ADVISOR_TOOL_NAME);
    const startupExcluded = options.respectStartupSelection && advisorToolAllowedAtStartup === false;
    const shouldBeActive = state.eligible && state.effective !== "off" && !startupExcluded;
    if (!shouldBeActive && isActive) {
      pi.setActiveTools(activeTools.filter((name) => name !== ADVISOR_TOOL_NAME));
    } else if (shouldBeActive && options.forceEnable && !isActive) {
      pi.setActiveTools([...activeTools, ADVISOR_TOOL_NAME]);
    }
  }

  function syncAdvisorToolForOverride(): void {
    if (advisorSessionOverride === "default") {
      syncAdvisorToolAvailability({
        forceEnable: advisorToolAllowedAtStartup === true,
        respectStartupSelection: true,
      });
      return;
    }
    syncAdvisorToolAvailability({ forceEnable: true });
  }

  function restoreAdvisorSessionOverride(ctx: ExtensionContext): void {
    advisorSessionOverride = "default";
    try {
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== "custom" || entry.customType !== ADVISOR_SESSION_ENTRY_TYPE) continue;
        const mode = advisorSessionOverrideFromUnknown(entry.data);
        if (mode) {
          advisorSessionOverride = mode;
        }
      }
    } catch {
      // Ephemeral/test sessions may not have a readable branch yet.
    }
  }

  function persistAdvisorSessionOverride(mode: AdvisorSessionOverride): void {
    pi.appendEntry(ADVISOR_SESSION_ENTRY_TYPE, { mode });
  }

  function setAdvisorSessionOverride(mode: AdvisorSessionOverride, persist = true): void {
    advisorSessionOverride = mode;
    advisorModeRevision += 1;
    syncAdvisorToolForOverride();
    if (persist) persistAdvisorSessionOverride(mode);
  }

  function reserveAdvisorUse(maxUsesPerTurn: number, expectedRevision: number): AdvisorUseReservation {
    if (advisorModeRevision !== expectedRevision) {
      throw new AdvisorUseClaimError(
        "advisor_mode_changed",
        "Advisor dispatch was canceled because the session mode or active branch changed before the provider request started.",
      );
    }
    const mode = advisorModeState().effective;
    if (mode === "off") {
      throw new AdvisorUseClaimError(
        "advisor_disabled",
        "Advisor dispatch was canceled because advisor mode is off for this Pi session.",
      );
    }
    const turnLimitReserved = advisorUsesThisTurn + advisorUseReservations.size >= maxUsesPerTurn;
    const oneShotAlreadyReserved = mode === "once" && advisorUseReservations.size > 0;
    if (turnLimitReserved || oneShotAlreadyReserved) {
      throw new AdvisorUseClaimError(
        "limit_reached",
        `Advisor use limit reached for this executor turn (${maxUsesPerTurn}).`,
      );
    }
    const reservation = { revision: expectedRevision };
    advisorUseReservations.add(reservation);
    return reservation;
  }

  function commitAdvisorUse(reservation: AdvisorUseReservation, maxUsesPerTurn: number): AdvisorUseState {
    if (!advisorUseReservations.delete(reservation) || advisorModeRevision !== reservation.revision) {
      throw new AdvisorUseClaimError(
        "advisor_mode_changed",
        "Advisor dispatch was canceled because the session mode or active branch changed before the provider payload was ready.",
      );
    }
    const mode = advisorModeState().effective;
    if (mode === "off") {
      throw new AdvisorUseClaimError(
        "advisor_disabled",
        "Advisor dispatch was canceled because advisor mode is off for this Pi session.",
      );
    }
    if (advisorUsesThisTurn >= maxUsesPerTurn) {
      throw new AdvisorUseClaimError(
        "limit_reached",
        `Advisor use limit reached for this executor turn (${maxUsesPerTurn}).`,
      );
    }
    advisorUsesThisTurn += 1;
    const oneShotConsumed = mode === "once";
    let persistenceError: string | null = null;
    if (oneShotConsumed) {
      advisorSessionOverride = "off";
      advisorModeRevision += 1;
      syncAdvisorToolForOverride();
      try {
        persistAdvisorSessionOverride("off");
      } catch (error) {
        persistenceError = errorMessage(error);
      }
    }
    return { use: advisorUsesThisTurn, oneShotConsumed, persistenceError };
  }

  function releaseAdvisorUseReservation(reservation: AdvisorUseReservation): void {
    advisorUseReservations.delete(reservation);
  }

  function advisorStatusText(): string {
    const state = advisorModeState();
    if (!state.eligible) {
      return `Advisor mode is not available for ${currentRole()} sessions. Lead/coder executors may consult it; reviewer/tester roles stay independent.`;
    }
    const config = loadConfig(root);
    const target = config?.model_policy?.roles?.advisor;
    const model = target?.provider && target?.model
      ? `${target.provider}/${target.model}${target.thinking ? ` (thinking:${target.thinking})` : ""}`
      : "not configured";
    const source = state.override === "default"
      ? `project default (${state.projectDefault})`
      : `session override (${state.override}); project default ${state.projectDefault}`;
    const tool = pi.getActiveTools().includes(ADVISOR_TOOL_NAME) ? "active" : "hidden";
    const limit = normalizeAdvisorPolicy(config?.advisor_policy).max_uses_per_turn;
    return `Advisor mode: ${state.effective} · ${source} · tool ${tool} · model ${model} · turn use ${advisorUsesThisTurn}/${limit}.`;
  }

  function ensureCompanyToolsRegistered(): void {
    if (!isCompanyActive() || toolsRegistered) return;
    registerTools(pi, {
      root,
      agentName,
      role,
      lead,
      isPaused: () => companyPaused,
      advisorMode: () => advisorModeState().effective,
      advisorModeRevision: () => advisorModeRevision,
      advisorUsesThisTurn: () => advisorUsesThisTurn,
      reserveAdvisorUse,
      commitAdvisorUse,
      releaseAdvisorUseReservation,
      waitForProviderBackoff,
      reportAutomaticRateLimit,
      refreshUi,
    });
    toolsRegistered = true;
    advisorToolAllowedAtStartup = pi.getActiveTools().includes(ADVISOR_TOOL_NAME);
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

  function reportAutomaticRateLimit(kind: "provider_429" | "quota_exhausted", reason: string, provider?: string | null) {
    const now = Date.now();
    if (now - lastAutomaticRateLimitReportAt < AUTOMATIC_RATE_LIMIT_DEDUPE_MS) {
      return loadState(root);
    }
    // Stamp the dedupe window only after a successful report. If reportRateLimit
    // throws (e.g. lock contention), a failed report must not suppress the next
    // 429 and leave the org hammering a rate-limited provider with no backoff.
    const state = reportRateLimit(root, agentName, reason, kind, undefined, { provider });
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
    const advisorHint = isAdvisorExecutor(agentName, displayRole, lead)
      ? ` · advisor:${advisorModeState().effective}`
      : "";
    ctx.ui.setStatus("pi-company", `${agentName}/${displayRole} inbox:${inbox} · ${contextHint}${advisorHint}`);
    ctx.ui.setWidget("pi-company", renderDeskPanel(state, agentName, manuallyRefreshedThisSession), { placement: "belowEditor" });
  }

  async function deliverInbox(ctx: ExtensionContext, mode: "auto" | "manual" = "auto"): Promise<void> {
    if (companyPaused) return;
    if (!isCompanyActive()) return;
    // Print/JSON modes already own their initial turn. Starting another user
    // turn from session_start races the CLI prompt; headless agents can read
    // the queued mailbox through company_inbox instead.
    if (mode === "auto" && !ctx.hasUI) return;
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
    if (!ctx.hasUI) return;
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
    if (!ctx.hasUI) return;
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
      restoreAdvisorSessionOverride(ctx);
      syncAdvisorToolAvailability({ respectStartupSelection: true });
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

  pi.on("session_tree", async (_event, ctx) => {
    if (!isCompanyActive()) return;
    advisorUsesThisTurn = 0;
    advisorUseReservations.clear();
    advisorModeRevision += 1;
    restoreAdvisorSessionOverride(ctx);
    syncAdvisorToolForOverride();
    await refreshUi(ctx);
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
    const provider = providerNameFromRequest(event, ctx);
    await waitForProviderBackoff(ctx, provider);
    recordLiveRuntime({ status: "busy", turn_started: true });
    const state = loadState(root);
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
    const provider = providerNameFromRequest(event, ctx);
    const state = reportAutomaticRateLimit("provider_429", `Provider HTTP 429 from ${provider}.${retryAfter}`.trim(), provider);
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
    if (companyPaused) {
      if (isCompanyToolName(event.toolName)) {
        return {
          block: true,
          reason: "pi-company is paused in this Pi session. Do not use company tools until the human runs /company-resume; continue as ordinary Pi with normal tools.",
        };
      }
      return undefined;
    }
    const state = loadState(root);
    const agent = state.agents[agentName];
    const blockReason = agentName === lead
      ? leadToolBlockReason(event, root)
      : workerToolBlockReason(event, agent, root);
    return blockReason ? { block: true, reason: blockReason } : undefined;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!isCompanyActive()) return undefined;
    advisorUsesThisTurn = 0;
    advisorUseReservations.clear();
    if (companyPaused) {
      await refreshUi(ctx);
      return {
        systemPrompt: `${event.systemPrompt}

${renderCompanyPausedSystemPrompt(agentName, role)}`,
      };
    }
    await refreshUi(ctx);
    return {
      systemPrompt: `${event.systemPrompt}

${renderCompanySystemPrompt(root, agentName, role, lead)}`,
    };
  });

  async function waitForProviderBackoff(ctx: ExtensionContext, provider: string): Promise<void> {
    for (;;) {
      const state = loadState(root);
      if (!providerBackoffAppliesToRequest(state, provider)) return;
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

  pi.registerCommand("company-advisor", {
    description: "Control advisor availability for this Pi session: off, auto, once, default, status",
    getArgumentCompletions: (prefix) => {
      const options = ["off", "auto", "on", "once", "default", "status"]
        .filter((value) => value.startsWith(prefix.trim().toLowerCase()))
        .map((value) => ({ value, label: value }));
      return options.length > 0 ? options : null;
    },
    handler: async (args, ctx) => {
      if (!isCompanyActive()) {
        notifyNoCompany(ctx);
        return;
      }
      const state = advisorModeState();
      if (!state.eligible) {
        if (ctx.hasUI) ctx.ui.notify(advisorStatusText(), "info");
        return;
      }
      const requested = args.trim().toLowerCase();
      const mode = requested === "on" ? "auto" : requested || "status";
      if (mode === "status") {
        if (ctx.hasUI) ctx.ui.notify(advisorStatusText(), "info");
        return;
      }
      if (!isAdvisorSessionOverride(mode)) {
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /company-advisor off|auto|once|default|status", "error");
        }
        return;
      }
      setAdvisorSessionOverride(mode);
      await refreshUi(ctx);
      if (ctx.hasUI) ctx.ui.notify(advisorStatusText(), "info");
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
      syncAdvisorToolAvailability({ respectStartupSelection: true });
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
    await pi.sendUserMessage(
      renderManualBriefRefreshPrompt(root, agentName, role, lead),
      { deliverAs: "followUp" },
    );
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
      if (ctx.hasUI) ctx.ui.notify("pi-company paused for this Pi session. Ordinary Pi tools are enabled; company tools are blocked until /company-resume.", "info");
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

function isCompanyToolName(toolName: string): boolean {
  return toolName.startsWith("company_");
}

function leadToolBlockReason(event: { toolName: string; input: Record<string, unknown> }, root: string): string | null {
  if (event.toolName === "read") {
    const target = typeof event.input.path === "string" ? resolveToolPath(event.input.path, root) : "";
    if (!target) return null;
    if (isSafeTempDocumentationPath(target)) return null;
    const rel = projectRelativePath(root, target);
    if (rel && isNonRunnableDocumentationPath(rel)) return null;
    if (rel && isRunnableOrBehaviorChangingPath(rel)) {
      return "pi-company lead cannot read implementation/config/test/assets directly. Use company status/PR gate tools, then delegate investigation to coder/tester/reviewer so lead stays orchestration-focused.";
    }
  }
  if (event.toolName === "write" || event.toolName === "edit") {
    const target = typeof event.input.path === "string" ? resolveToolPath(event.input.path, root) : "";
    if (target && isSafeTempDocumentationPath(target)) return null;
    if (target) {
      const rel = projectRelativePath(root, target);
      if (rel && isNonRunnableDocumentationPath(rel)) return null;
    }
    return "pi-company lead cannot write runnable or behavior-changing project files directly. Delegate implementation/config/test/assets to the responsible worker, or run /company-pause for an explicit ordinary-Pi maintenance escape hatch.";
  }
  if (event.toolName === "bash") {
    const command = typeof event.input.command === "string" ? event.input.command : "";
    if (isAllowedTempDocumentationBashCommand(command)) return null;
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
    if (isSafeTempDocumentationPath(target)) return null;
    if (agent.role === "coder" || agent.name.startsWith("coder")) {
      const scope = coderMutationScope(agent, root);
      if (!scope.allowed) return scope.reason;
      if (!isPathInside(target, scope.root)) {
        return `pi-company coder ${agent.name} can write only inside its ${scope.label} (${scope.root}).`;
      }
      if (scope.rootScoped && isProtectedProjectControlPath(root, target)) {
        return `pi-company root-scoped coder ${agent.name} cannot write pi-company or git control paths.`;
      }
      // OKF enforcement (hook/gate-first): block implementation writes until the
      // coder has a fresh ConsumptionManifest for the active contract. This is the
      // agent-internal mirror of the git pre-push export gate. Permits .pi-company
      // and control paths so the manifest/role-bundle can be written first.
      const okfBlock = okfConsumptionBlockReason(root, target, agent);
      if (okfBlock) return okfBlock;
      return null;
    }
    const allowed = nonCoderAllowedWriteReason(agent, target, root);
    if (!allowed.allowed) return allowed.reason;
  }
  if (event.toolName === "bash") {
    const command = typeof event.input.command === "string" ? event.input.command : "";
    if (isAllowedTempDocumentationBashCommand(command)) return null;
    if (agent.role === "coder" || agent.name.startsWith("coder")) {
      return coderBashBlockReason(command, agent, root);
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

type CoderMutationScope =
  | { allowed: true; root: string; label: string; rootScoped: boolean }
  | { allowed: false; reason: string };

function okfConsumptionBlockReason(root: string, target: string, agent: AgentRecord): string | null {
  // Only enforce when there is a pi-company project AND the write targets real
  // implementation files (not .pi-company knowledge itself).
  if (!fs.existsSync(path.join(root, ".pi-company"))) return null;
  const piCompanyDir = path.join(root, ".pi-company");
  const normalized = path.resolve(target);
  if (normalized === piCompanyDir || normalized.startsWith(piCompanyDir + path.sep)) return null;
  // Only one contract is expected to be active at a time; check it.
  let contractId: string | null = null;
  try {
    const concepts = listDeliveryOkfInventory(root, { kind: "contract", includeInactive: false });
    const active = concepts.find((entry) => entry.status === "active");
    if (!active) return null;
    contractId = active.id;
  } catch {
    return null;
  }
  let check;
  try {
    check = checkOkfConsumption(root, contractId);
  } catch {
    return null;
  }
  if (check.fresh) return null;
  const reConsume = check.manifest_id
    ? `Re-consume updated bundles: \`okf use coder --contract ${contractId} --consume-as ${agent.name} --manifest ${check.manifest_id} --update\`.`
    : `Record consumption: \`okf use coder --contract ${contractId} --consume-as ${agent.name}\`.`;
  return `pi-company OKF enforcement: cannot edit implementation until OKF context is consumed. ${check.reason ?? ""} ${reConsume} This guard mirrors the git pre-push export gate; it ensures implementation is bound to auditable OKF consumption.`;
}

function coderMutationScope(agent: AgentRecord, root: string): CoderMutationScope {
  if (agent.worktree) {
    const worktree = path.resolve(agent.worktree);
    return { allowed: true, root: worktree, label: "assigned worktree", rootScoped: false };
  }
  const projectRoot = path.resolve(root);
  const cwd = path.resolve(agent.cwd || root);
  if (cwd === projectRoot) {
    return { allowed: true, root: projectRoot, label: "project root", rootScoped: true };
  }
  return {
    allowed: false,
    reason: `pi-company coder ${agent.name} has no assigned worktree and is not rooted at the project root. Ask lead to relaunch it with a valid worktree or explicit root maintenance scope.`,
  };
}

function coderBashBlockReason(command: string, agent: AgentRecord, root: string): string | null {
  if (!isMutatingLeadBashCommand(command)) return null;
  if (isAllowedTempDocumentationBashCommand(command)) return null;
  const scope = coderMutationScope(agent, root);
  if (!scope.allowed) return scope.reason;
  if (scope.rootScoped && isMutatingGitCommand(command)) {
    return `pi-company root-scoped coder ${agent.name} cannot mutate git state from the project root. Use pi-company PR/merge tools or a worktree coder.`;
  }
  const cwd = path.resolve(agent.cwd || scope.root);
  for (const candidate of bashPathCandidates(command)) {
    if (!candidate) continue;
    const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(cwd, candidate);
    if (!isPathInside(resolved, scope.root)) {
      return `pi-company coder ${agent.name} can mutate files only inside its ${scope.label} (${scope.root}). The bash command references ${candidate}, which resolves outside that scope.`;
    }
    if (scope.rootScoped && isProtectedProjectControlPath(root, resolved)) {
      return `pi-company root-scoped coder ${agent.name} cannot mutate pi-company or git control paths. The bash command references ${candidate}.`;
    }
  }
  return null;
}

function bashPathCandidates(command: string): string[] {
  const candidates = new Set<string>();
  for (const token of shellWordsLite(command)) {
    const candidate = pathCandidateFromShellToken(token);
    if (candidate) candidates.add(candidate);
  }
  for (const candidate of [
    ...extractRedirectTargets(command),
    ...extractTeeTargets(command),
    ...extractTouchTargets(command),
    ...extractMkdirTargets(command),
    ...extractRmTargets(command),
  ]) {
    if (candidate) candidates.add(candidate);
  }
  return [...candidates];
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

function isProtectedProjectControlPath(root: string, target: string): boolean {
  const rel = projectRelativePath(root, target);
  return rel === ".git" ||
    rel?.startsWith(".git/") === true ||
    rel === ".pi-company" ||
    rel?.startsWith(".pi-company/") === true;
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

function isAllowedTempDocumentationBashCommand(command: string): boolean {
  const normalized = command.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || !isMutatingLeadBashCommand(normalized)) return false;
  if (hasDangerousNonCoderMutation(normalized)) return false;
  const writtenFiles = [
    ...extractRedirectTargets(normalized),
    ...extractTeeTargets(normalized),
    ...extractTouchTargets(normalized),
  ];
  if (writtenFiles.length === 0) return false;
  return writtenFiles.every(isSafeTempDocumentationPath);
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
  return isPathInAllowedTempDir(resolved);
}

function isSafeTempDocumentationPath(target: string): boolean {
  const resolved = path.resolve(cleanShellPathToken(target));
  if (!isPathInAllowedTempDir(resolved)) return false;
  return isDocumentationExtension(path.basename(resolved));
}

function isPathInAllowedTempDir(target: string): boolean {
  const resolved = path.resolve(target);
  return isPathInside(resolved, os.tmpdir())
    || isPathInside(resolved, "/tmp")
    || isPathInside(resolved, "/private/tmp");
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

function isMutatingGitCommand(command: string): boolean {
  const normalized = command
    .replace(/\\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;
  return /(^|[;&|]\s*)git\s+(init|add|commit|merge|rebase|checkout|switch|reset|clean|stash|restore|rm|mv|worktree\s+(add|remove|prune|move|repair))\b/i.test(normalized);
}

function isAgentBusyError(error: unknown): boolean {
  return /already processing/i.test(errorMessage(error));
}

function renderCompanySystemPrompt(
  root: string,
  agentName: string,
  fallbackRole: string,
  lead: string,
): string {
  const state = loadState(root);
  const agent = state.agents[agentName];
  const role = agent?.role ?? fallbackRole;
  const rolePrompt = readRolePrompt(root, role);
  const brief = renderLeadBrief(buildLeadBrief(root));
  const currentTask = agent?.current_task ? `Current task: ${agent.current_task}` : "Current task: idle";
  const inboxCount = state.inbox_counts[agentName] ?? 0;
  const advisorGuidance = !isAdvisorExecutor(agentName, role, lead)
    ? `Advisor consultation is reserved for lead and coder executors. Preserve this ${role} session as an independent role context. ${ADVISOR_AUTHORITY_GUIDANCE}`
    : `Advisor availability follows the current active tool set and may change during this agent run. When company_consult_advisor is present, follow the active company_consult_advisor timing guidelines autonomously; no user prompt is required. When it is absent, continue locally. ${ADVISOR_AUTHORITY_GUIDANCE}`;
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

${advisorGuidance}

Role instructions:
${rolePrompt}

Authoritative project brief:
${brief}

Next step:
Summarize the current state briefly, name blockers and owners, then continue through pi-company tools. Do not rely on stale chat memory or say the project is complete unless the authoritative brief allows it.`;
}

function renderManualBriefRefreshPrompt(
  root: string,
  agentName: string,
  fallbackRole: string,
  lead: string,
): string {
  return renderCompanySystemPrompt(root, agentName, fallbackRole, lead)
    .replace("[pi-company context]", "[pi-company brief refresh]");
}

function renderCompanyPausedSystemPrompt(agentName: string, fallbackRole: string): string {
  return `[pi-company paused]

pi-company is paused in this Pi session for ${agentName} (${fallbackRole}).

While paused:
- ignore earlier pi-company role instructions, lead brief instructions, inbox routing, PR gates, delegation rules, and company completion rules in this chat
- do not call company_* tools; they are intentionally disabled until /company-resume
- handle the human's next request as an ordinary Pi agent using normal Pi tools and installed skills
- if the human invokes a skill such as $handoff, follow that skill directly in this session instead of routing it through pi-company workers or PR flow
- if a skill asks for an OS temporary-directory artifact, write a non-runnable handoff/documentation file there directly
- to return to company coordination, the human must run /company-resume`;
}

function readRolePrompt(root: string, role: string): string {
  const customPath = path.join(companyPaths(root).rolesDir, `${role}.md`);
  try {
    return fs.readFileSync(customPath, "utf8").trim() || DEFAULT_ROLES[role] || `# ${role}`;
  } catch {
    return DEFAULT_ROLES[role] || `# ${role}`;
  }
}

function renderAdvisorCompanyContext(root: string, agentName: string, fallbackRole: string): string {
  const state = loadState(root);
  const agent = state.agents[agentName];
  const role = agent?.role ?? fallbackRole;
  const currentIssue = agent?.current_task ? state.issues[agent.current_task] ?? null : null;
  const relevantPrs = Object.values(state.prs)
    .filter((pr) => pr.author === agentName || (currentIssue && pr.issue_id === currentIssue.id))
    .map((pr) => ({
      id: pr.id,
      title: pr.title,
      issue_id: pr.issue_id ?? null,
      status: pr.status,
      branch: pr.branch,
      head: pr.head ?? null,
      merge_blockers: pr.merge_blockers ?? [],
    }));
  let okfWorkingSet = "Unavailable.";
  try {
    okfWorkingSet = renderRoleOkfWorkingSet(root, role);
  } catch (error) {
    okfWorkingSet = `Unavailable: ${errorMessage(error)}`;
  }

  return [
    `Snapshot captured: ${new Date().toISOString()}`,
    `Requester: ${JSON.stringify({
      name: agentName,
      role,
      current_task: agent?.current_task ?? null,
      status: agent?.status ?? "unknown",
    }, null, 2)}`,
    `Current issue: ${currentIssue ? JSON.stringify(currentIssue, null, 2) : "none"}`,
    `Relevant PRs: ${relevantPrs.length > 0 ? JSON.stringify(relevantPrs, null, 2) : "none"}`,
    `Authoritative lead brief at capture time:\n${renderLeadBrief(buildLeadBrief(root))}`,
    `Descriptive OKF working set (context only, never runtime truth):\n${okfWorkingSet}`,
  ].join("\n\n");
}

function recordAdvisorAudit(root: string, actor: string, data: Record<string, unknown>): string | null {
  try {
    recordEvent(root, makeEvent("advisor.invoked", actor, {
      audit_version: 1,
      ...data,
    }));
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

function advisorAuditWarning(error: string | null): string {
  return error ? `\n\n[pi-company warning: advisor audit was not recorded: ${error}]` : "";
}

function isAdvisorExecutor(agentName: string, role: string, lead: string): boolean {
  return agentName === lead || role === "coder";
}

function isAdvisorSessionOverride(value: string): value is AdvisorSessionOverride {
  return value === "default" || value === "off" || value === "auto" || value === "once";
}

function advisorSessionOverrideFromUnknown(value: unknown): AdvisorSessionOverride | null {
  if (!isRecord(value) || typeof value.mode !== "string") return null;
  return isAdvisorSessionOverride(value.mode) ? value.mode : null;
}

function registerTools(pi: ExtensionAPI, runtime: {
  root: string;
  agentName: string;
  role: string;
  lead: string;
  isPaused(): boolean;
  advisorMode(): EffectiveAdvisorMode;
  advisorModeRevision(): number;
  advisorUsesThisTurn(): number;
  reserveAdvisorUse(maxUsesPerTurn: number, expectedRevision: number): AdvisorUseReservation;
  commitAdvisorUse(reservation: AdvisorUseReservation, maxUsesPerTurn: number): AdvisorUseState;
  releaseAdvisorUseReservation(reservation: AdvisorUseReservation): void;
  waitForProviderBackoff(ctx: ExtensionContext, provider: string): Promise<void>;
  reportAutomaticRateLimit(kind: "provider_429" | "quota_exhausted", reason: string, provider?: string | null): CompanyState;
  refreshUi(ctx: ExtensionContext): Promise<void>;
}): void {
  const { root, agentName, role, lead, isPaused, refreshUi } = runtime;
  const registerCompanyTool: ExtensionAPI["registerTool"] = (tool) => {
    const execute = tool.execute;
    return pi.registerTool({
      ...tool,
      async execute(...args) {
        if (isPaused()) {
          return toolResult("pi-company is paused in this Pi session. Run /company-resume to restore company tools; use ordinary Pi tools for this request.", { paused: true }) as Awaited<ReturnType<typeof execute>>;
        }
        return execute(...args);
      },
    });
  };

  if (isAdvisorExecutor(agentName, loadState(root).agents[agentName]?.role ?? role, lead)) {
    registerCompanyTool({
    name: ADVISOR_TOOL_NAME,
    label: "Consult Advisor",
    description:
      "Pause this executor and consult the explicitly configured stronger advisor model. " +
      "Takes no parameters: it forwards the bounded active Pi branch plus a read-only company snapshot, " +
      "then returns strategic advice in this tool result. The advisor cannot execute or satisfy company gates.",
    promptSnippet: ADVISOR_INVOCATION_GUIDANCE,
    promptGuidelines: [
      ADVISOR_INVOCATION_GUIDANCE,
      `company_consult_advisor requires no user prompt and takes no parameters; it automatically supplies the active branch and company snapshot. Decide autonomously at the named timing checkpoints and respect the per-turn use limit. ${ADVISOR_AUTHORITY_GUIDANCE}`,
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, onUpdate, ctx) {
      const policy = normalizeAdvisorPolicy(loadConfig(root)?.advisor_policy);
      let sessionMode = runtime.advisorMode();
      const disabledResult = (message: string, metadata: Record<string, unknown> = {}) => {
        const auditError = recordAdvisorAudit(root, agentName, {
          status: "disabled",
          sent: false,
          session_mode: runtime.advisorMode(),
          ...metadata,
        });
        return toolResult(`${message}${advisorAuditWarning(auditError)}`, {
          advisor: {
            status: "disabled",
            sent: false,
            session_mode: runtime.advisorMode(),
            ...metadata,
            audit_status: auditError ? "failed" : "recorded",
            audit_error: auditError,
          },
        });
      };
      const limitResult = () => {
        const auditError = recordAdvisorAudit(root, agentName, {
          status: "limit_reached",
          sent: false,
          session_mode: runtime.advisorMode(),
          max_uses_per_turn: policy.max_uses_per_turn,
        });
        return toolResult(
          `Advisor use limit reached for this executor turn (${policy.max_uses_per_turn}). Continue with the existing advice or gather more evidence before the next turn.${advisorAuditWarning(auditError)}`,
          {
            advisor: {
              status: "limit_reached",
              sent: false,
              session_mode: runtime.advisorMode(),
              max_uses_per_turn: policy.max_uses_per_turn,
              audit_status: auditError ? "failed" : "recorded",
              audit_error: auditError,
            },
          },
        );
      };
      if (sessionMode === "off") {
        return disabledResult("Advisor mode is off for this Pi session (disabled by the current session override or project default); no transcript was sent. Run /company-advisor auto or /company-advisor once to enable it.");
      }
      if (runtime.advisorUsesThisTurn() >= policy.max_uses_per_turn) {
        return limitResult();
      }

      const modelConfig = loadConfig(root)?.model_policy?.roles?.advisor ?? null;
      let target: Awaited<ReturnType<typeof resolveAdvisorTarget>>;
      try {
        target = await resolveAdvisorTarget(ctx.modelRegistry as unknown as AdvisorModelRegistry, modelConfig);
      } catch (error) {
        const status = error instanceof AdvisorRuntimeError ? error.code : "setup_error";
        const auditError = recordAdvisorAudit(root, agentName, {
          status,
          sent: false,
          session_mode: sessionMode,
          error: errorMessage(error),
        });
        return toolResult(`${errorMessage(error)}${advisorAuditWarning(auditError)}`, {
          advisor: {
            status,
            sent: false,
            session_mode: sessionMode,
            audit_status: auditError ? "failed" : "recorded",
            audit_error: auditError,
          },
        });
      }

      sessionMode = runtime.advisorMode();
      if (sessionMode === "off") {
        return disabledResult("Advisor mode was turned off while preparing the consultation; no transcript was read or sent.", {
          phase: "setup",
        });
      }

      const preparationRevision = runtime.advisorModeRevision();
      const preparationInvalidated = () => runtime.advisorModeRevision() !== preparationRevision;
      let lease: ProviderRequestLease | null = null;
      let use: number | null = null;
      let oneShotConsumed = false;
      let oneShotNotice = "";
      let requestStarted = false;
      let useReservation: AdvisorUseReservation | null = null;
      try {
        await runtime.waitForProviderBackoff(ctx, target.model.provider);
        if (preparationInvalidated()) {
          await refreshUi(ctx);
          return disabledResult("Advisor mode or active branch changed before the consultation request was sent; no transcript was read or sent.", {
            phase: "before_send",
          });
        }
        if (runtime.advisorUsesThisTurn() >= policy.max_uses_per_turn) {
          return limitResult();
        }
        const state = loadState(root);
        lease = await acquireProviderRequestLease(
          root,
          target.model.provider,
          `${agentName}:advisor`,
          state.config?.provider_request_policy,
        );
        if (preparationInvalidated()) {
          await refreshUi(ctx);
          return disabledResult("Advisor mode or active branch changed before the consultation request was sent; no transcript was read or sent.", {
            phase: "before_send",
          });
        }
        if (runtime.advisorUsesThisTurn() >= policy.max_uses_per_turn) {
          return limitResult();
        }

        const branch = ctx.sessionManager.getBranch() as PiSessionEntry[];
        if (!buildAdvisorTranscript(branch, { maxChars: 1_000 }).text.trim()) {
          throw new AdvisorRuntimeError("empty-transcript", "Advisor found no active conversation transcript to review.");
        }

        sessionMode = runtime.advisorMode();
        if (sessionMode === "off") {
          return disabledResult("Advisor mode was turned off before the consultation request was sent; no transcript was sent.", {
            phase: "before_send",
          });
        }

        const companyContext = renderAdvisorCompanyContext(root, agentName, role);
        const advisorSessionId = `${ctx.sessionManager.getSessionId()}:advisor`;
        useReservation = runtime.reserveAdvisorUse(policy.max_uses_per_turn, preparationRevision);
        const pendingReservation = useReservation;
        const result = await runAdvisorCompletion({
          target,
          policy,
          branch,
          companyContext,
          signal,
          sessionId: advisorSessionId,
          onRequestStart: () => {
            const consumed = runtime.commitAdvisorUse(pendingReservation, policy.max_uses_per_turn);
            useReservation = null;
            use = consumed.use;
            oneShotConsumed = consumed.oneShotConsumed;
            oneShotNotice = oneShotConsumed
              ? "\n\n[pi-company: one-shot advisor consultation consumed; advisor mode is now off for this Pi session.]"
              : "";
            if (consumed.persistenceError) {
              oneShotNotice += `\n\n[pi-company warning: one-shot off state could not be persisted: ${consumed.persistenceError}]`;
            }
            try {
              onUpdate?.({
                content: [{ type: "text", text: `Consulting ${target.model.provider}/${target.model.id} (${use}/${policy.max_uses_per_turn})...` }],
                details: {},
              });
            } catch {
              // A transient progress-render error must not cancel a paid advisor attempt.
            }
            requestStarted = true;
          },
        });
        if (use === null) throw new Error("Advisor request completed without consuming a use.");
        const auditError = recordAdvisorAudit(root, agentName, {
          status: "success",
          sent: true,
          model: result.model,
          thinking: result.thinking ?? null,
          use,
          session_mode: sessionMode,
          one_shot_consumed: oneShotConsumed,
          max_uses_per_turn: policy.max_uses_per_turn,
          duration_ms: result.durationMs,
          request_chars: result.requestChars,
          transcript: result.transcript.stats,
          usage: result.usage ?? null,
        });
        await refreshUi(ctx);
        const thinking = result.thinking ? ` · thinking:${result.thinking}` : "";
        return toolResult(
          `[company advisor: ${result.model.provider}/${result.model.id}${thinking} · use ${use}/${policy.max_uses_per_turn}]\n\n${result.text}${oneShotNotice}${advisorAuditWarning(auditError)}`,
          {
            advisor: {
              status: "success",
              sent: true,
              ...result.model,
              thinking: result.thinking ?? null,
              use,
              session_mode: sessionMode,
              one_shot_consumed: oneShotConsumed,
              max_uses_per_turn: policy.max_uses_per_turn,
              duration_ms: result.durationMs,
              transcript: result.transcript.stats,
              usage: result.usage ?? null,
              audit_status: auditError ? "failed" : "recorded",
              audit_error: auditError,
            },
          },
        );
      } catch (error) {
        const classification = classifyRateLimitError(error);
        if (classification) {
          try {
            runtime.reportAutomaticRateLimit(classification.kind, classification.reason, target.model.provider);
          } catch {
            // The advisor result still needs to reach the executor if backoff recording races another process.
          }
        }
        const sent = requestStarted;
        const status = signal?.aborted
          ? "aborted"
          : classification
            ? classification.kind
            : error instanceof AdvisorUseClaimError
              ? error.code
              : error instanceof AdvisorRuntimeError
                ? error.code
                : /timeout/i.test(errorMessage(error))
                  ? "timeout"
                  : "error";
        const useMetadata = use === null ? {} : {
          use,
          one_shot_consumed: oneShotConsumed,
        };
        const auditError = recordAdvisorAudit(root, agentName, {
          status,
          sent,
          model: { provider: target.model.provider, id: target.model.id },
          session_mode: sessionMode,
          ...useMetadata,
          max_uses_per_turn: policy.max_uses_per_turn,
          error: errorMessage(error),
        });
        await refreshUi(ctx);
        const stage = use === null
          ? "before the consultation request started"
          : `after use ${use}/${policy.max_uses_per_turn}`;
        return toolResult(
          `Advisor unavailable (${status}) ${stage}: ${errorMessage(error)} Continue with local evidence or try again next turn.${oneShotNotice}${advisorAuditWarning(auditError)}`,
          {
            advisor: {
              status,
              sent,
              session_mode: sessionMode,
              ...useMetadata,
              max_uses_per_turn: policy.max_uses_per_turn,
              audit_status: auditError ? "failed" : "recorded",
              audit_error: auditError,
            },
          },
        );
      } finally {
        if (useReservation) runtime.releaseAdvisorUseReservation(useReservation);
        if (lease) await releaseProviderRequestLease(root, lease);
      }
    },
    });
  }

  registerCompanyTool({
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

  registerCompanyTool({
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

  registerCompanyTool({
    name: "company_create_sprint_contract",
    label: "Create SprintContract",
    description: "Lead-only helper to write a descriptive OKF SprintContract for delivery memory. It does not create or modify runtime issues or gates.",
    promptSnippet: "Write an OKF SprintContract after an issue or sprint scope is stable enough to preserve as descriptive delivery memory.",
    promptGuidelines: [
      "Use this for OKF context only; runtime issues, events, PRs, tests, and merge gates remain authoritative.",
      "Do not use a SprintContract as proof that work is complete. Check company_lead_brief and PR gates for runtime truth.",
      "Use stable, path-safe contract_id values without slashes, hidden segments, or parent traversal.",
    ],
    parameters: Type.Object({
      contract_id: Type.String(),
      title: Type.String(),
      owner: Type.String(),
      scope: Type.String(),
      issue_id: Type.Optional(Type.String()),
      done_criteria: Type.Optional(Type.Array(Type.String())),
      non_goals: Type.Optional(Type.Array(Type.String())),
      required_evidence: Type.Optional(Type.Array(Type.String())),
      evaluator_roles: Type.Optional(Type.Array(Type.String())),
      status: Type.Optional(sprintContractStatusSchema),
      update: Type.Optional(Type.Boolean({ description: "Replace an existing concept deliberately." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const concept = createSprintContract(root, agentName, {
        contract_id: params.contract_id,
        issue_id: params.issue_id ?? null,
        title: params.title,
        owner: params.owner,
        scope: params.scope,
        done_criteria: params.done_criteria ?? [],
        non_goals: params.non_goals ?? [],
        required_evidence: params.required_evidence ?? [],
        evaluator_roles: params.evaluator_roles ?? [],
        status: params.status ?? "draft",
      }, { update: params.update === true });
      await refreshUi(ctx);
      return toolResult(`Wrote SprintContract ${params.contract_id}: ${concept.file}`, { concept });
    },
  });

  registerCompanyTool({
    name: "company_record_evaluation_finding",
    label: "Record EvaluationFinding",
    description: "Role-scoped helper to write a descriptive OKF EvaluationFinding. It supports review/test/acceptance memory but does not satisfy PR gates.",
    promptSnippet: "Record a durable OKF finding after submitting or investigating review, test, acceptance, or system evidence.",
    promptGuidelines: [
      "Submit runtime review/test/acceptance evidence with the existing company tools first when a PR gate must change.",
      "Use this OKF finding as supporting memory only; it does not replace review.submitted, test.submitted, acceptance.submitted, automated tests, or merge gates.",
      "Record concrete evidence and caveats truthfully; never turn caveated evidence into a clean pass.",
    ],
    parameters: Type.Object({
      finding_id: Type.String(),
      kind: evaluationFindingKindSchema,
      verdict: evaluationFindingVerdictSchema,
      summary: Type.String(),
      contract_id: Type.Optional(Type.String()),
      target: Type.Optional(Type.String()),
      severity: Type.Optional(evaluationFindingSeveritySchema),
      status: Type.Optional(evaluationFindingStatusSchema),
      resolved_by: Type.Optional(Type.String()),
      resolution_evidence: Type.Optional(Type.Array(Type.String())),
      pr_id: Type.Optional(Type.String()),
      pr_head: Type.Optional(Type.String()),
      evidence: Type.Optional(Type.Array(Type.String())),
      blockers: Type.Optional(Type.Array(Type.String())),
      caveats: Type.Optional(Type.Array(Type.String())),
      update: Type.Optional(Type.Boolean({ description: "Replace an existing concept deliberately." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const concept = submitEvaluationFinding(root, agentName, {
        finding_id: params.finding_id,
        contract_id: params.contract_id ?? null,
        pr_id: params.pr_id ?? null,
        pr_head: params.pr_head ?? null,
        kind: params.kind,
        evaluator: agentName,
        verdict: params.verdict,
        severity: params.severity ?? "note",
        target: params.target ?? null,
        status: params.status ?? "active",
        resolved_by: params.resolved_by ?? null,
        resolution_evidence: params.resolution_evidence ?? [],
        summary: params.summary,
        evidence: params.evidence ?? [],
        blockers: params.blockers ?? [],
        caveats: params.caveats ?? [],
      }, { update: params.update === true });
      await refreshUi(ctx);
      return toolResult(`Wrote EvaluationFinding ${params.finding_id}: ${concept.file}`, { concept });
    },
  });

  registerCompanyTool({
    name: "company_write_structured_handoff",
    label: "Write StructuredHandoff",
    description: "Write a descriptive OKF StructuredHandoff for durable role/session context transfer. It does not change task ownership or PR gates.",
    promptSnippet: "Write an OKF handoff when another role/session needs durable context, blockers, and next actions.",
    promptGuidelines: [
      "Use this for context transfer only. Runtime events, issue assignment, git state, and PR gates remain authoritative.",
      "If ownership must change, also use company_assign_issue or the appropriate runtime tool; the handoff itself does not reassign work.",
      "Include blockers and next actions with enough evidence for the next owner to resume without stale chat memory.",
    ],
    parameters: Type.Object({
      handoff_id: Type.String(),
      from: Type.String(),
      to: Type.String(),
      summary: Type.String(),
      current_owner: Type.Optional(Type.String()),
      next_owner: Type.Optional(Type.String()),
      contract_id: Type.Optional(Type.String()),
      issue_id: Type.Optional(Type.String()),
      pr_id: Type.Optional(Type.String()),
      branch: Type.Optional(Type.String()),
      head: Type.Optional(Type.String()),
      blockers: Type.Optional(Type.Array(Type.String())),
      next_actions: Type.Optional(Type.Array(Type.String())),
      update: Type.Optional(Type.Boolean({ description: "Replace an existing concept deliberately." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const concept = writeStructuredHandoff(root, agentName, {
        handoff_id: params.handoff_id,
        from: params.from,
        to: params.to,
        summary: params.summary,
        current_owner: params.current_owner ?? null,
        next_owner: params.next_owner ?? null,
        contract_id: params.contract_id ?? null,
        issue_id: params.issue_id ?? null,
        pr_id: params.pr_id ?? null,
        branch: params.branch ?? null,
        head: params.head ?? null,
        blockers: params.blockers ?? [],
        next_actions: params.next_actions ?? [],
      }, { update: params.update === true });
      await refreshUi(ctx);
      return toolResult(`Wrote StructuredHandoff ${params.handoff_id}: ${concept.file}`, { concept });
    },
  });

  registerCompanyTool({
    name: "company_read_delivery_okf",
    label: "Read Delivery OKF",
    description: "Read a descriptive OKF delivery concept by kind and id.",
    promptSnippet: "Read OKF delivery memory for context, then verify runtime truth through company_lead_brief or PR gates before making execution claims.",
    promptGuidelines: [
      "Treat returned OKF as descriptive context only, not as permission, assignment, gate evidence, or completion truth.",
      "Use company_lead_brief and PR gate tools for authoritative runtime state.",
    ],
    parameters: Type.Object({
      kind: okfDeliveryKindSchema,
      id: Type.String(),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const concept = readDeliveryOkfConcept(root, params.kind, params.id);
      await refreshUi(ctx);
      if (!concept) return toolResult(`No OKF ${params.kind} found for ${params.id}`, { concept: null });
      return toolResult(`${concept.frontmatter.type ?? params.kind} ${params.id}: ${concept.file}\n\n${concept.body.trim()}`, { concept });
    },
  });

  registerCompanyTool({
    name: "company_write_role_bundle",
    label: "Write Role Bundle",
    description: "Write a role-specialized OKF bundle such as product quality bar, gameplay design, visual art direction, or research brief.",
    promptSnippet: "Before implementation, specialist roles should write concise role bundles that coders can selectively consume.",
    promptGuidelines: [
      "Use this as specialist context only. Runtime events, issue assignment, and PR gates remain authoritative.",
      "PM owns product_quality_bar; designer owns gameplay_design and visual_art_direction; researcher owns research_brief.",
      "Make guidance concrete enough that the coder can cite it in a consumption manifest.",
    ],
    parameters: Type.Object({
      bundle_id: Type.String(),
      kind: roleBundleKindSchema,
      title: Type.String(),
      summary: Type.String(),
      contract_id: Type.Optional(Type.String()),
      guidance: Type.Optional(Type.Array(Type.String())),
      acceptance_criteria: Type.Optional(Type.Array(Type.String())),
      references: Type.Optional(Type.Array(Type.String())),
      update: Type.Optional(Type.Boolean({ description: "Replace an existing concept deliberately." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const concept = writeRoleBundle(root, agentName, {
        bundle_id: params.bundle_id,
        kind: params.kind,
        contract_id: params.contract_id ?? null,
        author: agentName,
        title: params.title,
        summary: params.summary,
        guidance: params.guidance ?? [],
        acceptance_criteria: params.acceptance_criteria ?? [],
        references: params.references ?? [],
      }, { update: params.update === true });
      await refreshUi(ctx);
      return toolResult(`Wrote RoleBundle ${params.bundle_id}: ${concept.file}`, { concept });
    },
  });

  registerCompanyTool({
    name: "company_record_consumption_manifest",
    label: "Record Consumption Manifest",
    description: "Coder-only helper to record which role bundles implementation consumed or ignored.",
    promptSnippet: "After reading role bundles and before/following implementation, record exactly which specialist context influenced the code.",
    promptGuidelines: [
      "This makes clean context consumption auditable; it does not prove quality or satisfy gates.",
      "List every role bundle you used in consumed_bundles. If you ignore a bundle, provide a reason.",
      "Point output_paths at the files changed by the implementation.",
    ],
    parameters: Type.Object({
      manifest_id: Type.String(),
      summary: Type.String(),
      contract_id: Type.Optional(Type.String()),
      consumed_bundles: Type.Optional(Type.Array(Type.String())),
      ignored_bundles: Type.Optional(Type.Array(Type.Object({
        bundle_id: Type.String(),
        reason: Type.String(),
      }))),
      output_paths: Type.Optional(Type.Array(Type.String())),
      update: Type.Optional(Type.Boolean({ description: "Replace an existing concept deliberately." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const concept = recordConsumptionManifest(root, agentName, {
        manifest_id: params.manifest_id,
        contract_id: params.contract_id ?? null,
        implementation_owner: agentName,
        summary: params.summary,
        consumed_bundles: params.consumed_bundles ?? [],
        ignored_bundles: params.ignored_bundles ?? [],
        output_paths: params.output_paths ?? [],
      }, { update: params.update === true });
      await refreshUi(ctx);
      return toolResult(`Wrote ImplementationConsumptionManifest ${params.manifest_id}: ${concept.file}`, { concept });
    },
  });

  registerCompanyTool({
    name: "company_record_preflight_report",
    label: "Record PreflightReport",
    description: "Evaluator-scoped helper to bind real preflight commands/evidence to the current patch hash before export.",
    promptSnippet: "After running focused tests or review checks, record a PreflightReport before any patch export or completion claim.",
    promptGuidelines: [
      "Use verdict=pass only when the commands/evidence support the SprintContract and preserved behavior risks.",
      "This tool automatically records the current git patch hash so later edits stale the preflight gate.",
      "If any check is caveated, blocked, or failing, record fail/blocked and submit EvaluationFindings for blockers.",
    ],
    parameters: Type.Object({
      preflight_id: Type.String(),
      contract_id: Type.Optional(Type.String()),
      verdict: preflightVerdictSchema,
      summary: Type.String(),
      commands: Type.Optional(Type.Array(Type.String())),
      evidence: Type.Optional(Type.Array(Type.String())),
      blockers: Type.Optional(Type.Array(Type.String())),
      caveats: Type.Optional(Type.Array(Type.String())),
      patch_hash: Type.Optional(Type.String({ description: "Override patch hash; defaults to current git diff hash." })),
      update: Type.Optional(Type.Boolean({ description: "Replace an existing concept deliberately." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const concept = recordPreflightReport(root, agentName, {
        preflight_id: params.preflight_id,
        contract_id: params.contract_id ?? null,
        evaluator: agentName,
        verdict: params.verdict,
        patch_hash: params.patch_hash ?? null,
        summary: params.summary,
        commands: params.commands ?? [],
        evidence: params.evidence ?? [],
        blockers: params.blockers ?? [],
        caveats: params.caveats ?? [],
      }, { update: params.update === true });
      await refreshUi(ctx);
      return toolResult(`Wrote PreflightReport ${params.preflight_id}: ${concept.file}`, { concept });
    },
  });

  registerCompanyTool({
    name: "company_okf_export_gate",
    label: "OKF Export Gate",
    description: "Check whether the current patch may be exported under OKF lifecycle rules.",
    promptSnippet: "Run this before claiming done, handing off for export, or asking lead to submit a patch.",
    promptGuidelines: [
      "If ready=false, satisfy the blockers instead of claiming completion.",
      "A pass requires fresh consumption manifests, required role bundles, no blocking findings, and a preflight report matching the current patch hash.",
      "The official benchmark or CI remains authoritative; this is a lifecycle gate before export.",
    ],
    parameters: Type.Object({
      contract_id: Type.Optional(Type.String()),
      required_role_bundle_kinds: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const report = buildOkfExportGateReport(root, params.contract_id ?? null, {
        requiredRoleBundleKinds: params.required_role_bundle_kinds ?? undefined,
      });
      const text = renderOkfExportGateReport(report);
      await refreshUi(ctx);
      return toolResult(text, { report });
    },
  });

  registerCompanyTool({
    name: "company_delivery_okf_report",
    label: "Delivery OKF Report",
    description: "Read a collaboration-hygiene report for role bundles, consumption manifests, and unresolved blocking OKF findings.",
    promptSnippet: "Before implementation handoff or final claims, check whether specialist role bundles were produced and consumed.",
    promptGuidelines: [
      "This report is an OKF collaboration audit only; it is not a merge gate and does not replace company_lead_brief.",
      "Treat missing role bundles, missing consumption manifests, and unresolved blocking findings as process warnings to resolve or explicitly explain.",
    ],
    parameters: Type.Object({
      contract_id: Type.Optional(Type.String()),
      required_role_bundle_kinds: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const text = renderDeliveryOkfReport(root, params.contract_id ?? null, params.required_role_bundle_kinds ?? undefined);
      await refreshUi(ctx);
      return toolResult(text, { report: text });
    },
  });

  registerCompanyTool({
    name: "company_okf_working_set",
    label: "OKF Working Set",
    description: "Render the bounded active OKF working set and lifecycle protocol for a role.",
    promptSnippet: "Use the OKF working set at the start of a role turn to avoid stale or retired context.",
    promptGuidelines: [
      "Read active/accepted OKF only; stale, retired, superseded, archived, and abandoned concepts are historical unless lead revives them.",
      "Coders must record a consumption manifest before relying on role bundles for implementation.",
      "Evaluators should submit blocking findings for missing behavior instead of relying on coder self-evaluation.",
    ],
    parameters: Type.Object({
      role: Type.Optional(Type.String()),
      contract_id: Type.Optional(Type.String()),
      required_role_bundle_kinds: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const text = renderRoleOkfWorkingSet(root, params.role ?? role, params.contract_id ?? null, params.required_role_bundle_kinds ?? undefined);
      await refreshUi(ctx);
      return toolResult(text, { working_set: text });
    },
  });

  registerCompanyTool({
    name: "company_okf_list",
    label: "OKF List",
    description: "List delivery OKF concepts with OpenKnowledge-style discovery output.",
    promptSnippet: "List active OKF delivery concepts before deciding what context to read or consume.",
    promptGuidelines: [
      "This is discovery only; runtime state, git, tests, and PR gates remain authoritative.",
      "Use contract_id to keep the working set bounded during implementation or evaluation.",
    ],
    parameters: Type.Object({
      contract_id: Type.Optional(Type.String()),
      kind: Type.Optional(okfDeliveryKindSchema),
      include_inactive: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const entries = listDeliveryOkfInventory(root, {
        contractId: params.contract_id ?? null,
        kind: params.kind ?? null,
        includeInactive: params.include_inactive === true,
      });
      const text = renderDeliveryOkfInventory(entries);
      await refreshUi(ctx);
      return toolResult(text, { entries });
    },
  });

  registerCompanyTool({
    name: "company_okf_query",
    label: "OKF Query",
    description: "Search OKF Markdown with lexical, source-excerpt retrieval.",
    promptSnippet: "Query OKF when you know the topic but not the exact concept path.",
    promptGuidelines: [
      "Returned sections are source excerpts, not generated summaries.",
      "Use query results as context only; verify runtime truth separately.",
    ],
    parameters: Type.Object({
      query: Type.String(),
      scope: Type.Optional(Type.String({ description: "all, project, delivery, or imported." })),
      contract_id: Type.Optional(Type.String()),
      kind: Type.Optional(okfDeliveryKindSchema),
      include_inactive: Type.Optional(Type.Boolean()),
      budget: Type.Optional(Type.Number()),
      limit: Type.Optional(Type.Number()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const scope = ["all", "project", "delivery", "imported"].includes(params.scope ?? "all")
        ? params.scope as "all" | "project" | "delivery" | "imported"
        : "all";
      const report = queryOkfBundle(root, params.query, {
        scope,
        contractId: params.contract_id ?? null,
        kind: params.kind ?? null,
        includeInactive: params.include_inactive === true,
        budget: params.budget,
        limit: params.limit,
      });
      await refreshUi(ctx);
      return toolResult(renderOkfQueryReport(report), { report });
    },
  });

  registerCompanyTool({
    name: "company_okf_validate",
    label: "OKF Validate",
    description: "Validate OKF Markdown shape and lifecycle hygiene.",
    promptSnippet: "Run OKF validation after meaningful OKF edits or before export handoff.",
    promptGuidelines: [
      "Validation checks OKF shape and lifecycle hygiene only; it does not replace tests or PR gates.",
      "Treat errors as blockers and warnings as risks to resolve or explicitly justify.",
    ],
    parameters: Type.Object({
      contract_id: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const report = validateOkfBundle(root, params.contract_id ?? null);
      await refreshUi(ctx);
      return toolResult(renderOkfValidationReport(report), { report });
    },
  });

  registerCompanyTool({
    name: "company_okf_use",
    label: "OKF Use",
    description: "Render role-scoped OKF and optionally record coder ConsumptionManifest evidence.",
    promptSnippet: "Use this at the start of implementation to bind active role-bundle consumption to an auditable manifest.",
    promptGuidelines: [
      "Reading OKF is not enough for gated delivery; coders should record consumption when bundle guidance influences code.",
      "The consumption manifest is evidence of context flow, not a quality pass or test result.",
    ],
    parameters: Type.Object({
      role: Type.Optional(Type.String()),
      contract_id: Type.Optional(Type.String()),
      record_consumption: Type.Optional(Type.Boolean()),
      manifest_id: Type.Optional(Type.String()),
      consumed_bundles: Type.Optional(Type.Array(Type.String())),
      ignored_bundles: Type.Optional(Type.Array(Type.Object({
        bundle_id: Type.String(),
        reason: Type.String(),
      }))),
      output_paths: Type.Optional(Type.Array(Type.String())),
      summary: Type.Optional(Type.String()),
      update: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const targetRole = params.role ?? role;
      const text = renderRoleOkfWorkingSet(root, targetRole, params.contract_id ?? null);
      let concept = null;
      if (params.record_consumption === true) {
        const consumed = params.consumed_bundles?.length ? params.consumed_bundles : activeRoleBundleIds(root, params.contract_id ?? null);
        const manifestId = params.manifest_id ?? `use-${params.contract_id ?? "all"}-${agentName}`;
        concept = recordConsumptionManifest(root, agentName, {
          manifest_id: manifestId,
          contract_id: params.contract_id ?? null,
          implementation_owner: agentName,
          summary: params.summary ?? `OKF use by ${agentName}: consumed ${consumed.length > 0 ? consumed.join(", ") : "no active role bundles"}.`,
          consumed_bundles: consumed,
          ignored_bundles: params.ignored_bundles ?? [],
          output_paths: params.output_paths ?? [],
        }, { update: params.update === true });
      }
      await refreshUi(ctx);
      return toolResult(concept ? `${text}\n\nRecorded ConsumptionManifest: ${concept.file}` : text, { working_set: text, consumption_manifest: concept });
    },
  });

  registerCompanyTool({
    name: "company_transition_okf_lifecycle",
    label: "Transition OKF Lifecycle",
    description: "Lead-only tool to mark OKF concepts stale, retired, superseded, archived, active, or accepted.",
    promptSnippet: "Lead should retire sprint-scoped OKF at handoff and mark stale concepts when source facts or bundles change.",
    promptGuidelines: [
      "Only lead should transition lifecycle state; this is maintenance metadata, not runtime truth.",
      "Use retired/archived for sprint-scoped OKF that must leave the active working set.",
      "Use stale when a concept is still relevant but must be refreshed before consumption.",
    ],
    parameters: Type.Object({
      kind: okfDeliveryKindSchema,
      id: Type.String(),
      status: okfLifecycleStatusSchema,
      reason: Type.String(),
      superseded_by: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const concept = transitionDeliveryOkfLifecycle(root, agentName, params.kind, params.id, {
        status: params.status,
        reason: params.reason,
        superseded_by: params.superseded_by ?? null,
      });
      await refreshUi(ctx);
      return toolResult(`Transitioned OKF ${params.kind} ${params.id} to ${params.status}: ${concept.file}`, { concept });
    },
  });

  registerCompanyTool({
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

  registerCompanyTool({
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

  registerCompanyTool({
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

  registerCompanyTool({
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

  registerCompanyTool({
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

  registerCompanyTool({
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
      const recipient = loadState(root).agents[message.to];
      let cmuxLaunch: CmuxLaunchResult | null = null;
      let launchError: string | null = null;
      if (
        agentName === lead &&
        recipient &&
        recipient.name !== lead &&
        (recipient.status === "offline" || recipient.status === "planned") &&
        message.wake?.mode === "immediate"
      ) {
        try {
          cmuxLaunch = launchInCmux(root, agentName, recipient.name, launchCommand(root, recipient.name, currentExtensionPath));
        } catch (error) {
          launchError = errorMessage(error);
        }
      }
      await refreshUi(ctx);
      const offlineWarning = recipient && !cmuxLaunch && (recipient.status === "offline" || recipient.status === "planned")
        ? `\nWarning: ${message.to} is ${recipient.status}; this message is queued, but no visible Pi pane will receive it until lead launches or relaunches that agent with company_spawn_agent. Do not wait silently for ${message.to}.`
        : "";
      const launchNotice = cmuxLaunch
        ? `\nAuto-launched ${message.to} in ${cmuxLaunch.surface}.`
        : launchError
          ? `\nAuto-launch failed for ${message.to}: ${launchError}`
          : "";
      return toolResult(`Sent ${message.id} to ${message.to} (${message.wake?.mode ?? "digest"}: ${message.wake?.reason ?? "no wake metadata"})${launchNotice}${offlineWarning}`, {
        message,
        recipient_status: recipient?.status ?? "unknown",
        cmux: cmuxLaunch?.surface ?? null,
        cmux_reused: cmuxLaunch?.reused ?? false,
        launch_error: launchError,
      });
    },
  });

  registerCompanyTool({
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

  registerCompanyTool({
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

  registerCompanyTool({
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

  registerCompanyTool({
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
      const useCoderWorktree = !(params.role === "coder" && params.create_worktree === false);
      const spawnOptions = { allowUnknownRole: params.force_role === true, useCoderWorktree };
      const plan = planAgentSpawn(root, params.role, params.name, params.mission ?? null, spawnOptions);
      const shouldCreateWorktree = params.role === "coder" && useCoderWorktree;
      if (shouldCreateWorktree) ensureCoderWorktree(root, plan, true);
      requestAgentSpawn(root, agentName, params.role, params.name, params.mission ?? null, spawnOptions);
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

  registerCompanyTool({
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

  registerCompanyTool({
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

  registerCompanyTool({
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

  registerCompanyTool({
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

  registerCompanyTool({
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

  registerCompanyTool({
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

  registerCompanyTool({
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

  registerCompanyTool({
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

  registerCompanyTool({
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

  registerCompanyTool({
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

interface ModelPolicyTargetOption {
  label: string;
  title: string;
  scope: "defaults" | "role" | "fallback";
  name: string | null;
  currentSummary: string;
}

function modelPolicyTargetOptions(state: CompanyState): ModelPolicyTargetOption[] {
  const roles = [...new Set([
    "lead",
    "pm",
    "researcher",
    "coder",
    "advisor",
    "reviewer",
    "tester",
    ...Object.values(state.agents).map((agent) => agent.role),
  ])].sort();
  const defaults = state.config?.model_policy?.defaults ?? null;
  const defaultSummary = formatModelPolicyConfig(defaults) ?? "Pi/lead current model";
  const fallbacks = state.config?.model_policy?.fallbacks ?? [];
  const fallbackOptions = [
    modelPolicyTargetOption("Global fallback 1", "fallback", "0", formatModelPolicyConfig(fallbacks[0]) ?? "not configured"),
    ...(fallbacks[0] || fallbacks[1]
      ? [modelPolicyTargetOption("Global fallback 2", "fallback", "1", formatModelPolicyConfig(fallbacks[1]) ?? "not configured")]
      : []),
  ];
  return [
    modelPolicyTargetOption("Default model (future and unconfigured roles)", "defaults", null, defaultSummary),
    ...fallbackOptions,
    ...roles.map((role) => {
      const roleConfig = state.config?.model_policy?.roles?.[role] ?? null;
      const roleSummary = formatModelPolicyConfig(roleConfig)
        ?? (defaults ? `inherits default ${defaultSummary}` : "inherits Pi/lead current model");
      return modelPolicyTargetOption(`Role default: ${role}`, "role", role, roleSummary);
    }),
  ];
}

function modelPolicyTargetOption(
  title: string,
  scope: "defaults" | "role" | "fallback",
  name: string | null,
  currentSummary: string,
): ModelPolicyTargetOption {
  return {
    label: `${title} [current: ${currentSummary}]`,
    title,
    scope,
    name,
    currentSummary,
  };
}

async function configureOneModelPolicy(
  root: string,
  agentName: string,
  ctx: ExtensionContext,
  target: ModelPolicyTargetOption,
  modelOptions: Array<{ label: string; provider: string; model: string; reasoning: boolean }>,
): Promise<string> {
  const clearLabel = target.scope === "defaults"
    ? "Use Pi/lead current model by default"
    : target.scope === "fallback"
      ? "Clear this global fallback"
      : "Inherit default / clear this role override";
  const modelChoice = await selectRequired(ctx, `Choose Pi model for ${target.title} (current: ${target.currentSummary}):`, [clearLabel, ...modelOptions.map((option) => option.label)]);
  if (modelChoice === clearLabel) {
    setModelPolicy(root, agentName, target.scope, target.name, null);
    return `Cleared ${target.title}.`;
  }

  const selectedModel = modelOptions.find((option) => option.label === modelChoice);
  if (!selectedModel) throw new Error("Unknown model choice.");

  const thinkingChoices = selectedModel.reasoning
    ? ["inherit Pi default", "off", "minimal", "low", "medium", "high", "xhigh", "max"]
    : ["inherit Pi default", "off"];
  const thinkingChoice = await selectRequired(ctx, `Choose thinking for ${target.title} (current: ${target.currentSummary}):`, thinkingChoices);
  const modelConfig: PiModelConfig = {
    provider: selectedModel.provider,
    model: selectedModel.model,
  };
  if (thinkingChoice !== "inherit Pi default") modelConfig.thinking = thinkingChoice;

  setModelPolicy(root, agentName, target.scope, target.name, modelConfig);
  const thinking = modelConfig.thinking ? `:${modelConfig.thinking}` : "";
  return `Configured ${target.title} to ${modelConfig.provider}/${modelConfig.model}${thinking}.`;
}

function formatModelPolicyConfig(config: PiModelConfig | null | undefined): string | null {
  if (!config) return null;
  const model = config.models
    ? `models=${config.models}`
    : [config.provider, config.model].filter(Boolean).join("/");
  if (!model) return null;
  return config.thinking ? `${model}:${config.thinking}` : model;
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

function providerBackoffAppliesToRequest(state: CompanyState, provider: string): boolean {
  if (!state.rate_limit) return false;
  if (state.rate_limit.kind === "manual") return true;
  const limitedProvider = normalizeProviderForComparison(state.rate_limit.provider ?? null);
  if (!limitedProvider) return true;
  return normalizeProviderForComparison(provider) === limitedProvider;
}

function normalizeProviderForComparison(provider: string | null | undefined): string | null {
  if (typeof provider !== "string") return null;
  const trimmed = provider.trim();
  return trimmed.length > 0 ? trimmed : null;
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
    "automation: inbox delivery, provider gates, and company role guards are paused",
    "tools: company_* tools are blocked; ordinary Pi tools and skills remain available",
    "prompt: a pause override tells Pi to ignore earlier company role/brief rules",
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
- provider=${state.rate_limit.provider ?? "unknown"}
- model fallbacks=${formatModelFallbacksForStatus(state)}
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
  const provider = state.rate_limit.provider ? ` ${state.rate_limit.provider}` : "";
  return `rate-limit: ${status} ${state.rate_limit.kind}${provider} until ${state.rate_limit.paused_until}`;
}

function formatModelFallbacksForStatus(state: ReturnType<typeof loadState>): string {
  const fallbacks = (state.config?.model_policy?.fallbacks ?? [])
    .filter(Boolean)
    .slice(0, 2)
    .map((config) => formatModelPolicyConfig(config));
  return fallbacks.length > 0 ? fallbacks.join(" -> ") : "none";
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
    const result = spawnSync(command, args, { encoding: "utf8", timeout: CMUX_COMMAND_TIMEOUT_MS });
    if (result.error && "code" in result.error && result.error.code === "ENOENT") {
      last = { status: 127, stdout: "", stderr: result.error.message };
      continue;
    }
    if (result.error && "code" in result.error && result.error.code === "ETIMEDOUT") {
      return { status: 124, stdout: result.stdout ?? "", stderr: result.error.message };
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
