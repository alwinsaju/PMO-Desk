"""diff_draft.py: what the PMO changed in the two saved drafts, and what blocks the confirm gate."""

import json

import openpyxl
from _common import sha256_file
from helpers import (breaking_main_edit, double_slot_analytics_edit, load, main_plan, safe_analytics_swap,
                     safe_main_edit, wrong_shift_edit)


def kinds(diff):
    return sorted({b["kind"] for b in diff["blocking"]})


def run_diff(p, capsys=None):
    assert p.diff() == 0
    return p.diff_json()


def test_untouched_drafts_have_no_changes_and_nothing_blocking(draft_world):
    p = draft_world
    d = run_diff(p)
    assert d["changes"] == [] and d["outside_changes"] == [] and d["blocking"] == []
    assert d["cycle"] == d["window"] == "2026-12-25..2027-01-01"
    assert d["flags"]["new"] == [] and d["flags"]["resolved"] == []
    assert d["flags"]["remaining"] > 0 and d["flags"]["not_rechecked"] == 3  # the 3 input warnings
    assert d["recheck_ran"] is True and set(d["audits"]) == {"main", "analytics"}
    assert d["counts"]["snapshot_cells"] == 184 and d["counts"]["analytics_snapshot_rows"] == 42
    assert d["snapshot_sources"] == {"main": "sheet", "analytics": "sheet"}
    # both file hashes are recorded for finalize
    assert d["saved_drafts"]["main"] == {"name": p.main_draft().name, "sha256": sha256_file(p.main_draft())}
    assert d["saved_drafts"]["analytics"]["sha256"] == sha256_file(p.analytics_draft())
    assert d["saved_draft_sha256"] == d["saved_drafts"]["main"]["sha256"]


def test_valid_edits_in_both_workbooks_are_listed_and_do_not_block(draft_world, capsys):
    p = draft_world
    main_edit, (person, day) = safe_main_edit(p)
    swap, (sd, la, na, lb, nb) = safe_analytics_swap(p)
    _, _, usual = main_plan(p)
    p.edit_main(main_edit)
    p.edit_analytics(swap)
    capsys.readouterr()
    d = run_diff(p)
    out = capsys.readouterr().out
    assert d["blocking"] == [], d["blocking"]
    main_rows = [c for c in d["changes"] if not c["person"].startswith("Analytics ")]
    an_rows = [c for c in d["changes"] if c["person"].startswith("Analytics ")]
    assert main_rows == [{"person": person, "date": day.isoformat(), "before": "", "after": usual[person]}]
    assert sorted(an_rows, key=lambda c: c["person"]) == sorted(
        [{"person": f"Analytics {la}", "date": sd.isoformat(), "before": na, "after": nb},
         {"person": f"Analytics {lb}", "date": sd.isoformat(), "before": nb, "after": na}],
        key=lambda c: c["person"])
    assert d["counts"]["main_changes"] == 1 and d["counts"]["analytics_changes"] == 2
    # logs: counts and kinds only
    assert "1 change(s) in the main plan, 2 in the Analytics plan" in out
    assert person not in out and na not in out


def test_every_change_row_has_exactly_the_contract_keys(draft_world):
    p = draft_world
    p.edit_main(safe_main_edit(p)[0])
    d = run_diff(p)
    assert all(set(c) == {"person", "date", "before", "after"} for c in d["changes"])
    assert all(set(b) == {"kind", "message"} for b in d["blocking"])
    assert all({"severity", "kind", "message"} <= set(i) for i in d["issues"])


def test_a_rule_breaking_main_edit_blocks_with_a_winter_kind(draft_world, capsys):
    p = draft_world
    edit, (person, day) = breaking_main_edit(p)
    p.edit_main(edit)
    capsys.readouterr()
    d = run_diff(p)
    assert "WINTER_DAYS_BELOW_MIN" in kinds(d)
    blocking = next(b for b in d["blocking"] if b["kind"] == "WINTER_DAYS_BELOW_MIN")
    assert blocking["message"].startswith("[Main] ") and person in blocking["message"]
    assert [f["kind"] for f in d["flags"]["new"] if f["severity"] == "error"].count("WINTER_DAYS_BELOW_MIN") == 1
    out = capsys.readouterr().out
    assert "BLOCKING: WINTER_DAYS_BELOW_MIN" in out and person not in out


