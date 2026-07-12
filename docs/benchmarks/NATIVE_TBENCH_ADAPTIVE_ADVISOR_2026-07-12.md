# Adaptive Advisor Native Terminal-Bench Evaluation

Date: 2026-07-12

This holdout evaluates the adaptive Advisor policy after replacing routine
start/final consultations with evidence-based escalation and doubling every
benchmark time budget. It uses difficult, non-security Terminal-Bench 2.1
tasks in the low-disk native harness. It is not a Harbor run or leaderboard
submission.

## Executive Result

Adaptive Advisor preserved quality but did not improve it on this four-task
sample.

| Variant | Binary reward | Granular checks | Mean task score |
| --- | ---: | ---: | ---: |
| pi-company | 4/4 | 24/24 | 100% |
| pi-company + adaptive Advisor | 4/4 | 24/24 | 100% |
| Advisor delta | 0 | 0 | 0 pp |

All four pairs tied. There were no Advisor wins and no losses. McNemar, sign,
and sign-flip p-values are all 1.0. The observed bootstrap interval is
[0 pp, 0 pp], but that mechanical interval must not be read as proof of
equivalence: one sample per task and a perfect baseline create a ceiling where
quality lift is impossible to observe.

The more useful product result is routing behavior. Adaptive mode made three
successful consultations across four tasks, versus 21 across six tasks in the
earlier eager batch. Calls per Advisor task fell from 3.50 to 0.75, a 78.6%
reduction. No start-of-task or final-review call occurred.

## Treatment

The optimized policy used:

- `trigger_mode: adaptive`;
- one automatic successful consultation per task and per Pi turn;
- deterministic escalation after two matching failed bash/edit/write tools;
- deterministic escalation when an issue becomes blocked or review requests
  changes;
- a write gate after a trigger, while read-only diagnosis remains available;
- voluntary consultation only for a genuinely unresolved or high-risk choice;
- Advisor requests for a falsifiable validation step and fallback;
- preservation of an already validated artifact until a replacement passes.

No benchmark prompt named Advisor or asked an agent to consult it. Session mode
was `auto`. Every observed consultation was caused by a runtime trigger, not a
manual command or an autonomous voluntary call.

## Protocol

Both arms used high thinking with the same model matrix:

- coder/executor: `openai-codex/gpt-5.6-luna`;
- independent tester: `openai-codex/gpt-5.6-luna`;
- read-only reviewer: `openai-codex/gpt-5.6-luna`;
- Advisor, when enabled: `openai-codex/gpt-5.6-sol`.

The treatment difference was `advisor_policy.enabled`. Variant order alternated
by task. Each arm received an independent tester, coder, reviewer, and revision
run. The harness used `--time-multiplier 2`, producing 50-minute total budgets
for scheduler/polyglot and 80-minute budgets for circuit/chess. Relevant coder
caps were 30, 30, 56, and 58 minutes respectively.

Fixtures and graders were pinned by hash to Terminal-Bench 2.1 commit
`a0c400b1138e8c2272c2fc7daa4fa35199b43bef`. Oracle and deliberately broken
negative controls passed before the formal matrix.

## Quality Results

Binary reward requires every granular check.

| Task | pi-company | + Advisor | Calls | Trigger |
| --- | ---: | ---: | ---: | --- |
| LLM inference batching scheduler | 6/6 | 6/6 | 0 | none |
| Rust/C++ polyglot | 5/5 | 5/5 | 1 | repeated tool failure |
| Fibonacci square-root circuit | 7/7 | 7/7 | 1 | repeated tool failure |
| Regex chess | 6/6 | 6/6 | 1 | reviewer requested changes |
| **Aggregate** | **24/24** | **24/24** | **3** | **4 evidence events** |

Regex chess recorded two evidence events for the same consultation: the PR
review decision and its review inbox message. Both were cleared by one
successful call. Thus four trigger events produced three consultations; this
is not four model calls.

The treatment also produced much smaller valid artifacts on two generative
tasks: 3,684 versus 24,241 circuit gate lines, and a 0.91 MB versus 2.95 MB
chess transducer. These are secondary artifact-shape observations, not extra
grader points or proof of better maintainability.

## Efficiency

The observed single-run efficiency result favored the baseline in aggregate:

