import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import {
  acknowledgeInbox,
  abandonPr,
  agentRateLimitResumeAt,
  adoptIntegratedPr,
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
  initCompany,
  launchCommand,
  listInbox,
  loadState,
  maintainCompany,
  markPrReady,
  mergePr,
  pendingMergeRequests,
  readAgentRecoverySnapshot,
  readAgentRuntime,
  recordAgentRuntime,
  recordAgentLaunch,
  recordEvent,
  registerAgent,
  recordAutomatedTests,
  recordHumanSteering,
  reportTask,
  requestAgentSpawn,
  requestMerge,
  normalizeMessagePolicy,
  rateLimitAppliesToProvider,
  rateLimitIsActive,
  reportRateLimit,
  resolveGitHead,
  startTask,
  submitReview,
  sendCompanyMessage,
  renderLeadBrief,
  setModelPolicy,
  shouldAutoDeliverMessage,
  syncRenderedRecords,
  submitAcceptance,
  submitTest,
} from "../src/core/company.js";
import { DEFAULT_MESSAGE_POLICY, DEFAULT_RATE_LIMIT_POLICY } from "../src/core/defaults.js";
import { makeEvent } from "../src/core/events.js";
import { companyPaths } from "../src/core/paths.js";
import {
  acquireProviderRequestLease,
  providerQueueSnapshot,
  releaseProviderRequestLease,
} from "../src/core/provider-queue.js";
import { classifyRateLimitText } from "../src/core/rate-limit.js";
import { hasGateCaveat } from "../src/core/reducer.js";

const tempRoots = new Set<string>();

