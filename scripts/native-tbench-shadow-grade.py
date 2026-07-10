#!/usr/bin/env python3
"""Extra adversarial checks for the native cancel-async-tasks benchmark."""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from typing import Awaitable, Callable


RunTasks = Callable[[list[Callable[[], Awaitable[None]]], int], Awaitable[None]]


class MarkerError(RuntimeError):
    pass


def load_run_tasks(candidate: Path) -> RunTasks:
    run_file = candidate / "run.py"
    if not run_file.is_file():
        raise FileNotFoundError(f"missing {run_file}")
    spec = importlib.util.spec_from_file_location("shadow_candidate_run", run_file)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {run_file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.run_tasks


async def stress_limit(run_tasks: RunTasks) -> str:
    active = 0
    peak = 0
    completed = 0

    async def job() -> None:
        nonlocal active, peak, completed
        active += 1
        peak = max(peak, active)
        try:
            await asyncio.sleep(0.01)
            completed += 1
        finally:
            active -= 1

    await run_tasks([job for _ in range(20)], 3)
    assert peak == 3, f"peak={peak}"
    assert completed == 20, f"completed={completed}"
    return f"peak={peak} completed={completed}"


async def failure_stops_queue(run_tasks: RunTasks) -> str:
    started: list[str] = []
    cleaned: list[str] = []
    release_failure = asyncio.Event()

    async def failing() -> None:
        started.append("failing")
        await release_failure.wait()
        raise MarkerError("expected child failure")

    async def sibling() -> None:
        started.append("sibling")
        release_failure.set()
        try:
            await asyncio.sleep(60)
        finally:
            await asyncio.sleep(0.02)
            cleaned.append("sibling")

    async def queued() -> None:
        started.append("queued")

    try:
        await run_tasks([failing, sibling, queued], 2)
    except MarkerError:
        pass
    else:
        raise AssertionError("child failure was not propagated")
    assert started == ["failing", "sibling"], f"started={started}"
    assert cleaned == ["sibling"], f"cleaned={cleaned}"
    return f"started={started} cleaned={cleaned}"


async def factory_failure_is_lazy(run_tasks: RunTasks) -> str:
    called: list[str] = []

    def bad_factory() -> Awaitable[None]:
        called.append("bad")
        raise MarkerError("factory failed")

    async def queued_job() -> None:
        called.append("queued")

    try:
        await run_tasks([bad_factory, queued_job], 1)
    except MarkerError:
        pass
    else:
        raise AssertionError("factory failure was not propagated")
    assert called == ["bad"], f"called={called}"
    return f"called={called}"


async def accepts_future_awaitables(run_tasks: RunTasks) -> str:
    completed = 0

    def future_factory() -> Awaitable[None]:
        nonlocal completed
        future: asyncio.Future[None] = asyncio.get_running_loop().create_future()

        def finish() -> None:
            nonlocal completed
            completed += 1
            future.set_result(None)

        asyncio.get_running_loop().call_soon(finish)
        return future

    await run_tasks([future_factory for _ in range(4)], 2)
    assert completed == 4, f"completed={completed}"
    return f"completed={completed}"


async def external_cancel_drains(run_tasks: RunTasks) -> str:
    started: list[int] = []
    cleaned: list[int] = []
    both_started = asyncio.Event()

    async def job(index: int) -> None:
        started.append(index)
        if len(started) == 2:
            both_started.set()
        try:
            await asyncio.sleep(60)
        finally:
            await asyncio.sleep(0.03)
            cleaned.append(index)

    runner = asyncio.create_task(
        run_tasks([lambda index=index: job(index) for index in range(3)], 2)
    )
    await asyncio.wait_for(both_started.wait(), 1)
    runner.cancel("shadow-cancel")
    try:
        await runner
    except asyncio.CancelledError:
        pass
    else:
        raise AssertionError("runner cancellation was swallowed")
    assert sorted(started) == [0, 1], f"started={started}"
    assert sorted(cleaned) == [0, 1], f"cleaned={cleaned}"
    return f"started={started} cleaned={cleaned}"


async def repeated_cancel_drains(run_tasks: RunTasks) -> str:
    started = 0
    cleaning = 0
    cleaned = 0
    all_started = asyncio.Event()
    all_cleaning = asyncio.Event()

    async def job() -> None:
        nonlocal started, cleaning, cleaned
        started += 1
        if started == 2:
            all_started.set()
        try:
            await asyncio.sleep(60)
        finally:
            cleaning += 1
            if cleaning == 2:
                all_cleaning.set()
            await asyncio.sleep(0.08)
            cleaned += 1

    runner = asyncio.create_task(run_tasks([job, job], 2))
    await asyncio.wait_for(all_started.wait(), 1)
    runner.cancel("first")
    await asyncio.wait_for(all_cleaning.wait(), 1)
    runner.cancel("second")
    try:
        await runner
    except asyncio.CancelledError:
        pass
    else:
        raise AssertionError("repeated runner cancellation was swallowed")
    assert cleaned == 2, f"cleaned={cleaned}"
    return f"cleaned={cleaned}"


async def cancel_race_stops_admission(run_tasks: RunTasks) -> str:
    for iteration in range(40):
        started: list[str] = []
        first_started = asyncio.Event()
        release = asyncio.Event()

        async def first() -> None:
            started.append("first")
            first_started.set()
            await release.wait()

        async def queued() -> None:
            started.append("queued")

        runner = asyncio.create_task(run_tasks([first, queued], 1))
        await asyncio.wait_for(first_started.wait(), 1)
        release.set()
        runner.cancel()
        try:
            await runner
        except asyncio.CancelledError:
            pass
        else:
            raise AssertionError(f"iteration {iteration}: cancellation was swallowed")
        assert started == ["first"], f"iteration {iteration}: started={started}"
    return "iterations=40 queued_started=0"


async def suppressed_child_cancel_preserves_runner_cancel(run_tasks: RunTasks) -> str:
    started = asyncio.Event()
    cleaned = False

    async def job() -> None:
        nonlocal cleaned
        started.set()
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            await asyncio.sleep(0.02)
            cleaned = True
            return

    runner = asyncio.create_task(run_tasks([job], 1))
    await asyncio.wait_for(started.wait(), 1)
    runner.cancel()
    try:
        await runner
    except asyncio.CancelledError:
        pass
    else:
        raise AssertionError("child suppression swallowed runner cancellation")
    assert cleaned, "child cleanup did not finish"
    return "runner_cancelled=true child_cleaned=true"


CASES = {
    "stress_limit": stress_limit,
    "failure_stops_queue": failure_stops_queue,
    "factory_failure_is_lazy": factory_failure_is_lazy,
    "accepts_future_awaitables": accepts_future_awaitables,
    "external_cancel_drains": external_cancel_drains,
    "repeated_cancel_drains": repeated_cancel_drains,
    "cancel_race_stops_admission": cancel_race_stops_admission,
    "suppressed_child_cancel_preserves_runner_cancel": suppressed_child_cancel_preserves_runner_cancel,
}


def run_case(candidate: Path, case_name: str) -> int:
    try:
        run_tasks = load_run_tasks(candidate)
        detail = asyncio.run(asyncio.wait_for(CASES[case_name](run_tasks), 5))
        result = {"name": case_name, "passed": True, "detail": detail}
    except BaseException as error:
        result = {
            "name": case_name,
            "passed": False,
            "detail": f"{type(error).__name__}: {error}",
        }
    print(json.dumps(result, ensure_ascii=True))
    return 0 if result["passed"] else 1


def run_suite(candidate: Path) -> int:
    checks = []
    for case_name in CASES:
        try:
            process = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).resolve()),
                    "--candidate",
                    str(candidate),
                    "--case",
                    case_name,
                ],
                capture_output=True,
                text=True,
                timeout=7,
                check=False,
            )
            lines = [line for line in process.stdout.splitlines() if line.strip()]
            check = json.loads(lines[-1]) if lines else {
                "name": case_name,
                "passed": False,
                "detail": f"no result; stderr={process.stderr[-500:]}",
            }
        except subprocess.TimeoutExpired:
            check = {"name": case_name, "passed": False, "detail": "process timeout"}
        except BaseException as error:
            check = {
                "name": case_name,
                "passed": False,
                "detail": f"grader error {type(error).__name__}: {error}",
            }
        checks.append(check)

    result = {
        "checks": checks,
        "passed": sum(1 for check in checks if check["passed"]),
        "total": len(checks),
    }
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 0 if result["passed"] == result["total"] else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--case", choices=CASES)
    args = parser.parse_args()
    candidate = args.candidate.resolve()
    return run_case(candidate, args.case) if args.case else run_suite(candidate)


if __name__ == "__main__":
    raise SystemExit(main())
