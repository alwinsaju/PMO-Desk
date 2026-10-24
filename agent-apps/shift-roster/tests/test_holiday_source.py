"""The Holiday Roster is optional: the uploaded file wins, else the reference file is used.

Synthetic files only. The reference folder of a test task lives next to the task folder
(`<tmp>/shared/roster-reference`, the same relative place as in the repository), so the real
reference files are never involved.
"""

import json
import os
from datetime import date

import pytest

from _common import (NO_HOLIDAY_ROSTER, REFERENCE, UPLOADED, Paths, cycle_years, holiday_candidates,
                     parse_cycle_id, pick_source, resolve_holiday_source)
from pipeline import EDITS, Pipeline
from roster_lib.audit import sha256_file
from synth import write_matrix
from test_prepare_options import _rewrite_matrix, by_id, options


def reference_dir(p: Pipeline):
    d = p.root.parent / "shared" / "roster-reference"
    d.mkdir(parents=True, exist_ok=True)
    return d


def add_reference(p: Pipeline, name: str, years=None, extra_rows=(), mtime=None):
    path = reference_dir(p) / name
    write_matrix(path)
    if years is not None or extra_rows:
        _rewrite_matrix(path, keep_years=years, extra_rows=extra_rows)
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def no_upload(p: Pipeline):
    p.paths.holidays.unlink()


def snapshot(folder):
    return {f.name: sha256_file(f) for f in sorted(folder.iterdir())}


# ---- resolution order ---------------------------------------------------------------------

def test_the_uploaded_file_wins_over_the_reference_file(tmp_path):
    p = Pipeline(tmp_path / "t")
    add_reference(p, "Holiday Roster 2030.xlsx", years=set(),
                  extra_rows=[("Far Future", date(2030, 5, 5), ["Pune"])])
    assert p.prepare() == 0
    opts = options(p)
    assert opts["holiday_source"] == {"kind": UPLOADED, "file": "holiday-roster.xlsx",
                                      "covers_years": [2026, 2027]}
    assert by_id(opts)["2026-12"]["enabled"] and opts["problems"] == []
    assert p.analyze() == 0
    rec = json.loads(p.paths.analysis.read_text(encoding="utf-8"))
    assert rec["holiday_source"]["kind"] == UPLOADED
    assert rec["inputs"]["holidays"]["kind"] == UPLOADED


def test_a_broken_upload_is_an_error_and_never_falls_back_to_the_reference(tmp_path):
    p = Pipeline(tmp_path / "t")
    add_reference(p, "Holiday Roster 2026.xlsx")
    p.paths.holidays.write_bytes(b"junk")
    assert p.prepare() == 0
    opts = options(p)
    assert not any(c["enabled"] for c in opts["cycles"]) and opts["holiday_source"] is None
    assert any("uploaded Holiday Roster cannot be used" in x["message"] for x in opts["problems"])


def test_the_reference_file_is_used_when_nothing_is_uploaded(tmp_path):
    p = Pipeline(tmp_path / "t")
    no_upload(p)
    ref = add_reference(p, "Holiday Roster 2026.xlsx")
    before = ref.read_bytes()
    assert p.prepare() == 0
    opts = options(p)
    assert opts["holiday_source"] == {"kind": REFERENCE, "file": "Holiday Roster 2026.xlsx",
                                      "covers_years": [2026, 2027]}
    assert by_id(opts)["2026-12"]["enabled"] and opts["default"] == "2026-12"
    assert opts["problems"] == []
    assert not p.paths.holidays.exists()  # nothing was copied into input/
    assert ref.read_bytes() == before


def test_the_covering_file_is_picked_among_several(tmp_path):
    p = Pipeline(tmp_path / "t")
    no_upload(p)
    old, new = 1_700_000_000, 1_800_000_000
    # the newest file only has 2026 rows; an older one also has 2027 rows
    add_reference(p, "Holiday Roster 2026 draft.xlsx", years={2026}, mtime=new)
    add_reference(p, "Holiday Roster 2026.xlsx", mtime=old)
    assert p.prepare() == 0
    opts = options(p)
    assert opts["holiday_source"]["file"] == "Holiday Roster 2026.xlsx"  # covers Dec 2026 - Jan 2027
    assert by_id(opts)["2026-12"]["enabled"]
    assert p.analyze() == 0
    rec = json.loads(p.paths.analysis.read_text(encoding="utf-8"))
    assert rec["holiday_source"]["file"] == "Holiday Roster 2026.xlsx"

    # both cover a 2026-only cycle: the newest file wins
    candidates, errors, notes = holiday_candidates(p.paths)
    assert errors == [] and notes == [] and len(candidates) == 2
    assert pick_source(candidates, cycle_years(parse_cycle_id("2026-10"))).file == \
        "Holiday Roster 2026 draft.xlsx"
    assert pick_source(candidates, cycle_years(parse_cycle_id("2026-12"))).file == \
        "Holiday Roster 2026.xlsx"


