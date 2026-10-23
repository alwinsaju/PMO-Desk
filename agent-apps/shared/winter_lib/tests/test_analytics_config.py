from datetime import date, time

import pytest

from analytics_fixtures import EXAMPLE, synthetic_config, synthetic_dict
from winter_lib.analytics_config import (
    AnalyticsConfigError, default_slot_template, load_analytics_config, parse_analytics_config,
    save_analytics_config,
)


def test_example_loads_and_has_34_slots_in_the_template():
    c = load_analytics_config(EXAMPLE)
    assert len(c.slots) == 34
    assert len(c.ist_slots) == 30 and len(c.mexico_slots) == 4
    assert c.dates[0].isoformat() == "2026-12-25" and len(c.dates) == 8
    assert len(c.on_call_people) == 2 and len(c.mexico_people) == 1


def test_default_slot_distribution_matches_previous_layout():
    c = synthetic_config()
    dist = {d.isoformat(): v for d, v in c.slot_distribution().items()}
    assert dist["2026-12-25"] == {"S1": 1, "S2": 2, "S3": 1}
    assert dist["2026-12-26"] == dist["2026-12-27"] == {"S1": 1, "S3": 1}
    assert dist["2026-12-28"] == {"S1": 2, "S2": 2, "S3": 2, "S4": 1}
    for day in ("2026-12-29", "2026-12-30", "2026-12-31"):
        assert dist[day] == {"S1": 1, "S2": 2, "S3": 1, "S4": 1}
    assert dist["2027-01-01"] == {"S1": 1, "S2": 2, "S3": 1}
    starts = {s.code: s.start for s in c.slots}
    assert starts == {"S1": time(8), "S2": time(11), "S3": time(14), "S4": time(22)}


def test_explicit_slot_list_and_profile_overrides():
    d = synthetic_dict()
    d["slots"] = [{"date": "2026-12-25", "code": "S1"}, {"date": "2026-12-25", "code": "S2", "start": "11:30"}]
    c = parse_analytics_config(d)
    assert [(s.code, s.start) for s in c.slots] == [("S1", time(8)), ("S2", time(11, 30))]
    d = synthetic_dict()
    d["slot_profile"] = {"per_day": {"2026-12-26": {"S1": 2}}, "mexico_dates": ["2026-12-29"]}
    c = parse_analytics_config(d)
    assert len(c.mexico_slots) == 1
    assert sum(1 for s in c.slots if s.date == date(2026, 12, 26)) == 2


def test_availability_range_and_list():
    c = synthetic_config()
    p = c.person("Delta")
    assert p.available == frozenset({date(2026, 12, 28), date(2026, 12, 29), date(2026, 12, 30)})
    assert p.is_available(date(2026, 12, 29)) and not p.is_available(date(2026, 12, 25))
    assert c.person("Alpha").is_available(date(2026, 12, 25))
    d = synthetic_dict()
    d["people"][0]["available"] = ["2026-12-25", "2026-12-26"]
    assert len(parse_analytics_config(d).people[0].available) == 2


def test_person_lookup_accepts_short_or_full_name_loosely():
    c = synthetic_config()
    assert c.person("  alpha tester ").display == "Alpha"
    assert c.person("ALPHA").name == "Alpha Tester"
    assert c.person("nobody") is None


def test_round_trip(tmp_path):
    c = synthetic_config()
    path = tmp_path / "c.json"
    save_analytics_config(c, path)
    c2 = load_analytics_config(path)
    assert c2.to_dict() == c.to_dict()


def test_validation_lists_every_problem():
    d = synthetic_dict()
    d["bogus"] = 1
    d["people"][0]["usual_shift"] = "S9"
    d["people"][1]["role"] = "boss"
    d["window"] = {"start": "2027-01-02", "end": "2026-12-25"}
    d["weights"] = {"holiday": -1, "nope": 1}
    with pytest.raises(AnalyticsConfigError) as e:
        parse_analytics_config(d)
    text = " ".join(e.value.problems)
    for needle in ("unknown top-level", "usual_shift", "role must", "window", "holiday", "unknown weight"):
        assert needle in text


def test_needs_an_on_call_person_and_a_mexico_person_for_mexico_slots():
    d = synthetic_dict()
    d["people"] = [p for p in d["people"] if p.get("role") != "on_call"]
    with pytest.raises(AnalyticsConfigError, match="on_call"):
        parse_analytics_config(d)
    d = synthetic_dict()
    d["people"] = [p for p in d["people"] if p.get("role") != "mexico"]
    with pytest.raises(AnalyticsConfigError, match="Mexico"):
        parse_analytics_config(d)


def test_duplicate_names_rejected():
    d = synthetic_dict()
    d["people"][1]["short_name"] = "Alpha"
    with pytest.raises(AnalyticsConfigError, match="clashes"):
        parse_analytics_config(d)


def test_slot_outside_window_rejected():
    d = synthetic_dict()
    d["slots"] = [{"date": "2027-02-01", "code": "S1"}]
    with pytest.raises(AnalyticsConfigError, match="outside the window"):
        parse_analytics_config(d)


def test_default_template_generator_is_pure():
    c = synthetic_config()
    again = default_slot_template(c.dates, c.holiday_dates)
    assert [s.to_dict() for s in again] == [s.to_dict() for s in c.slots]


def test_hours_text():
    c = synthetic_config()
    assert c.hours_text("S1") == "8AM–5PM"
    assert c.hours_text("S4") == "10PM–7AM"
