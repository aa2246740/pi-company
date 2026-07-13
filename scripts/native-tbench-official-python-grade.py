#!/usr/bin/env python3
"""Run pinned official Python checks against a native candidate path."""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import traceback


def load_namespace(source: str, filename: str) -> dict[str, object]:
    namespace: dict[str, object] = {"__file__": filename, "__name__": "native_tbench_check"}
    exec(compile(source, filename, "exec"), namespace)
    return namespace


def dna_check(candidate: Path, fixture: Path) -> dict[str, object]:
    primers = candidate / "primers.fasta"
    source = fixture.read_text(encoding="utf-8")
    marker = 'Path("/app/primers.fasta")'
    if marker not in source:
        raise RuntimeError("Pinned DNA verifier layout changed")
    source = source.replace(marker, f"Path({str(primers)!r})")

    with tempfile.TemporaryDirectory(prefix="pi-company-oligotm-") as temp:
        shim = Path(temp) / "oligotm"
        shim.write_text(
            f"""#!{sys.executable}
import sys
import primer3
seq = sys.argv[-1]
print(primer3.calc_tm(
    seq,
    mv_conc=50,
    dv_conc=2,
    dntp_conc=0.8,
    dna_conc=500,
    tm_method="santalucia",
    salt_corrections_method="santalucia",
))
""",
            encoding="utf-8",
        )
        shim.chmod(0o755)
        old_path = os.environ.get("PATH", "")
        os.environ["PATH"] = f"{temp}{os.pathsep}{old_path}"
        try:
            namespace = load_namespace(source, str(fixture))
            output = io.StringIO()
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                namespace["test_primers"]()
            return {"passed": True, "detail": "pinned official primer verifier passed"}
        except BaseException as exc:
            return {
                "passed": False,
                "detail": f"{type(exc).__name__}: {exc}",
                "trace": traceback.format_exc()[-4000:],
            }
        finally:
            os.environ["PATH"] = old_path


def regex_checks(candidate: Path, fixture: Path) -> dict[str, object]:
    re_json = candidate / "re.json"
    source = fixture.read_text(encoding="utf-8")
    marker = '"/app/re.json"'
    if marker not in source:
        raise RuntimeError("Pinned regex-chess verifier layout changed")
    source = source.replace(marker, repr(str(re_json)))
    namespace = load_namespace(source, str(fixture))
    test_names = [
        "test_immortal_game",
        "test_game_of_century",
        "test_naroditsky_ivanchuk",
        "test_not_long",
    ]
    checks: list[dict[str, object]] = []
    for name in test_names:
        output = io.StringIO()
        try:
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                namespace[name]()
            checks.append({"name": name, "passed": True, "detail": "passed"})
        except BaseException as exc:
            checks.append({
                "name": name,
                "passed": False,
                "detail": f"{type(exc).__name__}: {exc}",
                "trace": traceback.format_exc()[-4000:],
            })
    return {"checks": checks}


def scheduler_checks(candidate: Path, fixture: Path, support_fixture: Path) -> dict[str, object]:
    task_root = candidate / "task_file"
    source = fixture.read_text(encoding="utf-8")
    if "/app/task_file" not in source or "from .cost_model_for_tests import" not in source:
        raise RuntimeError("Pinned scheduler verifier layout changed")
    source = source.replace("/app/task_file", str(task_root))
    source = source.replace(
        "from .cost_model_for_tests import",
        "from cost_model_for_tests import",
    )

    with tempfile.TemporaryDirectory(prefix="pi-company-scheduler-grade-") as temp:
        module_root = Path(temp)
        (module_root / "cost_model_for_tests.py").write_bytes(support_fixture.read_bytes())
        sys.path.insert(0, str(module_root))
        try:
            namespace = load_namespace(source, str(fixture))
            test_names = [
                "test_output_files_exist",
                "test_input_data_integrity",
                "test_generate_and_schema",
                "test_solution_shape_feasibility_and_batch_consistency",
                "test_solution_coverage_no_duplicates",
                "test_performance_thresholds",
            ]
            checks: list[dict[str, object]] = []
            for name in test_names:
                output = io.StringIO()
                try:
                    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                        namespace[name]()
                    checks.append({"name": name, "passed": True, "detail": "passed"})
                except BaseException as exc:
                    checks.append({
                        "name": name,
                        "passed": False,
                        "detail": f"{type(exc).__name__}: {exc}",
                        "trace": traceback.format_exc()[-4000:],
                    })
            return {"checks": checks}
        finally:
            sys.path.remove(str(module_root))
            sys.modules.pop("cost_model_for_tests", None)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["dna", "regex", "scheduler"], required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--support-fixture", type=Path)
    args = parser.parse_args()

    if args.mode == "dna":
        result = dna_check(args.candidate.resolve(), args.fixture.resolve())
    elif args.mode == "regex":
        result = regex_checks(args.candidate.resolve(), args.fixture.resolve())
    else:
        if args.support_fixture is None:
            parser.error("--support-fixture is required for scheduler mode")
        result = scheduler_checks(
            args.candidate.resolve(),
            args.fixture.resolve(),
            args.support_fixture.resolve(),
        )
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
