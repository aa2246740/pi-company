# Native Terminal-Bench XSS Advisor Evaluation

Date: 2026-07-10

This is a paired local experiment, not a Terminal-Bench leaderboard result. It
uses the Terminal-Bench 2.1 `filter-js-from-html` contract without Harbor,
Docker, VM images, or model downloads.

## Why This Task

The first Advisor experiment reached a scoring ceiling. In a public official
TB 2.1 source job containing 2,227 trials across five frontier agent/model
pairs, `filter-js-from-html` and `extract-moves-from-video` were tied at the
bottom with 0/25 valid successes. The XSS task was selected because it is the
hardest empirical result that also remains a small, relevant coding task:

- official task: https://github.com/harbor-framework/terminal-bench-2-1/tree/main/tasks/filter-js-from-html
- inspected public job: https://hub.harborframework.com/jobs/10e2e56b-ed31-5f65-a489-69f78b902adf
- task files plus the pinned attack corpus are well below 2 MiB;
- no video model, training dataset, compiler image, or Linux VM is needed.

The task metadata calls it `medium`; the selection here is based on observed
frontier-agent pass rate in that public job, not the author-assigned label.

## Paired Setup

Both cells received the same 30-minute total deadline and the same workflow:

1. Sol/high independent pre-implementation tester;
2. Luna/high coder;
3. Sol/high read-only reviewer;
4. Luna/high revision stage.

The only configured treatment was `advisor_policy.enabled`. The Advisor cell
used Sol/high. No user prompt named, requested, or manually triggered the
Advisor.

Pi 0.80.6 required the existing benchmark-only Codex client-version
compatibility extension for Luna. Both cells used the same extension.

## Native Scorer

The scorer uses Python 3.13, BeautifulSoup 4.13.4, and the globally pinned
Playwright 1.61.1 / Chromium 149 runtime. It downloads and pins commit
`b873b79806e166164533109d1055daac00d4d1d3` of
`davidwagner/html-sanitizer-testbed` after the agent has finished.

There are 42 granular checks:

- `filter.py` exists;
- all 439 attack inputs complete successfully;
- 28 browser batches produce no JavaScript dialogs;
- 12 clean HTML documents survive parser normalization unchanged.

The extra successful-execution check deliberately closes a weakness in the
official verifier, which omits attack files when `filter.py` exits nonzero. The
binary reward still requires every check. The reference implementation scored
42/42; a parser-only implementation scored 24/42; deleting all content scored
30/42.

## Results

Token totals include cache-read tokens. Cost is Pi's catalog estimate for the
observed subscription-route usage, not proof of a separate cash charge.

| Variant | Reward | Checks | Attack inputs | Browser batches | Clean HTML | Agent time | Tokens | Est. cost | Tools | Advisor |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi-company | 0 | 41/42 | 439/439 | 27/28 | 12/12 | 22.0 min | 3,429,758 | $1.30316 | 126 | 0 |
| pi-company + Advisor | 0 | 37/42 | 434/439 | 24/28 | 12/12 | 23.6 min | 2,548,776 | $1.46804 | 102 | 3 |

Advisor relative to the matching company baseline:

- quality: -4 granular checks, from 97.6% to 88.1%;
- wall time: +7.2%;
- total tokens: -25.7%;
- estimated cost: +12.7%;
- ordinary tool calls: -19.0%.

## Failure Analysis

The baseline was close but not correct. It processed every input and preserved
all clean documents, but one real browser dialog remained in attack batch 22.

The Advisor candidate retained that same browser escape and introduced five
fail-closed errors:

- one input was rejected as `sanitizer emitted active markup`;
- four inputs were rejected as `sanitizer did not reach a stable output`.

Those errors caused three additional failed browser batches under the hardened
scorer. Even under the official verifier's skip-on-error behavior, the shared
batch-22 dialog means both candidates still receive binary reward 0.

The Advisor calls themselves worked as designed and were fully autonomous:

| Stage | Use | Advisor tokens | Duration |
| --- | ---: | ---: | ---: |
| coder implementation | 1 | 5,161 | 21.2 s |
| coder implementation | 2 | 20,185 | 32.8 s |
| coder revision | 1 | 7,289 | 29.8 s |

Together they used 32,635 tokens and an estimated $0.22953. `max_uses_per_turn`
reset for the separate revision turn, so the full company workflow made three
calls despite a per-turn limit of two.

## Conclusion

This hard paired trial does **not** show an Advisor quality improvement. The
Advisor variant was more token- and tool-efficient, but its final candidate was
less robust and more expensive. Combined with the earlier ceiling task, the
current evidence is:

- autonomous escalation works;
- reduced exploration is reproducible across two tasks;
- final-answer quality improvement is still unproven;
- on this hardest low-disk task, the observed quality moved in the wrong
  direction.

One paired sample cannot establish a general negative causal effect because
the model runs are stochastic. It is enough to reject the claim that enabling
Advisor automatically guarantees better code. For company workflows that
already have strong tester and reviewer stages, start with one Advisor use per
turn or session-level `once`, and keep auto mode for genuinely ambiguous tasks
until a multi-seed benchmark demonstrates a pass-rate lift.

## Resource Footprint

- retained formal run directory: 6.6 MiB;
- shared BeautifulSoup target: 1.9 MiB;
- pinned corpus cache: 1.8 MiB;
- no Docker or Harbor data;
- free disk after the run: approximately 13 GiB;
- paired formal catalog estimate: $2.77119.

The runner aborts below 10 GiB free space or above 250 MiB for the complete run
root.

## Reproduce

Build first:

```bash
npm run build
```

Run the baseline:

```bash
node scripts/native-tbench-advisor-eval.mjs \
  --task filter-js-from-html \
  --variant company \
  --run-root /tmp/pi-company-native-xss-luna \
  --executor-model gpt-5.6-luna \
  --strong-model gpt-5.6-sol \
  --codex-client-compat \
  --proxy http://127.0.0.1:45678
```

Run the Advisor cell with the same root and model matrix:

```bash
node scripts/native-tbench-advisor-eval.mjs \
  --task filter-js-from-html \
  --variant company-advisor \
  --run-root /tmp/pi-company-native-xss-luna \
  --executor-model gpt-5.6-luna \
  --strong-model gpt-5.6-sol \
  --codex-client-compat \
  --proxy http://127.0.0.1:45678
```

If model stages completed but grading infrastructure failed, repeat the exact
command with `--finalize-existing`. It validates the stage checkpoints and
grades the preserved candidate without calling a model again.
