# Native Terminal-Bench Non-Security Advisor Evaluation

Date: 2026-07-11

Follow-up: the six-task expanded evaluation is in
[`NATIVE_TBENCH_EXPANDED_ADVISOR_2026-07-12.md`](NATIVE_TBENCH_EXPANDED_ADVISOR_2026-07-12.md).

This is a paired, low-disk local experiment, not a Terminal-Bench leaderboard
result. It evaluates pi-company's autonomous Advisor mode only on non-security
tasks.

## Executive Result

Advisor is useful as a selective capability, but the current auto policy is not
a reliable quality multiplier.

On two hard Terminal-Bench 2.1 tasks, pi-company and pi-company + Advisor each
earned one binary pass. Advisor rescued the scientific fitting task, but
regressed the compressor task. Across those two tasks:

- binary reward remained 1/2;
- granular checks fell from 16/17 to 13/17;
- total tokens fell 45.9%;
- ordinary tool calls fell 13.3%;
- estimated catalog cost fell 6.2%;
- wall time rose 6.9%.

This supports keeping `off`, `once`, and `auto` controls. It does not support
making `auto` the default for every company task.

## Model Matrix

Every hard-task cell used high thinking with:

- executor: `openai-codex/gpt-5.6-luna`;
- independent tester: `openai-codex/gpt-5.6-sol`;
- read-only reviewer: `openai-codex/gpt-5.6-sol`;
- Advisor: `openai-codex/gpt-5.6-sol`.

The only treatment was `advisor_policy.enabled`. No benchmark prompt requested
or manually triggered advice. The Luna coder chose every Advisor call through
the normal auto-mode tool description and OKF guidance.

Pi 0.80.6 used the same benchmark-only Codex client compatibility header for
Luna in every cell.

## Hard Tasks

The tasks came from an inspected public official Terminal-Bench 2.1 job. These
rates describe that one 25-trial slice, not global canonical pass rates:

| Task | Inspected successes | Capability tested |
| --- | ---: | --- |
| `raman-fitting` | 1/25 | Scientific parsing, physical conversion, and nonlinear fitting |
| `write-compressor` | 15/25 | Reverse engineering, arithmetic coding, exact bytes, and a hard size cap |

Official sources:

- https://github.com/harbor-framework/terminal-bench-2-1/tree/main/tasks/raman-fitting
- https://github.com/harbor-framework/terminal-bench-2-1/tree/main/tasks/write-compressor
- inspected job: https://hub.harborframework.com/jobs/10e2e56b-ed31-5f65-a489-69f78b902adf

Both variants received the same 15-minute deadline: 2 minutes for independent
test planning, up to 10 for implementation, 2 for read-only review, and the
remaining time for revision.

## Native Scorers

The benchmark avoids Harbor, Docker, VM images, and model downloads. Fixtures
are byte- and SHA-256-pinned to Terminal-Bench 2.1 commit
`a0c400b1138e8c2272c2fc7daa4fa35199b43bef`.

The scorers expose no expected answers to agents and run only after the model
deadline:

- Raman: JSON/schema checks plus the official tolerances for eight fit
  parameters, totaling 11 checks;
- compressor: existence, 2,500-byte cap, decoder compilation and execution,
  decompressed length, and exact bytes, totaling 6 checks.

The official compressor's `printf("%s", buf)` reads an unterminated output
buffer, which produced a spurious extra byte on this Mac. The native scorer
changes only `char buf[10000]` to a zero-initialized buffer before compiling;
the compression format is unchanged. The pinned reference compressor then
produced a 2,264-byte stream and decoded to the exact 4,868-byte target.

Scorer controls passed before formal runs:

| Task | Oracle | Negative control |
| --- | ---: | ---: |
| Raman | 11/11, reward 1 | 2/11, reward 0 |
| Compressor | 6/6, reward 1 | 4/6, reward 0 |

## Quality Results

Binary reward requires every granular check.

| Task | pi-company | pi-company + Advisor | Observed effect |
| --- | ---: | ---: | --- |
| Raman | 10/11, reward 0 | 11/11, reward 1 | rescued to pass |
| Compressor | 6/6, reward 1 | 2/6, reward 0 | regressed to fail |
| **Aggregate** | **16/17, 1/2 rewards** | **13/17, 1/2 rewards** | **-3 checks; equal rewards** |

Granular pass rate moved from 94.1% to 76.5%, a drop of 17.6 percentage points.
Equal aggregate reward hides a task swap: Advisor gained the Raman pass and lost
the compressor pass.

### Raman Improvement

The baseline added a local linear continuum. Seven of eight parameters passed,
but the reported 2D offset was 1,443.67 versus the expected 1,239.09, a 16.5%
relative error outside the 10% tolerance.

The Advisor candidate used a constant-offset Lorentzian and reported 1,298.35,
a 4.8% error. It passed all eight parameters. This is a real positive result: a
strong Advisor was associated with choosing the right model convention and
converting a near miss into a binary pass.

### Compressor Regression

The baseline generated a valid 2,477-byte stream, only 23 bytes below the cap,
and reproduced all 4,868 target bytes exactly.

The Advisor candidate timed out at 2,615 bytes. Its stream also failed in the
decoder, so this was not merely a size miss. A second consultation occurred in
the final 94-second revision stage, but no corrected artifact landed before the
shared deadline.

