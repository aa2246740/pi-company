import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  clampThinkingLevel,
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  streamOpenAICodexResponses,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";

export const CODEX_CLIENT_COMPAT_VERSION = "0.144.1";

function isCodexResponsesModel(
  model: Model<Api>,
): model is Model<"openai-codex-responses"> {
  return model.api === "openai-codex-responses";
}

function streamCompatible(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  if (!isCodexResponsesModel(model)) {
    throw new Error(`Codex compatibility wrapper received unsupported API: ${model.api}`);
  }
  const effort = options?.reasoning
    ? clampThinkingLevel(model, options.reasoning)
    : undefined;
  return streamOpenAICodexResponses(model, context, {
    ...options,
    headers: {
      ...options?.headers,
      Version: CODEX_CLIENT_COMPAT_VERSION,
    },
    reasoningEffort: effort && effort !== "off" ? effort : undefined,
  });
}

export default function codexClientCompatExtension(pi: ExtensionAPI): void {
  pi.registerProvider("native-tbench-codex-client-compat", {
    api: "openai-codex-responses",
    streamSimple: streamCompatible,
  });
}
