# Native Terminal-Bench Advisor Evaluation

Date: 2026-07-10

Hard-task follow-up: see
[`NATIVE_TBENCH_XSS_ADVISOR_2026-07-10.md`](NATIVE_TBENCH_XSS_ADVISOR_2026-07-10.md).
On the empirical 0/25 `filter-js-from-html` task, company scored 41/42 while
company + Advisor scored 37/42. That follow-up rejects any claim of a proven
quality lift from the current auto policy.

This is a small, local A/B experiment, not a Terminal-Bench leaderboard result.
It uses one Terminal-Bench 2.1 task (`cancel-async-tasks`) and reimplements that
task's assertions with the system Python 3.13 runtime. It deliberately avoids
Harbor, Docker, VM images, and benchmark dataset downloads.

## Question

Compare three execution shapes under the same 15-minute task budget:

1. plain Pi;
2. pi-company with tester, coder, reviewer, and revision stages;
3. the same pi-company flow with automatic inline Advisor access enabled.

The Advisor variant differs from the company baseline only by
`advisor_policy.enabled`. No prompt names or manually triggers the Advisor tool.

## Model Matrices

The Sol matrix uses `openai-codex/gpt-5.6-sol` with high thinking for every
role. The Luna matrix uses `openai-codex/gpt-5.6-luna` with high thinking for
the executor and Sol/high for tester, reviewer, and Advisor.

Pi 0.80.6 lists Luna but its Codex provider omits the client `Version` header;
the backend consequently rejects Luna as requiring a newer Codex client. Codex
CLI 0.144.1 succeeds with the same account. Luna runs therefore load the
benchmark-only `codex-client-compat-extension.ts`, which adds
`Version: 0.144.1` and changes nothing else. It does not enable priority tier.

## Official-Equivalent Checks

The native scorer checks:

- `run.py` exists;
- tasks run concurrently;
- `max_concurrent` is obeyed;
- cancellation below the limit cleans every started task;
- cancellation at the limit cleans every started task;
- cancellation above the limit does not start the queued task and cleans every
  started task.

All candidates are graded after the model deadline, including timed-out runs.

## Results

Token totals include cache-read tokens. Cost is Pi's catalog estimate for the
observed usage, not proof of a separate cash charge when the authenticated
`openai-codex` subscription route is used.

| Executor matrix | Variant | Checks | Agent time | Tokens | Est. cost | Tool calls | Advisor calls |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Sol/high | plain Pi | 6/6 | 264.1 s | 101,986 | $0.46583 | 17 | 0 |
| Sol/high | pi-company | 6/6 | 807.9 s | 648,108 | $1.34477 | 60 | 0 |
| Sol/high | pi-company + Advisor | 6/6 | 899.4 s | 529,636 | $1.34643 | 49 | 3 |
| Luna/high | plain Pi | 6/6 | 900.0 s timeout | 72,652 | $0.07944 | 11 | 0 |
| Luna/high + Sol validation | pi-company | 6/6 | 898.4 s | 1,380,715 | $0.94192 | 78 | 0 |
| Luna/high + Sol validation | pi-company + Advisor | 6/6 | 898.6 s | 974,251 | $1.01530 | 63 | 2 |

The first Luna timeout exposed a harness cleanup defect: an inherited pipe kept
the wrapper alive after the 900-second model deadline. Its candidate was already
fixed and graded at the deadline, so the table reports the 900-second task
budget. Later runs use TERM, then KILL, then forced pipe closure and separately
record sub-second cleanup delay.

## Advisor Delta

Relative to the matching pi-company baseline:

| Executor | Time | Tokens | Est. cost | Tool calls |
| --- | ---: | ---: | ---: | ---: |
| Sol/high | +11.3% | -18.3% | +0.1% | -18.3% |
| Luna/high | +0.02% | -29.4% | +7.8% | -19.2% |

The successful Advisor calls were autonomous and auditable:

- Sol matrix: 3 calls, 18,117 Advisor tokens, $0.14949 estimated Advisor cost;
- Luna matrix: 2 calls, 15,534 Advisor tokens, $0.17940 estimated Advisor cost.

