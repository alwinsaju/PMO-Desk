"""prepare_options.py: the cycle list with availability, reasons and the default."""

import json
from datetime import date, timedelta

import synth
from pipeline import Pipeline
from roster_lib.audit import sha256_file


def options(p: Pipeline) -> dict:
    return json.loads(p.paths.options.read_text(encoding="utf-8"))


def by_id(opts: dict) -> dict:
    return {c["id"]: c for c in opts["cycles"]}


def test_cycle_list_availability_and_default(tmp_path):
    p = Pipeline(tmp_path / "t")
    assert p.prepare() == 0
    opts = options(p)
    assert opts["roster"] == {"first_date": "2026-08-02", "last_date": "2027-01-01",
                              "people": 14, "people_total": 16, "excluded": 2}
    assert [c["id"] for c in opts["cycles"]] == ["2026-08", "2026-10", "2026-12", "2027-02"]
    assert opts["default"] == "2026-12" and opts["problems"] == []
    cycles = by_id(opts)
    assert cycles["2026-12"]["label"] == "Dec 2026 - Jan 2027"
    assert (cycles["2026-12"]["start"], cycles["2026-12"]["end"]) == ("2026-11-29", "2027-01-30")

    # enabled: the previous cycle has data
    assert cycles["2026-12"]["enabled"] and cycles["2026-12"]["coverage"] == 1.0
    assert "weeks of Oct 2026" in cycles["2026-12"]["reason"]
    assert cycles["2026-12"]["filled"] is False and cycles["2026-12"]["crosses_file_end"] is True
    assert cycles["2026-10"]["enabled"] and cycles["2026-10"]["filled"] is True
    assert "already has data" in cycles["2026-10"]["reason"]

    # grayed out, each with its reason
    aug, feb = cycles["2026-08"], cycles["2027-02"]
    assert not aug["enabled"] and "no roster data for the previous cycle (Jun 2026)" in aug["reason"]
    assert not feb["enabled"] and "fewer than 95% of the weeks of Dec 2026" in feb["reason"]
    assert feb["previous"] == "Dec 2026" and feb["filled"] is False
    for c in opts["cycles"]:
        assert c["reason"] and set(c) >= {"id", "label", "start", "end", "enabled", "reason",
                                          "coverage"}


def test_prepare_is_read_only_and_deterministic(tmp_path):
    p = Pipeline(tmp_path / "t")
    before = {f.name: sha256_file(f) for d in (p.paths.input_dir, p.paths.config_dir)
              for f in d.iterdir()}
    assert p.prepare() == 0
    first = p.paths.options.read_bytes()
    assert p.prepare() == 0
    assert p.paths.options.read_bytes() == first
    assert {f.name for f in p.paths.output.iterdir()} == {"options.json"}
    after = {f.name: sha256_file(f) for d in (p.paths.input_dir, p.paths.config_dir)
             for f in d.iterdir()}
    assert before == after


def test_missing_roster_is_reported_not_raised(tmp_path, capsys):
    p = Pipeline(tmp_path / "t")
    p.paths.roster.unlink()
    assert p.prepare() == 0
    opts = options(p)
    assert opts["roster"] is None and opts["cycles"] == [] and opts["default"] is None
    assert [x["severity"] for x in opts["problems"]] == ["error"]
    assert "roster workbook is missing" in opts["problems"][0]["message"]
    assert "Traceback" not in capsys.readouterr().err


def test_unreadable_roster_is_reported(tmp_path):
    p = Pipeline(tmp_path / "t")
    p.paths.roster.write_bytes(b"this is not an xlsx file")
    assert p.prepare() == 0
    opts = options(p)
    assert opts["cycles"] == [] and "cannot be opened" in opts["problems"][0]["message"]


def test_missing_or_invalid_config_disables_every_cycle(tmp_path):
    p = Pipeline(tmp_path / "t")
    p.paths.config.unlink()
    assert p.prepare() == 0
    opts = options(p)
    assert opts["roster"]["people"] == 16  # nothing is excluded without a config
    assert opts["cycles"] and not any(c["enabled"] for c in opts["cycles"])
    assert opts["default"] is None
    assert any("rotation config is missing" in x["message"] for x in opts["problems"])

    p.paths.config.write_text('{"version": 7, "people": []}', encoding="utf-8")
    assert p.prepare() == 0
    opts = options(p)
    assert any("rotation config has problems" in x["message"] for x in opts["problems"])
    cycles = by_id(opts)
    # a cycle with data is still grayed out, and says why
    assert not cycles["2026-12"]["enabled"] and "rotation config" in cycles["2026-12"]["reason"]


def test_bad_or_missing_holiday_roster_disables_every_cycle(tmp_path):
    p = Pipeline(tmp_path / "t")
    p.paths.holidays.write_bytes(b"junk")
    assert p.prepare() == 0
    opts = options(p)
    assert not any(c["enabled"] for c in opts["cycles"])
    assert any("Holiday Roster cannot be used" in x["message"] for x in opts["problems"])
    assert "Holiday Roster" in by_id(opts)["2026-12"]["reason"]

    p.paths.holidays.unlink()  # nothing uploaded and no reference file either
    assert p.prepare() == 0
    assert any("no Holiday Roster: upload one or add one to roster-reference" in x["message"]
               for x in options(p)["problems"])


