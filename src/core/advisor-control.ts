import { readEvents } from "./io.js";
import { companyPaths } from "./paths.js";

export type AdvisorTriggerReason =
  | "repeated_tool_failure"
  | "review_changes_requested"
  | "task_blocked";

export interface AdvisorTrigger {
  id: string;
  ts: string;
  actor: string;
  task_id: string;
  reason: AdvisorTriggerReason;
  fingerprint: string;
}

export interface AdvisorControlState {
  pending: AdvisorTrigger[];
  sent_uses: number;
}

export function readAdvisorControlState(
  root: string,
  actor: string,
  taskId: string | null,
): AdvisorControlState {
  if (!taskId) return { pending: [], sent_uses: 0 };
  const events = readEvents(companyPaths(root));
  const cleared = new Set<string>();
  const triggers: AdvisorTrigger[] = [];
  let sentUses = 0;

  for (const event of events) {
    if (event.actor !== actor) continue;
    const eventTask = stringValue(event.data.task_id);
    if (eventTask !== taskId) continue;
    if (event.type === "advisor.triggered") {
      const reason = advisorTriggerReason(event.data.reason);
      const fingerprint = stringValue(event.data.fingerprint);
      if (reason && fingerprint) {
        triggers.push({
          id: event.id,
          ts: event.ts,
          actor,
          task_id: taskId,
          reason,
          fingerprint,
        });
      }
    } else if (event.type === "advisor.trigger_cleared") {
      const ids = Array.isArray(event.data.trigger_ids) ? event.data.trigger_ids : [];
      for (const id of ids) {
        if (typeof id === "string") cleared.add(id);
      }
    } else if (event.type === "advisor.invoked" && event.data.sent === true && event.data.automatic === true) {
      sentUses += 1;
    }
  }

  return {
    pending: triggers.filter((trigger) => !cleared.has(trigger.id)),
    sent_uses: sentUses,
  };
}

export function hasAdvisorTriggerFingerprint(
  root: string,
  actor: string,
  taskId: string,
  fingerprint: string,
): boolean {
  return readEvents(companyPaths(root)).some((event) =>
    event.type === "advisor.triggered" &&
    event.actor === actor &&
    stringValue(event.data.task_id) === taskId &&
    stringValue(event.data.fingerprint) === fingerprint);
}

function advisorTriggerReason(value: unknown): AdvisorTriggerReason | null {
  return value === "repeated_tool_failure" ||
    value === "review_changes_requested" ||
    value === "task_blocked"
    ? value
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
