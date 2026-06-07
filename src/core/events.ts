import type { CompanyEvent, EventType } from "./types.js";
import { newId, nowIso } from "./id.js";

export function makeEvent<T extends Record<string, unknown>>(
  type: EventType,
  actor: string,
  data: T,
): CompanyEvent<T> {
  return {
    id: newId("evt"),
    ts: nowIso(),
    type,
    actor,
    data,
  };
}
