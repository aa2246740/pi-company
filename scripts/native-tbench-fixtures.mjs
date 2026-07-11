import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TB21_COMMIT = "a0c400b1138e8c2272c2fc7daa4fa35199b43bef";

const FIXTURES = {
  "raman-fitting/graphene.dat": {
    repositoryPath: "tasks/raman-fitting/environment/task-deps/graphene.dat",
    bytes: 88_805,
    sha256: "cac96a29e73251e625cb2d17b5079250071b148e6792e0aa349632953dbfa094",
  },
  "write-compressor/decomp.c": {
    repositoryPath: "tasks/write-compressor/environment/decomp.c",
    bytes: 1_262,
    sha256: "7f8d9ef66943f912a217aa48f4ef5efc967b44c2b21d0f56df029b5ab413f62a",
  },
  "write-compressor/data.txt": {
    repositoryPath: "tasks/write-compressor/environment/data.txt",
    bytes: 4_868,
    sha256: "0fc483d0fb31128dfa41ed11adca56c88688888189826ef9daeafd7559b4fa4e",
  },
  "write-compressor/main.rs": {
    repositoryPath: "tasks/write-compressor/environment/main.rs",
    bytes: 24_564,
    sha256: "fa53d6572fca95903e30d2d953f1e428bb8b63513ff218ebee9bc60a425ab389",
  },
};

export function ensurePinnedFixture(name, cacheRoot, proxyUrl = null) {
  const fixture = FIXTURES[name];
  if (!fixture) throw new Error(`Unknown Terminal-Bench fixture: ${name}`);
  const target = path.join(path.resolve(cacheRoot), ...name.split("/"));
  if (fs.existsSync(target) && verifyFixture(target, fixture)) return target;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const url = `https://raw.githubusercontent.com/harbor-framework/terminal-bench-2-1/${TB21_COMMIT}/${fixture.repositoryPath}`;
  const args = ["-fsSL", "--retry", "3", "--connect-timeout", "20"];
  if (proxyUrl) args.push("--proxy", proxyUrl);
  args.push(url);
  const result = spawnSync("curl", args, {
    encoding: null,
    maxBuffer: 2 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(`Failed to download ${name}: ${Buffer.from(result.stderr || "").toString("utf8").slice(-1_000)}`);
  }
  const data = Buffer.from(result.stdout || "");
  if (!verifyData(data, fixture)) {
    throw new Error(`Downloaded fixture failed integrity verification: ${name}`);
  }
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, data);
  fs.renameSync(temporary, target);
  return target;
}

export function copyPinnedFixture(name, destination, cacheRoot, proxyUrl = null) {
  const source = ensurePinnedFixture(name, cacheRoot, proxyUrl);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return destination;
}

export function compileDeterministicDecompressor(destination, cacheRoot, proxyUrl = null) {
  const sourcePath = ensurePinnedFixture("write-compressor/decomp.c", cacheRoot, proxyUrl);
  const source = fs.readFileSync(sourcePath, "utf8");
  const needle = "char buf[10000];";
  if (!source.includes(needle)) throw new Error("Pinned decompressor layout changed; cannot remove native printf undefined behavior");
  const nativeSource = source.replace(needle, "char buf[10000] = {0};");
  const nativeSourcePath = path.join(path.resolve(cacheRoot), "write-compressor", "decomp.native.c");
  fs.mkdirSync(path.dirname(nativeSourcePath), { recursive: true });
  fs.writeFileSync(nativeSourcePath, nativeSource, "utf8");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const compile = spawnSync("cc", ["-O3", nativeSourcePath, "-o", destination], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (compile.status !== 0) {
    throw new Error(`Failed to compile deterministic native decompressor: ${compile.stderr || compile.stdout}`);
  }
  fs.chmodSync(destination, 0o755);
  return destination;
}

function verifyFixture(file, fixture) {
  const data = fs.readFileSync(file);
  return verifyData(data, fixture);
}

function verifyData(data, fixture) {
  return data.length === fixture.bytes
    && crypto.createHash("sha256").update(data).digest("hex") === fixture.sha256;
}
