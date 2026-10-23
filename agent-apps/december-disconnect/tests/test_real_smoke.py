"""Smoke test on COPIES of the real reference files and the real configs (skipped when absent).

Runs prepare_options, analyze, build_draft and diff_draft in a temp task folder and asserts counts
and structure only: no name is ever printed or asserted. The reference files and the real configs
are only read; everything is written under tmp_path.
"""

import json
import re
import shutil
from pathlib import Path

import openpyxl
import pytest

from _common import Paths, sha256_file
from pipeline import Pipeline
from synth import answer_defaults, write_run_params

TASK = Path(__file__).resolve().parents[1]
REF = TASK.parent / "shared" / "roster-reference"
FILES = {
    "roster": REF / "Shiftroster_Takeda_Redesigned_v2.xlsx",
    "staff": REF / "PDT Staff Roster.xlsx",
    "analytics_a": REF / "Shift Roster - Analytics_October_2026.xlsx",
    "analytics_b": REF / "Shift Roster - Analytics_November_2026.xlsx",
    "winter_config": TASK / "config" / "winter-config.json",
    "analytics_config": TASK / "config" / "analytics-config.json",
}

needs_real = pytest.mark.skipif(not all(p.exists() for p in FILES.values()),
                                reason="real reference files or the real configs are not present")


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


class Real(Pipeline):
    """The scripted steps on a folder holding copies of the real files."""

    def __init__(self, paths: Paths):
        self.paths, self.root, self.world = paths, paths.root, None


@needs_real
def test_real_files_prepare_analyze_build_draft_and_diff(tmp_path, capsys):
    before = {k: sha256_file(p) for k, p in FILES.items()}
    paths = Paths(tmp_path / "task")
    for d in (paths.input_dir, paths.config_dir, paths.output):
        d.mkdir(parents=True)
    for key, dest in (("roster", paths.roster), ("staff", paths.staff), ("analytics_a", paths.analytics_a),
                      ("analytics_b", paths.analytics_b), ("winter_config", paths.winter_config),
                      ("analytics_config", paths.analytics_config)):
        shutil.copyfile(FILES[key], dest)
    p = Real(paths)

    # prepare: one window, enabled, no problems
    assert p.prepare() == 0
    opts = load(paths.options)
    assert [w["id"] for w in opts["windows"]] == ["2026-12-25..2027-01-01"]
    assert opts["windows"][0]["enabled"] is True and opts["windows"][0]["days"] == 8
    assert opts["default"] == opts["windows"][0]["id"] and opts["problems"] == []
    assert opts["analytics"] == {"people": 10, "slots": 34, "window_matches": True}
    assert opts["roster"]["people"] > 20 and opts["staff"]["people"] > 20

    # analyze: the form (structure and counts only)
    write_run_params(paths)
    assert p.analyze() == 0
    form = load(paths.ask_me)
    kinds = [f["id"].split(":")[0] for f in form["fields"]]
    required = [f for f in form["fields"] if f["required"]]
    assert kinds.count("avail_person_1") == 1 and kinds.count("aavail_person_3") == 1
    assert len(required) == kinds.count("shift") + kinds.count("name")
    analysis = load(paths.analysis)
    assert analysis["blocked"] is False
    scheduled = analysis["stats"]["scheduled"] + analysis["stats"]["needs_shift"]
    assert scheduled >= 20 and analysis["stats"]["needs_shift"] == kinds.count("shift")

    # build_draft with every question answered by its default
    p.write_answers(answer_defaults(form))
    assert p.build_draft() == 0
    report = load(paths.report)
    s = report["summary"]
    assert report["stage"] == "draft" and s["people"] == scheduled
    assert (s["analytics_slots_filled"], s["analytics_slots_total"]) == (34, 34)
    assert s["flags"]["error"] == 0, "the main plan and the Analytics plan have zero audit errors"
    assert set(s["days_histogram"]) <= {"3", "4", "5"} and sum(s["days_histogram"].values()) == scheduled
    flags = load(paths.flags)
    assert sum(flags["counts"].values()) == len(flags["flags"])
    assert {f["plan"] for f in flags["flags"]} == {"main", "analytics"}
    plan = load(paths.plan)
    assert len(plan["window"]) == 8 and plan["run_info"]["success"] and not plan["run_info"]["fallback"]
    assert not plan["run_info"]["time_limit_hit"]
    wb = openpyxl.load_workbook(paths.root / s["analytics_workbook_path"], read_only=True)
    assert wb.sheetnames[:3] == ["Daily View", "Winter Roster", "By Person"]
    wb.close()

    # diff without any edit: nothing changed, nothing blocking
    assert p.diff() == 0
    diff = load(paths.diff)
    assert diff["changes"] == [] and diff["blocking"] == [] and diff["recheck_ran"] is True
    assert diff["counts"]["snapshot_cells"] == scheduled * 8
    assert diff["counts"]["analytics_snapshot_rows"] == 42  # 34 slots + 8 on-call rows

    # the logs of all steps hold counts only: no name of the real files can appear in them
    out = capsys.readouterr()
    text = out.out + out.err
    names = set(load(paths.meta)["roster_names"])
    assert names and not [n for n in names if len(n) > 4 and re.search(re.escape(n), text)]

    # the reference files and the real configs were never touched
    assert {k: sha256_file(p_) for k, p_ in FILES.items()} == before
    assert sha256_file(paths.roster) == before["roster"]
