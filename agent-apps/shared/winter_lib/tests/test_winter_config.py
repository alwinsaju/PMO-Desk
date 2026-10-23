import copy
import json
import os
from datetime import date

import pytest

from winter_lib.winter_config import (
    ConfigError,
    WinterConfig,
    add_months,
    load_config,
    parse_config,
    save_config,
)

EXAMPLE = os.path.join(os.path.dirname(__file__), "..", "examples", "winter_config.example.json")


def example_dict():
    with open(EXAMPLE, encoding="utf-8") as f:
        return json.load(f)


def test_example_loads_and_matches_the_2026_rules():
    cfg = load_config(EXAMPLE)
    assert cfg.start == date(2026, 12, 25) and cfg.end == date(2027, 1, 1)
    assert len(cfg.days) == 8
    mins = {t.name: (t.min_per_day, t.best_effort) for t in cfg.teams}
    assert mins["DIS"] == (2, False) and mins["DEP"] == (2, False)
    for t in ("CMS 2.0", "LNS 2.0", "Integration HUB"):
        assert mins[t] == (1, False)
    for t in ("L3", "Device Support", "Lab", "Device Support L3", "EKS", "R&D", "Instrument Manager"):
        assert mins[t] == (0, True)
    assert len(cfg.teams) == 12
    assert (cfg.min_days, cfg.max_days, cfg.best_effort_max_days) == (3, 5, 3)
    assert cfg.max_days_for("DIS") == 5 and cfg.max_days_for("L3") == 3


def test_day_labels_weights_and_fair_days():
    cfg = load_config(EXAMPLE)
    labels = [cfg.day_label(d) for d in cfg.days]
    assert labels == ["Christmas", "Weekend", "Weekend", "Winter Disconnect", "Winter Disconnect",
                      "Winter Disconnect", "Winter Disconnect", "New Year"]
    assert [cfg.day_weight(d) for d in cfg.days] == [2, 1, 1, 3, 3, 3, 3, 2]
    assert cfg.fair_days == (date(2026, 12, 25), date(2026, 12, 26), date(2026, 12, 27), date(2027, 1, 1))


def test_defaults_derive_holidays_and_fair_days_when_omitted():
    d = example_dict()
    for k in ("holidays", "fair_days", "weekend_label", "default_day_label"):
        d.pop(k)
    cfg = parse_config(d)
    assert cfg.day_label(date(2026, 12, 25)) == "Christmas"
    assert cfg.day_label(date(2027, 1, 1)) == "New Year"
    assert len(cfg.fair_days) == 4


def test_window_dates_are_inputs():
    d = example_dict()
    d["window"] = {"start": "2027-12-24", "end": "2028-01-02"}
    for k in ("holidays", "fair_days", "availability"):
        d.pop(k)
    cfg = parse_config(d)
    assert len(cfg.days) == 10
    assert cfg.lookback_range() == (date(2027, 8, 24), date(2027, 12, 23))


def test_lookback_range_ends_the_day_before_the_window():
    cfg = load_config(EXAMPLE)
    assert cfg.lookback_range() == (date(2026, 8, 25), date(2026, 12, 24))
    d = example_dict()
    d["lookback_months"] = 1
    assert parse_config(d).lookback_range() == (date(2026, 11, 25), date(2026, 12, 24))


def test_add_months_clips_day():
    assert add_months(date(2026, 12, 31), -4) == date(2026, 8, 31)
    assert add_months(date(2027, 3, 31), -1) == date(2027, 2, 28)
    assert add_months(date(2026, 1, 15), -2) == date(2025, 11, 15)


def test_availability_unavailable_and_allowed():
    cfg = load_config(EXAMPLE)
    alice = cfg.available_dates("alice  EXAMPLE")
    assert date(2026, 12, 25) not in alice and date(2026, 12, 26) not in alice and date(2026, 12, 28) in alice
    bob = cfg.available_dates("Bob Example")
    assert bob == tuple(date(2026, 12, d) for d in range(28, 32))
    assert cfg.available_dates("Somebody Else") == cfg.days


