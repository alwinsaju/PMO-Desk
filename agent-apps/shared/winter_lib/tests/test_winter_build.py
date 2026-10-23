import json
import os

import pytest

from formula_eval import Evaluator
from winter_lib import winter_build as wbld
from winter_lib.winter_audit import audit_winter_plan
from winter_lib.winter_plan import WinterPlan
from winter_lib.winter_snapshot import read_snapshot_sheet
from winter_testkit import make_sample_files
from winter_testkit import small_cfg as _small_cfg


def small_cfg(**kw):
    kw.setdefault("exclusions", {"team_patterns": ["Leadership", "Governance", "PMO", "Analytics"], "people": [],
                                 "name_patterns": []})
    return _small_cfg(**kw)



@pytest.fixture(scope="module")
def sample(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("sample")
    staff, roster, names = make_sample_files(tmp)
    return tmp, staff, roster, names


def test_needs_shift_people_must_be_answered_first(sample):
    tmp, staff, roster, names = sample
    with pytest.raises(wbld.NeedsShiftError) as e:
        wbld.build_winter_coverage(staff, roster, small_cfg(), tmp / "o.xlsx")
    assert {p.name for p in e.value.people} == set(names["Integration HUB"])
    assert not (tmp / "o.xlsx").exists()


def test_bad_answer_is_refused(sample):
    tmp, staff, roster, names = sample
    with pytest.raises(ValueError, match="not a working shift code"):
        wbld.build_winter_coverage(staff, roster, small_cfg(), tmp / "o.xlsx", shifts={names["Integration HUB"][0]: "HOL"})


def test_end_to_end_build_is_audited_and_consistent(sample):
    tmp, staff, roster, names = sample
    answers = {n: "Shift 1" for n in names["Integration HUB"]}
    out = tmp / "winter.xlsx"
    res = wbld.build_winter_coverage(staff, roster, small_cfg(), out, shifts=answers)
    assert res.audit.ok, [f.message for f in res.audit.errors]
    assert res.audit.summary["person_days"] == len(res.plan.cells)
    assert os.path.exists(res.plan_json_path) and os.path.exists(str(out) + ".snapshot.json")
    # the plan JSON round-trips and carries the same hash as the workbook's snapshot
    back = WinterPlan.from_json(open(res.plan_json_path, encoding="utf-8").read())
    assert back.plan_hash() == res.workbook.plan_hash == read_snapshot_sheet(out).meta["plan_hash"]
    assert Evaluator(str(out)).check() == []
    by = {p.name: p for p in res.plan.people}
    assert by[names["Integration HUB"][0]].shift_source == "answer" and by[names["Integration HUB"][0]].usual_shift == "S1"
    # excluded people never appear
    assert not any(n.startswith(("Gov", "Ana")) for n in by)


def test_default_shift_in_config_needs_no_answers(sample):
    tmp, staff, roster, names = sample
    cfg = small_cfg(default_new_person_shift="S2")
    res = wbld.build_winter_coverage(staff, roster, cfg, tmp / "d.xlsx")
    assert res.audit.ok
    assert {p.shift_source for p in res.plan.people if p.team == "Integration HUB"} == {"default"}
    assert [f for f in res.inputs.findings if f.code == "default_shift_used"]


def test_resolve_with_previous_plan_keeps_most_days(sample):
    tmp, staff, roster, names = sample
    cfg = small_cfg(default_new_person_shift="S2")
    first = wbld.build_winter_coverage(staff, roster, cfg, tmp / "p1.xlsx")
    victim = first.plan.people[0].name
    gone = first.plan.days_of(victim)[0]
    cfg2 = small_cfg(default_new_person_shift="S2", availability={victim: {"unavailable": [gone.isoformat()]}})
    second = wbld.build_winter_coverage(staff, roster, cfg2, tmp / "p2.xlsx", previous_plan=first.plan)
    assert second.audit.ok and second.plan.run_info.stability
    changed = len(set(first.plan.cells) ^ set(second.plan.cells))
    assert 1 <= changed <= 12
