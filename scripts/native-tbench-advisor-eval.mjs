#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assignIssue,
  createIssue,
  ensureCoderWorktree,
  initCompany,
  loadConfig,
  planAgentSpawn,
  registerAgent,
  requestAgentSpawn,
  sendCompanyMessage,
  setModelPolicy,
} from "../dist/src/core/company.js";
import { writeYaml } from "../dist/src/core/io.js";
import { companyPaths } from "../dist/src/core/paths.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const extensionPath = path.join(repoRoot, "dist", "extensions", "company.js");
const codexCompatExtensionPath = path.join(repoRoot, "scripts", "codex-client-compat-extension.ts");
const executorModelId = readArg("--executor-model") || "gpt-5.6-sol";
const strongModelId = readArg("--strong-model") || executorModelId;
const executorModel = `openai-codex/${executorModelId}`;
const strongModel = `openai-codex/${strongModelId}`;
const useCodexClientCompat = process.argv.includes("--codex-client-compat");
const proxyUrl = readArg("--proxy")
  || process.env.HTTPS_PROXY
  || process.env.HTTP_PROXY
  || process.env.ALL_PROXY
  || null;
const thinking = "high";
const minFreeBytes = 10 * 1024 ** 3;
const maxRunBytes = 200 * 1024 ** 2;
const variantTimeoutMs = 15 * 60_000;
const stageTimeoutCaps = {
  plain: variantTimeoutMs,
  tester: 3 * 60_000,
  coderImplement: 10 * 60_000,
  reviewer: 4 * 60_000,
  coderRevise: 5 * 60_000,
};
const failureLogTailBytes = 512 * 1024;

const taskText = `Create a Python function called async run_tasks(tasks: list[Callable[[], Awaitable[None]]], max_concurrent: int) -> None where each task is an async job to be run and max_concurrent is the max number of tasks that can be run concurrently.

Put the function in run.py at the current repository root. This repository root is the native local mapping of the Terminal-Bench path /app.

Use the system Python implementation only. Sometimes runs are cancelled via keyboard interrupt, and every task that has started must still execute its cleanup code. Work autonomously and do not ask the user questions.`;

const gradeOnly = readArg("--grade-candidate");
if (gradeOnly) {
  const grade = await gradeCandidate(path.resolve(gradeOnly));
  process.stdout.write(`${JSON.stringify(grade, null, 2)}\n`);
  process.exit(grade.passed === grade.total ? 0 : 1);
}

const variant = readArg("--variant");
if (!new Set(["plain", "company", "company-advisor"]).has(variant)) {
  fail("Usage: node scripts/native-tbench-advisor-eval.mjs --variant plain|company|company-advisor [--run-root PATH] [--executor-model MODEL] [--strong-model MODEL] [--codex-client-compat] [--proxy URL]");
}

const requestedRoot = readArg("--run-root");
const runRoot = path.resolve(requestedRoot || path.join(os.tmpdir(), `pi-company-native-tbench-${Date.now()}-${variant}`));
const trialRoot = path.join(runRoot, variant);
const sessionRoot = path.join(trialRoot, "sessions");
const agentConfigRoot = path.join(trialRoot, "agent-config");
const resultPath = path.join(trialRoot, "result.json");

await main();

