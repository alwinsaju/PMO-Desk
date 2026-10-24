"""Unit tests for scripts/_common.py (synthetic data only)."""

import json
from datetime import date

import pytest

import _common as c
from roster_lib.cycle_builder import Flag
from roster_lib.config import parse_config


# ---- cycles -----------------------------------------------------------------------------------

def test_parse_cycle_id_and_labels():
    dec = c.parse_cycle_id("2026-12")
    assert (dec.start, dec.end) == (date(2026, 11, 29), date(2027, 1, 30))
    assert c.cycle_id(dec) == "2026-12"
    assert c.cycle_range_label(dec) == "Dec 2026 - Jan 2027"
    assert c.cycle_range_label(c.parse_cycle_id("2027-02")) == "Feb 2027 - Mar 2027"
    assert c.cycle_range_label(c.parse_cycle_id("2026-10")) == "Oct 2026 - Nov 2026"
    d = c.cycle_dict(dec)
    assert d["id"] == "2026-12" and d["short_label"] == "Dec 2026" and d["start"] == "2026-11-29"


@pytest.mark.parametrize("bad", ["", None, "2026-11", "2026-13", "26-12", "Dec 2026", "2026-1"])
def test_parse_cycle_id_rejects(bad):
    with pytest.raises(c.TaskError):
        c.parse_cycle_id(bad)


def test_candidate_cycles_cover_the_roster_and_the_next_cycle():
    ids = [c.cycle_id(x) for x in c.candidate_cycles(date(2026, 8, 2), date(2027, 1, 1))]
    assert ids == ["2026-08", "2026-10", "2026-12", "2027-02"]
    # a calendar-year roster starts inside the cycle that began the previous November
    ids = [c.cycle_id(x) for x in c.candidate_cycles(date(2026, 1, 2), date(2027, 1, 1))]
    assert ids == ["2025-12", "2026-02", "2026-04", "2026-06", "2026-08", "2026-10",
                   "2026-12", "2027-02"]


def test_read_selected_cycle(tmp_path):
    paths = c.Paths(tmp_path)
    with pytest.raises(c.TaskError, match="no cycle was selected"):
        c.read_selected_cycle(paths)
    paths.input_dir.mkdir()
    paths.run_params.write_text(json.dumps({"params": {}}), encoding="utf-8")
    with pytest.raises(c.TaskError, match="params.cycle"):
        c.read_selected_cycle(paths)
    paths.run_params.write_text(json.dumps({"params": {"cycle": "2026-12"}}), encoding="utf-8")
    assert c.cycle_id(c.read_selected_cycle(paths)) == "2026-12"
    paths.run_params.write_text("not json", encoding="utf-8")
    with pytest.raises(c.TaskError, match="cannot be read"):
        c.read_selected_cycle(paths)


# ---- field ids and options ----------------------------------------------------------------------

def test_field_ids_split_on_the_first_colon():
    fid = c.field_id(c.F_PTO, "Some: Name")
    assert fid == "pto:Some: Name"
    assert c.split_field_id(fid) == ("pto", "Some: Name")


def test_shift_options():
    with_keep = [o["value"] for o in c.shift_options()]
    assert with_keep[0] == "KEEP"
    assert {"S1", "S2", "S3", "S4", "S5", "NS", "US-CST", "US-PST", "11AM-8PM"} <= set(with_keep)
    assert "KEEP" not in [o["value"] for o in c.shift_options(include_keep=False)]
    assert [o["value"] for o in c.pattern_options()] == ["AUTO", "MON_FRI", "WED_SUN"]
    labels = {o["value"]: o["label"] for o in c.shift_options()}
    assert labels["S1"] == "Shift 1 (S1)" and labels["NS"] == "NS"


FORM = {"title": "t", "fields": [
    {"id": "shift:A One", "type": "select", "required": True, "default": "KEEP",
     "options": c.shift_options()},
    {"id": "pattern:A One", "type": "select", "required": False, "default": "AUTO",
     "options": c.pattern_options()},
    {"id": "shift:B Two", "type": "select", "required": True,
     "options": c.shift_options(include_keep=False)},
    {"id": "new:C Three", "type": "select", "required": True,
     "options": [{"value": "new_seat"}, {"value": "replaces:Old Person"}]},
    {"id": "seat_shift:C Three", "type": "select", "required": False, "default": "S3",
     "options": c.shift_options(include_keep=False)},
    {"id": "seat_pattern:C Three", "type": "select", "required": False, "default": "AUTO",
     "options": c.pattern_options()},
    {"id": "seat_team:C Three", "type": "select", "required": False, "default": "Operate",
     "options": [{"value": "Operate"}]},
    {"id": "seat_rotation:C Three", "type": "select", "required": False,
     "default": "UNCLASSIFIED", "options": [{"value": r} for r in c.ROTATION_CHOICES]},
    {"id": "pto:Persn", "type": "select", "required": True,
     "options": [{"value": "Person"}, {"value": "SKIP"}]},
    {"id": "pto:Other", "type": "select", "required": True,
     "options": [{"value": "Person"}, {"value": "SKIP"}]},
]}
INFO = {"new_people": {"C Three": {"section": "Lab", "location": "Pune", "in_config": False}}}
BASE = {"shift:A One": "S2", "shift:B Two": "NS", "new:C Three": "new_seat",
        "pto:Persn": "Person", "pto:Other": "SKIP"}


