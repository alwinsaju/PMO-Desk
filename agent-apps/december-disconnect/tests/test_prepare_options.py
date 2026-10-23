"""prepare_options.py: the window list and its problems (synthetic data only)."""

import json

import pytest

from pipeline import Pipeline
from synth import WINDOW, analytics_config_dict, winter_config_dict


@pytest.fixture()
def p(tmp_path):
    return Pipeline(tmp_path / "t")


def options(p):
    return json.loads(p.paths.options.read_text(encoding="utf-8"))


def test_one_enabled_window_from_the_config(p):
    assert p.prepare() == 0
    o = options(p)
    assert [w["id"] for w in o["windows"]] == [WINDOW] and o["default"] == WINDOW
    w = o["windows"][0]
    assert w["enabled"] is True and w["days"] == 8 and w["reason"]
    assert (w["start"], w["end"]) == ("2026-12-25", "2027-01-01")
    assert w["lookback"] == {"start": "2026-08-25", "end": "2026-12-24"}
    assert o["problems"] == []
    assert o["roster"]["people"] > 0 and o["staff"]["people"] > 0
    assert o["analytics"] == {"people": 10, "slots": 34, "window_matches": True}
    # a select option shape the platform understands, and nothing else is written
    assert {"id", "label", "enabled", "reason"} <= set(w)
    assert sorted(x.name for x in p.paths.output.iterdir()) == ["options.json"]


def test_prepare_is_deterministic(p):
    p.prepare()
    first = p.paths.options.read_bytes()
    p.prepare()
    assert p.paths.options.read_bytes() == first


def test_missing_winter_config_is_a_problem_not_a_crash(p):
    p.paths.winter_config.unlink()
    assert p.prepare() == 0
    o = options(p)
    assert o["windows"] == [] and o["default"] is None
    assert any(x["severity"] == "error" and "winter config is missing" in x["message"]
               for x in o["problems"])


def test_invalid_winter_config_names_no_person(p):
    raw = winter_config_dict()
    raw["shift_overrides"] = {"Secret Person": "NOT-A-SHIFT"}
    p.paths.winter_config.write_text(json.dumps(raw), encoding="utf-8")
    assert p.prepare() == 0
    text = json.dumps(options(p))
    assert "winter config has problems" in text and "Secret Person" not in text


def test_missing_analytics_config_disables_the_window(p):
    p.paths.analytics_config.unlink()
    assert p.prepare() == 0
    w = options(p)["windows"][0]
    assert w["enabled"] is False and "analytics config is missing" in w["reason"]


def test_window_mismatch_between_the_configs(p):
    raw = analytics_config_dict()
    raw["window"] = {"start": "2026-12-26", "end": "2027-01-02"}
    raw.pop("holiday_dates")
    p.paths.analytics_config.write_text(json.dumps(raw), encoding="utf-8")
    assert p.prepare() == 0
    o = options(p)
    assert o["windows"][0]["enabled"] is False and o["analytics"]["window_matches"] is False
    assert any("different windows" in x["message"] for x in o["problems"])


def test_unreadable_rosters_disable_the_window(p):
    p.paths.staff.write_bytes(b"not an xlsx")
    assert p.prepare() == 0
    o = options(p)
    assert o["windows"][0]["enabled"] is False
    assert any("staff roster cannot be opened" in x["message"] for x in o["problems"])
    assert o["staff"] is None


def test_missing_rosters(p):
    p.paths.roster.unlink()
    assert p.prepare() == 0
    o = options(p)
    assert o["windows"][0]["enabled"] is False and o["roster"] is None
    assert any("shift roster workbook is missing" in x["message"] for x in o["problems"])


def test_roster_without_data_in_the_lookback_disables_the_window(p):
    raw = winter_config_dict()
    raw["window"] = {"start": "2027-06-25", "end": "2027-07-02"}
    raw["holidays"], raw["fair_days"] = {}, ["2027-06-26", "2027-06-27"]
    p.paths.winter_config.write_text(json.dumps(raw), encoding="utf-8")
    a = analytics_config_dict()
    a["window"] = {"start": "2027-06-25", "end": "2027-07-02"}
    a.pop("holiday_dates")
    p.paths.analytics_config.write_text(json.dumps(a), encoding="utf-8")
    assert p.prepare() == 0
    w = options(p)["windows"][0]
    assert w["enabled"] is False and "upload the current shift roster" in w["reason"]
