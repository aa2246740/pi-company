import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import companyExtension from "../extensions/company.js";
import {
  assignIssue,
  completeTask,
  createIssue,
  createPr,
  initCompany,
  listInbox,
  loadConfig,
  loadState,
  markPrReady,
  registerAgent,
  reportRateLimit,
  requestAgentSpawn,
  sendCompanyMessage,
  startTask,
} from "../src/core/company.js";
import { writeYaml } from "../src/core/io.js";
import { companyPaths } from "../src/core/paths.js";
import { providerQueueSnapshot } from "../src/core/provider-queue.js";

const tempRoots = new Set<string>();

afterEach(() => {
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

describe("pi-company extension", () => {
  it("stays inactive in ordinary Pi sessions outside a company project", async () => {
    const root = tempRoot();
    const { handlers, pi, tools, commands } = fakePi({});
    const { ctx, ui } = fakeContext(root);

    withWorkingDirectory(root, () => companyExtension(pi));
    await handlers.session_start?.({}, ctx);
    await handlers.before_provider_request?.({}, ctx);
    const inputResult = await handlers.input?.({ source: "interactive", text: "ordinary pi steering" }, ctx);
    await handlers.session_shutdown?.({}, ctx);

    expect(fs.existsSync(path.join(root, ".pi-company"))).toBe(false);
    expect(tools).toHaveLength(0);
    expect(commands.some((command) => command.name === "company-init")).toBe(true);
    expect(commands.some((command) => command.name === "company-start")).toBe(true);
    expect(commands.some((command) => command.name === "company-resume")).toBe(true);
    expect(ui.setTitle).not.toHaveBeenCalled();
    expect(ui.setStatus).not.toHaveBeenCalledWith("pi-company", expect.any(String));
    expect(ui.setWidget).not.toHaveBeenCalled();
    expect(inputResult).toEqual({ action: "continue" });
  });

  it("does not initialize a company from /company-start in an ordinary Pi session", async () => {
    const root = tempRoot();
    const { pi, commands } = fakePi({});
    const { ctx, ui } = fakeContext(root);

    withWorkingDirectory(root, () => companyExtension(pi));
    const start = commands.find((command) => command.name === "company-start");
    if (!start) throw new Error("company-start command was not registered");
    await start.handler("", ctx);

    expect(fs.existsSync(path.join(root, ".pi-company"))).toBe(false);
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("run /company-init"), "info");
  });

  it("initializes and attaches a company from inside an ordinary Pi session", async () => {
    const root = tempRoot();
    const { pi, commands, tools } = fakePi({});
    const { ctx, ui } = fakeContext(root);

    let init: { handler: (args: string, ctx: ExtensionContext) => unknown } | undefined;
    withWorkingDirectory(root, () => {
      companyExtension(pi);
      init = commands.find((command) => command.name === "company-init");
    });
    if (!init) throw new Error("company-init command was not registered");
    await init.handler("friendly-company", ctx);

    expect(loadConfig(root)?.id).toBe("friendly-company");
    expect(tools.some((tool) => tool.name === "company_status")).toBe(true);
    expect(tools.some((tool) => tool.name === "company_record_automated_tests")).toBe(true);
    expect(tools.some((tool) => tool.name === "company_record_auto_tests")).toBe(true);
    expect(ui.setWidget).toHaveBeenCalledWith(
      "pi-company",
      expect.arrayContaining([
        expect.stringContaining("pi-company friendly-company"),
        "context: active | Pi resumes chat; company context updates each turn",
      ]),
      { placement: "belowEditor" },
    );
    expect(ui.setStatus).toHaveBeenCalledWith("pi-company", "lead/lead inbox:0 · active");
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("Initialized pi-company"), "info");
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("discovers a parent company project from a subdirectory", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-parent-discovery" });
    const child = path.join(root, "src", "feature");
    fs.mkdirSync(child, { recursive: true });
    const { handlers, tools } = withWorkingDirectory(child, () => {
      const harness = fakePi({});
      companyExtension(harness.pi);
      return harness;
    });
    const { ctx, ui } = fakeContext(child);

    await handlers.session_start?.({}, ctx);
    await handlers.session_shutdown?.({}, ctx);

    expect(tools.some((tool) => tool.name === "company_status")).toBe(true);
    expect(ui.setTitle).toHaveBeenCalledWith("pi-company lead");
    expect(ui.setWidget).toHaveBeenCalledWith(
      "pi-company",
      expect.arrayContaining([expect.stringContaining("pi-company extension-parent-discovery")]),
      { placement: "belowEditor" },
    );
  });

  it("surfaces startup registration errors in the Pi UI", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-startup-error" });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "rogue",
      "company-role": "coder",
    });
    const { ctx, ui } = fakeContext(root);

    companyExtension(pi);

    await expect(handlers.session_start?.({}, ctx)).rejects.toThrow(/Unknown agent rogue/);
    expect(ui.setStatus).toHaveBeenCalledWith(
      "pi-company",
      expect.stringContaining("pi-company startup error: Unknown agent rogue"),
    );
    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("pi-company startup error: Unknown agent rogue"),
      "error",
    );
  });

  it("shows the registered roster role instead of a stale role flag", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-role-display" });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "pm",
      "company-role": "coder",
    });
    const { ctx, ui } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    await handlers.session_shutdown?.({}, ctx);

    expect(ui.setStatus).toHaveBeenCalledWith("pi-company", "pm/pm inbox:0 · active");
  });

  it("automatically appends pi-company context before each agent turn", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-auto-context" });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "lead",
      "company-role": "lead",
    });
    const { ctx, ui } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const widget = ui.setWidget.mock.calls.at(-1)?.[1] as string[];
    expect(widget).toContain("context: active | Pi resumes chat; company context updates each turn");
    const result = await handlers.before_agent_start?.({ systemPrompt: "base system" }, ctx) as { systemPrompt: string };
    await handlers.session_shutdown?.({}, ctx);

    expect(result.systemPrompt).toContain("base system");
    expect(result.systemPrompt).toContain("[pi-company context]");
    expect(result.systemPrompt).toContain("Pi owns chat session resume");
    expect(result.systemPrompt).toContain("Agent: lead");
    expect(result.systemPrompt).toContain("You protect project direction");
    expect(result.systemPrompt).toContain("Authoritative project brief:");
    expect(result.systemPrompt).toContain("Delivery State:");
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("manually refreshes pi-company context from a slash command", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-resume" });
    const { handlers, pi, commands } = fakePi({
      "company-root": root,
      "company-agent": "lead",
      "company-role": "lead",
    });
    const { ctx, ui } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const preStartWidget = ui.setWidget.mock.calls.at(-1)?.[1] as string[];
    expect(preStartWidget).toContain("context: active | Pi resumes chat; company context updates each turn");
    const start = commands.find((command) => command.name === "company-start");
    if (!start) throw new Error("company-start command was not registered");
    await start.handler("", ctx);
    const postStartWidget = ui.setWidget.mock.calls.at(-1)?.[1] as string[];
    expect(postStartWidget).toContain("context: active | brief refreshed in chat");
    expect(ui.setStatus).toHaveBeenCalledWith("pi-company", "lead/lead inbox:0 · brief refreshed");
    await handlers.session_shutdown?.({}, ctx);

    const sendUserMessage = pi.sendUserMessage as unknown as ReturnType<typeof vi.fn>;
    const injected = sendUserMessage.mock.calls.at(-1)?.[0] as string;
    expect(injected).toContain("[pi-company brief refresh]");
    expect(injected).toContain("Agent: lead");
    expect(injected).toContain("You protect project direction");
    expect(injected).toContain("Authoritative project brief:");
    expect(injected).toContain("Delivery State:");
    expect(ui.notify).toHaveBeenCalledWith("pi-company brief refreshed for lead", "info");
  });

  it("marks the agent offline when the Pi session shuts down", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-shutdown-offline" });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "tester",
      "company-role": "tester",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    expect(loadState(root).agents.tester.status).toBe("online");
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(loadState(root).agents.tester.status).toBe("offline");
  });

  it("can launch an existing planned roster agent from the spawn tool", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-launch-existing" });
    const { handlers, pi, tools } = fakePi({
      "company-root": root,
      "company-agent": "lead",
      "company-role": "lead",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const spawnTool = tools.find((tool) => tool.name === "company_spawn_agent");
    if (!spawnTool) throw new Error("company_spawn_agent tool was not registered");
    const result = await spawnTool.execute("tool-1", {
      role: "pm",
      name: "pm",
      mission: "Shape product direction.",
      launch_in_cmux: false,
    }, undefined, undefined, ctx) as ToolResult;
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(result.content[0].text).toContain("PI_COMPANY_AGENT='pm'");
    expect(result.details.existing).toBe(true);
  });

  it("queues a mission briefing when launching an existing planned agent without assigned work", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-launch-mission-briefing" });
    const { handlers, pi, tools } = fakePi({
      "company-root": root,
      "company-agent": "lead",
      "company-role": "lead",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const spawnTool = tools.find((tool) => tool.name === "company_spawn_agent");
    if (!spawnTool) throw new Error("company_spawn_agent tool was not registered");
    const result = await spawnTool.execute("tool-1", {
      role: "pm",
      name: "pm",
      mission: "Use grill-me to pressure-test the Matrix 2048 concept.",
      launch_in_cmux: false,
    }, undefined, undefined, ctx) as ToolResult;
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    const inbox = listInbox(root, "pm");
    expect(result.details.briefing).toMatchObject({
      to: "pm",
      type: "assignment",
      task: null,
      priority: "high",
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0].text).toContain("Use grill-me to pressure-test the Matrix 2048 concept.");
    expect(inbox[0].text).toContain("(no issue assigned yet)");
  });

  it("rejects unknown roles from the spawn tool unless a role pack exists", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-spawn-role-validation" });
    const { handlers, pi, tools } = fakePi({
      "company-root": root,
      "company-agent": "lead",
      "company-role": "lead",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const spawnTool = tools.find((tool) => tool.name === "company_spawn_agent");
    if (!spawnTool) throw new Error("company_spawn_agent tool was not registered");
    await expect(spawnTool.execute("tool-1", {
      role: "codre",
      name: "codre-typo",
      mission: "Typo role.",
      launch_in_cmux: false,
      create_worktree: false,
    }, undefined, undefined, ctx)).rejects.toThrow(/Unknown role codre/);
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);
  });

  it("auto-assigns the only unowned open issue when spawning a coder", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-spawn-coder-auto-assign" });
    const issue = createIssue(root, "lead", "Implement Matrix 2048", "Build the game.");
    const { handlers, pi, tools } = fakePi({
      "company-root": root,
      "company-agent": "lead",
      "company-role": "lead",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const spawnTool = tools.find((tool) => tool.name === "company_spawn_agent");
    if (!spawnTool) throw new Error("company_spawn_agent tool was not registered");
    const result = await spawnTool.execute("tool-1", {
      role: "coder",
      name: "coder",
      mission: "Implement the Matrix-themed 2048 game.",
      launch_in_cmux: false,
      create_worktree: false,
    }, undefined, undefined, ctx) as ToolResult;
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    const state = loadState(root);
    const inbox = listInbox(root, "coder");
    expect(state.issues[issue.id].owner).toBe("coder");
    expect(result.details.assigned_issue).toMatchObject({ id: issue.id, owner: "coder" });
    expect(result.details.briefing).toMatchObject({
      to: "coder",
      type: "assignment",
      task: issue.id,
      priority: "high",
    });
    expect(inbox.some((message) => message.text.includes("[pi-company assignment]"))).toBe(true);
    expect(inbox.some((message) => message.text.includes("[pi-company launch briefing]"))).toBe(true);
  });

  it("shows coder-ready PRs separately from missing gate blockers in status", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-status-ready-blocked" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder", "Implement the feature.");
    registerAgent(root, {
      ...plan,
      status: "online",
    });
    const pr = createPr(root, "coder", {
      title: "Ready but gate-blocked",
      issue_id: null,
      summary: "Feature summary.",
      branch: plan.branch ?? "pi-company/coder",
      worktree: plan.worktree ?? root,
      base: "main",
    });
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate feature behavior.");
    const { handlers, pi, tools } = fakePi({
      "company-root": root,
      "company-agent": "lead",
      "company-role": "lead",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const statusTool = tools.find((tool) => tool.name === "company_status");
    if (!statusTool) throw new Error("company_status tool was not registered");
    const result = await statusTool.execute("tool-1", {}, undefined, undefined, ctx) as ToolResult;
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(result.content[0].text).toContain(`${pr.id} blocked coder_ready=yes`);
    expect(result.content[0].text).toContain("gate_blockers=Needs 1 reviewer approval(s); Missing tester validation; Missing automated test result; Missing PM/lead product acceptance");
  });

  it("queues a launch briefing when an existing agent has assigned work", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-launch-briefing" });
    const issue = createIssue(root, "lead", "Implement the draw flow", "Acceptance criteria.");
    assignIssue(root, "lead", issue.id, "pm");
    const { handlers, pi, tools } = fakePi({
      "company-root": root,
      "company-agent": "lead",
      "company-role": "lead",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const spawnTool = tools.find((tool) => tool.name === "company_spawn_agent");
    if (!spawnTool) throw new Error("company_spawn_agent tool was not registered");
    const result = await spawnTool.execute("tool-1", {
      role: "pm",
      name: "pm",
      mission: "Shape product direction.",
      launch_in_cmux: false,
    }, undefined, undefined, ctx) as ToolResult;
    const duplicate = await spawnTool.execute("tool-2", {
      role: "pm",
      name: "pm",
      mission: "Shape product direction.",
      launch_in_cmux: false,
    }, undefined, undefined, ctx) as ToolResult;
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    const inbox = listInbox(root, "pm");
    expect(result.details.briefing).toMatchObject({
      to: "pm",
      type: "assignment",
      task: issue.id,
      priority: "high",
    });
    expect(duplicate.details.briefing).toBeNull();
    const launchBriefings = inbox.filter((message) => message.text.includes("[pi-company launch briefing]"));
    const assignmentNotices = inbox.filter((message) => message.text.includes("[pi-company assignment]"));
    expect(launchBriefings).toHaveLength(1);
    expect(assignmentNotices).toHaveLength(1);
    expect(launchBriefings[0].text).toContain(`${issue.id} assigned: Implement the draw flow`);
  });

  it("configures role model policy through Pi UI model choices", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-model-policy" });
    const { handlers, pi, tools } = fakePi({
      "company-root": root,
      "company-agent": "lead",
      "company-role": "lead",
    });
    const { ctx, ui } = fakeContext(root);
    ctx.modelRegistry = {
      getAvailable: vi.fn(() => [
        {
          provider: "openai-codex",
          id: "gpt-5.4-mini",
          name: "gpt-5.4-mini",
          reasoning: true,
          contextWindow: 272000,
        },
      ]),
    } as never;
    ui.select
      .mockResolvedValueOnce("Role: coder")
      .mockResolvedValueOnce("openai-codex/gpt-5.4-mini context:272K thinking:yes")
      .mockResolvedValueOnce("low")
      .mockResolvedValueOnce("Done");

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const tool = tools.find((tool) => tool.name === "company_configure_model_policy");
    if (!tool) throw new Error("company_configure_model_policy tool was not registered");
    const result = await tool.execute("tool-1", {}, undefined, undefined, ctx) as ToolResult;
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(result.content[0].text).toContain("Configured Role: coder to openai-codex/gpt-5.4-mini:low.");
    expect(loadConfig(root)?.model_policy?.roles?.coder).toEqual({
      provider: "openai-codex",
      model: "gpt-5.4-mini",
      thinking: "low",
    });
  });

  it("uses explicit Pi flags before ambient PI_COMPANY environment variables", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-flag-env-priority" });
    const previousAgent = process.env.PI_COMPANY_AGENT;
    const previousRole = process.env.PI_COMPANY_ROLE;
    const previousRoot = process.env.PI_COMPANY_ROOT;
    process.env.PI_COMPANY_AGENT = "tester";
    process.env.PI_COMPANY_ROLE = "tester";
    process.env.PI_COMPANY_ROOT = "/tmp/wrong-company-root";
    try {
      const { handlers, pi } = fakePi({
        "company-root": root,
        "company-agent": "pm",
        "company-role": "pm",
      });
      const { ctx, ui } = fakeContext(root);

      companyExtension(pi);
      await handlers.session_start?.({}, ctx);
      await handlers.session_shutdown?.({}, ctx);

      expect(ui.setStatus).toHaveBeenCalledWith("pi-company", "pm/pm inbox:0 · active");
    } finally {
      restoreEnv("PI_COMPANY_AGENT", previousAgent);
      restoreEnv("PI_COMPANY_ROLE", previousRole);
      restoreEnv("PI_COMPANY_ROOT", previousRoot);
    }
  });

  it("does not show stale task-specific mission while idle", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-idle-focus" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-site", "Implement old website task.");
    registerAgent(root, {
      ...plan,
      status: "online",
    });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "coder-site",
      "company-role": "coder",
    });
    const { ctx, ui } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    await handlers.session_shutdown?.({}, ctx);

    const widget = ui.setWidget.mock.calls.at(-1)?.[1] as string[];
    expect(widget).toContain("focus: idle");
    expect(widget).not.toContain("mission: Implement old website task.");
  });

  it("shows active task focus instead of stale mission in the desk panel", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-active-focus" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-site", "Implement old website task.");
    registerAgent(root, {
      ...plan,
      status: "online",
    });
    const oldIssue = createIssue(root, "lead", "Old completed task", "Done.");
    assignIssue(root, "lead", oldIssue.id, "coder-site");
    startTask(root, "coder-site", oldIssue.id);
    completeTask(root, "coder-site", oldIssue.id, "Done.");
    const activeIssue = createIssue(root, "lead", "Current Japanese language support", "Add Japanese.");
    assignIssue(root, "lead", activeIssue.id, "coder-site");
    startTask(root, "coder-site", activeIssue.id);
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "coder-site",
      "company-role": "coder",
    });
    const { ctx, ui } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    await handlers.session_shutdown?.({}, ctx);

    const widget = ui.setWidget.mock.calls.at(-1)?.[1] as string[];
    expect(widget).toContain(`focus: ${activeIssue.id} Current Japanese language support`);
    expect(widget).not.toContain("mission: Implement old website task.");
    expect(widget).toContain(`issues: ${activeIssue.id}:in_progress ${oldIssue.id}:done`);
  });

  it("shows active organization rate-limit backoff in the desk panel", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-rate-limit" });
    reportRateLimit(root, "system", "429 Too many requests", "provider_429", "2099-01-01T00:00:00.000Z");
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "tester",
      "company-role": "tester",
    });
    const { ctx, ui } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    await handlers.session_shutdown?.({}, ctx);

    const widget = ui.setWidget.mock.calls.at(-1)?.[1] as string[];
    expect(widget).toContain("rate-limit: active provider_429 until 2099-01-01T00:01:00.000Z");
  });

  it("records 429 backoff and keeps an inbox message unacknowledged when follow-up delivery fails", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-delivery-rate-limit" });
    sendCompanyMessage(root, {
      from: "lead",
      to: "tester",
      type: "assignment",
      priority: "high",
      text: "Please validate PR-123.",
    });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "tester",
      "company-role": "tester",
    });
    const sendUserMessage = pi.sendUserMessage as unknown as ReturnType<typeof vi.fn>;
    sendUserMessage.mockRejectedValue(new Error("Retry failed after 3 attempts: 429 Too many requests"));
    const { ctx, ui } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    await handlers.session_shutdown?.({}, ctx);

    const state = loadState(root);
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(state.rate_limit?.kind).toBe("provider_429");
    expect(state.rate_limit?.reported_by).toBe("tester");
    expect(listInbox(root, "tester")).toHaveLength(1);
    expect(listInbox(root, "lead").at(-1)?.text).toContain("Rate limit reported by tester");
    expect(ui.setStatus).toHaveBeenCalledWith("pi-company", expect.stringContaining("rate-limit: paused until"));
  });

  it("does not auto-inject inbox follow-ups while the agent is already processing", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-busy-delivery" });
    sendCompanyMessage(root, {
      from: "lead",
      to: "tester",
      type: "assignment",
      priority: "high",
      text: "Please validate PR-123.",
    });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "tester",
      "company-role": "tester",
    });
    const sendUserMessage = pi.sendUserMessage as unknown as ReturnType<typeof vi.fn>;
    const { ctx } = fakeContext(root);
    (ctx.isIdle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    await handlers.session_shutdown?.({}, ctx);

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(listInbox(root, "tester")).toHaveLength(1);
  });

  it("keeps inbox messages queued when Pi rejects a follow-up because the agent became busy", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-busy-race-delivery" });
    sendCompanyMessage(root, {
      from: "lead",
      to: "tester",
      type: "assignment",
      priority: "high",
      text: "Please validate PR-123.",
    });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "tester",
      "company-role": "tester",
    });
    const sendUserMessage = pi.sendUserMessage as unknown as ReturnType<typeof vi.fn>;
    sendUserMessage.mockRejectedValue(new Error("Agent is already processing a prompt. Use steer() or followUp() to queue messages."));
    const { ctx, ui } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    await handlers.session_shutdown?.({}, ctx);

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(listInbox(root, "tester")).toHaveLength(1);
    expect(ui.setStatus).not.toHaveBeenCalledWith("pi-company", expect.stringContaining("mailbox error"));
  });

  it("blocks lead from writing deliverables directly through built-in tools", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-lead-tool-guard" });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "lead",
      "company-role": "lead",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const writeResult = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1",
      toolName: "write",
      input: { path: path.join(root, "index.html"), content: "<html></html>" },
    }, ctx);
    const editResult = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-2",
      toolName: "edit",
      input: { path: path.join(root, "index.html"), edits: [] },
    }, ctx);
    const bashResult = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-3",
      toolName: "bash",
      input: { command: "mkdir -p site && git add -A && git commit -m work" },
    }, ctx);
    const readOnlyBash = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-4",
      toolName: "bash",
      input: { command: "git status --short && ls -la" },
    }, ctx);
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(writeResult).toMatchObject({ block: true });
    expect(editResult).toMatchObject({ block: true });
    expect(bashResult).toMatchObject({ block: true });
    expect(readOnlyBash).toBeUndefined();
  });

  it("does not apply the lead direct-work guard to coder agents", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-coder-tool-guard" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder", "Implement feature.");
    const worktree = path.join(root, ".pi-company", "worktrees", "coder");
    registerAgent(root, {
      ...plan,
      worktree,
      cwd: worktree,
      status: "online",
    });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "coder",
      "company-role": "coder",
    });
    const { ctx } = fakeContext(worktree);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const writeResult = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1",
      toolName: "write",
      input: { path: path.join(worktree, "index.html"), content: "<html></html>" },
    }, ctx);
    const bashResult = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-2",
      toolName: "bash",
      input: { command: "mkdir -p site && touch site/index.html && git add site/index.html" },
    }, ctx);
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(writeResult).toBeUndefined();
    expect(bashResult).toBeUndefined();
  });

  it("allows PM product specs but blocks PM business-code writes", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-pm-write-boundary" });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "pm",
      "company-role": "pm",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const productSpec = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1",
      toolName: "write",
      input: { path: "PRODUCT_SPEC_HEADPHONE_3D.md", content: "# Product" },
    }, ctx);
    const docsMkdir = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1b",
      toolName: "bash",
      input: { command: "mkdir -p docs/product" },
    }, ctx);
    const implementation = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-2",
      toolName: "write",
      input: { path: path.join(root, "index.html"), content: "<html></html>" },
    }, ctx);
    const mutatingBash = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-3",
      toolName: "bash",
      input: { command: "cat > index.html <<'EOF'\n<html></html>\nEOF" },
    }, ctx);
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(productSpec).toBeUndefined();
    expect(docsMkdir).toBeUndefined();
    expect(implementation).toMatchObject({ block: true });
    expect(String((implementation as { reason?: string } | undefined)?.reason)).toContain("Business code and runnable deliverables must be assigned to coder");
    expect(mutatingBash).toMatchObject({ block: true });
  });

  it("allows designer design specs but blocks designer runnable UI writes", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-designer-write-boundary" });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "designer",
      "company-role": "designer",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const designSpec = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1",
      toolName: "write",
      input: { path: "DESIGN_SPEC.md", content: "# Design" },
    }, ctx);
    const docsMkdir = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1b",
      toolName: "bash",
      input: { command: "mkdir -p docs/design" },
    }, ctx);
    const cssWrite = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-2",
      toolName: "write",
      input: { path: path.join(root, "style.css"), content: "body {}" },
    }, ctx);
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(designSpec).toBeUndefined();
    expect(docsMkdir).toBeUndefined();
    expect(cssWrite).toMatchObject({ block: true });
    expect(String((cssWrite as { reason?: string } | undefined)?.reason)).toContain("Runnable UI, styles, assets, and code must be assigned to coder");
  });

  it("blocks coder bash mutations that reference paths outside the assigned worktree", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-coder-worktree-bash-guard" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder", "Implement feature.");
    const worktree = path.join(root, ".pi-company", "worktrees", "coder");
    registerAgent(root, {
      ...plan,
      worktree,
      cwd: worktree,
      status: "online",
    });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "coder",
      "company-role": "coder",
    });
    const { ctx } = fakeContext(worktree);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const insideBash = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1",
      toolName: "bash",
      input: { command: "mkdir -p site && touch site/index.html && git add site/index.html" },
    }, ctx);
    const outsideBash = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-2",
      toolName: "bash",
      input: { command: `mkdir -p ${path.join(root, "site")} && touch ${path.join(root, "site", "index.html")}` },
    }, ctx);
    const parentBash = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-3",
      toolName: "bash",
      input: { command: "cat > ../index.html <<'EOF'\n<html></html>\nEOF" },
    }, ctx);
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(insideBash).toBeUndefined();
    expect(outsideBash).toMatchObject({ block: true });
    expect(parentBash).toMatchObject({ block: true });
    expect(String((outsideBash as { reason?: string } | undefined)?.reason)).toContain("only inside its assigned worktree");
  });

  it("blocks coder write/edit calls that target files outside the assigned worktree", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-coder-worktree-write-guard" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder", "Implement feature.");
    const worktree = path.join(root, ".pi-company", "worktrees", "coder");
    registerAgent(root, {
      ...plan,
      worktree,
      cwd: worktree,
      status: "online",
    });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "coder",
      "company-role": "coder",
    });
    const { ctx } = fakeContext(worktree);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const insideWrite = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1",
      toolName: "write",
      input: { path: path.join(worktree, "site", "index.html"), content: "<html></html>" },
    }, ctx);
    const outsideWrite = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-2",
      toolName: "write",
      input: { path: path.join(root, "site", "index.html"), content: "<html></html>" },
    }, ctx);
    const outsideEdit = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-3",
      toolName: "edit",
      input: { path: path.join(root, "site", "index.html"), edits: [] },
    }, ctx);
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(insideWrite).toBeUndefined();
    expect(outsideWrite).toMatchObject({ block: true });
    expect(outsideEdit).toMatchObject({ block: true });
  });

  it("records provider 429 responses from Pi provider hooks", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-provider-rate-limit" });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "tester",
      "company-role": "tester",
    });
    const { ctx, ui } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    await handlers.after_provider_response?.({
      status: 429,
      headers: { "retry-after": "60" },
    }, ctx);
    await handlers.session_shutdown?.({}, ctx);

    const state = loadState(root);
    expect(state.rate_limit?.kind).toBe("provider_429");
    expect(state.rate_limit?.reported_by).toBe("tester");
    expect(state.rate_limit?.reason).toContain("Provider HTTP 429");
    expect(state.rate_limit?.reason).toContain("retry-after=60");
    expect(ui.setStatus).toHaveBeenCalledWith("pi-company", expect.stringContaining("rate-limit: paused until"));
  });

  it("gates provider requests before sending and releases the lease at turn end", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-provider-request-gate" });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "tester",
      "company-role": "tester",
    });
    const { ctx, ui } = fakeContext(root);
    (ctx as unknown as { model: unknown }).model = { provider: "openai-codex", id: "gpt-5.4-mini" };

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    await handlers.before_provider_request?.({}, ctx);

    expect(providerQueueSnapshot(root, "openai-codex").leases.map((lease) => lease.agent)).toEqual(["tester"]);
    expect(ui.setStatus).toHaveBeenCalledWith("pi-company", expect.stringContaining("provider gate: openai-codex"));

    await handlers.turn_end?.({}, ctx);
    await handlers.session_shutdown?.({}, ctx);

    expect(providerQueueSnapshot(root, "openai-codex").leases).toHaveLength(0);
  });

  it("releases each provider lease after responses and clears leftovers at turn end", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-provider-multi-request-release" });
    const config = loadConfig(root);
    if (!config) throw new Error("Missing company config");
    writeYaml(companyPaths(root).config, {
      ...config,
      provider_request_policy: {
        ...(config.provider_request_policy ?? {}),
        min_start_interval_ms: 0,
      },
    });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "tester",
      "company-role": "tester",
    });
    const { ctx } = fakeContext(root);
    (ctx as unknown as { model: unknown }).model = { provider: "openai-codex", id: "gpt-5.4-mini" };

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    await handlers.before_provider_request?.({}, ctx);
    await handlers.before_provider_request?.({}, ctx);
    expect(providerQueueSnapshot(root, "openai-codex").leases).toHaveLength(2);

    await handlers.after_provider_response?.({ status: 200, headers: {} }, ctx);
    expect(providerQueueSnapshot(root, "openai-codex").leases).toHaveLength(1);

    await handlers.before_provider_request?.({}, ctx);
    expect(providerQueueSnapshot(root, "openai-codex").leases).toHaveLength(2);
    await handlers.turn_end?.({}, ctx);
    await handlers.session_shutdown?.({}, ctx);

    expect(providerQueueSnapshot(root, "openai-codex").leases).toHaveLength(0);
  });

  it("waits for organization backoff before acquiring a provider lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-01T00:00:00.000Z"));
    try {
      const root = tempRoot();
      initCompany({ root, id: "extension-provider-backoff-gate" });
      reportRateLimit(root, "system", "429 Too many requests", "provider_429", "2099-01-01T00:00:00.000Z");
      const { handlers, pi } = fakePi({
        "company-root": root,
        "company-agent": "tester",
        "company-role": "tester",
      });
      const { ctx, ui } = fakeContext(root);
      (ctx as unknown as { model: unknown }).model = { provider: "openai-codex", id: "gpt-5.4-mini" };

      companyExtension(pi);
      await handlers.session_start?.({}, ctx);
      const request = handlers.before_provider_request?.({}, ctx) as Promise<unknown>;
      await vi.advanceTimersByTimeAsync(20);

      expect(providerQueueSnapshot(root, "openai-codex").leases).toHaveLength(0);
      expect(ui.setStatus).toHaveBeenCalledWith(
        "pi-company",
        "provider gate: paused until 2099-01-01T00:03:30.000Z",
      );

      await vi.advanceTimersByTimeAsync(210_000);
      await request;

      expect(providerQueueSnapshot(root, "openai-codex").leases.map((lease) => lease.agent)).toEqual(["tester"]);
      await handlers.session_shutdown?.({}, ctx);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deduplicates bursty automatic provider 429 reports in one Pi session", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-provider-rate-limit-dedupe" });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "tester",
      "company-role": "tester",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    await handlers.after_provider_response?.({ status: 429, headers: {} }, ctx);
    await handlers.after_provider_response?.({ status: 429, headers: {} }, ctx);
    await handlers.session_shutdown?.({}, ctx);

    const state = loadState(root);
    expect(state.rate_limit?.incidents).toBe(1);
    expect(state.rate_limit?.retry_after_ms).toBe(60_000);
  });

  it("lets lead clear a verified false-positive rate-limit backoff from Pi", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-clear-rate-limit" });
    reportRateLimit(root, "system", "False screen-scan quota hit", "quota_exhausted", "2099-01-01T00:00:00.000Z");
    const { handlers, pi, tools } = fakePi({
      "company-root": root,
      "company-agent": "lead",
      "company-role": "lead",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const tool = tools.find((item) => item.name === "company_clear_rate_limit");
    expect(tool).toBeTruthy();
    await tool?.execute("tool-1", { reason: "Verified false positive from API docs." }, undefined, undefined, ctx);
    await handlers.session_shutdown?.({}, ctx);

    expect(loadState(root).rate_limit).toBeNull();
  });
});

