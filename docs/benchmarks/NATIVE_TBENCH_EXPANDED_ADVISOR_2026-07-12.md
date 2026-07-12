# Expanded Native Terminal-Bench Advisor Evaluation

Date: 2026-07-12

This follow-up evaluates pi-company's autonomous Advisor mode on six difficult,
non-security Terminal-Bench 2.1 tasks. It is a low-disk native experiment, not a
Harbor or Terminal-Bench leaderboard submission.

## Executive Result

The expanded batch found no quality lift from the current auto-Advisor policy.

| Variant | Binary reward | Granular checks | Mean task score |
| --- | ---: | ---: | ---: |
| pi-company | 4/6 | 24/26 | 86.11% |
| pi-company + Advisor | 3/6 | 23/26 | 83.33% |
| Advisor delta | -1 task | -1 check | -2.78 pp |

The paired outcomes were zero Advisor wins, one loss, and five ties. The loss
was `video-processing`, where the baseline passed 6/6 and Advisor passed 5/6.
The exact two-sided McNemar p-value is 1.0. The exact sign and sign-flip tests on
task-normalized scores are also 1.0; a deterministic 100,000-sample bootstrap
interval for the mean score delta is [-8.33 pp, 0 pp].

This is not evidence of a statistically significant regression. It is also not
an improvement signal. With only six pairs, uncertainty remains wide, but the
observed data rule out the claimed large and reliable lift on this task set.

## Model Matrix

Both arms used high thinking with:

- coder/executor: `openai-codex/gpt-5.6-luna`;
- independent tester: `openai-codex/gpt-5.6-luna`;
- read-only reviewer: `openai-codex/gpt-5.6-luna`;
- Advisor, when enabled: `openai-codex/gpt-5.6-sol`.

The only intended treatment difference was `advisor_policy.enabled`. Benchmark
prompts never requested advice. The Luna coder autonomously chose every call
through the normal pi-company tool description and OKF guidance. The policy
allowed two calls per Pi turn, which resets for the later revision turn.

## Data Integrity

The quality comparison has an important limitation. The original baseline
checkpoint was placed under `/tmp` and was cleared between July 11 and July 12.
The six baseline reward and granular-check totals were recoverable from the
recorded matrix completion lines, but token, cost, duration, candidate hashes,
per-check details, and stage records were not.

The Advisor arm has a complete persistent JSONL checkpoint. The harness now:

- stores small checkpoints under the ignored `.benchmark-work/` directory;
- keeps only disposable worktrees and dependencies under `/tmp`;
- parses Pi JSON events as a stream and retains only a bounded log tail;
- retries explicitly configured transient provider failures from a fresh cell;
- rejects quota, 429, timeout, aborted, or failed Advisor attempts as invalid
  infrastructure rather than benchmark failures.

Because baseline efficiency data was lost, this report makes no paired claim
about time, tokens, tools, or cost. The failure is disclosed rather than filled
with estimates.

## Hard Tasks

Tasks and fixtures were pinned by byte length and SHA-256 to Terminal-Bench 2.1
commit `a0c400b1138e8c2272c2fc7daa4fa35199b43bef`. The rates below are from one
inspected public 25-trial job slice and are not global pass rates.

| Task | Public successes | Capability |
| --- | ---: | --- |
| `video-processing` | 4/25 | Hidden-video event detection and frame indexing |
| `dna-insert` | 5/25 | Circular alignment, primer orientation, and Tm constraints |
| `gcode-to-text` | 7/25 | Toolpath extraction, geometry reconstruction, and OCR |
| `dna-assembly` | 8/25 | Four-fragment Golden Gate primer design |
| `extract-elf` | 9/25 | General ELF parsing, addresses, endianness, and coverage |
| `path-tracing-reverse` | 12/25 | Binary observation, compact C reconstruction, and image similarity |

`regex-chess` was excluded from the formal comparison. Its first run exposed an
unbounded event-log accumulation bug, and a fresh run later ended in a provider
`fetch failed`. Neither attempt was scored. `polyglot-rust-c` was not started
before the overnight checkpoint reset and was also excluded.

## Quality Results

Binary reward requires every granular check.

| Task | pi-company | + Advisor | Effect | Successful advice calls |
| --- | ---: | ---: | --- | ---: |
| Video processing | 6/6, reward 1 | 5/6, reward 0 | regression | 4 |
| DNA insert | 2/3, reward 0 | 2/3, reward 0 | tie | 4 |
| G-code to text | 1/2, reward 0 | 1/2, reward 0 | tie | 2 |
| DNA assembly | 3/3, reward 1 | 3/3, reward 1 | tie | 3 |
| Extract ELF | 6/6, reward 1 | 6/6, reward 1 | tie | 4 |
| Path tracing reverse | 6/6, reward 1 | 6/6, reward 1 | tie | 4 |
| **Aggregate** | **24/26, 4/6** | **23/26, 3/6** | **0 wins, 1 loss, 5 ties** | **21** |

