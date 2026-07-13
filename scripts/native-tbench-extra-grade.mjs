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
const PROTEIN_CHECK_COUNT = 9;
const DB_WAL_CHECK_COUNT = 9;
const MAX_COMPRESSED_BYTES = 2_500;
const MAX_DECOMPRESSED_BYTES = 1024 * 1024;

const PROTEIN_COMPONENTS = {
  flag: "DYKDDDDK",
  donor: "GSSHHHHHHSSGENLYFQGHMVSKGEELFTGVVPILVELDGDVNGHKFSVRGEGEGDATNGKLTLKFICTTGKLPVPWPTLVTTFGYGVACFSRYPDHMKQHDFFKSAMPEGYVQERTISFKDDGTYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNFNSHNVYITADKQKNGIKANFKIRHNVEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSHQSALSKDPNEKRDHMVLLEFVTAAGITHGMDELYK",
  dhfr: "ISLIAALAVDRVIGMENAMPWNLPADLAWFKRNTLNKPVIMGRHTWESIGRPLPGRKNIILSSQPGTDDRVTWVKSVDEAIAACGDVPEIMVIGGGRVYEQFLPKAQKLYLTHIDAEVEGDTHFPDYEPDDWESVFSEFHDADAQNSHSYCFEILERR",
  acceptor: "VSKGEEDNMAIIKEFMRFKVHMEGSVNGHEFEIEGEGEGRPYEGTQTAKLKVTKGGPLPFAWDILSPQFMYGSKAYVKHPADIPDYLKLSFPEGFKWERVMNFEDGGVVTVTQDSSLQDGEFIYKVKLRGTNFPSDGPVMQKKTMGWEASSERMYPEDGALKGEIKQRLKLKDGGHYDAEVKTTYKAKKPVQLPGAYNVNIKLDITSHNEDYTIVEQYERAEGRHSTGGMDELYK",
  snap: "GPGSDKDCEMKRTTLDSPLGKLELSGCEQGLHEIIFLGKGTSAADAVEVPAPAAVLGGPEPLMQATAWLNAYFHQPEAIEEFPVPALHHPVFQQESFTRQVLWKLLKVVKFGEVISYSHLAALAGNPAATAAVKTALSGNPVPILIPCHRVVQGDLDVGGYEGGLAVKEWLLAHEGHRLGKR",
};

const PROTEIN_ORACLE_CODONS = {
  A: "GCT", C: "TGT", D: "GAT", E: "GAA", F: "TTC", G: "GGT", H: "CAT",
  I: "ATC", K: "AAG", L: "CTG", M: "ATG", N: "AAC", P: "CCT", Q: "CAG",
  R: "CGT", S: "TCT", T: "ACT", V: "GTT", W: "TGG", Y: "TAC",
};

const GENETIC_CODE = {
  TTT: "F", TTC: "F", TTA: "L", TTG: "L", TCT: "S", TCC: "S", TCA: "S", TCG: "S",
  TAT: "Y", TAC: "Y", TAA: "*", TAG: "*", TGT: "C", TGC: "C", TGA: "*", TGG: "W",
  CTT: "L", CTC: "L", CTA: "L", CTG: "L", CCT: "P", CCC: "P", CCA: "P", CCG: "P",
  CAT: "H", CAC: "H", CAA: "Q", CAG: "Q", CGT: "R", CGC: "R", CGA: "R", CGG: "R",
  ATT: "I", ATC: "I", ATA: "I", ATG: "M", ACT: "T", ACC: "T", ACA: "T", ACG: "T",
  AAT: "N", AAC: "N", AAA: "K", AAG: "K", AGT: "S", AGC: "S", AGA: "R", AGG: "R",
  GTT: "V", GTC: "V", GTA: "V", GTG: "V", GCT: "A", GCC: "A", GCA: "A", GCG: "A",
  GAT: "D", GAC: "D", GAA: "E", GAG: "E", GGT: "G", GGC: "G", GGA: "G", GGG: "G",
};

const DB_WAL_EXPECTED = [
  { id: 1, name: "apple", value: 150 },
  { id: 2, name: "banana", value: 250 },
  { id: 3, name: "cherry", value: 300 },
  { id: 4, name: "date", value: 400 },
  { id: 5, name: "elderberry", value: 500 },
  { id: 6, name: "fig", value: 600 },
  { id: 7, name: "grape", value: 700 },
  { id: 8, name: "honeydew", value: 800 },
  { id: 9, name: "kiwi", value: 900 },
  { id: 10, name: "lemon", value: 1_000 },
  { id: 11, name: "mango", value: 1_100 },
];