async function main() {
  checkFreeSpace();
  if (!fs.existsSync(extensionPath)) fail(`Missing built extension: ${extensionPath}. Run npm run build first.`);
  fs.rmSync(trialRoot, { recursive: true, force: true });
  fs.mkdirSync(trialRoot, { recursive: true });
  fs.mkdirSync(sessionRoot, { recursive: true });
  createAgentConfig(agentConfigRoot);

  const workspace = path.join(trialRoot, "workspace");
  const baselineCommit = createWorkspace(workspace);

  const startedAt = new Date().toISOString();
  const deadline = Date.now() + variantTimeoutMs;
  const stages = [];
  let candidateRoot = workspace;

  if (variant === "plain") {
    const executor = await runPiStage({
      name: "executor",
      cwd: workspace,
      stageModel: executorModel,
      timeoutMs: stageTimeout(deadline, stageTimeoutCaps.plain),
      prompt: `${taskText}\n\nInspect the repository, implement the requested function, and run your own focused checks before finishing.`,
    });
    stages.push(executor);
    requireValidStage(executor);
  } else {
    const company = setupCompany(workspace, variant === "company-advisor");
    candidateRoot = company.coderWorktree;

    const tester = await runPiStage({
      name: "tester-plan",
      cwd: workspace,
      stageModel: strongModel,
      timeoutMs: stageTimeout(deadline, stageTimeoutCaps.tester),
      company: { root: workspace, agent: "tester", role: "tester" },
      prompt: `Read TASK.md. Act as an independent pre-implementation tester. Analyze the behavioral contract, especially concurrency limits, queued jobs, cancellation propagation, and cleanup. Do not edit source files and do not search outside this repository. Return a concise checklist of concrete failure modes the coder must handle.`,
    });
    stages.push(tester);
    requireValidStage(tester);
    sendCompanyMessage(workspace, {
      from: "tester",
      to: "coder",
      type: "test",
      priority: "high",
      task: company.issueId,
      text: tester.finalText || "Independently cover concurrency limits, queued jobs, cancellation propagation, and cleanup for every started task.",
    });

    const coderImplement = await runPiStage({
      name: "coder-implement",
      cwd: candidateRoot,
      stageModel: executorModel,
      timeoutMs: stageTimeout(deadline, stageTimeoutCaps.coderImplement),
      company: { root: workspace, agent: "coder", role: "coder" },
      prompt: `Read TASK.md and your pi-company inbox. Implement the assigned task completely in this coder worktree. Use Python 3.13 semantics, create run.py at the repository root, and perform focused self-checks without looking for evaluator files outside the repository. Do not wait for human input.`,
    });
    stages.push(coderImplement);
    requireValidStage(coderImplement);

    const reviewer = await runPiStage({
      name: "reviewer",
      cwd: workspace,
      stageModel: strongModel,
      timeoutMs: stageTimeout(deadline, stageTimeoutCaps.reviewer),
      company: { root: workspace, agent: "reviewer", role: "reviewer" },
      prompt: `Read TASK.md and inspect the candidate implementation at ${path.join(candidateRoot, "run.py")}. Review it read-only and adversarially for concurrency, cancellation, queued-coroutine leaks, cleanup completion, invalid limits, and exception propagation. Do not edit files or search outside the task repositories. Return only concrete findings and a clear approval or request-changes verdict.`,
    });
    stages.push(reviewer);
    requireValidStage(reviewer);
    sendCompanyMessage(workspace, {
      from: "reviewer",
      to: "coder",
      type: "review",
      priority: "high",
      task: company.issueId,
      text: reviewer.finalText || "Re-read the implementation adversarially and correct any cancellation, cleanup, or queued-task defects before finishing.",
    });

    const coderRevise = await runPiStage({
      name: "coder-revise",
      cwd: candidateRoot,
      stageModel: executorModel,
      timeoutMs: stageTimeout(deadline, stageTimeoutCaps.coderRevise),
      company: { root: workspace, agent: "coder", role: "coder" },
      prompt: `Read TASK.md, the current run.py, and the latest reviewer message in your pi-company inbox. Apply every valid correction, run focused self-checks, and leave the final implementation in run.py. Work autonomously and finish the task now.`,
    });
    stages.push(coderRevise);
    requireValidStage(coderRevise);
  }

  checkRunSize();
  const grade = await gradeCandidate(candidateRoot);
  const endedAt = new Date().toISOString();
  const aggregate = aggregateStages(stages);
  const advisorAudit = readAdvisorAudit(workspace);
  const coderPatch = [
    git(candidateRoot, ["diff", "--no-ext-diff", `${baselineCommit}..HEAD`, "--", ".", `:(exclude).pi-company`], { allowFailure: true }).stdout,
    git(candidateRoot, ["diff", "--no-ext-diff", "HEAD", "--", ".", `:(exclude).pi-company`], { allowFailure: true }).stdout,
  ].filter(Boolean).join("\n");

  const result = {
    schema_version: 1,
    benchmark: "terminal-bench-2.1-native-subset",
    task: "cancel-async-tasks",
    variant,
    model_matrix: {
      executor: executorModel,
      tester: strongModel,
      reviewer: strongModel,
      advisor: strongModel,
    },
    thinking,
    codex_client_compat_version: useCodexClientCompat ? "0.144.1" : null,
    network_proxy: Boolean(proxyUrl),
    time_budget_ms: variantTimeoutMs,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: stages.reduce((sum, stage) => sum + stage.durationMs, 0),
    reward: grade.passed === grade.total ? 1 : 0,
    checks_passed: grade.passed,
    checks_total: grade.total,
    checks: grade.checks,
    usage: aggregate.usage,
    advisor_usage: advisorAudit.usage,
    combined_usage: combineUsage(aggregate.usage, advisorAudit.usage),
    tool_calls: aggregate.toolCalls,
    advisor_calls: aggregate.advisorCalls,
    advisor_successful_calls: advisorAudit.successfulCalls,
    advisor_audit_statuses: advisorAudit.statuses,
    stage_summaries: stages.map((stage) => ({
      name: stage.name,
      model: stage.model,
      exit_code: stage.exitCode,
      timed_out: stage.timedOut,
      duration_ms: stage.durationMs,
      cleanup_delay_ms: stage.cleanupDelayMs,
      usage: stage.usage,
      tool_calls: stage.toolCalls,
      advisor_calls: stage.advisorCalls,
      errors: stage.errors,
      final_text_sha256: crypto.createHash("sha256").update(stage.finalText).digest("hex"),
    })),
    candidate_sha256: fs.existsSync(path.join(candidateRoot, "run.py"))
      ? crypto.createHash("sha256").update(fs.readFileSync(path.join(candidateRoot, "run.py"))).digest("hex")
      : null,
    patch: coderPatch.slice(0, 50_000),
    run_root_bytes: directoryBytes(trialRoot),
  };

  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  removeEphemeralData(workspace, sessionRoot, agentConfigRoot);
  checkFreeSpace();
  process.stdout.write(`${JSON.stringify({ resultPath, ...result }, null, 2)}\n`);
}

