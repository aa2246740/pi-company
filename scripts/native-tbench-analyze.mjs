#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const checkpointPath = path.resolve(readArg("--checkpoint") || "/tmp/pi-company-expanded-results.jsonl");
const outputPath = readArg("--output") ? path.resolve(readArg("--output")) : null;
const expectedTasks = (readArg("--tasks") || [
  "video-processing",
  "dna-insert",
  "gcode-to-text",
  "dna-assembly",
  "extract-elf",
  "path-tracing-reverse",
  "regex-chess",
  "polyglot-rust-c",
].join(",")).split(",").map((value) => value.trim()).filter(Boolean);

const cells = readCells(checkpointPath);
const pairs = expectedTasks.map((task) => {
  const company = cells.get(`${task}:company`);
  const advisor = cells.get(`${task}:company-advisor`);
  if (!company || !advisor) throw new Error(`Incomplete pair for ${task}`);
  validatePair(task, company, advisor);
  return {
    task,
    company,
    advisor,
    reward_delta: number(advisor.reward) - number(company.reward),
    score_delta: score(advisor) - score(company),
  };
});

const rewardDeltas = pairs.map((pair) => pair.reward_delta);
const scoreDeltas = pairs.map((pair) => pair.score_delta);
const advisorWins = rewardDeltas.filter((value) => value > 0).length;
const advisorLosses = rewardDeltas.filter((value) => value < 0).length;
const rewardTies = rewardDeltas.filter((value) => value === 0).length;
const companyAggregate = aggregate(pairs.map((pair) => pair.company));
const advisorAggregate = aggregate(pairs.map((pair) => pair.advisor));
const advisorTriggerAggregate = aggregateAdvisorTriggers(pairs.map((pair) => pair.advisor));
const scoreBootstrap = bootstrapMean(scoreDeltas, 100_000, 0x5a17c0de);

const result = {
  schema_version: 1,
  source_checkpoint: displayPath(checkpointPath),
  generated_at: new Date().toISOString(),
  protocol: {
    paired_tasks: pairs.length,
    executor: pairs[0]?.company.model_matrix?.executor || null,
    tester: pairs[0]?.company.model_matrix?.tester || null,
    reviewer: pairs[0]?.company.model_matrix?.reviewer || null,
    advisor: pairs[0]?.advisor.model_matrix?.advisor || null,
    thinking: pairs[0]?.company.thinking || null,
  },
  quality: {
    company: {
      rewards: companyAggregate.rewards,
      tasks: pairs.length,
      checks_passed: companyAggregate.checks_passed,
      checks_total: companyAggregate.checks_total,
      mean_task_score: mean(pairs.map((pair) => score(pair.company))),
      reward_wilson_95: wilson(companyAggregate.rewards, pairs.length),
    },
    advisor: {
      rewards: advisorAggregate.rewards,
      tasks: pairs.length,
      checks_passed: advisorAggregate.checks_passed,
      checks_total: advisorAggregate.checks_total,
      mean_task_score: mean(pairs.map((pair) => score(pair.advisor))),
      reward_wilson_95: wilson(advisorAggregate.rewards, pairs.length),
    },
    paired_reward: {
      advisor_wins: advisorWins,
      advisor_losses: advisorLosses,
      ties: rewardTies,
      mean_delta: mean(rewardDeltas),
      exact_mcnemar_p_two_sided: exactBinomialTwoSided(advisorWins, advisorLosses),
    },
    paired_task_score: {
      mean_delta: mean(scoreDeltas),
      median_delta: median(scoreDeltas),
      bootstrap_mean_delta_95: scoreBootstrap,
      exact_sign_p_two_sided: exactSignTest(scoreDeltas),
      exact_sign_flip_mean_p_two_sided: exactSignFlipMean(scoreDeltas),
      cohen_dz: cohenDz(scoreDeltas),
    },
  },
  efficiency: {
    company: companyAggregate,
    advisor: advisorAggregate,
    advisor_delta_percent: {
      duration_ms: percentDelta(companyAggregate.duration_ms, advisorAggregate.duration_ms),
      total_tokens: percentDelta(companyAggregate.total_tokens, advisorAggregate.total_tokens),
      cost_usd: percentDelta(companyAggregate.cost_usd, advisorAggregate.cost_usd),
      tool_calls: percentDelta(companyAggregate.tool_calls, advisorAggregate.tool_calls),
    },
  },
  advisor_uptake: {
    tool_calls: advisorAggregate.advisor_calls,
    successful_calls: advisorAggregate.advisor_successful_calls,
    tasks_with_successful_advice: pairs.filter((pair) => number(pair.advisor.advisor_successful_calls) > 0).length,
    advisor_tokens: advisorAggregate.advisor_tokens,
    advisor_cost_usd: advisorAggregate.advisor_cost_usd,
    trigger_events: advisorTriggerAggregate.triggers,
    cleared_trigger_events: advisorTriggerAggregate.cleared_triggers,
    triggered_consultations: advisorTriggerAggregate.triggered_consultations,
    voluntary_consultations: advisorTriggerAggregate.voluntary_consultations,
    trigger_reasons: advisorTriggerAggregate.reasons,
    failed_audits: pairs.flatMap((pair) => pair.advisor.advisor_failures || []),
  },
  tasks: pairs.map((pair) => ({
    task: pair.task,
    company: compactCell(pair.company),
    advisor: compactCell(pair.advisor),
    reward_delta: pair.reward_delta,
    task_score_delta: pair.score_delta,
  })),
};

