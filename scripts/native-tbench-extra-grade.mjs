#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { compileDeterministicDecompressor, ensurePinnedFixture, TB21_COMMIT } from "./native-tbench-fixtures.mjs";

const RAMAN_EXPECTED = {
  G: {
    x0: { value: 1580.3, tolerance: 5, mode: "absolute" },
    gamma: { value: 9.06, tolerance: 1, mode: "absolute" },
    amplitude: { value: 8382.69, tolerance: 0.05, mode: "relative" },
    offset: { value: 5561.03, tolerance: 0.1, mode: "relative" },
  },
  "2D": {
    x0: { value: 2670.08, tolerance: 0.05, mode: "relative" },
    gamma: { value: 17.52, tolerance: 1, mode: "absolute" },
    amplitude: { value: 12314.42, tolerance: 0.05, mode: "relative" },
    offset: { value: 1239.09, tolerance: 0.1, mode: "relative" },
  },
};
const RAMAN_CHECK_COUNT = 11;
const COMPRESSOR_CHECK_COUNT = 6;
const MAX_COMPRESSED_BYTES = 2_500;
const MAX_DECOMPRESSED_BYTES = 1024 * 1024;

export async function gradeExtraCandidate(taskId, candidateRoot, options = {}) {
  if (taskId === "raman-fitting") return gradeRaman(candidateRoot);
  if (taskId === "write-compressor") return gradeCompressor(candidateRoot, options);
  throw new Error(`Unsupported extra native task: ${taskId}`);
}

function gradeRaman(candidateRoot) {
  const resultPath = path.join(path.resolve(candidateRoot), "results.json");
  const checks = [{
    name: "results_json_exists",
    passed: fs.existsSync(resultPath),
    detail: fs.existsSync(resultPath) ? "present" : "missing",
  }];
  if (!fs.existsSync(resultPath)) return missingResult(checks, RAMAN_CHECK_COUNT, "results.json");

  let data = null;
  let parseError = null;
  try {
    data = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }
  checks.push({
    name: "results_json_valid",
    passed: data !== null,
    detail: data !== null ? "valid JSON" : parseError,
  });

  const schemaPassed = data !== null
    && ["G", "2D"].every((peak) => isRecord(data[peak]))
    && ["G", "2D"].every((peak) => ["x0", "gamma", "amplitude", "offset"].every((field) => isFiniteNumber(data[peak][field])));
  checks.push({
    name: "peak_schema",
    passed: schemaPassed,
    detail: schemaPassed ? "G and 2D contain four finite numeric parameters" : "missing or non-numeric peak parameters",
  });

  for (const [peak, fields] of Object.entries(RAMAN_EXPECTED)) {
    for (const [field, expected] of Object.entries(fields)) {
      const actual = schemaPassed ? data[peak][field] : null;
      const error = expected.mode === "absolute" || !isFiniteNumber(actual)
        ? Math.abs(Number(actual) - expected.value)
        : Math.abs(1 - actual / expected.value);
      const passed = isFiniteNumber(actual) && error < expected.tolerance;
      checks.push({
        name: `${peak.toLowerCase()}_${field}`,
        passed,
        detail: `actual=${actual} expected=${expected.value} error=${Number.isFinite(error) ? error : "invalid"} tolerance=${expected.tolerance} mode=${expected.mode}`,
      });
    }
  }

  return completeResult(checks, {
    task: "raman-fitting",
    parameters_passed: checks.slice(3).filter((check) => check.passed).length,
    parameters_total: 8,
  });
}