function createWorkspace(workspace) {
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "TASK.md"), `${taskText}\n`, "utf8");
  fs.writeFileSync(path.join(workspace, ".gitignore"), ".pi-company/\n", "utf8");
  git(workspace, ["init", "-b", "main"]);
  git(workspace, ["config", "user.name", "Pi Company Eval"]);
  git(workspace, ["config", "user.email", "eval@local.invalid"]);
  git(workspace, ["add", "TASK.md", ".gitignore"]);
  git(workspace, ["commit", "-m", "benchmark baseline"]);
  return git(workspace, ["rev-parse", "HEAD"]).stdout.trim();
}

function createAgentConfig(configRoot) {
  fs.mkdirSync(configRoot, { recursive: true });
  fs.writeFileSync(path.join(configRoot, "settings.json"), `${JSON.stringify({
    defaultProvider: "openai-codex",
    defaultModel: executorModelId,
    defaultThinkingLevel: thinking,
    transport: "sse",
  }, null, 2)}\n`, "utf8");
  const sourceAuth = path.join(os.homedir(), ".pi", "agent", "auth.json");
  const targetAuth = path.join(configRoot, "auth.json");
  if (!fs.existsSync(sourceAuth)) fail(`Missing Pi auth file: ${sourceAuth}`);
  fs.symlinkSync(sourceAuth, targetAuth);
}

