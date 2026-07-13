# Harder Adaptive Advisor Native Terminal-Bench Pilot

Date: 2026-07-13

This paired pilot tests whether pi-company's adaptive Advisor can show quality
lift once the earlier perfect-baseline ceiling is removed. It uses difficult,
non-security Terminal-Bench 2.1 tasks in the low-disk native harness. It is not
a Harbor run or leaderboard submission.

## Executive Result

The harder sample produced the first positive result for the current adaptive
policy, but it is still too small for a statistical claim.

| Variant | Binary reward | Granular checks | Mean task score |
| --- | ---: | ---: | ---: |
| pi-company | 1/3 | 18/29 (62.1%) | 64.0% |
| pi-company + adaptive Advisor | 2/3 | 25/29 (86.2%) | 85.2% |
| Observed delta | +1 pass | +7 checks (+24.1 pp) | +21.2 pp |

Advisor had one win, no losses, and two ties. It rescued `raman-fitting` from
4/11 to 11/11, tied below passing on `protein-assembly`, and stayed unused on
an already passing `db-wal-recovery` run.

The exact paired tests remain non-significant: McNemar and sign-test two-sided
`p = 1.0`. The task-level bootstrap interval for mean score delta is
`[0, +63.6 pp]`. With one stochastic pair per task, the result is evidence of
capability, not a pass-rate estimate.

## Protocol

All six valid cells used high thinking and the same model matrix:

- coder/executor: `openai-codex/gpt-5.6-luna`;
- independent tester: `openai-codex/gpt-5.6-luna`;
- read-only reviewer: `openai-codex/gpt-5.6-luna`;
- Advisor, when consulted: `openai-codex/gpt-5.6-sol`.

The only treatment difference was `advisor_policy.enabled`. No task prompt
named Advisor or instructed an agent to consult it. Adaptive mode allowed one
successful consultation for the entire task. Every task and stage budget was
doubled with `--time-multiplier 2`.

The fixtures and hidden graders are pinned to Terminal-Bench 2.1 commit
`a0c400b1138e8c2272c2fc7daa4fa35199b43bef`. The agents saw only the task and
fixtures; grader expectations remained outside their repositories.

Task selection was informed by one inspected public 25-trial job, where
`protein-assembly` and `db-wal-recovery` each passed 8/25 and `raman-fitting`
passed 1/25. Those are slice-specific observations, not canonical global pass
rates.

- https://github.com/harbor-framework/terminal-bench-2-1/tree/main/tasks/protein-assembly
- https://github.com/harbor-framework/terminal-bench-2-1/tree/main/tasks/db-wal-recovery
- https://github.com/harbor-framework/terminal-bench-2-1/tree/main/tasks/raman-fitting
- https://hub.harborframework.com/jobs/10e2e56b-ed31-5f65-a489-69f78b902adf

## Quality Results

Binary reward requires every granular check.

| Task | pi-company | + Advisor | Calls | Consultation path |
| --- | ---: | ---: | ---: | --- |
| Protein assembly | 5/9, fail | 5/9, fail | 1 | automatic trigger: repeated tool failure |
| SQLite WAL recovery | 9/9, pass | 9/9, pass | 0 | correctly suppressed |
| Raman fitting | 4/11, fail | 11/11, pass | 1 | autonomous voluntary consultation |
| **Aggregate** | **18/29, 1/3** | **25/29, 2/3** | **2** | **one triggered, one voluntary** |

### Raman Rescue

The baseline produced valid JSON but passed only one of eight fitted
parameters. Its G center was 1641.61 rather than 1580.30, and both peak widths,
amplitudes, and offsets were far outside tolerance. The final revision reached
its four-minute stage cap and the filesystem was graded at the deadline.

The Advisor coder voluntarily called Sol without a deterministic trigger or
human command. One 20,539-token consultation led to a candidate that passed all
eight parameter checks. Representative results were G center 1580.338, G gamma
8.444, 2D center 2670.085, and 2D gamma 17.297. The complete task changed from
4/11 and reward 0 to 11/11 and reward 1.

This independently reproduces the direction of the earlier eager-policy Raman
rescue under a stricter treatment: Luna now handled tester and reviewer roles,
and adaptive mode used one consultation instead of three.

### Protein Non-Rescue

Both variants passed file, DNA, frame/length, and every sliding GC-window
check, but selected the wrong donor sequence. That single component mismatch
also invalidated exact component order, termini, and linker extraction, leaving
both variants at 5/9.

The Advisor call was technically successful and automatically triggered after
two matching bash failures. It shortened the observed trajectory, but it did
not correct the decisive biological choice. This is a concrete false-rescue:
successful consultation does not imply improved output.

### Correct Suppression

Both WAL candidates recovered the exact eleven records, including two updates
and six inserts. Adaptive mode made no Advisor call. This task had a local
ceiling in this sample, but it demonstrates that leaving `auto` enabled does
not force a strong-model request on every task.

## Efficiency

| Metric | pi-company | + Advisor | Observed delta |
| --- | ---: | ---: | ---: |
| Agent stage time | 60.66 min | 52.10 min | -14.1% |
| Combined tokens | 8.530M | 7.919M | -7.2% |
| Pi catalog cost estimate | $2.1715 | $2.2269 | +2.5% |
| Pi tool calls | 380 | 357 | -6.1% |
| Direct Advisor tokens | 0 | 51,655 | +51,655 |
| Direct Advisor estimate | $0 | $0.2909 | +$0.2909 |

