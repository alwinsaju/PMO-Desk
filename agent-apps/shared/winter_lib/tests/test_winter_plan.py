import copy
import json
from collections import Counter
from datetime import date, timedelta

import pytest

from winter_lib import winter_plan as wp
from winter_lib.winter_config import parse_config
from winter_lib.winter_types import ERROR, PlanPerson
from winter_testkit import example_dict, make_config, person


def small_cfg(**over):
    d = example_dict()
    d["availability"], d["shift_overrides"], d["name_aliases"] = {}, {}, {}
    d["exclusions"] = {"team_patterns": [], "people": [], "name_patterns": []}
    d["solver"]["time_limit_s"] = 30
    for k, v in over.items():
        d[k] = v
    return parse_config(d)


def make_people(n_dis=6, n_dep=4, n_l3=3, n_cms=2, n_lns=2, n_hub=2):
    shifts = ["S1", "S3", "S2", "NS", "S4", "US-CST"]
    out = []
    for team, n in (("DIS", n_dis), ("DEP", n_dep), ("L3", n_l3), ("CMS 2.0", n_cms), ("LNS 2.0", n_lns),
                    ("Integration HUB", n_hub)):
        for i in range(n):
            out.append(person(f"{team[:3].upper()}{i} Tester", team, shifts[i % len(shifts)]))
    return out


def counts(plan, cfg):
    return {t.name: [plan.headcount(t.name, d) for d in plan.window] for t in cfg.teams}


@pytest.fixture(scope="module")
def solved():
    cfg = small_cfg()
    people = make_people()
    return cfg, people, wp.solve_winter_plan(people, cfg)


def test_rules_hold_on_a_solvable_instance(solved):
    cfg, people, plan = solved
    c = counts(plan, cfg)
    assert min(c["DIS"]) >= 2 and min(c["DEP"]) >= 2
    for t in ("CMS 2.0", "LNS 2.0", "Integration HUB"):
        assert min(c[t]) >= 1
    for p in people:
        n = len(plan.days_of(p.name))
        assert 3 <= n <= 5
        if p.team == "L3":
            assert n == 3  # best-effort team: no extra days
        for d in plan.days_of(p.name):
            assert plan.code(p.name, d) == p.usual_shift
    assert plan.run_info.success and plan.run_info.mip_gap in (0, 0.0)
    assert not [f for f in plan.findings if f.severity == ERROR]


def test_extra_days_only_where_a_team_needs_the_slots(solved):
    cfg, people, plan = solved
    extras = {p.name: len(plan.days_of(p.name)) - 3 for p in people}
    # CMS has two people for a 1/day minimum over 8 days: 8 person-days > 2 x 3, so exactly 2 extra days
    assert sum(v for n, v in extras.items() if n.startswith("CMS")) == 2
    # a team with plenty of people gets none
    assert sum(v for n, v in extras.items() if n.startswith("DIS")) == 0
    assert sum(v for n, v in extras.items() if n.startswith("L3")) == 0


def test_run_info_is_logged(solved):
    cfg, people, plan = solved
    ri = plan.run_info
    assert ri.seed == cfg.seed and ri.options["time_limit_s"] == 30
    assert ri.weights["shortfall"] == 1000 and ri.weights["day_weight"]["holiday"] == 2
    assert ri.model["x"] == len(people) * 8 and ri.model["constraints"] > 0
    assert "Optimal" in ri.status or "optimal" in ri.status.lower()
    assert ri.dual_bound is not None and abs(ri.objective - ri.dual_bound) < 1e-6
    assert ri.solve_seconds > 0


def test_solver_objective_equals_independent_score(solved):
    cfg, people, plan = solved
    score = wp.score_plan(plan, cfg)
    assert abs(plan.run_info.objective - score["total"]) < 1.0  # the tie-break perturbation is < 1 in total
    assert plan.run_info.terms["total"] == score["total"]


def test_score_prefers_covered_plans(solved):
    cfg, people, plan = solved
    worse = wp.WinterPlan(plan.window, plan.people, {k: v for k, v in plan.cells.items() if not k[0].startswith("CMS0")})
    assert wp.score_plan(worse, cfg)["total"] > wp.score_plan(plan, cfg)["total"]


def test_deterministic_across_runs(solved):
    cfg, people, plan = solved
    again = wp.solve_winter_plan(people, cfg)
    assert again.to_json() == plan.to_json()
    assert again.plan_hash() == plan.plan_hash()


def test_seed_changes_tie_breaks_but_not_the_objective_class(solved):
    cfg, people, plan = solved
    other = wp.solve_winter_plan(people, small_cfg(solver={"time_limit_s": 30, "mip_rel_gap": 0.0, "seed": 7}))
    assert abs(wp.score_plan(other, cfg)["total"] - wp.score_plan(plan, cfg)["total"]) < 1e-6


