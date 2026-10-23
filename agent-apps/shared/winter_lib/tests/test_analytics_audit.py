import warnings
from datetime import date

import openpyxl
import pytest

from analytics_fixtures import build_synthetic, edit_workbook
from winter_lib.analytics_audit import audit_analytics_plan, diff_against_snapshot


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    path = tmp_path_factory.mktemp("audit") / "analytics.xlsx"
    config, plan = build_synthetic(path)
    return path, config, plan


def rules(res, severity="error"):
    return sorted({f.rule for f in res.findings if f.severity == severity})


def pick(plan, *, person=None, date_=None, code=None, not_person=None):
    for a in plan.assignments:
        if person and a.person != person:
            continue
        if not_person and a.person == not_person:
            continue
        if date_ and a.date != date_:
            continue
        if code and a.code != code:
            continue
        return a
    raise AssertionError("no such assignment")


def test_clean_file_passes_with_no_errors(built):
    path, config, plan = built
    res = audit_analytics_plan(path, config)
    assert res.ok and res.errors == [] and res.warnings == []
    assert (res.filled, res.total_slots) == (34, 34)
    assert res.counts == plan.counts and res.on_call_counts == plan.on_call_counts
    assert res.on_call == plan.on_call
    assert res.summary().startswith("34 of 34 slots filled")


def test_exceptions_are_reported_as_info_not_errors(built):
    path, config, plan = built
    res = audit_analytics_plan(path, config)
    text = " ".join(f.message for f in res.infos)
    assert "5 slots" in text and "extra slot" in text
    assert "available Dec 28" in text
    assert res.to_dict()["ok"] is True


def test_blank_slot_is_flagged(built, tmp_path):
    path, config, plan = built
    a = pick(plan, person="Echo")
    res = audit_analytics_plan(edit_workbook(path, tmp_path / "e.xlsx", {(a.date, a.label): None}), config)
    assert not res.ok and res.filled == 33
    assert "filled" in rules(res)
    assert any("33" in f.message or a.label in f.where for f in res.by_rule("filled"))


def test_unknown_name_and_formula_text(built, tmp_path):
    path, config, plan = built
    a = pick(plan, person="Echo")
    res = audit_analytics_plan(edit_workbook(path, tmp_path / "e.xlsx", {(a.date, a.label): "Zed Nobody"}), config)
    assert "people_list" in rules(res) and "Zed Nobody" in res.by_rule("people_list")[0].message
    res = audit_analytics_plan(edit_workbook(path, tmp_path / "e2.xlsx", {(a.date, a.label): "=1+1"}), config)
    assert any("formula" in f.message for f in res.by_rule("people_list"))


def test_names_are_matched_loosely(built, tmp_path):
    path, config, plan = built
    a = pick(plan, person="Echo")
    b = pick(plan, person="Foxtrot")
    res = audit_analytics_plan(edit_workbook(path, tmp_path / "e.xlsx", {
        (a.date, a.label): "  echo   TESTER ", (b.date, b.label): "FOXTROT"}), config)
    assert res.ok, res.errors
    assert res.counts == plan.counts


def test_double_slot_and_count_changes(built, tmp_path):
    path, config, plan = built
    victim = pick(plan, date_=date(2026, 12, 26), code="S3")
    other = pick(plan, date_=date(2026, 12, 26), code="S1")
    # give the S3 slot to whoever already has the S1 slot that day
    res = audit_analytics_plan(edit_workbook(path, tmp_path / "e.xlsx",
                                             {(victim.date, victim.label): other.person}), config)
    assert "double_slot" in rules(res)
    assert any(other.person in f.message and "Dec 26" in f.message for f in res.by_rule("double_slot"))


def test_slot_on_own_on_call_day(built, tmp_path):
    path, config, plan = built
    d = date(2026, 12, 25)
    oc = plan.on_call[d]
    a = pick(plan, date_=d, code="S1")
    res = audit_analytics_plan(edit_workbook(path, tmp_path / "e.xlsx", {(a.date, a.label): oc}), config)
    assert "on_call_day" in rules(res)
    assert oc in res.by_rule("on_call_day")[0].message


def test_on_call_row_rules(built, tmp_path):
    path, config, plan = built
    d = date(2026, 12, 27)
    res = audit_analytics_plan(edit_workbook(path, tmp_path / "a.xlsx", {(d, "On call"): None}), config)
    assert "one_on_call" in rules(res)
    res = audit_analytics_plan(edit_workbook(path, tmp_path / "b.xlsx", {(d, "On call"): "Alpha"}), config)
    assert "roles" in rules(res) and "on_call_days" in rules(res)


