#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Command } from "commander";
import {
  acknowledgeInbox,
  abandonPr,
  adoptIntegratedPr,
  assignIssue,
  blockTask,
  buildLeadBrief,
  clearRateLimit,
  completeTask,
  createIssue,
  createPr,
  ensureCoderWorktree,
  getPrGateStatus,
  inferIssueWorkType,
  initCompany,
  launchCommand,
  loadState,
  markPrReady,
  mergePr,
  pendingMergeRequests,
  recordHumanSteering,
  reportTask,
  rebuildState,
  recordAutomatedTests,
  recordAgentLaunch,
  planAgentSpawn,
  registerAgent,
  requestAgentSpawn,
  requestMerge,
  rateLimitIsActive,
  reportRateLimit,
  sendCompanyMessage,
  renderLeadBrief,
  startTask,
  syncRenderedRecords,
  submitAcceptance,
  submitReview,
  submitTest,
  listInbox,
} from "./core/company.js";
import { parseCmuxSurfaceRef } from "./core/cmux.js";
import type { IssueWorkType } from "./core/types.js";
import { companyPaths } from "./core/paths.js";
import { classifyRateLimitText } from "./core/rate-limit.js";
import type { MailboxMessage } from "./core/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = __dirname.endsWith(`${path.sep}dist${path.sep}src`)
  ? path.resolve(__dirname, "../..")
  : path.resolve(__dirname, "..");
const builtExtensionPath = path.join(packageRoot, "dist", "extensions", "company.js");
const sourceExtensionPath = path.join(packageRoot, "extensions", "company.ts");
const extensionPath = fs.existsSync(builtExtensionPath) ? builtExtensionPath : sourceExtensionPath;
const packageVersion = readPackageVersion(packageRoot);

const program = new Command();

program
  .name("pi-company")
  .description("Pi-native agent company runtime")
  .version(packageVersion);

program.option("--root <path>", "Project root", process.cwd());

program.command("init")
  .description("Initialize .pi-company in the current project")
  .option("--id <id>", "Company id")
  .option("--name <name>", "Company display name")
  .action((opts) => {
    const root = rootOpt();
    const state = initCompany({ root, id: opts.id, name: opts.name });
    console.log(`Initialized pi-company ${state.config?.id} at ${companyPaths(root).dir}`);
  });

program.command("status")
  .description("Show company status")
  .action(() => {
    const state = loadState(rootOpt());
    printStatus(rootOpt(), state);
  });

program.command("brief")
  .description("Show lead's authoritative global delivery brief")
  .action(() => {
    console.log(renderLeadBrief(buildLeadBrief(rootOpt())));
  });

program.command("reduce")
  .description("Rebuild state.json and rendered issue/PR snapshots from events.jsonl")
  .action(() => {
    const root = rootOpt();
    const state = rebuildState(root);
    syncRenderedRecords(root, state);
    console.log(`Rebuilt state at ${state.updated_at ?? "empty"}`);
  });

program.command("launch-command")
  .description("Print the command to launch an agent manually")
  .argument("<agent>")
  .action((agent) => {
    console.log(launchCommand(rootOpt(), agent, extensionPath));
  });

