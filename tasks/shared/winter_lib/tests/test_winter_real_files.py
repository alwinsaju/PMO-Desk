"""Acceptance run on the real reference files (skipped when they are absent). Asserts COUNTS only; the real
workbook is written to the gitignored output folder and never inspected here by name."""

import json
import os
from collections import Counter
from pathlib import Path

import pytest

from formula_eval import Evaluator
from winter_lib import winter_build as wbld
from winter_lib.winter_audit import audit_winter_plan
from winter_lib.winter_config import load_config, parse_config
from winter_lib.winter_plan import WinterPlan
from winter_testkit import example_dict

SHARED = Path(__file__).resolve().parents[2]
REF = SHARED / "roster-reference"
STAFF = REF / "PDT Staff Roster.xlsx"
ROSTER = REF / "Shiftroster_Takeda_Redesigned_v2.xlsx"
OUT_DIR = SHARED.parent / "december-disconnect" / "output"
REAL_CONFIG = SHARED.parent / "december-disconnect" / "config" / "winter-config.json"

pytestmark = pytest.mark.skipif(not (STAFF.exists() and ROSTER.exists()), reason="real reference files not present")


def real_cfg():
    if REAL_CONFIG.exists():
        return load_config(REAL_CONFIG)
    d = example_dict()
    d["availability"], d["shift_overrides"], d["name_aliases"] = {}, {}, {}
    d["exclusions"] = {"team_patterns": ["Leadership", "Governance", "PMO", "Analytics"], "people": [], "name_patterns": []}
    d["default_new_person_shift"] = "S1"
    return parse_config(d)


@pytest.fixture(scope="module")
def built():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cfg = real_cfg()
    out = OUT_DIR / "winter-coverage-test-run.xlsx"
    res = wbld.build_winter_coverage(STAFF, ROSTER, cfg, out)
    return cfg, out, res


def test_real_plan_meets_every_rule(built):
    cfg, out, res = built
    plan = res.plan
    assert len(plan.window) == 8
    for team in ("DIS", "DEP"):
        assert min(plan.headcount(team, d) for d in plan.window) >= 2, team
    for team in ("CMS 2.0", "LNS 2.0", "Integration HUB"):
        assert min(plan.headcount(team, d) for d in plan.window) >= 1, team
    teams = {p.name: p.team for p in plan.people}
    hist = Counter()
    for p in plan.people:
        n = len(plan.days_of(p.name))
        hist[n] += 1
        assert 3 <= n <= 5, "every person works 3-5 days"
        if cfg.team(p.team).best_effort:
            assert n <= 3, "best-effort teams: no extra days"
    assert set(hist) <= {3, 4, 5}
    assert plan.run_info.success and not plan.run_info.fallback and not plan.run_info.time_limit_hit
    assert not [f for f in plan.findings if f.severity == "error"]
    # required-team extras only (CMS / LNS / HUB / DIS / DEP)
    extra_teams = {teams[p.name] for p in plan.people if len(plan.days_of(p.name)) > 3}
    assert extra_teams <= {t.name for t in cfg.teams if not t.best_effort}


def test_real_workbook_audit_and_formulas(built):
    cfg, out, res = built
    assert res.audit.ok, [f.message for f in res.audit.errors][:5]
    again = audit_winter_plan(out, cfg, roster_names=[p.name for p in res.plan.people])
    assert again.ok and again.summary["people"] == len(res.plan.people)
    ev = Evaluator(str(out))
    assert ev.check() == []
    assert ev.checked > 700


def test_real_run_is_deterministic(built):
    cfg, out, res = built
    out2 = OUT_DIR / "winter-coverage-test-run-2.xlsx"
    res2 = wbld.build_winter_coverage(STAFF, ROSTER, cfg, out2)
    assert res2.plan.to_json() == res.plan.to_json()
    assert res2.workbook.snapshot.digest() == res.workbook.snapshot.digest()
    for p in (out2, str(out2) + ".snapshot.json", str(out2) + ".plan.json"):
        os.remove(p)


def test_real_inputs_counts(built):
    cfg, out, res = built
    s = res.inputs.stats
    assert s["scheduled"] + s["needs_shift"] == len(res.plan.people)
    assert res.inputs.lookback == (cfg.lookback_range())