async function gradeCompressor(candidateRoot, options) {
  const candidate = path.resolve(candidateRoot);
  const compressedPath = path.join(candidate, "data.comp");
  const exists = fs.existsSync(compressedPath);
  const checks = [{
    name: "data_comp_exists",
    passed: exists,
    detail: exists ? "present" : "missing",
  }];
  if (!exists) return missingResult(checks, COMPRESSOR_CHECK_COUNT, "data.comp");

  const stat = fs.statSync(compressedPath);
  checks.push({
    name: "compressed_size",
    passed: stat.size <= MAX_COMPRESSED_BYTES,
    detail: `bytes=${stat.size} limit=${MAX_COMPRESSED_BYTES}`,
  });

  const cacheRoot = path.resolve(options.cacheRoot || path.join(os.tmpdir(), "pi-company-extra-grade-cache"));
  const proxyUrl = options.proxyUrl || null;
  const expectedPath = ensurePinnedFixture("write-compressor/data.txt", cacheRoot, proxyUrl);
  const expected = fs.readFileSync(expectedPath);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-company-compressor-grade-"));
  try {
    const executable = path.join(tempRoot, "decomp");
    compileDeterministicDecompressor(executable, cacheRoot, proxyUrl);
    const compiled = fs.existsSync(executable);
    checks.push({
      name: "deterministic_decompressor_compiles",
      passed: compiled,
      detail: compiled ? "compiled from pinned source with zero-initialized output buffer" : "missing executable",
    });

    let decompressed = Buffer.alloc(0);
    let run = { exitCode: null, timedOut: false, outputOverflow: false, stderr: Buffer.alloc(0) };
    if (compiled && stat.size <= 10 * 1024 * 1024) {
      run = await spawnCaptured(executable, [], {
        input: fs.readFileSync(compressedPath),
        timeoutMs: 30_000,
        maxOutputBytes: MAX_DECOMPRESSED_BYTES,
      });
      decompressed = run.stdout;
    }
    const succeeds = compiled && run.exitCode === 0 && !run.timedOut && !run.outputOverflow;
    checks.push({
      name: "decompressor_succeeds",
      passed: succeeds,
      detail: `exit=${run.exitCode} timeout=${run.timedOut} overflow=${run.outputOverflow}`,
    });
    checks.push({
      name: "decompressed_length",
      passed: succeeds && decompressed.length === expected.length,
      detail: `actual=${decompressed.length} expected=${expected.length}`,
    });
    checks.push({
      name: "decompressed_bytes_exact",
      passed: succeeds && decompressed.equals(expected),
      detail: succeeds && decompressed.equals(expected) ? "exact byte match" : "output differs",
    });

    return completeResult(checks, {
      task: "write-compressor",
      terminal_bench_commit: TB21_COMMIT,
      compressed_bytes: stat.size,
      expected_bytes: expected.length,
      decompressed_bytes: decompressed.length,
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function completeResult(checks, metrics) {
  const passed = checks.filter((check) => check.passed).length;
  return {
    reward: passed === checks.length ? 1 : 0,
    passed,
    total: checks.length,
    checks,
    metrics,
  };
}

function missingResult(checks, total, candidateFile) {
  return {
    reward: 0,
    passed: 0,
    total,
    checks,
    metrics: { candidate_file: candidateFile },
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function spawnCaptured(command, args, options) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let outputOverflow = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      detached: true,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let timedOut = false;
    let settled = false;
    let killTimer = null;
    let forceSettleTimer = null;
    const finish = (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (forceSettleTimer) clearTimeout(forceSettleTimer);
      resolve({
        exitCode,
        signal,
        timedOut,
        outputOverflow,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    };
    const terminate = () => {
      killProcessGroup(child.pid, "SIGTERM");
      killTimer ||= setTimeout(() => killProcessGroup(child.pid, "SIGKILL"), 1_500);
      forceSettleTimer ||= setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish(null, "SIGKILL");
      }, 3_000);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > options.maxOutputBytes) {
        outputOverflow = true;
        terminate();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      if (timedOut || outputOverflow) {
        finish(null, "SIGKILL");
        return;
      }
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (forceSettleTimer) clearTimeout(forceSettleTimer);
      reject(error);
    });
    child.on("close", finish);
    if (options.input !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(options.input);
    }
  });
}

function killProcessGroup(pid, signal) {
  if (!pid) return;
  try { process.kill(-pid, signal); } catch {}
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function runSelfTest(name, options) {
  const selected = name === "all" ? ["raman-fitting", "write-compressor"] : [name];
  for (const taskId of selected) {
    if (!new Set(["raman-fitting", "write-compressor"]).has(taskId)) {
      throw new Error(`Unknown self-test task: ${taskId}`);
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `pi-company-${taskId}-self-test-`));
    try {
      if (taskId === "raman-fitting") {
        const output = {};
        for (const [peak, fields] of Object.entries(RAMAN_EXPECTED)) {
          output[peak] = Object.fromEntries(Object.entries(fields).map(([field, expected]) => [field, expected.value]));
        }
        fs.writeFileSync(path.join(root, "results.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
      } else {
        const cacheRoot = path.resolve(options.cacheRoot || path.join(os.tmpdir(), "pi-company-extra-grade-cache"));
        const source = ensurePinnedFixture("write-compressor/main.rs", cacheRoot, options.proxyUrl);
        const data = ensurePinnedFixture("write-compressor/data.txt", cacheRoot, options.proxyUrl);
        const executable = path.join(root, "compressor");
        const compile = await spawnCaptured("rustc", ["-O", source, "-o", executable], {
          timeoutMs: 120_000,
          maxOutputBytes: 2 * 1024 * 1024,
        });
        if (compile.exitCode !== 0 || compile.timedOut || compile.outputOverflow) {
          throw new Error(`Reference compressor failed to compile: ${compile.stderr.toString("utf8").slice(-2_000)}`);
        }
        const encode = await spawnCaptured(executable, [], {
          input: fs.readFileSync(data),
          timeoutMs: 120_000,
          maxOutputBytes: 1024 * 1024,
        });
        if (encode.exitCode !== 0 || encode.timedOut || encode.outputOverflow) {
          throw new Error(`Reference compressor failed: ${encode.stderr.toString("utf8").slice(-2_000)}`);
        }
        fs.writeFileSync(path.join(root, "data.comp"), encode.stdout);
      }
      const oracle = await gradeExtraCandidate(taskId, root, options);
      if (oracle.reward !== 1) throw new Error(`${taskId} oracle self-test failed: ${JSON.stringify(oracle)}`);

      if (taskId === "raman-fitting") fs.writeFileSync(path.join(root, "results.json"), "{}\n", "utf8");
      else fs.writeFileSync(path.join(root, "data.comp"), Buffer.alloc(0));
      const negative = await gradeExtraCandidate(taskId, root, options);
      if (negative.reward !== 0) throw new Error(`${taskId} negative self-test unexpectedly passed`);
      process.stdout.write(`${JSON.stringify({ task: taskId, oracle, negative }, null, 2)}\n`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

async function main() {
  const selfTest = readArg("--self-test");
  const options = {
    cacheRoot: readArg("--cache-root"),
    proxyUrl: readArg("--proxy"),
  };
  if (selfTest) {
    await runSelfTest(selfTest, options);
    return;
  }
  const taskId = readArg("--task");
  const candidate = readArg("--candidate");
  if (!taskId || !candidate) {
    throw new Error("Usage: node scripts/native-tbench-extra-grade.mjs --task raman-fitting|write-compressor --candidate PATH [--cache-root PATH] [--proxy URL] | --self-test all");
  }
  const result = await gradeExtraCandidate(taskId, candidate, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.reward === 1 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 2;
  });
}
