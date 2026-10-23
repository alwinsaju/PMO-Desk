import datetime as dt
from datetime import date, timedelta

import openpyxl
import pytest

from roster_lib.codes import Pattern, works_on
from roster_lib.cycles import cycle_for
from roster_lib.pto import (
    PtoEntry,
    PtoImportError,
    apply_pto,
    match_names,
    parse_pto_rows,
    read_pto_workbook,
    shift_group_rule,
)
from roster_lib.pto_template import write_pto_template

AUG = cycle_for(2026, 8)  # Sun 2 Aug .. Sat 3 Oct 2026
MF, WS = Pattern.MON_FRI, Pattern.WED_SUN


def fill(pattern, text="Shift-1", cycle=AUG, overrides=None):
    cells, d = {}, cycle.start
    while d <= cycle.end:
        cells[d] = text if works_on(pattern, d) else ""
        d += timedelta(days=1)
    cells.update(overrides or {})
    return cells


def write_book(path, rows, sheet="PTO", header_at=1, header=("Name", "From", "To", "Code")):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet
    for _ in range(header_at - 1):
        ws.append(["EXAMPLE banner"])
    ws.append(list(header))
    for r in rows:
        ws.append(list(r))
    wb.create_sheet("Notes").append(["ignore me", "x", "y", "z"])
    wb.save(path)
    return path


# ---- reading --------------------------------------------------------------------

def test_reads_template_example(tmp_path):
    path = write_pto_template(tmp_path / "t.xlsx")
    entries = read_pto_workbook(path)
    assert [(e.name, e.code) for e in entries] == [
        ("Alice Test", "P"), ("Bob Sample", "P"), ("Carol Example", "P")]
    assert entries[0].start == date(2026, 12, 21) and entries[0].end == date(2026, 12, 25)
    assert entries[0].row == 3


def test_header_tolerant_dates_as_text_and_default_code(tmp_path):
    path = write_book(tmp_path / "p.xlsx", [
        ("  Zed   Test ", "03-Aug-2026", "2026-08-05", None),
        ("Amy Test", dt.datetime(2026, 8, 10), dt.date(2026, 8, 10), "sl"),
        ("Bo Test", "12/08/2026", "14/08/2026", "PTO"),
        (None, None, None, None),
    ], header_at=3, header=(" NAME ", "start date", "End", "leave code"))
    entries = read_pto_workbook(path)
    assert [(e.name, e.start, e.end, e.code) for e in entries] == [
        ("Zed Test", date(2026, 8, 3), date(2026, 8, 5), "P"),
        ("Amy Test", date(2026, 8, 10), date(2026, 8, 10), "SL"),
        ("Bo Test", date(2026, 8, 12), date(2026, 8, 14), "P")]


def test_bad_rows_reported_together_with_row_numbers(tmp_path):
    path = write_book(tmp_path / "p.xlsx", [
        ("Ok Test", "2026-08-03", "2026-08-04", "P"),
        ("Back Test", "2026-08-10", "2026-08-03", "P"),
        ("Hol Test", "2026-08-03", "2026-08-04", "HOL"),
        ("Odd Test", "2026-08-03", "2026-08-04", "zzz"),
        ("Date Test", "soon", "2026-08-04", "P"),
        ("", "2026-08-03", "2026-08-04", "P"),
        ("Shift Test", "2026-08-03", "2026-08-04", "Shift-1"),
    ])
    with pytest.raises(PtoImportError) as err:
        read_pto_workbook(path)
    text = "\n".join(err.value.problems)
    assert len(err.value.problems) == 6
    for row, needle in ((3, "before From"), (4, "HOL"), (5, "unknown code"), (6, "not a date"),
                        (7, "name is empty"), (8, "Shift-1")):
        assert f"row {row}:" in text and needle in text


def test_no_header_row():
    with pytest.raises(PtoImportError):
        parse_pto_rows([["a", "b"], ["c", "d"]])


def test_notes_sheet_ignored_when_no_pto_sheet(tmp_path):
    path = write_book(tmp_path / "p.xlsx", [("A Test", "2026-08-03", "2026-08-03", None)],
                      sheet="Requests")
    assert len(read_pto_workbook(path)) == 1


# ---- name matching --------------------------------------------------------------

ROSTER = ["Alice Test", "Bob Sample", "Carol Ann Example", "Dave Demo"]


def test_exact_is_silent_order_and_case_insensitive():
    r = match_names(["alice test", "Sample, Bob".replace(",", ""), "Dave  Demo"], ROSTER)
    assert r.exact == {"alice test": "Alice Test", "Sample Bob": "Bob Sample",
                       "Dave  Demo": "Dave Demo"}
    assert r.complete


