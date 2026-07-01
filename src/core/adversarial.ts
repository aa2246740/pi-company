import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildOkfExportGateReport,
  createSprintContract,
  loadState,
  sendCompanyMessage,
  submitEvaluationFinding,
  transitionDeliveryOkfLifecycle,
} from "./company.js";
import { listDeliveryOkfConcepts, readDeliveryOkfConcept } from "./okf.js";
import { companyPaths } from "./paths.js";
import { nowIso } from "./id.js";

/**
 * OKF v3 adversarial orchestration.
 *
 * Implements the Anthropic "Build Agents That Run for Hours" workshop pattern
 * using the existing pi-company primitives (mailbox, finding, handoff, contract,
 * preflight, gate). This module is a DETERMINISTIC DRIVER (Ralph-style), not a
 * daemon: it spawns pi sessions in a loop and inspects OKF state between rounds.
 *
 * It runs OUTSIDE the pi extension process (as a CLI command), so it can block
 * and spawn agent sessions without interfering with hooks.
 */

export interface AdversarialRoundResult {
  round: number;
  role: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

export interface AdversarialCycleResult {
  contract_id: string;
  max_rounds: number;
  rounds: AdversarialRoundResult[];
  resolved: boolean;
  blocking_findings: Array<{ id: string | null; summary: string; target: string | null }>;
  gate_ready: boolean;
  reason: string;
  stopped_at: string;
}

export interface NegotiationProposal {
  agent: string;
  role: string;
  done_assertions: string[];
  file: string;
}

export interface NegotiationResult {
  contract_id: string;
  proposals: NegotiationProposal[];
  merged_assertions: string[];
  divergences: string[];
  file: string;
}

export interface RunAgentOptions {
  timeoutMs: number;
  piBin?: string;
  model?: string;
  roleCardPath?: string;
  okfContextPath?: string;
  extraArgs?: string[];
}

/**
 * Run one pi agent session for a role, non-interactively, with a hard timeout.
 * Mirrors the workshop's "one agent = one bounded turn" model.
 */
export function runAgentSession(repo: string, promptPath: string, role: string, options: RunAgentOptions): AdversarialRoundResult {
  const start = Date.now();
  const piBin = options.piBin ?? "pi";
  const args = [piBin, "--no-extensions", "--approve"];
  if (options.model) args.push("--model", options.model);
  const roleCard = options.roleCardPath ?? defaultRoleCard(repo, role);
  if (fs.existsSync(roleCard)) args.push("--append-system-prompt", roleCard);
  const ctx = options.okfContextPath ?? defaultOkfContext(repo, role);
  if (fs.existsSync(ctx)) args.push("--append-system-prompt", ctx);
  if (options.extraArgs?.length) args.push(...options.extraArgs);
  args.push("-p", `@${promptPath}`);

  const result = spawnSync(piBin, args.slice(1), {
    cwd: repo,
    encoding: "utf8",
    timeout: options.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });

  const timedOut = result.status === null && !!result.signal;
  return {
    round: 0,
    role,
    exitCode: result.status,
    timedOut,
    durationMs: Date.now() - start,
  };
}

/**
 * Workshop step 1: contract negotiation.
 * coder and tester each propose concrete, testable "Done" assertions for an
 * issue. The driver then merges them (union, de-duplicated) and writes them
 * back into the SprintContract.done_criteria via --update.
 */
export function collectNegotiationProposals(
  root: string,
  contractId: string,
  agents: Array<{ name: string; role: string }>,
  promptDir: string,
  options: RunAgentOptions,
): NegotiationResult {
  const proposals: NegotiationProposal[] = [];
  for (const agent of agents) {
    const promptPath = path.join(promptDir, `negotiate-${agent.role}.txt`);
    if (!fs.existsSync(promptPath)) continue;
    const repo = repoForAgent(root, agent.name);
    runAgentSession(repo, promptPath, agent.role, options);
    const proposalFile = path.join(repo, ".pi-company", "okf", "delivery", "negotiation", `${contractId}-${agent.role}.md`);
    proposals.push(readProposal(proposalFile, agent));
  }
  const merged = mergeAssertions(proposals);
  const divergences = detectDivergences(proposals);
  const outFile = path.join(root, ".pi-company", "okf", "delivery", "negotiation", `${contractId}-merged.md`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, renderMergedNegotiation(contractId, proposals, merged, divergences));
  return { contract_id: contractId, proposals, merged_assertions: merged, divergences, file: outFile };
}

/**
 * Workshop step 2: adversarial cycle.
 * evaluator runs -> if blocking findings, message coder -> coder fixes ->
 * evaluator re-verifies. Loop up to maxRounds. Each round is a bounded agent
 * session. Anti-thrash: if the same blocking finding persists across 2 rounds,
 * escalate to human and stop.
 */
export function runAdversarialCycle(
  root: string,
  contractId: string,
  roles: { coder: string; evaluator: string },
  promptDir: string,
  options: { maxRounds: number; timeoutMs: number; model?: string; piBin?: string },
): AdversarialCycleResult {
  const rounds: AdversarialRoundResult[] = [];
  const maxRounds = Math.max(1, options.maxRounds);
  let resolved = false;
  let gateReady = false;
  let reason = "max rounds reached without resolution";
  const seenFindings = new Map<string, number>(); // findingId -> round first seen

  for (let round = 1; round <= maxRounds; round++) {
    // 1. evaluator verifies current patch.
    const evalPrompt = path.join(promptDir, "evaluator.txt");
    const evalResult = runAgentSession(repoForAgent(root, roles.evaluator), evalPrompt, "tester", {
      timeoutMs: options.timeoutMs,
      model: options.model,
      piBin: options.piBin,
    });
    rounds.push({ ...evalResult, round, role: "evaluator" });

    const blocking = currentBlockingFindings(root, contractId);
    if (blocking.length === 0) {
      const gate = buildOkfExportGateReport(root, contractId, { requiredRoleBundleKinds: ["research_brief"] });
      if (gate.ready) {
        resolved = true;
        gateReady = true;
        reason = `evaluator passed and export gate ready at round ${round}`;
        break;
      }
      reason = `no blocking findings but export gate not ready at round ${round}`;
      continue;
    }

    // anti-thrash: same blocking finding seen 2+ rounds -> escalate.
    let escalated = false;
    for (const f of blocking) {
      const id = f.id ?? f.summary;
      const first = seenFindings.get(id);
      if (first !== undefined && first <= round - 2) {
        escalated = true;
        reason = `escalating to human: blocking finding ${id} persisted since round ${first}`;
      }
      if (first === undefined) seenFindings.set(id, round);
    }
    if (escalated) break;

    // 2. message coder with the blocking findings.
    sendCompanyMessage(root, {
      from: roles.evaluator,
      to: roles.coder,
      type: "review",
      text: `Blocking findings at round ${round}: ${blocking.map((f) => `${f.id ?? f.summary}: ${f.summary}`).join("; ")}. Fix these and leave an updated patch.`,
    });

    // 3. coder fixes.
    const coderPrompt = path.join(promptDir, "coder.txt");
    const coderResult = runAgentSession(repoForAgent(root, roles.coder), coderPrompt, "coder", {
      timeoutMs: options.timeoutMs,
      model: options.model,
      piBin: options.piBin,
    });
    rounds.push({ ...coderResult, round, role: "coder" });
  }

  return {
    contract_id: contractId,
    max_rounds: maxRounds,
    rounds,
    resolved,
    blocking_findings: currentBlockingFindings(root, contractId),
    gate_ready: gateReady,
    reason,
    stopped_at: nowIso(),
  };
}

// ---- helpers (exported for unit testing) ----

export function mergeAssertions(proposals: NegotiationProposal[]): string[] {
  const all = proposals.flatMap((p) => p.done_assertions);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const a of all) {
    const key = normalizeAssertion(a);
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(a);
    }
  }
  return merged;
}