function setupCompany(root, advisorEnabled) {
  initCompany({ root, id: `native-tbench-${advisorEnabled ? "advisor" : "company"}` });
  const executorModelConfig = { provider: "openai-codex", model: executorModelId, thinking };
  const strongModelConfig = { provider: "openai-codex", model: strongModelId, thinking };
  setModelPolicy(root, "lead", "defaults", null, executorModelConfig);
  setModelPolicy(root, "lead", "role", "coder", executorModelConfig);
  setModelPolicy(root, "lead", "role", "tester", strongModelConfig);
  setModelPolicy(root, "lead", "role", "reviewer", strongModelConfig);
  setModelPolicy(root, "lead", "role", "advisor", strongModelConfig);

  const config = loadConfig(root);
  if (!config) fail(`Company config was not created at ${root}`);
  config.advisor_policy = { ...config.advisor_policy, enabled: advisorEnabled, max_uses_per_turn: 2 };
  config.provider_request_policy = {
    ...config.provider_request_policy,
    max_concurrent_per_provider: 1,
    min_start_interval_ms: 1_000,
  };
  writeYaml(companyPaths(root).config, config);

  const mission = "Implement TASK.md completely in an isolated worktree and respond to tester/reviewer findings.";
  const plan = planAgentSpawn(root, "coder", "coder", mission);
  ensureCoderWorktree(root, plan, true);
  requestAgentSpawn(root, "lead", "coder", "coder", mission);
  registerAgent(root, {
    name: plan.name,
    role: plan.role,
    cwd: plan.cwd,
    worktree: plan.worktree,
    branch: plan.branch,
    mission: plan.mission,
    status: "planned",
  });

  const issue = createIssue(root, "lead", "Implement cancellation-safe async task runner", taskText, { work_type: "implementation" });
  assignIssue(root, "lead", issue.id, "coder");
  sendCompanyMessage(root, {
    from: "lead",
    to: "tester",
    type: "assignment",
    priority: "high",
    task: issue.id,
    text: "Analyze TASK.md before implementation and send coder a concrete adversarial acceptance checklist.",
  });
  sendCompanyMessage(root, {
    from: "lead",
    to: "coder",
    type: "assignment",
    priority: "high",
    task: issue.id,
    text: "Implement TASK.md completely, incorporating independent tester and reviewer feedback.",
  });

  return { coderWorktree: plan.worktree, issueId: issue.id };
}

async function runPiStage({ name, cwd, prompt, stageModel, timeoutMs, company = null }) {
  checkRunSize();
  const args = [
    "--mode", "json",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--approve",
    "--model", stageModel,
    "--thinking", thinking,
  ];
  if (useCodexClientCompat) args.push("--extension", codexCompatExtensionPath);
  if (company) {
    args.push(
      "--extension", extensionPath,
      "--company-root", company.root,
      "--company-agent", company.agent,
      "--company-role", company.role,
      "--company-lead", "lead",
    );
  }
  args.push(prompt);

  const started = Date.now();
  const outcome = await spawnCaptured("pi", args, {
    cwd,
    timeoutMs,
    env: {
      ...process.env,
      ...(proxyUrl ? {
        NODE_USE_ENV_PROXY: "1",
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        ALL_PROXY: proxyUrl,
      } : {}),
      PI_CODING_AGENT_DIR: agentConfigRoot,
      PI_CODING_AGENT_SESSION_DIR: sessionRoot,
      PI_OFFLINE: "1",
    },
  });

  const parsed = parsePiEvents(outcome.stdout);
  const observedDurationMs = Date.now() - started;
  const durationMs = outcome.timedOut ? Math.min(observedDurationMs, timeoutMs) : observedDurationMs;
  const result = {
    name,
    model: stageModel,
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
    durationMs,
    cleanupDelayMs: observedDurationMs - durationMs,
    finalText: parsed.finalText,
    usage: parsed.usage,
    toolCalls: parsed.toolCalls,
    advisorCalls: parsed.advisorCalls,
    errors: [
      ...parsed.errors,
      ...(outcome.stderr.trim() ? [outcome.stderr.trim().slice(-4_000)] : []),
    ],
  };
  fs.appendFileSync(path.join(trialRoot, "stage-checkpoints.jsonl"), `${JSON.stringify({
    ...result,
    finalText: undefined,
    finalTextSha256: crypto.createHash("sha256").update(result.finalText).digest("hex"),
  })}\n`, "utf8");
  if (result.exitCode !== 0 || result.timedOut || result.errors.length > 0) {
    const stageDir = path.join(trialRoot, "stages");
    fs.mkdirSync(stageDir, { recursive: true });
    if (outcome.stdout) fs.writeFileSync(path.join(stageDir, `${name}.jsonl.tail`), tailBytes(outcome.stdout, failureLogTailBytes));
    if (outcome.stderr) fs.writeFileSync(path.join(stageDir, `${name}.stderr.tail.log`), tailBytes(outcome.stderr, 64 * 1024));
  }
  checkRunSize();
  process.stderr.write(`[${variant}] ${name}: exit=${result.exitCode} timeout=${result.timedOut} tools=${result.toolCalls} advisor=${result.advisorCalls} duration=${Math.round(result.durationMs / 1000)}s\n`);
  return result;
}