def test_default_falls_back_to_the_latest_enabled_cycle(tmp_path):
    p = Pipeline(tmp_path / "t")
    # one person has no code in a whole Oct week: Dec's previous cycle is no longer complete
    week = {("Person 05", date(2026, 10, 11) + timedelta(days=i)): "" for i in range(7)}
    week.update({("Person 05", date(2026, 10, 18) + timedelta(days=i)): "" for i in range(7)})
    synth.patch_master(p.world, week)
    assert p.prepare() == 0
    opts = options(p)
    cycles = by_id(opts)
    assert not cycles["2026-12"]["enabled"]
    assert "e.g. Person 05" in cycles["2026-12"]["reason"]
    assert cycles["2026-12"]["coverage"] == 0.75
    assert [c["id"] for c in opts["cycles"] if c["enabled"]] == ["2026-10"]
    assert opts["default"] == "2026-10"  # every enabled cycle is filled: the latest one


def test_nothing_selectable_adds_a_warning(tmp_path):
    p = Pipeline(tmp_path / "t")
    synth.blank_cycle(p.world, synth.AUG)
    synth.blank_cycle(p.world, synth.OCT)
    assert p.prepare() == 0
    opts = options(p)
    assert not any(c["enabled"] for c in opts["cycles"]) and opts["default"] is None
    assert any(x["severity"] == "warning" and "no cycle can be selected" in x["message"]
               for x in opts["problems"])


