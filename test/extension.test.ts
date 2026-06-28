import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
  readAgentRuntime,
  registerAgent,
  reportRateLimit,
  requestAgentSpawn,
  resolveGitHead,
  sendCompanyMessage,
  setModelPolicy,
  startTask,
  submitTest,
} from "../src/core/company.js";
import { writeYaml } from "../src/core/io.js";
import { readDeliveryOkfConcept } from "../src/core/okf.js";
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
    expect(commands.some((command) => command.name === "company-pause")).toBe(true);
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

  it("pauses and resumes pi-company guards in the current Pi session", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-session-pause" });
    const { handlers, pi, tools, commands } = fakePi({
      "company-root": root,
      "company-agent": "lead",
      "company-role": "lead",
    });
    const { ctx, ui } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const pause = commands.find((command) => command.name === "company-pause");
    const resume = commands.find((command) => command.name === "company-resume");
    if (!pause || !resume) throw new Error("pause/resume command was not registered");
    const statusTool = tools.find((tool) => tool.name === "company_status");
    if (!statusTool) throw new Error("company_status tool was not registered");

    await pause.handler("", ctx);
    const pausedWrite = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1",
      toolName: "write",
      input: { path: path.join(root, "index.html"), content: "<html></html>" },
    }, ctx);
    const pausedCompanyTool = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-paused-company",
      toolName: "company_status",
      input: {},
    }, ctx);
    const pausedStatusResult = await statusTool.execute("tool-1", {}, undefined, undefined, ctx) as ToolResult;
    const pausedInput = await handlers.input?.({ source: "interactive", text: "ordinary pi steering" }, ctx);
    const pausedPrompt = await handlers.before_agent_start?.({ systemPrompt: "base" }, ctx) as { systemPrompt: string };

    await resume.handler("", ctx);
    const resumedWrite = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-2",
      toolName: "write",
      input: { path: path.join(root, "index.html"), content: "<html></html>" },
    }, ctx);
    const resumedPrompt = await handlers.before_agent_start?.({ systemPrompt: "base" }, ctx);
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(ui.setStatus).toHaveBeenCalledWith("pi-company", "lead/lead paused");
    expect(pausedWrite).toBeUndefined();
    expect(pausedCompanyTool).toMatchObject({ block: true });
    expect(pausedStatusResult.content[0].text).toContain("pi-company is paused");
    expect(pausedInput).toEqual({ action: "continue" });
    expect(pausedPrompt.systemPrompt).toContain("[pi-company paused]");
    expect(pausedPrompt.systemPrompt).toContain("ignore earlier pi-company role instructions");
    expect(pausedPrompt.systemPrompt).not.toContain("[pi-company context]");
    expect(resumedWrite).toMatchObject({ block: true });
    expect(resumedPrompt).toMatchObject({ systemPrompt: expect.stringContaining("[pi-company context]") });
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
    expect(tools.some((tool) => tool.name === "company_create_sprint_contract")).toBe(true);
    expect(tools.some((tool) => tool.name === "company_record_evaluation_finding")).toBe(true);
    expect(tools.some((tool) => tool.name === "company_write_structured_handoff")).toBe(true);
    expect(tools.some((tool) => tool.name === "company_read_delivery_okf")).toBe(true);
    expect(tools.some((tool) => tool.name === "company_write_role_bundle")).toBe(true);
    expect(tools.some((tool) => tool.name === "company_record_consumption_manifest")).toBe(true);
    expect(tools.some((tool) => tool.name === "company_delivery_okf_report")).toBe(true);
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

  it("exposes delivery OKF tools as descriptive context helpers", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-okf-tools" });
    const { tools, pi } = fakePi({
      "company-root": root,
      "company-agent": "lead",
      "company-role": "lead",
    });
    const { ctx } = fakeContext(root);
    companyExtension(pi);
    const contractTool = tools.find((tool) => tool.name === "company_create_sprint_contract");
    const readTool = tools.find((tool) => tool.name === "company_read_delivery_okf");
    const reportTool = tools.find((tool) => tool.name === "company_delivery_okf_report");
    if (!contractTool || !readTool || !reportTool) throw new Error("OKF tools were not registered");

    const created = await contractTool.execute("tool-1", {
      contract_id: "extension-contract",
      title: "Extension contract",
      owner: "lead",
      scope: "Preserve descriptive delivery context.",
      done_criteria: ["contract can be read back"],
    }, undefined, undefined, ctx) as ToolResult;
    const readBack = await readTool.execute("tool-2", { kind: "contract", id: "extension-contract" }, undefined, undefined, ctx) as ToolResult;

    const report = await reportTool.execute("tool-3", { contract_id: "extension-contract" }, undefined, undefined, ctx) as ToolResult;

    expect(created.content[0].text).toContain("Wrote SprintContract extension-contract");
    expect(readBack.content[0].text).toContain("Runtime authority boundary");
    expect(report.content[0].text).toContain("Missing required role bundle: product_quality_bar");
    expect(readDeliveryOkfConcept(root, "contract", "extension-contract")?.frontmatter.type).toBe("SprintContract");
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
    expect(readAgentRuntime(root, "tester")?.status).toBe("offline");
  });

  it("records runtime busy and idle state around provider requests without durable heartbeat spam", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-runtime-provider-state" });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "tester",
      "company-role": "tester",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    await handlers.before_provider_request?.({}, ctx);
    expect(readAgentRuntime(root, "tester")?.status).toBe("busy");
    await handlers.after_provider_response?.({ status: 200, headers: {} }, ctx);
    await handlers.session_shutdown?.({}, ctx);

    expect(readAgentRuntime(root, "tester")?.status).toBe("offline");
    const heartbeatEvents = fs.readFileSync(companyPaths(root).events, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.includes('"agent.heartbeat"'));
    expect(heartbeatEvents).toHaveLength(0);
  });

  it("registers a lead lifecycle maintenance tool", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-maintenance-tool" });
    await withFakeCmux({
      callerSurface: "surface:lead",
      surfaces: [
        { ref: "surface:lead", title: "pi-company lead", screen: `${root}\npi-company extension-maintenance-tool | lead (lead)\n` },
      ],
      logPath: path.join(root, "cmux.log"),
    }, async () => {
      const { handlers, pi, tools } = fakePi({
        "company-root": root,
        "company-agent": "lead",
        "company-role": "lead",
      });
      const { ctx } = fakeContext(root);

      companyExtension(pi);
      await handlers.session_start?.({}, ctx);
      const tool = tools.find((item) => item.name === "company_maintain");
      expect(tool).toBeTruthy();
      const result = await tool?.execute("tool-1", {}, undefined, undefined, ctx) as ToolResult;
      await handlers.session_shutdown?.({}, ctx);

      expect(result.content[0].text).toContain("Maintenance checked");
      expect(result.details.maintenance).toMatchObject({
        actions: [expect.objectContaining({ type: "snapshot", agent: "lead", cmux_surface: "surface:lead" })],
      });
    });
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

  it("auto-launches an offline worker for immediate lead messages", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-message-offline-warning" });
    const cmuxLog = path.join(root, "cmux.log");
    const results: ToolResult[] = [];

    await withFakeCmux({
      callerSurface: "surface:lead",
      surfaces: [
        { ref: "surface:lead", title: "pi-company lead", screen: `${root}\npi-company extension-message-offline-warning | lead (lead)\n` },
      ],
      logPath: cmuxLog,
    }, async () => {
      const { handlers, pi, tools } = fakePi({
        "company-root": root,
        "company-agent": "lead",
        "company-role": "lead",
      });
      const { ctx } = fakeContext(root);

      companyExtension(pi);
      await handlers.session_start?.({}, ctx);
      const messageTool = tools.find((tool) => tool.name === "company_send_message");
      if (!messageTool) throw new Error("company_send_message tool was not registered");
      results.push(await messageTool.execute("tool-1", {
        to: "pm",
        type: "assignment",
        text: "Shape acceptance criteria.",
        priority: "high",
      }, undefined, undefined, ctx) as ToolResult);
      await handlers.session_shutdown?.({}, ctx);
    });

    const result = results[0];
    if (!result) throw new Error("message result missing");
    expect(result.content[0].text).toContain("Auto-launched pm in surface:new");
    expect(result.details.recipient_status).toBe("planned");
    expect(result.details.cmux).toBe("surface:new");
    expect(fs.readFileSync(cmuxLog, "utf8")).toContain("--json new-pane");
    expect(loadState(root).inbox_counts.pm).toBe(1);
    expect(listInbox(root, "pm")[0].from).toBe("lead");
  });

  it("does not mark a cmux launch successful when the new terminal never becomes readable", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-cmux-launch-health" });
    const cmuxLog = path.join(root, "cmux.log");

    await withFakeCmux({
      callerSurface: "surface:lead",
      surfaces: [
        { ref: "surface:lead", title: "pi-company lead", screen: `${root}\npi-company extension-cmux-launch-health | lead (lead)\n` },
      ],
      newSurfaceReadable: false,
      logPath: cmuxLog,
    }, async () => {
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
        launch_in_cmux: true,
        force_launch: true,
      }, undefined, undefined, ctx) as ToolResult;
      await handlers.session_shutdown?.({}, ctx);

      expect(result.details.cmux).toBeNull();
      expect(loadState(root).agents.pm.cmux_surface ?? null).toBeNull();
      const log = fs.readFileSync(cmuxLog, "utf8");
      expect(log).toContain("new-pane");
      expect(log).toContain("read-screen --surface surface:new");
      expect(log).toContain("close-surface --surface surface:new");
    });
  }, 20_000);

  it("reuses an existing live cmux surface instead of opening a duplicate agent pane", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-reuse-live-surface" });
    const cmuxLog = path.join(root, "cmux.log");

    await withFakeCmux({
      callerSurface: "surface:lead",
      surfaces: [
        { ref: "surface:lead", title: "pi-company lead", screen: `${root}\npi-company extension-reuse-live-surface | lead (lead)\n` },
        { ref: "surface:pm", title: "pi-company pm", screen: "pi-company\nextension-reuse-live-surface |\np\nm (pm)\n" },
      ],
      logPath: cmuxLog,
    }, async () => {
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
        launch_in_cmux: true,
        force_launch: true,
      }, undefined, undefined, ctx) as ToolResult;
      await handlers.session_shutdown?.({}, ctx);

      expect(result.content[0].text).toContain("Reused live pm in surface:pm");
      expect(result.details.cmux_reused).toBe(true);
      expect(loadState(root).agents.pm.cmux_surface).toBe("surface:pm");
      expect(loadState(root).agents.lead.cmux_surface).toBe("surface:lead");
      expect(fs.readFileSync(cmuxLog, "utf8")).not.toContain("new-pane");
    });
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
    expect(state.agents.coder.cwd).toBe(root);
    expect(state.agents.coder.worktree).toBeNull();
    expect(state.agents.coder.branch).toBeNull();
    expect(result.details.command).toContain(`cd '${root}'`);
    expect(result.details.command).not.toContain(".pi-company/worktrees/coder");
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

  it("includes full gate evidence details in PR gate output", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-pr-gate-evidence-details" });
    const coderPlan = requestAgentSpawn(root, "lead", "coder", "coder", "Implement the feature.");
    registerAgent(root, {
      ...coderPlan,
      status: "online",
    });
    const testerPlan = requestAgentSpawn(root, "lead", "tester", "tester-gate", "Validate the feature.");
    registerAgent(root, {
      ...testerPlan,
      status: "online",
    });
    const pr = createPr(root, "coder", {
      title: "Gate evidence details",
      issue_id: null,
      summary: "Feature summary.",
      branch: coderPlan.branch ?? "pi-company/coder",
      worktree: coderPlan.worktree ?? root,
      base: "main",
    });
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate feature behavior.");
    submitTest(root, "tester-gate", pr.id, "pass", "Runtime smoke passed, but websocket reconnect was not exercised.", {
      clean: false,
      caveats: ["WebSocket reconnect path was not exercised in this run."],
    });
    const { handlers, pi, tools } = fakePi({
      "company-root": root,
      "company-agent": "lead",
      "company-role": "lead",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const gatesTool = tools.find((tool) => tool.name === "company_pr_gates");
    if (!gatesTool) throw new Error("company_pr_gates tool was not registered");
    const result = await gatesTool.execute("tool-1", { pr_id: pr.id }, undefined, undefined, ctx) as ToolResult;
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(result.content[0].text).toContain("Tester pass contains caveat");
    expect(result.content[0].text).toContain("Gate evidence:");
    expect(result.content[0].text).toContain("WebSocket reconnect path was not exercised in this run.");
    expect(result.content[0].text).toContain("Runtime smoke passed, but websocket reconnect was not exercised.");
  });

  it("pins Pi tool review evidence to the declared head instead of the live branch tip", async () => {
    const root = tempRoot();
    initGitRepo(root);
    initCompany({ root, id: "extension-review-head-pin" });
    const coderPlan = requestAgentSpawn(root, "lead", "coder", "coder", "Implement the feature.");
    registerAgent(root, { ...coderPlan, status: "online" });
    const reviewerPlan = requestAgentSpawn(root, "lead", "reviewer", "reviewer-head-pin", "Review the feature.");
    registerAgent(root, { ...reviewerPlan, status: "online" });

    const branch = coderPlan.branch ?? "pi-company/coder";
    runGit(root, ["checkout", "-b", branch]);
    commitFile(root, "feature.txt", "first\n", "feature first");
    const reviewedHead = resolveGitHead(root, branch);
    runGit(root, ["checkout", "main"]);
    const pr = createPr(root, "coder", {
      title: "Head pin feature",
      issue_id: null,
      summary: "Feature summary.",
      branch,
      worktree: coderPlan.worktree ?? root,
      base: "main",
    });
    markPrReady(root, "coder", pr.id, "Self-test passed.", "Validate feature behavior.");

    runGit(root, ["checkout", branch]);
    commitFile(root, "feature.txt", "second\n", "feature second");
    const liveHead = resolveGitHead(root, branch);
    runGit(root, ["checkout", "main"]);
    expect(liveHead).not.toBe(reviewedHead);

    const { handlers, pi, tools } = fakePi({
      "company-root": root,
      "company-agent": "reviewer-head-pin",
      "company-role": "reviewer",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const reviewTool = tools.find((tool) => tool.name === "company_submit_review");
    if (!reviewTool) throw new Error("company_submit_review tool was not registered");
    await reviewTool.execute("tool-1", {
      pr_id: pr.id,
      decision: "approve",
      summary: "Approved the inspected commit.",
      head: reviewedHead,
    }, undefined, undefined, ctx);
    await handlers.session_shutdown?.({}, ctx);

    const review = loadState(root).prs[pr.id].reviews.at(-1);
    expect(review?.head).toBe(reviewedHead);
    expect(review?.head).not.toBe(liveHead);
  });

  it("lets lead abandon a superseded PR through the Pi tool", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-abandon-pr" });
    const coderPlan = requestAgentSpawn(root, "lead", "coder", "coder", "Implement the feature.");
    registerAgent(root, {
      ...coderPlan,
      status: "online",
    });
    const pr = createPr(root, "coder", {
      title: "Superseded feature",
      issue_id: null,
      summary: "Feature summary.",
      branch: coderPlan.branch ?? "pi-company/coder",
      worktree: coderPlan.worktree ?? root,
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
    const abandonTool = tools.find((tool) => tool.name === "company_abandon_pr");
    if (!abandonTool) throw new Error("company_abandon_pr tool was not registered");
    const result = await abandonTool.execute("tool-1", {
      pr_id: pr.id,
      reason: "Superseded by later integrated PR on the same branch.",
      superseded_by: "PR-999",
    }, undefined, undefined, ctx) as ToolResult;
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(result.content[0].text).toContain(`${pr.id} abandoned`);
    expect(loadState(root).prs[pr.id]).toMatchObject({
      status: "abandoned",
      superseded_by: "PR-999",
    });
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

  it("does not reuse a stale agent mission when briefing current assigned work", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-launch-briefing-current-work" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-webui", "Old mission that has already been completed.");
    registerAgent(root, {
      ...plan,
      name: "coder-webui",
      role: "coder",
      cwd: path.join(root, ".pi-company", "worktrees", "coder-webui"),
      worktree: path.join(root, ".pi-company", "worktrees", "coder-webui"),
      branch: "pi-company/coder-webui",
      mission: "Old mission that has already been completed.",
      status: "offline",
    });
    const issue = createIssue(root, "lead", "Fix production start flow", "Acceptance criteria.");
    assignIssue(root, "lead", issue.id, "coder-webui");
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
      name: "coder-webui",
      launch_in_cmux: false,
    }, undefined, undefined, ctx) as ToolResult;
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    const briefing = result.details.briefing as { text?: string } | null | undefined;
    const briefingText = String(briefing?.text ?? "");
    expect(briefingText).toContain(`${issue.id} assigned: Fix production start flow`);
    expect(briefingText).toContain("(use the assigned work below)");
    expect(briefingText).not.toContain("Old mission that has already been completed.");
  });

  it("configures role model policy through Pi UI model choices", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-model-policy" });
    setModelPolicy(root, "lead", "defaults", null, {
      provider: "xiaomi-token-plan-cn",
      model: "mimo-v2.5-pro",
      thinking: "high",
    });
    setModelPolicy(root, "lead", "role", "coder", {
      provider: "openai-codex",
      model: "gpt-5.4-mini",
      thinking: "medium",
    });
    const docsCoder = requestAgentSpawn(root, "lead", "coder", "coder-docs", "Docs coder.");
    registerAgent(root, {
      ...docsCoder,
      status: "online",
    });
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
      .mockResolvedValueOnce("Role default: coder [current: openai-codex/gpt-5.4-mini:medium]")
      .mockResolvedValueOnce("openai-codex/gpt-5.4-mini context:272K thinking:yes")
      .mockResolvedValueOnce("low")
      .mockResolvedValueOnce("Done");

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const tool = tools.find((tool) => tool.name === "company_configure_model_policy");
    if (!tool) throw new Error("company_configure_model_policy tool was not registered");
    const result = await tool.execute("tool-1", {}, undefined, undefined, ctx) as ToolResult;
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    const targetOptions = ui.select.mock.calls[0]?.[1] as string[] | undefined;
    expect(targetOptions).toContain("Default model (future and unconfigured roles) [current: xiaomi-token-plan-cn/mimo-v2.5-pro:high]");
    expect(targetOptions).toContain("Global fallback 1 [current: not configured]");
    expect(targetOptions).toContain("Role default: coder [current: openai-codex/gpt-5.4-mini:medium]");
    expect(targetOptions).toContain("Role default: tester [current: inherits default xiaomi-token-plan-cn/mimo-v2.5-pro:high]");
    expect(targetOptions).not.toContain("Agent: coder-docs");
    expect(targetOptions?.some((option) => option.startsWith("Agent:"))).toBe(false);
    expect(ui.select.mock.calls[1]?.[0]).toBe("Choose Pi model for Role default: coder (current: openai-codex/gpt-5.4-mini:medium):");
    expect(result.content[0].text).toContain("Configured Role default: coder to openai-codex/gpt-5.4-mini:low.");
    expect(loadConfig(root)?.model_policy?.roles?.coder).toEqual({
      provider: "openai-codex",
      model: "gpt-5.4-mini",
      thinking: "low",
    });
  });

  it("configures global fallback models through Pi UI model choices", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-model-fallback-policy" });
    const { handlers, pi, tools } = fakePi({
      "company-root": root,
      "company-agent": "lead",
      "company-role": "lead",
    });
    const { ctx, ui } = fakeContext(root);
    ctx.modelRegistry = {
      getAvailable: vi.fn(() => [
        {
          provider: "xiaomi-token-plan-cn",
          id: "mimo-v2.5-pro",
          name: "mimo-v2.5-pro",
          reasoning: true,
          contextWindow: 1000000,
        },
      ]),
    } as never;
    ui.select
      .mockResolvedValueOnce("Global fallback 1 [current: not configured]")
      .mockResolvedValueOnce("xiaomi-token-plan-cn/mimo-v2.5-pro context:1M thinking:yes")
      .mockResolvedValueOnce("high")
      .mockResolvedValueOnce("Done");

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const tool = tools.find((tool) => tool.name === "company_configure_model_policy");
    if (!tool) throw new Error("company_configure_model_policy tool was not registered");
    const result = await tool.execute("tool-1", {}, undefined, undefined, ctx) as ToolResult;
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(result.content[0].text).toContain("Configured Global fallback 1 to xiaomi-token-plan-cn/mimo-v2.5-pro:high.");
    expect(loadConfig(root)?.model_policy?.fallbacks).toEqual([
      {
        provider: "xiaomi-token-plan-cn",
        model: "mimo-v2.5-pro",
        thinking: "high",
      },
    ]);
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

  it("backs off repeated automatic inbox delivery after Pi rejects a busy follow-up", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-busy-backoff-delivery" });
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
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    await handlers.session_start?.({}, ctx);
    await handlers.session_shutdown?.({}, ctx);

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(listInbox(root, "tester")).toHaveLength(1);
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
    const docRead = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-0a",
      toolName: "read",
      input: { path: path.join(root, "README.md") },
    }, ctx);
    const sourceRead = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-0b",
      toolName: "read",
      input: { path: path.join(root, "src", "App.tsx") },
    }, ctx);
    const worktreeSourceRead = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-0c",
      toolName: "read",
      input: { path: path.join(root, ".pi-company", "worktrees", "coder", "src", "App.tsx") },
    }, ctx);
    const writeResult = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1",
      toolName: "write",
      input: { path: path.join(root, "index.html"), content: "<html></html>" },
    }, ctx);
    const governanceDoc = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1b",
      toolName: "write",
      input: { path: path.join(root, "AGENTS.md"), content: "## Agent skills" },
    }, ctx);
    const docsBash = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1c",
      toolName: "bash",
      input: { command: "mkdir -p docs/agents && tee docs/agents/issue-tracker.md <<'EOF'\n# Issue Tracker\nEOF" },
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
    const runtimeRestart = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-5",
      toolName: "bash",
      input: { command: "lsof -ti:3001 | xargs kill -9 2>/dev/null; sleep 1; cd app && nohup node dist/index.js > /tmp/pi-company-app.log 2>&1 & sleep 2; curl -s http://localhost:3001/api/health" },
    }, ctx);
    const cleanBuildArtifacts = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-5b",
      toolName: "bash",
      input: { command: "cd app && rm -rf dist client/dist && npm run build" },
    }, ctx);
    const sourceRedirect = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-6",
      toolName: "bash",
      input: { command: "echo '<html></html>' > index.html" },
    }, ctx);
    const heredocRedirect = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-7",
      toolName: "bash",
      input: { command: "cat > index.html <<'EOF'\n<html></html>\nEOF" },
    }, ctx);
    const tempHandoffWrite = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-8",
      toolName: "write",
      input: { path: path.join(os.tmpdir(), "her-handoff.md"), content: "# Handoff\n" },
    }, ctx);
    const tempHandoffBash = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-9",
      toolName: "bash",
      input: { command: `cat > ${path.join(os.tmpdir(), "her-handoff.txt")} <<'EOF'\nHandoff\nEOF` },
    }, ctx);
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(docRead).toBeUndefined();
    expect(sourceRead).toMatchObject({ block: true });
    expect(worktreeSourceRead).toMatchObject({ block: true });
    expect(writeResult).toMatchObject({ block: true });
    expect(governanceDoc).toBeUndefined();
    expect(docsBash).toBeUndefined();
    expect(editResult).toMatchObject({ block: true });
    expect(bashResult).toMatchObject({ block: true });
    expect(readOnlyBash).toBeUndefined();
    expect(runtimeRestart).toBeUndefined();
    expect(cleanBuildArtifacts).toBeUndefined();
    expect(sourceRedirect).toMatchObject({ block: true });
    expect(heredocRedirect).toMatchObject({ block: true });
    expect(tempHandoffWrite).toBeUndefined();
    expect(tempHandoffBash).toBeUndefined();
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

  it("allows PM product and setup docs but blocks runnable PM writes", async () => {
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
      input: { path: "PRD.md", content: "# Product" },
    }, ctx);
    const docsMkdir = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1b",
      toolName: "bash",
      input: { command: "mkdir -p docs/agents && cat > docs/agents/domain.md <<'EOF'\n# Domain\nEOF" },
    }, ctx);
    const governanceDoc = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1c",
      toolName: "write",
      input: { path: "AGENTS.md", content: "## Agent skills" },
    }, ctx);
    const implementation = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-2",
      toolName: "write",
      input: { path: path.join(root, "index.html"), content: "<html></html>" },
    }, ctx);
    const configWrite = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-2b",
      toolName: "write",
      input: { path: path.join(root, "package.json"), content: "{}" },
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
    expect(governanceDoc).toBeUndefined();
    expect(implementation).toMatchObject({ block: true });
    expect(String((implementation as { reason?: string } | undefined)?.reason)).toContain("looks runnable or behavior-changing");
    expect(configWrite).toMatchObject({ block: true });
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
      input: { command: "mkdir -p docs/design && printf '# Design\\n' > docs/design/homepage.md" },
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
    expect(String((cssWrite as { reason?: string } | undefined)?.reason)).toContain("looks runnable or behavior-changing");
  });

  it("allows non-coder role-owned markdown evidence without making coder the document secretary", async () => {
    const cases = [
      { agent: "tester", role: "tester", path: "docs/test/report.md" },
      { agent: "reviewer", role: "reviewer", path: "docs/review/PR-001.md" },
      { agent: "researcher", role: "researcher", path: "docs/research/options.md" },
    ];

    for (const item of cases) {
      const root = tempRoot();
      initCompany({ root, id: `extension-${item.role}-docs` });
      const { handlers, pi } = fakePi({
        "company-root": root,
        "company-agent": item.agent,
        "company-role": item.role,
      });
      const { ctx } = fakeContext(root);

      companyExtension(pi);
      await handlers.session_start?.({}, ctx);
      const docWrite = await handlers.tool_call?.({
        type: "tool_call",
        toolCallId: "tool-1",
        toolName: "write",
        input: { path: item.path, content: "# Evidence" },
      }, ctx);
      const srcWrite = await handlers.tool_call?.({
        type: "tool_call",
        toolCallId: "tool-2",
        toolName: "write",
        input: { path: "src/generated.ts", content: "export {};" },
      }, ctx);
      await handlers.session_shutdown?.({ reason: "quit" }, ctx);

      expect(docWrite).toBeUndefined();
      expect(srcWrite).toMatchObject({ block: true });
    }
  });

  it("allows testers to clean generated artifacts for validation but not source files", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-tester-clean-artifacts" });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "tester",
      "company-role": "tester",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const cleanBuild = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1",
      toolName: "bash",
      input: { command: "cd app && rm -rf dist client/dist coverage && npm run build" },
    }, ctx);
    const absoluteWorktreeClean = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-2",
      toolName: "bash",
      input: { command: `rm -rf ${path.join(root, ".pi-company", "worktrees", "coder", "dist")}` },
    }, ctx);
    const sourceDelete = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-3",
      toolName: "bash",
      input: { command: "rm -rf src package.json" },
    }, ctx);
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(cleanBuild).toBeUndefined();
    expect(absoluteWorktreeClean).toBeUndefined();
    expect(sourceDelete).toMatchObject({ block: true });
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
    const insideDevNullBash = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1b",
      toolName: "bash",
      input: { command: "mkdir -p site 2>/dev/null && touch site/index.html" },
    }, ctx);
    const readDevNullBash = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1c",
      toolName: "bash",
      input: { command: "cat package.json 2>/dev/null || true" },
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
    const tempHandoffBash = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-4",
      toolName: "bash",
      input: { command: `cat > ${path.join(os.tmpdir(), "coder-handoff.md")} <<'EOF'\n# Handoff\nEOF` },
    }, ctx);
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(insideBash).toBeUndefined();
    expect(insideDevNullBash).toBeUndefined();
    expect(readDevNullBash).toBeUndefined();
    expect(outsideBash).toMatchObject({ block: true });
    expect(parentBash).toMatchObject({ block: true });
    expect(tempHandoffBash).toBeUndefined();
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
    const tempHandoffWrite = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-4",
      toolName: "write",
      input: { path: path.join(os.tmpdir(), "coder-handoff.md"), content: "# Handoff\n" },
    }, ctx);
    const tempCodeWrite = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-5",
      toolName: "write",
      input: { path: path.join(os.tmpdir(), "coder-output.js"), content: "console.log('nope')\n" },
    }, ctx);
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(insideWrite).toBeUndefined();
    expect(outsideWrite).toMatchObject({ block: true });
    expect(outsideEdit).toMatchObject({ block: true });
    expect(tempHandoffWrite).toBeUndefined();
    expect(tempCodeWrite).toMatchObject({ block: true });
  });

  it("allows root-scoped coder cleanup while protecting control paths", async () => {
    const root = tempRoot();
    initCompany({ root, id: "extension-root-scoped-coder-guard" });
    const plan = requestAgentSpawn(root, "lead", "coder", "coder-root", "Clean root-level blockers.", {
      useCoderWorktree: false,
    });
    registerAgent(root, {
      ...plan,
      status: "online",
    });
    const { handlers, pi } = fakePi({
      "company-root": root,
      "company-agent": "coder-root",
      "company-role": "coder",
    });
    const { ctx } = fakeContext(root);

    companyExtension(pi);
    await handlers.session_start?.({}, ctx);
    const rootCleanup = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-1",
      toolName: "bash",
      input: { command: "rm -rf docs/product docs/design/secbrain-v0.3-chat-first.md" },
    }, ctx);
    const controlCleanup = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-2",
      toolName: "bash",
      input: { command: "rm -rf .pi-company" },
    }, ctx);
    const gitMutation = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-3",
      toolName: "bash",
      input: { command: "git add -A" },
    }, ctx);
    const outsideCleanup = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-4",
      toolName: "bash",
      input: { command: "rm -rf ../outside-project" },
    }, ctx);
    const controlWrite = await handlers.tool_call?.({
      type: "tool_call",
      toolCallId: "tool-5",
      toolName: "write",
      input: { path: path.join(root, ".pi-company", "state.json"), content: "{}\n" },
    }, ctx);
    await handlers.session_shutdown?.({ reason: "quit" }, ctx);

    expect(rootCleanup).toBeUndefined();
    expect(controlCleanup).toMatchObject({ block: true });
    expect(gitMutation).toMatchObject({ block: true });
    expect(outsideCleanup).toMatchObject({ block: true });
    expect(controlWrite).toMatchObject({ block: true });
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

      for (let index = 0; index < 8; index += 1) {
        await vi.advanceTimersByTimeAsync(30_000);
      }
      await vi.advanceTimersByTimeAsync(5_000);
      await request;

      expect(providerQueueSnapshot(root, "openai-codex").leases.map((lease) => lease.agent)).toEqual(["tester"]);
      await handlers.session_shutdown?.({}, ctx);
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);

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