def test_a_shift_that_is_not_the_usual_one_blocks(draft_world):
    p = draft_world
    edit, (person, day, usual, other) = wrong_shift_edit(p)
    p.edit_main(edit)
    d = run_diff(p)
    assert "WINTER_SHIFT_NOT_USUAL" in kinds(d)
    assert {"person": person, "date": day.isoformat(), "before": usual, "after": other} in d["changes"]


def test_a_rule_breaking_analytics_edit_blocks_with_an_analytics_kind(draft_world):
    p = draft_world
    edit, (day, label, person) = double_slot_analytics_edit(p)
    p.edit_analytics(edit)
    d = run_diff(p)
    assert "ANALYTICS_DOUBLE_SLOT" in kinds(d)
    assert all(b["message"].startswith("[Analytics] ") for b in d["blocking"] if b["kind"].startswith("ANALYTICS_"))
    assert any(c["person"] == f"Analytics {label}" and c["after"] == person for c in d["changes"])
    assert any(f["kind"].startswith("ANALYTICS_") for f in d["flags"]["new"])


def test_an_extra_day_within_the_limit_is_a_change_but_not_a_block(draft_world):
    p = draft_world
    cells, team, usual = main_plan(p)
    # a 4-day person works a 5th day on their usual shift: allowed (max 5), nothing blocks
    name = next(n for n, days in sorted(cells.items()) if len(days) == 4)
    all_days = sorted({d for days in cells.values() for d in days})
    day = next(d for d in all_days if d not in cells[name])
    p.edit_main({(name, day): usual[name]})
    d = run_diff(p)
    assert d["blocking"] == [] and len(d["changes"]) == 1


def test_resolved_and_new_flags_compare_audit_findings_only(draft_world):
    p = draft_world
    flags = load(p.paths.flags)
    stale = {"key": "WINTER_NOT_ANY_MORE|main|||2026-12-25|", "severity": "warning",
             "kind": "WINTER_NOT_ANY_MORE", "person": None, "date": "2026-12-25", "team": None,
             "message": "[Main] a warning the audit no longer reports", "plan": "main", "source": "audit"}
    flags["flags"].append(stale)
    p.paths.flags.write_text(json.dumps(flags), encoding="utf-8")
    d = run_diff(p)
    assert [f["kind"] for f in d["flags"]["resolved"]] == ["WINTER_NOT_ANY_MORE"]
    assert d["flags"]["new"] == []


# ---- blocking: missing, unreadable, tampered ----------------------------------------------------------

def test_missing_drafts_block_but_the_script_still_succeeds(draft_world):
    p = draft_world
    p.main_draft().unlink()
    d = run_diff(p)
    assert kinds(d) == ["DRAFT_MISSING"] and d["saved_drafts"]["main"]["sha256"] is None
    assert d["recheck_ran"] is False
    p.analytics_draft().unlink()
    d = run_diff(p)
    assert len([b for b in d["blocking"] if b["kind"] == "DRAFT_MISSING"]) == 2


def test_a_file_that_is_not_a_workbook_blocks(draft_world):
    p = draft_world
    p.main_draft().write_bytes(b"this is not an xlsx")
    p.analytics_draft().write_bytes(b"neither is this")
    d = run_diff(p)
    assert kinds(d) == ["DRAFT_UNREADABLE"] and len(d["blocking"]) == 2


def tamper_sidecar(path, mutate):
    side = path.with_name(path.name + ".snapshot.json")
    data = json.loads(side.read_text(encoding="utf-8"))
    mutate(data)
    side.write_text(json.dumps(data), encoding="utf-8")


def test_a_tampered_main_sidecar_blocks(draft_world):
    p = draft_world
    tamper_sidecar(p.main_draft(), lambda d: d["cells"][0].__setitem__(2, "Shift-9"))
    assert kinds(run_diff(p)) == ["SNAPSHOT_TAMPERED"]


def test_a_tampered_analytics_sidecar_blocks(draft_world):
    p = draft_world
    tamper_sidecar(p.analytics_draft(), lambda d: d["rows"][0].__setitem__(6, "Someone Else"))
    assert "SNAPSHOT_TAMPERED" in kinds(run_diff(p))


def test_a_tampered_hidden_sheet_blocks(draft_world):
    p = draft_world
    wb = openpyxl.load_workbook(p.main_draft())
    ws = wb["_snapshot"]
    row = next(r for r in range(1, ws.max_row + 1) if ws.cell(r, 2).value == "2026-12-25")
    ws.cell(row, 3).value = "Shift-5"
    wb.save(p.main_draft())
    assert kinds(run_diff(p)) == ["SNAPSHOT_TAMPERED"]