def test_fuzzy_needs_confirmation_never_silent():
    r = match_names(["Alice Tset", "Carol Example", "Bob", "Dave Demmo", "Zed Nobody"], ROSTER)
    assert r.exact == {}
    assert [c.roster_name for c in r.needs_confirmation["Alice Tset"]] == ["Alice Test"]
    assert [c.roster_name for c in r.needs_confirmation["Carol Example"]] == ["Carol Ann Example"]
    assert [c.roster_name for c in r.needs_confirmation["Bob"]] == ["Bob Sample"]
    assert [c.roster_name for c in r.needs_confirmation["Dave Demmo"]] == ["Dave Demo"]
    assert r.unmatched == ["Zed Nobody"]
    assert not r.complete


def test_confirmed_pairs_become_exact_and_stale_confirmation_is_ignored():
    r = match_names(["Alice Tset", "Bob Smaple"], ROSTER,
                    {"alice tset": "Alice Test", "Bob Smaple": "Nobody Here"})
    assert r.exact == {"Alice Tset": "Alice Test"}
    assert r.via_confirmation == {"Alice Tset"}
    assert "Bob Smaple" in r.needs_confirmation


def test_ambiguous_exact_needs_confirmation():
    r = match_names(["Pat Twin"], ["Pat Twin", "twin PAT"])
    assert "Pat Twin" in r.needs_confirmation and not r.exact
    r = match_names(["Pat Twin"], ["Pat Twin", "twin PAT"], {"Pat Twin": "twin PAT"})
    assert r.exact == {"Pat Twin": "twin PAT"}


# ---- applying -------------------------------------------------------------------

def entry(name, start, end, code="P", row=3):
    return PtoEntry(name, start, end, code, row)


def test_pto_only_on_working_days_never_weekly_offs():
    sched = {"Alice Test": fill(MF), "Bob Sample": fill(WS, "Shift-2")}
    # Mon 10 Aug .. Sun 16 Aug
    res = apply_pto(sched, [entry("Alice Test", date(2026, 8, 10), date(2026, 8, 16)),
                            entry("Bob Sample", date(2026, 8, 10), date(2026, 8, 16))], AUG)
    alice = sorted(d for (n, d) in res.edits if n == "Alice Test")
    bob = sorted(d for (n, d) in res.edits if n == "Bob Sample")
    assert alice == [date(2026, 8, 10) + timedelta(i) for i in range(5)]  # Mon-Fri only
    assert bob == [date(2026, 8, 12) + timedelta(i) for i in range(5)]  # Wed-Sun only
    assert set(res.edits.values()) == {"P"}
    assert all(sched[n][d] for (n, d) in res.edits)  # every edit replaces a working cell


def test_pto_overwrites_hol_but_not_other_leave_and_range_over_weekend():
    sched = {"Alice Test": fill(MF, overrides={date(2026, 8, 12): "HOL", date(2026, 8, 13): "SL"})}
    res = apply_pto(sched, [entry("Alice Test", date(2026, 8, 12), date(2026, 8, 14), "T")], AUG)
    assert res.edits == {("Alice Test", date(2026, 8, 12)): "T",
                         ("Alice Test", date(2026, 8, 14)): "T"}
    assert any("already SL" in n for n in res.notes)


def test_out_of_cycle_ignored_with_note_and_partial_overlap_applies():
    sched = {"Alice Test": fill(MF)}
    res = apply_pto(sched, [entry("Alice Test", date(2026, 7, 1), date(2026, 7, 3)),
                            entry("Alice Test", date(2026, 7, 30), date(2026, 8, 4), row=4)], AUG)
    assert sorted(d for _, d in res.edits) == [date(2026, 8, 3), date(2026, 8, 4)]
    assert len(res.notes) == 1 and "outside Aug 2026" in res.notes[0] and "row 3" in res.notes[0]


def test_uncertain_names_skipped_until_confirmed():
    sched = {"Alice Test": fill(MF)}
    entries = [entry("Alice Tset", date(2026, 8, 10), date(2026, 8, 10)),
               entry("Zed Nobody", date(2026, 8, 10), date(2026, 8, 10), row=4)]
    res = apply_pto(sched, entries, AUG)
    assert res.edits == {} and len(res.skipped_entries) == 2
    assert "Alice Tset" in res.match.needs_confirmation and res.match.unmatched == ["Zed Nobody"]
    res = apply_pto(sched, entries, AUG, {"Alice Tset": "Alice Test"})
    assert res.edits == {("Alice Test", date(2026, 8, 10)): "P"}
    assert [e.name for e in res.skipped_entries] == ["Zed Nobody"]


def test_clash_on_swap_sunday_and_needed():
    sched = {"Alice Test": fill(WS, "Shift-2")}  # works the swap Sunday
    sun = AUG.rotation_sunday
    res = apply_pto(sched, [entry("Alice Test", sun, sun + timedelta(days=4))], AUG,
                    needed={("Alice Test", date(2026, 8, 6))})
    assert {(c.kind, c.date) for c in res.clashes} == {("SWAP_SUNDAY", sun),
                                                       ("NEEDED", date(2026, 8, 6))}
    assert ("Alice Test", sun) in res.edits  # still applied: reported, not blocked