def test_convert_answers_structured_output():
    out = c.convert_answers(FORM, dict(BASE), INFO)
    assert out.structured["rotation"] == {"A One": {"shift": "S2"}, "B Two": {"shift": "NS"}}
    # a new seat takes the follow-up defaults and the roster section as the subteam
    assert out.structured["changes"] == {"C Three": {"new_seat": {
        "rotation": "UNCLASSIFIED", "shift": "S3", "team": "Operate", "subteam": "Lab"}}}
    assert out.confirmed_pto == {"Persn": "Person"}
    assert out.skipped_pto == ["Other"]
    assert out.replacements == {}
    assert out.answered == len(FORM["fields"])  # optional defaults count as answered


def test_convert_answers_pattern_and_replacement():
    answers = dict(BASE, **{"pattern:A One": "WED_SUN", "new:C Three": "replaces:Old Person",
                            "seat_shift:C Three": "S1"})
    out = c.convert_answers(FORM, answers, INFO)
    assert out.structured["rotation"]["A One"] == {"shift": "S2", "pattern": "WED_SUN"}
    # follow-ups are ignored for a replacement
    assert out.structured["changes"] == {"C Three": {"replaces": "Old Person"}}
    assert out.replacements == {"C Three": "Old Person"}


def test_convert_answers_explicit_seat_fields_and_auto_pattern():
    answers = dict(BASE, **{"seat_shift:C Three": "S4", "seat_pattern:C Three": "WED_SUN",
                            "seat_rotation:C Three": "AUTO_SWAP", "pattern:A One": "AUTO"})
    out = c.convert_answers(FORM, answers, INFO)
    seat = out.structured["changes"]["C Three"]["new_seat"]
    assert seat == {"rotation": "AUTO_SWAP", "shift": "S4", "pattern": "WED_SUN",
                    "team": "Operate", "subteam": "Lab"}
    assert "pattern" not in out.structured["rotation"]["A One"]  # AUTO = leave it to the library


def test_convert_answers_is_strict():
    answers = {"shift:A One": "S9", "shift:B Two": "KEEP", "zzz:stale": "x"}
    with pytest.raises(c.TaskError) as err:
        c.convert_answers(FORM, answers, INFO)
    text = str(err.value)
    assert "not in the form" in text and "zzz:stale" in text
    assert "required question unanswered: new:C Three" in text
    assert "required question unanswered: pto:Persn" in text
    assert "shift:A One: 'S9' is not one of" in text
    assert "shift:B Two: 'KEEP' is not one of" in text  # no KEEP when no current shift
    with pytest.raises(c.TaskError, match="must be an object"):
        c.convert_answers(FORM, ["x"], INFO)
    # a blank string is not an answer
    with pytest.raises(c.TaskError, match="unanswered: shift:A One"):
        c.convert_answers(FORM, dict(BASE, **{"shift:A One": "  "}), INFO)


def test_convert_answers_empty_form():
    out = c.convert_answers({"title": "t", "fields": []}, {}, {})
    assert out.structured == {"changes": {}, "rotation": {}} and out.answered == 0


# ---- flags -------------------------------------------------------------------------------------------

def test_flags_payload_and_add_flags_keep_the_library_order():
    a = Flag("PTO_NOTE", "INFO", "note")
    b = Flag("HOL_STRAY", "ERROR", "stray", "P1", date(2026, 12, 1))
    payload = c.flags_payload([a, b])
    assert payload["counts"] == {"error": 1, "warning": 0, "info": 1}
    assert [f["severity"] for f in payload["flags"]] == ["info", "error"]
    assert payload["flags"][1]["key"].startswith("HOL_STRAY|P1|2026-12-01")

    class P:
        flags = [a]
    plan = P()
    c.add_flags(plan, [b, Flag("CHANGE_NOTE", "WARNING", "w")])
    assert [f.severity for f in plan.flags] == ["ERROR", "WARNING", "INFO"]
    c.add_flags(plan, [])
    assert len(plan.flags) == 3
    assert c.flag_counts(plan.flags) == {"error": 1, "warning": 1, "info": 1}
    assert c.severity_lower([{"severity": "ERROR", "x": 1}]) == [{"severity": "error", "x": 1}]


def test_most_common_breaks_ties_alphabetically():
    assert c.most_common(["S3", "S1", "S3", "S1"], "S5") == "S1"
    assert c.most_common([], "S5") == "S5"


# ---- files --------------------------------------------------------------------------------------------

