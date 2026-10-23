"""Smoke test on COPIES of the real reference files (skipped when they are absent).

Runs prepare_options, analyze, build_draft and diff_draft in a temp task folder and asserts
counts and structure only: no name is ever printed or asserted. The reference files and the
real config are only read; everything is written under tmp_path.
"""

import json
import shutil
import zipfile
from datetime import date
from pathlib import Path

import pytest

from _common import Paths
from pipeline import Pipeline
from roster_lib.audit import sha256_file
from roster_lib.cycle_builder import Plan
from roster_lib.draft_builder import read_snapshot_sheet
from roster_lib.xlsx_patch import list_sheets
from synth import answer_defaults, write_run_params

TASK = Path(__file__).resolve().parents[1]
REF = TASK.parent / "shared" / "roster-reference"
ROSTER = REF / "Shiftroster_Takeda_Redesigned_v2.xlsx"
HOLIDAYS = REF / "Holiday Roster 2026.xlsx"
CONFIG = TASK / "config" / "rotation-config.json"

needs_real = pytest.mark.skipif(
    not (ROSTER.exists() and HOLIDAYS.exists() and CONFIG.exists()),
    reason="real reference files or the real rotation config are not present")


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


@needs_real
def test_real_files_prepare_analyze_build_draft_and_diff(tmp_path):
    before = {p: sha256_file(p) for p in (ROSTER, HOLIDAYS, CONFIG)}
    paths = Paths(tmp_path / "task")
    for d in (paths.input_dir, paths.config_dir, paths.output):
        d.mkdir(parents=True)
    shutil.copyfile(ROSTER, paths.roster)
    shutil.copyfile(HOLIDAYS, paths.holidays)
    shutil.copyfile(CONFIG, paths.config)

    class Real(Pipeline):  # the scripted steps without building the synthetic world
        def __init__(self, paths):
            self.paths, self.root, self.cycle = paths, paths.root, "2026-12"

    p = Real(paths)

    # prepare: the cycle list
    assert p.prepare() == 0
    opts = load(paths.options)
    assert opts["roster"] == {"first_date": "2026-01-02", "last_date": "2027-01-01",
                              "people": 47, "people_total": 50, "excluded": 3}
    assert [c["id"] for c in opts["cycles"]] == [
        "2025-12", "2026-02", "2026-04", "2026-06", "2026-08", "2026-10", "2026-12", "2027-02"]
    assert [c["id"] for c in opts["cycles"] if c["enabled"]] == ["2026-10", "2026-12"]
    assert opts["default"] == "2026-12" and opts["problems"] == []
    assert all(c["reason"] for c in opts["cycles"])

    # analyze: the form (structure and counts only)
    write_run_params(paths, "2026-12")
    assert p.analyze() == 0
    form = load(paths.ask_me)
    kinds = [f["id"].split(":")[0] for f in form["fields"]]
    required = [f for f in form["fields"] if f["required"]]
    assert set(kinds) <= {"shift", "pattern", "new", "seat_shift", "seat_pattern", "seat_team",
                          "seat_rotation", "pto"}
    assert kinds.count("pattern") == kinds.count("shift")
    assert len(required) == kinds.count("shift") + kinds.count("new") + kinds.count("pto")
    analysis = load(paths.analysis)
    assert analysis["analysis"]["active_people"] == 47 and analysis["blocked"] is False
    assert analysis["analysis"]["year_boundary"]["crosses"] is True

    # build_draft with every question answered by its default
    paths.answers.write_text(json.dumps(answer_defaults(form)), encoding="utf-8")
    assert p.build_draft() == 0
    plan = Plan.from_json(paths.plan.read_text(encoding="utf-8"))
    last_in_file = date(2027, 1, 1)
    days_in_file = (last_in_file - plan.cycle.start).days + 1
    days_beyond = (plan.cycle.end - last_in_file).days
    assert len(plan.edits) + len(plan.preserved) == 47 * days_in_file
    assert len(plan.remainder_edits) == 47 * days_beyond
    assert len({n for n, _ in plan.edits}) == 47
    flags = load(paths.flags)
    assert sum(flags["counts"].values()) == len(flags["flags"]) == len(plan.flags) > 0
    report = load(paths.report)
    assert report["stage"] == "draft" and report["summary"]["cells"] == len(plan.edits)
    draft = paths.draft("2026-12")
    with zipfile.ZipFile(draft) as z:
        states = {s.name: s.state for s in list_sheets(z)}
    assert states["_snapshot"] == "veryHidden" and len(states) == 12
    assert len(read_snapshot_sheet(draft).cells) == len(plan.edits)
    assert sha256_file(paths.roster) == before[ROSTER]

    # diff without any edit: nothing changed, nothing blocking
    assert p.diff() == 0
    diff = load(paths.diff)
    assert diff["changes"] == [] and diff["outside_changes"] == [] and diff["blocking"] == []
    assert diff["counts"]["snapshot_cells"] == len(plan.edits)

    # the reference files and the real config were never touched
    assert {q: sha256_file(q) for q in (ROSTER, HOLIDAYS, CONFIG)} == before
