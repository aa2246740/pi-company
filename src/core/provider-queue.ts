import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PROVIDER_REQUEST_POLICY } from "./defaults.js";
import { atomicWriteText, ensureDir, readJson } from "./io.js";
import { companyPaths } from "./paths.js";
import type { ProviderRequestPolicy } from "./types.js";

const PROVIDER_LOCK_STALE_MS = 10_000;
const PROVIDER_LOCK_TIMEOUT_MS = 60_000;

export interface ProviderQueueState {
  provider: string;
  last_started_at?: string | null;
  leases: ProviderLeaseRecord[];
}

interface ProviderLeaseRecord {
  id: string;
  provider: string;
  agent: string;
  started_at: string;
  expires_at: string;
}

export interface ProviderRequestLease extends ProviderLeaseRecord {
  waited_ms: number;
}

export function normalizeProviderRequestPolicy(policy?: Partial<ProviderRequestPolicy> | null): ProviderRequestPolicy {
  return {
    max_concurrent_per_provider: finitePositiveInteger(
      policy?.max_concurrent_per_provider,
      DEFAULT_PROVIDER_REQUEST_POLICY.max_concurrent_per_provider,
    ),
    min_start_interval_ms: finiteNonNegativeNumber(
      policy?.min_start_interval_ms,
      DEFAULT_PROVIDER_REQUEST_POLICY.min_start_interval_ms,
    ),
    lease_timeout_ms: finitePositiveNumber(
      policy?.lease_timeout_ms,
      DEFAULT_PROVIDER_REQUEST_POLICY.lease_timeout_ms,
    ),
    poll_interval_ms: finitePositiveNumber(
      policy?.poll_interval_ms,
      DEFAULT_PROVIDER_REQUEST_POLICY.poll_interval_ms,
    ),
  };
}

export async function acquireProviderRequestLease(
  root: string,
  provider: string,
  agent: string,
  policyInput?: Partial<ProviderRequestPolicy> | null,
): Promise<ProviderRequestLease> {
  const policy = normalizeProviderRequestPolicy(policyInput);
  const startedWaiting = Date.now();
  const normalizedProvider = normalizeProviderName(provider);

  for (;;) {
    const result = await withProviderQueueLock(root, normalizedProvider, () => {
      const now = Date.now();
      const state = readProviderQueueState(root, normalizedProvider);
      state.leases = activeLeases(state.leases, now);

      const concurrencyWaitMs = concurrencyWait(state.leases, policy, now);
      const intervalWaitMs = startIntervalWait(state.last_started_at ?? null, policy, now);
      const waitMs = Math.max(concurrencyWaitMs, intervalWaitMs);
      if (waitMs > 0) {
        writeProviderQueueState(root, normalizedProvider, state);
        return { kind: "wait" as const, waitMs };
      }

      const lease: ProviderRequestLease = {
        id: `${process.pid}-${now}-${Math.random().toString(36).slice(2, 10)}`,
        provider: normalizedProvider,
        agent,
        started_at: new Date(now).toISOString(),
        expires_at: new Date(now + policy.lease_timeout_ms).toISOString(),
        waited_ms: now - startedWaiting,
      };
      state.last_started_at = lease.started_at;
      state.leases.push(lease);
      writeProviderQueueState(root, normalizedProvider, state);
      return { kind: "acquired" as const, lease };
    });

    if (result.kind === "acquired") return result.lease;
    await sleep(Math.min(result.waitMs, policy.poll_interval_ms));
  }
}

export async function releaseProviderRequestLease(root: string, lease: Pick<ProviderRequestLease, "provider" | "id">): Promise<void> {
  await withProviderQueueLock(root, lease.provider, () => {
    const now = Date.now();
    const state = readProviderQueueState(root, lease.provider);
    state.leases = activeLeases(state.leases, now).filter((item) => item.id !== lease.id);
    writeProviderQueueState(root, lease.provider, state);
    return null;
  });
}

