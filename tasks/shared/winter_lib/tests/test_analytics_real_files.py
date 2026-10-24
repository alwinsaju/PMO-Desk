"""
Runs against the real (gitignored) inputs when they are present; skipped otherwise.

Counts only: no assertion or message here contains a name. Outputs go to the gitignored
`tasks/december-disconnect/output/` folder.
"""

from collections import Counter
from pathlib import Path

import pytest

from winter_lib.analytics_audit import audit_analytics_plan, diff_against_snapshot
from winter_lib.analytics_config import load_analytics_config
from winter_lib.analytics_formula_eval import check_workbook_formulas
from winter_lib.analytics_inputs import read_analytics_people
from winter_lib.analytics_plan import solve_analytics_plan
from winter_lib.analytics_workbook import build_analytics_workbook

APPS = Path(__file__).resolve().parents[3]
REF = APPS / "shared" / "roster-reference"
CONFIG = APPS / "december-disconnect" / "config" / "analytics-config.json"
OUT_DIR = APPS / "december-disconnect" / "output"
ROSTERS = [REF / "Shift Roster - Analytics_October_2026.xlsx", REF / "Shift Roster - Analytics_November_2026.xlsx"]


@pytest.mark.skipif(not all(p.exists() for p in ROSTERS), reason="real Analytics rosters not present")
def test_real_rosters_give_the_team_and_a_usual_shift_each():
    people = read_analytics_people(ROSTERS)
    assert len(people) >= 10
    with_usual = [p for p in people if p.usual_shift]
    assert len(with_usual) >= 10
    assert Counter(p.usual_shift for p in with_usual)["S4"] >= 1  # the Mexico colleague


@pytest.mark.skipif(not CONFIG.exists(), reason="real analytics config not present")
def test_real_plan_fills_34_of_34_with_every_rule_passing():
    config = load_analytics_config(CONFIG)
    assert len(config.slots) == 34 and len(config.ist_slots) == 30 and len(config.mexico_slots) == 4
    plan = solve_analytics_plan(config)
    assert plan.ok, plan.problems
    assert plan.plan_hash == solve_analytics_plan(config).plan_hash  # deterministic
    assert len(plan.assignments) == 34
    dist = sorted(Counter(plan.counts.values()).items())
    print("slot-count distribution (slots: people):", dist, "on-call days:", sorted(plan.on_call_counts.values()))
    print("notes:", len(plan.notes), "preference tallies:", plan.metrics)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "Analytics_Winter_Coverage_Dec25-Jan1.xlsx"
    built = build_analytics_workbook(config, plan, out)
    assert built.formula_check.ok and built.formula_check.formula_count > 150

    audit = audit_analytics_plan(out, config)
    assert audit.ok, [f.rule for f in audit.errors]
    assert (audit.filled, audit.total_slots) == (34, 34)
    assert check_workbook_formulas(out).ok
    assert not diff_against_snapshot(out).changed