program.command("spawn")
  .description("Plan or launch an agent")
  .argument("<role>")
  .option("--name <name>", "Agent name")
  .option("--mission <mission>", "Agent mission")
  .option("--mission-file <path>", "Read agent mission from a file")
  .option("--mission-stdin", "Read agent mission from stdin")
  .option("--yes", "Allow creating git worktrees")
  .option("--cmux", "Launch in cmux if cmux is available")
  .option("--manual", "Only print launch command")
  .option("--force-role", "Allow spawning a custom role without an existing .pi-company/roles/<role>.md file")
  .action((role, opts) => {
    const root = rootOpt();
    const name = opts.name ?? defaultNameForRole(role);
    const mission = readTextOption(opts.mission, opts.missionFile, opts.missionStdin === true, "mission", false);
    const existing = loadState(root).agents[name];
    if (existing) {
      if (existing.role !== role) {
        throw new Error(`Agent ${name} already exists as role ${existing.role}, not ${role}.`);
      }
      if ((existing.role === "coder" || existing.name.startsWith("coder")) && existing.worktree && existing.branch && !fs.existsSync(existing.worktree)) {
        ensureCoderWorktree(root, { worktree: existing.worktree, branch: existing.branch }, opts.yes === true);
      }
      const cmd = launchCommand(root, name, extensionPath);
      if (opts.manual || !opts.cmux) {
        console.log(cmd);
        return;
      }
      launchInCmux(root, currentLead(root), name, cmd);
      return;
    }
    const plan = planAgentSpawn(root, role, name, mission, { allowUnknownRole: opts.forceRole === true });
    if (role === "coder") {
      ensureCoderWorktree(root, plan, opts.yes === true);
    }
    requestAgentSpawn(root, "lead", role, name, mission, { allowUnknownRole: opts.forceRole === true });
    registerAgent(root, {
      name: plan.name,
      role: plan.role,
      cwd: plan.cwd,
      worktree: plan.worktree,
      branch: plan.branch,
      mission: plan.mission,
      status: "planned",
    });

    const cmd = launchCommand(root, name, extensionPath);
    if (opts.manual || !opts.cmux) {
      console.log(cmd);
      return;
    }
    launchInCmux(root, currentLead(root), name, cmd);
  });

program.command("steer")
  .description("Record human steering for an agent and mirror it to lead")
  .requiredOption("--agent <agent>")
  .option("--text <text>")
  .option("--text-file <path>", "Read steering text from a file")
  .option("--text-stdin", "Read steering text from stdin")
  .option("--streaming <mode>", "steer | followUp")
  .action((opts) => {
    const text = readTextOption(opts.text, opts.textFile, opts.textStdin === true, "text", true) ?? "";
    const mirror = recordHumanSteering(rootOpt(), opts.agent, text, opts.streaming ?? null);
    console.log(mirror ? `Mirrored to ${mirror.to}: ${mirror.id}` : `Recorded steering for ${opts.agent}`);
  });

program.command("inbox")
  .description("Show or acknowledge mailbox messages")
  .requiredOption("--agent <agent>")
  .option("--all", "Include delivered messages")
  .option("--ack", "Acknowledge currently unread messages")
  .action((opts) => {
    const messages = listInbox(rootOpt(), opts.agent, opts.all === true);
    if (opts.ack) {
      acknowledgeInbox(rootOpt(), opts.agent, messages.map((message) => message.id));
      console.log(`Acknowledged ${messages.length} message(s) for ${opts.agent}`);
      return;
    }
    printMessages(messages);
  });

const issue = program.command("issue").description("Manage local issues");

issue.command("create")
  .argument("<title>")
  .option("--body <body>", "Issue body", "")
  .option("--work-type <type>", "product|design|implementation|test|review|research")
  .option("--actor <agent>", "Actor", "lead")
  .action((title, opts) => {
    const workType = validateWorkType(opts.workType ?? inferIssueWorkType(title, opts.body));
    const created = createIssue(rootOpt(), opts.actor, title, opts.body, { work_type: workType });
    console.log(`${created.id}: ${created.title}`);
  });

issue.command("assign")
  .argument("<issue-id>")
  .argument("<owner>")
  .option("--actor <agent>", "Actor", "lead")
  .action((issueId, owner, opts) => {
    assignIssue(rootOpt(), opts.actor, issueId, owner);
    console.log(`Assigned ${issueId} to ${owner}`);
  });

const task = program.command("task").description("Record task progress");

task.command("start")
  .argument("<issue-id>")
  .requiredOption("--actor <agent>")
  .option("--note <text>")
  .action((issueId, opts) => {
    startTask(rootOpt(), opts.actor, issueId, opts.note ?? null);
    console.log(`${opts.actor} started ${issueId}`);
  });

task.command("report")
  .argument("<issue-id>")
  .requiredOption("--actor <agent>")
  .requiredOption("--note <text>")
  .action((issueId, opts) => {
    reportTask(rootOpt(), opts.actor, issueId, opts.note);
    console.log(`${opts.actor} reported on ${issueId}`);
  });

task.command("block")
  .argument("<issue-id>")
  .requiredOption("--actor <agent>")
  .requiredOption("--reason <text>")
  .action((issueId, opts) => {
    blockTask(rootOpt(), opts.actor, issueId, opts.reason);
    console.log(`${opts.actor} blocked ${issueId}`);
  });

