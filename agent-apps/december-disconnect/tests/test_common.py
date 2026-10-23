"""Unit tests for scripts/_common.py (synthetic data only)."""

import json
from datetime import date, datetime, timezone

import pytest

import _common as c
from synth import analytics_config_dict, winter_config_dict

START, END = date(2026, 12, 25), date(2027, 1, 1)


# ---- window --------------------------------------------------------------------------------------

def test_window_ids_and_labels():
    assert c.window_id(START, END) == "2026-12-25..2027-01-01"
    assert c.window_file_text(START, END) == "2026-12-25 to 2027-01-01"
    assert c.window_label(START, END) == "Dec 25, 2026 - Jan 1, 2027"
    assert c.window_label(date(2026, 12, 25), date(2026, 12, 31)) == "Dec 25 - Dec 31, 2026"
    assert c.parse_window_id("2026-12-25..2027-01-01") == (START, END)


@pytest.mark.parametrize("bad", ["", None, "2026-12-25", "2026-12-25..", "2027-01-01..2026-12-25",
                                 "2026-13-01..2026-13-05", "Dec 25"])
def test_parse_window_id_rejects(bad):
    with pytest.raises(c.TaskError):
        c.parse_window_id(bad)


def test_disconnect_days_are_strictly_between_the_holidays():
    assert c.disconnect_days(START, END) == (date(2026, 12, 26), date(2026, 12, 31))
    assert c.disconnect_days(date(2026, 12, 25), date(2026, 12, 26)) is None
    assert c.disconnect_days(date(2026, 12, 25), date(2026, 12, 27)) == (date(2026, 12, 26),) * 2


def test_read_selected_window(tmp_path):
    paths = c.Paths(tmp_path)
    cfg = c.parse_winter(winter_config_dict())
    with pytest.raises(c.TaskError, match="no window was selected"):
        c.read_selected_window(paths, cfg)
    paths.input_dir.mkdir()
    paths.run_params.write_text(json.dumps({"params": {}}), encoding="utf-8")
    with pytest.raises(c.TaskError, match="params.window"):
        c.read_selected_window(paths, cfg)
    paths.run_params.write_text(json.dumps({"params": {"window": "2026-12-26..2027-01-02"}}),
                                encoding="utf-8")
    with pytest.raises(c.TaskError, match="does not match the configured window"):
        c.read_selected_window(paths, cfg)
    paths.run_params.write_text(json.dumps({"params": {"window": "2026-12-25..2027-01-01"}}),
                                encoding="utf-8")
    assert c.read_selected_window(paths, cfg) == "2026-12-25..2027-01-01"
    paths.run_params.write_text("not json", encoding="utf-8")
    with pytest.raises(c.TaskError, match="cannot be read"):
        c.read_selected_window(paths, cfg)


# ---- dates ----------------------------------------------------------------------------------------

def test_parse_date_list():
    assert c.parse_date_list("2026-12-26, 2026-12-28..2026-12-30;2026-12-26", START, END) == [
        date(2026, 12, 26), date(2026, 12, 28), date(2026, 12, 29), date(2026, 12, 30)]
    assert c.parse_date_list("  ", START, END) == []
    for bad, msg in (("2026-12-24", "outside the window"), ("26/12/2026", "not a date"),
                     ("2026-12-30..2026-12-28", "ends before"), ("2026-12-26..2027-02-01", "outside")):
        with pytest.raises(ValueError, match=msg):
            c.parse_date_list(bad, START, END)


# ---- scrub, errors ---------------------------------------------------------------------------------

def test_scrub_blanks_quoted_fragments():
    assert "Secret" not in c.scrub("availability['Secret Name']: bad; \"Other Person\" too")
    assert c.first_lines(["a 'x'", "b", "c"], 2).endswith("and 1 more")