export async function gradeExtraCandidate(taskId, candidateRoot, options = {}) {
  if (taskId === "raman-fitting") return gradeRaman(candidateRoot);
  if (taskId === "write-compressor") return gradeCompressor(candidateRoot, options);
  if (taskId === "protein-assembly") return gradeProteinAssembly(candidateRoot);
  if (taskId === "db-wal-recovery") return gradeDbWalRecovery(candidateRoot);
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

function gradeProteinAssembly(candidateRoot) {
  const resultPath = path.join(path.resolve(candidateRoot), "gblock.txt");
  const exists = fs.existsSync(resultPath);
  const checks = [{
    name: "gblock_exists",
    passed: exists,
    detail: exists ? "present" : "missing",
  }];
  if (!exists) return missingResult(checks, PROTEIN_CHECK_COUNT, "gblock.txt");

  const lines = fs.readFileSync(resultPath, "utf8").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const oneLine = lines.length === 1 && lines[0].length > 0;
  checks.push({
    name: "single_nonempty_line",
    passed: oneLine,
    detail: `lines=${lines.length}`,
  });

  const dna = oneLine ? lines[0].toUpperCase() : "";
  const dnaAlphabet = /^[ATCG]+$/.test(dna);
  checks.push({
    name: "dna_alphabet",
    passed: dnaAlphabet,
    detail: dnaAlphabet ? "ATCG only" : "empty or non-DNA characters",
  });

  const validLength = dna.length > 0 && dna.length <= 3_000 && dna.length % 3 === 0;
  checks.push({
    name: "length_and_reading_frame",
    passed: validLength,
    detail: `nucleotides=${dna.length} limit=3000 frame=${dna.length % 3}`,
  });

  const translated = dnaAlphabet && validLength ? translateDna(dna) : "";
  const names = ["flag", "donor", "dhfr", "acceptor", "snap"];
  const indices = names.map((name) => translated.indexOf(PROTEIN_COMPONENTS[name]));
  const ordered = indices.every((index) => index >= 0)
    && indices.every((index, position) => position === 0 || index > indices[position - 1]);
  checks.push({
    name: "component_identity_and_order",
    passed: ordered,
    detail: ordered ? "flag-donor-dhfr-acceptor-snap" : `component_indices=${indices.join(",")}`,
  });

  const exactTermini = ordered
    && indices[0] === 0
    && indices[4] + PROTEIN_COMPONENTS.snap.length === translated.length;
  checks.push({
    name: "exact_protein_termini",
    passed: exactTermini,
    detail: exactTermini ? "no terminal extras" : `amino_acids=${translated.length}`,
  });

  const linkers = ordered ? names.slice(0, -1).map((name, position) => {
    const start = indices[position] + PROTEIN_COMPONENTS[name].length;
    return translated.slice(start, indices[position + 1]);
  }) : [];
  const linkerAlphabet = linkers.length === 4 && linkers.every((linker) => /^[GS]+$/.test(linker));
  checks.push({
    name: "gs_only_linkers",
    passed: linkerAlphabet,
    detail: linkers.length === 4 ? `lengths=${linkers.map((linker) => linker.length).join(",")}` : "components unavailable",
  });

  const linkerLengths = linkerAlphabet && linkers.every((linker) => linker.length >= 5 && linker.length <= 20);
  checks.push({
    name: "linker_lengths",
    passed: linkerLengths,
    detail: linkers.length === 4 ? `lengths=${linkers.map((linker) => linker.length).join(",")} allowed=5-20` : "components unavailable",
  });

  const gc = slidingGcCheck(dna);
  checks.push({
    name: "sliding_gc_windows",
    passed: gc.passed,
    detail: `windows=${gc.windows} min_gc=${gc.minGc} max_gc=${gc.maxGc} allowed=15-35/50`,
  });

  return completeResult(checks, {
    task: "protein-assembly",
    terminal_bench_commit: TB21_COMMIT,
    nucleotides: dna.length,
    amino_acids: translated.length,
    component_indices: indices,
    linker_lengths: linkers.map((linker) => linker.length),
    gc_windows: gc.windows,
    min_gc_per_50: gc.minGc,
    max_gc_per_50: gc.maxGc,
  });
}

function gradeDbWalRecovery(candidateRoot) {
  const resultPath = path.join(path.resolve(candidateRoot), "recovered.json");
  const exists = fs.existsSync(resultPath);
  const checks = [{
    name: "recovered_json_exists",
    passed: exists,
    detail: exists ? "present" : "missing",
  }];
  if (!exists) return missingResult(checks, DB_WAL_CHECK_COUNT, "recovered.json");

  let data = null;
  let parseError = null;
  try {
    data = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }
  const validList = Array.isArray(data) && data.length > 0;
  checks.push({
    name: "valid_nonempty_json_list",
    passed: validList,
    detail: validList ? `records=${data.length}` : parseError || "not a non-empty list",
  });

  const schemaPassed = validList && data.every((record) => isRecord(record)
    && Number.isInteger(record.id)
    && typeof record.name === "string"
    && Number.isInteger(record.value));
  checks.push({
    name: "record_schema",
    passed: schemaPassed,
    detail: schemaPassed ? "integer id/value and string name" : "invalid record fields or types",
  });

  const records = schemaPassed ? data : [];
  const ids = records.map((record) => record.id);
  const sorted = records.length > 0 && ids.every((id, index) => index === 0 || id >= ids[index - 1]);
  checks.push({
    name: "sorted_by_id",
    passed: sorted,
    detail: `ids=${ids.join(",")}`,
  });

  const completeIds = records.length === DB_WAL_EXPECTED.length
    && ids.every((id, index) => id === DB_WAL_EXPECTED[index].id);
  checks.push({
    name: "all_eleven_ids",
    passed: completeIds,
    detail: `records=${records.length} expected=11`,
  });

  const recordsById = new Map(records.map((record) => [record.id, record]));
  const updatesExact = [1, 2].every((id) => sameRecord(recordsById.get(id), DB_WAL_EXPECTED[id - 1]));
  checks.push({
    name: "wal_updates_exact",
    passed: updatesExact,
    detail: updatesExact ? "ids 1-2 contain applied WAL values" : "stale or incorrect updated records",
  });

  const baseExact = [3, 4, 5].every((id) => sameRecord(recordsById.get(id), DB_WAL_EXPECTED[id - 1]));
  checks.push({
    name: "base_records_exact",
    passed: baseExact,
    detail: baseExact ? "ids 3-5 exact" : "base records differ",
  });

  const insertsExact = DB_WAL_EXPECTED.slice(5).every((expected) => sameRecord(recordsById.get(expected.id), expected));
  checks.push({
    name: "wal_inserts_exact",
    passed: insertsExact,
    detail: insertsExact ? "ids 6-11 exact" : "missing or incorrect WAL inserts",
  });

  const uniqueIds = records.length > 0 && new Set(ids).size === ids.length;
  checks.push({
    name: "no_duplicate_ids",
    passed: uniqueIds,
    detail: `unique=${new Set(ids).size} records=${records.length}`,
  });

  return completeResult(checks, {
    task: "db-wal-recovery",
    terminal_bench_commit: TB21_COMMIT,
    records: records.length,
    exact_records: DB_WAL_EXPECTED.filter((expected) => sameRecord(recordsById.get(expected.id), expected)).length,
  });
}

function translateDna(dna) {
  let protein = "";
  for (let index = 0; index < dna.length; index += 3) {
    protein += GENETIC_CODE[dna.slice(index, index + 3)] || "?";
  }
  return protein;
}

function slidingGcCheck(dna) {
  if (dna.length < 50 || !/^[ATCG]+$/.test(dna)) {
    return { passed: false, windows: 0, minGc: null, maxGc: null };
  }
  let current = [...dna.slice(0, 50)].filter((base) => base === "G" || base === "C").length;
  let minimum = current;
  let maximum = current;
  let passed = current >= 15 && current <= 35;
  for (let index = 50; index < dna.length; index += 1) {
    current += Number(dna[index] === "G" || dna[index] === "C");
    current -= Number(dna[index - 50] === "G" || dna[index - 50] === "C");
    minimum = Math.min(minimum, current);
    maximum = Math.max(maximum, current);
    if (current < 15 || current > 35) passed = false;
  }
  return { passed, windows: dna.length - 49, minGc: minimum, maxGc: maximum };
}

function sameRecord(actual, expected) {
  return isRecord(actual)
    && actual.id === expected.id
    && actual.name === expected.name
    && actual.value === expected.value;
}

function proteinOracleDna() {
  const aminoAcids = Object.values(PROTEIN_COMPONENTS).join("GSGSG");
  return [...aminoAcids].map((aminoAcid) => {
    const codon = PROTEIN_ORACLE_CODONS[aminoAcid];
    if (!codon) throw new Error(`Missing oracle codon for amino acid ${aminoAcid}`);
    return codon;
  }).join("");
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
  const supported = ["raman-fitting", "write-compressor", "protein-assembly", "db-wal-recovery"];
  const selected = name === "all" ? supported : [name];
  for (const taskId of selected) {
    if (!supported.includes(taskId)) {
      throw new Error(`Unknown self-test task: ${taskId}`);
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `pi-company-${taskId}-self-test-`));
    try {
      const cacheRoot = path.resolve(options.cacheRoot || path.join(os.tmpdir(), "pi-company-extra-grade-cache"));
      if (taskId === "raman-fitting") {
        const output = {};
        for (const [peak, fields] of Object.entries(RAMAN_EXPECTED)) {
          output[peak] = Object.fromEntries(Object.entries(fields).map(([field, expected]) => [field, expected.value]));
        }
        fs.writeFileSync(path.join(root, "results.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
      } else if (taskId === "write-compressor") {
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
      } else if (taskId === "protein-assembly") {
        for (const name of ["antibody.fasta", "pdb_ids.txt", "plasmid.gb"]) {
          const source = ensurePinnedFixture(`protein-assembly/${name}`, cacheRoot, options.proxyUrl);
          fs.copyFileSync(source, path.join(root, name));
        }
        fs.writeFileSync(path.join(root, "gblock.txt"), `${proteinOracleDna()}\n`, "utf8");
      } else {
        const database = ensurePinnedFixture("db-wal-recovery/main.db", cacheRoot, options.proxyUrl);
        const encryptedWal = ensurePinnedFixture("db-wal-recovery/main.db-wal.encrypted", cacheRoot, options.proxyUrl);
        const databasePath = path.join(root, "main.db");
        fs.copyFileSync(database, databasePath);
        const wal = Buffer.from(fs.readFileSync(encryptedWal));
        for (let index = 0; index < wal.length; index += 1) wal[index] ^= 0x42;
        fs.writeFileSync(path.join(root, "main.db-wal"), wal);
        const query = await spawnCaptured("sqlite3", [
          "-json",
          databasePath,
          "SELECT id, name, value FROM items ORDER BY id;",
        ], {
          timeoutMs: 30_000,
          maxOutputBytes: 1024 * 1024,
        });
        if (query.exitCode !== 0 || query.timedOut || query.outputOverflow) {
          throw new Error(`Reference WAL query failed: ${query.stderr.toString("utf8").slice(-2_000)}`);
        }
        fs.writeFileSync(path.join(root, "recovered.json"), query.stdout);
      }
      const oracle = await gradeExtraCandidate(taskId, root, options);
      if (oracle.reward !== 1) throw new Error(`${taskId} oracle self-test failed: ${JSON.stringify(oracle)}`);

      if (taskId === "raman-fitting") {
        fs.writeFileSync(path.join(root, "results.json"), "{}\n", "utf8");
      } else if (taskId === "write-compressor") {
        fs.writeFileSync(path.join(root, "data.comp"), Buffer.alloc(0));
      } else if (taskId === "protein-assembly") {
        fs.writeFileSync(path.join(root, "gblock.txt"), `${"ATG".repeat(100)}\n`, "utf8");
      } else {
        fs.writeFileSync(path.join(root, "recovered.json"), `${JSON.stringify(DB_WAL_EXPECTED.slice(0, 5))}\n`, "utf8");
      }
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
    throw new Error("Usage: node scripts/native-tbench-extra-grade.mjs --task raman-fitting|write-compressor|protein-assembly|db-wal-recovery --candidate PATH [--cache-root PATH] [--proxy URL] | --self-test all");
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