const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, "utf8");
}
process.stdout.write(serialized);

function readCells(file) {
  if (!fs.existsSync(file)) throw new Error(`Checkpoint does not exist: ${file}`);
  const values = new Map();
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const value = JSON.parse(line);
    values.set(`${value.task}:${value.variant}`, value);
  }
  return values;
}

function validatePair(task, company, advisor) {
  if (company.task !== task || advisor.task !== task) throw new Error(`Task mismatch for ${task}`);
  if (company.variant !== "company" || advisor.variant !== "company-advisor") throw new Error(`Variant mismatch for ${task}`);
  for (const role of ["executor", "tester", "reviewer", "advisor"]) {
    if (company.model_matrix?.[role] !== advisor.model_matrix?.[role]) {
      throw new Error(`Model mismatch for ${task} role=${role}`);
    }
  }
  if (company.thinking !== advisor.thinking) throw new Error(`Thinking mismatch for ${task}`);
  if (number(company.advisor_successful_calls) !== 0) throw new Error(`Baseline unexpectedly used Advisor for ${task}`);
  if ((advisor.advisor_failures || []).some((failure) =>
    new Set(["provider_429", "quota_exhausted", "timeout", "error", "aborted"]).has(failure.status))) {
    throw new Error(`Advisor infrastructure failure recorded for ${task}`);
  }
}

function compactCell(cell) {
  const combined = cell.combined_usage || cell.usage || {};
  return {
    reward: number(cell.reward),
    checks_passed: number(cell.checks_passed),
    checks_total: number(cell.checks_total),
    task_score: score(cell),
    duration_ms: number(cell.duration_ms),
    total_tokens: number(combined.total_tokens),
    cost_usd: number(combined.cost_usd),
    tool_calls: number(cell.tool_calls),
    advisor_calls: number(cell.advisor_calls),
    advisor_successful_calls: number(cell.advisor_successful_calls),
    advisor_audit_statuses: cell.advisor_audit_statuses || [],
    advisor_trigger_metrics: cell.advisor_trigger_metrics || null,
    grade_metrics: cell.grade_metrics || null,
  };
}