def test_exclusions_and_team_resolution():
    cfg = load_config(EXAMPLE)
    assert cfg.is_excluded_label("Analytics") and cfg.is_excluded_label("Governance Lead")
    assert not cfg.is_excluded_label("DIS L2")
    assert cfg.is_excluded_name("rolled off example")
    assert cfg.resolve_team("L2") == "DIS"
    assert cfg.resolve_team("DIS L2 - Infra") == "DIS"
    assert cfg.resolve_team("l n s 2.0") == "LNS 2.0"
    assert cfg.resolve_team("Integration Hub") == "Integration HUB"
    assert cfg.resolve_team("Device Support L3") == "Device Support L3"
    assert cfg.resolve_team("Unknown") is None and cfg.resolve_team(None) is None


def test_shift_overrides_are_canonical():
    cfg = load_config(EXAMPLE)
    assert cfg.shift_overrides == {"carol example": "S1"}
    d = example_dict()
    d["shift_overrides"] = {"Carol Example": "Shift 3"}
    assert parse_config(d).shift_overrides["carol example"] == "S3"


def test_all_problems_reported_together():
    d = example_dict()
    d["window"] = {"start": "2026-12-25", "end": "nope"}
    d["teams"][0]["min_per_day"] = "two"
    d["teams"][2]["min_per_day"] = 1  # best effort with a minimum
    d["rules"]["max_days"] = 2
    d["shift_overrides"] = {"X": "HOL"}
    d["availability"] = {"Y": {"unavailable": ["2030-01-01"]}}
    d["bogus"] = 1
    with pytest.raises(ConfigError) as e:
        parse_config(d)
    msg = " | ".join(e.value.problems)
    for needle in ("window.end", "min_per_day", "best-effort team has no minimum", "max_days is below",
                   "not a shift code", "outside the window", "unknown top-level keys"):
        assert needle in msg, needle
    assert len(e.value.problems) >= 6


def test_team_needs_a_minimum_unless_best_effort():
    d = example_dict()
    d["teams"][0]["min_per_day"] = 0
    with pytest.raises(ConfigError, match="needs min_per_day >= 1"):
        parse_config(d)


def test_extra_day_weights_must_cover_the_allowed_extra_days():
    d = example_dict()
    d["weights"]["extra_day"] = [400]
    with pytest.raises(ConfigError, match="extra_day needs 2 entries"):
        parse_config(d)


def test_alias_to_unknown_team_is_an_error_but_builtin_default_is_dropped():
    d = example_dict()
    d["team_aliases"] = {"L2": "Nope"}
    with pytest.raises(ConfigError, match="not a configured team"):
        parse_config(d)
    d = example_dict()
    d.pop("team_aliases")
    d["teams"] = [t for t in d["teams"] if t["name"] != "LNS 2.0"]
    cfg = parse_config(d)
    assert "L N S 2.0" not in cfg.team_aliases


def test_save_load_roundtrip_is_stable(tmp_path):
    cfg = load_config(EXAMPLE)
    p1, p2 = tmp_path / "a.json", tmp_path / "b" / "b.json"
    save_config(cfg, p1)
    cfg2 = load_config(p1)
    save_config(cfg2, p2)
    assert p1.read_text(encoding="utf-8") == p2.read_text(encoding="utf-8")
    assert cfg2.config_hash() == cfg.config_hash()
    assert cfg2.available_dates("Alice Example") == cfg.available_dates("Alice Example")


def test_config_hash_changes_with_content():
    a = load_config(EXAMPLE)
    d = example_dict()
    d["weights"]["lane"] = 61
    assert parse_config(d).config_hash() != a.config_hash()


def test_invalid_json_file(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text("{nope", encoding="utf-8")
    with pytest.raises(ConfigError, match="not valid JSON"):
        load_config(p)


def test_returns_winter_config_type():
    assert isinstance(load_config(EXAMPLE), WinterConfig)
    assert copy.deepcopy(example_dict())["version"] == 1
