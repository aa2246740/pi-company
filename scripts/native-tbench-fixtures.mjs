import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

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
  "dna-insert/sequences.fasta": {
    repositoryPath: "tasks/dna-insert/environment/sequences.fasta",
    bytes: 7_238,
    sha256: "aebe50fe8d43bb432925537aeb2be63abce3fcc259a1e04e0a37ce7af8da3da0",
  },
  "dna-insert/test_outputs.py": {
    repositoryPath: "tasks/dna-insert/tests/test_outputs.py",
    bytes: 3_588,
    sha256: "5bf0651b48969968dea30956d4b0cf9e499af59d73cc6886af3ad7aa92934647",
  },
  "dna-assembly/sequences.fasta": {
    repositoryPath: "tasks/dna-assembly/environment/sequences.fasta",
    bytes: 7_712,
    sha256: "ebdc361b5fba28eb0a2c7a8a8a444ccb12cc842c8cbc6df5a2c24254f130736f",
  },
  "dna-assembly/test_outputs.py": {
    repositoryPath: "tasks/dna-assembly/tests/test_outputs.py",
    bytes: 14_105,
    sha256: "5c2d0fd2e5f6303263e9750f67acda7db491ef04841832b4fc62bcfb61b08924",
  },
  "gcode-to-text/text.gcode.gz": {
    repositoryPath: "tasks/gcode-to-text/environment/text.gcode.gz",
    bytes: 433_196,
    sha256: "edc008516eb0c30cd2540649642c52f78894b99dc4f79547064e9ffbfbc0e55f",
  },
  "video-processing/example_video.mp4": {
    repositoryPath: "tasks/video-processing/environment/example_video.mp4",
    bytes: 551_877,
    sha256: "69ac53c9b4302225e3bdf5b94970e29dade7d800ba07109c2691604b2cac69ad",
  },
  "video-processing/test_video.mp4": {
    repositoryPath: "tasks/video-processing/tests/test_video.mp4",
    bytes: 964_534,
    sha256: "46b237abcaff81c7d3817f2943da1b913f4ab0106d62afb4be73f67259f09c7a",
  },
  "extract-elf/hi.c": {
    repositoryPath: "tasks/extract-elf/environment/task-deps/hi.c",
    bytes: 61,
    sha256: "9f6343607512e0439ba459adc5cbf209691332afd93f39360b0b261afd6cb0f2",
  },
  "extract-elf/solve.sh": {
    repositoryPath: "tasks/extract-elf/solution/solve.sh",
    bytes: 9_479,
    sha256: "c72b1715a26c4eefe4c53934243a1d67f7560b3c126f82d2c98c92870f69df40",
  },
  "path-tracing-reverse/orig.c": {
    repositoryPath: "tasks/path-tracing-reverse/environment/orig.c",
    bytes: 9_425,
    sha256: "26ce745d2921d8e1e9df3e162733a6cf5eceac5b9cb2ffa6a5ff5c4e4d049752",
  },
  "path-tracing-reverse/solve.sh": {
    repositoryPath: "tasks/path-tracing-reverse/solution/solve.sh",
    bytes: 4_011,
    sha256: "3489e31c60b7ad7ea1c22035143b6d130cc864427db867234ae8c416b296a2d2",
  },
  "regex-chess/check.py": {
    repositoryPath: "tasks/regex-chess/environment/check.py",
    bytes: 4_412,
    sha256: "f9c416ae9ea01dcdd5f6a43170c8434b8c0a0b389a4a30876a2048e277d191c7",
  },
  "regex-chess/test_outputs.py": {
    repositoryPath: "tasks/regex-chess/tests/test_outputs.py",
    bytes: 5_356,
    sha256: "4983c44d21c56dd8191381eff0304afc8b87bb714527ea9036b3319c015a30b4",
  },
  "regex-chess/solve.sh": {
    repositoryPath: "tasks/regex-chess/solution/solve.sh",
    bytes: 72_716,
    sha256: "b728bf0ea392a3d244afbd0818d36933c8d3e190e47743c1382cd518d518a2e9",
  },
  "polyglot-rust-c/solve.sh": {
    repositoryPath: "tasks/polyglot-rust-c/solution/solve.sh",
    bytes: 2_255,
    sha256: "f3b101d9528efb3997937fa134b10e3773521bf83d576dab3183e977d12c9638",
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

export function materializePinnedGcode(destination, cacheRoot, proxyUrl = null) {
  const source = ensurePinnedFixture("gcode-to-text/text.gcode.gz", cacheRoot, proxyUrl);
  const data = zlib.gunzipSync(fs.readFileSync(source));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, data);
  return destination;
}

export function compilePinnedElfFixture(destination, cacheRoot, proxyUrl = null) {
  const source = ensurePinnedFixture("extract-elf/hi.c", cacheRoot, proxyUrl);
  return compile("zig", ["cc", "-target", "x86_64-linux-gnu", source, "-o", destination], destination);
}

export function compilePinnedPathMystery(destination, cacheRoot, proxyUrl = null) {
  const source = ensurePinnedFixture("path-tracing-reverse/orig.c", cacheRoot, proxyUrl);
  return compile("cc", ["-O2", source, "-lm", "-o", destination], destination);
}

function compile(command, args, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 120_000 });
  if (result.status !== 0) {
    throw new Error(`Failed to compile ${path.basename(destination)}: ${result.error?.message || result.stderr || result.stdout}`);
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
