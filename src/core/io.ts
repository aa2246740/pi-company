import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
import type { CompanyEvent, CompanyPaths, MailboxMessage } from "./types.js";
import { mailboxPath } from "./paths.js";

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function atomicWriteText(file: string, text: string): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  atomicWriteText(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readYaml<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return YAML.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeYaml(file: string, value: unknown): void {
  atomicWriteText(file, YAML.stringify(value));
}

export function appendJsonl(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

export function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const entries = fs.readFileSync(file, "utf8")
    .split("\n")
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim().length > 0);
  const result: T[] = [];
  for (let i = 0; i < entries.length; i++) {
    const { line, index } = entries[i];
    try {
      result.push(JSON.parse(line) as T);
    } catch (error) {
      // A crash or full disk mid-append can leave a torn final line. Tolerate
      // that single case so one bad write cannot permanently brick the log.
      // Any earlier malformed line is real corruption and must surface loudly.
      if (i === entries.length - 1) break;
      throw new Error(`Corrupt JSONL in ${file} at line ${index + 1}: ${(error as Error).message}`);
    }
  }
  return result;
}

export function ensureCompanyDirs(paths: CompanyPaths): void {
  for (const dir of [
    paths.dir,
    paths.rolesDir,
    paths.mailboxesDir,
    paths.issuesDir,
    paths.prsDir,
    paths.worktreesDir,
    paths.runtimeDir,
    paths.runtimeAgentsDir,
    paths.runtimeRecoveryDir,
  ]) {
    ensureDir(dir);
  }
}

export function appendEvent(paths: CompanyPaths, event: CompanyEvent): void {
  appendJsonl(paths.events, event);
}

export function readEvents(paths: CompanyPaths): CompanyEvent[] {
  return readJsonl<CompanyEvent>(paths.events);
}

export function appendMailbox(paths: CompanyPaths, message: MailboxMessage): void {
  appendJsonl(mailboxPath(paths, message.to), message);
}

export function readMailbox(paths: CompanyPaths, agent: string): MailboxMessage[] {
  return readJsonl<MailboxMessage>(mailboxPath(paths, agent));
}