task.command("complete")
  .argument("<issue-id>")
  .requiredOption("--actor <agent>")
  .requiredOption("--summary <text>")
  .action((issueId, opts) => {
    completeTask(rootOpt(), opts.actor, issueId, opts.summary);
    console.log(`${opts.actor} completed ${issueId}`);
  });

const pr = program.command("pr").description("Manage local PRs");

pr.command("create")
  .requiredOption("--title <title>")
  .requiredOption("--author <agent>")
  .requiredOption("--branch <branch>")
  .requiredOption("--worktree <path>")
  .option("--summary <summary>", "Summary", "")
  .option("--issue <id>", "Issue id")
  .option("--base <branch>", "Base branch", "main")
  .action((opts) => {
    const created = createPr(rootOpt(), opts.author, {
      title: opts.title,
      issue_id: opts.issue ?? null,
      summary: opts.summary,
      branch: opts.branch,
      worktree: path.resolve(opts.worktree),
      base: opts.base,
    });
    console.log(`${created.id}: ${created.title}`);
  });

pr.command("adopt-integrated")
  .description("Create a gated recovery PR for a commit already present on the base branch")
  .requiredOption("--title <title>")
  .requiredOption("--author <agent>")
  .requiredOption("--branch <branch>")
  .requiredOption("--summary <summary>")
  .option("--issue <id>", "Issue id")
  .option("--actor <agent>", "Actor; defaults to lead", "lead")
  .option("--base <branch>", "Base branch", "main")
  .action((opts) => {
    const created = adoptIntegratedPr(rootOpt(), opts.actor, {
      title: opts.title,
      author: opts.author,
      issue_id: opts.issue ?? null,
      summary: opts.summary,
      branch: opts.branch,
      base: opts.base,
    });
    console.log(`${created.id}: ${created.title}`);
  });

pr.command("abandon")
  .argument("<pr-id>")
  .requiredOption("--actor <agent>")
  .requiredOption("--reason <text>")
  .option("--superseded-by <pr-id>")
  .action((prId, opts) => {
    abandonPr(rootOpt(), opts.actor, prId, opts.reason, opts.supersededBy ?? null);
    console.log(`${prId} abandoned`);
  });

pr.command("ready")
  .argument("<pr-id>")
  .requiredOption("--self-test <text>", "Coder self-test evidence")
  .requiredOption("--test-brief <text>", "Test brief")
  .option("--actor <agent>", "Actor; defaults to PR author")
  .action((prId, opts) => {
    const root = rootOpt();
    markPrReady(root, opts.actor ?? prAuthor(root, prId), prId, opts.selfTest, opts.testBrief);
    console.log(`${prId} marked ready`);
  });

pr.command("review")
  .argument("<pr-id>")
  .requiredOption("--reviewer <agent>")
  .requiredOption("--decision <decision>", "approve | request_changes | comment")
  .requiredOption("--summary <text>")
  .option("--clean", "Mark approval evidence as explicitly clean")
  .option("--caveat <text>", "Structured caveat that blocks green evidence; repeat for multiple caveats", collectOption, [])
  .action((prId, opts) => {
    if (!["approve", "request_changes", "comment"].includes(opts.decision)) {
      throw new Error("decision must be approve, request_changes, or comment");
    }
    submitReview(rootOpt(), opts.reviewer, prId, opts.decision, opts.summary, gateEvidenceOptions(opts));
    console.log(`${opts.reviewer} submitted ${opts.decision} for ${prId}`);
  });

pr.command("test")
  .argument("<pr-id>")
  .requiredOption("--tester <agent>")
  .requiredOption("--status <status>", "pass | fail | blocked")
  .requiredOption("--summary <text>")
  .option("--clean", "Mark passing evidence as explicitly clean")
  .option("--caveat <text>", "Structured caveat that blocks green evidence; repeat for multiple caveats", collectOption, [])
  .action((prId, opts) => {
    if (!["pass", "fail", "blocked"].includes(opts.status)) {
      throw new Error("status must be pass, fail, or blocked");
    }
    submitTest(rootOpt(), opts.tester, prId, opts.status, opts.summary, gateEvidenceOptions(opts));
    console.log(`${opts.tester} submitted test ${opts.status} for ${prId}`);
  });