def test_run_script_maps_errors_without_a_traceback(tmp_path, capsys):
    def boom(paths):
        raise KeyError("Secret Person")

    assert c.run_script(boom, task_dir=tmp_path) == 2
    err = capsys.readouterr().err
    assert err.strip() == "ERROR: unexpected KeyError" and "Secret" not in err

    def refuse(paths):
        raise c.TaskError("readable reason")

    assert c.run_script(refuse, task_dir=tmp_path) == 1
    assert capsys.readouterr().err.strip() == "ERROR: readable reason"
    assert c.run_script(lambda p: None, argv=["--bogus"], task_dir=None) == 2


# ---- form / answers ---------------------------------------------------------------------------------

def make_form():
    people = [{"value": "NONE", "label": "-"}, {"value": "Ann Person", "label": "Ann"}]
    fields = [
        {"id": "shift:New Person", "type": "select", "required": True, "default": "S1",
         "options": [{"value": "S1"}, {"value": "S2"}]},
        {"id": "name:Staff Spelling", "type": "select", "required": True,
         "options": [{"value": "Roster Spelling"}, {"value": "SKIP"}]},
    ]
    for prefix, rows in (("avail", c.MAIN_ROWS), ("aavail", c.ANALYTICS_ROWS)):
        for n in range(1, rows + 1):
            fields += [
                {"id": f"{prefix}_person_{n}", "type": "select", "required": False, "default": "NONE",
                 "options": people},
                {"id": f"{prefix}_dates_{n}", "type": "text", "required": False, "default": ""},
                {"id": f"{prefix}_mode_{n}", "type": "select", "required": False,
                 "default": "unavailable",
                 "options": [{"value": "unavailable"}, {"value": "only_available"}]}]
    return {"fields": fields}


def test_convert_answers_happy_path_and_defaults():
    form = make_form()
    flat = {"shift:New Person": "S2", "name:Staff Spelling": "Roster Spelling",
            "avail_person_1": "Ann Person", "avail_dates_1": "2026-12-26,2026-12-28..2026-12-29",
            "aavail_person_2": "Ann Person", "aavail_dates_2": "2026-12-30", "aavail_mode_2": "only_available"}
    conv = c.convert_answers(form, flat, (START, END))
    assert conv.shifts == {"New Person": "S2"}
    assert conv.name_alias == {"Staff Spelling": "Roster Spelling"} and conv.name_skip == []
    main, an = conv.rows("main"), conv.rows("analytics")
    assert [(r.index, r.person, r.mode, len(r.dates)) for r in main] == [(1, "Ann Person", "unavailable", 3)]
    assert [(r.index, r.mode) for r in an] == [(2, "only_available")]
    # a SKIP answer
    conv = c.convert_answers(form, {"shift:New Person": "S1", "name:Staff Spelling": "SKIP"}, (START, END))
    assert conv.name_skip == ["Staff Spelling"] and conv.name_alias == {}


def test_convert_answers_is_strict_and_names_nobody():
    form = make_form()
    good = {"shift:New Person": "S1", "name:Staff Spelling": "SKIP"}
    cases = [
        ("not an object", "must be an object"),
        ({}, "unanswered"),
        ({**good, "ghost:Secret Person": "x"}, "not in the form"),
        ({**good, "shift:New Person": "S9"}, "not one of the options"),
        ({**good, "avail_person_1": "Ann Person"}, "no dates"),
        ({**good, "avail_person_1": "Ann Person", "avail_dates_1": "2026-12-01"}, "outside the window"),
        ({**good, "avail_person_1": "Ann Person", "avail_dates_1": "2026-12-26", "avail_mode_1": "bad"},
         "not one of the options"),
        ({**good, "avail_person_1": "Nobody Known", "avail_dates_1": "2026-12-26"}, "not one of the options"),
    ]
    for flat, msg in cases:
        with pytest.raises(c.TaskError, match=msg) as e:
            c.convert_answers(form, flat, (START, END))
        text = str(e.value)
        for secret in ("New Person", "Staff Spelling", "Secret Person", "Nobody Known", "Ann Person"):
            assert secret not in text, text
    # dates with no person are ignored
    conv = c.convert_answers(form, {**good, "avail_dates_1": "2026-12-26"}, (START, END))
    assert conv.availability == []


