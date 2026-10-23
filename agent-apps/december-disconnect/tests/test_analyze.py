"""analyze.py: the form, analysis.json and the cleanup of a previous run (synthetic data only)."""

import json
from collections import Counter

import pytest

from pipeline import Pipeline
from synth import FUZZY_ROSTER_NAME, FUZZY_STAFF_NAME, WINDOW, analytics_config_dict, winter_config_dict, write_run_params


@pytest.fixture()
def p(tmp_path):
    return Pipeline(tmp_path / "t")


def fields(p):
    return {f["id"]: f for f in p.form()["fields"]}


def test_form_asks_for_new_people_name_matches_and_exceptions(p, capsys):
    assert p.prepare() == 0 and p.analyze() == 0
    out = capsys.readouterr().out
    f = fields(p)
    shifts = [i for i in f if i.startswith("shift:")]
    assert sorted(shifts) == [f"shift:Hub0{i} Sample" for i in range(3)]
    for i in shifts:
        field = f[i]
        assert field["type"] == "select" and field["required"] is True and field["group"] == "New people"
        values = [o["value"] for o in field["options"]]
        assert values[:3] == ["S1", "S2", "S3"] and "US-CST" in values and "MX-8-5" in values
        assert field["default"] == "S1"  # the config's default_new_person_shift
    name = f[f"name:{FUZZY_STAFF_NAME}"]
    assert [o["value"] for o in name["options"]] == [FUZZY_ROSTER_NAME, "SKIP"]
    assert name["required"] is True and name["group"] == "Name matches" and "default" not in name
    # availability rows: 5 main + 3 analytics, each person / dates / mode, all optional
    avail = [x for x in f.values() if x["group"] == "Availability exceptions"]
    assert len(avail) == (5 + 3) * 3 and all(x["required"] is False for x in avail)
    for prefix, rows in (("avail", 5), ("aavail", 3)):
        for n in range(1, rows + 1):
            person, dates, mode = (f[f"{prefix}_{k}_{n}"] for k in ("person", "dates", "mode"))
            assert person["options"][0] == {"value": "NONE", "label": "No exception"}
            assert person["default"] == "NONE" and dates["type"] == "text" and dates["default"] == ""
            assert [o["value"] for o in mode["options"]] == ["unavailable", "only_available"]
    main_people = {o["value"] for o in f["avail_person_1"]["options"]} - {"NONE"}
    assert f"Hub00 Sample" in main_people and FUZZY_ROSTER_NAME in main_people
    assert not any(n.startswith(("Gov", "Ana")) for n in main_people)  # excluded people are not offered
    an_people = {o["value"] for o in f["aavail_person_1"]["options"]} - {"NONE"}
    assert an_people == {"Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel",
                         "India", "Juliet"}
    assert "34 slots" in f["aavail_person_1"]["description"] and "refreshed" in f["aavail_person_1"]["description"]
    # logs are counts only
    assert "analysis: window" in out
    for secret in ("Hub0", "Sample", "Alpha", "Tester"):
        assert secret not in out


def test_analysis_record(p):
    p.prepare()
    assert p.analyze() == 0
    a = json.loads(p.paths.analysis.read_text(encoding="utf-8"))
    assert a["window"] == WINDOW and a["blocked"] is False and a["blockers"] == []
    assert (a["start"], a["end"]) == ("2026-12-25", "2027-01-01")
    assert a["lookback"] == {"start": "2026-08-25", "end": "2026-12-24"}
    assert set(a["inputs"]) == {"roster", "staff", "analytics_a", "analytics_b", "winter_config",
                                "analytics_config"}
    assert all(v and len(v["sha256"]) == 64 for v in a["inputs"].values())
    assert a["stats"]["needs_shift"] == 3 and a["stats"]["fuzzy"] == 1
    assert a["analytics"]["people"] == 10 and a["analytics"]["refresh"]["updated"] == 1
    assert a["form_info"]["name_matches"] == {FUZZY_STAFF_NAME: FUZZY_ROSTER_NAME}
    assert a["findings"]["staff_not_on_shift_roster"] == 3


def test_without_optional_analytics_rosters(tmp_path):
    q = Pipeline(tmp_path / "t", with_analytics_rosters=False)
    q.prepare()
    assert q.analyze() == 0
    a = json.loads(q.paths.analysis.read_text(encoding="utf-8"))
    assert a["inputs"]["analytics_a"] is None and a["analytics"]["refresh"]["files"] == 0
    assert "config (no Analytics roster was uploaded)" in fields(q)["aavail_person_1"]["description"]


def test_no_fuzzy_match_means_no_name_question(tmp_path):
    q = Pipeline(tmp_path / "t", fuzzy=False)
    q.prepare()
    assert q.analyze() == 0
    assert not [i for i in fields(q) if i.startswith("name:")]


def test_config_default_shift_is_the_form_default_and_never_hides_the_question(p):
    raw = winter_config_dict()
    raw["default_new_person_shift"] = "S3"
    p.paths.winter_config.write_text(json.dumps(raw), encoding="utf-8")
    assert p.analyze() == 0
    f = fields(p)
    assert {f[i]["default"] for i in f if i.startswith("shift:")} == {"S3"}
    raw["default_new_person_shift"] = None  # unset: S1 is the documented fallback
    p.paths.winter_config.write_text(json.dumps(raw), encoding="utf-8")
    assert p.analyze() == 0
    assert {fields(p)[i]["default"] for i in fields(p) if i.startswith("shift:")} == {"S1"}


