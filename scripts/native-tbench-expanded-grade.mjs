#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";
import {
  compilePinnedCircuitSimulator,
  compilePinnedElfFixture,
  compilePinnedPathMystery,
  ensurePinnedFixture,
  TB21_COMMIT,
} from "./native-tbench-fixtures.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pythonDriver = path.join(scriptDir, "native-tbench-official-python-grade.py");
const EXPANDED_TASKS = new Set([
  "dna-insert",
  "dna-assembly",
  "gcode-to-text",
  "video-processing",
  "extract-elf",
  "path-tracing-reverse",
  "regex-chess",
  "polyglot-rust-c",
  "circuit-fibsqrt",
  "llm-inference-batching-scheduler",
]);
const GCODE_EXPECTED = "flag{gc0d3_iz_ch4LLenGiNg}";
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

export async function gradeExpandedCandidate(taskId, candidateRoot, options = {}) {
  if (!EXPANDED_TASKS.has(taskId)) throw new Error(`Unsupported expanded native task: ${taskId}`);
  const root = path.resolve(candidateRoot);
  if (taskId === "dna-insert" || taskId === "dna-assembly") return gradeDna(taskId, root, options);
  if (taskId === "gcode-to-text") return gradeGcode(root);
  if (taskId === "video-processing") return gradeVideo(root, options);
  if (taskId === "extract-elf") return gradeExtractElf(root, options);
  if (taskId === "path-tracing-reverse") return gradePathTracingReverse(root, options);
  if (taskId === "regex-chess") return gradeRegexChess(root, options);
  if (taskId === "circuit-fibsqrt") return gradeCircuitFibSqrt(root, options);
  if (taskId === "llm-inference-batching-scheduler") return gradeLlmScheduler(root, options);
  return gradePolyglot(root);
}

async function gradeDna(taskId, root, options) {
  const candidate = path.join(root, "primers.fasta");
  const exists = fs.existsSync(candidate);
  const checks = [check("primers_fasta_exists", exists, exists ? "present" : "missing")];
  if (!exists) return missingResult(checks, 3, "primers.fasta");

  const lines = fs.readFileSync(candidate, "utf8").split(/\r?\n/).filter((line) => line.length > 0);
  const expectedLines = taskId === "dna-insert" ? 4 : 16;
  const formatPassed = lines.length === expectedLines
    && lines.every((line, index) => index % 2 === 0 ? line.startsWith(">") : /^[ATCG]+$/i.test(line));
  checks.push(check(
    "primer_fasta_format",
    formatPassed,
    `lines=${lines.length} expected=${expectedLines}; headers and DNA alphabet required`,
  ));

  const fixture = ensurePinnedFixture(`${taskId}/test_outputs.py`, graderCache(options), options.proxyUrl);
  const run = await runPythonDriver("dna", root, fixture, options, 120_000);
  checks.push(check(
    "official_primer_constraints",
    run.result?.passed === true,
    run.result?.detail || run.error || "official verifier failed",
  ));

  return completeResult(checks, {
    task: taskId,
    terminal_bench_commit: TB21_COMMIT,
    primer_pairs: Math.floor(lines.length / 4),
  });
}

function gradeGcode(root) {
  const candidate = path.join(root, "out.txt");
  const exists = fs.existsSync(candidate);
  const checks = [check("out_txt_exists", exists, exists ? "present" : "missing")];
  if (!exists) return missingResult(checks, 2, "out.txt");
  const actual = fs.readFileSync(candidate, "utf8").trim();
  checks.push(check(
    "decoded_text_exact",
    actual === GCODE_EXPECTED,
    actual === GCODE_EXPECTED ? "exact text match" : `unexpected text length=${actual.length}`,
  ));
  return completeResult(checks, { task: "gcode-to-text", output_chars: actual.length });
}

async function gradeVideo(root, options) {
  const script = path.join(root, "jump_analyzer.py");
  const exists = fs.existsSync(script);
  const checks = [check("jump_analyzer_exists", exists, exists ? "present" : "missing")];
  if (!exists) return missingResult(checks, 6, "jump_analyzer.py");

  const importCheck = await checkPythonImports(script, options);
  checks.push(check("allowed_imports", importCheck.passed, importCheck.detail));

  const example = await runVideoCase(
    root,
    path.join(root, "example_video.mp4"),
    [50, 54],
    [62, 64],
    options,
  );
  checks.push(check("example_video_executes", example.executed, example.executionDetail));
  checks.push(check("example_video_frames", example.framesPassed, example.frameDetail));

  const hiddenVideo = ensurePinnedFixture("video-processing/test_video.mp4", graderCache(options), options.proxyUrl);
  const hidden = await runVideoCase(root, hiddenVideo, [219, 223], [231, 234], options);
  checks.push(check("hidden_video_executes", hidden.executed, hidden.executionDetail));
  checks.push(check("hidden_video_frames", hidden.framesPassed, hidden.frameDetail));

  return completeResult(checks, {
    task: "video-processing",
    example: example.values,
    hidden: hidden.values,
  });
}