def test_overlapping_entries_with_different_codes():
    sched = {"Alice Test": fill(MF)}
    res = apply_pto(sched, [entry("Alice Test", date(2026, 8, 10), date(2026, 8, 11), "P"),
                            entry("Alice Test", date(2026, 8, 11), date(2026, 8, 12), "SL", row=4)],
                    AUG)
    assert res.edits[("Alice Test", date(2026, 8, 11))] == "P"
    assert res.edits[("Alice Test", date(2026, 8, 12))] == "SL"
    assert [c.kind for c in res.clashes] == ["OVERLAP"]


def test_below_minimum_clash():
    sched = {n: fill(MF) for n in ("A Test", "B Test", "C Test")}
    sched["D Test"] = fill(MF, "Shift-3")
    team = {"A Test": "T1", "B Test": "T1", "C Test": "T1", "D Test": "T1"}
    rule = shift_group_rule(sched, team.get, lambda n: 2)
    day = date(2026, 8, 10)
    res = apply_pto(sched, [entry("A Test", day, day), entry("B Test", day, day, row=4)], AUG,
                    min_staff_for=rule)
    assert [(c.person, c.kind) for c in res.clashes] == [("A Test", "BELOW_MIN"),
                                                         ("B Test", "BELOW_MIN")]
    assert "1 left" in res.clashes[0].detail
    res = apply_pto(sched, [entry("A Test", day, day)], AUG, min_staff_for=rule)
    assert res.clashes == []  # still 2 working: at the minimum


def test_below_minimum_per_team_day_counts_all_shifts_with_the_effective_minimum():
    # 3 people on two shifts, minimum 2 per team per day: two PTO on one day -> 1 left < 2
    sched = {"A Test": fill(MF), "B Test": fill(MF), "C Test": fill(MF, "Shift-3")}
    team = dict.fromkeys(sched, "T1")
    rule = shift_group_rule(sched, team.get, lambda n: 2, lambda n: True)
    day = date(2026, 8, 10)
    res = apply_pto(sched, [entry("A Test", day, day)], AUG, min_staff_for=rule)
    assert res.clashes == []  # S3 alone would be short, but the team still has 2 working
    res = apply_pto(sched, [entry("A Test", day, day), entry("B Test", day, day, row=4)], AUG,
                    min_staff_for=rule)
    assert [(c.person, c.kind) for c in res.clashes] == [("A Test", "BELOW_MIN"),
                                                         ("B Test", "BELOW_MIN")]
    assert "1 left" in res.clashes[0].detail and "minimum 2" in res.clashes[0].detail
    per_shift = shift_group_rule(sched, team.get, lambda n: 2)  # default: per shift, as before
    res = apply_pto(sched, [entry("A Test", day, day)], AUG, min_staff_for=per_shift)
    assert [c.kind for c in res.clashes] == ["BELOW_MIN"]  # per shift: S1 drops to 1 < 2


def test_below_minimum_per_team_day_single_person_and_offset_patterns():
    # a one-person team: effective minimum 1, so PTO for them flags (they are the team)
    sched = {"Solo Test": fill(MF)}
    rule = shift_group_rule(sched, {"Solo Test": "T9"}.get, lambda n: 2, lambda n: True)
    day = date(2026, 8, 10)
    res = apply_pto(sched, [entry("Solo Test", day, day)], AUG, min_staff_for=rule)
    assert [c.kind for c in res.clashes] == ["BELOW_MIN"] and "minimum 1" in res.clashes[0].detail
    # Mon-Fri + Wed-Sun pair: on a Monday only the Mon-Fri person is scheduled -> minimum 1
    sched = {"A Test": fill(MF), "B Test": fill(WS, "Shift-2")}
    team = dict.fromkeys(sched, "T1")
    rule = shift_group_rule(sched, team.get, lambda n: 2, lambda n: True)
    sat = date(2026, 8, 15)
    res = apply_pto(sched, [entry("B Test", sat, sat)], AUG, min_staff_for=rule)
    assert [c.kind for c in res.clashes] == ["BELOW_MIN"] and "minimum 1" in res.clashes[0].detail
    assert [c for c in apply_pto(sched, [entry("A Test", date(2026, 8, 12),
                                               date(2026, 8, 12))], AUG,
                                 min_staff_for=rule).clashes] != []  # Wed: 2 scheduled, 1 left


def test_year_boundary_cycle_dates():
    dec = cycle_for(2026, 12)
    sched = {"Alice Test": fill(MF, cycle=dec)}
    res = apply_pto(sched, [entry("Alice Test", date(2026, 12, 28), date(2027, 1, 4))], dec)
    assert sorted(d for _, d in res.edits) == [
        date(2026, 12, 28), date(2026, 12, 29), date(2026, 12, 30), date(2026, 12, 31),
        date(2027, 1, 1), date(2027, 1, 4)]
