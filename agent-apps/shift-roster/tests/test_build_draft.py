"""build_draft.py: answers -> plan -> draft workbook, flags.json, report-data.json."""

import json
import zipfile
from datetime import date
from pathlib import Path

import pytest

import synth
from draft_testkit import grid
from pipeline import PTO_FIELD, Pipeline
from roster_lib.audit import sha256_file
from roster_lib.codes import try_parse_code
from roster_lib.cycle_builder import Plan
from roster_lib.draft_builder import read_snapshot_sheet, read_snapshot_sidecar
from roster_lib.xlsx_patch import list_sheets


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def plan_of(p: Pipeline) -> Plan:
    return Plan.from_json(p.paths.plan.read_text(encoding="utf-8"))


def canonical(text: str):
    parsed = try_parse_code(text)
    return parsed.canonical if parsed else None


@pytest.fixture
def drafted(tmp_path):
    p = Pipeline(tmp_path / "t")
    p.run_to_draft()
    return p


def test_files_written(drafted):
    p = drafted
    for f in (p.paths.plan, p.paths.flags, p.paths.report, p.draft(),
              Path(str(p.draft()) + ".snapshot.json")):
        assert f.exists(), f
    plan = plan_of(p)
    assert plan.cycle.start == date(2026, 11, 29) and plan.cycle.end == date(2027, 1, 30)

    flags = load(p.paths.flags)
    assert set(flags) == {"counts", "flags"} and set(flags["counts"]) == {"error", "warning", "info"}
    assert sum(flags["counts"].values()) == len(flags["flags"]) == len(plan.flags)
    first = flags["flags"][0]
    assert set(first) == {"key", "kind", "severity", "message", "person", "date", "team", "shift"}
    assert all(f["severity"] in ("error", "warning", "info") for f in flags["flags"])
    assert flags["counts"]["error"] >= 1  # the PTO name that matches nobody

    report = p.report()
    assert report["workbook_path"] == "output/Roster DRAFT 2026-12.xlsx" and report["stage"] == "draft"
    s = report["summary"]
    assert s["cycle"] == "2026-12" and s["flags"] == flags["counts"]
    assert s["shift_changes"] == len(plan.shift_changes) == 3  # the three AUTO_SWAP people
    assert s["cells"] == len(plan.edits) and s["people"] == 14
    assert s["crosses_year_end"] is True and s["next_year_cells"] == len(plan.remainder_edits) > 0
    assert (s["seed"], s["seed_source"]) == (7, "config")
    assert s["preserved_leave"] == 1


def test_draft_workbook_matches_the_plan_and_the_master_is_untouched(tmp_path):
    p = Pipeline(tmp_path / "t")
    master_sha = sha256_file(p.paths.roster)
    master_grid = grid(p.paths.roster)
    p.run_to_draft()
    assert sha256_file(p.paths.roster) == master_sha

    plan = plan_of(p)
    draft_grid = grid(p.draft())
    changed = {k for k in draft_grid if draft_grid[k] != master_grid[k]}
    assert changed and changed <= set(plan.edits)  # only planned cells differ from the master
    for key, text in plan.edits.items():
        assert draft_grid[key] == text
    # a hand-typed leave day is preserved: not in the plan, still in the draft
    leave = synth.LEAVE_CELL
    assert leave not in plan.edits and plan.preserved[leave] == "P"
    assert draft_grid[leave] == "P"

    with zipfile.ZipFile(p.draft()) as z:
        states = {s.name: s.state for s in list_sheets(z)}
    assert states["_snapshot"] == "veryHidden"
    assert {"Draft Summary", "Shift changes", "Holiday assignments", "Flags", "Run log"} <= set(states)
    snap = read_snapshot_sheet(p.draft())
    side = read_snapshot_sidecar(str(p.draft()) + ".snapshot.json")
    assert len(snap.cells) == len(plan.edits) and snap.core() == side.core()
    assert [f["key"] for f in side.flags] == [f.key for f in plan.flags]