async function checkPythonImports(script, options) {
  const source = [
    "import ast, json, pathlib, sys",
    "tree = ast.parse(pathlib.Path(sys.argv[1]).read_text())",
    "found = set()",
    "for node in ast.walk(tree):",
    "    if isinstance(node, ast.Import):",
    "        found.update((item.name or '').split('.')[0] for item in node.names)",
    "    elif isinstance(node, ast.ImportFrom) and node.module:",
    "        found.add(node.module.split('.')[0])",
    "third = {name for name in found if name and name not in sys.stdlib_module_names}",
    "forbidden = sorted(third - {'cv2', 'numpy', 'toml'})",
    "print(json.dumps({'found': sorted(found), 'forbidden': forbidden}))",
    "raise SystemExit(1 if forbidden else 0)",
  ].join("\n");
  const run = await spawnCaptured("python3.13", ["-c", source, script], {
    timeoutMs: 30_000,
    maxOutputBytes: MAX_CAPTURE_BYTES,
    env: pythonEnv(options),
  });
  let parsed = null;
  try { parsed = JSON.parse(run.stdout.toString("utf8").trim()); } catch {}
  return {
    passed: run.exitCode === 0 && !run.timedOut && !run.outputOverflow,
    detail: parsed
      ? `third-party imports checked; forbidden=${parsed.forbidden.join(",") || "none"}`
      : commandDetail(run),
  };
}

async function runVideoCase(root, video, takeoffRange, landingRange, options) {
  const output = path.join(root, "output.toml");
  fs.rmSync(output, { force: true });
  const run = await spawnCaptured("python3.13", [path.join(root, "jump_analyzer.py"), video], {
    cwd: root,
    timeoutMs: 120_000,
    maxOutputBytes: MAX_CAPTURE_BYTES,
    env: pythonEnv(options),
  });
  const executed = run.exitCode === 0 && !run.timedOut && !run.outputOverflow && fs.existsSync(output);
  const values = executed ? parseSimpleToml(fs.readFileSync(output, "utf8")) : {};
  const takeoff = values.jump_takeoff_frame_number;
  const landing = values.jump_land_frame_number;
  const framesPassed = executed
    && Number.isInteger(takeoff)
    && Number.isInteger(landing)
    && takeoff >= takeoffRange[0]
    && takeoff <= takeoffRange[1]
    && landing >= landingRange[0]
    && landing <= landingRange[1];
  return {
    executed,
    framesPassed,
    values,
    executionDetail: executed ? "exit=0 and output.toml present" : commandDetail(run),
    frameDetail: `takeoff=${takeoff ?? "missing"} expected=${takeoffRange.join("-")}; landing=${landing ?? "missing"} expected=${landingRange.join("-")}`,
  };
}

function parseSimpleToml(text) {
  const result = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const match = /^([A-Za-z0-9_]+)\s*=\s*(-?\d+)\s*$/.exec(line);
    if (match) result[match[1]] = Number(match[2]);
  }
  return result;
}