function aggregateAdvisorTriggers(values) {
  const result = {
    triggers: 0,
    cleared_triggers: 0,
    triggered_consultations: 0,
    voluntary_consultations: 0,
    reasons: {},
  };
  for (const value of values) {
    const metrics = value.advisor_trigger_metrics || {};
    result.triggers += number(metrics.triggers);
    result.cleared_triggers += number(metrics.cleared_triggers);
    result.triggered_consultations += number(metrics.triggered_consultations);
    result.voluntary_consultations += number(metrics.voluntary_consultations);
    for (const [reason, count] of Object.entries(metrics.reasons || {})) {
      result.reasons[reason] = number(result.reasons[reason]) + number(count);
    }
  }
  return result;
}

function aggregate(values) {
  const result = {
    rewards: 0,
    checks_passed: 0,
    checks_total: 0,
    duration_ms: 0,
    total_tokens: 0,
    cost_usd: 0,
    tool_calls: 0,
    advisor_calls: 0,
    advisor_successful_calls: 0,
    advisor_tokens: 0,
    advisor_cost_usd: 0,
  };
  for (const value of values) {
    const combined = value.combined_usage || value.usage || {};
    result.rewards += number(value.reward);
    result.checks_passed += number(value.checks_passed);
    result.checks_total += number(value.checks_total);
    result.duration_ms += number(value.duration_ms);
    result.total_tokens += number(combined.total_tokens);
    result.cost_usd += number(combined.cost_usd);
    result.tool_calls += number(value.tool_calls);
    result.advisor_calls += number(value.advisor_calls);
    result.advisor_successful_calls += number(value.advisor_successful_calls);
    result.advisor_tokens += number(value.advisor_usage?.total_tokens);
    result.advisor_cost_usd += number(value.advisor_usage?.cost_usd);
  }
  return result;
}

function score(value) {
  const total = number(value.checks_total);
  return total > 0 ? number(value.checks_passed) / total : 0;
}

function exactBinomialTwoSided(positive, negative) {
  const trials = positive + negative;
  if (trials === 0) return 1;
  const tail = Math.min(positive, negative);
  let cumulative = 0;
  for (let value = 0; value <= tail; value += 1) cumulative += choose(trials, value) * (0.5 ** trials);
  return Math.min(1, 2 * cumulative);
}

function exactSignTest(values) {
  const positive = values.filter((value) => value > 1e-12).length;
  const negative = values.filter((value) => value < -1e-12).length;
  return exactBinomialTwoSided(positive, negative);
}

function exactSignFlipMean(values) {
  const magnitudes = values.filter((value) => Math.abs(value) > 1e-12).map(Math.abs);
  if (magnitudes.length === 0) return 1;
  const observed = Math.abs(mean(values));
  let extreme = 0;
  const permutations = 2 ** magnitudes.length;
  for (let mask = 0; mask < permutations; mask += 1) {
    let total = 0;
    for (let index = 0; index < magnitudes.length; index += 1) {
      total += (mask & (1 << index) ? 1 : -1) * magnitudes[index];
    }
    if (Math.abs(total / values.length) >= observed - 1e-12) extreme += 1;
  }
  return extreme / permutations;
}

function bootstrapMean(values, iterations, seed) {
  if (values.length === 0) return [0, 0];
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const samples = new Array(iterations);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      total += values[Math.floor(random() * values.length)];
    }
    samples[iteration] = total / values.length;
  }
  samples.sort((left, right) => left - right);
  return [quantile(samples, 0.025), quantile(samples, 0.975)];
}

function wilson(successes, trials) {
  if (trials === 0) return [0, 1];
  const z = 1.959963984540054;
  const proportion = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (proportion + (z * z) / (2 * trials)) / denominator;
  const half = z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * trials)) / trials) / denominator;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

function cohenDz(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1);
  const deviation = Math.sqrt(variance);
  return deviation > 1e-12 ? average / deviation : Math.abs(average) <= 1e-12 ? 0 : null;
}

function percentDelta(baseline, treatment) {
  return baseline === 0 ? null : ((treatment / baseline) - 1) * 100;
}

function choose(n, k) {
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = (result * (n - k + index)) / index;
  return result;
}

function quantile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function displayPath(file) {
  const relative = path.relative(process.cwd(), file);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== ".."
    ? relative
    : file;
}
