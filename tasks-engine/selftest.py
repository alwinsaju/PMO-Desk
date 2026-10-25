"""Self-test of the Python the Tasks engine and every task run on.

First-run setup runs this with the bundled interpreter to prove that the packages
import, the shared task libraries load their shipped example files, and a task-style
step (a script run as a subprocess in a fresh folder, exactly how the engine runs
steps) can build, read and solve things on fixture data. Nothing here touches
Outlook or any network, sends nothing, and never reads anyone's real files: the
fixtures are generated in a temp folder or are the examples shipped inside the
shared libraries.

    python selftest.py [--tasks-dir DIR]     prints one JSON object, exit 0

`{"ok": bool, "python": "3.13.x", "checks": [{"id", "title", "ok", "detail"}]}`
"""
import argparse
import importlib
import importlib.metadata
import json
import os
import platform
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent

# import name -> distribution name (for the version shown in the report)
PACKAGES = {
    "fastapi": "fastapi",
    "uvicorn": "uvicorn",
    "multipart": "python-multipart",
    "openpyxl": "openpyxl",
    "xlsxwriter": "xlsxwriter",
    "numpy": "numpy",
    "scipy.optimize": "scipy",
    "lxml.etree": "lxml",
    "PIL.Image": "pillow",
}

# A task-style step: runs as its own process in an empty folder, uses every
# numeric/document package the real tasks use, writes only inside that folder.
STEP_SCRIPT = textwrap.dedent('''
    import io, json, sys
    import numpy as np
    import openpyxl, xlsxwriter
    from lxml import etree
    from PIL import Image
    from scipy.optimize import milp, LinearConstraint, Bounds

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Name", "Shift"])
    for i in range(1, 21):
        ws.append([f"Person {i:02d}", ["Day", "Night"][i % 2]])
    wb.save("input.xlsx")
    rows = list(openpyxl.load_workbook("input.xlsx").active.iter_rows(values_only=True))
    assert len(rows) == 21 and rows[1] == ("Person 01", "Night"), rows[:2]

    out = xlsxwriter.Workbook("output.xlsx")
    sheet = out.add_worksheet("Draft")
    sheet.write_row(0, 0, rows[0])
    for r, row in enumerate(rows[1:], start=1):
        sheet.write_row(r, 0, row)
    out.close()
    back = list(openpyxl.load_workbook("output.xlsx").active.iter_rows(values_only=True))
    assert back == rows

    # pick 2 of 3 shifts at minimum cost: x0 + x1 + x2 >= 2
    result = milp(c=np.array([3.0, 1.0, 2.0]),
                  constraints=LinearConstraint(np.ones((1, 3)), lb=2),
                  integrality=np.ones(3), bounds=Bounds(0, 1))
    assert result.success and round(float(result.fun)) == 3, result

    doc = etree.fromstring("<roster><p n='1'/><p n='2'/></roster>")
    assert len(doc.findall("p")) == 2

    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), "white").save(buffer, "PNG")
    assert Image.open(io.BytesIO(buffer.getvalue())).size == (4, 4)

    json.dump({"rows": len(rows) - 1, "milp": float(result.fun)}, open("result.json", "w"))
    print("step ok")
''')


def check(checks: list, id_: str, title: str, fn) -> None:
    try:
        detail = fn()
        checks.append({"id": id_, "title": title, "ok": True, "detail": detail or ""})
    except Exception as exc:  # noqa: BLE001 - every failure is a result, never a crash
        message = f"{type(exc).__name__}: {exc}"
        checks.append({"id": id_, "title": title, "ok": False, "detail": message[-600:]})


def check_python() -> str:
    if sys.maxsize <= 2**32:
        raise RuntimeError("a 32-bit Python cannot run the task libraries")
    return f"Python {platform.python_version()} ({Path(sys.executable).name})"