export function providerQueueSnapshot(root: string, provider: string): ProviderQueueState {
  const normalizedProvider = normalizeProviderName(provider);
  const state = readProviderQueueState(root, normalizedProvider);
  return {
    ...state,
    leases: activeLeases(state.leases, Date.now()),
  };
}

function concurrencyWait(leases: ProviderLeaseRecord[], policy: ProviderRequestPolicy, now: number): number {
  if (leases.length < policy.max_concurrent_per_provider) return 0;
  const nextExpiry = leases
    .map((lease) => Date.parse(lease.expires_at))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  if (!nextExpiry) return policy.poll_interval_ms;
  return Math.max(policy.poll_interval_ms, nextExpiry - now);
}

function startIntervalWait(lastStartedAt: string | null, policy: ProviderRequestPolicy, now: number): number {
  if (!lastStartedAt || policy.min_start_interval_ms <= 0) return 0;
  const last = Date.parse(lastStartedAt);
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, last + policy.min_start_interval_ms - now);
}

function activeLeases(leases: ProviderLeaseRecord[], now: number): ProviderLeaseRecord[] {
  return leases.filter((lease) => {
    const expiresAt = Date.parse(lease.expires_at);
    return Number.isFinite(expiresAt) && expiresAt > now;
  });
}

async function withProviderQueueLock<T>(root: string, provider: string, fn: () => T): Promise<T> {
  const lockDir = providerQueueLockDir(root, provider);
  const token = await acquireLockDir(lockDir);
  try {
    return fn();
  } finally {
    releaseLockDir(lockDir, token);
  }
}

async function acquireLockDir(lockDir: string): Promise<string> {
  ensureDir(path.dirname(lockDir));
  const token = crypto.randomUUID();
  const startedAt = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, "owner.json"), `${JSON.stringify({ token })}\n`, "utf8");
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      removeStaleLock(lockDir);
      if (Date.now() - startedAt > PROVIDER_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for provider-queue lock at ${lockDir}.`);
      }
      await sleep(50);
    }
  }
}

function releaseLockDir(lockDir: string, token: string): void {
  if (readLockToken(lockDir) === token) {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

function readLockToken(lockDir: string): string | null {
  try {
    return (JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8")) as { token?: string }).token ?? null;
  } catch {
    return null;
  }
}

function removeStaleLock(lockDir: string): void {
  try {
    const stat = fs.statSync(lockDir);
    if (Date.now() - stat.mtimeMs <= PROVIDER_LOCK_STALE_MS) return;
    // Claim the stale lock via a unique tombstone rename so two racing waiters
    // cannot both delete it and then both acquire it.
    const tombstone = `${lockDir}.stale.${process.pid}.${crypto.randomUUID()}`;
    fs.renameSync(lockDir, tombstone);
    fs.rmSync(tombstone, { recursive: true, force: true });
  } catch {
    // Another process may have released or already claimed the lock.
  }
}

function readProviderQueueState(root: string, provider: string): ProviderQueueState {
  return readJson<ProviderQueueState>(providerQueuePath(root, provider), {
    provider,
    last_started_at: null,
    leases: [],
  });
}

function writeProviderQueueState(root: string, provider: string, state: ProviderQueueState): void {
  const file = providerQueuePath(root, provider);
  atomicWriteText(file, `${JSON.stringify({ ...state, provider }, null, 2)}\n`);
}

function providerQueuePath(root: string, provider: string): string {
  return path.join(providerQueueDir(root), `${safeProviderFileName(provider)}.json`);
}

function providerQueueLockDir(root: string, provider: string): string {
  return path.join(providerQueueDir(root), `${safeProviderFileName(provider)}.lock`);
}

function providerQueueDir(root: string): string {
  return path.join(companyPaths(root).dir, "provider-queue");
}

function normalizeProviderName(provider: string): string {
  return provider.trim() || "unknown-provider";
}

function safeProviderFileName(provider: string): string {
  return provider.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 120) || "unknown-provider";
}

function finitePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function finitePositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