In this fixed-budget task, Advisor reduced exploration but did not reduce wall
time. The synchronous consultations consumed part of the coder budget. That is
a reason to start with one consultation per turn and a smaller response budget,
not evidence that every task should run with Advisor disabled.

## Adversarial Shadow Suite

The official-equivalent scorer had a ceiling: every candidate scored 6/6. A
separate, non-official shadow suite then checked stress concurrency, child and
factory failure propagation, lazy admission, Future awaitables, external and
repeated cancellation, a cancellation/admission race, and a child that
suppresses its own cancellation.

| Model | plain Pi | pi-company | pi-company + Advisor |
| --- | ---: | ---: | ---: |
| Sol/high | 5/8 | 8/8 | 8/8 |
| Luna/high | 6/8 | 8/8 | 8/8 |

The robustness gain on this task came from pi-company's independent tester,
reviewer, and revision loop. Advisor did not raise the already-perfect company
shadow score; its measurable contribution was fewer executor tokens and tool
calls.

## Interpretation

1. Pi can implement the Advisor pattern. The executor discovered and called the
   parameterless tool in auto mode without a user prompt naming it.
2. Advisor is not a universal speed switch. On a task Sol can already solve,
   plain Pi was fastest and cheapest.
3. The company workflow bought robustness at substantial orchestration cost.
   That trade is sensible for high-risk implementation work, not every edit.
4. Advisor helped the weaker executor stay more focused: Luna company + Advisor
   used 29.4% fewer tokens and 19.2% fewer tools than Luna company. The two Sol
   consultations raised estimated total cost by 7.8% and did not beat the fixed
   deadline.
5. One task and one sample per cell cannot establish a general pass-rate lift.
   A defensible next experiment is a stratified 5-10 task sample with two or
   three seeds, while preserving the same model, time, and disk controls.

## Recommended Trial Configuration

For normal development, start narrower than the current maximum:

```yaml
advisor_policy:
  enabled: true
  max_uses_per_turn: 1
  timeout_ms: 60000
  max_output_tokens: 2048
  max_transcript_chars: 160000
  max_company_context_chars: 24000
```

Use a cheap executor at low or medium thinking, a strong Advisor at high
thinking, and independent tester/reviewer models. Turn Advisor off for routine
edits, use `once` for one risky decision, and use `auto` for genuinely ambiguous
or long-running work.

## Reproduce

Build first:

```bash
npm run build
```

Run one Sol cell:

```bash
node scripts/native-tbench-advisor-eval.mjs \
  --variant company-advisor \
  --run-root /tmp/pi-company-native-eval \
  --executor-model gpt-5.6-sol \
  --strong-model gpt-5.6-sol \
  --proxy "$HTTPS_PROXY"
```

Run one Luna cell with the temporary compatibility header:

```bash
node scripts/native-tbench-advisor-eval.mjs \
  --variant company-advisor \
  --run-root /tmp/pi-company-native-eval-luna \
  --executor-model gpt-5.6-luna \
  --strong-model gpt-5.6-sol \
  --codex-client-compat \
  --proxy "$HTTPS_PROXY"
```

Omit `--proxy` when direct access works. The runner also honors `HTTPS_PROXY`,
`HTTP_PROXY`, and `ALL_PROXY` without the flag.

Run the shadow suite against any candidate containing `run.py`:

```bash
python3.13 scripts/native-tbench-shadow-grade.py --candidate /path/to/candidate
```

The runner aborts below 10 GiB free space or above 200 MiB of per-variant
artifacts. These six retained evaluation directories total about 5.2 MiB; the
largest single variant was about 1.3 MiB.

## Daily Advisor Controls

Inside an attached company Pi session:

```text
/company-advisor status
/company-advisor auto
/company-advisor once
/company-advisor off
/company-advisor default
```

`auto`, `once`, and `off` are session overrides and do not inject a user prompt.
`default` returns to `.pi-company/company.yaml`'s `advisor_policy.enabled` value.
