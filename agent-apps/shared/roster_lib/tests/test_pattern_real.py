"""Back-test of the PATTERN rotation on the real 2026 roster (read-only; counts and rates only,
no names; skipped when the gitignored reference file is absent).

For each 2-month cycle of 2026 the cycle is regenerated from the cells BEFORE it only and
compared with the cells that are actually in the roster, for the two groups whose weeks follow a
periodic template: Device Support (column-A serials 36-38: a three-person weekend duty with Sunday
on-call and a six-weekly swap of two weekday shifts) and CMS 2.0 (serials 43-44: alternating
on-call weekends). Leave cells (P, T, SL, HOL, COMP) and the December Disconnect days are left out
of the comparison. The "old" rate is what the generic rotation did (PERMANENT / AUTO_SWAP
copy-forward of the modal code) with the categories the real config had before this change."""

from __future__ import annotations

import collections
from datetime import date
from pathlib import Path

import pytest

from roster_lib.checks import daterange, schedule_from_roster
from roster_lib.codes import is_leave_code, try_parse_code
from roster_lib.config import Person, Rotation, RotationConfig
from roster_lib.cycles import cycle_for, cycles_in_year
from roster_lib.pattern_rotation import cell_token, plan_pattern_groups
from roster_lib.roster_io import load_roster
from roster_lib.rotation import MissingAnswers, rotate
from roster_lib.seed_config import suggest_pattern_groups

REAL = Path(__file__).resolve().parents[2] / "roster-reference" / "Shiftroster_Takeda_Redesigned_v2.xlsx"
needs_real = pytest.mark.skipif(not REAL.exists(), reason="real roster reference file not present")

DS, CMS = (36, 37, 38), (43, 44)
DISCONNECT = {d for d in daterange(date(2026, 12, 25), date(2027, 1, 1))}  # Dec Disconnect
OLD = {36: Rotation.AUTO_SWAP, 37: Rotation.AUTO_SWAP, 38: Rotation.PERMANENT,
       43: Rotation.PERMANENT, 44: Rotation.PERMANENT}


@pytest.fixture(scope="module")
def world():
    roster = load_roster(REAL)
    return roster, schedule_from_roster(roster), {i + 1: p for i, p in enumerate(roster.people)}


def _leave(text: str) -> bool:
    parsed = try_parse_code(text or "")
    return parsed is not None and is_leave_code(parsed.canonical)


def _score(names, cycle, actual, predicted):
    last = min(cycle.end, date(2027, 1, 1))
    total = matched = exact = 0
    kinds: collections.Counter = collections.Counter()
    for n in names:
        for d in daterange(cycle.start, last):
            a = actual[n][d]
            if _leave(a) or d in DISCONNECT:
                continue
            total += 1
            p = predicted[n].get(d, "")
            ta, tp = cell_token(a), cell_token(p)
            matched += ta == tp
            exact += a.strip() == p.strip()
            if ta != tp:
                kinds["missing OC" if ta == "OC" else "spurious OC" if tp == "OC"
                      else "missing work" if ta and not tp else "spurious work" if tp and not ta
                      else "code differs"] += 1
    return total, matched / total, exact / total, kinds


def backtest(world, serials, cycle, *, new_config_kwargs=None):
    roster, sched, by = world
    names = [by[s].name for s in serials]
    group = "g"
    cfg_new = RotationConfig()
    for s in serials:
        cfg_new.add_person(Person(by[s].name, "Operate", "Hyd", Rotation.PATTERN,
                                  subteam=by[s].section, pattern_group=group))
    for k, v in (new_config_kwargs or {}).items():
        setattr(cfg_new, k, v)
    hist = {n: {d: t for d, t in sched[n].items() if d < cycle.start} for n in names}
    last = min(cycle.end, roster.last_date)
    actual = {n: {d: sched[n][d] for d in daterange(cycle.start, last)} for n in names}
    plan = plan_pattern_groups(cfg_new, names, hist, cycle)[group]
    cfg_old = RotationConfig()
    for s in serials:
        cfg_old.add_person(Person(by[s].name, "Operate", "Hyd", OLD[s], subteam=by[s].section))
    out = {"detected": plan.detected, "period": plan.detection.period, "old": None}
    try:  # a person without any history (a new joiner) cannot be rotated by the old logic either
        old = rotate(hist, cfg_old, cycle, {}, people=[by[s] for s in serials]).schedule
        out["old"] = _score(names, cycle, actual, old)
    except MissingAnswers:
        pass
    if plan.detected:
        out["new"] = _score(names, cycle, actual, plan.rows())
    return out


