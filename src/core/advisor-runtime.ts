import {
  complete,
  type Api,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";
import {
  ADVISOR_SYSTEM_PROMPT,
  buildAdvisorRequestText,
  buildAdvisorTranscript,
  extractVisibleAdvisorText,
  type AdvisorTranscriptResult,
  type PiSessionEntry,
} from "./advisor.js";
import type { AdvisorPolicy, PiModelConfig } from "./types.js";

export type AdvisorRuntimeErrorCode =
  | "not-configured"
  | "model-unavailable"
  | "auth-unavailable"
  | "empty-transcript"
  | "no-visible-text";

export class AdvisorRuntimeError extends Error {
  constructor(readonly code: AdvisorRuntimeErrorCode, message: string) {
    super(message);
    this.name = "AdvisorRuntimeError";
  }
}

export interface AdvisorModelRegistry {
  refresh?(): void;
  find(provider: string, modelId: string): Model<Api> | undefined;
  getApiKeyAndHeaders(model: Model<Api>): Promise<
    | { ok: true; apiKey?: string; headers?: Record<string, string> }
    | { ok: false; error: string }
  >;
}

export interface AdvisorTarget {
  model: Model<Api>;
  apiKey?: string;
  headers?: Record<string, string>;
  thinking?: string;
}

export interface AdvisorCompleteResponse {
  content?: unknown[];
  stopReason?: string;
  usage?: unknown;
}

export type AdvisorCompleteFn = (
  model: Model<Api>,
  context: Context,
  options: Record<string, unknown>,
) => Promise<AdvisorCompleteResponse>;

export interface RunAdvisorInput {
  target: AdvisorTarget;
  policy: AdvisorPolicy;
  branch: PiSessionEntry[];
  companyContext: string;
  signal?: AbortSignal;
  sessionId?: string;
  completeFn?: AdvisorCompleteFn;
}

export interface AdvisorCompletionResult {
  text: string;
  model: { provider: string; id: string };
  thinking?: string;
  stopReason: string;
  usage?: unknown;
  transcript: AdvisorTranscriptResult;
  companyContextChars: number;
  requestChars: number;
  maxOutputTokens: number;
  durationMs: number;
}

export async function resolveAdvisorTarget(
  registry: AdvisorModelRegistry,
  config: PiModelConfig | null | undefined,
): Promise<AdvisorTarget> {
  const provider = config?.provider?.trim();
  const modelId = config?.model?.trim();
  if (!provider || !modelId) {
    throw new AdvisorRuntimeError(
      "not-configured",
      "Advisor is not configured, so no transcript was sent. As lead, run /company-configure-models and configure Role default: advisor to a trusted stronger model.",
    );
  }

  try {
    registry.refresh?.();
  } catch {
    // The registry's last known model set remains usable after a refresh error.
  }

  const model = registry.find(provider, modelId);
  if (!model) {
    throw new AdvisorRuntimeError(
      "model-unavailable",
      `Configured advisor model ${provider}/${modelId} is not available in this Pi session. Run /company-configure-models and choose an available model.`,
    );
  }

  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new AdvisorRuntimeError(
      "auth-unavailable",
      `Configured advisor model ${provider}/${modelId} has no usable authentication: ${auth.error}`,
    );
  }

  return {
    model,
    apiKey: auth.apiKey,
    headers: auth.headers,
    thinking: normalizeThinking(config?.thinking),
  };
}

export async function runAdvisorCompletion(input: RunAdvisorInput): Promise<AdvisorCompletionResult> {
  const { target, policy } = input;
  const maxOutputTokens = Math.max(256, Math.min(policy.max_output_tokens, target.model.maxTokens));
  const maxInputChars = modelInputCharBudget(target.model, maxOutputTokens);
  const companyContextLimit = Math.max(
    1_000,
    Math.min(policy.max_company_context_chars, Math.floor(maxInputChars * 0.25)),
  );
  const companyContext = truncateWithNotice(input.companyContext.trim(), companyContextLimit);
  const transcriptLimit = Math.max(
    1_000,
    Math.min(policy.max_transcript_chars, maxInputChars - companyContext.length - 4_000),
  );
  const transcript = buildAdvisorTranscript(input.branch, {
    maxChars: transcriptLimit,
    maxToolArgumentChars: 1_200,
    maxToolResultChars: 6_000,
  });
  if (!transcript.text.trim()) {
    throw new AdvisorRuntimeError("empty-transcript", "Advisor found no active conversation transcript to review.");
  }

  const requestText = buildAdvisorRequestText(companyContext, transcript);
  const options: Record<string, unknown> = {
    apiKey: target.apiKey,
    headers: target.headers,
    signal: input.signal,
    timeoutMs: policy.timeout_ms,
    maxTokens: maxOutputTokens,
    maxRetries: 1,
    maxRetryDelayMs: 30_000,
  };
  if (target.thinking) options.reasoningEffort = target.thinking;
  if (input.sessionId) options.sessionId = input.sessionId;

  const startedAt = Date.now();
  const invoke = input.completeFn ?? defaultComplete;
  const response = await invoke(
    target.model,
    {
      systemPrompt: ADVISOR_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [{ type: "text", text: requestText }],
        timestamp: Date.now(),
      }],
    },
    options,
  );
  const text = extractVisibleAdvisorText(response.content);
  if (!text) {
    throw new AdvisorRuntimeError(
      "no-visible-text",
      `Advisor returned no visible text (stop reason: ${response.stopReason ?? "unknown"}).`,
    );
  }

  return {
    text,
    model: { provider: target.model.provider, id: target.model.id },
    thinking: target.thinking,
    stopReason: response.stopReason ?? "unknown",
    usage: response.usage,
    transcript,
    companyContextChars: companyContext.length,
    requestChars: requestText.length,
    maxOutputTokens,
    durationMs: Date.now() - startedAt,
  };
}

function modelInputCharBudget(model: Model<Api>, outputTokens: number): number {
  const reservedTokens = outputTokens + 2_000;
  const usableTokens = Math.max(2_000, model.contextWindow - reservedTokens);
  return Math.max(8_000, Math.floor(usableTokens * 3.5));
}

function truncateWithNotice(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const notice = `\n[truncated ${text.length - maxChars} company-context chars]`;
  return `${text.slice(0, Math.max(0, maxChars - notice.length))}${notice}`;
}

function normalizeThinking(value: string | null | undefined): string | undefined {
  return value && ["off", "minimal", "low", "medium", "high", "xhigh"].includes(value)
    ? value
    : undefined;
}

const defaultComplete: AdvisorCompleteFn = async (model, context, options) => complete(model, context, options);