def test_equal_age_covering_files_prefer_the_highest_year(tmp_path):
    p = Pipeline(tmp_path / "t")
    no_upload(p)
    stamp = 1_750_000_000
    add_reference(p, "Holiday Roster A.xlsx", mtime=stamp)
    add_reference(p, "Holiday Roster B.xlsx", mtime=stamp,
                  extra_rows=[("Later", date(2028, 1, 2), ["Pune"])])
    candidates, _, _ = holiday_candidates(p.paths)
    assert pick_source(candidates, [2026, 2027]).file == "Holiday Roster B.xlsx"


def test_nothing_covering_falls_back_to_the_highest_year_and_says_so(tmp_path):
    p = Pipeline(tmp_path / "t")
    no_upload(p)
    add_reference(p, "Holiday Roster 2026.xlsx", years={2026})
    assert p.prepare() == 0
    opts = options(p)
    assert opts["holiday_source"]["covers_years"] == [2026]
    dec = by_id(opts)["2026-12"]
    assert dec["enabled"] is False
    assert dec["reason"] == ("Holiday Roster (reference file) has no 2027 rows - upload the new "
                             "year's Holiday Roster or add it to roster-reference")
    assert by_id(opts)["2026-10"]["enabled"] and opts["default"] == "2026-10"
    assert not any(x["severity"] == "error" for x in opts["problems"])


def test_next_years_file_in_the_reference_folder_re_enables_the_cycle(tmp_path):
    p = Pipeline(tmp_path / "t")
    no_upload(p)
    add_reference(p, "Holiday Roster 2026.xlsx", years={2026})
    assert p.prepare() == 0 and not by_id(options(p))["2026-12"]["enabled"]
    add_reference(p, "Holiday Roster 2027.xlsx")  # dropped into roster-reference
    assert p.prepare() == 0
    opts = options(p)
    assert by_id(opts)["2026-12"]["enabled"]
    assert opts["holiday_source"]["file"] == "Holiday Roster 2027.xlsx"


def test_unreadable_reference_files_are_skipped_with_a_note(tmp_path):
    p = Pipeline(tmp_path / "t")
    no_upload(p)
    add_reference(p, "Holiday Roster 2026.xlsx")
    (reference_dir(p) / "Holiday Roster broken.xlsx").write_bytes(b"junk")
    (reference_dir(p) / "~$Holiday Roster 2026.xlsx").write_bytes(b"excel lock file")
    (reference_dir(p) / "Other file.xlsx").write_bytes(b"not a holiday roster")
    assert p.prepare() == 0
    opts = options(p)
    assert opts["holiday_source"]["file"] == "Holiday Roster 2026.xlsx"
    assert by_id(opts)["2026-12"]["enabled"]
    warnings = [x for x in opts["problems"] if x["severity"] == "warning"]
    assert len(warnings) == 1 and "Holiday Roster broken.xlsx was skipped" in warnings[0]["message"]
    assert not any(x["severity"] == "error" for x in opts["problems"])


def test_only_unreadable_reference_files_is_an_error(tmp_path):
    p = Pipeline(tmp_path / "t")
    no_upload(p)
    (reference_dir(p) / "Holiday Roster 2026.xlsx").write_bytes(b"junk")
    assert p.prepare() == 0
    opts = options(p)
    assert not any(c["enabled"] for c in opts["cycles"])
    assert any(x["severity"] == "error" and "no usable Holiday Roster in roster-reference"
               in x["message"] for x in opts["problems"])


def test_neither_upload_nor_reference_gives_clear_errors(tmp_path, capsys):
    p = Pipeline(tmp_path / "t")
    no_upload(p)
    assert p.prepare() == 0
    opts = options(p)
    assert not any(c["enabled"] for c in opts["cycles"]) and opts["holiday_source"] is None
    assert [x["message"] for x in opts["problems"] if x["severity"] == "error"] == [
        NO_HOLIDAY_ROSTER]
    assert "Holiday Roster" in by_id(opts)["2026-12"]["reason"]
    assert p.analyze() == 1
    err = capsys.readouterr().err
    assert "no Holiday Roster: upload one or add one to roster-reference" in err
    assert "Traceback" not in err
    source, errors, _ = resolve_holiday_source(p.paths)
    assert source is None and errors == [NO_HOLIDAY_ROSTER]


def test_the_default_reference_folder_is_shared_roster_reference():
    real = Paths()
    assert real.reference_dir == real.root.parent / "shared" / "roster-reference"
    assert real.reference_dir.name == "roster-reference"


# ---- a whole run on the reference file --------------------------------------------------------

@pytest.fixture
def reference_run(tmp_path):
    p = Pipeline(tmp_path / "t")
    no_upload(p)
    add_reference(p, "Holiday Roster 2026.xlsx")
    p.ref_before = snapshot(reference_dir(p))
    return p


def audit_of(p: Pipeline) -> dict:
    f = next(f for f in p.paths.audit_dir.iterdir() if f.suffix == ".json")
    return json.loads(f.read_text(encoding="utf-8"))