def test_json_roundtrip(solved):
    _, _, plan = solved
    back = wp.WinterPlan.from_json(plan.to_json(include_timing=True))
    assert back.cells == plan.cells and back.window == plan.window
    assert [p.to_dict() for p in back.people] == [p.to_dict() for p in plan.people]
    assert back.run_info.seed == plan.run_info.seed and back.run_info.solve_seconds > 0
    assert back.plan_hash() == plan.plan_hash()
    assert "solve_seconds" not in json.loads(plan.to_json())["run_info"]
    with pytest.raises(ValueError):
        wp.WinterPlan.from_json('{"schema": "x"}')


def test_availability_is_respected():
    people = make_people()
    av = {people[0].name: {"unavailable": ["2026-12-25..2026-12-29"]}, people[1].name: {"allowed": ["2026-12-30..2026-12-31", "2027-01-01"]}}
    cfg = small_cfg(availability=av)
    plan = wp.solve_winter_plan(people, cfg)
    assert all(d > date(2026, 12, 29) for d in plan.days_of(people[0].name))
    assert set(plan.days_of(people[1].name)) == {date(2026, 12, 30), date(2026, 12, 31), date(2027, 1, 1)}
    assert not [f for f in plan.findings if f.severity == ERROR]


def test_infeasible_minimum_is_reported_not_hidden():
    people = [p for p in make_people() if p.team != "DEP"] + [person("Solo DEP", "DEP", "S1")]
    cfg = small_cfg()
    plan = wp.solve_winter_plan(people, cfg)
    errs = [f for f in plan.findings if f.code == "team_min"]
    assert len(errs) == 8  # DEP needs 2 every day, there is one person: short EVERY day
    assert all(f.team == "DEP" and "1 of 2" in f.message or "0 of 2" in f.message for f in errs)
    assert "the team has only 1 member(s) in the plan" in errs[0].message
    assert plan.run_info.terms["shortfall_units"] == sum(2 - plan.headcount("DEP", d) for d in plan.window)
    assert plan.run_info.success  # the model itself was solved
    assert len(plan.days_of("Solo DEP")) == 5  # works the maximum to reduce the gap


def test_unavailability_makes_a_team_infeasible_on_one_day():
    people = make_people(n_dep=5)
    dep = [p.name for p in people if p.team == "DEP"]
    av = {n: {"unavailable": ["2026-12-26"]} for n in dep[:4]}  # only one DEP person can work Dec 26
    plan = wp.solve_winter_plan(people, small_cfg(availability=av))
    errs = [f for f in plan.findings if f.code == "team_min"]
    assert [f.date for f in errs] == [date(2026, 12, 26)]
    assert "only 1 of 5 team member(s) are available that day" in errs[0].message


def test_person_below_min_days_when_unavailable():
    people = make_people()
    plan = wp.solve_winter_plan(people, small_cfg(availability={people[3].name: {"allowed": ["2026-12-30", "2026-12-31"]}}))
    f = [x for x in plan.findings if x.code == "days_below_min"]
    assert len(f) == 1 and f[0].person == people[3].name and "2 available day(s)" in f[0].message
    assert len(plan.days_of(people[3].name)) == 2


def test_best_effort_teams_get_no_extra_days_even_if_nobody_is_on():
    people = [person("Only Lab", "Lab", "S1"), person("Another Lab", "Lab", "S1")] + make_people()
    plan = wp.solve_winter_plan(people, small_cfg())
    for n in ("Only Lab", "Another Lab"):
        assert len(plan.days_of(n)) == 3
    gaps = [f for f in plan.findings if f.code == "best_effort_gap" and f.team == "Lab"]
    assert gaps  # six person-days cannot cover eight days: reported as INFO, not an error
    assert all(f.severity == "info" for f in gaps)


def test_weekends_and_holidays_weighted_less_for_shortfall():
    # Two teams short, one slot: the cheaper shortfall (weekend, weight 1) is the one left open.
    people = [person("A Short", "CMS 2.0", "S1")] + make_people(n_cms=0)
    cfg = small_cfg()
    plan = wp.solve_winter_plan(people, cfg)
    open_days = [d for d in plan.window if plan.headcount("CMS 2.0", d) == 0]
    assert len(open_days) == 3 and all(d.weekday() >= 5 or d in cfg.holidays for d in open_days)


def test_lane_subteam_and_fairness_terms_are_met_when_capacity_allows():
    people = [person(f"Lane{i} T", "DIS", "S1" if i < 3 else "NS", subteam="Complaints" if i == 0 else None)
              for i in range(6)]
    cfg = small_cfg()
    plan = wp.solve_winter_plan(people, cfg)
    s = wp.score_plan(plan, cfg)
    assert s.get("lane", 0) == 0
    assert min(plan.headcount("DIS", d) for d in plan.window) >= 2
    # the single Complaints member works three days: five days are uncovered (soft term, reported)
    assert s["subteam_units"] == 5
    for p in people[1:]:  # (the sub-team member trades fairness for covering weekdays: 40 x 3 > 5)
        fair = [d for d in plan.days_of(p.name) if d in set(cfg.fair_days)]
        assert 1 <= len(fair) <= 2