async function gradeExtractElf(root, options) {
  const script = path.join(root, "extract.js");
  const exists = fs.existsSync(script);
  const checks = [check("extract_js_exists", exists, exists ? "present" : "missing")];
  if (!exists) return missingResult(checks, 6, "extract.js");

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-company-elf-grade-"));
  try {
    const source = path.join(temp, "hidden.c");
    fs.writeFileSync(source, [
      "#include <stdio.h>",
      "static const unsigned int table[] = {3, 5, 8, 13, 21};",
      "int main(int argc, char **argv) {",
      "  printf(\"items=%zu argc=%d %s\\n\", sizeof(table)/sizeof(table[0]), argc, argv[0]);",
      "  return table[argc % 5] == 0;",
      "}",
      "",
    ].join("\n"), "utf8");
    const binary = path.join(temp, "hidden.elf");
    const compile = await spawnCaptured("zig", ["cc", "-target", "x86_64-linux-gnu", source, "-o", binary], {
      timeoutMs: 120_000,
      maxOutputBytes: MAX_CAPTURE_BYTES,
    });
    const compiled = compile.exitCode === 0 && !compile.timedOut && !compile.outputOverflow;
    checks.push(check("hidden_elf_compiles", compiled, commandDetail(compile)));

    let run = emptyRun();
    if (compiled) {
      run = await spawnCaptured("node", [script, binary], {
        cwd: root,
        timeoutMs: 30_000,
        maxOutputBytes: 16 * 1024 * 1024,
      });
    }
    const executed = compiled && run.exitCode === 0 && !run.timedOut && !run.outputOverflow;
    checks.push(check("extractor_executes", executed, commandDetail(run)));

    let output = null;
    try { output = JSON.parse(run.stdout.toString("utf8")); } catch {}
    const integerObject = isRecord(output)
      && Object.values(output).every((value) => Number.isInteger(value));
    checks.push(check("integer_json_object", integerObject, integerObject ? "valid integer-valued JSON object" : "invalid JSON shape"));

    const reference = compiled ? extractElfMemory(fs.readFileSync(binary)) : {};
    const entries = integerObject ? Object.entries(output) : [];
    const inconsistent = entries.filter(([address, value]) => address in reference && reference[address] !== value);
    checks.push(check(
      "no_incorrect_reference_values",
      integerObject && inconsistent.length === 0,
      `inconsistent=${inconsistent.length}`,
    ));
    const found = integerObject ? Object.keys(reference).filter((address) => address in output).length : 0;
    const coverage = Object.keys(reference).length === 0 ? 0 : found / Object.keys(reference).length;
    checks.push(check(
      "reference_coverage",
      coverage >= 0.75,
      `found=${found} reference=${Object.keys(reference).length} coverage=${(coverage * 100).toFixed(2)}%`,
    ));
    return completeResult(checks, {
      task: "extract-elf",
      reference_words: Object.keys(reference).length,
      found_words: found,
      coverage,
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function extractElfMemory(buffer) {
  if (buffer.length < 64 || buffer.readUInt32BE(0) !== 0x7f454c46) throw new Error("invalid ELF");
  const elfClass = buffer[4];
  const little = buffer[5] === 1;
  const u16 = (offset) => little ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  const u32 = (offset) => little ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  const ux = (offset) => elfClass === 2
    ? Number(little ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset))
    : u32(offset);
  const shoff = ux(elfClass === 2 ? 40 : 32);
  const shentsize = u16(elfClass === 2 ? 58 : 46);
  const shnum = u16(elfClass === 2 ? 60 : 48);
  const shstrndx = u16(elfClass === 2 ? 62 : 50);
  const sections = [];
  for (let index = 0; index < shnum; index += 1) {
    const offset = shoff + index * shentsize;
    sections.push({
      name: u32(offset),
      addr: ux(offset + (elfClass === 2 ? 16 : 12)),
      offset: ux(offset + (elfClass === 2 ? 24 : 16)),
      size: ux(offset + (elfClass === 2 ? 32 : 20)),
    });
  }
  const names = sections[shstrndx];
  const nameData = buffer.subarray(names.offset, names.offset + names.size);
  const sectionName = (offset) => {
    let end = offset;
    while (end < nameData.length && nameData[end] !== 0) end += 1;
    return nameData.subarray(offset, end).toString("utf8");
  };
  const memory = {};
  for (const section of sections) {
    if (!new Set([".text", ".data", ".rodata"]).has(sectionName(section.name))) continue;
    for (let index = 0; index + 4 <= section.size; index += 4) {
      const fileOffset = section.offset + index;
      memory[String(section.addr + index)] = little
        ? buffer.readUInt32LE(fileOffset)
        : buffer.readUInt32BE(fileOffset);
    }
  }
  return memory;
}

async function gradePathTracingReverse(root, options) {
  const source = path.join(root, "mystery.c");
  const exists = fs.existsSync(source);
  const checks = [check("mystery_c_exists", exists, exists ? "present" : "missing")];
  if (!exists) return missingResult(checks, 6, "mystery.c");

  const compressedBytes = zlib.deflateSync(fs.readFileSync(source)).length;
  checks.push(check("compressed_source_size", compressedBytes < 2_100, `deflate_bytes=${compressedBytes} limit=2100`));

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-company-path-grade-"));
  try {
    const executable = path.join(temp, "reverse");
    const compile = await spawnCaptured("cc", ["-O2", source, "-lm", "-o", executable], {
      timeoutMs: 120_000,
      maxOutputBytes: MAX_CAPTURE_BYTES,
    });
    const compiled = compile.exitCode === 0 && !compile.timedOut && !compile.outputOverflow;
    checks.push(check("candidate_compiles", compiled, commandDetail(compile)));

    let run = emptyRun();
    if (compiled) {
      run = await spawnCaptured(executable, [], {
        cwd: temp,
        timeoutMs: 120_000,
        maxOutputBytes: MAX_CAPTURE_BYTES,
      });
    }
    const output = path.join(temp, "image.ppm");
    const ran = compiled && run.exitCode === 0 && !run.timedOut && !run.outputOverflow;
    checks.push(check("candidate_runs_in_isolation", ran, commandDetail(run)));
    const outputExists = ran && fs.existsSync(output);
    checks.push(check("image_ppm_exists", outputExists, outputExists ? "present" : "missing"));

    let similarity = 0;
    if (outputExists) {
      try {
        const reference = await ensurePathReference(graderCache(options), options.proxyUrl);
        similarity = ppmCosine(fs.readFileSync(reference), fs.readFileSync(output));
      } catch {}
    }
    checks.push(check("image_similarity", similarity >= 0.995, `cosine_similarity=${similarity}`));
    return completeResult(checks, {
      task: "path-tracing-reverse",
      compressed_bytes: compressedBytes,
      cosine_similarity: similarity,
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function ensurePathReference(cacheRoot, proxyUrl) {
  const directory = path.join(cacheRoot, "path-tracing-reverse");
  const reference = path.join(directory, "reference.ppm");
  if (fs.existsSync(reference) && fs.statSync(reference).size > 1000) return reference;
  fs.mkdirSync(directory, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-company-path-reference-"));
  try {
    const executable = path.join(temp, "mystery");
    compilePinnedPathMystery(executable, cacheRoot, proxyUrl);
    const run = await spawnCaptured(executable, [], {
      cwd: temp,
      timeoutMs: 120_000,
      maxOutputBytes: MAX_CAPTURE_BYTES,
    });
    const generated = path.join(temp, "image.ppm");
    if (run.exitCode !== 0 || run.timedOut || run.outputOverflow || !fs.existsSync(generated)) {
      throw new Error(`Pinned path reference failed: ${commandDetail(run)}`);
    }
    fs.copyFileSync(generated, reference);
    return reference;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function ppmCosine(expectedBuffer, actualBuffer) {
  const expected = parsePpm(expectedBuffer);
  const actual = parsePpm(actualBuffer);
  if (expected.width !== actual.width || expected.height !== actual.height || expected.values.length !== actual.values.length) return 0;
  let dot = 0;
  let expectedNorm = 0;
  let actualNorm = 0;
  for (let index = 0; index < expected.values.length; index += 1) {
    const left = expected.values[index] / expected.max;
    const right = actual.values[index] / actual.max;
    dot += left * right;
    expectedNorm += left * left;
    actualNorm += right * right;
  }
  return dot / Math.sqrt(expectedNorm * actualNorm);
}

function parsePpm(buffer) {
  let offset = 0;
  const token = () => {
    while (offset < buffer.length) {
      if (buffer[offset] === 35) {
        while (offset < buffer.length && buffer[offset] !== 10) offset += 1;
      } else if (buffer[offset] <= 32) {
        offset += 1;
      } else {
        break;
      }
    }
    const start = offset;
    while (offset < buffer.length && buffer[offset] > 32 && buffer[offset] !== 35) offset += 1;
    return buffer.subarray(start, offset).toString("ascii");
  };
  const magic = token();
  const width = Number(token());
  const height = Number(token());
  const max = Number(token());
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || max <= 0 || max > 255) {
    throw new Error("invalid PPM header");
  }
  const count = width * height * 3;
  if (magic === "P3") {
    const values = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      const value = Number(token());
      if (!Number.isInteger(value) || value < 0 || value > max) throw new Error("invalid P3 pixel");
      values[index] = value;
    }
    return { width, height, max, values };
  }
  if (magic === "P6") {
    if (buffer[offset] === 13 && buffer[offset + 1] === 10) offset += 2;
    else if (buffer[offset] <= 32) offset += 1;
    const data = buffer.subarray(offset, offset + count);
    if (data.length !== count) throw new Error("invalid P6 pixel data");
    return { width, height, max, values: Uint8Array.from(data) };
  }
  throw new Error("unsupported PPM format");
}

async function gradeRegexChess(root, options) {
  const candidate = path.join(root, "re.json");
  const exists = fs.existsSync(candidate);
  const checks = [check("re_json_exists", exists, exists ? "present" : "missing")];
  if (!exists) return missingResult(checks, 6, "re.json");

  let pairs = null;
  try { pairs = JSON.parse(fs.readFileSync(candidate, "utf8")); } catch {}
  const valid = Array.isArray(pairs)
    && pairs.length < 100_000
    && fs.statSync(candidate).size < 10_000_000
    && pairs.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((value) => typeof value === "string"));
  checks.push(check(
    "regex_json_shape_and_limits",
    valid,
    `pairs=${Array.isArray(pairs) ? pairs.length : "invalid"} bytes=${fs.statSync(candidate).size}`,
  ));

  const fixture = ensurePinnedFixture("regex-chess/test_outputs.py", graderCache(options), options.proxyUrl);
  const run = valid
    ? await runPythonDriver("regex", root, fixture, options, 10 * 60_000)
    : { result: null, error: "invalid regex JSON" };
  const byName = new Map((run.result?.checks || []).map((item) => [item.name, item]));
  for (const name of ["test_immortal_game", "test_game_of_century", "test_naroditsky_ivanchuk", "test_not_long"]) {
    const item = byName.get(name);
    checks.push(check(name, item?.passed === true, item?.detail || run.error || "not run"));
  }
  return completeResult(checks, {
    task: "regex-chess",
    regex_pairs: Array.isArray(pairs) ? pairs.length : null,
    bytes: fs.statSync(candidate).size,
  });
}

async function gradePolyglot(root) {
  const source = path.join(root, "polyglot", "main.rs");
  const exists = fs.existsSync(source);
  const checks = [check("polyglot_source_exists", exists, exists ? "present" : "missing")];
  if (!exists) return missingResult(checks, 5, "polyglot/main.rs");

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-company-polyglot-grade-"));
  try {
    const rust = path.join(temp, "rust-main");
    const cpp = path.join(temp, "cpp-main");
    const rustCompile = await spawnCaptured("rustc", [source, "-o", rust], {
      timeoutMs: 120_000,
      maxOutputBytes: MAX_CAPTURE_BYTES,
    });
    const cppCompile = await spawnCaptured("g++", ["-x", "c++", source, "-o", cpp], {
      timeoutMs: 120_000,
      maxOutputBytes: MAX_CAPTURE_BYTES,
    });
    const rustCompiled = rustCompile.exitCode === 0 && !rustCompile.timedOut && !rustCompile.outputOverflow;
    const cppCompiled = cppCompile.exitCode === 0 && !cppCompile.timedOut && !cppCompile.outputOverflow;
    checks.push(check("rust_compiles", rustCompiled, commandDetail(rustCompile)));
    checks.push(check("cpp_compiles", cppCompiled, commandDetail(cppCompile)));
    const cases = [[0, "1"], [1, "1"], [2, "2"], [10, "89"], [42, "433494437"]];
    const rustResult = rustCompiled ? await runCases(rust, cases) : { passed: false, detail: "compile failed" };
    const cppResult = cppCompiled ? await runCases(cpp, cases) : { passed: false, detail: "compile failed" };
    checks.push(check("rust_fibonacci", rustResult.passed, rustResult.detail));
    checks.push(check("cpp_fibonacci", cppResult.passed, cppResult.detail));
    return completeResult(checks, { task: "polyglot-rust-c", cases: cases.length });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function runCases(executable, cases) {
  for (const [input, expected] of cases) {
    const run = await spawnCaptured(executable, [String(input)], {
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
    });
    const actual = run.stdout.toString("utf8").trim();
    if (run.exitCode !== 0 || run.timedOut || run.outputOverflow || actual !== expected) {
      return { passed: false, detail: `n=${input} expected=${expected} actual=${actual}; ${commandDetail(run)}` };
    }
  }
  return { passed: true, detail: `${cases.length} Fibonacci cases passed` };
}

async function gradeCircuitFibSqrt(root, options) {
  const candidate = path.join(root, "gates.txt");
  const exists = fs.existsSync(candidate);
  const checks = [check("gates_txt_exists", exists, exists ? "present" : "missing")];
  if (!exists) return missingResult(checks, 7, "gates.txt");

  const lines = fs.readFileSync(candidate, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  checks.push(check("line_limit", lines.length < 32_000, `lines=${lines.length}; limit<32000`));
  const gatePattern = /^out\d+\s*=\s*(?:[01]|~?out\d+|out\d+\s*[&|^]\s*out\d+)$/;
  checks.push(check(
    "gate_syntax",
    lines.length > 0 && lines.every((line) => gatePattern.test(line)),
    `valid=${lines.filter((line) => gatePattern.test(line)).length}/${lines.length}`,
  ));

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-company-circuit-grade-"));
  try {
    const simulator = compilePinnedCircuitSimulator(
      path.join(temp, "sim"),
      graderCache(options),
      options.proxyUrl,
    );
    const groups = [
      [1, 4, 8, 12, 41, 42, 107, 220, 209, 366],
      [12, 41, 42, 107, 220, 209].map((value) => value ** 2),
      [12, 41, 42, 107, 220, 209].map((value) => value ** 2 - 1),
      [12, 41, 42, 107, 220, 209].map((value) => value ** 2 + 1),
    ];
    for (const [index, inputs] of groups.entries()) {
      const result = await runCircuitCases(simulator, root, inputs);
      checks.push(check(`fibsqrt_group_${index + 1}`, result.passed, result.detail));
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  return completeResult(checks, {
    task: "circuit-fibsqrt",
    terminal_bench_commit: TB21_COMMIT,
    gate_lines: lines.length,
    official_cases: 28,
  });
}

async function runCircuitCases(simulator, cwd, inputs) {
  for (const input of inputs) {
    const run = await spawnCaptured(simulator, [String(input)], {
      cwd,
      timeoutMs: 120_000,
      maxOutputBytes: 64 * 1024,
    });
    const actual = run.stdout.toString("utf8").trim();
    const expected = fibSqrtExpected(input);
    if (run.exitCode !== 0 || run.timedOut || run.outputOverflow || actual !== expected) {
      return { passed: false, detail: `n=${input} expected=${expected} actual=${actual}; ${commandDetail(run)}` };
    }
  }
  return { passed: true, detail: `${inputs.length} official cases passed` };
}

function fibSqrtExpected(input) {
  const n = Math.floor(Math.sqrt(input));
  let a = 0n;
  let b = 1n;
  for (let index = 0; index < n; index += 1) {
    [a, b] = [b, a + b];
  }
  return String(a % (2n ** 32n));
}

async function gradeLlmScheduler(root, options) {
  const verifier = ensurePinnedFixture("llm-scheduler/test_outputs.py", graderCache(options), options.proxyUrl);
  const costModel = ensurePinnedFixture("llm-scheduler/cost_model_for_tests.py", graderCache(options), options.proxyUrl);
  const run = await runPythonDriver("scheduler", root, verifier, options, 120_000, costModel);
  const expectedNames = [
    "test_output_files_exist",
    "test_input_data_integrity",
    "test_generate_and_schema",
    "test_solution_shape_feasibility_and_batch_consistency",
    "test_solution_coverage_no_duplicates",
    "test_performance_thresholds",
  ];
  const reported = new Map((run.result?.checks || []).map((item) => [item.name, item]));
  const checks = expectedNames.map((name) => {
    const item = reported.get(name);
    return check(name, item?.passed === true, item?.detail || run.error || "official verifier did not report this check");
  });
  const planPaths = [1, 2].map((bucket) => path.join(root, "task_file", "output_data", `plan_b${bucket}.jsonl`));
  return completeResult(checks, {
    task: "llm-inference-batching-scheduler",
    terminal_bench_commit: TB21_COMMIT,
    plan_bytes: planPaths.map((file) => fs.existsSync(file) ? fs.statSync(file).size : 0),
  });
}

async function runPythonDriver(mode, root, fixture, options, timeoutMs, supportFixture = null) {
  const args = [
    pythonDriver,
    "--mode", mode,
    "--candidate", root,
    "--fixture", fixture,
  ];
  if (supportFixture) args.push("--support-fixture", supportFixture);
  const run = await spawnCaptured("python3.13", args, {
    timeoutMs,
    maxOutputBytes: MAX_CAPTURE_BYTES,
    env: pythonEnv(options),
  });
  if (run.exitCode !== 0 || run.timedOut || run.outputOverflow) {
    return { result: null, error: commandDetail(run) };
  }
  try {
    const lines = run.stdout.toString("utf8").trim().split(/\r?\n/);
    return { result: JSON.parse(lines.at(-1)), error: null };
  } catch (error) {
    return { result: null, error: `invalid Python verifier output: ${error}` };
  }
}

function pythonEnv(options) {
  return {
    ...process.env,
    PYTHONPATH: [options.pythonPath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
  };
}

function graderCache(options) {
  return path.resolve(options.cacheRoot || path.join(os.tmpdir(), "pi-company-expanded-grade-cache"));
}

function check(name, passed, detail) {
  return { name, passed: Boolean(passed), detail: String(detail || "") };
}

function completeResult(checks, metrics) {
  const passed = checks.filter((item) => item.passed).length;
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

function commandDetail(run) {
  const stderr = run.stderr?.toString("utf8").trim().slice(-1000) || "";
  return `exit=${run.exitCode} signal=${run.signal || "none"} timeout=${run.timedOut} overflow=${run.outputOverflow}${stderr ? ` stderr=${stderr}` : ""}`;
}

function emptyRun() {
  return {
    exitCode: null,
    signal: null,
    timedOut: false,
    outputOverflow: false,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  };
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
    child.stderr.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > options.maxOutputBytes) {
        outputOverflow = true;
        terminate();
        return;
      }
      stderr.push(chunk);
    });
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

async function createOracle(taskId, root, options) {
  if (taskId === "gcode-to-text") {
    fs.writeFileSync(path.join(root, "out.txt"), `${GCODE_EXPECTED}\n`, "utf8");
    return;
  }
  if (taskId === "video-processing") {
    fs.writeFileSync(path.join(root, "jump_analyzer.py"), [
      "from pathlib import Path",
      "import sys",
      "name = Path(sys.argv[1]).name",
      "takeoff, landing = ((52, 63) if name == 'example_video.mp4' else (221, 232))",
      "Path('output.toml').write_text(f'jump_takeoff_frame_number = {takeoff}\\njump_land_frame_number = {landing}\\n')",
      "",
    ].join("\n"), "utf8");
    fs.copyFileSync(
      ensurePinnedFixture("video-processing/example_video.mp4", graderCache(options), options.proxyUrl),
      path.join(root, "example_video.mp4"),
    );
    return;
  }
  if (taskId === "dna-insert" || taskId === "dna-assembly") {
    writeDnaOracle(taskId, root, options);
    return;
  }
  if (taskId === "llm-inference-batching-scheduler") {
    copySchedulerDevelopmentFixtures(root, options);
    const source = ensurePinnedFixture("llm-scheduler/solve.sh", graderCache(options), options.proxyUrl);
    const script = path.join(root, ".scheduler-oracle.sh");
    fs.writeFileSync(
      script,
      fs.readFileSync(source, "utf8").replaceAll("/app/task_file", path.join(root, "task_file")),
      "utf8",
    );
    const run = await spawnCaptured("bash", [script], {
      cwd: root,
      timeoutMs: 120_000,
      maxOutputBytes: 16 * 1024 * 1024,
    });
    fs.rmSync(script, { force: true });
    if (run.exitCode !== 0 || run.timedOut || run.outputOverflow) {
      throw new Error(`Oracle solution failed for ${taskId}: ${commandDetail(run)}`);
    }
    return;
  }
  const solutionNames = {
    "extract-elf": "extract-elf/solve.sh",
    "path-tracing-reverse": "path-tracing-reverse/solve.sh",
    "regex-chess": "regex-chess/solve.sh",
    "polyglot-rust-c": "polyglot-rust-c/solve.sh",
    "circuit-fibsqrt": "circuit-fibsqrt/solve.sh",
  };
  const solution = ensurePinnedFixture(solutionNames[taskId], graderCache(options), options.proxyUrl);
  const bin = path.join(root, ".oracle-bin");
  fs.mkdirSync(bin, { recursive: true });
  const python = findExecutable("python3.13");
  if (python) fs.symlinkSync(python, path.join(bin, "python"));
  const run = await spawnCaptured("bash", [solution], {
    cwd: root,
    timeoutMs: 120_000,
    maxOutputBytes: 16 * 1024 * 1024,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  fs.rmSync(bin, { recursive: true, force: true });
  if (run.exitCode !== 0 || run.timedOut || run.outputOverflow) {
    throw new Error(`Oracle solution failed for ${taskId}: ${commandDetail(run)}`);
  }
}

function copySchedulerDevelopmentFixtures(root, options) {
  const fixtures = [
    ["llm-scheduler/requests_bucket_1.jsonl", "task_file/input_data/requests_bucket_1.jsonl"],
    ["llm-scheduler/requests_bucket_2.jsonl", "task_file/input_data/requests_bucket_2.jsonl"],
    ["llm-scheduler/cost_model.py", "task_file/scripts/cost_model.py"],
    ["llm-scheduler/baseline_packer.py", "task_file/scripts/baseline_packer.py"],
  ];
  for (const [name, relative] of fixtures) {
    const source = ensurePinnedFixture(name, graderCache(options), options.proxyUrl);
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
}

function writeDnaOracle(taskId, root, options) {
  const fixture = ensurePinnedFixture(`${taskId}/sequences.fasta`, graderCache(options), options.proxyUrl);
  const sequences = parseFasta(fs.readFileSync(fixture, "utf8"));
  const rc = (value) => value.toLowerCase().replace(/[atcg]/g, (base) => ({ a: "t", t: "a", c: "g", g: "c" })[base]).split("").reverse().join("");
  if (taskId === "dna-insert") {
    const input = sequences.input.toLowerCase();
    const output = sequences.output.toLowerCase();
    const fwdAnneal = input.slice(213, 228);
    const revAnneal = rc(input.slice(172, 213));
    const fwd = output.slice(232, 252) + fwdAnneal;
    const rev = rc(output.slice(213, 232)) + revAnneal;
    fs.writeFileSync(path.join(root, "primers.fasta"), `>forward_primer\n${fwd}\n>reverse_primer\n${rev}\n`, "utf8");
    return;
  }

  const inputFwd = sequences.input.slice(687, 708).toLowerCase();
  const inputRev = rc(sequences.input.slice(183, 213));
  const egfpFwd = sequences.egfp.slice(3, 21).toLowerCase();
  const egfpRev = rc(sequences.egfp.slice(693, 714));
  const flagFwd = sequences.flag.slice(3, 21).toLowerCase();
  const flagRev = rc(sequences.flag.slice(67, 87));
  const snapFwd = sequences.snap.slice(3, 26).toLowerCase();
  const snapRev = rc(sequences.snap.slice(528, 546));
  const prefix = "ggctacggtctca";
  const primers = {
    input_fwd: prefix + rc(snapRev.slice(0, 4)) + inputFwd,
    input_rev: prefix + rc(egfpFwd.slice(0, 1)) + inputRev,
    egfp_fwd: prefix + rc(inputRev.slice(0, 3)) + egfpFwd,
    egfp_rev: prefix + rc(flagFwd.slice(0, 1)) + egfpRev,
    flag_fwd: prefix + rc(egfpRev.slice(0, 3)) + flagFwd,
    flag_rev: prefix + rc(snapFwd.slice(0, 4)) + flagRev,
    snap_fwd: prefix + snapFwd,
    snap_rev: prefix + snapRev,
  };
  const text = Object.entries(primers).map(([name, primer]) => `>${name}\n${primer}`).join("\n");
  fs.writeFileSync(path.join(root, "primers.fasta"), `${text}\n`, "utf8");
}

function parseFasta(text) {
  const result = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(">")) {
      current = line.slice(1).split(/\s+/)[0];
      result[current] = "";
    } else if (current) {
      result[current] += line;
    }
  }
  return result;
}

function findExecutable(name) {
  const pathValue = process.env.PATH || "";
  for (const directory of pathValue.split(path.delimiter)) {
    const candidate = path.join(directory, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function createNegative(taskId, root) {
  if (taskId === "dna-insert" || taskId === "dna-assembly") {
    fs.writeFileSync(path.join(root, "primers.fasta"), ">bad\nN\n", "utf8");
  } else if (taskId === "gcode-to-text") {
    fs.writeFileSync(path.join(root, "out.txt"), "not the decoded text\n", "utf8");
  } else if (taskId === "video-processing") {
    fs.writeFileSync(path.join(root, "jump_analyzer.py"), "pass\n", "utf8");
  } else if (taskId === "extract-elf") {
    fs.writeFileSync(path.join(root, "extract.js"), "console.log('{}');\n", "utf8");
  } else if (taskId === "path-tracing-reverse") {
    fs.writeFileSync(path.join(root, "mystery.c"), [
      "#include <stdio.h>",
      "int main(void){FILE*f=fopen(\"image.ppm\",\"w\");fputs(\"P3\\n1 1\\n255\\n0 0 0\\n\",f);fclose(f);return 0;}",
      "",
    ].join("\n"), "utf8");
  } else if (taskId === "regex-chess") {
    fs.writeFileSync(path.join(root, "re.json"), "[]\n", "utf8");
  } else if (taskId === "circuit-fibsqrt") {
    fs.writeFileSync(path.join(root, "gates.txt"), "out0 = 0\n", "utf8");
  } else if (taskId === "llm-inference-batching-scheduler") {
    const output = path.join(root, "task_file", "output_data");
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "plan_b1.jsonl"), "{}\n", "utf8");
    fs.writeFileSync(path.join(output, "plan_b2.jsonl"), "{}\n", "utf8");
  }
}

async function runSelfTest(name, options) {
  const selected = name === "all" ? [...EXPANDED_TASKS] : [name];
  for (const taskId of selected) {
    if (!EXPANDED_TASKS.has(taskId)) throw new Error(`Unknown self-test task: ${taskId}`);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `pi-company-${taskId}-self-test-`));
    try {
      await createOracle(taskId, root, options);
      const oracle = await gradeExpandedCandidate(taskId, root, options);
      if (oracle.reward !== 1) throw new Error(`${taskId} oracle failed: ${JSON.stringify(oracle)}`);
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root, { recursive: true });
      if (taskId === "video-processing") {
        fs.copyFileSync(
          ensurePinnedFixture("video-processing/example_video.mp4", graderCache(options), options.proxyUrl),
          path.join(root, "example_video.mp4"),
        );
      }
      createNegative(taskId, root);
      const negative = await gradeExpandedCandidate(taskId, root, options);
      if (negative.reward !== 0) throw new Error(`${taskId} negative unexpectedly passed`);
      process.stdout.write(`${JSON.stringify({
        task: taskId,
        oracle: { reward: oracle.reward, passed: oracle.passed, total: oracle.total, metrics: oracle.metrics },
        negative: { reward: negative.reward, passed: negative.passed, total: negative.total },
      })}\n`);
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
    pythonPath: readArg("--python-path") || process.env.PYTHONPATH || "",
  };
  if (selfTest) {
    await runSelfTest(selfTest, options);
    return;
  }
  const taskId = readArg("--task");
  const candidate = readArg("--candidate");
  if (!taskId || !candidate) {
    throw new Error("Usage: node scripts/native-tbench-expanded-grade.mjs --task TASK --candidate PATH [--python-path PATH] [--cache-root PATH] | --self-test all");
  }
  const result = await gradeExpandedCandidate(taskId, candidate, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.reward === 1 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 2;
  });
}