@needs_real
def test_groups_are_found_from_the_data(world):
    roster, sched, by = world
    found = suggest_pattern_groups(sched, roster.people, last_date=roster.last_date)
    by_members = {tuple(sorted(i for i, p in by.items() if p.name in g["members"])): g
                  for g in found}
    assert set(by_members) == {DS, CMS}
    assert by_members[DS]["detected"] and by_members[DS]["period_weeks"] == 36
    assert by_members[DS]["duty_members"] == 3 and by_members[DS]["duty_period_weeks"] == 9
    assert by_members[CMS]["detected"] and by_members[CMS]["period_weeks"] == 2
    assert by_members[CMS]["duty_members"] == 2


@needs_real
def test_cms_on_call_weekends_back_test(world):
    results = {c.label: backtest(world, CMS, c) for c in cycles_in_year(2026)}
    results["Dec 2026"] = backtest(world, CMS, cycle_for(2026, 12))
    # Feb 2026: only 4 whole weeks of history: not detected (asked, never guessed)
    assert not results["Feb 2026"]["detected"] and results["Feb 2026"]["old"] is None
    for label in ("Apr 2026", "Jun 2026", "Aug 2026", "Oct 2026", "Dec 2026"):
        r = results[label]
        assert r["detected"] and r["period"] == 2, label
        total, token_rate, exact_rate, kinds = r["new"]
        old_total, old_rate, _, old_kinds = r["old"]
        assert total == old_total and total >= 50
        assert token_rate >= (0.95 if label == "Apr 2026" else 0.98), (label, token_rate)
        assert exact_rate == token_rate  # the raw on-call text matches too
        assert old_rate < 0.9 and set(old_kinds) == {"missing OC"}  # the old rotation dropped them
        assert token_rate - old_rate >= 0.09
    # April is the learning edge: the second person joined mid-March (3 weeks of history)
    assert results["Apr 2026"]["new"][3] == {"missing OC": 5}
    for label in ("Jun 2026", "Aug 2026", "Oct 2026", "Dec 2026"):
        assert results[label]["new"][1] == 1.0


@needs_real
def test_device_support_weekend_rotation_back_test(world):
    results = {c.label: backtest(world, DS, c) for c in cycles_in_year(2026)}
    # needs 36 weeks + 6 weeks of overlap in the file: only the Dec 2026 cycle can be proven
    # from history alone; every earlier cycle is "not detected" (asked, never guessed) and the
    # old copy-forward is what they would have got
    for label in ("Feb 2026", "Apr 2026", "Jun 2026", "Aug 2026", "Oct 2026"):
        assert not results[label]["detected"], label
        assert results[label]["old"][1] < 0.65 and "missing OC" in results[label]["old"][3]
    dec = backtest(world, DS, cycle_for(2026, 12))
    assert dec["detected"] and dec["period"] == 36
    total, rate, exact, kinds = dec["new"]
    assert total == 78 and rate >= 0.98 and exact == rate and not kinds
    assert dec["old"][1] < 0.5  # 44%: copy-forward loses the weekend duty and the swaps
    # with the 36-week period given in the config (what the PMO's rule implies) and a 90% bar,
    # the Oct 2026 cycle (39 weeks of history, 3 weeks of overlap) is predictable too
    oct_ = backtest(world, DS, cycle_for(2026, 10), new_config_kwargs={
        "pattern_min_confidence": 0.9, "pattern_groups": {"g": {"period_weeks": 36}}})
    assert oct_["detected"] and oct_["period"] == 36
    assert oct_["new"][0] == 165 and oct_["new"][1] >= 0.98
    assert oct_["old"][1] < 0.6
