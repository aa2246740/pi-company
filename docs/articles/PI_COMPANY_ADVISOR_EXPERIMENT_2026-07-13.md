# Pi Company Advisor: Let Fast Agents Execute, and Strong Models Step In When It Matters

*Why we built it, how automatic escalation works, and what a small hard-task evaluation actually showed.*

Most coding agents make an expensive default choice: they put the strongest model in charge of every step.

That is often unnecessary. Reading files, making scoped edits, running tests, and fixing ordinary failures do not always need the slowest and most capable model available.

The real challenge is different: how do you let a fast model do most of the work, while still getting strong-model judgment when the work becomes genuinely uncertain?

That is the problem behind **Pi Company Advisor**.

## The Missing Layer in Multi-Agent Workflows

[pi-company](https://github.com/aa2246740/pi-company) already gives a coding task a horizontal team: a coder implements, a tester looks for failure modes, and a reviewer checks the result independently.

What it lacked was a vertical escalation path.

A fast coder usually has two bad options when it reaches a hard decision: keep guessing, or replace the entire workflow with a stronger and slower model.

Advisor adds a third option. The fast model keeps control of the agent loop. A stronger model is consulted only at a consequential moment, then the fast model continues the work.

The idea is inspired by [Claude's Advisor Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool). Claude implements this server-side. Pi Company implements the same collaboration pattern in its Pi extension.

When an Advisor call happens, Pi Company pauses only the current executor, sends bounded working context and a read-only company snapshot to the configured Advisor model, and returns the advice as a tool result.

The coder still executes. The tester, reviewer, tests, and quality gates still decide whether the work is acceptable.

That distinction matters: advice is a hypothesis to validate, not an instruction to obey.

## What “Auto” Actually Means

The feature would be much less useful if someone had to watch the company and type “ask the strong model now.”

So `auto` has two paths to escalation.

First, the executor may call the Advisor itself when it encounters a high-impact unresolved choice, conflicting evidence, or uncertainty it cannot validate well enough.

Second, Pi Company watches external, auditable signals. It can trigger escalation after repeated matching tool failures, a blocked issue, or a reviewer requesting changes.

The runtime does not pretend to read hidden chain-of-thought. It reacts to visible evidence.

Each task is bounded to one successful Advisor consultation by default. That keeps the strong model from quietly becoming the full-time executor.

Users can change the policy at any time:

```text
/company-advisor auto
/company-advisor once
/company-advisor off
/company-advisor status
```

`auto` persists as session state, but it does not force a consultation. It makes escalation available to the executor and the runtime when there is a reason to use it.

## We Tested the Claim, Not Just the Feature

Early experiments taught us two useful lessons. Asking a strong model eagerly can rescue one task and derail another. Then a later adaptive evaluation produced perfect baseline scores, leaving no room to measure quality lift at all.

For the next run, we selected three harder, non-security Terminal-Bench tasks and doubled the execution budgets. The goal was to avoid measuring only speed or an easy-task ceiling.

Both arms used the same setup: GPT-5.6 Luna for tester, coder, and reviewer; GPT-5.6 Sol only as the optional Advisor. The sole treatment difference was whether Advisor was enabled.

The tasks and hidden graders were pinned. The agents saw the task and fixtures, never the expected answers.

| Task | Pi Company | Pi Company + Advisor | Advisor behavior |
| --- | ---: | ---: | --- |
| Protein assembly | 5/9 | 5/9 | One runtime-triggered call |
| SQLite WAL recovery | 9/9 | 9/9 | No call |
| Raman fitting | 4/11 | 11/11 | One voluntary call |

The aggregate result was **18/29 to 25/29 granular checks**, and **1/3 to 2/3 full task passes**.

## Three Outcomes, Three Important Lessons

**Protein assembly showed that Advisor is not magic.**

The runtime correctly detected repeated tool failure and consulted Sol. The call succeeded, but the coder still chose the wrong protein component. Both variants finished at 5/9.

This is the failure mode we want to keep visible: a successful consultation is not the same thing as a correct answer.

**WAL recovery showed that `auto` can stay quiet.**

Both variants recovered all eleven records correctly. The Advisor arm made zero Sol calls.

That is a feature, not a missing feature. Persistent `auto` should not mean “spend strong-model tokens on every task.”

**Raman fitting showed the behavior we hoped for.**

The baseline produced valid JSON but passed only 4 of 11 checks. Its fitted peak parameters were materially wrong.

The Advisor run had no repeated tool-failure trigger. Instead, Luna chose to consult Sol on its own. No user prompt and no human intervention were involved.

After one consultation, the executor continued the work and passed all 11 checks. The task moved from a clear failure to a complete pass.

That is the strongest result from this experiment: the system did not merely expose a button. It made one voluntary escalation at the right moment and materially changed the outcome.

## The Numbers Beyond Pass/Fail

Across the three paired tasks, the Advisor arm also used less execution effort:

| Metric | Pi Company | + Advisor | Change |
| --- | ---: | ---: | ---: |
| Agent stage time | 60.66 min | 52.10 min | -14.1% |
| Combined tokens | 8.530M | 7.919M | -7.2% |
| Tool calls | 380 | 357 | -6.1% |
| Catalog cost estimate | $2.1715 | $2.2269 | +2.5% |

The Advisor itself was used twice: once by a runtime trigger and once voluntarily by the executor. It accounted for 51,655 tokens and a $0.2909 catalog estimate.

The cost figure is an observed model-catalog estimate, not proof of a separate bill. More importantly, this is only one paired run per task. The time and token deltas are observations, not stable causal estimates.

The same restraint applies to quality. One Advisor win and no losses is encouraging, but three pairs are far too few to claim a reliable pass-rate improvement.

## What This Changes in Practice

The experiment supports a narrower, more useful claim than “stronger models always win.”

Pi Company Advisor is a bounded rescue channel. It lets fast agents keep work moving, adds strong-model judgment at selected decision points, and keeps independent verification in place.

It is especially promising for work with a few consequential choices: scientific fitting, architecture decisions, difficult debugging, ambiguous specifications, or a review that exposes a real contradiction.

It is less useful for routine work, tasks without objective validation, or situations where the deadline is too close for the executor to test a new direction.

The next honest experiment is not a victory lap. It is at least five paired seeds on the hardest tasks, so we can measure a distribution rather than celebrate a single rescue.

For now, the takeaway is simple: **fast agents do not need to become strong agents all the time. They need a reliable way to ask for help when it matters.**

## Read the Full Record

- [Pi Company Advisor implementation branch](https://github.com/aa2246740/pi-company/tree/feat/advisor-mode)

- [Full benchmark report](https://github.com/aa2246740/pi-company/blob/feat/advisor-mode/docs/benchmarks/NATIVE_TBENCH_HARD_ADVISOR_PILOT_2026-07-13.md)

- [Machine-readable results](https://github.com/aa2246740/pi-company/blob/feat/advisor-mode/docs/benchmarks/NATIVE_TBENCH_HARD_ADVISOR_PILOT_2026-07-13.json)

This was a low-disk local paired evaluation, not a Terminal-Bench leaderboard submission. The repository passed 273 tests, type checking, build, and privacy checks for the implementation and benchmark changes.