The video candidate passed the example at takeoff/landing frames 54/62, but
reported 263/266 on the hidden video instead of the accepted 219-223/231-234
ranges. Advisor advice did not prevent the hidden-video generalization failure;
the baseline had passed it.

## Advisor Uptake

All 21 consultation attempts succeeded technically. Every one was initiated by
the Luna coder, and all six tasks used Advisor at least twice.

The complete Advisor arm consumed:

| Metric | Total |
| --- | ---: |
| Agent stage time | 139.04 min |
| Combined tokens, including cache reads | 21,918,018 |
| Pi catalog cost estimate | $6.72552 |
| Ordinary tool calls | 712 |
| Successful Advisor calls | 21 |
| Advisor tokens | 243,316 |
| Advisor catalog cost estimate | $1.47886 |

Advisor accounted for 1.11% of combined tokens but 21.99% of the catalog cost
estimate. These are Pi catalog estimates for observed subscription-route usage,
not evidence of an additional cash charge on the user's bill.

## Prior Stratum

The earlier two-task hard pilot used Sol for tester/reviewer as well as Advisor,
so it must not be pooled as the same protocol:

| Pilot result | pi-company | + Advisor |
| --- | ---: | ---: |
| Binary reward | 1/2 | 1/2 |
| Granular checks | 16/17 | 13/17 |
| Paired effects | one loss | one win |

Across both strata, purely as a descriptive eight-task summary, pi-company
earned 5/8 rewards and 40/43 checks; Advisor earned 4/8 and 36/43. Pair effects
were one Advisor win, two losses, and five ties. No inferential test should pool
the strata because their validator model matrices and data completeness differ.

## Interpretation

The evidence now supports these claims:

1. **The implementation works.** Agents autonomously invoked Sol 21 times, all
   consultations succeeded, and no prompt manually named or triggered Advisor.
2. **A strong Advisor can sometimes rescue a task.** The prior Raman pilot moved
   from reward 0 to 1 after selecting a better physical model convention.
3. **Current auto mode does not improve average quality reliably.** The expanded
   batch produced no wins, one regression, and five ties despite heavy uptake.
4. **More advice is not the missing ingredient.** The expanded failures used two
   to four successful calls each. Routing quality, timing, and preserving a
   locally verified artifact matter more than call count.
5. **The present policy is too eager for routine default use.** It can consume
   scarce Sol capacity and implementation time without changing the outcome.

## Product Recommendation

Keep Advisor, but keep it opt-in and make auto mode more conservative:

- preserve `off`, `once`, and `auto`; do not make `auto` universal;
- default auto mode to one successful use per Pi turn;
- suppress consultation when little stage time remains;
- do not replace a locally passing artifact until the replacement also passes;
- ask Advisor for a falsifiable validation step and fallback, not only strategy;
- add a confidence/novelty gate so repeated advice is not requested after the
  executor has converged on an objectively tested plan;
- rerun a future benchmark with persistent checkpoints and at least two seeds
  before making a smaller-effect claim.

## Resource Footprint

- no Harbor, Docker, VM, or local model downloads;
- retained persistent checkpoint and recovery record: approximately 28 KiB;
- temporary shared dependencies and grader cache after the run: approximately
  135 MiB;
- native graders passed pinned oracle and negative controls before formal runs.

## Reproduce

Validate the expanded graders:

```bash
node scripts/native-tbench-expanded-grade.mjs \
  --self-test all \
  --cache-root /tmp/pi-company-expanded-grade-cache \
  --python-path PATH_TO_SHARED_PYTHON_DEPS
```

Run a persistent paired matrix:

```bash
node scripts/native-tbench-expanded-matrix.mjs \
  --run-root /tmp/pi-company-expanded-matrix \
  --executor-model gpt-5.6-luna \
  --validator-model gpt-5.6-luna \
  --advisor-model gpt-5.6-sol \
  --min-free-gib 5 \
  --max-run-mib 250 \
  --retry-transient-errors 1
```

The checkpoint defaults to
`.benchmark-work/native-tbench-expanded-results.jsonl`, outside the disposable
run root.

Machine-readable summary:
[`NATIVE_TBENCH_EXPANDED_ADVISOR_2026-07-12.json`](NATIVE_TBENCH_EXPANDED_ADVISOR_2026-07-12.json)