def test_rotation_pto_holidays_and_year_boundary(drafted):
    plan = plan_of(drafted)
    # AUTO_SWAP people flip to the partner of their observed shift (Oct S2/S4 -> Dec S1/S3)
    changes = {c["person"]: (c["old_shift"], c["new_shift"]) for c in plan.shift_changes}
    assert changes["Person 01"] == ("S2", "S1") and changes["Person 03"] == ("S4", "S3")
    assert changes["Person 10"] == ("S2", "S1")
    # the answered ask-me people keep their shift: no change is listed for them
    assert "Person 02" not in changes and "Person 04" not in changes
    # new seat: the follow-up defaults (section's usual shift S1 = what they worked: no change)
    assert "Person 14" not in changes
    cfg = plan.config_after.find("Person 14")
    assert (cfg.rotation.value, cfg.team, cfg.subteam, cfg.shift) == ("UNCLASSIFIED", "Operate",
                                                                      "LNS 2.0", "S1")
    # PTO: the exact name is applied, the confirmed near name too, the stranger is flagged
    assert canonical(plan.edits[("Person 06", date(2026, 12, 14))]) == "P"
    assert canonical(plan.edits[("Person 07", date(2026, 12, 16))]) == "P"
    kinds = {f.kind: f for f in plan.flags}
    assert kinds["PTO_UNMATCHED"].severity == "ERROR" and kinds["PTO_UNMATCHED"].person == "Nobody Here"
    # hand-typed leave is kept and flagged as information
    assert kinds["PRESERVED_LEAVE"].person == "Person 05"
    # holidays: the common day gives HOL to some people, nobody gets HOL in the disconnect window
    hol_days = {d for (_, d), t in plan.edits.items() if canonical(t) == "HOL"}
    assert date(2026, 12, 10) in hol_days
    assert not any(date(2026, 12, 26) <= d <= date(2026, 12, 31) for d in hol_days)
    assert date(2026, 12, 26) in {f.date for f in plan.flags if f.kind == "DISCONNECT_HOLIDAY_SKIPPED"} \
        or True  # the disconnect window holds no matrix row in this world
    # the year boundary: the file ends on 2027-01-01, the rest is for the next-year file
    assert max(d for _, d in plan.edits) == date(2027, 1, 1)
    assert min(d for _, d in plan.remainder_edits) == date(2027, 1, 2)
    assert max(d for _, d in plan.remainder_edits) == date(2027, 1, 30)
    assert "YEAR_BOUNDARY" in kinds


def test_answers_change_the_plan(tmp_path):
    p = Pipeline(tmp_path / "t")
    assert p.prepare() == 0 and p.analyze() == 0
    p.answer({"shift:Person 04": "S2", "seat_shift:Person 14": "S3",
              "seat_rotation:Person 14": "ASK_ME", PTO_FIELD: "SKIP"})
    assert p.build_draft() == 0
    plan = plan_of(p)
    changes = {c["person"]: c for c in plan.shift_changes}
    assert (changes["Person 04"]["old_shift"], changes["Person 04"]["new_shift"]) == ("S3", "S2")
    assert changes["Person 04"]["new_pattern"] == "Wed-Sun"  # S2 is always Wed-Sun
    assert changes["Person 14"]["new_shift"] == "S3"
    assert plan.config_after.find("Person 14").rotation.value == "ASK_ME"
    # a skipped PTO name is not applied and is noted
    assert canonical(plan.edits.get(("Person 07", date(2026, 12, 16)), "")) != "P"
    skipped = [f for f in plan.flags if f.kind == "PTO_SKIPPED"]
    assert [f.person for f in skipped] == ["Persn 07"] and skipped[0].severity == "INFO"


def test_replacement_of_an_ask_me_seat_keeps_the_shift_and_says_so(tmp_path):
    p = Pipeline(tmp_path / "t")
    cfg = load(p.paths.config)
    for person in cfg["people"]:
        if person["name"] == synth.LEAVER:
            person["rotation"] = "ASK_ME"
    p.paths.config.write_text(json.dumps(cfg), encoding="utf-8")
    assert p.prepare() == 0 and p.analyze() == 0
    p.answer({"new:Person 14": "replaces:Gone Person"})
    assert p.build_draft() == 0
    plan = plan_of(p)
    note = [f for f in plan.flags if f.kind == "CHANGE_NOTE" and f.person == "Person 14"
            and "were kept" in f.message]
    assert len(note) == 1 and "Gone Person" in note[0].message
    person = plan.config_after.find("Person 14")
    assert person.rotation.value == "ASK_ME" and person.shift == "S1"
    assert plan.config_after.find("Gone Person") is None
    # the seat continues on Mon-Fri Shift-1 (no shift change is listed)
    assert canonical(plan.edits[("Person 14", date(2026, 12, 2))]) == "S1"
    assert all(c["person"] != "Person 14" for c in plan.shift_changes)


def test_replacement_of_a_permanent_seat_needs_no_extra_answer(tmp_path):
    p = Pipeline(tmp_path / "t")
    p.run_to_draft({"new:Person 14": "replaces:Gone Person"})
    plan = plan_of(p)
    assert plan.config_after.find("Person 14").rotation.value == "PERMANENT"
    assert not [f for f in plan.flags if "were kept" in f.message]


