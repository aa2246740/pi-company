#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const runner = path.join(scriptDir, "native-tbench-advisor-eval.mjs");
const defaultTasks = [
  "video-processing",
  "dna-insert",
  "gcode-to-text",
  "dna-assembly",
  "extract-elf",
  "path-tracing-reverse",
  "regex-chess",
  "polyglot-rust-c",
  "circuit-fibsqrt",
  "llm-inference-batching-scheduler",
];

const runRoot = path.resolve(readArg("--run-root") || path.join(os.tmpdir(), "pi-company-expanded-matrix"));
const checkpointPath = path.resolve(readArg("--checkpoint") || path.join(repoRoot, ".benchmark-work", "native-tbench-expanded-results.jsonl"));
const proxyUrl = readArg("--proxy");
const executorModel = readArg("--executor-model") || "gpt-5.6-luna";
const strongModel = readArg("--strong-model") || "gpt-5.6-sol";
const validatorModel = readArg("--validator-model") || executorModel;
const advisorModel = readArg("--advisor-model") || strongModel;
const minFreeGiB = readArg("--min-free-gib") || "5";
const maxRunMiB = readArg("--max-run-mib") || "250";
const timeMultiplier = readArg("--time-multiplier") || "1";
const retryUsageLimits = nonNegativeIntegerArg("--retry-usage-limits", 0);
const retryTransientErrors = nonNegativeIntegerArg("--retry-transient-errors", 0);
const keepTrials = process.argv.includes("--keep-trials");
const selectedTasks = parseTasks(readArg("--tasks"));
const selectedVariants = parseVariants(readArg("--variants"));
const completed = readCheckpoints(checkpointPath);