pr.command("accept")
  .argument("<pr-id>")
  .requiredOption("--actor <agent>", "PM or lead actor")
  .requiredOption("--decision <decision>", "accept | request_changes | comment")
  .requiredOption("--summary <text>")
  .option("--clean", "Mark acceptance evidence as explicitly clean")
  .option("--caveat <text>", "Structured caveat that blocks green evidence; repeat for multiple caveats", collectOption, [])
  .action((prId, opts) => {
    if (!["accept", "request_changes", "comment"].includes(opts.decision)) {
      throw new Error("decision must be accept, request_changes, or comment");
    }
    submitAcceptance(rootOpt(), opts.actor, prId, opts.decision, opts.summary, gateEvidenceOptions(opts));
    console.log(`${opts.actor} submitted product acceptance ${opts.decision} for ${prId}`);
  });

pr.command("auto-test")
  .argument("<pr-id>")
  .requiredOption("--status <status>", "passed | failed | blocked")
  .option("--summary <text>", "Summary", "")
  .option("--command <command>", "Command")
  .option("--actor <agent>", "Actor; defaults to PR author")
  .option("--clean", "Mark passing automated-test evidence as explicitly clean")
  .option("--caveat <text>", "Structured caveat that blocks green evidence; repeat for multiple caveats", collectOption, [])
  .action((prId, opts) => {
    if (!["passed", "failed", "blocked"].includes(opts.status)) {
      throw new Error("status must be passed, failed, or blocked");
    }
    const root = rootOpt();
    recordAutomatedTests(root, opts.actor ?? prAuthor(root, prId), prId, opts.status, opts.summary, opts.command ?? null, gateEvidenceOptions(opts));
    console.log(`Automated tests ${opts.status} for ${prId}`);
  });

pr.command("gates")
  .argument("<pr-id>")
  .action((prId) => {
    const prState = loadState(rootOpt()).prs[prId];
    if (prState?.status === "merged") {
      console.log(`${prId} is already merged`);
      return;
    }
    const gates = getPrGateStatus(rootOpt(), prId);
    if (gates.ready) {
      console.log(`${prId} is ready to merge`);
      return;
    }
    console.log(`${prId} is blocked:`);
    for (const blocker of gates.blockers) console.log(`- ${blocker}`);
    process.exitCode = 1;
  });

pr.command("merge")
  .argument("<pr-id>")
  .option("--actor <agent>", "Actor", "lead")
  .option("--execute", "Run git checkout and git merge after gates pass")
  .action((prId, opts) => {
    if (opts.execute) {
      mergePr(rootOpt(), opts.actor, prId, true);
      console.log(`${prId} merged`);
      return;
    }
    const root = rootOpt();
    const prState = loadState(root).prs[prId];
    if (prState?.status === "merged") {
      console.log(`${prId} is already merged`);
      return;
    }
    const gates = getPrGateStatus(root, prId);
    const state = requestMerge(root, opts.actor, prId);
    if (gates.ready) {
      console.log(`${prId} merge requested`);
      return;
    }
    console.log(`${prId} merge blocked`);
    for (const blocker of gates.blockers) console.log(`- ${blocker}`);
    if (state.prs[prId]) process.exitCode = 1;
  });

program.command("message")
  .description("Send a mailbox message to an agent")
  .requiredOption("--from <agent>")
  .requiredOption("--to <agent>")
  .requiredOption("--type <type>")
  .option("--text <text>")
  .option("--text-file <path>", "Read message text from a file")
  .option("--text-stdin", "Read message text from stdin")
  .option("--priority <priority>", "normal | high | urgent")
  .option("--task <task>")
  .action((opts) => {
    if (!["assignment", "question", "reply", "report", "review", "test", "human_steering", "system"].includes(opts.type)) {
      throw new Error("type must be assignment, question, reply, report, review, test, human_steering, or system");
    }
    if (opts.priority && !["normal", "high", "urgent"].includes(opts.priority)) {
      throw new Error("priority must be normal, high, or urgent");
    }
    const text = readTextOption(opts.text, opts.textFile, opts.textStdin === true, "text", true) ?? "";
    const msg = sendCompanyMessage(rootOpt(), {
      from: opts.from,
      to: opts.to,
      type: opts.type,
      text,
      task: opts.task ?? null,
      priority: opts.priority ?? undefined,
    });
    console.log(`Sent ${msg.id} to ${msg.to} (${msg.wake?.mode ?? "digest"}: ${msg.wake?.reason ?? "no wake metadata"})`);
  });