afterEach(() => {
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

describe("pi-company core", () => {
  it("classifies visible provider rate-limit failures from screen text", () => {
    const result = classifyRateLimitText(`Error: 429 Too many requests
Error: Retry failed after 3 attempts: 429 Too many requests`);

    expect(result?.kind).toBe("provider_429");
    expect(result?.reason).toContain("Retry failed after 3 attempts");
  });

  it("classifies visible quota failures separately from provider 429", () => {
    const result = classifyRateLimitText("Quota exhausted. Account credits are used up.");

    expect(result?.kind).toBe("quota_exhausted");
  });

  it("does not classify ordinary API usage documentation as quota exhaustion", () => {
    const result = classifyRateLimitText(`usage object | null
该对话补全请求的用量信息。
usage.total_tokens integer 请求中使用的 token 总数。
api-key: $PROVIDER_API_KEY`);

    expect(result).toBeNull();
  });

  it("does not classify pi-company rate-limit status text as a fresh provider failure", () => {
    const result = classifyRateLimitText(`rate-limit: recent provider_429 until 2099-01-01T00:01:00.000Z
Sent msg_123 to lead (digest: organization rate-limit backoff until 2099-01-01T00:01:00.000Z)`);

    expect(result).toBeNull();
  });

  it("keeps historical pi-company rate-limit reasons out of fresh screen-scan incidents", () => {
    const result = classifyRateLimitText(`Rate Limit:
- reason: old provider_429 storm from a previous scan
Error: 429 Too many requests`);

    expect(result?.kind).toBe("provider_429");
    expect(result?.reason).toBe("Error: 429 Too many requests");
  });

  it("does not treat ordinary wake-policy wording as a provider failure", () => {
    const result = classifyRateLimitText(`Sent msg_123 to coder-api (immediate: message type and rate limits allow wake)
rate-limit: recent manual until 2099-01-01T00:01:00.000Z
Rate limit 已过期，可以恢复正常工作`);

    expect(result).toBeNull();
  });

  it("still recognizes explicit provider rate-limit exceeded failures", () => {
    const result = classifyRateLimitText("Provider error: rate limit exceeded, retry later.");

    expect(result?.kind).toBe("provider_429");
  });

  it("does not treat preventive guidance mentioning 429 as a fresh failure", () => {
    const result = classifyRateLimitText("If a provider gate makes a worker wait a few seconds, that is expected and better than hitting 429.");

    expect(result).toBeNull();
  });

  it("does not treat terminology guidance around 429 as a fresh failure", () => {
    const result = classifyRateLimitText(
      'Terms to avoid: use "provider throttling / request pressure" instead of making "429" primary user-facing language.',
    );

    expect(result).toBeNull();
  });

  it("recognizes explicit HTTP 429 failures", () => {
    const result = classifyRateLimitText("Provider HTTP 429: Too many requests.");

    expect(result?.kind).toBe("provider_429");
  });

  it("initializes a company with default roles and files", () => {
    const root = tempRoot();
    const state = initCompany({ root, id: "demo" });
    const leadRole = fs.readFileSync(path.join(companyPaths(root).rolesDir, "lead.md"), "utf8");
    const pmRole = fs.readFileSync(path.join(companyPaths(root).rolesDir, "pm.md"), "utf8");

    expect(state.config?.id).toBe("demo");
    expect(state.agents.lead.role).toBe("lead");
    expect(state.agents.tester.role).toBe("tester");
    expect(fs.existsSync(companyPaths(root).events)).toBe(true);
    expect(fs.existsSync(path.join(companyPaths(root).rolesDir, "coder.md"))).toBe(true);
    expect(leadRole).toContain("treat PM as product staff, not the final client");
    expect(leadRole).toContain("do not bounce routine scope, copy, flow, style, or acceptance-criteria defaults back to the human");
    expect(leadRole).toContain("execute the local merge instead of stopping at a merge request");
    expect(pmRole).toContain("ask lead once with your recommended default and fallback");
    expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8")).toContain(".pi-company/");
  });

  it("does not reset an existing company when init is run again", () => {
    const root = tempRoot();
    initCompany({ root, id: "first" });
    registerAgent(root, {
      name: "pm",
      role: "pm",
      cwd: root,
      status: "online",
    });

    const state = initCompany({ root, id: "second" });

    expect(state.config?.id).toBe("first");
    expect(state.agents.pm.status).toBe("online");
    const ignoreEntries = fs.readFileSync(path.join(root, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() === ".pi-company/");
    expect(ignoreEntries).toHaveLength(1);
  });

  it("uses the current company yaml config after event replay", () => {
    const root = tempRoot();
    initCompany({ root, id: "config-replay-demo" });
    const configPath = companyPaths(root).config;
    const config = fs.readFileSync(configPath, "utf8")
      .replace("agent_cooldown_ms: 10000", "agent_cooldown_ms: 1234")
      .replace("agent_max_immediate_per_minute: 6", "agent_max_immediate_per_minute: 7")
      .replace("org_max_immediate_per_minute: 12", "org_max_immediate_per_minute: 8");
    fs.writeFileSync(configPath, config, "utf8");

    const state = loadState(root);

    expect(state.config?.message_policy?.agent_cooldown_ms).toBe(1234);
    expect(state.config?.message_policy?.agent_max_immediate_per_minute).toBe(7);
    expect(state.config?.message_policy?.org_max_immediate_per_minute).toBe(8);
  });

  it("mirrors human steering sent to a worker into lead inbox", () => {
    const root = tempRoot();
    initCompany({ root, id: "steering-demo" });
    registerCoder(root, "coder-api");

    const mirrored = recordHumanSteering(root, "coder-api", "Please keep this backwards compatible.", "steer");
    const state = loadState(root);

    expect(mirrored?.from).toBe("human");
    expect(mirrored?.to).toBe("lead");
    expect(state.human_steering).toHaveLength(1);
    expect(state.inbox_counts.lead).toBe(1);
    expect(listInbox(root, "lead")[0].from).toBe("human");
    expect(listInbox(root, "lead")[0].type).toBe("human_steering");
  });

  it("delivers human steering sent directly to lead into lead inbox", () => {
    const root = tempRoot();
    initCompany({ root, id: "lead-steering-demo" });

    const delivered = recordHumanSteering(root, "lead", "Browser acceptance failed; create a follow-up issue.", "followUp");
    const state = loadState(root);

    expect(delivered?.from).toBe("human");
    expect(delivered?.to).toBe("lead");
    expect(state.human_steering).toHaveLength(1);
    expect(state.inbox_counts.lead).toBe(1);
    expect(listInbox(root, "lead")[0].from).toBe("human");
    expect(listInbox(root, "lead")[0].type).toBe("human_steering");
    expect(listInbox(root, "lead")[0].text).toContain("Browser acceptance failed");
  });

  it("acknowledges unread mailbox messages", () => {
    const root = tempRoot();
    initCompany({ root, id: "inbox-demo" });
    const mirrored = recordHumanSteering(root, "tester", "Check the edge case.", "followUp");

    expect(listInbox(root, "lead")).toHaveLength(1);
    acknowledgeInbox(root, "lead", [mirrored?.id ?? "missing"]);

    expect(listInbox(root, "lead")).toHaveLength(0);
    expect(loadState(root).inbox_counts.lead).toBe(0);
  });

  it("keeps inbox counts accurate for invalid or repeated acknowledgements", () => {
    const root = tempRoot();
    initCompany({ root, id: "ack-guard-demo" });
    const first = sendCompanyMessage(root, {
      from: "lead",
      to: "pm",
      type: "assignment",
      text: "Real message.",
    });

    expect(() => acknowledgeInbox(root, "pm", ["msg_missing"])).toThrow(/Unknown message msg_missing in pm's inbox/);
    expect(loadState(root).inbox_counts.pm).toBe(1);
    expect(listInbox(root, "pm")).toHaveLength(1);

    recordEvent(root, makeEvent("message.delivered", "pm", {
      to: "pm",
      message_id: "msg_missing",
    }));
    expect(loadState(root).inbox_counts.pm).toBe(1);
    expect(listInbox(root, "pm")).toHaveLength(1);

    acknowledgeInbox(root, "pm", [first.id]);
    expect(loadState(root).inbox_counts.pm).toBe(0);
    expect(listInbox(root, "pm")).toHaveLength(0);

    const second = sendCompanyMessage(root, {
      from: "lead",
      to: "pm",
      type: "assignment",
      text: "Second real message.",
    });
    acknowledgeInbox(root, "pm", [first.id]);
    expect(loadState(root).inbox_counts.pm).toBe(1);
    expect(listInbox(root, "pm").map((message) => message.id)).toEqual([second.id]);
  });

  it("requires delivered events to be authored by the inbox owner", () => {
    const root = tempRoot();
    initCompany({ root, id: "delivery-owner-demo" });
    const message = sendCompanyMessage(root, {
      from: "lead",
      to: "pm",
      type: "assignment",
      text: "Real message.",
    });

    recordEvent(root, makeEvent("message.delivered", "lead", {
      to: "pm",
      message_id: message.id,
    }));
    expect(loadState(root).inbox_counts.pm).toBe(1);
    expect(listInbox(root, "pm").map((item) => item.id)).toEqual([message.id]);

    acknowledgeInbox(root, "pm", [message.id]);
    expect(loadState(root).inbox_counts.pm).toBe(0);
    expect(listInbox(root, "pm")).toHaveLength(0);
  });

  it("ignores duplicate or unidentifiable message sent events during replay", () => {
    const root = tempRoot();
    initCompany({ root, id: "sent-replay-guard-demo" });
    const message = sendCompanyMessage(root, {
      from: "lead",
      to: "pm",
      type: "assignment",
      text: "Real message.",
    });

    recordEvent(root, makeEvent("message.sent", "lead", {
      ...message,
    }));
    recordEvent(root, makeEvent("message.sent", "lead", {
      to: "pm",
      type: "assignment",
      text: "Missing id.",
    }));
    recordEvent(root, makeEvent("message.sent", "lead", {
      ...message,
      to: "tester",
    }));

    expect(loadState(root).inbox_counts.pm).toBe(1);
    expect(loadState(root).inbox_counts.tester).toBeUndefined();
    expect(listInbox(root, "pm", true).map((item) => item.id)).toEqual([message.id]);
  });

  it("reconstructs inbox messages from valid sent events when mailbox files are missing", () => {
    const root = tempRoot();
    initCompany({ root, id: "event-inbox-demo" });
    recordEvent(root, makeEvent("message.sent", "lead", {
      id: "msg_event_only",
      ts: new Date().toISOString(),
      from: "lead",
      to: "pm",
      type: "assignment",
      text: "Event-only message.",
    }));
    recordEvent(root, makeEvent("message.sent", "lead", {
      id: "msg_bad_from",
      ts: new Date().toISOString(),
      from: "coder-typo",
      to: "pm",
      type: "assignment",
      text: "Bad sender identity.",
    }));

    expect(loadState(root).inbox_counts.pm).toBe(1);
    expect(listInbox(root, "pm").map((message) => message.id)).toEqual(["msg_event_only"]);

    acknowledgeInbox(root, "pm", ["msg_event_only"]);
    expect(loadState(root).inbox_counts.pm).toBe(0);
    expect(listInbox(root, "pm")).toHaveLength(0);
  });

  it("ignores invalid message types in replayed sent events", () => {
    const root = tempRoot();
    initCompany({ root, id: "message-type-replay-guard-demo" });

    recordEvent(root, makeEvent("message.sent", "lead", {
      id: "msg_bad_type",
      ts: new Date().toISOString(),
      from: "lead",
      to: "pm",
      type: "not-a-message-type",
      text: "Bad message.",
    }));

    expect(loadState(root).inbox_counts.pm).toBeUndefined();
    expect(listInbox(root, "pm")).toHaveLength(0);
  });

  it("rejects inbox reads and acknowledgements for unknown agents", () => {
    const root = tempRoot();
    initCompany({ root, id: "unknown-inbox-demo" });

    expect(() => listInbox(root, "codre-typo")).toThrow(/Unknown agent codre-typo/);
    expect(() => acknowledgeInbox(root, "codre-typo", ["msg_missing"])).toThrow(/Unknown agent codre-typo/);
  });

  it("rejects messages and human steering for unknown agents", () => {
    const root = tempRoot();
    initCompany({ root, id: "message-auth-demo" });

    expect(() => sendCompanyMessage(root, {
      from: "lead",
      to: "codre-typo",
      type: "assignment",
      text: "This should not disappear.",
    })).toThrow(/Unknown message recipient codre-typo/);
    expect(() => sendCompanyMessage(root, {
      from: "coder-typo",
      to: "lead",
      type: "report",
      text: "This should not impersonate a worker.",
    })).toThrow(/Unknown message sender coder-typo/);
    expect(() => recordHumanSteering(root, "coder-typo", "Steering typo.", "steer")).toThrow(
      /Unknown human steering target coder-typo/,
    );
    expect(loadState(root).inbox_counts["codre-typo"]).toBeUndefined();
    expect(() => listInbox(root, "codre-typo")).toThrow(/Unknown agent codre-typo/);
  });

  it("rejects invalid message types before writing mailbox state", () => {
    const root = tempRoot();
    initCompany({ root, id: "message-type-runtime-guard-demo" });

    expect(() => sendCompanyMessage(root, {
      from: "lead",
      to: "pm",
      type: "not-a-message-type" as any,
      text: "Bad message.",
    })).toThrow(/Invalid message type not-a-message-type/);
    expect(() => sendCompanyMessage(root, {
      from: "lead",
      to: "pm",
      type: "assignment",
      priority: "medium" as any,
      text: "Bad priority.",
    })).toThrow(/Invalid message priority medium/);
    expect(loadState(root).inbox_counts.pm).toBeUndefined();
    expect(listInbox(root, "pm")).toHaveLength(0);
  });

  it("opens issues and assigns ownership", () => {
    const root = tempRoot();
    initCompany({ root, id: "issue-demo" });

    const issue = createIssue(root, "lead", "Build the local PR flow", "Acceptance criteria here.");
    assignIssue(root, "lead", issue.id, "tester");

    const state = loadState(root);
    expect(state.issues[issue.id].status).toBe("assigned");
    expect(state.issues[issue.id].owner).toBe("tester");
    const messages = listInbox(root, "tester");
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("assignment");
    expect(messages[0].task).toBe(issue.id);
    expect(messages[0].text).toContain("Build the local PR flow");
  });

  it("allocates issue IDs atomically across concurrent writers", async () => {
    const root = tempRoot();
    try {
      initCompany({ root, id: "issue-id-race-demo" });

      await createIssuesInParallel(root, 20);

      const issues = Object.values(loadState(root).issues).sort((left, right) => left.id.localeCompare(right.id));
      expect(issues).toHaveLength(20);
      expect(issues.map((issue) => issue.id)).toEqual(
        Array.from({ length: 20 }, (_, index) => `ISSUE-${String(index + 1).padStart(3, "0")}`),
      );
      expect(new Set(issues.map((issue) => issue.title)).size).toBe(20);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("does not duplicate assignment notifications for the same owner", () => {
    const root = tempRoot();
    initCompany({ root, id: "assignment-notification-demo" });

    const issue = createIssue(root, "lead", "Research deployment", "Check static hosting.");
    assignIssue(root, "lead", issue.id, "researcher");
    assignIssue(root, "lead", issue.id, "researcher");

    expect(loadState(root).issues[issue.id].owner).toBe("researcher");
    expect(listInbox(root, "researcher")).toHaveLength(1);
  });

  it("allows only lead to create and assign issues", () => {
    const root = tempRoot();
    initCompany({ root, id: "issue-auth-demo" });

    expect(() => createIssue(root, "coder", "Worker-created issue", "Should be routed through lead.")).toThrow(
      /Only lead can create issues/,
    );
    expect(Object.keys(loadState(root).issues)).toHaveLength(0);

    const issue = createIssue(root, "lead", "Lead-created issue", "Acceptance criteria.");
    expect(() => assignIssue(root, "coder", issue.id, "tester")).toThrow(/Only lead can assign issues/);
    expect(loadState(root).issues[issue.id].owner).toBeNull();

    assignIssue(root, "lead", issue.id, "tester");
    expect(loadState(root).issues[issue.id].owner).toBe("tester");
  });

  it("enforces work-type ownership boundaries for issue assignment", () => {
    const root = tempRoot();
    initCompany({ root, id: "work-type-boundary-demo" });
    registerCoder(root);
    const implementation = createIssue(root, "lead", "Build keyboard simulator", "Create index.html.", { work_type: "implementation" });
    const design = createIssue(root, "lead", "Design keyboard simulator", "Use impeccable.", { work_type: "design" });
    const product = createIssue(root, "lead", "Scope keyboard simulator", "Define acceptance.", { work_type: "product" });

    expect(() => assignIssue(root, "lead", implementation.id, "pm")).toThrow(/implementation work/);
    expect(() => assignIssue(root, "lead", implementation.id, "designer")).toThrow(/implementation work/);
    assignIssue(root, "lead", implementation.id, "coder");
    assignIssue(root, "lead", design.id, "designer");
    assignIssue(root, "lead", product.id, "pm");

    const state = loadState(root);
    expect(state.issues[implementation.id].owner).toBe("coder");
    expect(state.issues[design.id].owner).toBe("designer");
    expect(state.issues[product.id].owner).toBe("pm");
  });

  it("blocks assignment to unknown issues or agents", () => {
    const root = tempRoot();
    initCompany({ root, id: "assign-target-demo" });
    const issue = createIssue(root, "lead", "Validate target", "Acceptance criteria.");

    expect(() => assignIssue(root, "lead", "ISSUE-999", "tester")).toThrow(/Unknown issue ISSUE-999/);
    expect(() => assignIssue(root, "lead", issue.id, "codre-typo")).toThrow(/Unknown agent codre-typo/);
    expect(loadState(root).issues[issue.id].owner).toBeNull();
  });

  it("includes environment identity in launch commands", () => {
    const root = tempRoot();
    initCompany({ root, id: "launch-demo" });

    const command = launchCommand(root, "tester", "/tmp/company.js");

    expect(command).toContain("PI_COMPANY_AGENT='tester'");
    expect(command).toContain("PI_COMPANY_ROLE='tester'");
    expect(command).toContain("PI_COMPANY_ROOT=");
    expect(command).toContain("pi --approve");
    expect(command).toContain("--company-agent 'tester'");
  });

  it("can omit explicit extension loading in package-installed mode", () => {
    const previous = process.env.PI_COMPANY_LAUNCH_EXTENSION;
    process.env.PI_COMPANY_LAUNCH_EXTENSION = "0";
    try {
      const root = tempRoot();
      initCompany({ root, id: "launch-package-demo" });

      const command = launchCommand(root, "tester", "/tmp/company.js");

      expect(command).toContain("pi --approve");
      expect(command).not.toContain(" -e ");
      expect(command).toContain("--company-agent 'tester'");
    } finally {
      if (previous === undefined) delete process.env.PI_COMPANY_LAUNCH_EXTENSION;
      else process.env.PI_COMPANY_LAUNCH_EXTENSION = previous;
    }
  });

  it("can force explicit extension loading for source development", () => {
    const previous = process.env.PI_COMPANY_LAUNCH_EXTENSION;
    process.env.PI_COMPANY_LAUNCH_EXTENSION = "1";
    try {
      const root = tempRoot();
      initCompany({ root, id: "launch-source-demo" });
      const extensionPath = path.join(root, "company.js");
      fs.writeFileSync(extensionPath, "export default function company() {}\n", "utf8");

      const command = launchCommand(root, "tester", extensionPath);

      expect(command).toContain("pi --approve");
      expect(command).toContain(` -e '${extensionPath}'`);
      expect(command).toContain("--company-agent 'tester'");
    } finally {
      if (previous === undefined) delete process.env.PI_COMPANY_LAUNCH_EXTENSION;
      else process.env.PI_COMPANY_LAUNCH_EXTENSION = previous;
    }
  });

  it("does not emit stale missing explicit extension paths", () => {
    const previous = process.env.PI_COMPANY_LAUNCH_EXTENSION;
    process.env.PI_COMPANY_LAUNCH_EXTENSION = "1";
    try {
      const root = tempRoot();
      initCompany({ root, id: "launch-stale-extension-demo" });

      const command = launchCommand(root, "tester", "/private/tmp/pi-company-publish/dist/extensions/company.js");

      expect(command).toContain("pi --approve");
      expect(command).not.toContain(" -e ");
      expect(command).not.toContain("pi-company-publish");
      expect(command).toContain("--company-agent 'tester'");
    } finally {
      if (previous === undefined) delete process.env.PI_COMPANY_LAUNCH_EXTENSION;
      else process.env.PI_COMPANY_LAUNCH_EXTENSION = previous;
    }
  });

  it("does not emit transient publish extension paths even when present", () => {
    const previous = process.env.PI_COMPANY_LAUNCH_EXTENSION;
    process.env.PI_COMPANY_LAUNCH_EXTENSION = "1";
    try {
      const root = tempRoot();
      initCompany({ root, id: "launch-transient-extension-demo" });
      const extensionPath = path.join(root, "pi-company-publish", "dist", "extensions", "company.js");
      fs.mkdirSync(path.dirname(extensionPath), { recursive: true });
      fs.writeFileSync(extensionPath, "export default function company() {}\n", "utf8");

      const command = launchCommand(root, "tester", extensionPath);

      expect(command).toContain("pi --approve");
      expect(command).not.toContain(" -e ");
      expect(command).not.toContain("pi-company-publish");
      expect(command).toContain("--company-agent 'tester'");
    } finally {
      if (previous === undefined) delete process.env.PI_COMPANY_LAUNCH_EXTENSION;
      else process.env.PI_COMPANY_LAUNCH_EXTENSION = previous;
    }
  });

  it("adds role model policy to launch commands", () => {
    const root = tempRoot();
    initCompany({ root, id: "launch-model-demo" });

    setModelPolicy(root, "lead", "role", "tester", {
      provider: "openai-codex",
      model: "gpt-5.4-mini",
      thinking: "low",
    });

    const command = launchCommand(root, "tester", "/tmp/company.js");

    expect(command).toContain("--provider 'openai-codex'");
    expect(command).toContain("--model 'gpt-5.4-mini'");
    expect(command).toContain("--thinking 'low'");
  });

  it("uses default model policy for dynamically added roles", () => {
    const root = tempRoot();
    initCompany({ root, id: "launch-default-model-demo" });
    setModelPolicy(root, "lead", "defaults", null, {
      provider: "xiaomi-token-plan-cn",
      model: "mimo-v2.5-pro",
    });
    fs.writeFileSync(path.join(companyPaths(root).rolesDir, "ops.md"), "# Ops\n\nCoordinate rollout operations.\n", "utf8");
    const plan = requestAgentSpawn(root, "lead", "ops", "ops", "Handle rollout coordination.");
    registerAgent(root, { ...plan, status: "planned" });

    const command = launchCommand(root, "ops", "/tmp/company.js");

    expect(command).toContain("--provider 'xiaomi-token-plan-cn'");
    expect(command).toContain("--model 'mimo-v2.5-pro'");
  });

  it("launches with a global fallback model while the primary provider is in backoff", () => {
    const root = tempRoot();
    initCompany({ root, id: "launch-fallback-model-demo" });
    setModelPolicy(root, "lead", "role", "tester", {
      provider: "zhipu",
      model: "glm-5.2",
    });
    setModelPolicy(root, "lead", "fallback", "0", {
      provider: "xiaomi-token-plan-cn",
      model: "mimo-v2.5-pro",
    });

    reportRateLimit(root, "tester", "Provider HTTP 429 from zhipu.", "provider_429", "2099-01-01T00:00:00.000Z", {
      provider: "zhipu",
    });
    const command = launchCommand(root, "tester", "/tmp/company.js");

    expect(command).toContain("--provider 'xiaomi-token-plan-cn'");
    expect(command).toContain("--model 'mimo-v2.5-pro'");
    expect(command).not.toContain("--provider 'zhipu'");
    expect(loadState(root).rate_limit?.provider).toBe("zhipu");
  });

  it("keeps the primary model when the active backoff is for a different provider", () => {
    const root = tempRoot();
    initCompany({ root, id: "launch-provider-specific-model-demo" });
    setModelPolicy(root, "lead", "role", "tester", {
      provider: "zhipu",
      model: "glm-5.2",
    });
    setModelPolicy(root, "lead", "fallback", "0", {
      provider: "xiaomi-token-plan-cn",
      model: "mimo-v2.5-pro",
    });

    reportRateLimit(root, "system", "Provider HTTP 429 from openai-codex.", "provider_429", "2099-01-01T00:00:00.000Z", {
      provider: "openai-codex",
    });
    const command = launchCommand(root, "tester", "/tmp/company.js");

    expect(command).toContain("--provider 'zhipu'");
    expect(command).toContain("--model 'glm-5.2'");
  });

  it("lets fallback-capable agents wake during provider-specific backoff", () => {
    const root = tempRoot();
    initCompany({ root, id: "fallback-wake-demo" });
    setModelPolicy(root, "lead", "role", "tester", {
      provider: "zhipu",
      model: "glm-5.2",
    });
    setModelPolicy(root, "lead", "fallback", "0", {
      provider: "xiaomi-token-plan-cn",
      model: "mimo-v2.5-pro",
    });
    const state = reportRateLimit(root, "tester", "Provider HTTP 429 from zhipu.", "provider_429", "2099-01-01T00:00:00.000Z", {
      provider: "zhipu",
    });
    const message = sendCompanyMessage(root, {
      from: "lead",
      to: "tester",
      type: "assignment",
      text: "Continue with fallback.",
    });

    expect(agentRateLimitResumeAt(state, "tester")).toBeNull();
    expect(shouldAutoDeliverMessage(message, loadState(root), "tester", "2099-01-01T00:00:01.000Z")).toBe(true);
  });

  it("applies provider-specific backoff only to the unhealthy provider", () => {
    const root = tempRoot();
    initCompany({ root, id: "provider-specific-backoff-demo" });

    const providerState = reportRateLimit(root, "system", "Provider HTTP 429 from zhipu.", "provider_429", "2099-01-01T00:00:00.000Z", {
      provider: "zhipu",
    });

    expect(rateLimitAppliesToProvider(providerState, "zhipu", "2099-01-01T00:00:01.000Z")).toBe(true);
    expect(rateLimitAppliesToProvider(providerState, "xiaomi-token-plan-cn", "2099-01-01T00:00:01.000Z")).toBe(false);

    const manualState = reportRateLimit(root, "system", "Human pause.", "manual", "2099-01-01T00:00:02.000Z");

    expect(rateLimitAppliesToProvider(manualState, "xiaomi-token-plan-cn", "2099-01-01T00:00:03.000Z")).toBe(true);
  });

  it("requires self-test, automated tests, review, tester pass, and product acceptance before merge", () => {
    const root = tempRoot();
    initCompany({ root, id: "pr-demo" });
    registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Add mailbox polling",
      issue_id: null,
      summary: "Adds local inbox polling.",
      branch: "pi-company/coder",
      worktree: path.join(root, ".pi-company/worktrees/coder"),
      base: "main",
    });

    expect(getPrGateStatus(root, pr.id).ready).toBe(false);
    expect(getPrGateStatus(root, pr.id).blockers).toContain("PR is still draft");

    markPrReady(root, "coder", pr.id, "npm test passed", "Validate mailbox delivery and no duplicate injection.");
    recordAutomatedTests(root, "coder", pr.id, "passed", "npm test passed", "npm test");
    submitReview(root, "reviewer", pr.id, "approve", "Diff and tests look correct.");
    submitTest(root, "tester", pr.id, "pass", "Acceptance workflow passed.");

    expect(getPrGateStatus(root, pr.id).ready).toBe(false);
    expect(getPrGateStatus(root, pr.id).blockers).toContain("Missing PM/lead product acceptance");

    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior matches the request and acceptance criteria.");

    expect(getPrGateStatus(root, pr.id)).toEqual({ ready: true, blockers: [] });
    expect(loadState(root).prs[pr.id].status).toBe("ready_to_merge");
  });

  it("notifies lead when a coder marks a PR ready", () => {
    const root = tempRoot();
    initCompany({ root, id: "ready-notify-demo" });
    const plan = registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Ready notification",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });

    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate feature behavior.");

    const messages = listInbox(root, "lead");
    expect(messages).toHaveLength(1);
    expect(messages[0].from).toBe("coder");
    expect(messages[0].task).toBe(pr.id);
    expect(messages[0].priority).toBe("high");
    expect(messages[0].wake?.mode).toBe("immediate");
    expect(messages[0].text).toContain("Assign reviewer/tester");
  });

  it("notifies lead when PR gate evidence is submitted", () => {
    const root = tempRoot();
    initCompany({ root, id: "gate-notify-demo" });
    const plan = registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Gate notification",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate feature behavior.");
    acknowledgeInbox(root, "lead", listInbox(root, "lead").map((message) => message.id));

    recordAutomatedTests(root, "coder", pr.id, "passed", "Automated checks passed.", "npm test");
    submitReview(root, "reviewer", pr.id, "approve", "Approved.");
    submitTest(root, "tester", pr.id, "pass", "Passed.");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");

    const messages = listInbox(root, "lead");
    expect(messages.map((message) => message.from)).toEqual(["coder", "reviewer", "tester", "pm"]);
    expect(messages.map((message) => message.task)).toEqual([pr.id, pr.id, pr.id, pr.id]);
    expect(messages.every((message) => message.priority === "high")).toBe(true);
    expect(messages.every((message) => message.wake?.mode === "immediate")).toBe(true);
    expect(messages.map((message) => message.text).join("\n")).toContain("Automated tests passed");
    expect(messages.map((message) => message.text).join("\n")).toContain("Review approve");
    expect(messages.map((message) => message.text).join("\n")).toContain("Tester status pass");
    expect(messages.map((message) => message.text).join("\n")).toContain("Product acceptance accept");
  });

  it("blocks positive PR evidence when the PR worktree has uncommitted changes", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "dirty-pr-evidence-demo" });
    const plan = registerCoder(root);
    ensureCoderWorktree(root, plan, true);
    commitFile(plan.worktree ?? root, "feature.txt", "committed\n", "feature");
    const pr = createPr(root, "coder", {
      title: "Dirty worktree guard",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    fs.writeFileSync(path.join(plan.worktree ?? root, "feature.txt"), "uncommitted\n", "utf8");

    expect(() => markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate behavior.")).toThrow(
      /uncommitted changes/,
    );

    commitFile(plan.worktree ?? root, "feature.txt", "fixed\n", "feature fix");
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate behavior.");
    fs.writeFileSync(path.join(plan.worktree ?? root, "feature.txt"), "new dirty change\n", "utf8");

    expect(() => submitReview(root, "reviewer", pr.id, "approve", "Approved.")).toThrow(/uncommitted changes/);
    expect(() => submitTest(root, "tester", pr.id, "pass", "Passed.")).toThrow(/uncommitted changes/);
    expect(() => submitAcceptance(root, "pm", pr.id, "accept", "Accepted.")).toThrow(/uncommitted changes/);
    expect(() => recordAutomatedTests(root, "tester", pr.id, "passed", "Automated checks passed.", "npm test")).toThrow(
      /uncommitted changes/,
    );
    submitReview(root, "reviewer", pr.id, "request_changes", "Dirty worktree must be committed.");
    submitTest(root, "tester", pr.id, "blocked", "Dirty worktree blocks validation.");
    submitAcceptance(root, "pm", pr.id, "request_changes", "Dirty worktree blocks product acceptance.");
  }, 20_000);

  it("does not let later dirty work in a reused coder worktree block merged PRs", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "merged-pr-reused-worktree-demo" });
    const plan = registerCoder(root);
    ensureCoderWorktree(root, plan, true);
    commitFile(plan.worktree ?? root, "feature.txt", "committed\n", "feature");
    const pr = createPr(root, "coder", {
      title: "Completed feature",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    passPrGates(root, pr.id);
    mergePr(root, "lead", pr.id, true);

    fs.writeFileSync(path.join(plan.worktree ?? root, "next-feature.txt"), "uncommitted future work\n", "utf8");

    const brief = buildLeadBrief(root);
    const rendered = renderLeadBrief(brief);

    expect(brief.prs.find((item) => item.id === pr.id)?.worktree_dirty).toEqual([]);
    expect(brief.reasons_not_complete).not.toContain("1 PR worktree(s) have uncommitted changes");
    expect(rendered).not.toContain(`${pr.id} merged merged dirty_worktree=`);
    expect(rendered).not.toContain(`${pr.id}: ask coder to commit or revert PR worktree changes deliberately`);
  }, 20_000);

  it("blocks a coder from starting another issue while their previous PR is unmerged", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "open-pr-task-guard-demo" });
    const plan = registerCoder(root);
    ensureCoderWorktree(root, plan, true);
    const firstIssue = createIssue(root, "lead", "Build tools", "Implement tools.");
    const secondIssue = createIssue(root, "lead", "Build commands", "Implement commands.");
    assignIssue(root, "lead", firstIssue.id, "coder");
    assignIssue(root, "lead", secondIssue.id, "coder");
    startTask(root, "coder", firstIssue.id);
    commitFile(plan.worktree ?? root, "tools.txt", "tools\n", "tools");
    const pr = createPr(root, "coder", {
      title: "Tools",
      issue_id: firstIssue.id,
      summary: "Tools implementation.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });

    expect(() => startTask(root, "coder", secondIssue.id)).toThrow(
      new RegExp(`Cannot start ${secondIssue.id}; coder already has open PR\\(s\\) ${pr.id}`),
    );
    expect(() => startTask(root, "coder", firstIssue.id)).not.toThrow();
  }, 20_000);

  it("keeps lead brief authoritative when worker prose claims completion", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "lead-brief-truth-demo" });
    const plan = registerCoder(root);
    ensureCoderWorktree(root, plan, true);
    const issue = createIssue(root, "lead", "Build chat API", "Deliver the API through local PR gates.");
    assignIssue(root, "lead", issue.id, "coder");
    commitFile(plan.worktree ?? root, "api.txt", "api work\n", "api work");
    const pr = createPr(root, "coder", {
      title: "Chat API",
      issue_id: issue.id,
      summary: "Chat API implementation.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    sendCompanyMessage(root, {
      from: "coder",
      to: "lead",
      type: "report",
      task: pr.id,
      text: "PR 已合并，项目完成。",
    });

    const brief = buildLeadBrief(root);
    const rendered = renderLeadBrief(brief);

    expect(brief.can_claim_complete).toBe(false);
    expect(brief.delivery_state).toBe("blocked");
    expect(brief.incomplete_issues.map((item) => item.id)).toContain(issue.id);
    expect(brief.prs.find((item) => item.id === pr.id)?.status).toBe("draft");
    expect(rendered).toContain("do not say the project or feature is complete");
    expect(rendered).toContain(`${pr.id} draft blocked`);
    expect(rendered).toContain("PR is still draft");
  });

  it("surfaces PR evidence caveats in lead brief and PR messages", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "lead-evidence-ledger-demo" });
    const plan = registerCoder(root);
    ensureCoderWorktree(root, plan, true);
    commitFile(plan.worktree ?? root, "ui.txt", "ui work\n", "ui work");
    const pr = createPr(root, "coder", {
      title: "Retro docs UI",
      issue_id: null,
      summary: "Implements the docs UI.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });

    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate docs UI.");
    recordAutomatedTests(root, "coder", pr.id, "passed", "58 tests passed, 0 failed.", "npm test && npm run build");
    submitTest(root, "tester", pr.id, "pass", "PASS. Full UI flow validated.");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");
    submitReview(root, "reviewer", pr.id, "approve", "Approve. Non-blocking follow-up: clean up interval lifecycle later.");

    const brief = buildLeadBrief(root);
    const rendered = renderLeadBrief(brief);
    const message = sendCompanyMessage(root, {
      from: "lead",
      to: "reviewer",
      type: "review",
      task: pr.id,
      text: "Please approve; all blockers are fixed.",
    });

    expect(getPrGateStatus(root, pr.id).blockers).toContain("Reviewer approval contains caveat");
    expect(rendered).toContain("PR Evidence:");
    expect(rendered).toContain("review: approve by reviewer caveat=true");
    expect(rendered).toContain("recent risks:");
    expect(rendered).toContain("Non-blocking follow-up");
    expect(message.text).toContain("[pi-company PR gate snapshot]");
    expect(message.text).toContain("gate: blocked: Reviewer approval contains caveat");
    expect(message.text).toContain("review: approve by reviewer caveat=true");
  });

  it("tells lead to fix or waive caveated gates instead of calling work usable", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "caveated-gate-next-action-demo" });
    const plan = registerCoder(root);
    ensureCoderWorktree(root, plan, true);
    commitFile(plan.worktree ?? root, "game.html", "<canvas></canvas>\n", "game");
    const pr = createPr(root, "coder", {
      title: "Pixel game",
      issue_id: null,
      summary: "Implements the game.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });

    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate gameplay.");
    recordAutomatedTests(root, "coder", pr.id, "passed", "58 tests passed, 0 failed.", "npm test");
    submitReview(root, "reviewer", pr.id, "approve", "Approve, but bird drawing needs polish before merge.");
    submitTest(root, "tester", pr.id, "pass", "PASS. Gameplay works.");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");

    const rendered = renderLeadBrief(buildLeadBrief(root));

    expect(getPrGateStatus(root, pr.id).blockers).toContain("Reviewer approval contains caveat");
    expect(rendered).toContain("caveated gate evidence blocks delivery");
    expect(rendered).toContain("assign coder to resolve it");
    expect(rendered).toContain("explicit risk waiver");
    expect(rendered).toContain("Do not describe this as complete, usable, or only a minor suggestion.");
  });

  it("blocks final completion when project root has untracked artifacts", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "root-untracked-brief-demo" });
    runGit(root, ["add", ".gitignore"]);
    runGit(root, ["commit", "-m", "track company gitignore"]);

    expect(buildLeadBrief(root).can_claim_complete).toBe(true);

    fs.writeFileSync(path.join(root, "PRODUCT.md"), "# Product notes\n", "utf8");
    const brief = buildLeadBrief(root);
    const rendered = renderLeadBrief(brief);

    expect(brief.can_claim_complete).toBe(false);
    expect(brief.delivery_state).toBe("blocked");
    expect(brief.reasons_not_complete).toContain("project root has tracked, staged, or untracked changes");
    expect(brief.root_worktree_changes).toContain("?? PRODUCT.md");
    expect(rendered).toContain("Root Worktree Changes:");
    expect(rendered).toContain("Resolve tracked, staged, or untracked project-root changes before final delivery");
  });

  it("blocks delivery when runnable files appear in a non-git project root outside PR flow", () => {
    const root = tempRoot();
    initCompany({ root, id: "root-deliverable-boundary-demo" });
    fs.writeFileSync(path.join(root, "index.html"), "<html></html>\n", "utf8");

    const brief = buildLeadBrief(root);
    const rendered = renderLeadBrief(brief);

    expect(brief.delivery_state).toBe("blocked");
    expect(brief.can_claim_complete).toBe(false);
    expect(rendered).toContain("project root has runnable deliverables outside git/worktree PR flow: index.html");
    expect(rendered).toContain("Fix role boundary violation");
  });

  it("does not count author self-review or self-test as independent gates", () => {
    const root = tempRoot();
    initCompany({ root, id: "independent-gates-demo" });
    registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Add feature",
      issue_id: null,
      summary: "Feature summary.",
      branch: "pi-company/coder",
      worktree: path.join(root, ".pi-company/worktrees/coder"),
      base: "main",
    });

    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate feature behavior.");
    recordAutomatedTests(root, "coder", pr.id, "passed", "Automated checks passed.", "npm test");
    expect(() => submitReview(root, "coder", pr.id, "approve", "Self-approved.")).toThrow(/Only reviewer agents can submit reviews/);
    expect(() => submitTest(root, "coder", pr.id, "pass", "Self-tested.")).toThrow(/Only tester agents can submit tests/);
    expect(() => submitAcceptance(root, "coder", pr.id, "accept", "Self-accepted.")).toThrow(/Only lead or pm agents can accept product behavior/);

    const selfGates = getPrGateStatus(root, pr.id);
    expect(selfGates.ready).toBe(false);
    expect(selfGates.blockers).toContain("Needs 1 reviewer approval(s)");
    expect(selfGates.blockers).toContain("Missing tester validation");
    expect(selfGates.blockers).toContain("Missing PM/lead product acceptance");

    submitReview(root, "reviewer", pr.id, "approve", "Approved.");
    submitTest(root, "tester", pr.id, "pass", "Passed.");
    expect(getPrGateStatus(root, pr.id).blockers).toContain("Missing PM/lead product acceptance");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");
    expect(getPrGateStatus(root, pr.id)).toEqual({ ready: true, blockers: [] });
  });

  it("rejects PR evidence from unknown or wrong-role actors", () => {
    const root = tempRoot();
    initCompany({ root, id: "pr-evidence-actor-demo" });
    registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Evidence actors",
      issue_id: null,
      summary: "Feature summary.",
      branch: "pi-company/coder",
      worktree: path.join(root, ".pi-company/worktrees/coder"),
      base: "main",
    });

    expect(() => markPrReady(root, "tester", pr.id, "Ready by tester.", "Validate feature.")).toThrow(
      /Only coder can mark PR-001 ready/,
    );
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate feature behavior.");
    expect(() => submitReview(root, "reviewer-typo", pr.id, "approve", "Ghost approved.")).toThrow(
      /Unknown submit reviews actor reviewer-typo/,
    );
    expect(() => submitTest(root, "tester-typo", pr.id, "pass", "Ghost passed.")).toThrow(
      /Unknown submit tests actor tester-typo/,
    );
    expect(() => submitAcceptance(root, "pm-typo", pr.id, "accept", "Ghost accepted.")).toThrow(
      /Unknown acceptance actor pm-typo/,
    );
    expect(() => submitAcceptance(root, "tester", pr.id, "accept", "Wrong role accepted.")).toThrow(
      /Only lead or pm agents can accept product behavior/,
    );
    expect(() => recordAutomatedTests(root, "coder-typo", pr.id, "passed", "Ghost tests.", "npm test")).toThrow(
      /Unknown automated test actor coder-typo/,
    );
    expect(() => recordAutomatedTests(root, "reviewer", pr.id, "passed", "Wrong role tests.", "npm test")).toThrow(
      /Only coder, tester agents, or system can record automated tests/,
    );
  });

  it("blocks PR creation by unknown or non-coder authors", () => {
    const root = tempRoot();
    initCompany({ root, id: "pr-author-demo" });

    expect(() => createPr(root, "coder-typo", {
      title: "Ghost PR",
      issue_id: null,
      summary: "Ghost summary.",
      branch: "feature",
      worktree: root,
      base: "main",
    })).toThrow(/Unknown PR author coder-typo/);

    expect(() => createPr(root, "reviewer", {
      title: "Reviewer PR",
      issue_id: null,
      summary: "Reviewer summary.",
      branch: "feature",
      worktree: root,
      base: "main",
    })).toThrow(/Only coder agents can create PRs/);

    expect(Object.keys(loadState(root).prs)).toHaveLength(0);
  });

  it("requires issue-bound PRs to be created by the assigned issue owner", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "pr-issue-owner-demo" });
    const planA = registerCoder(root, "coder-a");
    const planB = registerCoder(root, "coder-b");
    const issue = createIssue(root, "lead", "Owned feature", "Acceptance criteria.");
    const unassigned = createIssue(root, "lead", "Unassigned feature", "Acceptance criteria.");
    assignIssue(root, "lead", issue.id, "coder-a");

    expect(() => createPr(root, "coder-a", {
      title: "Unknown issue PR",
      issue_id: "ISSUE-999",
      summary: "Should not be allowed.",
      branch: planA.branch ?? "pi-company/coder-a",
      worktree: planA.worktree ?? root,
      base: "main",
    })).toThrow(/Unknown PR issue ISSUE-999/);
    expect(() => createPr(root, "coder-a", {
      title: "Unassigned issue PR",
      issue_id: unassigned.id,
      summary: "Should not be allowed.",
      branch: planA.branch ?? "pi-company/coder-a",
      worktree: planA.worktree ?? root,
      base: "main",
    })).toThrow(/Issue ISSUE-002 is unassigned/);
    expect(() => createPr(root, "coder-b", {
      title: "Wrong owner PR",
      issue_id: issue.id,
      summary: "Should not be allowed.",
      branch: planB.branch ?? "pi-company/coder-b",
      worktree: planB.worktree ?? root,
      base: "main",
    })).toThrow(/Only coder-a can create PRs for ISSUE-001/);

    const pr = createPr(root, "coder-a", {
      title: "Owned PR",
      issue_id: issue.id,
      summary: "Allowed.",
      branch: planA.branch ?? "pi-company/coder-a",
      worktree: planA.worktree ?? root,
      base: "main",
    });
    expect(pr.issue_id).toBe(issue.id);

    expect(() => completeTask(root, "coder-a", issue.id, "Done.")).toThrow(/unmerged PR/);
    const doneIssue = createIssue(root, "lead", "Already done feature", "Acceptance criteria.");
    assignIssue(root, "lead", doneIssue.id, "coder-a");
    completeTask(root, "coder-a", doneIssue.id, "Done.");
    expect(() => createPr(root, "coder-a", {
      title: "Done issue PR",
      issue_id: doneIssue.id,
      summary: "Should not be allowed.",
      branch: planA.branch ?? "pi-company/coder-a",
      worktree: planA.worktree ?? root,
      base: "main",
    })).toThrow(new RegExp(`Issue ${doneIssue.id} is already done`));

    recordEvent(root, makeEvent("pr.created", "coder-b", {
      pr: {
        ...pr,
        id: "PR-999",
        author: "coder-b",
        branch: planB.branch ?? "pi-company/coder-b",
        worktree: planB.worktree ?? root,
      },
    }));
    expect(loadState(root).prs["PR-999"]).toBeUndefined();
  });

  it("does not grant coder privileges from coder-prefixed agent names", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "coder-name-demo" });
    const plan = requestAgentSpawn(root, "lead", "reviewer", "coder-reviewer", "Reviewer with misleading name.");

    expect(plan.branch).toBeNull();
    expect(plan.worktree).toBeNull();
    registerAgent(root, {
      ...plan,
      status: "online",
    });

    expect(() => createPr(root, "coder-reviewer", {
      title: "Misleading PR",
      issue_id: null,
      summary: "Should not be allowed.",
      branch: "pi-company/coder-reviewer",
      worktree: root,
      base: "main",
    })).toThrow(/Only coder agents can create PRs/);
  });

  it("normalizes coder PR short branch names to the registered git branch", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "branch-demo" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-site", "Branch demo coder.");
    registerAgent(root, {
      ...plan,
      status: "online",
    });
    runGit(root, ["checkout", "-b", "pi-company/coder-site"]);

    const pr = createPr(root, "coder-site", {
      title: "Demo",
      issue_id: null,
      summary: "Demo summary",
      branch: "coder-site",
      worktree: plan.worktree ?? root,
      base: "main",
    });

    expect(pr.branch).toBe("pi-company/coder-site");
  });

  it("blocks PRs that do not match the author's registered branch or worktree", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "pr-ownership-demo" });
    const ownedWorktree = path.join(root, ".pi-company/worktrees/coder-owned");
    requestAgentSpawn(root, "lead", "coder", "coder-owned", "Owned PR coder.");
    registerAgent(root, {
      name: "coder-owned",
      role: "coder",
      cwd: ownedWorktree,
      branch: "pi-company/coder-owned",
      worktree: ownedWorktree,
      status: "online",
    });
    runGit(root, ["checkout", "-b", "pi-company/coder-owned"]);
    commitFile(root, "owned.txt", "owned\n", "owned branch");
    runGit(root, ["checkout", "main"]);
    runGit(root, ["checkout", "-b", "other-branch"]);
    commitFile(root, "other.txt", "other\n", "other branch");
    runGit(root, ["checkout", "main"]);

    expect(() => createPr(root, "coder-owned", {
      title: "Wrong branch",
      issue_id: null,
      summary: "Wrong branch.",
      branch: "other-branch",
      worktree: ownedWorktree,
      base: "main",
    })).toThrow(/does not match coder-owned's registered branch/);

    expect(() => createPr(root, "coder-owned", {
      title: "Wrong worktree",
      issue_id: null,
      summary: "Wrong worktree.",
      branch: "pi-company/coder-owned",
      worktree: root,
      base: "main",
    })).toThrow(/does not match coder-owned's registered worktree/);

    const pr = createPr(root, "coder-owned", {
      title: "Owned PR",
      issue_id: null,
      summary: "Owned branch and worktree.",
      branch: "pi-company/coder-owned",
      worktree: ownedWorktree,
      base: "main",
    });
    expect(pr.branch).toBe("pi-company/coder-owned");
  });

  it("does not re-merge a PR already marked merged", () => {
    const root = tempRoot();
    initCompany({ root, id: "merged-demo" });
    const plan = registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Already merged",
      issue_id: null,
      summary: "Done",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    passPrGates(root, pr.id);
    recordEvent(root, makeEvent("merge.completed", "lead", {
      pr_id: pr.id,
      head: loadState(root).prs[pr.id].head,
    }));

    const state = mergePr(root, "lead", pr.id, true);

    expect(state.prs[pr.id].status).toBe("merged");
  });

  it("keeps merged PRs terminal across API calls and replay", () => {
    const root = tempRoot();
    initCompany({ root, id: "merged-terminal-demo" });
    const plan = registerCoder(root);
    registerAgent(root, {
      name: "reviewer",
      role: "reviewer",
      cwd: root,
      status: "online",
    });
    registerAgent(root, {
      name: "tester",
      role: "tester",
      cwd: root,
      status: "online",
    });
    const pr = createPr(root, "coder", {
      title: "Terminal PR",
      issue_id: null,
      summary: "Done",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    passPrGates(root, pr.id);
    recordEvent(root, makeEvent("merge.completed", "lead", {
      pr_id: pr.id,
      head: loadState(root).prs[pr.id].head,
    }));

    expect(() => markPrReady(root, "coder", pr.id, "Late self-test.", "Late brief.")).toThrow(/already merged/);
    expect(() => submitReview(root, "reviewer", pr.id, "request_changes", "Late review.")).toThrow(/already merged/);
    expect(() => submitTest(root, "tester", pr.id, "fail", "Late test.")).toThrow(/already merged/);
    expect(() => recordAutomatedTests(root, "tester", pr.id, "failed", "Late automated test.")).toThrow(/already merged/);

    recordEvent(root, makeEvent("pr.ready", "coder", {
      pr_id: pr.id,
      self_test: "Bad replay self-test.",
      test_brief: "Bad replay brief.",
      head: null,
    }));
    recordEvent(root, makeEvent("review.submitted", "reviewer", {
      pr_id: pr.id,
      decision: "request_changes",
      summary: "Bad replay review.",
      head: null,
    }));
    recordEvent(root, makeEvent("test.submitted", "tester", {
      pr_id: pr.id,
      status: "fail",
      summary: "Bad replay test.",
      head: null,
    }));
    recordEvent(root, makeEvent("pr.automated_tests", "tester", {
      pr_id: pr.id,
      status: "failed",
      summary: "Bad replay automated test.",
      head: null,
    }));

    const state = loadState(root);
    expect(state.prs[pr.id].status).toBe("merged");
    expect(state.prs[pr.id].self_test).toBe("Self-test passed.");
    expect(state.prs[pr.id].test_brief).toBe("Validate feature behavior.");
    expect(state.prs[pr.id].reviews).toHaveLength(1);
    expect(state.prs[pr.id].reviews[0].decision).toBe("approve");
    expect(state.prs[pr.id].tests).toHaveLength(1);
    expect(state.prs[pr.id].tests[0].status).toBe("pass");
    expect(state.prs[pr.id].automated_tests?.status).toBe("passed");
  });

  it("downgrades repeated non-human wakes for the same agent to digest", () => {
    const root = tempRoot();
    initCompany({ root, id: "wake-demo" });

    const first = sendCompanyMessage(root, {
      from: "lead",
      to: "tester",
      type: "assignment",
      text: "Validate PR-001.",
    });
    const second = sendCompanyMessage(root, {
      from: "lead",
      to: "tester",
      type: "assignment",
      text: "Also validate PR-002.",
    });
    const human = recordHumanSteering(root, "tester", "This steering must still reach lead.", "steer");

    expect(first.wake?.mode).toBe("immediate");
    expect(second.wake?.mode).toBe("digest");
    expect(second.wake?.reason).toContain("cooling down");
    expect(second.wake?.next_wake_after).toBeTruthy();
    expect(human?.wake?.mode).toBe("immediate");
  });

  it("uses short wake defaults because provider requests are gated separately", () => {
    expect(DEFAULT_MESSAGE_POLICY.agent_cooldown_ms).toBe(10_000);
    expect(DEFAULT_MESSAGE_POLICY.agent_max_immediate_per_minute).toBe(6);
    expect(DEFAULT_MESSAGE_POLICY.org_max_immediate_per_minute).toBe(12);
  });

  it("honors current company.yaml message wake policy without replay-only stale config", () => {
    const root = tempRoot();
    initCompany({ root, id: "wake-policy-yaml-demo" });
    const config = loadState(root).config;
    if (!config) throw new Error("Missing config");
    fs.writeFileSync(companyPaths(root).config, YAML.stringify({
      ...config,
      message_policy: {
        ...DEFAULT_MESSAGE_POLICY,
        immediate_types: [],
      },
    }), "utf8");

    const message = sendCompanyMessage(root, {
      from: "lead",
      to: "tester",
      type: "assignment",
      priority: "normal",
      text: "This assignment should respect the edited YAML wake policy.",
    });

    expect(message.wake?.mode).toBe("digest");
    expect(message.wake?.reason).toContain("assignment is digest by default");
  });

  it("rate-limits repeated urgent wakes for the same target", () => {
    const root = tempRoot();
    initCompany({ root, id: "urgent-rate-demo" });

    const first = sendCompanyMessage(root, {
      from: "lead",
      to: "tester",
      type: "system",
      priority: "urgent",
      text: "First urgent check.",
    });
    const second = sendCompanyMessage(root, {
      from: "lead",
      to: "tester",
      type: "system",
      priority: "urgent",
      text: "Second urgent check.",
    });

    expect(first.wake?.mode).toBe("immediate");
    expect(first.wake?.reason).toContain("urgent priority");
    expect(second.wake?.mode).toBe("digest");
    expect(second.wake?.reason).toContain("cooling down");
    expect(second.wake?.next_wake_after).toBeTruthy();
  });

  it("auto-delivers delayed wake messages only after next_wake_after", () => {
    const root = tempRoot();
    initCompany({ root, id: "auto-delivery-demo" });

    const first = sendCompanyMessage(root, {
      from: "lead",
      to: "tester",
      type: "assignment",
      text: "First assignment.",
    });
    const second = sendCompanyMessage(root, {
      from: "lead",
      to: "tester",
      type: "assignment",
      text: "Second assignment.",
    });
    const ordinaryDigest = sendCompanyMessage(root, {
      from: "tester",
      to: "lead",
      type: "question",
      text: "Non-urgent question.",
    });

    expect(shouldAutoDeliverMessage(first)).toBe(true);
    expect(shouldAutoDeliverMessage(second)).toBe(false);
    expect(second.wake?.next_wake_after).toBeTruthy();
    expect(shouldAutoDeliverMessage(second, undefined, "tester", second.wake?.next_wake_after ?? "")).toBe(true);
    expect(ordinaryDigest.wake?.mode).toBe("digest");
    expect(ordinaryDigest.wake?.next_wake_after).toBeTruthy();
    expect(shouldAutoDeliverMessage(ordinaryDigest, undefined, "lead", ordinaryDigest.ts)).toBe(false);
    expect(shouldAutoDeliverMessage(ordinaryDigest, undefined, "lead", ordinaryDigest.wake?.next_wake_after ?? "")).toBe(true);

    const legacyDigest = {
      ...ordinaryDigest,
      wake: { mode: "digest" as const, reason: "legacy digest without next_wake_after" },
    };
    expect(shouldAutoDeliverMessage(legacyDigest, loadState(root), "lead", legacyDigest.ts)).toBe(false);
    expect(shouldAutoDeliverMessage(
      legacyDigest,
      loadState(root),
      "lead",
      new Date(Date.parse(legacyDigest.ts) + 60_000).toISOString(),
    )).toBe(true);
  });

  it("records provider 429 incidents with exponential backoff and lead notification", () => {
    const root = tempRoot();
    initCompany({ root, id: "rate-limit-provider-demo" });

    const first = reportRateLimit(root, "tester", "429 Too many requests", "provider_429", "2099-01-01T00:00:00.000Z");

    expect(first.rate_limit?.kind).toBe("provider_429");
    expect(first.rate_limit?.retry_after_ms).toBe(DEFAULT_RATE_LIMIT_POLICY.initial_backoff_ms);
    expect(first.rate_limit?.paused_until).toBe("2099-01-01T00:01:00.000Z");
    expect(first.rate_limit?.incidents).toBe(1);
    expect(rateLimitIsActive(first, "2099-01-01T00:00:30.000Z")).toBe(true);

    const leadMessage = listInbox(root, "lead").at(-1);
    expect(leadMessage?.type).toBe("system");
    expect(leadMessage?.wake?.mode).toBe("digest");
    expect(leadMessage?.wake?.next_wake_after).toBe("2099-01-01T00:01:00.000Z");

    const second = reportRateLimit(root, "tester", "Retry failed after 3 attempts", "provider_429", "2099-01-01T00:00:30.000Z");

    expect(second.rate_limit?.retry_after_ms).toBe(120_000);
    expect(second.rate_limit?.paused_until).toBe("2099-01-01T00:02:30.000Z");
    expect(second.rate_limit?.incidents).toBe(2);
  });

  it("queues a recovery wake for lead when lead reports a rate limit", () => {
    const root = tempRoot();
    initCompany({ root, id: "lead-rate-limit-recovery-demo" });

    const state = reportRateLimit(root, "lead", "Lead hit 429 Too many requests", "provider_429", "2099-01-01T00:00:00.000Z");
    const leadMessage = listInbox(root, "lead").at(-1);

    expect(state.rate_limit?.paused_until).toBe("2099-01-01T00:01:00.000Z");
    expect(leadMessage?.from).toBe("system");
    expect(leadMessage?.wake?.mode).toBe("digest");
    expect(leadMessage?.wake?.next_wake_after).toBe("2099-01-01T00:01:00.000Z");
    expect(shouldAutoDeliverMessage(leadMessage!, state, "lead", "2099-01-01T00:01:00.000Z")).toBe(true);
  });

  it("marks agents offline when their last heartbeat is stale", () => {
    const root = tempRoot();
    initCompany({ root, id: "stale-agent-demo" });
    recordEvent(root, {
      ...makeEvent("agent.heartbeat", "pm", { name: "pm", status: "online" }),
      ts: "2000-01-01T00:00:00.000Z",
    });

    const state = loadState(root);

    expect(state.agents.pm.status).toBe("offline");
    expect(state.agents.researcher.status).toBe("planned");
  });

  it("marks cmux-launched agents offline when their surface disappears", () => {
    const root = tempRoot();
    initCompany({ root, id: "closed-cmux-surface-demo" });
    registerAgent(root, {
      name: "designer",
      role: "designer",
      cwd: root,
      status: "online",
    });
    const issue = createIssue(root, "lead", "Design the landing page", "Design brief.", { work_type: "design" });
    assignIssue(root, "lead", issue.id, "designer");
    startTask(root, "designer", issue.id, "Starting design.");
    recordAgentLaunch(root, "lead", "designer", "surface:closed");

    withFakeCmuxTree({ liveSurfaces: ["surface:lead"] }, () => {
      const state = loadState(root);
      expect(state.agents.designer.status).toBe("offline");
      expect(state.agents.designer.current_task).toBe(issue.id);
      expect(state.agents.designer.cmux_surface).toBe("surface:closed");
      expect(buildLeadBrief(root).next_actions).toContain(
        "ISSUE-001: recover designer before continuing; inspect the lead recovery notice or .pi-company/runtime/recovery/designer.json terminal text excerpt, then relaunch the same owner or reassign deliberately",
      );
    });
  }, 20_000);

  it("captures terminal text recovery context and notifies lead when a worker surface disappears", () => {
    const root = tempRoot();
    initCompany({ root, id: "recovery-snapshot-demo" });
    registerAgent(root, {
      name: "designer",
      role: "designer",
      cwd: root,
      status: "online",
    });
    const issue = createIssue(root, "lead", "Design the landing page", "Design brief.", { work_type: "design" });
    assignIssue(root, "lead", issue.id, "designer");
    startTask(root, "designer", issue.id, "Starting design.");
    recordAgentLaunch(root, "lead", "designer", "surface:designer");
    const firstNow = new Date().toISOString();
    const secondNow = new Date(Date.now() + 120_000).toISOString();

    withFakeCmux({
      liveSurfaces: ["surface:lead", "surface:designer"],
      titles: {
        "surface:designer": "pi-company designer",
      },
      screens: {
        "surface:designer": "pi-company recovery-snapshot-demo | designer (designer)\nWorking on hero states\nAPI_KEY=secret-123\nnpm_abcdefghijklmnopqrstuvwxyz\nready to report soon\n",
      },
    }, () => {
      const first = maintainCompany(root, "lead", firstNow);
      expect(first.actions.some((action) => action.type === "snapshot" && action.agent === "designer")).toBe(true);
      const snapshot = readAgentRecoverySnapshot(root, "designer");
      expect(snapshot?.screen_excerpt).toContain("Working on hero states");
      expect(snapshot?.screen_excerpt).toContain("API_KEY=[REDACTED]");
      expect(snapshot?.screen_excerpt).toContain("npm_[REDACTED]");
    });

    withFakeCmux({ liveSurfaces: ["surface:lead"] }, () => {
      const result = maintainCompany(root, "lead", secondNow);
      const inbox = listInbox(root, "lead", true);
      const notice = inbox.find((message) => message.text.includes("[pi-company recovery]"));
      const rendered = renderLeadBrief(buildLeadBrief(root));

      expect(result.actions.some((action) => action.type === "offline" && action.agent === "designer")).toBe(true);
      expect(result.actions.some((action) => action.type === "lead_notice" && action.agent === "designer")).toBe(true);
      expect(loadState(root).agents.designer.current_task).toBe(issue.id);
      expect(notice?.text).toContain("Terminal text excerpt from last known cmux surface");
      expect(notice?.text).toContain("Working on hero states");
      expect(notice?.text).not.toContain("secret-123");
      expect(rendered).toContain("Recovery Snapshots:");
      expect(rendered).toContain("terminal text excerpt");
      expect(rendered).toContain("Working on hero states");
    });
  }, 20_000);

  it("hibernates idle worker surfaces without deleting worktrees", () => {
    const root = tempRoot();
    initCompany({ root, id: "idle-hibernate-demo" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-idle", "Idle coder.");
    fs.mkdirSync(plan.worktree ?? "", { recursive: true });
    fs.writeFileSync(path.join(plan.worktree ?? "", "keep.txt"), "keep worktree\n", "utf8");
    registerAgent(root, {
      ...plan,
      status: "online",
    });
    recordAgentLaunch(root, "lead", "coder-idle", "surface:coder-idle");
    recordAgentRuntime(root, "coder-idle", {
      status: "idle",
      cmux_surface: "surface:coder-idle",
      current_task: null,
      progress: true,
    }, "2099-01-01T00:00:00.000Z");
    const closeLog = path.join(root, "close.log");

    withFakeCmux({
      liveSurfaces: ["surface:lead", "surface:coder-idle"],
      screens: { "surface:coder-idle": "idle prompt\n" },
      closeLog,
    }, () => {
      const result = maintainCompany(root, "lead", "2099-01-01T00:10:00.000Z");
      expect(result.hibernated).toContain("coder-idle");
      expect(readAgentRuntime(root, "coder-idle")?.status).toBe("offline");
      expect(fs.readFileSync(closeLog, "utf8")).toContain("surface:coder-idle");
      expect(fs.existsSync(path.join(plan.worktree ?? "", "keep.txt"))).toBe(true);
    });
  }, 20_000);

  it("does not hibernate busy workers that have no assigned issue", () => {
    const root = tempRoot();
    initCompany({ root, id: "busy-worker-no-task-demo" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-busy", "Explore implementation.");
    registerAgent(root, {
      ...plan,
      status: "online",
    });
    recordAgentLaunch(root, "lead", "coder-busy", "surface:coder-busy");
    recordAgentRuntime(root, "coder-busy", {
      status: "busy",
      cmux_surface: "surface:coder-busy",
      current_task: null,
      progress: true,
    }, "2099-01-01T00:00:00.000Z");
    recordAgentRuntime(root, "coder-busy", {
      status: "busy",
      cmux_surface: "surface:coder-busy",
      current_task: null,
      turn_started: true,
    }, "2099-01-01T00:09:55.000Z");
    const closeLog = path.join(root, "close.log");

    withFakeCmux({
      liveSurfaces: ["surface:lead", "surface:coder-busy"],
      titles: { "surface:coder-busy": "pi-company coder-busy" },
      screens: { "surface:coder-busy": "still thinking\n" },
      closeLog,
    }, () => {
      const result = maintainCompany(root, "lead", "2099-01-01T00:10:00.000Z");
      expect(result.hibernated).not.toContain("coder-busy");
      expect(readAgentRuntime(root, "coder-busy")?.status).toBe("busy");
      expect(fs.existsSync(closeLog) ? fs.readFileSync(closeLog, "utf8") : "").not.toContain("surface:coder-busy");
    });
  }, 20_000);

  it("closes duplicate live cmux surfaces for the same agent and keeps the recorded surface", () => {
    const root = tempRoot();
    initCompany({ root, id: "duplicate-surface-demo" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-dupe", "Duplicate surface test.");
    registerAgent(root, {
      ...plan,
      status: "online",
    });
    recordAgentLaunch(root, "lead", "coder-dupe", "surface:keeper");
    recordAgentRuntime(root, "coder-dupe", {
      status: "busy",
      cmux_surface: "surface:keeper",
      current_task: null,
      progress: true,
    }, new Date().toISOString());
    const closeLog = path.join(root, "close.log");

    withFakeCmux({
      liveSurfaces: ["surface:old", "surface:keeper"],
      titles: {
        "surface:old": "pi-company coder-dupe",
        "surface:keeper": "pi-company coder-dupe",
      },
      screens: {
        "surface:old": "pi-company\nduplicate-surface-demo |\ncoder-du\npe (coder)\nold duplicate still working\n",
        "surface:keeper": "pi-company\nduplicate-surface-demo |\ncoder-du\npe (coder)\nkeeper working\n",
      },
      closeLog,
    }, () => {
      const result = maintainCompany(root, "lead", new Date().toISOString());

      expect(result.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "duplicate_surface",
          agent: "coder-dupe",
          cmux_surface: "surface:old",
        }),
      ]));
      expect(fs.readFileSync(closeLog, "utf8")).toContain("surface:old");
      expect(fs.readFileSync(closeLog, "utf8")).not.toContain("surface:keeper");
      expect(readAgentRuntime(root, "coder-dupe")?.cmux_surface).toBe("surface:keeper");
    });
  }, 20_000);

  it("treats a recorded cmux surface as live even when runtime still says offline", () => {
    const root = tempRoot();
    initCompany({ root, id: "recorded-live-surface-demo" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-resume", "Recorded live surface test.");
    registerAgent(root, {
      ...plan,
      status: "online",
    });
    const issue = createIssue(root, "lead", "Implement the resumed feature", "Feature brief.", { work_type: "implementation" });
    assignIssue(root, "lead", issue.id, "coder-resume");
    startTask(root, "coder-resume", issue.id, "Continuing work.");
    recordAgentLaunch(root, "lead", "coder-resume", "surface:coder");
    recordAgentRuntime(root, "coder-resume", {
      status: "offline",
      cmux_surface: "surface:coder",
      current_task: issue.id,
      note: "cmux surface disappeared",
    });

    withFakeCmux({
      liveSurfaces: ["surface:coder"],
      titles: {
        "surface:coder": "pi-company coder-resume",
      },
      screens: {
        "surface:coder": "terminal text without a company status line\n",
      },
    }, () => {
      expect(loadState(root).agents["coder-resume"].status).toBe("idle");
      maintainCompany(root, "lead", new Date().toISOString());
      const runtime = readAgentRuntime(root, "coder-resume");
      expect(runtime?.status).toBe("idle");
      expect(runtime?.note).toBeNull();
    });
  }, 20_000);

  it("uses runtime cmux surface when the persisted agent surface is stale", () => {
    const root = tempRoot();
    initCompany({ root, id: "runtime-surface-fallback-demo" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-live", "Runtime surface fallback.");
    registerAgent(root, {
      ...plan,
      status: "online",
    });
    recordAgentLaunch(root, "lead", "coder-live", "surface:old");
    recordAgentRuntime(root, "coder-live", {
      status: "idle",
      cmux_surface: "surface:new",
      current_task: null,
      progress: true,
    }, "2099-01-01T00:00:00.000Z");

    withFakeCmux({
      liveSurfaces: ["surface:new"],
      titles: {
        "surface:new": "pi-company coder-live",
      },
      screens: {
        "surface:new": "pi-company runtime-surface-fallback-demo | coder-live (coder)\n",
      },
    }, () => {
      const state = loadState(root);
      expect(state.agents["coder-live"].status).toBe("idle");
      expect(state.agents["coder-live"].cmux_surface).toBe("surface:new");
    });
  }, 20_000);

  it("discovers a live cmux surface by agent title when persisted state points at a stale surface", () => {
    const root = tempRoot();
    initCompany({ root, id: "title-surface-fallback-demo" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-title", "Title surface fallback.");
    registerAgent(root, {
      ...plan,
      status: "online",
    });
    recordAgentLaunch(root, "lead", "coder-title", "surface:stale");

    withFakeCmux({
      liveSurfaces: ["surface:fresh"],
      titles: {
        "surface:fresh": "pi-company coder-title",
      },
      screens: {
        "surface:fresh": "pi-company title-surface-fallback-demo | coder-title (coder)\nready\n",
      },
    }, () => {
      const state = loadState(root);
      expect(state.agents["coder-title"].status).toBe("online");
      expect(state.agents["coder-title"].cmux_surface).toBe("surface:fresh");
    });
  }, 20_000);

  it("treats a live cmux surface showing Pi Working as running even if runtime state is stale", () => {
    const root = tempRoot();
    initCompany({ root, id: "working-screen-status-demo" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-working", "Working screen status.");
    registerAgent(root, {
      ...plan,
      status: "online",
    });
    const issue = createIssue(root, "lead", "Keep working", "Feature brief.", { work_type: "implementation" });
    assignIssue(root, "lead", issue.id, "coder-working");
    startTask(root, "coder-working", issue.id, "Starting.");
    recordAgentLaunch(root, "lead", "coder-working", "surface:old");

    withFakeCmux({
      liveSurfaces: ["surface:new"],
      titles: {
        "surface:new": "pi-company coder-working",
      },
      screens: {
        "surface:new": "pi-company working-screen-status-demo | coder-working (coder)\n⠼ Working...\n",
      },
    }, () => {
      const state = loadState(root);
      expect(state.agents["coder-working"].status).toBe("running");
      expect(state.agents["coder-working"].cmux_surface).toBe("surface:new");
    });
  }, 20_000);

  it("reports visible provider throttling from cmux watchdog snapshots once", () => {
    const root = tempRoot();
    initCompany({ root, id: "watchdog-rate-limit-demo" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-throttled", "Watchdog rate-limit scan.");
    registerAgent(root, {
      ...plan,
      status: "online",
    });
    const issue = createIssue(root, "lead", "Handle throttling", "Feature brief.", { work_type: "implementation" });
    assignIssue(root, "lead", issue.id, "coder-throttled");
    startTask(root, "coder-throttled", issue.id, "Starting.");
    recordAgentLaunch(root, "lead", "coder-throttled", "surface:coder");

    withFakeCmux({
      liveSurfaces: ["surface:coder"],
      titles: {
        "surface:coder": "pi-company coder-throttled",
      },
      screens: {
        "surface:coder": "pi-company watchdog-rate-limit-demo | coder-throttled (coder)\nError: Retry failed after 3 attempts: 429 Too many requests\n",
      },
    }, () => {
      const first = maintainCompany(root, "lead", "2099-01-01T00:00:00.000Z");
      expect(first.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "rate_limit",
          agent: "coder-throttled",
          cmux_surface: "surface:coder",
        }),
      ]));
      expect(loadState(root).rate_limit?.kind).toBe("provider_429");
      expect(loadState(root).rate_limit?.reason).toContain("coder-throttled");

      const second = maintainCompany(root, "lead", "2099-01-01T00:02:00.000Z");
      expect(second.actions.some((action) => action.type === "rate_limit")).toBe(false);
      expect(loadState(root).rate_limit?.incidents).toBe(1);
    });
  }, 20_000);

  it("keeps one warm tester surface instead of hibernating every idle specialist", () => {
    const root = tempRoot();
    initCompany({ root, id: "keep-warm-demo" });
    registerAgent(root, {
      name: "tester",
      role: "tester",
      cwd: root,
      status: "online",
    });
    recordAgentLaunch(root, "lead", "tester", "surface:tester");
    recordAgentRuntime(root, "tester", {
      status: "idle",
      cmux_surface: "surface:tester",
      current_task: null,
      progress: true,
    }, "2099-01-01T00:00:00.000Z");
    const closeLog = path.join(root, "close.log");

    withFakeCmux({
      liveSurfaces: ["surface:lead", "surface:tester"],
      screens: { "surface:tester": "tester waiting\n" },
      closeLog,
    }, () => {
      const result = maintainCompany(root, "lead", "2099-01-01T00:30:00.000Z");
      expect(result.hibernated).not.toContain("tester");
      expect(fs.existsSync(closeLog) ? fs.readFileSync(closeLog, "utf8") : "").toBe("");
    });
  }, 20_000);

  it("uses quota cooldown for exhausted-account incidents", () => {
    const root = tempRoot();
    initCompany({ root, id: "quota-rate-limit-demo" });

    const state = reportRateLimit(root, "system", "Quota exhausted", "quota_exhausted", "2099-01-01T00:00:00.000Z");

    expect(state.rate_limit?.kind).toBe("quota_exhausted");
    expect(state.rate_limit?.retry_after_ms).toBe(DEFAULT_RATE_LIMIT_POLICY.quota_backoff_ms);
    expect(state.rate_limit?.paused_until).toBe("2099-01-01T00:10:00.000Z");
  });

  it("allows lead or system to clear a verified false-positive rate-limit backoff", () => {
    const root = tempRoot();
    initCompany({ root, id: "clear-rate-limit-demo" });
    reportRateLimit(root, "system", "False screen-scan quota hit", "quota_exhausted", "2099-01-01T00:00:00.000Z");
    const delayed = sendCompanyMessage(root, {
      from: "tester",
      to: "lead",
      type: "system",
      priority: "high",
      text: "Important test result queued during false backoff.",
    });

    expect(() => clearRateLimit(root, "tester", "Worker should not clear global protection.")).toThrow(
      /Only lead can clear rate-limit backoff/,
    );
    expect(delayed.wake?.reason).toContain("organization rate-limit backoff");
    expect(shouldAutoDeliverMessage(delayed, loadState(root), "lead", "2099-01-01T00:00:30.000Z")).toBe(false);
    const state = clearRateLimit(root, "lead", "Verified false positive from API docs.", "2099-01-01T00:00:30.000Z");
    const leadMessages = listInbox(root, "lead");

    expect(state.rate_limit).toBeNull();
    expect(rateLimitIsActive(state, "2099-01-01T00:00:31.000Z")).toBe(false);
    expect(shouldAutoDeliverMessage(delayed, state, "lead", "2099-01-01T00:00:31.000Z")).toBe(true);
    expect(leadMessages.at(-1)?.text).toContain("Rate-limit backoff cleared by lead");
    expect(leadMessages.at(-1)?.wake?.mode).toBe("immediate");
  });

  it("pauses automatic wakes and staggers recovery by agent", () => {
    const root = tempRoot();
    initCompany({ root, id: "rate-limit-stagger-demo" });
    const state = reportRateLimit(root, "system", "429 storm", "provider_429", "2099-01-01T00:00:00.000Z");

    expect(agentRateLimitResumeAt(state, "lead")).toBe("2099-01-01T00:01:00.000Z");
    expect(agentRateLimitResumeAt(state, "designer")).toBe("2099-01-01T00:01:30.000Z");
    expect(agentRateLimitResumeAt(state, "pm")).toBe("2099-01-01T00:02:00.000Z");
    expect(agentRateLimitResumeAt(state, "tester")).toBe("2099-01-01T00:03:30.000Z");

    const leadMessage = sendCompanyMessage(root, {
      from: "tester",
      to: "lead",
      type: "system",
      priority: "high",
      text: "Recover when safe.",
    });
    const testerMessage = sendCompanyMessage(root, {
      from: "lead",
      to: "tester",
      type: "assignment",
      text: "Resume validation after cooldown.",
    });
    const latestState = loadState(root);

    expect(leadMessage.wake?.mode).toBe("digest");
    expect(leadMessage.wake?.next_wake_after).toBe("2099-01-01T00:01:00.000Z");
    expect(testerMessage.wake?.mode).toBe("digest");
    expect(testerMessage.wake?.next_wake_after).toBe("2099-01-01T00:03:30.000Z");
    expect(shouldAutoDeliverMessage(leadMessage, latestState, "lead", "2099-01-01T00:00:30.000Z")).toBe(false);
    expect(shouldAutoDeliverMessage(leadMessage, latestState, "lead", "2099-01-01T00:01:00.000Z")).toBe(true);
    expect(shouldAutoDeliverMessage(testerMessage, latestState, "tester", "2099-01-01T00:03:29.000Z")).toBe(false);
    expect(shouldAutoDeliverMessage(testerMessage, latestState, "tester", "2099-01-01T00:03:30.000Z")).toBe(true);
  });

  it("keeps human steering immediate during organization rate-limit backoff", () => {
    const root = tempRoot();
    initCompany({ root, id: "rate-limit-steering-demo" });
    reportRateLimit(root, "system", "429 storm", "provider_429", "2099-01-01T00:00:00.000Z");

    const mirrored = recordHumanSteering(root, "tester", "Pause this path and tell lead the new constraint.", "steer");
    const state = loadState(root);

    expect(mirrored?.type).toBe("human_steering");
    expect(mirrored?.wake?.mode).toBe("immediate");
    expect(shouldAutoDeliverMessage(mirrored!, state, "lead", "2099-01-01T00:00:30.000Z")).toBe(true);
  });

  it("queues provider requests by provider before 429s happen", async () => {
    const root = tempRoot();
    initCompany({ root, id: "provider-queue-demo" });
    const policy = {
      max_concurrent_per_provider: 1,
      min_start_interval_ms: 0,
      lease_timeout_ms: 1000,
      poll_interval_ms: 5,
    };

    const first = await acquireProviderRequestLease(root, "same-provider", "coder-a", policy);
    let secondResolved = false;
    const secondPromise = acquireProviderRequestLease(root, "same-provider", "coder-b", policy)
      .then((lease) => {
        secondResolved = true;
        return lease;
      });

    await sleep(20);
    expect(secondResolved).toBe(false);
    expect(providerQueueSnapshot(root, "same-provider").leases).toHaveLength(1);

    await releaseProviderRequestLease(root, first);
    const second = await secondPromise;

    expect(second.waited_ms).toBeGreaterThan(0);
    expect(providerQueueSnapshot(root, "same-provider").leases.map((lease) => lease.agent)).toEqual(["coder-b"]);
    await releaseProviderRequestLease(root, second);
    expect(providerQueueSnapshot(root, "same-provider").leases).toHaveLength(0);
  });

  it("spaces starts for the same provider even when concurrency is available", async () => {
    const root = tempRoot();
    initCompany({ root, id: "provider-start-spacing-demo" });
    const policy = {
      max_concurrent_per_provider: 3,
      min_start_interval_ms: 25,
      lease_timeout_ms: 1000,
      poll_interval_ms: 5,
    };

    const first = await acquireProviderRequestLease(root, "same-provider", "coder-a", policy);
    await releaseProviderRequestLease(root, first);
    const second = await acquireProviderRequestLease(root, "same-provider", "coder-b", policy);

    expect(Date.parse(second.started_at) - Date.parse(first.started_at)).toBeGreaterThanOrEqual(20);
    await releaseProviderRequestLease(root, second);
  });

  it("normalizes invalid message policy values to safe defaults", () => {
    const normalized = normalizeMessagePolicy({
      immediate_types: ["assignment", "not-a-message-type"] as any,
      always_wake_human_steering: "yes" as any,
      agent_cooldown_ms: Number.NaN,
      agent_max_immediate_per_minute: Infinity,
      org_max_immediate_per_minute: -1,
    });

    expect(normalized.immediate_types).toEqual(["assignment"]);
    expect(normalized.always_wake_human_steering).toBe(DEFAULT_MESSAGE_POLICY.always_wake_human_steering);
    expect(normalized.agent_cooldown_ms).toBe(DEFAULT_MESSAGE_POLICY.agent_cooldown_ms);
    expect(normalized.agent_max_immediate_per_minute).toBe(DEFAULT_MESSAGE_POLICY.agent_max_immediate_per_minute);
    expect(normalized.org_max_immediate_per_minute).toBe(DEFAULT_MESSAGE_POLICY.org_max_immediate_per_minute);
  });

  it("blocks tester passes that contain caveats", () => {
    const root = tempRoot();
    initCompany({ root, id: "caveat-demo" });
    registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Fix UI",
      issue_id: null,
      summary: "Fixes UI.",
      branch: "pi-company/coder",
      worktree: path.join(root, ".pi-company/worktrees/coder"),
      base: "main",
    });

    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate UI rendering.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "Static checks passed.", "npm test");
    submitReview(root, "reviewer", pr.id, "approve", "Looks correct.");
    submitTest(root, "tester", pr.id, "pass", "Passed. 注意事项：section 依赖 JS 才可见。");

    const gates = getPrGateStatus(root, pr.id);
    expect(gates.ready).toBe(false);
    expect(gates.blockers).toContain("Tester pass contains caveat");
  });

  it("clears stale changes_requested status after a latest clean reviewer approval", () => {
    const root = tempRoot();
    initCompany({ root, id: "reviewer-status-reapproval-demo" });
    registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Fix UI",
      issue_id: null,
      summary: "Fixes UI.",
      branch: "pi-company/coder",
      worktree: path.join(root, ".pi-company/worktrees/coder"),
      base: "main",
    });

    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate UI rendering.");
    submitReview(root, "reviewer", pr.id, "request_changes", "Fix the unsafe rendering path.");
    expect(loadState(root).prs[pr.id].status).toBe("changes_requested");

    submitReview(root, "reviewer", pr.id, "approve", "Approve. Rechecked current head; requested changes are fixed.");
    const state = loadState(root);

    expect(state.prs[pr.id].status).toBe("blocked");
    expect(getPrGateStatus(root, pr.id).blockers).not.toContain("Latest review requests changes");
    expect(getPrGateStatus(root, pr.id).blockers).toContain("Missing tester validation");
  });

  it("allows a latest clean reviewer approval to supersede that reviewer's caveated approval", () => {
    const root = tempRoot();
    initCompany({ root, id: "reviewer-clean-reapproval-demo" });
    registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Fix UI",
      issue_id: null,
      summary: "Fixes UI.",
      branch: "pi-company/coder",
      worktree: path.join(root, ".pi-company/worktrees/coder"),
      base: "main",
    });

    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate UI rendering.");
    submitTest(root, "tester", pr.id, "pass", "PASS. UI behavior validated.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "PASS. Site checks passed.", "npm test");
    submitReview(root, "reviewer", pr.id, "approve", "Approve. Minor non-blocking cleanup remains.");
    expect(getPrGateStatus(root, pr.id).blockers).toContain("Reviewer approval contains caveat");

    submitReview(root, "reviewer", pr.id, "approve", "Approve. Rechecked current head; no merge blockers remain.");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");

    expect(getPrGateStatus(root, pr.id)).toEqual({ ready: true, blockers: [] });
  });

  it("allows latest clean tester and automated evidence to supersede caveated retries", () => {
    const root = tempRoot();
    initCompany({ root, id: "caveat-rewrite-demo" });
    registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Fix UI",
      issue_id: null,
      summary: "Fixes UI.",
      branch: "pi-company/coder",
      worktree: path.join(root, ".pi-company/worktrees/coder"),
      base: "main",
    });

    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate UI rendering.");
    submitReview(root, "reviewer", pr.id, "approve", "Looks correct.");
    submitTest(root, "tester", pr.id, "pass", "PASS, but npm test has 2 pre-existing failures unrelated to this PR.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "npm test 63/65 passed; 2 pre-existing failures.", "npm test");

    submitTest(root, "tester", pr.id, "pass", "PASS. UI behavior validated.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "PASS. Site checks passed.", "npm test");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");

    expect(getPrGateStatus(root, pr.id)).toEqual({ ready: true, blockers: [] });
  });

  it("allows resolved caveated evidence to be superseded by an explicit clean rerun", () => {
    const root = tempRoot();
    initCompany({ root, id: "resolved-caveat-demo" });
    registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Fix UI",
      issue_id: null,
      summary: "Fixes UI.",
      branch: "pi-company/coder",
      worktree: path.join(root, ".pi-company/worktrees/coder"),
      base: "main",
    });

    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate UI rendering.");
    submitReview(root, "reviewer", pr.id, "approve", "Looks correct.");
    submitTest(root, "tester", pr.id, "pass", "PASS, but npm test has 2 pre-existing failures unrelated to this PR.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "npm test 63/65 passed; 2 pre-existing failures.", "npm test");

    submitTest(root, "tester", pr.id, "pass", "Previous caveat resolved; npm test 85/85 passed, 0 failed.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "Environment fix resolved the 2 pre-existing failures. vitest run: 85 tests passed, 0 failed.", "npm test");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");

    expect(getPrGateStatus(root, pr.id)).toEqual({ ready: true, blockers: [] });
  });

  it("uses structured gate evidence before summary caveat heuristics", () => {
    const root = tempRoot();
    initCompany({ root, id: "structured-evidence-demo" });
    registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Fix UI",
      issue_id: null,
      summary: "Fixes UI.",
      branch: "pi-company/coder",
      worktree: path.join(root, ".pi-company/worktrees/coder"),
      base: "main",
    });

    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate UI rendering.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "Automated checks passed but text includes legacy caution wording.", "npm test", { clean: true });
    submitTest(root, "tester", pr.id, "pass", "PASS, but this legacy prose should not block when clean is explicit.", { clean: true });
    submitAcceptance(root, "pm", pr.id, "accept", "Accept, but legacy prose should not block when clean is explicit.", { clean: true });
    submitReview(root, "reviewer", pr.id, "approve", "Approved.", { caveats: ["browser flow was not validated"] });

    let gates = getPrGateStatus(root, pr.id);
    expect(gates.ready).toBe(false);
    expect(gates.blockers).toContain("Reviewer approval contains caveat");
    expect(loadState(root).prs[pr.id].reviews.at(-1)?.caveats).toEqual(["browser flow was not validated"]);

    expect(() => submitReview(root, "reviewer", pr.id, "approve", "Approved.", {
      clean: true,
      caveats: ["contradictory"],
    })).toThrow(/cannot be clean and include caveats/i);

    submitReview(root, "reviewer", pr.id, "approve", "Approve, but this legacy prose is explicitly clean.", { clean: true });
    gates = getPrGateStatus(root, pr.id);
    expect(gates).toEqual({ ready: true, blockers: [] });
  });

  it("blocks product acceptance that contains unverified behavior caveats", () => {
    const root = tempRoot();
    initCompany({ root, id: "acceptance-caveat-demo" });
    registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Add analysis button",
      issue_id: null,
      summary: "Adds LLM analysis.",
      branch: "pi-company/coder",
      worktree: path.join(root, ".pi-company/worktrees/coder"),
      base: "main",
    });

    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate analysis request and result rendering.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "Automated checks passed.", "npm test");
    submitReview(root, "reviewer", pr.id, "approve", "Approved.");
    submitTest(root, "tester", pr.id, "pass", "Analysis button workflow passed.");
    submitAcceptance(root, "pm", pr.id, "accept", "Accept, but did not see the API request or rendered result.");

    const gates = getPrGateStatus(root, pr.id);
    expect(gates.ready).toBe(false);
    expect(gates.blockers).toContain("Product acceptance contains caveat");

    submitAcceptance(root, "pm", pr.id, "accept", "接受 MVP 状态，剩余交互教程和移动端导航作为后续 issue。");
    expect(getPrGateStatus(root, pr.id).blockers).toContain("Product acceptance contains caveat");

    submitAcceptance(root, "pm", pr.id, "accept", "修复确定性高，逻辑已经闭合。", { clean: true });
    expect(getPrGateStatus(root, pr.id).blockers).toContain("Product acceptance prior caveat lacks fresh validation");

    submitAcceptance(root, "pm", pr.id, "accept", "Observed the analysis button trigger an API request and render the final result.");
    expect(getPrGateStatus(root, pr.id)).toEqual({ ready: true, blockers: [] });
  });

  it("requires fresh validation before clean product acceptance can clear a prior caveat", async () => {
    const root = tempRoot();
    initCompany({ root, id: "acceptance-fresh-validation-demo" });
    registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Show dynamic skills",
      issue_id: null,
      summary: "Loads skills for slash suggestions.",
      branch: "pi-company/coder",
      worktree: path.join(root, ".pi-company/worktrees/coder"),
      base: "main",
    });

    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate slash suggestions in browser.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "Automated checks passed.", "npm test");
    submitReview(root, "reviewer", pr.id, "approve", "Approved.");
    submitTest(root, "tester", pr.id, "pass", "Static checks passed.");
    submitAcceptance(root, "lead", pr.id, "accept", "Accept, but tester did not run browser validation.");

    expect(getPrGateStatus(root, pr.id).blockers).toContain("Product acceptance contains caveat");

    submitAcceptance(root, "lead", pr.id, "accept", "修复确定性高，逻辑已经闭合。", { clean: true });
    expect(getPrGateStatus(root, pr.id).blockers).toContain("Product acceptance prior caveat lacks fresh validation");

    await new Promise((resolve) => setTimeout(resolve, 2));
    submitReview(root, "reviewer", pr.id, "approve", "Fresh code review approved.", { clean: true });
    submitAcceptance(root, "lead", pr.id, "accept", "代码看起来已经没问题。", { clean: true });
    expect(getPrGateStatus(root, pr.id).blockers).toContain("Product acceptance prior caveat lacks fresh validation");

    await new Promise((resolve) => setTimeout(resolve, 2));
    submitTest(root, "tester", pr.id, "pass", "Static checks passed.", { clean: true });
    submitAcceptance(root, "lead", pr.id, "accept", "静态检查已经通过。", { clean: true });
    expect(getPrGateStatus(root, pr.id).blockers).toContain("Product acceptance prior caveat lacks fresh validation");

    await new Promise((resolve) => setTimeout(resolve, 2));
    submitTest(root, "tester", pr.id, "pass", "Fresh browser validation passed: typing / shows cmux-browser and grill-me.");
    submitAcceptance(root, "lead", pr.id, "accept", "Product behavior accepted after tester browser validation.", { clean: true });

    expect(getPrGateStatus(root, pr.id)).toEqual({ ready: true, blockers: [] });
  });

  it("treats partial pass counts and Chinese failure language as caveats", () => {
    expect(hasGateCaveat("PASS。npm test 63/65 通过，2 个 extension.test.ts 预存失败与本 PR 无关。")).toBe(true);
    expect(hasGateCaveat("PASS。65/65 通过。")).toBe(false);
    expect(hasGateCaveat("接受 MVP 状态，剩余 7 个占位符教程和移动端菜单作为后续 issue。")).toBe(true);
    expect(hasGateCaveat("Approved, deferred mobile menu and placeholder tutorials to a future iteration.")).toBe(true);
  });

  it("does not treat explicit zero-risk approval wording as a caveat", () => {
    expect(hasGateCaveat("回归风险为零，代码质量良好，可以合并。")).toBe(false);
    expect(hasGateCaveat("风险：无。JS syntax valid.")).toBe(false);
    expect(hasGateCaveat("构建成功，无错误，无警告。")).toBe(false);
    expect(hasGateCaveat("Build passed with no warnings and no errors.")).toBe(false);
    expect(hasGateCaveat("Build successful. Warning: chunk size >500kB is expected for Three.js library.")).toBe(false);
    expect(hasGateCaveat("构建成功。警告：chunk 超过 500KB 属正常现象，不影响功能。")).toBe(false);
    expect(hasGateCaveat("No regression risk. Approved.")).toBe(false);
    expect(hasGateCaveat("Zero known risks. Approved.")).toBe(false);
    expect(hasGateCaveat("Risk remains around browser validation.")).toBe(true);
    expect(hasGateCaveat("Build passed but warnings remain around chunk size.")).toBe(true);
    expect(hasGateCaveat("回归风险为零，但 npm test 79/83 passed.")).toBe(true);
  });

  it("allows resolved historical caveats while still blocking current failures", () => {
    expect(hasGateCaveat("vitest run: 85 tests passed, 0 failed.")).toBe(false);
    expect(hasGateCaveat("Previous caveat resolved; 85 tests passed, 0 failed.")).toBe(false);
    expect(hasGateCaveat("前一版测试中的 4 个 extension 失败已解决，不再构成 caveat。")).toBe(false);
    expect(hasGateCaveat("79 passed, 4 failed pre-existing failures unrelated to this PR.")).toBe(true);
    expect(hasGateCaveat("Previous failures remain in browser validation.")).toBe(true);
  });

  it("clears agent current task when an issue is completed", () => {
    const root = tempRoot();
    initCompany({ root, id: "done-task-demo" });
    const issue = createIssue(root, "lead", "Ship feature", "Acceptance criteria.");
    registerAgent(root, {
      name: "pm",
      role: "pm",
      cwd: root,
      status: "online",
    });

    assignIssue(root, "lead", issue.id, "pm");
    reportTask(root, "pm", issue.id, "Scoped acceptance criteria.");
    completeTask(root, "pm", issue.id, "Feature shipped.");

    const state = loadState(root);
    expect(state.issues[issue.id].status).toBe("done");
    expect(state.agents.pm.status).toBe("idle");
    expect(state.agents.pm.current_task).toBeNull();
  });

  it("keeps issue markdown snapshots synced with issue state changes", () => {
    const root = tempRoot();
    initCompany({ root, id: "issue-snapshot-demo" });
    registerAgent(root, {
      name: "pm",
      role: "pm",
      cwd: root,
      status: "online",
    });
    const issue = createIssue(root, "lead", "Scope feature", "Acceptance criteria.");
    const issueFile = path.join(companyPaths(root).issuesDir, `${issue.id}.md`);

    assignIssue(root, "lead", issue.id, "pm");
    startTask(root, "pm", issue.id, "Scoping.");
    reportTask(root, "pm", issue.id, "Acceptance criteria drafted.");

    const activeSnapshot = fs.readFileSync(issueFile, "utf8");
    expect(activeSnapshot).toContain("Status: in_progress");
    expect(activeSnapshot).toContain("Owner: pm");

    completeTask(root, "pm", issue.id, "Ready for implementation.");

    const doneSnapshot = fs.readFileSync(issueFile, "utf8");
    expect(doneSnapshot).toContain("Status: done");
    expect(doneSnapshot).toContain("Owner: pm");

    fs.writeFileSync(issueFile, "stale\n", "utf8");
    syncRenderedRecords(root, loadState(root));
    expect(fs.readFileSync(issueFile, "utf8")).toContain("Status: done");
  });

  it("keeps PR markdown snapshots synced with ready evidence", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "pr-snapshot-demo" });
    const plan = registerCoder(root, "coder");
    const issue = createIssue(root, "lead", "Implement feature", "Acceptance criteria.");
    assignIssue(root, "lead", issue.id, "coder");
    startTask(root, "coder", issue.id, "Starting implementation.");
    const pr = createPr(root, "coder", {
      title: "Feature",
      issue_id: issue.id,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    const prFile = path.join(companyPaths(root).prsDir, `${pr.id}.md`);

    expect(fs.readFileSync(prFile, "utf8")).toContain("## Self Test\n\npending");

    markPrReady(root, "coder", pr.id, "Manual build passed.", "Validate the feature workflow.");

    const readySnapshot = fs.readFileSync(prFile, "utf8");
    expect(readySnapshot).toContain("Manual build passed.");
    expect(readySnapshot).toContain("Validate the feature workflow.");
    expect(readySnapshot).not.toContain("## Self Test\n\npending");

    fs.writeFileSync(prFile, "stale\n", "utf8");
    syncRenderedRecords(root, loadState(root));
    expect(fs.readFileSync(prFile, "utf8")).toContain("Manual build passed.");
  });

  it("keeps completed issues terminal across API calls and replay", () => {
    const root = tempRoot();
    initCompany({ root, id: "done-terminal-demo" });
    const issue = createIssue(root, "lead", "Terminal issue", "Acceptance criteria.");
    assignIssue(root, "lead", issue.id, "tester");
    completeTask(root, "tester", issue.id, "Done.");

    expect(() => assignIssue(root, "lead", issue.id, "pm")).toThrow(/Issue ISSUE-001 is already done/);
    expect(() => startTask(root, "tester", issue.id, "Restarting.")).toThrow(/Issue ISSUE-001 is already done/);
    expect(() => reportTask(root, "tester", issue.id, "Late report.")).toThrow(/Issue ISSUE-001 is already done/);
    expect(() => blockTask(root, "tester", issue.id, "Late block.")).toThrow(/Issue ISSUE-001 is already done/);
    completeTask(root, "tester", issue.id, "Duplicate complete.");

    recordEvent(root, makeEvent("issue.assigned", "lead", { issue_id: issue.id, owner: "pm" }));
    recordEvent(root, makeEvent("task.started", "tester", { issue_id: issue.id, note: "Bad replay start." }));
    recordEvent(root, makeEvent("task.blocked", "tester", { issue_id: issue.id, reason: "Bad replay block." }));
    recordEvent(root, makeEvent("task.reported", "tester", { issue_id: issue.id, note: "Bad replay report." }));

    const state = loadState(root);
    expect(state.issues[issue.id].status).toBe("done");
    expect(state.issues[issue.id].owner).toBe("tester");
    expect(state.agents.tester.current_task).toBeNull();
  });

  it("ignores invalid historical events during state replay", () => {
    const root = tempRoot();
    initCompany({ root, id: "replay-guard-demo" });
    registerCoder(root);
    const issue = createIssue(root, "lead", "Replay guarded issue", "Acceptance criteria.");

    recordEvent(root, makeEvent("issue.assigned", "lead", { issue_id: issue.id, owner: "codre-typo" }));
    recordEvent(root, makeEvent("issue.assigned", "coder", { issue_id: issue.id, owner: "tester" }));
    recordEvent(root, makeEvent("human_steering.received", "coder-typo", { target_agent: "coder-typo", text: "Bad steering." }));
    recordEvent(root, makeEvent("message.sent", "lead", { to: "codre-typo", type: "assignment", text: "Bad message." }));
    let state = loadState(root);
    expect(state.issues[issue.id].status).toBe("open");
    expect(state.issues[issue.id].owner).toBeNull();
    expect(state.human_steering).toHaveLength(0);
    expect(state.inbox_counts["codre-typo"]).toBeUndefined();

    assignIssue(root, "lead", issue.id, "tester");
    recordEvent(root, makeEvent("task.completed", "coder", { issue_id: issue.id, summary: "Wrong owner completed." }));
    state = loadState(root);
    expect(state.issues[issue.id].status).toBe("assigned");

    const plan = loadState(root).agents.coder;
    const pr = createPr(root, "coder", {
      title: "Replay guarded PR",
      issue_id: null,
      summary: "Feature summary.",
      branch: "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    recordEvent(root, makeEvent("pr.created", "coder-typo", {
      pr: {
        ...pr,
        id: "PR-999",
        author: "coder-typo",
        branch: "pi-company/coder-typo",
      },
    }));
    recordEvent(root, makeEvent("pr.ready", "lead", {
      pr_id: pr.id,
      self_test: "Ready by wrong actor.",
      test_brief: "Validate feature.",
      head: null,
    }));
    recordEvent(root, makeEvent("pr.automated_tests", "reviewer", {
      pr_id: pr.id,
      status: "passed",
      summary: "Wrong role tests.",
      command: "npm test",
      head: null,
    }));
    recordEvent(root, makeEvent("review.submitted", "reviewer-typo", {
      pr_id: pr.id,
      decision: "approve",
      summary: "Ghost approved.",
      head: null,
    }));
    recordEvent(root, makeEvent("test.submitted", "tester-typo", {
      pr_id: pr.id,
      status: "pass",
      summary: "Ghost passed.",
      head: null,
    }));
    recordEvent(root, makeEvent("merge.completed", "coder", { pr_id: pr.id }));

    state = loadState(root);
    expect(state.prs["PR-999"]).toBeUndefined();
    expect(state.prs[pr.id].status).toBe("draft");
    expect(state.prs[pr.id].self_test).toBeNull();
    expect(state.prs[pr.id].automated_tests).toBeNull();
    expect(state.prs[pr.id].reviews).toHaveLength(0);
    expect(state.prs[pr.id].tests).toHaveLength(0);
    expect(getPrGateStatus(root, pr.id).ready).toBe(false);
  });

  it("ignores invalid issue creation replay events", () => {
    const root = tempRoot();
    initCompany({ root, id: "issue-replay-guard-demo" });
    const issue = createIssue(root, "lead", "Real issue", "Acceptance criteria.");
    assignIssue(root, "lead", issue.id, "tester");
    completeTask(root, "tester", issue.id, "Done.");

    recordEvent(root, makeEvent("issue.created", "coder-rogue", {
      issue: {
        ...issue,
        id: "ISSUE-999",
        title: "Rogue issue",
        status: "open",
        owner: "coder-rogue",
        created_by: "coder-rogue",
      },
    }));
    recordEvent(root, makeEvent("issue.created", "lead", {
      issue: {
        ...issue,
        title: "Overwrite real issue",
        status: "open",
        owner: null,
      },
    }));
    recordEvent(root, makeEvent("issue.created", "lead", {
      issue: {
        ...issue,
        id: "ISSUE-998",
        title: "Pre-owned issue",
        status: "assigned",
        owner: "tester",
      },
    }));
    recordEvent(root, makeEvent("issue.created", "lead", {
      issue: {
        ...issue,
        id: "ISSUE-997",
        title: "Wrong creator issue",
        status: "open",
        owner: null,
        created_by: "coder-rogue",
      },
    }));

    const state = loadState(root);
    expect(state.issues["ISSUE-999"]).toBeUndefined();
    expect(state.issues["ISSUE-998"]).toBeUndefined();
    expect(state.issues["ISSUE-997"]).toBeUndefined();
    expect(state.issues[issue.id].title).toBe("Real issue");
    expect(state.issues[issue.id].status).toBe("done");
    expect(state.issues[issue.id].owner).toBe("tester");
  });

  it("ignores invalid PR creation replay events", () => {
    const root = tempRoot();
    initCompany({ root, id: "pr-replay-guard-demo" });
    const plan = registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Real PR",
      issue_id: null,
      summary: "Real summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    passPrGates(root, pr.id);
    recordEvent(root, makeEvent("merge.completed", "lead", { pr_id: pr.id }));

    recordEvent(root, makeEvent("pr.created", "lead", {
      pr: {
        ...pr,
        id: "PR-999",
        title: "Forged PR",
        status: "draft",
      },
    }));
    recordEvent(root, makeEvent("pr.created", "coder", {
      pr: {
        ...pr,
        title: "Overwrite PR",
        status: "draft",
      },
    }));
    recordEvent(root, makeEvent("pr.created", "coder", {
      pr: {
        ...pr,
        id: "PR-998",
        title: "Ready at creation",
        status: "ready_to_merge",
      },
    }));

    const state = loadState(root);
    expect(state.prs["PR-999"]).toBeUndefined();
    expect(state.prs["PR-998"]).toBeUndefined();
    expect(state.prs[pr.id].title).toBe("Real PR");
    expect(state.prs[pr.id].status).toBe("merged");
  });

  it("ignores invalid PR gate evidence values during replay", () => {
    const root = tempRoot();
    initCompany({ root, id: "gate-evidence-replay-guard-demo" });
    const plan = registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Real PR",
      issue_id: null,
      summary: "Real summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate behavior.");

    recordEvent(root, makeEvent("pr.automated_tests", "tester", {
      pr_id: pr.id,
      status: "passed-ish",
      summary: "Invalid automated status.",
      command: "npm test",
      head: null,
    }));
    recordEvent(root, makeEvent("review.submitted", "reviewer", {
      pr_id: pr.id,
      decision: "approve-ish",
      summary: "Invalid review decision.",
      head: null,
    }));
    recordEvent(root, makeEvent("test.submitted", "tester", {
      pr_id: pr.id,
      status: "pass-ish",
      summary: "Invalid test status.",
      head: null,
    }));

    const state = loadState(root);
    expect(state.prs[pr.id].automated_tests).toBeNull();
    expect(state.prs[pr.id].reviews).toHaveLength(0);
    expect(state.prs[pr.id].tests).toHaveLength(0);
    expect(getPrGateStatus(root, pr.id).ready).toBe(false);
  });

  it("ignores empty PR ready evidence during replay", () => {
    const root = tempRoot();
    initCompany({ root, id: "pr-ready-replay-guard-demo" });
    const plan = registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Real PR",
      issue_id: null,
      summary: "Real summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });

    recordEvent(root, makeEvent("pr.ready", "coder", {
      pr_id: pr.id,
      self_test: "   ",
      test_brief: "",
      head: null,
    }));

    const state = loadState(root);
    expect(state.prs[pr.id].status).toBe("draft");
    expect(state.prs[pr.id].self_test).toBeNull();
    expect(state.prs[pr.id].test_brief).toBeNull();
  });

  it("rejects invalid PR gate evidence values before writing events", () => {
    const root = tempRoot();
    initCompany({ root, id: "gate-evidence-runtime-guard-demo" });
    const plan = registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Real PR",
      issue_id: null,
      summary: "Real summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });

    expect(() => submitReview(root, "reviewer", pr.id, "approve-ish" as any, "Invalid review.")).toThrow(
      /Invalid review decision approve-ish/,
    );
    expect(() => submitTest(root, "tester", pr.id, "pass-ish" as any, "Invalid test.")).toThrow(
      /Invalid test status pass-ish/,
    );
    expect(() => recordAutomatedTests(root, "tester", pr.id, "passed-ish" as any, "Invalid automated test.")).toThrow(
      /Invalid automated test status passed-ish/,
    );
    expect(() => submitAcceptance(root, "pm", pr.id, "accept-ish" as any, "Invalid acceptance.")).toThrow(
      /Invalid acceptance decision accept-ish/,
    );

    const state = loadState(root);
    expect(state.prs[pr.id].reviews).toHaveLength(0);
    expect(state.prs[pr.id].tests).toHaveLength(0);
    expect(state.prs[pr.id].acceptances ?? []).toHaveLength(0);
    expect(state.prs[pr.id].automated_tests).toBeNull();
  });

  it("rejects empty PR ready evidence before writing events", () => {
    const root = tempRoot();
    initCompany({ root, id: "pr-ready-runtime-guard-demo" });
    const plan = registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Real PR",
      issue_id: null,
      summary: "Real summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });

    expect(() => markPrReady(root, "coder", pr.id, "   ", "Validate behavior.")).toThrow(/self-test evidence/);
    expect(() => markPrReady(root, "coder", pr.id, "Self-test passed.", "")).toThrow(/test brief/);

    const state = loadState(root);
    expect(state.prs[pr.id].status).toBe("draft");
    expect(state.prs[pr.id].self_test).toBeNull();
    expect(state.prs[pr.id].test_brief).toBeNull();
  });

  it("ignores merge completion replay when PR gates are not ready", () => {
    const root = tempRoot();
    initCompany({ root, id: "merge-complete-replay-demo" });
    const plan = registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Draft PR",
      issue_id: null,
      summary: "Draft summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });

    recordEvent(root, makeEvent("merge.completed", "lead", { pr_id: pr.id }));

    const state = loadState(root);
    expect(state.prs[pr.id].status).toBe("draft");
    expect(state.prs[pr.id].merged_at).toBeUndefined();
  });

  it("keeps head-anchored merge completion terminal with complete gate evidence", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "merge-complete-head-demo" });
    const plan = registerCoder(root);
    runGit(root, ["checkout", "-b", plan.branch ?? "pi-company/coder"]);
    commitFile(root, "feature.txt", "done\n", "feature");
    runGit(root, ["checkout", "main"]);
    const pr = createPr(root, "coder", {
      title: "Merged under old gate rules",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate behavior.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "Automated checks passed.", "npm test");
    submitReview(root, "reviewer", pr.id, "approve", "Approved.");
    submitTest(root, "tester", pr.id, "pass", "Passed.");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");

    recordEvent(root, makeEvent("merge.completed", "lead", {
      pr_id: pr.id,
      head: pr.head,
    }));

    const state = loadState(root);
    expect(state.prs[pr.id].status).toBe("merged");
  });

  it("replays lead-requested merge after a PR branch advances and coder marks the new head ready", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "merge-complete-advanced-head-demo" });
    const plan = registerCoder(root);
    const branch = plan.branch ?? "pi-company/coder";
    runGit(root, ["checkout", "-b", branch]);
    commitFile(root, "feature.txt", "first\n", "feature v1");
    runGit(root, ["checkout", "main"]);
    const issue = createIssue(root, "lead", "Implement feature", "Acceptance criteria.");
    assignIssue(root, "lead", issue.id, "coder");
    startTask(root, "coder", issue.id, "Starting feature.");
    const pr = createPr(root, "coder", {
      title: "Advanced branch PR",
      issue_id: issue.id,
      summary: "Feature summary.",
      branch,
      worktree: plan.worktree ?? root,
      base: "main",
    });
    const originalHead = pr.head;

    runGit(root, ["checkout", branch]);
    commitFile(root, "feature.txt", "second\n", "feature v2");
    const advancedHead = gitOutput(root, ["rev-parse", branch]).trim();
    expect(advancedHead).not.toBe(originalHead);

    markPrReady(root, "coder", pr.id, "Self-test passed on the advanced head.", "Validate feature behavior.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "Automated checks passed.", "npm test");
    submitReview(root, "reviewer", pr.id, "approve", "Approved.");
    submitTest(root, "tester", pr.id, "pass", "Passed.");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");
    recordEvent(root, makeEvent("merge.requested", "lead", { pr_id: pr.id }));
    recordEvent(root, makeEvent("merge.completed", "lead", {
      pr_id: pr.id,
      head: advancedHead,
    }));

    const state = loadState(root);
    expect(state.prs[pr.id].head).toBe(advancedHead);
    expect(state.prs[pr.id].status).toBe("merged");
    expect(state.issues[issue.id].status).toBe("done");
  });

  it("keeps lead merge completion terminal when an old mergeability conflict is resolved by a later head", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "resolved-conflict-merge-complete-demo" });
    const plan = registerCoder(root);
    const branch = plan.branch ?? "pi-company/coder";
    runGit(root, ["checkout", "-b", branch]);
    commitFile(root, "PRODUCT.md", "branch version\n", "branch product");
    runGit(root, ["checkout", "main"]);
    commitFile(root, "PRODUCT.md", "main version\n", "main product");
    const pr = createPr(root, "coder", {
      title: "Resolved conflict PR",
      issue_id: null,
      summary: "Feature summary.",
      branch,
      worktree: plan.worktree ?? root,
      base: "main",
    });
    expect(loadState(root).prs[pr.id].mergeable?.status).toBe("conflict");

    runGit(root, ["checkout", branch]);
    const merge = spawnSync("git", ["-C", root, "merge", "main"], { encoding: "utf8" });
    expect(merge.status).not.toBe(0);
    fs.writeFileSync(path.join(root, "PRODUCT.md"), "resolved version\n", "utf8");
    runGit(root, ["add", "PRODUCT.md"]);
    runGit(root, ["commit", "-m", "resolve product conflict"]);
    runGit(root, ["checkout", "main"]);
    const resolvedHead = gitOutput(root, ["rev-parse", branch]).trim();

    markPrReady(root, "coder", pr.id, "Self-test passed after conflict resolution.", "Validate resolved product content.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "Automated checks passed.", "npm test");
    submitReview(root, "reviewer", pr.id, "approve", "Approved.");
    submitTest(root, "tester", pr.id, "pass", "Passed.");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");
    recordEvent(root, makeEvent("merge.requested", "lead", { pr_id: pr.id }));
    recordEvent(root, makeEvent("merge.completed", "lead", {
      pr_id: pr.id,
      head: resolvedHead,
    }));

    const state = loadState(root);
    expect(state.prs[pr.id].head).toBe(resolvedHead);
    expect(state.prs[pr.id].status).toBe("merged");
  });

  it("keeps lead-requested merge completion terminal with complete gate evidence", () => {
    const root = tempRoot();
    initCompany({ root, id: "legacy-merge-complete-demo" });
    const plan = registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Legacy merged PR",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate behavior.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "Automated checks passed.", "npm test");
    submitReview(root, "reviewer", pr.id, "approve", "Approved.");
    submitTest(root, "tester", pr.id, "pass", "Passed.");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");

    recordEvent(root, makeEvent("merge.requested", "lead", { pr_id: pr.id }));
    recordEvent(root, makeEvent("merge.completed", "lead", { pr_id: pr.id }));

    const state = loadState(root);
    expect(state.prs[pr.id].status).toBe("merged");
  });

  it("keeps manual merge note terminal with complete gate evidence", () => {
    const root = tempRoot();
    initCompany({ root, id: "legacy-manual-merge-demo" });
    const plan = registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Legacy manual merge",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate behavior.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "Static smoke passed.", "npm test");
    submitReview(root, "reviewer", pr.id, "approve", "Approved.");
    submitTest(root, "tester", pr.id, "pass", "Passed.");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");

    recordEvent(root, makeEvent("merge.completed", "lead", {
      pr_id: pr.id,
      note: "Manual git merge completed after gates passed.",
    }));

    const state = loadState(root);
    expect(state.prs[pr.id].status).toBe("merged");
  });

  it("ignores head-anchored merge completion when the head does not match the PR", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "merge-complete-head-mismatch-demo" });
    const plan = registerCoder(root);
    runGit(root, ["checkout", "-b", plan.branch ?? "pi-company/coder"]);
    commitFile(root, "feature.txt", "done\n", "feature");
    runGit(root, ["checkout", "main"]);
    const pr = createPr(root, "coder", {
      title: "Forged head merge",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });

    recordEvent(root, makeEvent("merge.completed", "lead", {
      pr_id: pr.id,
      head: "0000000000000000000000000000000000000000",
    }));

    const state = loadState(root);
    expect(state.prs[pr.id].status).toBe("draft");
    expect(state.prs[pr.id].merged_at).toBeUndefined();
  });

  it("ignores merge request replay when PR gates are not ready", () => {
    const root = tempRoot();
    initCompany({ root, id: "merge-request-replay-demo" });
    const plan = registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Draft PR",
      issue_id: null,
      summary: "Draft summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });

    recordEvent(root, makeEvent("merge.requested", "coder", { pr_id: pr.id }));

    const state = loadState(root);
    expect(state.prs[pr.id].status).toBe("draft");
    expect(state.prs[pr.id].merge_requested_at).toBeUndefined();
  });

  it("keeps valid legacy replay events compatible with newer invariants", () => {
    const root = tempRoot();
    initCompany({ root, id: "legacy-replay-demo" });
    const worktree = path.join(root, ".pi-company/worktrees/coder-site");
    requestAgentSpawn(root, "lead", "coder", "coder-site", "Legacy coder.");
    registerAgent(root, {
      name: "coder-site",
      role: "coder",
      cwd: worktree,
      branch: "pi-company/coder-site",
      worktree,
      status: "online",
    });
    const issue = createIssue(root, "lead", "Legacy unassigned task", "Acceptance criteria.");

    recordEvent(root, makeEvent("task.completed", "coder-site", {
      issue_id: issue.id,
      summary: "Legacy task completed before owner-only enforcement.",
    }));
    recordEvent(root, makeEvent("pr.created", "coder-site", {
      pr: {
        id: "PR-777",
        title: "Legacy short branch PR",
        issue_id: issue.id,
        author: "coder-site",
        branch: "coder-site",
        worktree,
        base: "main",
        status: "draft",
        summary: "Legacy branch used short author name.",
        self_test: null,
        test_brief: null,
        reviews: [],
        tests: [],
        automated_tests: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    }));

    const state = loadState(root);
    expect(state.issues[issue.id].status).toBe("done");
    expect(state.issues[issue.id].owner).toBe("coder-site");
    expect(state.prs["PR-777"].branch).toBe("pi-company/coder-site");
  });

  it("allows only the issue owner to update task progress", () => {
    const root = tempRoot();
    initCompany({ root, id: "task-owner-demo" });
    const issue = createIssue(root, "lead", "Validate behavior", "Acceptance criteria.");
    assignIssue(root, "lead", issue.id, "tester");

    expect(() => startTask(root, "coder", issue.id, "Taking over.")).toThrow(/Only tester can start/);
    expect(() => reportTask(root, "coder", issue.id, "Reporting on another task.")).toThrow(/Only tester can report on/);
    expect(() => blockTask(root, "coder", issue.id, "Blocking another task.")).toThrow(/Only tester can block/);
    expect(() => completeTask(root, "coder", issue.id, "Done by wrong owner.")).toThrow(/Only tester can complete/);
    expect(loadState(root).issues[issue.id].status).toBe("assigned");

    startTask(root, "tester", issue.id, "Starting validation.");
    reportTask(root, "tester", issue.id, "Validation in progress.");
    completeTask(root, "tester", issue.id, "Validation complete.");
    expect(loadState(root).issues[issue.id].status).toBe("done");
  });

  it("keeps linked issues open until their PR is merged", () => {
    const root = tempRoot();
    initCompany({ root, id: "issue-pr-completion-demo" });
    registerCoder(root);
    const issue = createIssue(root, "lead", "Implement feature", "Acceptance criteria.");
    assignIssue(root, "lead", issue.id, "coder");
    startTask(root, "coder", issue.id, "Starting feature.");
    const pr = createPr(root, "coder", {
      title: "Feature",
      issue_id: issue.id,
      summary: "Feature summary.",
      branch: "pi-company/coder",
      worktree: path.join(root, ".pi-company/worktrees/coder"),
      base: "main",
    });

    expect(() => completeTask(root, "coder", issue.id, "Implementation complete.")).toThrow(/unmerged PR/);
    recordEvent(root, makeEvent("task.completed", "coder", {
      issue_id: issue.id,
      summary: "Legacy completion before merge.",
    }));
    expect(loadState(root).issues[issue.id].status).toBe("in_progress");

    passPrGates(root, pr.id);
    recordEvent(root, makeEvent("merge.completed", "lead", { pr_id: pr.id }));

    const state = loadState(root);
    expect(state.prs[pr.id].status).toBe("merged");
    expect(state.issues[issue.id].status).toBe("done");
  });

  it("blocks merge readiness when branch head changes after review and test evidence", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "stale-head-demo" });
    const plan = registerCoder(root);
    runGit(root, ["checkout", "-b", plan.branch ?? "pi-company/coder"]);
    commitFile(root, "feature.txt", "first\n", "feature first");
    runGit(root, ["checkout", "main"]);

    const pr = createPr(root, "coder", {
      title: "Feature",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate feature.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "Automated checks passed.", "npm test");
    submitReview(root, "reviewer", pr.id, "approve", "Approved.");
    submitTest(root, "tester", pr.id, "pass", "Passed.");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");

    expect(getPrGateStatus(root, pr.id).ready).toBe(true);

    runGit(root, ["checkout", plan.branch ?? "pi-company/coder"]);
    commitFile(root, "feature.txt", "second\n", "feature second");
    runGit(root, ["checkout", "main"]);

    const gates = getPrGateStatus(root, pr.id);
    expect(gates.ready).toBe(false);
    expect(gates.blockers).toContain("Coder self-test/test brief are stale for current head");
    expect(gates.blockers).toContain("Needs 1 reviewer approval(s)");
    expect(gates.blockers).toContain("Missing tester validation");
    expect(gates.blockers).toContain("Automated tests are stale for current head");
    expect(gates.blockers).toContain("Missing PM/lead product acceptance");
    expect(loadState(root).prs[pr.id].status).toBe("blocked");
  });

  it("keeps persisted state pure while returning live git overlays", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "pure-state-overlay-demo" });
    const plan = registerCoder(root);
    ensureCoderWorktree(root, plan, true);
    commitFile(plan.worktree ?? root, "feature.txt", "first\n", "feature first");

    const pr = createPr(root, "coder", {
      title: "Feature",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    const originalHead = pr.head;
    expect(originalHead).toBeTruthy();

    commitFile(plan.worktree ?? root, "feature.txt", "second\n", "feature second");
    const newHead = resolveGitHead(root, plan.branch ?? "pi-company/coder");
    expect(newHead).toBeTruthy();
    expect(newHead).not.toBe(originalHead);

    const live = loadState(root);
    const persisted = JSON.parse(fs.readFileSync(companyPaths(root).state, "utf8")) as { prs: Record<string, { head?: string | null }> };

    expect(live.prs[pr.id].head).toBe(newHead);
    expect(persisted.prs[pr.id].head).toBe(originalHead);
  });

  it("ignores headless merge completion after a lead request when the branch head advances", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "stale-headless-merge-complete-demo" });
    const plan = registerCoder(root);
    const branch = plan.branch ?? "pi-company/coder";
    runGit(root, ["checkout", "-b", branch]);
    commitFile(root, "feature.txt", "first\n", "feature first");
    runGit(root, ["checkout", "main"]);

    const pr = createPr(root, "coder", {
      title: "Feature",
      issue_id: null,
      summary: "Feature summary.",
      branch,
      worktree: plan.worktree ?? root,
      base: "main",
    });
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate feature.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "Automated checks passed.", "npm test");
    submitReview(root, "reviewer", pr.id, "approve", "Approved.");
    submitTest(root, "tester", pr.id, "pass", "Passed.");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");
    requestMerge(root, "lead", pr.id);

    runGit(root, ["checkout", branch]);
    commitFile(root, "feature.txt", "second\n", "feature second");
    runGit(root, ["checkout", "main"]);
    expect(getPrGateStatus(root, pr.id).ready).toBe(false);

    recordEvent(root, makeEvent("merge.completed", "lead", { pr_id: pr.id }));

    const state = loadState(root);
    expect(state.prs[pr.id].status).not.toBe("merged");
    expect(state.prs[pr.id].merged_at).toBeUndefined();
  });

  it("blocks PRs whose branch does not resolve in a git project", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "missing-branch-demo" });
    const plan = registerCoder(root);

    const pr = createPr(root, "coder", {
      title: "Missing branch",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    passPrGates(root, pr.id);

    const gates = getPrGateStatus(root, pr.id);
    expect(gates.ready).toBe(false);
    expect(gates.blockers).toContain(`Branch ${plan.branch ?? "pi-company/coder"} does not resolve to a git commit`);
    expect(() => mergePr(root, "lead", pr.id, true)).toThrow(/does not resolve/);
  });

  it("rejects PRs that use a branch outside the author's registered branch", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "same-branch-demo" });
    const plan = registerCoder(root);

    expect(() => createPr(root, "coder", {
      title: "Same branch",
      issue_id: null,
      summary: "Feature summary.",
      branch: "main",
      worktree: plan.worktree ?? root,
      base: "main",
    })).toThrow(/does not match coder's registered branch/);
  });

  it("allows merge with unrelated untracked files in the project root", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "untracked-merge-demo" });
    const plan = registerCoder(root);
    runGit(root, ["checkout", "-b", plan.branch ?? "pi-company/coder"]);
    commitFile(root, "feature.txt", "feature\n", "feature");
    runGit(root, ["checkout", "main"]);
    fs.writeFileSync(path.join(root, "scratch.tmp"), "untracked\n", "utf8");

    const pr = createPr(root, "coder", {
      title: "Feature",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate feature.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "Automated checks passed.", "npm test");
    submitReview(root, "reviewer", pr.id, "approve", "Approved.");
    submitTest(root, "tester", pr.id, "pass", "Passed.");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");

    const state = mergePr(root, "lead", pr.id, true);

    expect(state.prs[pr.id].status).toBe("merged");
    expect(fs.existsSync(path.join(root, "feature.txt"))).toBe(true);
    expect(fs.existsSync(path.join(root, "scratch.tmp"))).toBe(true);
  });

  it("allows workers to request merges but only lead can execute them", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "lead-merge-demo" });
    const plan = registerCoder(root);
    runGit(root, ["checkout", "-b", plan.branch ?? "pi-company/coder"]);
    commitFile(root, "feature.txt", "feature\n", "feature");
    runGit(root, ["checkout", "main"]);

    const pr = createPr(root, "coder", {
      title: "Feature",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    passPrGates(root, pr.id);

    expect(() => requestMerge(root, "coder-typo", pr.id)).toThrow(/Unknown merge requester coder-typo/);
    expect(() => mergePr(root, "coder-typo", pr.id, true)).toThrow(/Unknown merge actor coder-typo/);
    const requested = requestMerge(root, "coder", pr.id);
    expect(requested.prs[pr.id].merge_requested_at).toBeTruthy();
    expect(() => mergePr(root, "coder", pr.id, true)).toThrow(/Only lead can execute merges/);
    expect(loadState(root).prs[pr.id].status).toBe("ready_to_merge");
    expect(gitOutput(root, ["status", "--porcelain", "--untracked-files=no"]).trim()).toBe("");

    const merged = mergePr(root, "lead", pr.id, true);
    expect(merged.prs[pr.id].status).toBe("merged");
    expect(fs.existsSync(path.join(root, "feature.txt"))).toBe(true);
  }, 20_000);

  it("surfaces lead-requested merges that still need execution", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "pending-lead-merge-demo" });
    const plan = registerCoder(root);
    runGit(root, ["checkout", "-b", plan.branch ?? "pi-company/coder"]);
    commitFile(root, "feature.txt", "feature\n", "feature");
    runGit(root, ["checkout", "main"]);
    const pr = createPr(root, "coder", {
      title: "Feature",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    passPrGates(root, pr.id);

    requestMerge(root, "lead", pr.id);

    expect(pendingMergeRequests(loadState(root)).map((item) => item.id)).toEqual([pr.id]);
    const reminders = ensurePendingMergeReminder(root, "lead");
    expect(reminders).toHaveLength(1);
    expect(reminders[0].to).toBe("lead");
    expect(reminders[0].task).toBe(pr.id);
    expect(reminders[0].text).toContain("[pi-company pending merge]");
    expect(ensurePendingMergeReminder(root, "lead")).toHaveLength(0);
  });

  it("notifies lead when a worker requests a ready PR merge", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "worker-merge-reminder-demo" });
    const plan = registerCoder(root);
    runGit(root, ["checkout", "-b", plan.branch ?? "pi-company/coder"]);
    commitFile(root, "feature.txt", "feature\n", "feature");
    runGit(root, ["checkout", "main"]);
    const pr = createPr(root, "coder", {
      title: "Feature",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    passPrGates(root, pr.id);
    acknowledgeInbox(root, "lead", listInbox(root, "lead").map((message) => message.id));

    requestMerge(root, "coder", pr.id);

    const messages = listInbox(root, "lead");
    expect(messages).toHaveLength(1);
    expect(messages[0].task).toBe(pr.id);
    expect(messages[0].text).toContain("[pi-company pending merge]");
    const afterCooldown = new Date(Date.parse(messages[0].ts) + DEFAULT_MESSAGE_POLICY.agent_cooldown_ms + 1).toISOString();
    expect(shouldAutoDeliverMessage(messages[0], loadState(root), "lead", afterCooldown)).toBe(true);
  });

  it("reconciles a requested PR that was already integrated into its base", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "manual-integration-reconcile-demo" });
    const issue = createIssue(root, "lead", "Feature", "Build the feature.");
    const plan = registerCoder(root);
    assignIssue(root, "lead", issue.id, "coder");
    startTask(root, "coder", issue.id, "Starting.");
    runGit(root, ["checkout", "-b", plan.branch ?? "pi-company/coder"]);
    commitFile(root, "feature.txt", "feature\n", "feature");
    runGit(root, ["checkout", "main"]);
    const pr = createPr(root, "coder", {
      title: "Feature",
      issue_id: issue.id,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    passPrGates(root, pr.id);
    requestMerge(root, "lead", pr.id);

    runGit(root, ["merge", "--no-ff", plan.branch ?? "pi-company/coder", "-m", "manual integration"]);

    const state = loadState(root);
    expect(state.prs[pr.id].status).toBe("merged");
    expect(state.issues[issue.id].status).toBe("done");
    expect(state.agents.coder.current_task).toBeNull();
  }, 30_000);

  it("lets lead abandon a stale PR so it no longer blocks delivery", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "abandon-stale-pr-demo" });
    runGit(root, ["add", ".gitignore"]);
    runGit(root, ["commit", "-m", "track company gitignore"]);
    const issue = createIssue(root, "lead", "Feature", "Build the feature.");
    const plan = registerCoder(root);
    assignIssue(root, "lead", issue.id, "coder");
    runGit(root, ["checkout", "-b", plan.branch ?? "pi-company/coder"]);
    commitFile(root, "feature.txt", "feature\n", "feature");
    runGit(root, ["checkout", "main"]);
    const pr = createPr(root, "coder", {
      title: "Feature",
      issue_id: issue.id,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });

    abandonPr(root, "lead", pr.id, "Superseded by recovery PR.", "PR-999");
    completeTask(root, "coder", issue.id, "No active PRs remain.");

    const state = loadState(root);
    expect(state.prs[pr.id].status).toBe("abandoned");
    expect(state.prs[pr.id].superseded_by).toBe("PR-999");
    expect(state.issues[issue.id].status).toBe("done");
    expect(buildLeadBrief(root).can_claim_complete).toBe(true);
    expect(() => markPrReady(root, "coder", pr.id, "Self-test.", "Brief.")).toThrow(/abandoned/);
  });

  it("adopts a commit already present on base into a gated recovery PR", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "adopt-integrated-pr-demo" });
    const issue = createIssue(root, "lead", "Feature", "Build the feature.");
    registerCoder(root);
    assignIssue(root, "lead", issue.id, "coder");
    startTask(root, "coder", issue.id, "Starting.");
    commitFile(root, "feature.txt", "feature\n", "direct main commit");

    const pr = adoptIntegratedPr(root, "lead", {
      title: "Feature recovery",
      author: "coder",
      issue_id: issue.id,
      summary: "Recover a direct base-branch commit into the PR gate.",
      branch: "pi-company/adopt-issue-001",
      base: "main",
    });

    expect(pr.adopted_from_base).toBe(true);
    expect(pr.head).toBe(gitOutput(root, ["rev-parse", "main"]).trim());
    passPrGates(root, pr.id);
    requestMerge(root, "lead", pr.id);

    const state = loadState(root);
    expect(state.prs[pr.id].status).toBe("merged");
    expect(state.issues[issue.id].status).toBe("done");
    expect(state.agents.coder.current_task).toBeNull();
  });

  it("does not keep gate merge blockers after missing evidence is supplied", () => {
    const root = tempRoot();
    initCompany({ root, id: "merge-gate-block-demo" });
    const plan = registerCoder(root);
    const pr = createPr(root, "coder", {
      title: "Feature",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });

    const blocked = requestMerge(root, "coder", pr.id);
    expect(blocked.prs[pr.id].status).toBe("blocked");
    expect(blocked.prs[pr.id].merge_blockers ?? null).toBeNull();

    passPrGates(root, pr.id);
    const state = loadState(root);
    expect(state.prs[pr.id].status).toBe("ready_to_merge");
    expect(state.prs[pr.id].merge_blockers ?? null).toBeNull();
  });

  it("records merge execution blockers and clears them on retry", () => {
    const root = tempRoot();
    initGitRepo(root);
    commitFile(root, "app.txt", "base\n", "base app");
    initCompany({ root, id: "merge-execution-block-demo" });
    const plan = registerCoder(root);
    runGit(root, ["checkout", "-b", plan.branch ?? "pi-company/coder"]);
    commitFile(root, "feature.txt", "feature\n", "feature");
    runGit(root, ["checkout", "main"]);
    const pr = createPr(root, "coder", {
      title: "Feature",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    passPrGates(root, pr.id);

    fs.writeFileSync(path.join(root, "app.txt"), "dirty\n", "utf8");
    expect(() => mergePr(root, "lead", pr.id, true)).toThrow(/tracked or staged changes/);
    let state = loadState(root);
    expect(state.prs[pr.id].status).toBe("blocked");
    expect(state.prs[pr.id].merge_blockers).toContain("Refusing to merge with tracked or staged changes in the project root.");

    runGit(root, ["checkout", "--", "app.txt"]);
    state = mergePr(root, "lead", pr.id, true);
    expect(state.prs[pr.id].status).toBe("merged");
    expect(state.prs[pr.id].merge_blockers).toBeNull();
    expect(fs.existsSync(path.join(root, "feature.txt"))).toBe(true);
  }, 20_000);

  it("allows only lead to spawn persistent agents", () => {
    const root = tempRoot();
    initCompany({ root, id: "lead-spawn-demo" });

    expect(() => requestAgentSpawn(root, "coder", "coder", "coder-extra", "Extra implementation context.")).toThrow(
      /Only lead can spawn agents/,
    );

    const plan = requestAgentSpawn(root, "lead", "coder", "coder-extra", "Extra implementation context.");
    const state = loadState(root);
    expect(plan.name).toBe("coder-extra");
    expect(state.agents["coder-extra"].status).toBe("planned");
  });

  it("plans explicit root-scoped coders without a worktree", () => {
    const root = tempRoot();
    initCompany({ root, id: "root-scoped-coder-demo" });

    const plan = requestAgentSpawn(root, "lead", "coder", "coder-root", "Clean root-level blockers.", {
      useCoderWorktree: false,
    });
    const state = loadState(root);
    const command = launchCommand(root, "coder-root", "/tmp/company.js");

    expect(plan.cwd).toBe(root);
    expect(plan.worktree).toBeNull();
    expect(plan.branch).toBeNull();
    expect(state.agents["coder-root"].cwd).toBe(root);
    expect(state.agents["coder-root"].worktree).toBeNull();
    expect(state.agents["coder-root"].branch).toBeNull();
    expect(command).toContain(`cd '${root}'`);
    expect(command).not.toContain(".pi-company/worktrees/coder-root");
  });

  it("rejects unknown spawn roles unless a custom role pack exists or lead forces it", () => {
    const root = tempRoot();
    initCompany({ root, id: "spawn-role-validation-demo" });

    expect(() => requestAgentSpawn(root, "lead", "codre", "codre-typo", "Typo role.")).toThrow(/Unknown role codre/);

    fs.writeFileSync(path.join(companyPaths(root).rolesDir, "ops.md"), "# Ops\n\nCoordinate releases.\n", "utf8");
    const custom = requestAgentSpawn(root, "lead", "ops", "ops", "Coordinate release.");
    expect(custom.role).toBe("ops");

    const forced = requestAgentSpawn(root, "lead", "copywriter", "copywriter", "Draft copy.", { allowUnknownRole: true });
    expect(forced.role).toBe("copywriter");
  });

  it("does not let repeated spawn requests rewrite existing agent identity", () => {
    const root = tempRoot();
    initCompany({ root, id: "spawn-identity-demo" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-existing", "Existing coder.");
    registerAgent(root, {
      ...plan,
      status: "online",
    });

    expect(() => requestAgentSpawn(root, "lead", "reviewer", "coder-existing", "Wrong role.")).toThrow(/already exists/);
    recordEvent(root, makeEvent("agent.spawn_requested", "lead", {
      name: "coder-existing",
      role: "reviewer",
      cwd: root,
      worktree: null,
      branch: null,
      mission: "Wrong role.",
    }));
    recordEvent(root, makeEvent("agent.spawn_requested", "lead", {
      ...plan,
      mission: "Repeated plan.",
    }));

    const state = loadState(root);
    expect(state.agents["coder-existing"].role).toBe("coder");
    expect(state.agents["coder-existing"].branch).toBe("pi-company/coder-existing");
    expect(state.agents["coder-existing"].worktree).toBe(path.join(root, ".pi-company/worktrees/coder-existing"));
    expect(state.agents["coder-existing"].status).toBe("online");
  });

  it("launches existing roster agents through CLI spawn manual mode", () => {
    const root = tempRoot();
    initCompany({ root, id: "cli-spawn-roster-demo" });

    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      path.join(process.cwd(), "src/cli.ts"),
      "--root",
      root,
      "spawn",
      "tester",
      "--manual",
    ], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PI_COMPANY_AGENT='tester'");
    expect(result.stdout).toContain("--company-role 'tester'");
  });

  it("records cmux surfaces launched by CLI spawn", () => {
    const root = tempRoot();
    initCompany({ root, id: "cli-spawn-cmux-record-demo" });

    withFakeCmuxLaunch("surface:cli-test", {}, () => {
      const result = spawnSync(process.execPath, [
        "--import",
        "tsx",
        path.join(process.cwd(), "src/cli.ts"),
        "--root",
        root,
        "spawn",
        "tester",
        "--cmux",
      ], { encoding: "utf8" });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Launched in surface:cli-test");
      expect(loadState(root).agents.tester.cmux_surface).toBe("surface:cli-test");
    });
  });

  it("does not record cmux surfaces when CLI spawn creates an unreadable terminal", () => {
    const root = tempRoot();
    initCompany({ root, id: "cli-spawn-cmux-unreadable-demo" });

    withFakeCmuxLaunch("surface:cli-dead", { readable: false }, () => {
      const result = spawnSync(process.execPath, [
        "--import",
        "tsx",
        path.join(process.cwd(), "src/cli.ts"),
        "--root",
        root,
        "spawn",
        "tester",
        "--cmux",
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      expect(result.stderr || result.stdout).toContain("terminal never became readable");
      expect(loadState(root).agents.tester.cmux_surface ?? null).toBeNull();
    });
  }, 20_000);

  it("reuses CLI spawn for existing planned agents and creates confirmed missing coder worktrees", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "cli-spawn-existing-demo" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-repeat", "Planned coder.");
    expect(fs.existsSync(plan.worktree ?? "")).toBe(false);

    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      path.join(process.cwd(), "src/cli.ts"),
      "--root",
      root,
      "spawn",
      "coder",
      "--name",
      "coder-repeat",
      "--yes",
      "--manual",
    ], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PI_COMPANY_AGENT='coder-repeat'");
    expect(fs.existsSync(plan.worktree ?? "")).toBe(true);
  });

  it("creates root-scoped coders from CLI spawn --no-worktree", () => {
    const root = tempRoot();
    initCompany({ root, id: "cli-spawn-no-worktree-demo" });

    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      path.join(process.cwd(), "src/cli.ts"),
      "--root",
      root,
      "spawn",
      "coder",
      "--name",
      "coder-root",
      "--no-worktree",
      "--manual",
    ], { encoding: "utf8" });

    const state = loadState(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`cd '${root}'`);
    expect(result.stdout).not.toContain(".pi-company/worktrees/coder-root");
    expect(state.agents["coder-root"].cwd).toBe(root);
    expect(state.agents["coder-root"].worktree).toBeNull();
    expect(state.agents["coder-root"].branch).toBeNull();
  });

  it("rejects unplanned agent registration and ignores rogue spawn events", () => {
    const root = tempRoot();
    initCompany({ root, id: "agent-registration-demo" });

    expect(() => registerAgent(root, {
      name: "coder-rogue",
      role: "coder",
      cwd: root,
      status: "online",
    })).toThrow(/Lead must spawn the agent before it can register/);
    expect(() => heartbeatAgent(root, {
      name: "coder-rogue",
      status: "online",
    })).toThrow(/Lead must spawn the agent before heartbeat/);

    recordEvent(root, makeEvent("agent.spawn_requested", "coder-rogue", {
      name: "coder-rogue",
      role: "coder",
      cwd: root,
      worktree: null,
      branch: null,
      mission: "Rogue.",
    }));
    recordEvent(root, makeEvent("agent.spawned", "coder-rogue", {
      name: "coder-rogue",
      role: "coder",
      cwd: root,
      status: "online",
    }));
    expect(loadState(root).agents["coder-rogue"]).toBeUndefined();

    const plan = requestAgentSpawn(root, "lead", "coder", "coder-planned", "Planned coder.");
    registerAgent(root, {
      ...plan,
      status: "online",
    });
    expect(loadState(root).agents["coder-planned"].status).toBe("online");
  });

  it("rejects planned agent identity changes during registration and replay", () => {
    const root = tempRoot();
    initCompany({ root, id: "agent-identity-demo" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-planned", "Planned coder.");

    expect(() => registerAgent(root, {
      ...plan,
      role: "reviewer",
      status: "online",
    })).toThrow(/registered role reviewer, expected coder/);
    expect(() => registerAgent(root, {
      ...plan,
      branch: "pi-company/other",
      status: "online",
    })).toThrow(/registered branch pi-company\/other, expected pi-company\/coder-planned/);
    expect(() => registerAgent(root, {
      ...plan,
      worktree: path.join(root, ".pi-company/worktrees/other"),
      status: "online",
    })).toThrow(/registered worktree/);

    recordEvent(root, makeEvent("agent.spawned", "coder-planned", {
      ...plan,
      role: "reviewer",
      status: "online",
    }));
    let state = loadState(root);
    expect(state.agents["coder-planned"].role).toBe("coder");
    expect(state.agents["coder-planned"].status).toBe("planned");

    recordEvent(root, makeEvent("agent.heartbeat", "coder-planned", {
      name: "coder-planned",
      branch: "pi-company/other",
      current_task: "ISSUE-999",
      status: "running",
    }));
    state = loadState(root);
    expect(state.agents["coder-planned"].branch).toBe("pi-company/coder-planned");
    expect(state.agents["coder-planned"].current_task).toBeUndefined();

    registerAgent(root, {
      ...plan,
      status: "online",
    });
    state = loadState(root);
    expect(state.agents["coder-planned"].status).toBe("online");
    expect(state.agents["coder-planned"].role).toBe("coder");
  });

  it("rejects heartbeat current tasks outside the agent's assigned work", () => {
    const root = tempRoot();
    initCompany({ root, id: "heartbeat-task-demo" });
    registerAgent(root, {
      name: "pm",
      role: "pm",
      cwd: root,
      status: "online",
    });
    registerAgent(root, {
      name: "tester",
      role: "tester",
      cwd: root,
      status: "online",
    });
    const issue = createIssue(root, "lead", "Tester task", "Acceptance criteria.");
    assignIssue(root, "lead", issue.id, "tester");

    expect(() => heartbeatAgent(root, {
      name: "pm",
      current_task: "ISSUE-999",
      status: "running",
    })).toThrow(/Unknown current task ISSUE-999/);
    expect(() => heartbeatAgent(root, {
      name: "pm",
      current_task: issue.id,
      status: "running",
    })).toThrow(/Only tester can work on ISSUE-001/);

    heartbeatAgent(root, {
      name: "tester",
      current_task: issue.id,
      status: "running",
    });
    expect(loadState(root).agents.tester.current_task).toBe(issue.id);

    completeTask(root, "tester", issue.id, "Done.");
    expect(() => heartbeatAgent(root, {
      name: "tester",
      current_task: issue.id,
      status: "running",
    })).toThrow(/already done/);

    recordEvent(root, makeEvent("agent.heartbeat", "pm", {
      name: "pm",
      current_task: issue.id,
      status: "running",
    }));
    const state = loadState(root);
    expect(state.agents.pm.status).toBe("online");
    expect(state.agents.pm.current_task).toBeNull();
  });

  it("creates new coder worktrees from main instead of the current checkout branch", () => {
    const root = tempRoot();
    initGitRepo(root);
    runGit(root, ["checkout", "-b", "unrelated-feature"]);
    commitFile(root, "unrelated.txt", "should not be in new coder base\n", "unrelated feature");
    initCompany({ root, id: "worktree-base-demo" });

    const plan = requestAgentSpawn(root, "lead", "coder", "coder-new", "New implementation context.");
    ensureCoderWorktree(root, plan, true);

    expect(fs.existsSync(path.join(plan.worktree ?? "", "unrelated.txt"))).toBe(false);
    expect(gitOutput(root, ["rev-parse", "pi-company/coder-new"]).trim()).toBe(gitOutput(root, ["rev-parse", "main"]).trim());
  });

  it("creates an initial pi-company baseline commit before worktree creation in an empty git repo", () => {
    const root = tempRoot();
    runGit(root, ["init", "-b", "main"]);
    fs.writeFileSync(path.join(root, "scratch.txt"), "do not commit me\n", "utf8");
    initCompany({ root, id: "empty-head-demo" });

    const plan = requestAgentSpawn(root, "lead", "coder", "coder-empty", "Implement from an empty repository.");
    ensureCoderWorktree(root, plan, true);

    expect(resolveGitHead(root, "HEAD")).toBeTruthy();
    expect(fs.existsSync(plan.worktree ?? "")).toBe(true);
    expect(gitOutput(root, ["show", "--stat", "--oneline", "HEAD"])).toContain(".gitignore");
    expect(gitOutput(root, ["status", "--porcelain", "--untracked-files=all"])).toContain("?? scratch.txt");
  });

  it("initializes git before worktree creation when a company project has no git repo yet", () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, "scratch.txt"), "do not commit me\n", "utf8");
    initCompany({ root, id: "nogit-worktree-demo" });

    const plan = requestAgentSpawn(root, "lead", "coder", "coder-nogit", "Implement from a no-git project.");
    ensureCoderWorktree(root, plan, true);

    expect(resolveGitHead(root, "HEAD")).toBeTruthy();
    expect(fs.existsSync(plan.worktree ?? "")).toBe(true);
    expect(gitOutput(root, ["branch", "--show-current"]).trim()).toBe("main");
    expect(gitOutput(root, ["show", "--stat", "--oneline", "HEAD"])).toContain(".gitignore");
    expect(gitOutput(root, ["status", "--porcelain", "--untracked-files=all"])).toContain("?? scratch.txt");
  });

  it("reuses an existing correct coder worktree without requiring creation confirmation", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "worktree-reuse-demo" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-reuse", "Reuse implementation context.");
    ensureCoderWorktree(root, plan, true);

    expect(() => ensureCoderWorktree(root, plan, false)).not.toThrow();
  });

  it("blocks an approved parallel branch when the base has advanced into a merge conflict", () => {
    const root = tempRoot();
    initGitRepo(root);
    commitFile(root, "app.txt", "base\n", "base app");
    initCompany({ root, id: "parallel-conflict-demo" });

    const planA = registerCoder(root, "coder-a");
    const planB = registerCoder(root, "coder-b");
    runGit(root, ["checkout", "-b", planA.branch ?? "pi-company/coder-a"]);
    commitFile(root, "app.txt", "from feature a\n", "feature a");
    runGit(root, ["checkout", "main"]);
    runGit(root, ["checkout", "-b", planB.branch ?? "pi-company/coder-b"]);
    commitFile(root, "app.txt", "from feature b\n", "feature b");
    runGit(root, ["checkout", "main"]);

    const prA = createPr(root, "coder-a", {
      title: "Feature A",
      issue_id: null,
      summary: "Feature A summary.",
      branch: planA.branch ?? "pi-company/coder-a",
      worktree: planA.worktree ?? root,
      base: "main",
    });
    const prB = createPr(root, "coder-b", {
      title: "Feature B",
      issue_id: null,
      summary: "Feature B summary.",
      branch: planB.branch ?? "pi-company/coder-b",
      worktree: planB.worktree ?? root,
      base: "main",
    });

    passPrGates(root, prA.id, "coder-a");
    passPrGates(root, prB.id, "coder-b");
    expect(getPrGateStatus(root, prB.id)).toEqual({ ready: true, blockers: [] });

    mergePr(root, "lead", prA.id, true);

    const gates = getPrGateStatus(root, prB.id);
    expect(gates.ready).toBe(false);
    expect(gates.blockers).toContain("Branch has merge conflicts with main");
    expect(loadState(root).prs[prB.id].status).toBe("blocked");
    expect(loadState(root).prs[prB.id].mergeable?.status).toBe("conflict");
    expect(() => mergePr(root, "lead", prB.id, true)).toThrow(/merge conflicts/);
    expect(gitOutput(root, ["status", "--porcelain", "--untracked-files=no"]).trim()).toBe("");
    expect(fs.readFileSync(path.join(root, "app.txt"), "utf8")).toBe("from feature a\n");
  }, 45_000);

  it("does not let a later approval from another reviewer override an unresolved request_changes", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "cross-reviewer-demo" });
    const plan = registerCoder(root);
    registerReviewer(root, "rev2");
    runGit(root, ["checkout", "-b", plan.branch ?? "pi-company/coder"]);
    commitFile(root, "feature.txt", "first\n", "feature first");
    runGit(root, ["checkout", "main"]);

    const pr = createPr(root, "coder", {
      title: "Feature",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate feature.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "Automated checks passed.", "npm test");
    submitTest(root, "tester", pr.id, "pass", "Passed.");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");

    submitReview(root, "reviewer", pr.id, "request_changes", "Security hole, do not merge.");
    submitReview(root, "rev2", pr.id, "approve", "Looks fine to me.");

    const gates = getPrGateStatus(root, pr.id);
    expect(gates.ready).toBe(false);
    expect(gates.blockers).toContain("Latest review requests changes");

    // Resolving the objecting reviewer's review clears the block.
    submitReview(root, "reviewer", pr.id, "approve", "Resolved, approved.");
    expect(getPrGateStatus(root, pr.id).ready).toBe(true);
  });

  it("does not let one reviewer's clean approval clear another reviewer's caveated approval", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "cross-reviewer-caveat-demo" });
    const plan = registerCoder(root);
    registerReviewer(root, "rev2");
    runGit(root, ["checkout", "-b", plan.branch ?? "pi-company/coder"]);
    commitFile(root, "feature.txt", "first\n", "feature first");
    runGit(root, ["checkout", "main"]);

    const pr = createPr(root, "coder", {
      title: "Feature",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate feature.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "Automated checks passed.", "npm test");
    submitTest(root, "tester", pr.id, "pass", "Passed.");
    submitAcceptance(root, "pm", pr.id, "accept", "Product behavior accepted.");

    submitReview(root, "reviewer", pr.id, "approve", "Approved but there is a known issue.", { caveats: ["known issue"] });
    submitReview(root, "rev2", pr.id, "approve", "All clean.", { clean: true });

    const gates = getPrGateStatus(root, pr.id);
    expect(gates.ready).toBe(false);
    expect(gates.blockers).toContain("Reviewer approval contains caveat");
  });

  it("pins review evidence to the commit the reviewer declares with expectedHead", () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "evidence-head-demo" });
    const plan = registerCoder(root);
    runGit(root, ["checkout", "-b", plan.branch ?? "pi-company/coder"]);
    commitFile(root, "feature.txt", "first\n", "feature first");
    runGit(root, ["checkout", "main"]);

    const pr = createPr(root, "coder", {
      title: "Feature",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    const reviewedHead = resolveGitHead(root, plan.branch ?? "pi-company/coder");
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate feature.");
    recordAutomatedTests(root, "tester", pr.id, "passed", "Automated checks passed.", "npm test", null, reviewedHead);
    submitReview(root, "reviewer", pr.id, "approve", "Approved.", null, reviewedHead);
    submitTest(root, "tester", pr.id, "pass", "Passed.", null, reviewedHead);
    submitAcceptance(root, "pm", pr.id, "accept", "Accepted.", null, reviewedHead);
    expect(getPrGateStatus(root, pr.id).ready).toBe(true);

    // A new unreviewed commit must invalidate the head-pinned evidence, even
    // though the coder could re-ready against it.
    runGit(root, ["checkout", plan.branch ?? "pi-company/coder"]);
    commitFile(root, "feature.txt", "second\n", "feature second");
    runGit(root, ["checkout", "main"]);
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate feature.");

    const gates = getPrGateStatus(root, pr.id);
    expect(gates.ready).toBe(false);
    expect(gates.blockers).toContain("Needs 1 reviewer approval(s)");
  });

  it("rejects agent names that could traverse the .pi-company directory", () => {
    const root = tempRoot();
    initCompany({ root, id: "name-validation-demo" });
    expect(() => requestAgentSpawn(root, "lead", "coder", "../../../tmp/pwn")).toThrow(/Invalid agent name/);
    expect(() => requestAgentSpawn(root, "lead", "coder", "a/b")).toThrow(/Invalid agent name/);
    // Ordinary names still work.
    expect(() => requestAgentSpawn(root, "lead", "coder", "coder-ui")).not.toThrow();
  });

  it("clears the previous owner's current task when an issue is reassigned", () => {
    const root = tempRoot();
    initCompany({ root, id: "reassign-demo" });
    registerCoder(root, "coder-a");
    registerCoder(root, "coder-b");
    const issue = createIssue(root, "lead", "Shared work", "", { work_type: "implementation" });
    assignIssue(root, "lead", issue.id, "coder-a");
    startTask(root, "coder-a", issue.id, "Working.");
    expect(loadState(root).agents["coder-a"].current_task).toBe(issue.id);
    expect(loadState(root).agents["coder-a"].status).toBe("running");

    assignIssue(root, "lead", issue.id, "coder-b");
    const state = loadState(root);
    expect(state.agents["coder-a"].current_task).toBeNull();
    expect(state.agents["coder-a"].status).toBe("idle");
    expect(state.issues[issue.id].owner).toBe("coder-b");
  });

  it("ignores a heartbeat whose actor does not match the named agent", () => {
    const root = tempRoot();
    initCompany({ root, id: "actor-spoof-demo" });
    registerAgent(root, { name: "pm", role: "pm", cwd: root, status: "online" });
    registerCoder(root, "coder-a");
    recordEvent(root, makeEvent("agent.heartbeat", "coder-a", { name: "pm", status: "offline" }));
    expect(loadState(root).agents["pm"].status).toBe("online");
  });

  it("tolerates a torn final line in the event log without bricking the company", () => {
    const root = tempRoot();
    initCompany({ root, id: "torn-log-demo" });
    createIssue(root, "lead", "Real issue", "", { work_type: "implementation" });
    const eventsPath = companyPaths(root).events;
    fs.appendFileSync(eventsPath, '{"id":"evt_partial","type":"issue.created"', "utf8");
    const state = loadState(root);
    expect(state.issues["ISSUE-001"]).toBeTruthy();
  });

  it("normalizes a company.yaml that is missing its quality_gates block", () => {
    const root = tempRoot();
    initCompany({ root, id: "missing-gates-demo" });
    const configPath = companyPaths(root).config;
    const config = YAML.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
    delete config.quality_gates;
    fs.writeFileSync(configPath, YAML.stringify(config), "utf8");
    const state = loadState(root);
    expect(state.config?.quality_gates.required_reviews).toBe(1);
    expect(state.config?.quality_gates.require_tests).toBe(true);
  });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-company-"));
  tempRoots.add(root);
  return root;
}