# ---- merging answers into config copies --------------------------------------------------------------

def test_merge_winter_raw_copies_and_merges():
    raw = winter_config_dict()
    raw["availability"] = {"ann person": {"unavailable": ["2026-12-25"], "allowed": ["2026-12-26..2026-12-29"]}}
    raw["exclusions"]["people"] = ["Gone Person"]
    before = json.dumps(raw, sort_keys=True)
    conv = c.ConvertedAnswers(
        {}, {"Staff Spelling": "Roster Spelling"}, ["Skipped Person", "gone person"],
        [c.AvailabilityRow("main", 1, "Ann Person", [date(2026, 12, 26)], "unavailable"),
         c.AvailabilityRow("main", 2, "Ann Person", [date(2026, 12, 27), date(2026, 12, 28)], "only_available"),
         c.AvailabilityRow("main", 3, "New Person", [date(2026, 12, 30)], "only_available")])
    out = c.merge_winter_raw(raw, conv)
    assert json.dumps(raw, sort_keys=True) == before  # the input dict is untouched
    assert out["default_new_person_shift"] is None
    assert out["name_aliases"] == {"Staff Spelling": "Roster Spelling"}
    assert out["exclusions"]["people"] == ["Gone Person", "Skipped Person"]  # no duplicate
    ann = out["availability"]["ann person"]
    assert ann["unavailable"] == ["2026-12-25", "2026-12-26"]
    assert ann["allowed"] == ["2026-12-27", "2026-12-28"]  # intersected with the range 26..29
    assert out["availability"]["New Person"] == {"allowed": ["2026-12-30"]}
    c.parse_winter(out)  # still a valid winter config


def test_refresh_and_merge_analytics():
    from synth import analytics_rosters_usual, write_analytics_roster
    import tempfile
    from pathlib import Path
    raw = analytics_config_dict()
    tmp = Path(tempfile.mkdtemp())
    paths = c.Paths(tmp)
    paths.input_dir.mkdir()
    usual = analytics_rosters_usual()
    write_analytics_roster(paths.analytics_a, usual)
    readings = c.read_analytics_rosters(paths)
    out, info = c.refresh_analytics_raw(raw, readings)
    assert (info.files, info.matched, info.updated, info.unchanged) == (1, 10, 1, 9)
    assert info.not_in_rosters == 0 and info.extra_in_rosters == 0
    first = raw["people"][0]["name"]
    assert next(p for p in out["people"] if p["name"] == first)["usual_shift"] == usual[first]
    assert raw["people"][0]["usual_shift"] != usual[first]  # the input is untouched
    none, info0 = c.refresh_analytics_raw(raw, [])
    assert none == raw and info0.files == 0

    acfg = c.parse_analytics(out)
    conv = c.ConvertedAnswers({}, {}, [], [
        c.AvailabilityRow("analytics", 1, "Alpha", [date(2026, 12, 25)], "unavailable"),
        c.AvailabilityRow("analytics", 2, "Bravo", [date(2026, 12, 28), date(2026, 12, 29)], "only_available")])
    merged = c.merge_analytics_raw(out, conv, acfg)
    alpha = next(p for p in merged["people"] if p["short_name"] == "Alpha")
    assert "2026-12-25" not in alpha["available"] and len(alpha["available"]) == 7
    bravo = next(p for p in merged["people"] if p["short_name"] == "Bravo")
    assert bravo["available"] == ["2026-12-28", "2026-12-29"]
    c.parse_analytics(merged)
    with pytest.raises(c.TaskError, match="not on the analytics config"):
        c.merge_analytics_raw(out, c.ConvertedAnswers({}, {}, [], [
            c.AvailabilityRow("analytics", 1, "Zulu", [date(2026, 12, 25)], "unavailable")]), acfg)