program.command("rate-limit")
  .description("Report provider 429/quota pressure and pause automatic wakes")
  .requiredOption("--actor <agent>")
  .requiredOption("--reason <text>")
  .option("--kind <kind>", "provider_429 | quota_exhausted | manual", "provider_429")
  .action((opts) => {
    if (!["provider_429", "quota_exhausted", "manual"].includes(opts.kind)) {
      throw new Error("kind must be provider_429, quota_exhausted, or manual");
    }
    const state = reportRateLimit(rootOpt(), opts.actor, opts.reason, opts.kind);
    console.log(`Rate-limit backoff active until ${state.rate_limit?.paused_until ?? "unknown"}`);
    console.log(`Retry after: ${state.rate_limit?.retry_after_ms ?? 0}ms`);
  });

program.command("rate-limit-clear")
  .description("Clear an active or recent rate-limit backoff after human/lead verification")
  .requiredOption("--actor <agent>")
  .requiredOption("--reason <text>")
  .action((opts) => {
    const state = clearRateLimit(rootOpt(), opts.actor, opts.reason);
    console.log(`Rate-limit backoff cleared by ${opts.actor}`);
    console.log(`Current rate-limit: ${state.rate_limit ? state.rate_limit.kind : "none"}`);
  });

program.command("cmux-status")
  .description("Set a cmux sidebar status from current company state")
  .action(() => {
    const state = loadState(rootOpt());
    const agents = Object.values(state.agents).filter((a) => a.status === "online" || a.status === "running").length;
    const blocked = Object.values(state.agents).filter((a) => a.status === "blocked").length;
    const text = `${agents} agents · ${blocked} blocked`;
    const result = spawnSync("cmux", ["set-status", "pi-company", text, "--icon", "sparkle", "--color", "#36F9F6"], {
      encoding: "utf8",
    });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || "cmux set-status failed");
    console.log(text);
  });

program.command("cmux-rate-limit-scan")
  .description("Scan cmux pi-company surfaces for visible 429/quota failures and report backoff")
  .option("--workspace <workspace>", "cmux workspace to scan")
  .option("--window <window>", "cmux window to scan")
  .option("--lines <count>", "screen lines per surface", "80")
  .option("--actor <agent>", "rate-limit reporter", "system")
  .option("--force", "report even while an organization backoff is already active")
  .action((opts) => {
    const root = rootOpt();
    const surfaces = listCmuxPiCompanySurfaces(opts.workspace, opts.window);
    if (surfaces.length === 0) {
      console.log("No cmux pi-company surfaces found");
      return;
    }
    const incidents: Array<{ surface: string; title: string; reason: string; kind: "provider_429" | "quota_exhausted" }> = [];
    let skipped = 0;
    for (const surface of surfaces) {
      const screen = readCmuxSurface(surface.surface, opts.workspace, opts.window, Number(opts.lines) || 80);
      if (screen === null) {
        skipped += 1;
        continue;
      }
      const classification = classifyRateLimitText(screen);
      if (classification) {
        incidents.push({
          ...surface,
          reason: classification.reason,
          kind: classification.kind,
        });
      }
    }
    if (incidents.length === 0) {
      const suffix = skipped > 0 ? ` (${skipped} non-terminal surface(s) skipped)` : "";
      console.log(`No rate-limit signatures found in ${surfaces.length - skipped} pi-company terminal surface(s)${suffix}`);
      return;
    }
    const kind = incidents.some((incident) => incident.kind === "quota_exhausted") ? "quota_exhausted" : "provider_429";
    const reason = incidents
      .map((incident) => `${incident.title || incident.surface}: ${incident.reason}`)
      .join("\n")
      .slice(0, 1000);
    const current = loadState(root);
    if (current.rate_limit?.reason === reason) {
      console.log("Rate-limit signatures unchanged; not reporting duplicate backoff");
      return;
    }
    if (rateLimitIsActive(current) && opts.force !== true) {
      console.log(`Rate-limit backoff already active until ${current.rate_limit?.paused_until ?? "unknown"}; not extending from screen scan`);
      return;
    }
    const state = reportRateLimit(root, opts.actor, reason, kind);
    console.log(`Rate-limit backoff active until ${state.rate_limit?.paused_until ?? "unknown"}`);
    console.log(`Retry after: ${state.rate_limit?.retry_after_ms ?? 0}ms`);
    for (const incident of incidents) {
      console.log(`- ${incident.surface} ${incident.title}: ${incident.kind}`);
    }
    if (skipped > 0) console.log(`Skipped ${skipped} non-terminal pi-company surface(s)`);
  });