def test_prepare_runs_as_a_subprocess_with_closed_stdin(tmp_path):
    import subprocess
    import sys
    from pathlib import Path

    p = Pipeline(tmp_path / "t")
    script = Path(__file__).resolve().parents[1] / "scripts" / "prepare_options.py"
    done = subprocess.run([sys.executable, str(script), "--task-dir", str(p.root)],
                          stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stderr
    assert options(p)["default"] == "2026-12" and "default 2026-12" in done.stdout


# ---- coverage of the Holiday Roster in use (see also test_holiday_source.py) --------------------------------

def _rewrite_matrix(path, keep_years=None, extra_rows=()):
    """Synthetic Holiday Roster: the standard test rows filtered to `keep_years`, plus extras."""
    from openpyxl import load_workbook

    wb = load_workbook(path)
    ws = wb.active
    for row in range(ws.max_row, 1, -1):
        if keep_years is not None and ws.cell(row, 2).value.year not in keep_years:
            ws.delete_rows(row)
    locs = [ws.cell(1, j).value for j in range(3, 10)]
    for name, d, off in extra_rows:
        r = ws.max_row + 1
        ws.cell(r, 1, name)
        ws.cell(r, 2, d)
        for j, loc in enumerate(locs, start=3):
            if loc in off:
                ws.cell(r, j, "X")
    wb.save(path)


def test_cycles_covered_by_the_stored_matrix_stay_enabled(tmp_path):
    p = Pipeline(tmp_path / "t")
    assert p.prepare() == 0
    opts = options(p)
    # the matrix has rows in 2026 and 2027: nothing is disabled for the holiday year
    assert all("Holiday Roster has no" not in c["reason"] for c in opts["cycles"])
    assert by_id(opts)["2026-12"]["enabled"] and opts["problems"] == []


def test_uncovered_year_disables_the_cycle_with_a_clear_reason(tmp_path):
    p = Pipeline(tmp_path / "t")
    _rewrite_matrix(p.paths.holidays, keep_years={2026})
    assert p.prepare() == 0
    opts = options(p)
    cycles = by_id(opts)
    # 2026 cycles still work; the Dec 2026 - Jan 2027 cycle needs 2027 rows
    assert cycles["2026-10"]["enabled"]
    dec = cycles["2026-12"]
    assert dec["enabled"] is False
    assert dec["reason"] == ("Holiday Roster (uploaded file) has no 2027 rows - "
                             "upload the new year's Holiday Roster")
    # a readable but old matrix is not a "problem" (problems stay for unreadable matrices)
    assert not any(x["severity"] == "error" for x in opts["problems"])
    assert opts["default"] == "2026-10"
    # the Feb 2027 cycle is only 2027 and was already disabled for missing data
    assert "2027" not in cycles["2027-02"]["reason"] or not cycles["2027-02"]["enabled"]


def test_dec_jan_cycle_needs_both_years(tmp_path):
    p = Pipeline(tmp_path / "t")
    # only 2027 rows: the 2026 part of the Dec-Jan cycle is uncovered
    _rewrite_matrix(p.paths.holidays, keep_years={2027})
    assert p.prepare() == 0
    cycles = by_id(options(p))
    dec = cycles["2026-12"]
    assert dec["enabled"] is False
    assert dec["reason"] == ("Holiday Roster (uploaded file) has no 2026 rows - "
                             "upload the new year's Holiday Roster")
    assert not cycles["2026-10"]["enabled"] and "no 2026 rows" in cycles["2026-10"]["reason"]

    # a single row in each year is enough (the assumed 1 Jan 2027 row counts for 2027)
    p2 = Pipeline(tmp_path / "t2")
    _rewrite_matrix(p2.paths.holidays, keep_years=set(),
                    extra_rows=[("Only 2026", date(2026, 3, 3), ["Pune"]),
                                ("Only 2027", date(2027, 1, 1), ["Pune", "Chennai"])])
    assert p2.prepare() == 0
    assert by_id(options(p2))["2026-12"]["enabled"] is True


def test_replacing_the_matrix_later_re_enables_the_cycle(tmp_path):
    p = Pipeline(tmp_path / "t")
    full = p.paths.holidays.read_bytes()
    _rewrite_matrix(p.paths.holidays, keep_years={2026})
    assert p.prepare() == 0
    assert not by_id(options(p))["2026-12"]["enabled"]

    p.paths.holidays.write_bytes(full)  # the new year's upload replaces the file
    assert p.prepare() == 0
    opts = options(p)
    assert by_id(opts)["2026-12"]["enabled"] and opts["default"] == "2026-12"


def test_no_cycle_selectable_because_of_the_year_says_so(tmp_path):
    p = Pipeline(tmp_path / "t")
    _rewrite_matrix(p.paths.holidays, keep_years=set(),
                    extra_rows=[("Far Future", date(2030, 5, 5), ["Pune"])])
    assert p.prepare() == 0
    opts = options(p)
    assert not any(c["enabled"] for c in opts["cycles"]) and opts["default"] is None
    assert any("does not cover the needed year" in x["message"] for x in opts["problems"])
    assert not any("previous cycle is missing data" in x["message"] for x in opts["problems"])


def test_analyze_fails_clearly_when_the_stored_matrix_is_missing(tmp_path, capsys):
    p = Pipeline(tmp_path / "t")
    assert p.prepare() == 0
    synth.write_run_params(p.paths, "2026-12")
    p.paths.holidays.unlink()
    assert p.analyze() == 1
    err = capsys.readouterr().err
    assert "cannot be built" in err
    assert "no Holiday Roster: upload one or add one to roster-reference" in err
    assert "Traceback" not in err


def test_no_script_deletes_the_stored_holiday_roster(tmp_path):
    """The Holiday Roster stays on file between runs: a whole run must leave it byte-identical."""
    p = Pipeline(tmp_path / "t")
    before = p.paths.holidays.read_bytes()
    assert p.prepare() == 0
    p.run_to_draft()
    p.run_to_diff()
    assert p.finalize() == 0
    assert p.paths.holidays.is_file() and p.paths.holidays.read_bytes() == before


def test_next_year_file_makes_the_next_cycle_selectable(tmp_path):
    """The PMO uploads the 2027 file produced by finalize as `roster` for Feb-Mar 2027: only the
    previous-cycle weeks inside that file are judged (it starts on Sat 2027-01-02)."""
    import shutil

    p = Pipeline(tmp_path / "t")
    p.run_to_diff()
    assert p.finalize() == 0
    nxt = p.paths.final_dir / "roster - 2027.xlsx"
    root = tmp_path / "t2"
    (root / "input").mkdir(parents=True)
    (root / "output").mkdir()
    (root / "config").mkdir()
    shutil.copyfile(nxt, root / "input" / "roster.xlsx")
    shutil.copyfile(p.paths.config, root / "config" / "rotation-config.json")
    shutil.copyfile(p.paths.holidays, root / "input" / "holiday-roster.xlsx")
    p2 = Pipeline.adopt(root)
    assert p2.prepare() == 0
    opts = options(p2)
    assert opts["roster"]["first_date"] == "2027-01-02"
    cycles = by_id(opts)
    feb = cycles["2027-02"]
    assert feb["enabled"] and (feb["weeks_checked"], feb["weeks_total"]) == (4, 9)
    assert ("Checked 4 of 9 weeks of the previous cycle that are inside this file "
            "(the rest are in the previous year's file)") in feb["reason"]
    assert feb["filled"] is False and opts["default"] == "2027-02"
    # the Dec-Jan cycle (part of it is in this file) already holds data; its own previous cycle
    # (Oct-Nov) is entirely in the previous year's file; the cycle after Feb-Mar is not ready
    assert cycles["2026-12"]["filled"] is True and not cycles["2026-12"]["enabled"]
    assert not cycles["2027-04"]["enabled"]
    # the whole pipeline runs for the cycle
    assert p2.analyze("2027-02") == 0
    analysis = json.loads(p2.paths.analysis.read_text(encoding="utf-8"))
    assert analysis["availability"]["weeks_checked"] == 4 and analysis["cycle"]["previous"] == "Dec 2026"
    assert analysis["analysis"]["changes"]["new"] == []
    p2.answer()
    assert p2.build_draft() == 0
    plan = json.loads(p2.paths.plan.read_text(encoding="utf-8"))
    assert plan["run_info"]["previous_cycle"] == "Dec 2026" and plan["remainder_edits"] == []