function stageTimeout(deadline, cap) {
  return Math.max(1_000, Math.min(cap, deadline - Date.now()));
}

function parsePiEvents(rawEvents) {
  const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0, total_tokens: 0, cost_usd: 0 };
  let finalText = "";
  let toolCalls = 0;
  let advisorCalls = 0;
  const errors = [];
  const seenMessages = new Set();

  for (const line of rawEvents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "tool_execution_end") {
      toolCalls += 1;
      if (event.toolName === "company_consult_advisor") advisorCalls += 1;
    }
    if (event.type === "extension_error") errors.push(event.errorMessage || event.message || JSON.stringify(event));
    if (event.type !== "message_end" || event.message?.role !== "assistant") continue;
    const message = event.message;
    if (message.stopReason === "error") errors.push(message.errorMessage || "assistant message stopped with an error");
    const key = message.id || crypto.createHash("sha1").update(JSON.stringify(message)).digest("hex");
    if (seenMessages.has(key)) continue;
    seenMessages.add(key);
    const text = messageText(message);
    if (text) finalText = text;
    addUsage(usage, message.usage);
  }
  usage.total_tokens = usage.input + usage.output + usage.cache_read + usage.cache_write;
  return { usage, finalText, toolCalls, advisorCalls, errors: [...new Set(errors)] };
}

function requireValidStage(stage) {
  // Terminal-Bench grades the filesystem at the deadline. A timed-out model
  // stage is task behavior, while transport/extension errors invalidate a run.
  // Killing an in-flight request commonly surfaces a synthetic "fetch failed"
  // message, so every deadline timeout follows the filesystem-scoring path.
  if (stage.timedOut) return;
  if (stage.exitCode === 0 && stage.errors.length === 0) return;
  fail(`Infrastructure failure in ${stage.name}: ${stage.errors.join(" | ") || `exit ${stage.exitCode}`}`);
}

function messageText(message) {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function addUsage(target, value) {
  if (!value || typeof value !== "object") return;
  target.input += number(value.input ?? value.inputTokens);
  target.output += number(value.output ?? value.outputTokens);
  target.cache_read += number(value.cacheRead ?? value.cache_read ?? value.cacheReadTokens);
  target.cache_write += number(value.cacheWrite ?? value.cache_write ?? value.cacheWriteTokens);
  const cost = value.cost;
  target.cost_usd += number(typeof cost === "object" ? cost?.total : cost ?? value.totalCost);
}

function aggregateStages(stages) {
  const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0, total_tokens: 0, cost_usd: 0 };
  let toolCalls = 0;
  let advisorCalls = 0;
  for (const stage of stages) {
    for (const key of ["input", "output", "cache_read", "cache_write", "cost_usd"]) usage[key] += stage.usage[key];
    toolCalls += stage.toolCalls;
    advisorCalls += stage.advisorCalls;
  }
  usage.total_tokens = usage.input + usage.output + usage.cache_read + usage.cache_write;
  return { usage, toolCalls, advisorCalls };
}