process.on("uncaughtException", (error) => {
  console.error(`Error: ${errorMessage(error)}`);
  process.exitCode = 1;
});

process.on("unhandledRejection", (error) => {
  console.error(`Error: ${errorMessage(error)}`);
  process.exitCode = 1;
});

program.parse(process.argv);

function rootOpt(): string {
  return path.resolve(program.opts().root ?? process.cwd());
}

function readPackageVersion(root: string): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function defaultNameForRole(role: string): string {
  if (role === "coder") return "coder";
  return role;
}

function currentLead(root: string): string {
  return loadState(root).config?.lead ?? "lead";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function prAuthor(root: string, prId: string): string {
  const pr = loadState(root).prs[prId];
  if (!pr) throw new Error(`Unknown PR ${prId}`);
  return pr.author;
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function gateEvidenceOptions(opts: { clean?: boolean; caveat?: string[] }): { clean?: boolean; caveats?: string[] } {
  return {
    clean: opts.clean === true ? true : undefined,
    caveats: opts.caveat ?? [],
  };
}

function printStatus(root: string, state: ReturnType<typeof loadState>): void {
  console.log(`Company: ${state.config?.id ?? "not initialized"}`);
  console.log(`Updated: ${state.updated_at ?? "never"}`);
  console.log("");
  console.log("Agents:");
  for (const agent of Object.values(state.agents)) {
    console.log(`- ${agent.name} (${agent.role}) ${agent.status}${agent.current_task ? ` task=${agent.current_task}` : ""}`);
  }
  console.log("");
  console.log("Issues:");
  for (const issue of Object.values(state.issues)) {
    console.log(`- ${issue.id} ${issue.status}${issue.work_type ? ` ${issue.work_type}` : ""} ${issue.title}${issue.owner ? ` -> ${issue.owner}` : ""}`);
  }
  console.log("");
  console.log("PRs:");
  for (const item of Object.values(state.prs)) {
    const pending = item.merge_requested_at && item.status !== "merged" && item.status !== "blocked"
      ? ` pending_merge_since=${item.merge_requested_at}`
      : "";
    const gates = getPrGateStatus(root, item.id);
    const hasCoderReadyEvidence = Boolean(item.self_test?.trim() && item.test_brief?.trim());
    const coderReady = hasCoderReadyEvidence ? " coder_ready=yes" : " coder_ready=no";
    const blockers = item.status === "merged"
      ? " merged"
      : item.status === "abandoned"
        ? ` abandoned${item.superseded_by ? ` superseded_by=${item.superseded_by}` : ""}`
        : gates.ready
          ? " gates=green"
          : ` gate_blockers=${gates.blockers.join("; ") || "unknown"}`;
    console.log(`- ${item.id} ${item.status}${coderReady}${pending} ${blockers} ${item.title}`);
  }
  const pendingMerges = pendingMergeRequests(state);
  if (pendingMerges.length > 0) {
    console.log("");
    console.log("Pending Merges:");
    for (const item of pendingMerges) {
      console.log(`- ${item.id} requested_at=${item.merge_requested_at} author=${item.author} branch=${item.branch}`);
    }
  }
  if (state.rate_limit) {
    const active = rateLimitIsActive(state);
    console.log("");
    console.log(active ? "Rate Limit:" : "Recent Rate Limit:");
    console.log(`- ${active ? "active" : "expired"} ${state.rate_limit.kind} until ${state.rate_limit.paused_until} (${state.rate_limit.retry_after_ms}ms)`);
    console.log(`- reason: ${state.rate_limit.reason}`);
  }
}

function printMessages(messages: MailboxMessage[]): void {
  if (messages.length === 0) {
    console.log("No messages");
    return;
  }
  for (const message of messages) {
    console.log(`${message.id} ${message.ts} ${message.from} -> ${message.to} [${message.type}]`);
    console.log(message.text);
    console.log("");
  }
}

function validateWorkType(value: unknown): IssueWorkType | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  if (["product", "design", "implementation", "test", "review", "research"].includes(text)) return text as IssueWorkType;
  throw new Error(`Invalid work type ${text}. Expected product, design, implementation, test, review, or research.`);
}

function launchInCmux(root: string, actor: string, agentName: string, command: string): void {
  const pane = spawnSync("cmux", ["--json", "new-pane", "--type", "terminal", "--direction", "right", "--focus", "false"], {
    encoding: "utf8",
  });
  if (pane.status !== 0) throw new Error(pane.stderr || pane.stdout || "cmux new-pane failed");
  const surface = parseCmuxSurfaceRef(pane.stdout);
  if (!surface) throw new Error(`cmux new-pane did not return a surface ref: ${pane.stdout}`);
  const launch = spawnSync("cmux", ["respawn-pane", "--surface", surface, "--command", command], { encoding: "utf8" });
  if (launch.status !== 0) {
    const send = spawnSync("cmux", ["send", "--surface", surface, `${command}\n`], { encoding: "utf8" });
    if (send.status !== 0) {
      spawnSync("cmux", ["close-surface", "--surface", surface], { encoding: "utf8" });
      throw new Error(send.stderr || send.stdout || launch.stderr || launch.stdout || "cmux launch failed");
    }
  }
  if (!waitForCmuxSurfaceReadable(surface)) {
    spawnSync("cmux", ["close-surface", "--surface", surface], { encoding: "utf8" });
    throw new Error(`cmux created ${surface}, but the terminal never became readable. The agent was not marked launched; retry after cmux can create live terminal surfaces.`);
  }
  recordAgentLaunch(root, actor, agentName, surface);
  console.log(`Launched in ${surface}`);
}

function waitForCmuxSurfaceReadable(surface: string): boolean {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const read = spawnSync("cmux", ["read-screen", "--surface", surface, "--lines", "20"], { encoding: "utf8" });
    if (read.status === 0) return true;
    sleepSync(350);
  }
  return false;
}

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function listCmuxPiCompanySurfaces(workspace?: string, window?: string): Array<{ surface: string; title: string }> {
  const args = ["tree"];
  if (workspace) args.push("--workspace", workspace);
  if (window) args.push("--window", window);
  const result = spawnSync("cmux", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "cmux tree failed");
  return result.stdout
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/\bsurface\s+(surface:[^\s\]]+).*?"([^"]*)"/);
      return match ? { surface: match[1], title: match[2] } : null;
    })
    .filter((item): item is { surface: string; title: string } => Boolean(item && item.title.includes("pi-company")));
}