# ---- flags ---------------------------------------------------------------------------------------------

def flag(kind, severity, person=None, date_=None, plan="main", source="audit", where="", message="m"):
    return {"key": "", "severity": severity, "kind": kind, "person": person, "date": date_,
            "team": None, "where": where, "message": message, "plan": plan, "source": source}


def test_keys_ignore_the_message_and_number_repeats():
    a = c.assign_keys([flag("WINTER_X", "error", "P", "2026-12-25", message="one"),
                       flag("WINTER_X", "error", "P", "2026-12-25", message="two"),
                       flag("ANALYTICS_Y", "info", plan="analytics", where="Dec 25 S1")])
    assert [f["severity"] for f in a] == ["error", "error", "info"]
    assert a[0]["key"].endswith("2026-12-25|") and a[1]["key"] == a[0]["key"] + "#2"
    b = c.assign_keys([flag("WINTER_X", "error", "P", "2026-12-25", message="changed text")])
    assert b[0]["key"] == a[0]["key"]
    payload = c.flags_payload([flag("A", "warning"), flag("B", "info"), flag("C", "error")])
    assert payload["counts"] == {"error": 1, "warning": 1, "info": 1}
    assert [f["severity"] for f in payload["flags"]] == ["error", "warning", "info"]


def test_audit_delta_ignores_info_and_counts_carried():
    before = c.assign_keys([flag("W_A", "warning", "P"), flag("W_B", "error", "Q"), flag("I", "info")])
    after = c.assign_keys([flag("W_A", "warning", "P"), flag("W_C", "error", "R"), flag("I2", "info")])
    d = c.audit_delta(before, after, carried=3)
    assert [f["kind"] for f in d["new"]] == ["W_C"] and [f["kind"] for f in d["resolved"]] == ["W_B"]
    assert d["remaining"] == 1 + 3 and d["not_rechecked"] == 3


# ---- the previous run ------------------------------------------------------------------------------------

def test_archive_previous_moves_drafts_and_plans(tmp_path):
    paths = c.Paths(tmp_path)
    paths.output.mkdir()
    assert c.archive_previous(paths) == (None, 0)
    names = ["Winter Coverage DRAFT x.xlsx", "Winter Coverage DRAFT x.xlsx.snapshot.json",
             "Analytics Winter Coverage DRAFT x.xlsx", "Analytics Winter Coverage DRAFT x.xlsx.snapshot.json",
             "plan.json", "analytics-plan.json", "roster-diff.json", "flags.json", "draft-meta.json"]
    for n in names + ["Winter Coverage FINAL x.xlsx"]:
        (paths.output / n).write_text(n, encoding="utf-8")
    moment = datetime(2026, 10, 23, 12, 0, 0, tzinfo=timezone.utc)
    target, n = c.archive_previous(paths, moment)
    assert n == len(names) and target.name == "20261023T120000Z"
    assert sorted(p.name for p in target.iterdir()) == sorted(names)
    assert (paths.output / "Winter Coverage FINAL x.xlsx").exists()
    # a second archive in the same second never reuses the folder
    (paths.output / "Winter Coverage DRAFT y.xlsx").write_text("y", encoding="utf-8")
    target2, _ = c.archive_previous(paths, moment)
    assert target2.name == "20261023T120000Z-2"