function readAdvisorAudit(root) {
  const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0, total_tokens: 0, cost_usd: 0 };
  const statuses = [];
  let successfulCalls = 0;
  const eventsPath = companyPaths(root).events;
  if (!fs.existsSync(eventsPath)) return { usage, statuses, successfulCalls };

  for (const line of fs.readFileSync(eventsPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.type !== "advisor.invoked") continue;
    const status = typeof event.data?.status === "string" ? event.data.status : "unknown";
    statuses.push(status);
    if (status !== "success") continue;
    successfulCalls += 1;
    addUsage(usage, event.data?.usage);
  }
  usage.total_tokens = usage.input + usage.output + usage.cache_read + usage.cache_write;
  return { usage, statuses, successfulCalls };
}

function combineUsage(...values) {
  const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0, total_tokens: 0, cost_usd: 0 };
  for (const value of values) {
    for (const key of ["input", "output", "cache_read", "cache_write", "cost_usd"]) usage[key] += number(value?.[key]);
  }
  usage.total_tokens = usage.input + usage.output + usage.cache_read + usage.cache_write;
  return usage;
}

async function gradeCandidate(candidateRoot) {
  const checks = [];
  const runFile = path.join(candidateRoot, "run.py");
  checks.push({ name: "run_py_exists", passed: fs.existsSync(runFile), detail: fs.existsSync(runFile) ? "present" : "missing" });
  if (!fs.existsSync(runFile)) return { checks, passed: 0, total: 6 };

  const driver = path.join(candidateRoot, ".native-tbench-driver.py");
  fs.writeFileSync(driver, `import argparse\nimport asyncio\nfrom run import run_tasks\n\nasync def task():\n    try:\n        print("Task started.", flush=True)\n        await asyncio.sleep(2)\n        print("Task finished.", flush=True)\n    finally:\n        await asyncio.sleep(1)\n        print("Cleaned up.", flush=True)\n\nasync def main(n_tasks, max_concurrent):\n    await run_tasks([task] * n_tasks, max_concurrent)\n\nif __name__ == "__main__":\n    p = argparse.ArgumentParser()\n    p.add_argument("--n-tasks", type=int, required=True)\n    p.add_argument("--max-concurrent", type=int, required=True)\n    a = p.parse_args()\n    asyncio.run(main(a.n_tasks, a.max_concurrent))\n`, "utf8");

  checks.push(await gradeCompletion(candidateRoot, 2, 2, 5_000, "tasks_run_concurrently", (out) => counts(out, 2, 2, 2)));
  const sequentialStart = Date.now();
  checks.push(await gradeCompletion(candidateRoot, 2, 1, 10_000, "max_concurrent_obeyed", (out) => counts(out, 2, 2, 2) && Date.now() - sequentialStart >= 5_800));
  checks.push(await gradeCancellation(candidateRoot, 2, 3, "cancel_below_limit", 2));
  checks.push(await gradeCancellation(candidateRoot, 2, 2, "cancel_at_limit", 2));
  checks.push(await gradeCancellation(candidateRoot, 3, 2, "cancel_above_limit", 2));
  fs.rmSync(driver, { force: true });
  return { checks, passed: checks.filter((check) => check.passed).length, total: checks.length };
}

async function gradeCompletion(cwd, nTasks, maxConcurrent, timeoutMs, name, predicate) {
  const result = await spawnCaptured("python3.13", [".native-tbench-driver.py", "--n-tasks", String(nTasks), "--max-concurrent", String(maxConcurrent)], {
    cwd,
    timeoutMs,
  });
  const passed = !result.timedOut && result.exitCode === 0 && predicate(result.stdout);
  return { name, passed, detail: summarizeProcess(result) };
}

async function gradeCancellation(cwd, nTasks, maxConcurrent, name, expectedStarted) {
  const result = await spawnCaptured("python3.13", [".native-tbench-driver.py", "--n-tasks", String(nTasks), "--max-concurrent", String(maxConcurrent)], {
    cwd,
    timeoutMs: 5_500,
    signalAfterMs: 500,
  });
  const started = occurrences(result.stdout, "Task started.");
  const cleaned = occurrences(result.stdout, "Cleaned up.");
  return {
    name,
    passed: started === expectedStarted && cleaned === expectedStarted,
    detail: `started=${started} cleaned=${cleaned} exit=${result.exitCode} timeout=${result.timedOut}`,
  };
}

