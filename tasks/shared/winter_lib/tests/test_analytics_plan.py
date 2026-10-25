from datetime import date

from analytics_fixtures import check_rules, synthetic_config, synthetic_dict
from winter_lib.analytics_config import parse_analytics_config
from winter_lib.analytics_plan import slot_template_rows, solve_analytics_plan


def test_plan_fills_all_34_slots_and_meets_every_hard_rule():
    c = synthetic_config()
    plan = solve_analytics_plan(c)
    assert plan.ok and plan.status == "optimal"
    assert len(plan.assignments) == 34
    assert check_rules(c, plan.assignments, plan.on_call) == []
    assert sorted(plan.on_call) == c.dates  # exactly one per day
    assert plan.on_call_counts == {"Hotel": 4, "India": 4}


def test_slot_counts_distribution_and_extra_slot_note():
    c = synthetic_config()
    plan = solve_analytics_plan(c)
    k = plan.counts
    assert k["Delta"] == 3  # available Dec 28-30 only
    assert k["Hotel"] == 1 and k["India"] == 1  # on-call people: 1 slot each
    assert k["Juliet"] == 4
    assert sorted(k[n] for n in ("Alpha", "Bravo", "Charlie", "Echo", "Foxtrot", "Golf")) == [4, 4, 4, 4, 4, 5]
    assert sum(k.values()) == 34
    text = " ".join(plan.notes)
    assert "Delta is available Dec 28–30 only" in text
    assert "5th slot" in text


def test_availability_is_respected():
    c = synthetic_config()
    plan = solve_analytics_plan(c)
    days = {a.date for a in plan.assignments if a.person == "Delta"}
    assert days <= {date(2026, 12, 28), date(2026, 12, 29), date(2026, 12, 30)}


def test_mexico_person_takes_every_s4_slot_one_per_day():
    c = synthetic_config()
    plan = solve_analytics_plan(c)
    s4 = [a for a in plan.assignments if a.zone == "Mexico"]
    assert len(s4) == 4 and {a.person for a in s4} == {"Juliet"}
    assert len({a.date for a in s4}) == 4


def test_deterministic_same_hash_every_run():
    c = synthetic_config()
    hashes = {solve_analytics_plan(c).plan_hash for _ in range(3)}
    assert len(hashes) == 1 and "" not in hashes


def test_preferences_met_on_the_synthetic_team():
    plan = solve_analytics_plan(synthetic_config())
    assert plan.metrics["usual_shift_misses"] == 0
    assert plan.metrics["turnarounds"] == 0
    assert plan.metrics["holiday_range_misses"] == 0


def test_turnaround_weight_keeps_s3_then_s1_away():
    d = synthetic_dict()
    for p in d["people"]:
        if p.get("role") != "mexico":
            p["usual_shift"] = "S1"
    plan = solve_analytics_plan(parse_analytics_config(d))
    assert plan.ok and plan.metrics["turnarounds"] == 0


def test_on_call_halves_prefer_contiguous_blocks():
    d = synthetic_dict()
    d["weights"] = {"holiday": 0, "block": 0, "usual_shift": 0, "oncall_block": 5}
    plan = solve_analytics_plan(parse_analytics_config(d))
    assert plan.metrics["split_on_call_blocks"] == 0
    days = sorted(plan.on_call)
    first = plan.on_call[days[0]]
    assert [plan.on_call[x] for x in days[:4]] == [first] * 4


def test_slot_labels_for_repeated_codes():
    rows = slot_template_rows(synthetic_config())
    day = [r.label for r in rows if r.date == date(2026, 12, 28)]
    assert day == ["S1-A", "S1-B", "S2-A", "S2-B", "S3-A", "S3-B", "S4"]
    assert [r.label for r in rows if r.date == date(2026, 12, 26)] == ["S1", "S3"]


def test_infeasible_reports_the_rule_instead_of_crashing():
    d = synthetic_dict()
    # the on-call people can only cover three days each, so one on call every day cannot hold
    for p in d["people"]:
        if p.get("role") == "on_call":
            p["available"] = {"from": "2026-12-25", "to": "2026-12-27"}
    plan = solve_analytics_plan(parse_analytics_config(d))
    assert plan.status == "infeasible" and not plan.ok
    assert plan.assignments == []
    joined = " ".join(plan.problems)
    assert "availability" in joined


def test_infeasible_when_a_day_has_more_slots_than_people():
    d = synthetic_dict()
    d["slot_profile"] = {"per_day": {"2026-12-26": {"S1": 6, "S2": 6, "S3": 6}}}
    plan = solve_analytics_plan(parse_analytics_config(d))
    assert plan.status == "infeasible" and plan.problems


def test_mexico_double_slot_is_reported():
    d = synthetic_dict()
    d["slots"] = [{"date": "2026-12-28", "code": "S4"}, {"date": "2026-12-28", "code": "S4"}]
    plan = solve_analytics_plan(parse_analytics_config(d))
    assert plan.status == "infeasible"
    assert any("two slots on the same day" in p for p in plan.problems)


def test_no_extra_candidate_reports_slot_counts_rule():
    d = synthetic_dict()
    for p in d["people"]:
        if p.get("role", "support") == "support":
            p["can_take_extra"] = False
    plan = solve_analytics_plan(parse_analytics_config(d))
    assert plan.status == "infeasible"
    assert any("slot counts" in p for p in plan.problems)


def test_balanced_case_has_no_notes():
    d = synthetic_dict()
    for p in d["people"]:
        p.pop("available", None)  # 7 support people x 4 + 2 on-call slots = 30 exactly
    plan = solve_analytics_plan(parse_analytics_config(d))
    assert plan.ok
    assert plan.notes == []
    assert sorted(plan.counts.values()) == [1, 1, 4, 4, 4, 4, 4, 4, 4, 4]