type Handler = (event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>;
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

function fakePi(flags: Record<string, string | boolean> = {}): {
  handlers: Record<string, Handler>;
  pi: ExtensionAPI;
  tools: Array<{ name: string; execute: (...args: unknown[]) => unknown }>;
  commands: Array<{ name: string; handler: (args: string, ctx: ExtensionContext) => unknown }>;
} {
  const handlers: Record<string, Handler> = {};
  const tools: Array<{ name: string; execute: (...args: unknown[]) => unknown }> = [];
  const commands: Array<{ name: string; handler: (args: string, ctx: ExtensionContext) => unknown }> = [];
  const pi = {
    registerFlag: vi.fn(),
    getFlag: vi.fn((name: string) => flags[name]),
    on: vi.fn((event: string, handler: Handler) => {
      handlers[event] = handler;
    }),
    registerCommand: vi.fn((name: string, command: { handler: (args: string, ctx: ExtensionContext) => unknown }) => {
      commands.push({ name, handler: command.handler });
    }),
    registerTool: vi.fn((tool: { name: string; execute: (...args: unknown[]) => unknown }) => {
      tools.push(tool);
    }),
    sendUserMessage: vi.fn(),
  } as unknown as ExtensionAPI;
  return { handlers, pi, tools, commands };
}

function fakeContext(cwd: string): {
  ctx: ExtensionContext;
  ui: {
    setTitle: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
    setWidget: ReturnType<typeof vi.fn>;
    notify: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };
} {
  const ui = {
    setTitle: vi.fn(),
    setStatus: vi.fn(),
    setWidget: vi.fn(),
    notify: vi.fn(),
    select: vi.fn(),
  };
  const ctx = {
    ui,
    hasUI: true,
    cwd,
    sessionManager: {},
    modelRegistry: {},
    model: undefined,
    isIdle: vi.fn(() => true),
    signal: undefined,
    abort: vi.fn(),
    hasPendingMessages: vi.fn(() => false),
    shutdown: vi.fn(),
    getContextUsage: vi.fn(() => undefined),
    compact: vi.fn(),
    getSystemPrompt: vi.fn(() => ""),
  } as unknown as ExtensionContext;
  return { ctx, ui };
}

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-company-extension-"));
  tempRoots.add(root);
  return root;
}

function withWorkingDirectory<T>(cwd: string, fn: () => T): T {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return fn();
  } finally {
    process.chdir(previous);
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
