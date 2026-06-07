import type { RateLimitKind } from "./types.js";

export interface RateLimitClassification {
  kind: Exclude<RateLimitKind, "manual">;
  reason: string;
}

export function classifyRateLimitText(text: string): RateLimitClassification | null {
  const reason = compactRateLimitReason(text);
  if (!reason) return null;
  if (isQuotaExhaustionFailure(reason)) {
    return { kind: "quota_exhausted", reason };
  }
  if (isProviderRateLimitFailure(reason)) {
    return { kind: "provider_429", reason };
  }
  return null;
}

function compactRateLimitReason(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !isPiCompanyRateLimitStatusLine(line))
    .filter(Boolean);
  const interesting = lines.filter((line) =>
    isProviderRateLimitFailure(line) ||
    isQuotaExhaustionFailure(line)
  );
  const selected = interesting.length > 0 ? interesting : lines;
  return selected.join(" ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function isQuotaExhaustionFailure(text: string): boolean {
  return /(?:quota|credit|credits|billing|balance).{0,80}(?:exhausted|depleted|insufficient|used up|out of|exceeded|over limit|limit reached|hard limit)/i.test(text) ||
    /(?:exhausted|depleted|insufficient|used up|out of|exceeded|over limit|limit reached|hard limit).{0,80}(?:quota|credit|credits|billing|balance)/i.test(text) ||
    /(?:额度|配额|余额|用量额度).{0,40}(?:不足|用完|耗尽|超限|超过|已达|达到上限|超出|不够)/i.test(text) ||
    /(?:不足|用完|耗尽|超限|超过|已达|达到上限|超出|不够).{0,40}(?:额度|配额|余额|用量额度)/i.test(text);
}

function isProviderRateLimitFailure(text: string): boolean {
  return hasExplicit429FailureContext(text) ||
    /too many requests|retry failed after \d+ attempts|rate[- ]?limit(?:ed| exceeded| error| failure| reached| hit)|限流/i.test(text);
}

function hasExplicit429FailureContext(text: string): boolean {
  return /(?:error|http|status|response|retry|failed|failure|too many requests?|too many).{0,80}\b429\b/i.test(text) ||
    /\b429\b.{0,80}(?:too many requests|too many|error|failed|failure|retry|rate[- ]?limit(?:ed| exceeded| error| failure| reached| hit)?)/i.test(text);
}

function isPiCompanyRateLimitStatusLine(line: string): boolean {
  return /^rate-limit:\s+(active|recent)\b/i.test(line) ||
    /^Rate Limit:\s*$/i.test(line) ||
    /^-\s+incidents=\d+\s+reported_by=/i.test(line) ||
    /^-\s+reason:\s+/i.test(line) ||
    /organization rate-limit backoff until/i.test(line) ||
    /Organization paused until/i.test(line) ||
    /\bprovider_429\s+until\b/i.test(line) ||
    /\bquota_exhausted\s+until\b/i.test(line);
}