The catalog values are estimates for observed subscription-route usage, not
evidence of a separate charge on the user's bill. Most treatment variance came
from different Luna trajectories, so the aggregate time/token deltas are not a
clean estimate of Advisor overhead.

Per-task observations:

| Task | Baseline min | Advisor min | Baseline tokens | Advisor tokens | Quality delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Protein | 27.36 | 20.45 | 4.446M | 4.025M | 0 checks |
| WAL | 14.94 | 12.18 | 1.894M | 1.714M | 0 checks |
| Raman | 18.36 | 19.47 | 2.190M | 2.180M | +7 checks, +1 reward |

## Routing Result

Adaptive routing behaved in three distinct ways:

1. Protein emitted a runtime trigger after two repeated bash failures. The
   trigger caused one automatic consultation and was cleared after success.
2. Raman's coder chose the Advisor tool itself. Its audit has
   `automatic: true`, no trigger IDs, and one voluntary consultation.
3. WAL exposed no escalation evidence and made zero calls.

This answers the interaction question directly: the user did not need to type
`once`, mention Advisor in a task prompt, or watch the company. Persistent
`auto` mode supported both deterministic escalation and agent-initiated
escalation, while still suppressing unnecessary calls.

## Scorer Controls

Oracle and deliberately incomplete controls behaved as expected:

| Task | Oracle | Negative control |
| --- | ---: | ---: |
| Protein assembly | 9/9, reward 1 | 5/9, reward 0 |
| WAL recovery | 9/9, reward 1 | 7/9, reward 0 |
| Raman fitting | 11/11, reward 1 | 2/11, reward 0 |

Repository validation passed with 273/273 tests, type checking, build, and both
privacy scans.

## Retry Integrity

An initial protein baseline attempt hit the ChatGPT Pro usage window when its
final revision started. It was rejected as infrastructure and never entered
the checkpoint or metrics. Inspection exposed that the matrix used to delete
the whole cell before retrying.

The harness now supports `--resume-existing`: it keeps the valid stage prefix,
removes only the failed checkpoint tail, subtracts completed active duration
from the remaining task budget, and resumes the first incomplete stage. A
synthetic timed-out checkpoint test verified that recovery grades the existing
filesystem without calling a model again. The full repository check passed
after this fix.

All six retained formal cells completed without quota, transport, or Advisor
infrastructure failures. Raman's baseline revision timeout was a task-budget
outcome and was scored normally.

## Interpretation

The current evidence supports a narrower but now positive conclusion:

1. **Advisor can improve quality.** One autonomous Sol consultation converted
   a severe scientific-fitting failure into a complete pass.
2. **Automatic selection is real.** One call came from runtime evidence, one
   from the agent's own tool choice, and one task correctly made no call.
3. **Advisor is not magic.** It failed to fix the protein task's decisive wrong
   choice even though the call itself succeeded.
4. **The observed batch is promising, not statistically conclusive.** All
   quality lift comes from one discordant pair, and previous Raman samples show
   substantial stochastic variance.
5. **Bounded `auto` remains the right product shape.** One task-level use limits
   cost and late churn while preserving `off` and explicit `once` controls.

The next credible estimate should run at least five paired seeds on Raman and
protein, preferably with fixture-preserving task variants, and report the
distribution of reward and granular-score deltas. Until then, this result
justifies using Advisor as a selective rescue channel, not advertising a
general percentage quality multiplier.

## Resource Footprint

- no Harbor, Docker, VM, or local model downloads;
- peak disposable run root: approximately 108 MiB, including 95 MiB of
  temporary NumPy/SciPy dependencies;
- persistent six-cell checkpoint: approximately 25 KiB;
- machine-readable summary: approximately 8 KiB;
- approximately 46 GiB remained free before cleanup;
- all temporary run and scorer-cache directories are removed after report
  validation.

## Reproduce

```bash
node scripts/native-tbench-expanded-matrix.mjs \
  --tasks protein-assembly,db-wal-recovery,raman-fitting \
  --variants company,company-advisor \
  --run-root /tmp/pi-company-no-ceiling-pilot-2x \
  --checkpoint .benchmark-work/native-tbench-no-ceiling-pilot-2x.jsonl \
  --executor-model gpt-5.6-luna \
  --validator-model gpt-5.6-luna \
  --advisor-model gpt-5.6-sol \
  --time-multiplier 2 \
  --codex-client-compat \
  --proxy http://127.0.0.1:45678 \
  --min-free-gib 12 \
  --max-run-mib 250 \
  --retry-transient-errors 2 \
  --retry-usage-limits 3

node scripts/native-tbench-analyze.mjs \
  --checkpoint .benchmark-work/native-tbench-no-ceiling-pilot-2x.jsonl \
  --tasks protein-assembly,db-wal-recovery,raman-fitting \
  --output docs/benchmarks/NATIVE_TBENCH_HARD_ADVISOR_PILOT_2026-07-13.json
```

Machine-readable summary:
[`NATIVE_TBENCH_HARD_ADVISOR_PILOT_2026-07-13.json`](NATIVE_TBENCH_HARD_ADVISOR_PILOT_2026-07-13.json)