for (const [index, task] of selectedTasks.entries()) {
  const orderedVariants = index % 2 === 0
    ? ["company", "company-advisor"]
    : ["company-advisor", "company"];
  const variants = orderedVariants.filter((variant) => selectedVariants.includes(variant));
  for (const variant of variants) {
    const key = `${task}:${variant}`;
    if (completed.has(key)) {
      process.stderr.write(`[matrix] skip completed ${key}\n`);
      continue;
    }
    process.stderr.write(`[matrix] start ${key}\n`);
    await runCellWithRetries(task, variant);
    const resultPath = path.join(runRoot, task, variant, "result.json");
    if (!fs.existsSync(resultPath)) throw new Error(`Missing result after ${key}: ${resultPath}`);
    const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    const checkpoint = {
      ...result,
      patch: undefined,
      checkpointed_at: new Date().toISOString(),
    };
    appendCheckpoint(checkpointPath, checkpoint);
    completed.set(key, checkpoint);
    process.stderr.write(`[matrix] complete ${key}: reward=${result.reward} checks=${result.checks_passed}/${result.checks_total}\n`);
    if (!keepTrials) fs.rmSync(path.join(runRoot, task, variant), { recursive: true, force: true });
  }
  if (!keepTrials) fs.rmSync(path.join(runRoot, task), { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  run_root: runRoot,
  checkpoint: checkpointPath,
  tasks: selectedTasks,
  variants: selectedVariants,
  time_multiplier: Number(timeMultiplier),
  completed_cells: selectedTasks.reduce(
    (count, task) => count + selectedVariants.filter((variant) => completed.has(`${task}:${variant}`)).length,
    0,
  ),
  retained_run_bytes: directoryBytes(runRoot),
}, null, 2)}\n`);

async function runCellWithRetries(task, variant) {
  let quotaAttempts = 0;
  let transientAttempts = 0;
  for (;;) {
    try {
      await runCell(task, variant);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const quota = /usage limit[\s\S]*?~(\d+)\s*min/i.exec(message);
      if (quota && quotaAttempts < retryUsageLimits) {
        quotaAttempts += 1;
        const waitMinutes = Number(quota[1]) + 5;
        fs.rmSync(path.join(runRoot, task, variant), { recursive: true, force: true });
        process.stderr.write(`[matrix] quota exhausted for ${task}:${variant}; retry ${quotaAttempts}/${retryUsageLimits} in ${waitMinutes} min\n`);
        await waitWithProgress(waitMinutes * 60_000, task, variant);
        continue;
      }
      const transient = /fetch failed|WebSocket error|ECONNRESET|ETIMEDOUT|socket hang up|\bterminated\b/i.test(message);
      if (transient && transientAttempts < retryTransientErrors) {
        transientAttempts += 1;
        fs.rmSync(path.join(runRoot, task, variant), { recursive: true, force: true });
        process.stderr.write(`[matrix] transient provider failure for ${task}:${variant}; retry ${transientAttempts}/${retryTransientErrors} in 60s\n`);
        await waitWithProgress(60_000, task, variant);
        continue;
      }
      throw error;
    }
  }
}

function runCell(task, variant) {
  const args = [
    runner,
    "--task", task,
    "--variant", variant,
    "--run-root", runRoot,
    "--executor-model", executorModel,
    "--strong-model", strongModel,
    "--validator-model", validatorModel,
    "--advisor-model", advisorModel,
    "--codex-client-compat",
    "--min-free-gib", minFreeGiB,
    "--max-run-mib", maxRunMiB,
    "--time-multiplier", timeMultiplier,
  ];
  if (proxyUrl) args.push("--proxy", proxyUrl);
  return new Promise((resolve, reject) => {
    const stderr = [];
    let stderrBytes = 0;
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      stderrBytes += chunk.length;
      stderr.push(chunk);
      while (stderrBytes > 128 * 1024 && stderr.length > 1) stderrBytes -= stderr.shift().length;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").slice(-128 * 1024);
      reject(new Error(`Cell ${task}:${variant} failed with code=${code} signal=${signal || "none"}\n${detail}`));
    });
  });
}

function waitWithProgress(milliseconds, task, variant) {
  return new Promise((resolve) => {
    const started = Date.now();
    const interval = setInterval(() => {
      const remaining = Math.max(0, milliseconds - (Date.now() - started));
      process.stderr.write(`[matrix] waiting for quota before ${task}:${variant}; about ${Math.ceil(remaining / 60_000)} min remain\n`);
    }, 10 * 60_000);
    setTimeout(() => {
      clearInterval(interval);
      resolve();
    }, milliseconds);
  });
}

function appendCheckpoint(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = `${JSON.stringify(value)}\n`;
  const temporary = `${file}.tmp-${process.pid}`;
  const existing = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
  fs.writeFileSync(temporary, Buffer.concat([existing, Buffer.from(line)]));
  fs.renameSync(temporary, file);
}

function readCheckpoints(file) {
  const values = new Map();
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const value = JSON.parse(line);
    if (!checkpointMatchesProtocol(value)) continue;
    values.set(`${value.task}:${value.variant}`, value);
  }
  return values;
}

function checkpointMatchesProtocol(value) {
  return Number(value.time_multiplier ?? 1) === Number(timeMultiplier) &&
    value.model_matrix?.executor === `openai-codex/${executorModel}` &&
    value.model_matrix?.tester === `openai-codex/${validatorModel}` &&
    value.model_matrix?.reviewer === `openai-codex/${validatorModel}` &&
    value.model_matrix?.advisor === `openai-codex/${advisorModel}` &&
    value.advisor_policy?.trigger_mode === "adaptive" &&
    value.advisor_policy?.max_uses_per_task === 1;
}

function parseTasks(raw) {
  if (!raw) return defaultTasks;
  const tasks = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const unknown = tasks.filter((task) => !defaultTasks.includes(task));
  if (unknown.length > 0) throw new Error(`Unknown expanded tasks: ${unknown.join(", ")}`);
  return tasks;
}

function parseVariants(raw) {
  if (!raw) return ["company", "company-advisor"];
  const variants = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const unknown = variants.filter((variant) => !new Set(["company", "company-advisor"]).has(variant));
  if (unknown.length > 0 || variants.length === 0) {
    throw new Error(`Unknown expanded variants: ${unknown.join(", ") || "none selected"}`);
  }
  return [...new Set(variants)];
}

function directoryBytes(root) {
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const item = path.join(current, entry.name);
      const stat = fs.lstatSync(item);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) stack.push(item);
      else total += stat.size;
    }
  }
  return total;
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function nonNegativeIntegerArg(name, fallback) {
  const raw = readArg(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}