def test_mexico_rules(built, tmp_path):
    path, config, plan = built
    s4 = pick(plan, code="S4")
    res = audit_analytics_plan(edit_workbook(path, tmp_path / "a.xlsx", {(s4.date, s4.label): "Alpha"}), config)
    assert "roles" in rules(res)
    ist = pick(plan, person="Echo")
    res = audit_analytics_plan(edit_workbook(path, tmp_path / "b.xlsx", {(ist.date, ist.label): "Juliet"}), config)
    assert "roles" in rules(res) and "slot_counts" in rules(res)


def test_availability(built, tmp_path):
    path, config, plan = built
    a = pick(plan, date_=date(2026, 12, 25), code="S1")
    res = audit_analytics_plan(edit_workbook(path, tmp_path / "e.xlsx", {(a.date, a.label): "Delta"}), config)
    assert "availability" in rules(res)
    assert "Delta" in res.by_rule("availability")[0].message and "Dec 25" in res.by_rule("availability")[0].message


def test_too_many_slots_for_one_person(built, tmp_path):
    path, config, plan = built
    changes = {}
    victims = [a for a in plan.assignments if a.person == "Alpha"][:2]
    others = [a for a in plan.assignments if a.person == "Bravo"]
    # Bravo takes two of Alpha's slots on days Bravo is free, so Bravo ends with 6
    free = [a for a in plan.assignments if a.person == "Alpha" and all(b.date != a.date for b in others)][:2]
    for a in free:
        changes[(a.date, a.label)] = "Bravo"
    res = audit_analytics_plan(edit_workbook(path, tmp_path / "e.xlsx", changes), config)
    msgs = " ".join(f.message for f in res.by_rule("slot_counts"))
    assert "Bravo works 6" in msgs and "at most 5" in msgs


def test_survives_column_and_row_insertion_and_resave(built, tmp_path):
    path, config, plan = built
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = openpyxl.load_workbook(path)
    ws = wb["Winter Roster"]
    for rng in list(ws.merged_cells.ranges):  # openpyxl does not move merged ranges when inserting
        ws.unmerge_cells(str(rng))
    ws.insert_cols(1)
    ws.insert_rows(1, 2)
    out = tmp_path / "moved.xlsx"
    wb.save(out)
    res = audit_analytics_plan(out, config)
    assert res.ok, res.errors
    assert (res.filled, res.total_slots) == (34, 34)


def test_missing_row_is_a_grid_error(built, tmp_path):
    path, config, plan = built
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = openpyxl.load_workbook(path)
    wb["Winter Roster"].delete_rows(5)  # first slot row of Dec 25
    out = tmp_path / "short.xlsx"
    wb.save(out)
    res = audit_analytics_plan(out, config)
    assert "grid" in rules(res) and not res.ok
    assert res.filled < 34


def test_cached_error_values_are_flagged(built, tmp_path):
    path, config, plan = built
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = openpyxl.load_workbook(path)
    wb["By Person"]["F7"].value = "#N/A"
    out = tmp_path / "err.xlsx"
    wb.save(out)
    res = audit_analytics_plan(out, config)
    assert "formula_errors" in rules(res)


def test_unreadable_files_report_instead_of_raising(tmp_path):
    from analytics_fixtures import synthetic_config
    config = synthetic_config()
    missing = audit_analytics_plan(tmp_path / "nope.xlsx", config)
    assert not missing.ok and rules(missing) == ["file"]
    junk = tmp_path / "junk.xlsx"
    junk.write_text("not a zip")
    assert rules(audit_analytics_plan(junk, config)) == ["file"]
    wb = openpyxl.Workbook()
    wb.active["A1"] = "hello"
    other = tmp_path / "other.xlsx"
    wb.save(other)
    assert rules(audit_analytics_plan(other, config)) == ["file"]


def test_diff_against_snapshot(built, tmp_path):
    path, config, plan = built
    d0 = diff_against_snapshot(path)
    assert d0.source == "sheet" and d0.changes == [] and d0.plan_hash == plan.plan_hash
    a = pick(plan, person="Echo")
    edited = edit_workbook(path, tmp_path / "e.xlsx", {(a.date, a.label): "Golf", (date(2026, 12, 26), "On call"): "Hotel"})
    d1 = diff_against_snapshot(edited)
    assert d1.changed
    by = {(c.date, c.slot): (c.was, c.now) for c in d1.changes}
    assert by[(a.date, a.label)] == ("Echo", "Golf")
    assert not d1.problems


def test_diff_falls_back_to_the_sidecar_when_the_sheet_is_gone(built, tmp_path):
    path, config, plan = built
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = openpyxl.load_workbook(path)
    del wb["_snapshot"]
    out = tmp_path / "nosheet.xlsx"
    wb.save(out)
    import shutil
    shutil.copyfile(str(path) + ".snapshot.json", str(out) + ".snapshot.json")
    d = diff_against_snapshot(out)
    assert d.source == "sidecar" and d.changes == []
    (tmp_path / "nosheet.xlsx.snapshot.json").unlink()
    d = diff_against_snapshot(out)
    assert d.source is None and d.problems