def test_write_json_is_atomic_deterministic_and_leaves_no_temp_files(tmp_path):
    target = tmp_path / "sub" / "x.json"
    c.write_json(target, {"b": 1, "a": [1, 2], "n": "café"})
    first = target.read_bytes()
    c.write_json(target, {"b": 1, "a": [1, 2], "n": "café"})
    assert target.read_bytes() == first
    assert first.endswith(b"\n") and "café".encode() in first and b"\r" not in first
    assert [p.name for p in target.parent.iterdir()] == ["x.json"]
    assert c.read_json(target, "x")["b"] == 1
    with pytest.raises(c.TaskError, match="not found"):
        c.read_json(tmp_path / "missing.json", "the thing")


def test_remove_quietly(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    a.write_text("x")
    assert c.remove_quietly([a, b]) == 1 and not a.exists()


def test_paths_rel_and_draft_name(tmp_path):
    paths = c.Paths(tmp_path)
    assert paths.rel(paths.output / "x" / "y.xlsx") == "output/x/y.xlsx"
    assert paths.draft("2026-12").name == "Roster DRAFT 2026-12.xlsx"
    assert paths.rel(tmp_path.parent / "elsewhere.txt").endswith("elsewhere.txt")
    assert paths.ask_me in paths.stale_outputs() and paths.options not in paths.stale_outputs()


def test_changed_inputs(tmp_path):
    paths = c.Paths(tmp_path)
    paths.input_dir.mkdir()
    paths.roster.write_bytes(b"one")
    recorded = c.input_records(paths)
    assert recorded["pto"] is None and recorded["roster"]["bytes"] == 3
    keys = ["roster", "holidays", "pto"]
    assert c.changed_inputs(paths, recorded, keys) == []
    paths.roster.write_bytes(b"two")
    paths.pto.write_bytes(b"new file")
    assert c.changed_inputs(paths, recorded, keys) == [
        "the roster workbook changed since the analysis",
        "the PTO import changed since the analysis"]


def test_save_config_with_backup(tmp_path):
    paths = c.Paths(tmp_path)
    paths.config_dir.mkdir()
    old = {"version": 1, "seed": 1, "people": []}
    paths.config.write_text(json.dumps(old), encoding="utf-8")
    new_cfg = parse_config({"version": 1, "seed": 2, "people": []})
    backup = c.save_config_with_backup(paths, new_cfg)
    assert json.loads(backup.read_text(encoding="utf-8")) == old
    assert backup.parent == paths.config_backups and backup.name.startswith("rotation-config.")
    assert json.loads(paths.config.read_text(encoding="utf-8"))["seed"] == 2
    again = c.save_config_with_backup(paths, new_cfg)  # same second: never overwrites a backup
    assert again != backup and backup.exists() and again.exists()
    assert not [p for p in paths.config_dir.iterdir() if p.name.endswith(".tmp")]


def test_save_config_without_previous_file(tmp_path):
    paths = c.Paths(tmp_path)
    paths.config_dir.mkdir()
    assert c.save_config_with_backup(paths, parse_config({"version": 1, "people": []})) is None
    assert paths.config.exists()


# ---- running a script -----------------------------------------------------------------------------

def test_run_script_maps_failures_to_exit_codes(tmp_path, capsys):
    def ok(paths):
        assert paths.root == tmp_path.resolve()

    def user_error(paths):
        raise c.TaskError("something readable")

    def library_error(paths):
        raise c.NextYearError("library said no")

    def crash(paths):
        raise KeyError("boom")

    assert c.run_script(ok, task_dir=tmp_path) == 0
    assert c.run_script(user_error, task_dir=tmp_path) == 1
    assert c.run_script(library_error, task_dir=tmp_path) == 1
    assert c.run_script(crash, task_dir=tmp_path) == 2
    err = capsys.readouterr().err
    assert "ERROR: something readable" in err and "ERROR: library said no" in err
    assert "unexpected KeyError" in err and "Traceback" not in err
    assert c.run_script(ok, ["--task-dir", str(tmp_path)]) == 0
    assert c.run_script(ok, ["--nope"], tmp_path) == 2


def test_load_helpers_report_readable_problems(tmp_path):
    paths = c.Paths(tmp_path)
    paths.input_dir.mkdir()
    paths.config_dir.mkdir()
    with pytest.raises(c.TaskError, match="roster workbook is missing"):
        c.load_master(paths)
    paths.roster.write_bytes(b"not a zip")
    with pytest.raises(c.TaskError, match="cannot be opened"):
        c.load_master(paths)
    with pytest.raises(c.TaskError, match="rotation config is missing"):
        c.load_config_file(paths)
    paths.config.write_text("{bad", encoding="utf-8")
    with pytest.raises(c.TaskError, match="rotation config has problems"):
        c.load_config_file(paths)
    source, errors, _ = c.resolve_holiday_source(paths)
    assert source is None and errors == [c.NO_HOLIDAY_ROSTER]
    paths.holidays.write_bytes(b"junk")
    source, errors, _ = c.resolve_holiday_source(paths)
    assert source is None and "uploaded Holiday Roster cannot be used" in errors[0]
    assert c.read_pto_file(paths) is None
    paths.pto.write_bytes(b"junk")
    with pytest.raises(c.TaskError, match="PTO import"):
        c.read_pto_file(paths)
