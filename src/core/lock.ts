import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./io.js";
import { companyPaths } from "./paths.js";

const COMPANY_LOCK_STALE_MS = 120_000;
const COMPANY_LOCK_POLL_MS = 25;
const COMPANY_LOCK_TIMEOUT_MS = 300_000;

export function withCompanyLock<T>(root: string, fn: () => T): T {
  const lockDir = companyLockDir(root);
  const token = acquireCompanyLock(lockDir);
  try {
    return fn();
  } finally {
    releaseCompanyLock(lockDir, token);
  }
}

function companyLockDir(root: string): string {
  return path.join(companyPaths(root).dir, "company.lock");
}

interface LockOwner {
  pid: number;
  token: string;
  started_at: string;
}

function acquireCompanyLock(lockDir: string): string {
  ensureDir(path.dirname(lockDir));
  const token = crypto.randomUUID();
  const startedAt = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      const owner: LockOwner = { pid: process.pid, token, started_at: new Date().toISOString() };
      fs.writeFileSync(path.join(lockDir, "owner.json"), `${JSON.stringify(owner)}\n`, "utf8");
      return token;
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

function releaseCompanyLock(lockDir: string, token: string): void {
  // Only remove the lock if we still own it. A long critical section can be
  // declared stale and stolen by another process; removing it blindly would
  // delete the new holder's lock and let two processes run concurrently.
  if (readLockOwner(lockDir)?.token === token) {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

function readLockOwner(lockDir: string): LockOwner | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8")) as LockOwner;
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH => no such process. EPERM => process exists but not ours.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function removeStaleCompanyLock(lockDir: string): void {
  try {
    const stat = fs.statSync(lockDir);
    const owner = readLockOwner(lockDir);
    // A dead owning process is authoritative. A missing owner record falls back
    // to the mtime age threshold — this both handles crashes that left no
    // record and avoids reclaiming a lock that was just created but whose
    // owner.json has not been written yet (a fresh dir is not stale).
    const stale = owner ? !processIsAlive(owner.pid) : Date.now() - stat.mtimeMs > COMPANY_LOCK_STALE_MS;
    if (!stale) return;
    // Claim the stale lock by renaming it to a unique tombstone first. Only one
    // racing process can win the rename, so a loser cannot delete the lock that
    // the winner (or a freshly recreated holder) then takes.
    const tombstone = `${lockDir}.stale.${process.pid}.${crypto.randomUUID()}`;
    fs.renameSync(lockDir, tombstone);
    fs.rmSync(tombstone, { recursive: true, force: true });
  } catch {
    // Another process may have released or already claimed the lock.
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