## Efficiency Results

Token totals include cache reads. Cost is Pi's catalog estimate for observed
subscription-route usage, not proof of an additional cash charge.

| Variant | Wall time | Tokens | Est. cost | Tools | Advisor calls | Advisor tokens | Advisor cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pi-company | 28.0 min | 3,473,637 | $1.86911 | 165 | 0 | 0 | $0 |
| pi-company + Advisor | 29.9 min | 1,880,261 | $1.75387 | 143 | 5 | 35,133 | $0.23142 |
| Advisor delta | +6.9% | -45.9% | -6.2% | -13.3% | +5 | +35,133 | +$0.23142 |

Per-task treatment deltas:

| Task | Time | Tokens | Est. cost | Tools | Calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Raman | -0.01% | -48.0% | -4.6% | -4.5% | 3 |
| Compressor | +14.9% | -41.3% | -8.0% | -23.4% | 2 |

All five consultations succeeded technically and were made by the coder. Raman
used two calls during implementation and one during revision. Compressor used
one during implementation and one during its final revision. A per-turn limit
of two resets for a separate revision turn, so it is not a whole-workflow cap.

## Earlier Three-Way Control

The earlier non-security `cancel-async-tasks` run compared all three requested
execution shapes under a 15-minute budget:

| Luna matrix | Official checks | Shadow robustness |
| --- | ---: | ---: |
| plain Pi | 6/6 | 6/8 |
| pi-company | 6/6 | 8/8 |
| pi-company + Advisor | 6/6 | 8/8 |

That task had an official scoring ceiling. It showed a robustness benefit from
the company tester/reviewer workflow, but no incremental quality lift from
Advisor. Full details are in
[`NATIVE_TBENCH_ADVISOR_2026-07-10.md`](NATIVE_TBENCH_ADVISOR_2026-07-10.md).

## Interpretation

The evidence separates four different claims:

1. **Can Pi implement Advisor? Yes.** Auto-mode calls occurred on both hard
   tasks without a user prompt naming Advisor.
2. **Is Sol/high strong enough to matter? Yes.** Raman changed from reward 0 to
   1 and used much more accurate parameters.
3. **Does Advisor reliably improve pi-company quality? Not yet.** One hard task
   improved, one regressed, aggregate reward was unchanged, and granular quality
   fell.
4. **Does Advisor improve efficiency? Partly.** It reduced tokens, tools, and
   estimated cost, but did not reduce wall time.

The practical failure mode is treating advice as authority instead of a
hypothesis. On a task with an already verified candidate, changing direction
late can destroy a pass. Synchronous advice near a hard deadline also competes
with implementation time.

## Product Recommendation

Keep the feature, but position it as an escalation control:

- `off` for routine or well-specified work;
- `once` for one uncertain architecture, debugging, or risk decision;
- `auto` for exploratory tasks with enough remaining budget and objective local
  verification.

The next implementation iteration should:

1. default to at most one use per turn;
2. suppress a new consultation when little stage time remains;
3. preserve a locally passing artifact until a replacement also passes;
4. require advice to include a cheap validation test and fallback path;
5. run two or three seeds per task before claiming a pass-rate lift.

The current branch is useful as an opt-in experimental mode. The measured data
does not justify making `auto` a universal company default.

## Limitations

- One stochastic sample per cell is not a confidence interval.
- The run order was company, then Advisor, rather than randomized or
  counterbalanced.
- This is a deliberately small, non-security subset, not the complete TB2.1
  distribution.
- Native scoring matches the relevant contracts but is not a Harbor submission.
- Strong Sol tester and reviewer stages make this an incremental-Advisor test;
  it does not isolate the value of strong-model validation itself.

## Resource Footprint

- peak retained data for the four hard-task cells and shared dependencies:
  approximately 115 MiB;
- no Harbor, Docker, VM, or local model data;
- free disk at matrix completion: approximately 11 GiB;
- complete paired catalog estimate: $3.62298;
- direct Advisor portion: $0.23142.

The runner aborts below 10 GiB free space and above 250 MiB for the complete
extra-task run root, including shared dependencies. All temporary formal-run,
fixture, and self-test directories were removed after the report was validated.

## Reproduce

Build and validate the scorers first:

```bash
npm run build
node scripts/native-tbench-extra-grade.mjs --self-test all \
  --cache-root /tmp/pi-company-extra-grade-cache
```

Run either hard task as a pair:

```bash
node scripts/native-tbench-advisor-eval.mjs \
  --task raman-fitting \
  --variant company \
  --run-root /tmp/pi-company-native-multitask \
  --executor-model gpt-5.6-luna \
  --strong-model gpt-5.6-sol \
  --codex-client-compat

node scripts/native-tbench-advisor-eval.mjs \
  --task raman-fitting \
  --variant company-advisor \
  --run-root /tmp/pi-company-native-multitask \
  --executor-model gpt-5.6-luna \
  --strong-model gpt-5.6-sol \
  --codex-client-compat
```

Replace `raman-fitting` with `write-compressor` for the other pair. Add
`--proxy URL` only when the provider or pinned fixture download requires it.
`--prepare-only` downloads and verifies fixtures and dependencies without
calling a model. `--finalize-existing` grades a preserved candidate without
calling a model again.
