import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import {
  AdvisorRuntimeError,
  resolveAdvisorTarget,
  runAdvisorCompletion,
  type AdvisorCompleteFn,
  type AdvisorModelRegistry,
} from "../src/core/advisor-runtime.js";
import { DEFAULT_ADVISOR_POLICY } from "../src/core/defaults.js";

describe("advisor runtime", () => {
  it("does not resolve or send anything without an explicitly configured advisor model", async () => {
    const registry = fakeRegistry();

    await expect(resolveAdvisorTarget(registry, null)).rejects.toMatchObject({
      code: "not-configured",
    });
    expect(registry.find).not.toHaveBeenCalled();
    expect(registry.getApiKeyAndHeaders).not.toHaveBeenCalled();
  });

  it("reports unavailable models and authentication before a transcript is built", async () => {
    const missing = fakeRegistry({ model: undefined });
    await expect(resolveAdvisorTarget(missing, { provider: "strong", model: "reasoner" }))
      .rejects.toMatchObject({ code: "model-unavailable" });

    const unauthenticated = fakeRegistry({ auth: { ok: false, error: "login required" } });
    await expect(resolveAdvisorTarget(unauthenticated, { provider: "strong", model: "reasoner" }))
      .rejects.toMatchObject({ code: "auth-unavailable" });
  });

  it("accepts Pi 0.80 max thinking for an advisor target", async () => {
    const target = await resolveAdvisorTarget(fakeRegistry(), {
      provider: "strong",
      model: "reasoner",
      thinking: "max",
    });

    expect(target.thinking).toBe("max");
  });

  it("omits Pi's reasoning option when advisor thinking is off", async () => {
    const target = await resolveAdvisorTarget(fakeRegistry(), {
      provider: "strong",
      model: "reasoner",
      thinking: "off",
    });

    expect(target.thinking).toBeUndefined();
  });

  it("sends bounded untrusted context through Pi complete and returns visible advice", async () => {
    const registry = fakeRegistry();
    const target = await resolveAdvisorTarget(registry, {
      provider: "strong",
      model: "reasoner",
      thinking: "high",
    });
    const completeFn = vi.fn<AdvisorCompleteFn>(async () => ({
      content: [
        { type: "thinking", thinking: "private" },
        { type: "text", text: "Verdict: proceed.\n\nRisks: stale test evidence." },
      ],
      stopReason: "stop",
      usage: { input: 123, output: 45 },
    }));
    const onRequestStart = vi.fn();

    const result = await runAdvisorCompletion({
      target,
      policy: { ...DEFAULT_ADVISOR_POLICY, max_company_context_chars: 1_000 },
      companyContext: `lead brief ${"x".repeat(2_000)}`,
      branch: [{ type: "message", message: { role: "user", content: "Plan the change." } }],
      sessionId: "advisor-session",
      completeFn,
      onRequestStart,
    });

    expect(result.text).toContain("Verdict: proceed");
    expect(result.companyContextChars).toBeLessThanOrEqual(1_000);
    expect(result.model).toEqual({ provider: "strong", id: "reasoner" });
    expect(result.transcript.stats.included).toBe(1);
    expect(onRequestStart).toHaveBeenCalledOnce();
    const [, context, options] = completeFn.mock.calls[0];
    expect(context.systemPrompt).toContain("untrusted evidence");
    const content = context.messages[0].content;
    const requestText = Array.isArray(content)
      ? content.flatMap((block) => typeof block === "object" && block && "text" in block ? [String(block.text)] : []).join("\n")
      : String(content);
    expect(requestText).toContain("Plan the change.");
    expect(requestText).toContain("truncated");
    expect(options).toMatchObject({
      apiKey: "secret",
      env: { ADVISOR_ACCOUNT: "test" },
      reasoning: "high",
      maxTokens: DEFAULT_ADVISOR_POLICY.max_output_tokens,
      timeoutMs: DEFAULT_ADVISOR_POLICY.timeout_ms,
      sessionId: "advisor-session",
    });
    expect(options.onPayload).toEqual(expect.any(Function));
  });

  it("does not mark a request started when an adapter fails before payload construction", async () => {
    const target = await resolveAdvisorTarget(fakeRegistry(), {
      provider: "strong",
      model: "reasoner",
      thinking: "high",
    });
    const onRequestStart = vi.fn();

    await expect(runAdvisorCompletion({
      target,
      policy: { ...DEFAULT_ADVISOR_POLICY },
      companyContext: "Company state",
      branch: [{ type: "message", message: { role: "user", content: "Plan the change." } }],
      completeFn: vi.fn(async () => {
        throw new Error("adapter failed before payload");
      }),
      onRequestStart,
    })).rejects.toThrow("adapter failed before payload");

    expect(onRequestStart).not.toHaveBeenCalled();
  });

  it("rejects empty branches and reasoning-only advisor responses", async () => {
    const target = await resolveAdvisorTarget(fakeRegistry(), { provider: "strong", model: "reasoner" });
    const completeFn = vi.fn<AdvisorCompleteFn>(async () => ({
      content: [{ type: "thinking", thinking: "private only" }],
      stopReason: "length",
    }));

    await expect(runAdvisorCompletion({
      target,
      policy: DEFAULT_ADVISOR_POLICY,
      companyContext: "brief",
      branch: [],
      completeFn,
    })).rejects.toMatchObject({ code: "empty-transcript" });
    expect(completeFn).not.toHaveBeenCalled();

    await expect(runAdvisorCompletion({
      target,
      policy: DEFAULT_ADVISOR_POLICY,
      companyContext: "brief",
      branch: [{ type: "message", message: { role: "user", content: "Review this." } }],
      completeFn,
    })).rejects.toEqual(expect.objectContaining<Partial<AdvisorRuntimeError>>({
      code: "no-visible-text",
    }));
  });
});

function fakeRegistry(options: {
  model?: Model<Api>;
  auth?: { ok: true; apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> } | { ok: false; error: string };
} = {}): AdvisorModelRegistry & {
  find: ReturnType<typeof vi.fn>;
  getApiKeyAndHeaders: ReturnType<typeof vi.fn>;
} {
  const hasModelOption = Object.prototype.hasOwnProperty.call(options, "model");
  const model = hasModelOption ? options.model : fakeModel();
  return {
    refresh: vi.fn(),
    find: vi.fn(() => model),
    getApiKeyAndHeaders: vi.fn(async () => options.auth ?? {
      ok: true as const,
      apiKey: "secret",
      env: { ADVISOR_ACCOUNT: "test" },
    }),
  };
}

function fakeModel(): Model<Api> {
  return {
    id: "reasoner",
    name: "Reasoner",
    provider: "strong",
    api: "faux",
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}