function initGitRepo(root: string): void {
  runGit(root, ["init", "-b", "main"]);
  runGit(root, ["config", "user.email", "pi-company-test@example.local"]);
  runGit(root, ["config", "user.name", "Pi Company Test"]);
  commitFile(root, "README.md", "# Test\n", "initial commit");
}

function commitFile(root: string, relativePath: string, content: string, message: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  runGit(root, ["add", relativePath]);
  runGit(root, ["commit", "-m", message]);
}

function runGit(root: string, args: string[]): void {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

async function withFakeCmux<T>(options: {
  callerSurface: string;
  surfaces: Array<{ ref: string; title: string; screen?: string }>;
  newSurfaceReadable?: boolean;
  logPath: string;
}, fn: () => Promise<T>): Promise<T> {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-company-extension-cmux-"));
  tempRoots.add(binDir);
  const cmuxPath = path.join(binDir, "cmux");
  const identifyPath = path.join(binDir, "identify.json");
  const treePath = path.join(binDir, "tree.json");
  const tree = {
    windows: [
      {
        ref: "window:1",
        workspaces: [
          {
            ref: "workspace:1",
            panes: [
              {
                ref: "pane:1",
                surfaces: options.surfaces.map((surface) => ({
                  ref: surface.ref,
                  type: "terminal",
                  title: surface.title,
                })),
              },
            ],
          },
        ],
      },
    ],
  };
  fs.writeFileSync(identifyPath, JSON.stringify({
    caller: {
      surface_ref: options.callerSurface,
      surface_type: "terminal",
    },
  }), "utf8");
  fs.writeFileSync(treePath, JSON.stringify(tree), "utf8");
  const screenCases = options.surfaces.map((surface, index) => {
    const screenPath = path.join(binDir, `screen-${index}.txt`);
    fs.writeFileSync(screenPath, surface.screen ?? `${surface.title}\n`, "utf8");
    return `${shellCasePattern(surface.ref)}) cat ${shellSingleQuote(screenPath)}; exit 0 ;;`;
  }).join("\n");
  const newSurfaceScreenPath = path.join(binDir, "screen-new.txt");
  fs.writeFileSync(newSurfaceScreenPath, "pi-company launched surface\n", "utf8");
  const newSurfaceCase = options.newSurfaceReadable === false
    ? ""
    : `${shellCasePattern("surface:new")}) cat ${shellSingleQuote(newSurfaceScreenPath)}; exit 0 ;;`;
  fs.writeFileSync(options.logPath, "", "utf8");
  fs.writeFileSync(cmuxPath, `#!/bin/sh
printf '%s\\n' "$*" >> ${shellSingleQuote(options.logPath)}
if [ "$1" = "identify" ]; then
  cat ${shellSingleQuote(identifyPath)}
  exit 0
fi
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
${newSurfaceCase}
	  esac
	  exit 1
	fi
if [ "$1" = "--json" ] && [ "$2" = "new-pane" ]; then
  printf '{"surface_ref":"surface:new"}\\n'
  exit 0
fi
	if [ "$1" = "send" ]; then
	  exit 0
	fi
	if [ "$1" = "send-key" ]; then
	  exit 0
	fi
	if [ "$1" = "respawn-pane" ]; then
	  exit 0
	fi
	if [ "$1" = "close-surface" ]; then
	  exit 0
	fi
	exit 1
	`, "utf8");
  fs.chmodSync(cmuxPath, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
  try {
    return await fn();
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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