function withFakeCmuxTree<T>(options: { liveSurfaces: string[] }, fn: () => T): T {
  return withFakeCmux(options, fn);
}

function withFakeCmux<T>(options: {
  liveSurfaces: string[];
  screens?: Record<string, string>;
  titles?: Record<string, string>;
  closeLog?: string;
}, fn: () => T): T {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-company-cmux-bin-"));
  tempRoots.add(binDir);
  const cmuxPath = path.join(binDir, "cmux");
  const surfaces = options.liveSurfaces.map((ref) => ({ ref, type: "terminal", title: options.titles?.[ref] ?? ref }));
  const tree = JSON.stringify({ windows: [{ workspaces: [{ panes: [{ surfaces }] }] }] });
  const treePath = path.join(binDir, "tree.json");
  const closeLog = options.closeLog ?? path.join(binDir, "close.log");
  fs.writeFileSync(treePath, tree, "utf8");
  const screenCases = Object.entries(options.screens ?? {}).map(([surface, text], index) => {
    const file = path.join(binDir, `screen-${index}.txt`);
    fs.writeFileSync(file, text, "utf8");
    return `${shellCasePattern(surface)}) cat ${shellSingleQuote(file)}; exit 0 ;;`;
  }).join("\n");
  fs.writeFileSync(cmuxPath, `#!/bin/sh
if [ "$1" = "tree" ]; then
  cat ${shellSingleQuote(treePath)}
  exit 0
fi
if [ "$1" = "read-screen" ]; then
  surface=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --surface) surface="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  case "$surface" in
${screenCases}
  esac
  exit 1
fi
if [ "$1" = "close-surface" ]; then
  surface=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --surface) surface="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  printf '%s\\n' "$surface" >> ${shellSingleQuote(closeLog)}
  exit 0
fi
exit 1
`, "utf8");
  fs.chmodSync(cmuxPath, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
  try {
    return fn();
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellCasePattern(value: string): string {
  return value.replace(/([\\*?[\]])/g, "\\$1");
}

function withFakeCmuxLaunch<T>(surface: string, options: { readable?: boolean }, fn: () => T): T {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-company-cmux-launch-bin-"));
  tempRoots.add(binDir);
  const cmuxPath = path.join(binDir, "cmux");
  const tree = JSON.stringify({ windows: [{ workspaces: [{ panes: [{ surfaces: [{ ref: surface, type: "terminal", title: "pi-company tester" }] }] }] }] });
  const readableCase = options.readable === false
    ? ""
    : `if [ "$1" = "read-screen" ]; then\n  printf 'pi-company tester\\n'\n  exit 0\nfi\n`;
  fs.writeFileSync(cmuxPath, `#!/bin/sh\nif [ "$1" = "--json" ] && [ "$2" = "new-pane" ]; then\n  printf '{"surface_ref":"${surface}"}\\n'\n  exit 0\nfi\nif [ "$1" = "send" ]; then\n  exit 0\nfi\nif [ "$1" = "send-key" ]; then\n  exit 0\nfi\nif [ "$1" = "respawn-pane" ]; then\n  exit 0\nfi\nif [ "$1" = "close-surface" ]; then\n  exit 0\nfi\n${readableCase}if [ "$1" = "tree" ]; then\n  cat <<'JSON'\n${tree}\nJSON\n  exit 0\nfi\nexit 1\n`, "utf8");
  fs.chmodSync(cmuxPath, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
  try {
    return fn();
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
}

function registerCoder(root: string, name = "coder"): ReturnType<typeof requestAgentSpawn> {
  const plan = requestAgentSpawn(root, "lead", "coder", name, "Test coder.");
  registerAgent(root, {
    ...plan,
    status: "online",
  });
  return plan;
}

function registerReviewer(root: string, name: string): ReturnType<typeof requestAgentSpawn> {
  const plan = requestAgentSpawn(root, "lead", "reviewer", name, "Test reviewer.");
  registerAgent(root, { ...plan, status: "online" });
  return plan;
}

function initGitRepo(root: string): void {
  runGit(root, ["init", "-b", "main"]);
  runGit(root, ["config", "user.email", "pi-company-test@example.local"]);
  runGit(root, ["config", "user.name", "pi-company test"]);
  fs.writeFileSync(path.join(root, "README.md"), "# demo\n", "utf8");
  runGit(root, ["add", "README.md"]);
  runGit(root, ["commit", "-m", "initial"]);
}

function commitFile(root: string, relativePath: string, content: string, message: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  runGit(root, ["add", relativePath]);
  runGit(root, ["commit", "-m", message]);
}

function passPrGates(root: string, prId: string, author = "coder"): void {
  markPrReady(root, author, prId, "Self-test passed.", "Validate feature behavior.");
  recordAutomatedTests(root, "tester", prId, "passed", "Automated checks passed.", "npm test");
  submitReview(root, "reviewer", prId, "approve", "Approved.");
  submitTest(root, "tester", prId, "pass", "Passed.");
  submitAcceptance(root, "pm", prId, "accept", "Product behavior accepted.");
}

async function createIssuesInParallel(root: string, count: number): Promise<void> {
  const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  const companyModule = path.join(process.cwd(), "src", "core", "company.ts");
  const results = await Promise.all(Array.from({ length: count }, (_, index) => new Promise<{ status: number | null; stderr: string }>((resolve) => {
    const code = [
      `import { createIssue } from ${JSON.stringify(companyModule)};`,
      `createIssue(${JSON.stringify(root)}, "lead", ${JSON.stringify(`Concurrent issue ${index}`)});`,
    ].join("\n");
    const child = spawn(tsx, ["-e", code], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("exit", (status) => resolve({ status, stderr }));
  })));
  const failures = results.filter((result) => result.status !== 0);
  if (failures.length > 0) {
    throw new Error(failures.map((failure) => failure.stderr).join("\n"));
  }
}

function runGit(root: string, args: string[]): void {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
}

function gitOutput(root: string, args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