def check_packages(modules: dict[str, str]):
    def run() -> str:
        versions = []
        for module, dist in modules.items():
            importlib.import_module(module)
            versions.append(f"{dist} {importlib.metadata.version(dist)}")
        return ", ".join(versions)

    return run


def find_shared(tasks_dir: Path | None) -> Path:
    candidates = []
    if tasks_dir:
        candidates.append(tasks_dir)
    data = os.environ.get("AI_OS_TASKS_DATA_DIR")
    if data:
        candidates.append(Path(data) / "tasks")
    if os.environ.get("AI_OS_TASKS_DIR"):
        candidates.append(Path(os.environ["AI_OS_TASKS_DIR"]))
    candidates.append(ENGINE_DIR.parent / "tasks")
    for root in candidates:
        if (root / "shared" / "roster_lib").is_dir():
            return root / "shared"
    raise FileNotFoundError("the shared task libraries (tasks/shared) were not found")


def check_libraries(shared: Path):
    def run() -> str:
        sys.path.insert(0, str(shared))
        try:
            from roster_lib.config import load_config as load_rotation
            from roster_lib.holiday_matrix import load_holiday_matrix
            from roster_lib.pto import read_pto_workbook
            from winter_lib.analytics_config import load_analytics_config
            from winter_lib.winter_config import load_config as load_winter

            rotation = load_rotation(shared / "roster_lib" / "examples" / "rotation_config.example.json")
            holidays = load_holiday_matrix(shared / "roster_lib" / "examples" / "holiday_roster_template.xlsx")
            pto = read_pto_workbook(shared / "roster_lib" / "examples" / "pto_import_template.xlsx")
            winter = load_winter(shared / "winter_lib" / "examples" / "winter_config.example.json")
            analytics = load_analytics_config(shared / "winter_lib" / "examples" / "analytics_config.example.json")
        finally:
            sys.path.remove(str(shared))
        parsed = [type(x).__name__ for x in (rotation, holidays, winter, analytics)]
        return f"loaded the example files ({', '.join(parsed)}, {len(pto)} PTO rows)"

    return run


def check_step() -> str:
    with tempfile.TemporaryDirectory(prefix="ai-os-selftest-") as tmp:
        folder = Path(tmp)
        (folder / "scripts").mkdir()
        script = folder / "scripts" / "selftest_step.py"
        script.write_text(STEP_SCRIPT, encoding="utf-8")
        env = {**os.environ, "PYTHONNOUSERSITE": "1", "AI_OS_TASKS_PYTHON": sys.executable}
        done = subprocess.run(
            [sys.executable, "-u", str(script)], cwd=folder, stdin=subprocess.DEVNULL,
            capture_output=True, text=True, timeout=120, env=env,
        )
        if done.returncode != 0:
            raise RuntimeError((done.stderr or done.stdout).strip()[-500:])
        result = json.loads((folder / "result.json").read_text(encoding="utf-8"))
    return f"ran a task-style step on {result['rows']} fixture rows (spreadsheets, solver, XML, image)"


def run_selftest(tasks_dir: Path | None = None, modules: dict[str, str] | None = None) -> dict:
    checks: list[dict] = []
    check(checks, "python", "Python runtime", check_python)
    check(checks, "packages", "Task packages", check_packages(modules or PACKAGES))
    try:
        shared = find_shared(tasks_dir)
    except FileNotFoundError as exc:
        checks.append({"id": "libraries", "title": "Task libraries", "ok": False, "detail": str(exc)})
    else:
        check(checks, "libraries", "Task libraries", check_libraries(shared))
    check(checks, "step", "Task step dry run", check_step)
    return {"ok": all(c["ok"] for c in checks), "python": platform.python_version(), "checks": checks}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Tasks engine self-test")
    parser.add_argument("--tasks-dir", type=Path, default=None, help="folder holding the task folders and shared/")
    args = parser.parse_args(argv)
    print(json.dumps(run_selftest(args.tasks_dir)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