function readCmuxSurface(surface: string, workspace: string | undefined, window: string | undefined, lines: number): string | null {
  const args = ["read-screen", "--surface", surface, "--lines", String(lines)];
  if (workspace) args.push("--workspace", workspace);
  if (window) args.push("--window", window);
  const result = spawnSync("cmux", args, { encoding: "utf8" });
  if (result.status !== 0) {
    const message = result.stderr || result.stdout || `cmux read-screen failed for ${surface}`;
    if (/Surface is not a terminal/i.test(message)) return null;
    throw new Error(message);
  }
  return result.stdout;
}

function readTextOption(
  inline: string | undefined,
  filePath: string | undefined,
  stdin: boolean,
  label: string,
  required: boolean,
): string | null {
  const sources = [inline !== undefined, filePath !== undefined, stdin].filter(Boolean).length;
  if (sources > 1) throw new Error(`Use only one --${label}, --${label}-file, or --${label}-stdin source`);
  if (stdin) return fs.readFileSync(0, "utf8").replace(/\n$/, "");
  if (filePath) return fs.readFileSync(path.resolve(filePath), "utf8").replace(/\n$/, "");
  if (inline !== undefined) return inline;
  if (required) throw new Error(`Missing --${label}, --${label}-file, or --${label}-stdin`);
  return null;
}