export function detectDivergences(proposals: NegotiationProposal[]): string[] {
  if (proposals.length < 2) return [];
  const sets = proposals.map((p) => new Set(p.done_assertions.map(normalizeAssertion)));
  const divergences: string[] = [];
  for (let i = 0; i < proposals.length; i++) {
    for (const a of proposals[i].done_assertions) {
      const key = normalizeAssertion(a);
      const othersHave = sets.some((s, j) => j !== i && s.has(key));
      if (!othersHave) divergences.push("Only " + proposals[i].role + " proposed: " + a);
    }
  }
  return divergences;
}

export function shouldEscalate(seenFindings: Map<string, number>, currentRound: number, findingIds: Array<string | null>): { escalate: boolean; reason: string | null } {
  for (const id of findingIds) {
    const key = id ?? "";
    if (!key) continue;
    const first = seenFindings.get(key);
    if (first !== undefined && first <= currentRound - 2) {
      return { escalate: true, reason: "escalating to human: blocking finding " + key + " persisted since round " + first };
    }
  }
  return { escalate: false, reason: null };
}

function normalizeAssertion(a: string): string {
  return a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Pure-logic variant of the cycle decision for unit testing (no agent spawning). */
export function runAdversarialCycleLogic(
  blockingFindingsByRound: Array<Array<{ id: string | null; summary: string }>>,
  gateReadyByRound: boolean[],
  maxRounds: number,
): { resolved: boolean; escalated: boolean; roundsUsed: number; reason: string } {
  const seen = new Map<string, number>();
  for (let round = 1; round <= maxRounds; round++) {
    const blocking = blockingFindingsByRound[round - 1] ?? [];
    if (blocking.length === 0) {
      const gateReady = gateReadyByRound[round - 1] ?? false;
      if (gateReady) return { resolved: true, escalated: false, roundsUsed: round, reason: "resolved at round " + round };
      continue;
    }
    const esc = shouldEscalate(seen, round, blocking.map((f) => f.id));
    if (esc.escalate) return { resolved: false, escalated: true, roundsUsed: round, reason: esc.reason ?? "escalated" };
    for (const f of blocking) {
      const key = f.id ?? f.summary;
      if (!seen.has(key)) seen.set(key, round);
    }
  }
  return { resolved: false, escalated: false, roundsUsed: maxRounds, reason: "max rounds reached without resolution" };
}

function repoForAgent(root: string, agentName: string): string {
  const state = loadState(root);
  const agent = state.agents[agentName];
  if (!agent) throw new Error(`Unknown agent ${agentName}.`);
  return agent.worktree ?? agent.cwd ?? root;
}

function currentBlockingFindings(root: string, contractId: string) {
  return listDeliveryOkfConcepts(root, "evaluation")
    .filter((c) => c.frontmatter.contract_id === contractId)
    .filter((c) => c.frontmatter.severity === "blocking" && c.frontmatter.status !== "resolved")
    .map((c) => ({
      id: typeof c.frontmatter.finding_id === "string" ? c.frontmatter.finding_id : null,
      summary: String(c.frontmatter.summary ?? ""),
      target: typeof c.frontmatter.target === "string" ? c.frontmatter.target : null,
    }));
}

function readProposal(file: string, agent: { name: string; role: string }): NegotiationProposal {
  if (!fs.existsSync(file)) return { agent: agent.name, role: agent.role, done_assertions: [], file };
  const text = fs.readFileSync(file, "utf8");
  const assertions = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("---"));
  return { agent: agent.name, role: agent.role, done_assertions: assertions, file };
}

function renderMergedNegotiation(contractId: string, proposals: NegotiationProposal[], merged: string[], divergences: string[]): string {
  const lines = [
    "---",
    "type: NegotiationResult",
    "contract_id: " + contractId,
    "timestamp: " + nowIso(),
    "---",
    "",
    "# Negotiation result for " + contractId,
    "",
  ];
  for (const p of proposals) {
    lines.push("## " + p.role + " (" + p.agent + ") proposed", ...p.done_assertions.map((a) => "- " + a), "");
  }
  lines.push(`## Merged Done assertions`, ...merged.map((a) => `- ${a}`), ``);
  if (divergences.length) {
    lines.push(`## Divergences (proposed by only one side)`, ...divergences.map((d) => `- ${d}`), ``);
  }
  return lines.join("\n");
}

function defaultRoleCard(repo: string, role: string): string {
  return path.join(repo, ".pi-company", "roles", `${role}.md`);
}

function defaultOkfContext(repo: string, role: string): string {
  return path.join(repo, ".pi-company", "runtime", "okf-context", `${role}.md`);
}