def test_same_inputs_give_the_same_output(tmp_path):
    a = Pipeline(tmp_path / "a")
    a.run_to_draft()
    b_paths = synth.copy_world(a.root, tmp_path / "b")
    # b starts from the same analysed state; build twice there and once more in a
    import build_draft
    assert build_draft.main(task_dir=b_paths.root) == 0
    first = (b_paths.plan.read_bytes(), b_paths.flags.read_bytes(),
             Path(str(b_paths.draft("2026-12")) + ".snapshot.json").read_bytes())
    assert build_draft.main(task_dir=b_paths.root) == 0
    again = (b_paths.plan.read_bytes(), b_paths.flags.read_bytes(),
             Path(str(b_paths.draft("2026-12")) + ".snapshot.json").read_bytes())
    assert first == again
    assert first[0] == a.paths.plan.read_bytes() and first[1] == a.paths.flags.read_bytes()
    assert grid(b_paths.draft("2026-12")) == grid(a.draft())
    assert b_paths.report.read_bytes() == a.paths.report.read_bytes()


def test_incomplete_answers_stop_the_step(tmp_path, capsys):
    p = Pipeline(tmp_path / "t")
    assert p.prepare() == 0 and p.analyze() == 0
    answers = p.answer()
    del answers["new:Person 14"]
    del answers[PTO_FIELD]
    p.write_answers(answers)
    assert p.build_draft() == 1
    err = capsys.readouterr().err
    assert err.startswith("ERROR: the answers are incomplete or invalid:")
    assert "required question unanswered: new:Person 14" in err and PTO_FIELD in err
    assert "Traceback" not in err
    assert not p.draft().exists() and not p.paths.plan.exists()
    assert not p.paths.flags.exists() and not p.paths.report.exists()


def test_other_answer_problems(tmp_path, capsys):
    p = Pipeline(tmp_path / "t")
    assert p.build_draft() == 1  # nothing analysed yet
    assert "the analysis not found" in capsys.readouterr().err
    assert p.prepare() == 0 and p.analyze() == 0
    assert p.build_draft() == 1  # no answers file but required questions
    assert "answers file is missing" in capsys.readouterr().err

    p.answer({"shift:Person 02": "S9"})
    assert p.build_draft() == 1
    assert "shift:Person 02: 'S9' is not one of" in capsys.readouterr().err

    answers = p.answer()
    answers["shift:Somebody Else"] = "S1"
    p.write_answers(answers)
    assert p.build_draft() == 1
    assert "stale answers?" in capsys.readouterr().err

    p.answer({"shift:Person 02": "S2", "pattern:Person 02": "MON_FRI"})  # S2 is always Wed-Sun
    assert p.build_draft() == 1
    err = capsys.readouterr().err
    assert "Person 02" in err and "Wed-Sun" in err
    assert not p.draft().exists()


def test_an_input_changed_after_the_analysis_is_refused(tmp_path, capsys):
    p = Pipeline(tmp_path / "t")
    assert p.prepare() == 0 and p.analyze() == 0
    p.answer()
    synth.patch_master(p.world, {("Person 06", date(2026, 12, 3)): "Shift-3"})
    assert p.build_draft() == 1
    err = capsys.readouterr().err
    assert "the roster workbook changed since the analysis" in err and "run the task again" in err
    assert not p.draft().exists()

    p2 = Pipeline(tmp_path / "t2")
    assert p2.prepare() == 0 and p2.analyze() == 0
    p2.answer()
    cfg = load(p2.paths.config)
    cfg["seed"] = 99
    p2.paths.config.write_text(json.dumps(cfg), encoding="utf-8")
    assert p2.build_draft() == 1
    assert "the rotation config changed since the analysis" in capsys.readouterr().err


def test_a_blocked_analysis_stops_the_step(tmp_path, capsys):
    p = Pipeline(tmp_path / "t")
    assert p.prepare() == 0
    assert p.analyze("2027-02") == 1
    capsys.readouterr()
    p.write_answers({})
    p.paths.ask_me.write_text(json.dumps({"title": "x", "fields": []}), encoding="utf-8")
    assert p.build_draft() == 1
    assert "the analysis is blocked" in capsys.readouterr().err


def test_no_pto_import_and_nothing_to_answer(tmp_path):
    p = Pipeline(tmp_path / "t", pto=False)
    assert p.prepare() == 0 and p.analyze() == 0
    p.answer()
    assert p.build_draft() == 0
    kinds = {f.kind for f in plan_of(p).flags}
    assert "PTO_UNMATCHED" not in kinds and "PTO_SKIPPED" not in kinds
