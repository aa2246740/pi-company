import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./io.js";
import { companyPaths } from "./paths.js";

const COMPANY_LOCK_STALE_MS = 120_000;
const COMPANY_LOCK_POLL_MS = 25;
const COMPANY_LOCK_TIMEOUT_MS = 300_000;

export function withCompanyLock<T>(root: string, fn: () => T): T {
  const lockDir = companyLockDir(root);
  acquireCompanyLock(lockDir);
  try {
    return fn();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

function companyLockDir(root: string): string {
  return path.join(companyPaths(root).dir, "company.lock");
}

function acquireCompanyLock(lockDir: string): void {
  ensureDir(path.dirname(lockDir));
  const startedAt = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, "owner.json"), `${JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
      })}\n`, "utf8");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      removeStaleCompanyLock(lockDir);
      if (Date.now() - startedAt > COMPANY_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for pi-company lock at ${lockDir}.`);
      }
      sleepSync(COMPANY_LOCK_POLL_MS);
    }
  }
}

function removeStaleCompanyLock(lockDir: string): void {
  try {
    const stat = fs.statSync(lockDir);
    if (Date.now() - stat.mtimeMs > COMPANY_LOCK_STALE_MS) {
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  } catch {
    // Another process may have released the lock.
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