def test_analyze_removes_stale_files_but_keeps_the_previous_plans(p):
    p.run_to_draft()
    out = p.paths.output
    plan_text = p.paths.plan.read_text(encoding="utf-8")
    an_text = p.paths.analytics_plan.read_text(encoding="utf-8")
    (out / "roster-diff.json").write_text("{}", encoding="utf-8")
    drafts = sorted(x.name for x in out.glob("*Coverage DRAFT*"))
    assert drafts
    assert p.analyze() == 0
    for gone in ("ask-me-answers.json", "plan.json", "analytics-plan.json", "flags.json", "roster-diff.json",
                 "report-data.json", "draft-meta.json", "winter-config.effective.json",
                 "analytics-config.effective.json"):
        assert not (out / gone).exists(), gone
    assert (out / "previous-plan.json").read_text(encoding="utf-8") == plan_text
    assert (out / "previous-analytics-plan.json").read_text(encoding="utf-8") == an_text
    assert sorted(x.name for x in out.glob("*Coverage DRAFT*")) == drafts  # drafts wait for the draft step to archive
    assert p.paths.ask_me.exists() and p.paths.analysis.exists()
    # a second analyze without a draft in between keeps the reference
    assert p.analyze() == 0
    assert (out / "previous-plan.json").read_text(encoding="utf-8") == plan_text


def test_stale_answers_never_satisfy_a_new_form(p):
    p.run_to_draft()
    assert p.analyze() == 0
    assert not p.paths.answers.exists()
    assert p.build_draft() == 1  # required questions and no answers file


@pytest.mark.parametrize("params", [None, {}, {"window": ""}, {"window": "2026-12-26..2027-01-02"},
                                    {"window": "nonsense"}])
def test_bad_window_selection_is_refused_with_one_line(p, params, capsys):
    if params is None:
        assert p.analyze.__self__ is p  # no run-params file at all
        import analyze
        assert analyze.main(task_dir=p.root) == 1
    else:
        p.paths.run_params.write_text(json.dumps({"params": params}), encoding="utf-8")
        import analyze
        assert analyze.main(task_dir=p.root) == 1
    err = capsys.readouterr().err
    assert err.startswith("ERROR: ") and err.count("\n") == 1


def test_missing_and_broken_inputs_are_refused(p, capsys):
    import analyze
    write_run_params(p.paths)
    p.paths.staff.write_bytes(b"not an xlsx")
    assert analyze.main(task_dir=p.root) == 1
    assert "staff roster cannot be opened" in capsys.readouterr().err
    p.paths.staff.unlink()
    assert analyze.main(task_dir=p.root) == 1
    assert "staff roster workbook is missing" in capsys.readouterr().err
    p.paths.roster.unlink()
    assert analyze.main(task_dir=p.root) == 1
    assert "shift roster workbook is missing" in capsys.readouterr().err
    p.paths.analytics_config.unlink()
    assert analyze.main(task_dir=p.root) == 1
    assert "analytics config is missing" in capsys.readouterr().err


def test_analytics_window_must_match(p, capsys):
    import analyze
    raw = analytics_config_dict()
    raw["window"] = {"start": "2026-12-26", "end": "2027-01-02"}
    raw.pop("holiday_dates")
    p.paths.analytics_config.write_text(json.dumps(raw), encoding="utf-8")
    write_run_params(p.paths)
    assert analyze.main(task_dir=p.root) == 1
    assert "different windows" in capsys.readouterr().err


def test_a_roster_with_no_data_before_the_window_is_refused(p, capsys):
    import analyze
    raw = winter_config_dict()
    raw["lookback_months"] = 1
    raw["window"] = {"start": "2028-01-10", "end": "2028-01-17"}
    raw["holidays"], raw["fair_days"] = {}, ["2028-01-15"]
    p.paths.winter_config.write_text(json.dumps(raw), encoding="utf-8")
    a = analytics_config_dict()
    a["window"] = {"start": "2028-01-10", "end": "2028-01-17"}
    a.pop("holiday_dates")
    p.paths.analytics_config.write_text(json.dumps(a), encoding="utf-8")
    p.paths.run_params.write_text(json.dumps({"params": {"window": "2028-01-10..2028-01-17"}}), encoding="utf-8")
    assert analyze.main(task_dir=p.root) == 1
    assert "upload the current shift roster" in capsys.readouterr().err


def test_no_error_message_names_a_person(p, capsys):
    import analyze
    raw = winter_config_dict()
    raw["shift_overrides"] = {"Secret Person": "NOT-A-SHIFT"}
    p.paths.winter_config.write_text(json.dumps(raw), encoding="utf-8")
    write_run_params(p.paths)
    assert analyze.main(task_dir=p.root) == 1
    err = capsys.readouterr().err
    assert "winter config has problems" in err and "Secret Person" not in err