def test_a_snapshot_that_does_not_match_plan_json_blocks(draft_world):
    p = draft_world
    plan = json.loads(p.paths.plan.read_text(encoding="utf-8"))
    plan["cells"].pop()
    p.paths.plan.write_text(json.dumps(plan), encoding="utf-8")
    assert {"PLAN_CHANGED", "SNAPSHOT_TAMPERED"} <= set(kinds(run_diff(p)))


def test_removing_the_hidden_sheet_falls_back_to_the_sidecar_with_a_warning(draft_world):
    p = draft_world
    for path in (p.main_draft(), p.analytics_draft()):
        wb = openpyxl.load_workbook(path)
        del wb["_snapshot"]
        wb.save(path)
    d = run_diff(p)
    assert d["blocking"] == [] and d["snapshot_sources"] == {"main": "sidecar", "analytics": "sidecar"}
    assert [i["kind"] for i in d["issues"]].count("SNAPSHOT_SHEET_MISSING") == 2


def test_no_snapshot_at_all_blocks(draft_world):
    p = draft_world
    for path in (p.main_draft(), p.analytics_draft()):
        wb = openpyxl.load_workbook(path)
        del wb["_snapshot"]
        wb.save(path)
        path.with_name(path.name + ".snapshot.json").unlink()
    assert kinds(run_diff(p)) == ["SNAPSHOT_MISSING"]


def test_a_missing_person_row_blocks(draft_world):
    p = draft_world
    cells, team, usual = main_plan(p)
    person = sorted(cells)[0]
    wb = openpyxl.load_workbook(p.main_draft())
    ws = wb["Winter Plan"]
    row = next(r for r in range(1, ws.max_row + 1) if ws.cell(r, 2).value == person)
    ws.cell(row, 2).value = None
    wb.save(p.main_draft())
    d = run_diff(p)
    assert "PERSON_MISSING" in kinds(d)
    assert sum(1 for c in d["changes"] if c["person"] == person and c["after"] == "") == len(cells[person])


def test_a_renamed_person_blocks_and_the_new_name_is_reported(draft_world):
    p = draft_world
    cells, team, usual = main_plan(p)
    person = sorted(cells)[0]
    wb = openpyxl.load_workbook(p.main_draft())
    ws = wb["Winter Plan"]
    row = next(r for r in range(1, ws.max_row + 1) if ws.cell(r, 2).value == person)
    ws.cell(row, 2).value = "Somebody New"
    wb.save(p.main_draft())
    d = run_diff(p)
    assert {"PERSON_MISSING", "WINTER_UNKNOWN_PERSON"} <= set(kinds(d))
    assert [i for i in d["issues"] if i["kind"] == "PERSON_ADDED" and i["severity"] == "warning"]
    assert any(c["person"] == "Somebody New" and c["before"] == "" for c in d["changes"])


def test_a_changed_input_blocks(draft_world):
    p = draft_world
    p.paths.roster.write_bytes(p.paths.roster.read_bytes() + b"0")
    d = run_diff(p)
    assert kinds(d) == ["INPUT_CHANGED"] and "the shift roster changed" in d["blocking"][0]["message"]


def test_a_changed_effective_config_blocks(draft_world):
    p = draft_world
    eff = json.loads(p.paths.winter_effective.read_text(encoding="utf-8"))
    eff["solver"]["seed"] = 1
    p.paths.winter_effective.write_text(json.dumps(eff), encoding="utf-8")
    assert "CONFIG_CHANGED" in kinds(run_diff(p))


# ---- cannot compare at all ---------------------------------------------------------------------------------

def test_a_failed_comparison_removes_the_previous_diff(draft_world, capsys):
    p = draft_world
    assert p.diff() == 0 and p.paths.diff.exists()
    p.paths.plan.unlink()
    assert p.diff() == 1
    assert not p.paths.diff.exists()
    assert capsys.readouterr().err.startswith("ERROR: the plan is missing")


def test_without_the_draft_record_there_is_nothing_to_compare(draft_world, capsys):
    p = draft_world
    p.paths.meta.unlink()
    assert p.diff() == 1
    assert "draft record" in capsys.readouterr().err


def test_the_drafts_are_only_read(draft_world):
    p = draft_world
    p.edit_main(safe_main_edit(p)[0])
    before = (sha256_file(p.main_draft()), sha256_file(p.analytics_draft()), sha256_file(p.paths.roster))
    assert p.diff() == 0 and p.diff() == 0
    assert before == (sha256_file(p.main_draft()), sha256_file(p.analytics_draft()), sha256_file(p.paths.roster))