| Metric | pi-company | + Advisor | Delta |
| --- | ---: | ---: | ---: |
| Agent stage time | 95.78 min | 132.18 min | +38.0% |
| Combined tokens | 14.99M | 29.18M | +94.6% |
| Pi catalog cost estimate | $3.546 | $5.500 | +55.1% |
| Total Pi tool calls | 527 | 616 | +16.9% |
| Direct Advisor tokens | 0 | 36,508 | +36,508 |
| Direct Advisor catalog estimate | $0 | $0.231 | +$0.231 |

| Task | Baseline min | Advisor min | Baseline tokens | Advisor tokens |
| --- | ---: | ---: | ---: | ---: |
| Scheduler | 12.18 | 18.77 | 1.89M | 3.93M |
| Polyglot | 18.53 | 20.33 | 2.08M | 1.28M |
| Circuit | 25.83 | 52.98 | 5.25M | 15.14M |
| Regex chess | 39.24 | 40.09 | 5.77M | 8.83M |

Direct Sol consultation was only 36.5K tokens and $0.231 of the treatment.
Most of the aggregate delta came from different Luna execution trajectories,
especially the circuit task, rather than the three Advisor responses
themselves. With stochastic agents and one pair per task, these efficiency
deltas are observations, not a clean causal estimate of Advisor overhead.

The catalog values are Pi model-catalog estimates for observed subscription
route usage. They are not evidence of a separate charge on the user's bill.

## Time Budget Finding

Doubling the budget was justified. The valid regex baseline coder took 25.8
minutes, while an earlier infrastructure-invalid attempt worked for 48.4
minutes before its provider stream ended as `terminated`. A five-minute cap or
the original 29-minute regex coder cap would have measured speed rather than
completed quality for that attempt.

Two Advisor-arm reviewer stages reached their equal six-minute stage cap. The
harness retained their filesystem work, continued through revision, and both
final artifacts passed every grader check. No complete task exhausted its
50- or 80-minute total budget.

## Data Integrity

Eight valid cells are retained in the persistent JSONL checkpoint. The first
regex baseline attempt ended with a provider `terminated` signal after it had
created a PR and passed company-side tests. It was rejected as infrastructure,
not scored, and rerun from a fresh cell. The matrix retry classifier now treats
`terminated` as a transient provider error alongside network resets.

The eight retained cells had no Advisor audit failures, quota failures, or
provider failures. All three Advisor calls were sent successfully and all
trigger state was cleared after success.

## Interpretation

This experiment supports four conclusions:

1. **Automatic escalation works without prompt babysitting.** Runtime evidence
   triggered all three consultations, including the reviewer-arbitration path.
2. **The adaptive policy fixed overuse.** It reduced calls sharply and did not
   reproduce the quality loss observed in the earlier eager batch.
3. **It did not demonstrate quality lift.** Luna plus pi-company already passed
   every holdout task, leaving no headroom for Sol to improve the score.
4. **It is not yet an efficiency win.** The direct Advisor cost was modest, but
   treatment trajectories were slower and more token-heavy in aggregate.

The old eager and new adaptive batches use different task sets and time
protocols, so their quality totals are descriptive, not a controlled
before/after test. The next statistically useful test should use tasks where
the unaided Luna baseline passes roughly 30-70% of repeated seeds, then compare
at least three paired seeds per task. Until then, adaptive mode is best viewed
as a bounded rescue and arbitration channel, not a proven quality multiplier.

## Resource Footprint

- no Harbor, Docker, VM, or local model downloads;
- final disposable run root: approximately 1.9 MiB;
- persistent eight-cell checkpoint: approximately 32 KiB;
- machine-readable report: approximately 12 KiB;
- approximately 50 GiB remained free after completion.

## Reproduce

```bash
node scripts/native-tbench-expanded-matrix.mjs \
  --tasks llm-inference-batching-scheduler,polyglot-rust-c,circuit-fibsqrt,regex-chess \
  --variants company,company-advisor \
  --run-root /tmp/pi-company-adaptive-holdout-2x \
  --checkpoint .benchmark-work/native-tbench-adaptive-holdout-2x.jsonl \
  --executor-model gpt-5.6-luna \
  --validator-model gpt-5.6-luna \
  --advisor-model gpt-5.6-sol \
  --time-multiplier 2 \
  --codex-client-compat \
  --proxy http://127.0.0.1:45678 \
  --min-free-gib 12 \
  --max-run-mib 250 \
  --retry-transient-errors 1 \
  --retry-usage-limits 1
```

Machine-readable summary:
[`NATIVE_TBENCH_ADAPTIVE_ADVISOR_2026-07-12.json`](NATIVE_TBENCH_ADAPTIVE_ADVISOR_2026-07-12.json)