def test_one_contiguous_block_per_person_when_nothing_else_competes():
    people = make_people()
    w = example_dict()["weights"]
    w.update({"lane": 0, "subteam": 0, "fairness": 0, "best_effort_nobody": 0})
    cfg = small_cfg(weights=w)
    plan = wp.solve_winter_plan(people, cfg)
    blocks = 0
    for p in people:
        days = plan.days_of(p.name)
        blocks += 1 + sum(1 for a, b in zip(days, days[1:]) if (b - a).days > 1)
    assert plan.run_info.terms["blocks_units"] == blocks
    extra_days = sum(max(0, len(plan.days_of(p.name)) - 3) for p in people)
    # one block each, except a person who works 4-5 days may need a second block
    assert blocks <= len(people) + extra_days


def test_stability_keeps_unchanged_people_on_their_days():
    people = make_people()
    cfg = small_cfg()
    first = wp.solve_winter_plan(people, cfg)
    # one DIS person becomes unavailable on a day they were working
    victim = next(p for p in people if p.team == "DIS" and first.days_of(p.name))
    gone = first.days_of(victim.name)[0]
    changed_cfg = small_cfg(availability={victim.name: {"unavailable": [gone.isoformat()]}})
    stable = wp.solve_winter_plan(people, changed_cfg, previous_plan=first)
    free = wp.solve_winter_plan(people, changed_cfg)

    def moved(a, b):
        return len(set(a.cells) ^ set(b.cells))

    assert stable.run_info.stability and not free.run_info.stability
    assert (victim.name, gone) not in stable.cells
    assert moved(stable, first) <= moved(free, first)
    assert stable.run_info.terms["stability_units"] == moved(stable, first)
    # people other than the victim keep (nearly) all their days
    kept = sum(1 for k in first.cells if k[0] != victim.name and k in stable.cells)
    assert kept >= 0.9 * sum(1 for k in first.cells if k[0] != victim.name)


def test_stability_ignores_people_not_in_the_previous_plan():
    people = make_people()
    cfg = small_cfg()
    first = wp.solve_winter_plan(people[:-1], cfg)
    again = wp.solve_winter_plan(people, cfg, previous_plan=first)
    old = {k for k in first.cells}
    new = {k for k in again.cells if k[0] != people[-1].name}
    assert again.run_info.terms["stability_units"] == len(old ^ new)  # the new person is never counted
    assert len(again.days_of(people[-1].name)) >= 3


def test_validation_errors():
    cfg = small_cfg()
    with pytest.raises(wp.PlanInputError, match="needs_shift"):
        wp.solve_winter_plan([PlanPerson("No Shift", "DIS", "Hyd", None)], cfg)
    with pytest.raises(wp.PlanInputError, match="not in the rules table"):
        wp.solve_winter_plan([person("X Y", "Nowhere")], cfg)
    with pytest.raises(wp.PlanInputError, match="duplicate"):
        wp.solve_winter_plan([person("Same", "DIS"), person("Same", "DIS")], cfg)


def test_window_dates_drive_the_model():
    d = example_dict()
    d["window"] = {"start": "2027-12-27", "end": "2027-12-31"}
    d.pop("holidays")
    d.pop("fair_days")
    d["availability"], d["shift_overrides"], d["name_aliases"] = {}, {}, {}
    d["exclusions"] = {"team_patterns": [], "people": [], "name_patterns": []}
    cfg = parse_config(d)
    plan = wp.solve_winter_plan(make_people(), cfg)
    assert len(plan.window) == 5 and plan.window[0] == date(2027, 12, 27)
    assert all(d_ in plan.window for (_, d_) in plan.cells)
    assert not [f for f in plan.findings if f.severity == ERROR]


def test_solver_failure_falls_back_to_a_deterministic_plan(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no solver today")

    monkeypatch.setattr(wp, "milp", boom)
    people = make_people()
    cfg = small_cfg()
    plan = wp.solve_winter_plan(people, cfg)
    assert plan.run_info.fallback and not plan.run_info.success and "no solver today" in plan.run_info.status
    assert plan.findings[0].code == "solver_fallback"
    assert all(len(plan.days_of(p.name)) >= 3 for p in people)
    assert min(plan.headcount("DIS", d) for d in plan.window) >= 2
    assert plan.to_json() == wp.solve_winter_plan(people, cfg).to_json()


def test_time_limit_is_logged_and_flagged(monkeypatch):
    real = wp.milp

    class R:
        pass

    def fake(*a, **k):
        r = real(*a, **k)
        r.status = 1
        r.message = "Time limit reached"
        r.mip_gap = 0.05
        return r

    monkeypatch.setattr(wp, "milp", fake)
    plan = wp.solve_winter_plan(make_people(), small_cfg())
    assert plan.run_info.time_limit_hit and plan.findings[0].code == "time_limit"
    assert "5.00%" in plan.findings[0].message


def test_content_hash_ignores_the_run_log(solved):
    cfg, people, plan = solved
    clone = wp.WinterPlan.from_json(plan.to_json())
    clone.run_info.solve_seconds = 99.0
    assert clone.plan_hash() == plan.plan_hash()