function counts(output, started, finished, cleaned) {
  return occurrences(output, "Task started.") === started
    && occurrences(output, "Task finished.") === finished
    && occurrences(output, "Cleaned up.") === cleaned;
}

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

function summarizeProcess(result) {
  return `exit=${result.exitCode} timeout=${result.timedOut} started=${occurrences(result.stdout, "Task started.")} finished=${occurrences(result.stdout, "Task finished.")} cleaned=${occurrences(result.stdout, "Cleaned up.")}`;
}

function spawnCaptured(command, args, options) {
  return new Promise((resolve, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    const stdoutStream = options.stdoutPath ? fs.createWriteStream(options.stdoutPath) : null;
    const stderrStream = options.stderrPath ? fs.createWriteStream(options.stderrPath) : null;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let timedOut = false;
    let settled = false;
    let signalTimer = null;
    let killTimer = null;
    let forceSettleTimer = null;
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (signalTimer) clearTimeout(signalTimer);
      if (killTimer) clearTimeout(killTimer);
      if (forceSettleTimer) clearTimeout(forceSettleTimer);
      stdoutStream?.end();
      stderrStream?.end();
      resolve({
        exitCode: code,
        signal,
        timedOut,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child.pid, "SIGTERM");
      killTimer = setTimeout(() => killProcessGroup(child.pid, "SIGKILL"), 1_500);
      forceSettleTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish(null, "SIGKILL");
      }, 3_000);
    }, options.timeoutMs);
    if (options.signalAfterMs) {
      signalTimer = setTimeout(() => killProcessGroup(child.pid, "SIGINT"), options.signalAfterMs);
    }
    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(chunk);
      stdoutStream?.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk);
      stderrStream?.write(chunk);
    });
    child.on("error", (error) => {
      if (timedOut) {
        finish(null, "SIGKILL");
        return;
      }
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (signalTimer) clearTimeout(signalTimer);
      if (killTimer) clearTimeout(killTimer);
      if (forceSettleTimer) clearTimeout(forceSettleTimer);
      stdoutStream?.end();
      stderrStream?.end();
      reject(error);
    });
    child.on("close", (code, signal) => {
      finish(code, signal);
    });
  });
}

function tailBytes(value, limit) {
  const bytes = Buffer.from(value, "utf8");
  return bytes.subarray(Math.max(0, bytes.length - limit));
}

function killProcessGroup(pid, signal) {
  if (!pid) return;
  try { process.kill(-pid, signal); } catch {}
}

function git(cwd, args, options = {}) {
  const result = spawnSyncCompat("git", args, cwd);
  if (result.exitCode !== 0 && !options.allowFailure) fail(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result;
}

function spawnSyncCompat(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return { exitCode: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function checkFreeSpace() {
  const stat = fs.statfsSync(trialRoot && fs.existsSync(trialRoot) ? trialRoot : os.tmpdir());
  const free = stat.bavail * stat.bsize;
  if (free < minFreeBytes) fail(`Disk guard: only ${(free / 1024 ** 3).toFixed(2)} GiB free; minimum is 10 GiB.`);
}

function checkRunSize() {
  if (!fs.existsSync(trialRoot)) return;
  const bytes = directoryBytes(trialRoot);
  if (bytes > maxRunBytes) fail(`Disk guard: benchmark reached ${(bytes / 1024 ** 2).toFixed(1)} MiB; cap is 200 MiB.`);
  checkFreeSpace();
}

function directoryBytes(root) {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      let stat;
      try { stat = fs.lstatSync(file); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) stack.push(file);
      else total += stat.size;
    }
  }
  return total;
}

function removeEphemeralData(workspace, sessions, configRoot) {
  fs.rmSync(sessions, { recursive: true, force: true });
  fs.rmSync(configRoot, { recursive: true, force: true });
  const worktrees = path.join(workspace, ".pi-company", "worktrees");
  fs.rmSync(worktrees, { recursive: true, force: true });
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fail(message) {
  throw new Error(message);
}