def test_a_whole_run_without_an_upload_records_the_source_everywhere(reference_run):
    p = reference_run
    p.run_to_diff(EDITS)
    ref_sha = p.ref_before["Holiday Roster 2026.xlsx"]
    expect = {"kind": REFERENCE, "file": "Holiday Roster 2026.xlsx", "sha256": ref_sha,
              "covers_years": [2026, 2027]}

    analysis = json.loads(p.paths.analysis.read_text(encoding="utf-8"))
    assert analysis["holiday_source"] == expect
    assert analysis["inputs"]["holidays"]["sha256"] == ref_sha
    assert analysis["inputs"]["holidays"]["kind"] == REFERENCE
    assert p.diff_json()["holiday_source"] == expect
    assert p.report()["summary"]["holiday_source"] == expect

    from openpyxl import load_workbook
    ws = load_workbook(p.draft())["Run log"]
    cells = {str(r[0]): [str(c) for c in r[1:]] for r in ws.iter_rows(values_only=True) if r[0]}
    assert cells["Holiday matrix"][:2] == ["Holiday Roster 2026.xlsx", ref_sha]
    assert cells["Holiday Roster source"][0] == "reference (Holiday Roster 2026.xlsx)"

    assert p.finalize() == 0
    report = p.report()
    assert report["stage"] == "final" and report["summary"]["holiday_source"] == expect
    audit = audit_of(p)
    assert audit["inputs"]["matrix"]["name"] == "Holiday Roster 2026.xlsx"
    assert audit["inputs"]["matrix"]["sha256"] == ref_sha
    assert audit["extra"]["holiday_source"] == expect
    # the next-year file got its holiday labels from the reference file
    from roster_lib.roster_io import load_roster
    ny = next(p.paths.final_dir.glob("* - 2027.xlsx"))
    assert load_roster(ny, "PDT Operate").holiday_labels()[date(2027, 1, 26)] == "Test Republic Day"

    # the reference folder is untouched and nothing was written into input/
    assert snapshot(reference_dir(p)) == p.ref_before
    assert not p.paths.holidays.exists()


def test_no_script_deletes_or_changes_the_reference_file(reference_run):
    p = reference_run
    assert p.prepare() == 0
    p.run_to_diff(EDITS)
    assert p.finalize() == 0
    assert snapshot(reference_dir(p)) == p.ref_before


def test_finalize_refuses_when_the_pinned_reference_file_changed(reference_run, capsys):
    p = reference_run
    p.run_to_diff(EDITS)
    master_sha = sha256_file(p.paths.roster)
    ref = reference_dir(p) / "Holiday Roster 2026.xlsx"
    _rewrite_matrix(ref, extra_rows=[("Added Later", date(2026, 12, 30), ["Pune"])])
    capsys.readouterr()
    assert p.finalize() == 1
    err = capsys.readouterr().err
    assert err.startswith("ERROR: ") and "Traceback" not in err
    assert "the Holiday Roster changed since the analysis" in err and "\n" not in err.strip()
    assert not p.paths.final_dir.exists() or not list(p.paths.final_dir.glob("*.xlsx"))
    assert not p.paths.audit_dir.exists() and sha256_file(p.paths.roster) == master_sha


def test_diff_blocks_when_the_pinned_reference_file_changed(reference_run):
    p = reference_run
    p.run_to_draft()
    ref = reference_dir(p) / "Holiday Roster 2026.xlsx"
    _rewrite_matrix(ref, extra_rows=[("Added Later", date(2026, 12, 30), ["Pune"])])
    assert p.diff() == 0
    d = p.diff_json()
    assert [b["kind"] for b in d["blocking"]] == ["INPUT_CHANGED"]
    assert "the Holiday Roster changed since the analysis" in d["blocking"][0]["message"]


def test_a_newer_reference_file_after_the_analysis_does_not_swap_the_file(reference_run):
    """The later steps use the file the analysis pinned, not whatever would be picked now."""
    p = reference_run
    p.run_to_diff(EDITS)
    add_reference(p, "Holiday Roster 2027.xlsx", mtime=1_900_000_000)
    assert p.finalize() == 0
    assert audit_of(p)["inputs"]["matrix"]["name"] == "Holiday Roster 2026.xlsx"


def test_a_removed_pinned_reference_file_refuses_the_next_step(reference_run, capsys):
    p = reference_run
    p.run_to_draft()
    (reference_dir(p) / "Holiday Roster 2026.xlsx").unlink()
    capsys.readouterr()
    assert p.diff() == 1
    err = capsys.readouterr().err
    assert "Holiday Roster" in err and "no longer available" in err and "Traceback" not in err


def test_an_uploaded_file_pinned_by_the_analysis_stays_the_source(tmp_path):
    p = Pipeline(tmp_path / "t")
    add_reference(p, "Holiday Roster 2026.xlsx")  # exists, but the upload wins
    p.run_to_diff(EDITS)
    analysis = json.loads(p.paths.analysis.read_text(encoding="utf-8"))
    assert analysis["holiday_source"]["kind"] == UPLOADED
    assert p.finalize() == 0
    assert p.report()["summary"]["holiday_source"]["kind"] == UPLOADED
    assert p.paths.holidays.is_file()