def test_keep_previous_plans_and_load_previous_plan(tmp_path):
    from winter_lib.winter_plan import WinterPlan
    paths = c.Paths(tmp_path)
    paths.output.mkdir()
    cfg = c.parse_winter(winter_config_dict())
    assert c.load_previous_plan(paths, cfg) is None
    plan = WinterPlan(tuple(cfg.days), [], {})
    paths.plan.write_text(plan.to_json(), encoding="utf-8")
    paths.analytics_plan.write_text("{}", encoding="utf-8")
    assert c.keep_previous_plans(paths) == 2
    assert not paths.plan.exists() and paths.previous_plan.exists() and paths.previous_analytics_plan.exists()
    assert c.load_previous_plan(paths, cfg) is not None
    other = WinterPlan(tuple(cfg.days[:-1]), [], {})  # another window: not a stability reference
    paths.previous_plan.write_text(other.to_json(), encoding="utf-8")
    assert c.load_previous_plan(paths, cfg) is None
    paths.previous_plan.write_text("garbage", encoding="utf-8")
    assert c.load_previous_plan(paths, cfg) is None


# ---- paths, task config, files ---------------------------------------------------------------------------

def test_shift_roster_config_path(tmp_path):
    paths = c.Paths(tmp_path / "task")
    paths.config_dir.mkdir(parents=True)
    assert c.shift_roster_config_path(paths) == tmp_path / "shift-roster" / "config" / "rotation-config.json"
    paths.task_config.write_text(json.dumps({"shift_roster_config": "../elsewhere/rc.json"}), encoding="utf-8")
    assert c.shift_roster_config_path(paths) == (tmp_path / "elsewhere" / "rc.json").resolve()
    absolute = tmp_path / "abs.json"
    paths.task_config.write_text(json.dumps({"shift_roster_config": str(absolute)}), encoding="utf-8")
    assert c.shift_roster_config_path(paths) == absolute
    paths.task_config.write_text(json.dumps({}), encoding="utf-8")
    assert c.shift_roster_config_path(paths).name == "rotation-config.json"
    paths.task_config.write_text("nope", encoding="utf-8")
    with pytest.raises(c.TaskError, match="not valid JSON"):
        c.shift_roster_config_path(paths)


def test_paths_rel_and_stale_outputs(tmp_path):
    paths = c.Paths(tmp_path)
    assert paths.rel(paths.output / "a" / "b.json") == "output/a/b.json"
    assert paths.rel(tmp_path.parent / "x.json").endswith("x.json")
    stale = paths.stale_outputs()
    assert paths.previous_plan not in stale and paths.analysis not in stale
    assert paths.plan in stale and paths.answers in stale and paths.meta in stale


def test_files_atomic_and_copy_verified(tmp_path):
    p = tmp_path / "sub" / "a.json"
    c.write_json(p, {"b": 1, "a": "é"})
    assert json.loads(p.read_text(encoding="utf-8")) == {"b": 1, "a": "é"}
    assert not [x for x in p.parent.iterdir() if x.name.endswith(".tmp")]
    dst = tmp_path / "out" / "copy.json"
    c.copy_verified(p, dst)
    assert dst.read_bytes() == p.read_bytes()
    assert c.remove_quietly([p, tmp_path / "nothing"]) == 1
    with pytest.raises(c.TaskError, match="not found"):
        c.read_json(p, "the thing")
    p.write_text("{", encoding="utf-8")
    with pytest.raises(c.TaskError, match="cannot be read"):
        c.read_json(p, "the thing")


def test_changed_inputs_reports_each_changed_file(tmp_path):
    paths = c.Paths(tmp_path)
    paths.input_dir.mkdir()
    paths.roster.write_bytes(b"a")
    recorded = c.input_records(paths)
    assert c.changed_inputs(paths, recorded) == []
    paths.roster.write_bytes(b"b")
    paths.staff.write_bytes(b"new")
    assert sorted(c.changed_inputs(paths, recorded)) == ["the shift roster changed since the analysis",
                                                          "the staff roster changed since the analysis"]


def test_shift_options_cover_the_plan_codes():
    values = [o["value"] for o in c.shift_options()]
    assert values[:5] == ["S1", "S2", "S3", "S4", "S5"] and "US-CST" in values and "MX-8-5" in values
    assert c.shift_codes() == values
