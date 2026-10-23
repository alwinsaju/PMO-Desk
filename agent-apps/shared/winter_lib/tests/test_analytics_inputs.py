from datetime import date, timedelta

import openpyxl
import pytest

from winter_lib.analytics_config import parse_analytics_config
from winter_lib.analytics_inputs import (
    AnalyticsRosterError, draft_config_dict, merge_readings, modal_shift, read_analytics_people,
    read_analytics_roster,
)

TEAM = {
    "Alpha Tester": ("Pune", ["S1"] * 6 + ["S2"] * 2 + ["O"]),
    "Bravo Tester": ("Hyderabad", ["S2"] * 5 + ["S3"] + ["P"] * 2),
    "Charlie Tester": ("Hyderabad", ["S3"] * 3 + ["S1"] * 3 + ["C"] + ["H"]),
    "Juliet Tester": ("Mexico", ["S4"] * 7),
}


def make_roster(path, *, month_start=date(2026, 11, 1), days=30, title="Schedule", offset=0,
                name_hdr="Resource Name", grade_hdr="Grade", with_dates=True, team=TEAM, extra_grade_row=True):
    wb = openpyxl.Workbook()
    master = wb.active
    master.title = "Master"
    master["B2"] = "Staff Roster"
    master["B7"], master["C7"] = "S1", "First Shift"
    ws = wb.create_sheet(title)
    ws["B2"] = "Shift Schedule"
    ws["C5"] = "Legends"
    first_day_col = 4
    hdr = 19 + offset
    if with_dates:
        for i in range(days):
            ws.cell(hdr - 7, first_day_col + i, month_start + timedelta(days=i))
    ws.cell(hdr - 1, 2, "S1 : First Shift")  # a summary-ish row above the table
    ws.cell(hdr, 1, "Location")
    ws.cell(hdr, 2, name_hdr)
    ws.cell(hdr, 3, grade_hdr)
    ws.cell(hdr, 4, "Shift Schedule")
    r = hdr + 1
    for name, (loc, codes) in team.items():
        ws.cell(r, 1, loc)
        ws.cell(r, 2, name)
        ws.cell(r, 3, "Analytics")
        for i, code in enumerate(codes):
            ws.cell(r, first_day_col + i, code)
        r += 1
    if extra_grade_row:
        ws.cell(r, 1, "Hyderabad")
        ws.cell(r, 2, "Lead Tester")
        ws.cell(r, 3, "Leadership")
        for i in range(10):
            ws.cell(r, first_day_col + i, "S2")
        r += 1
    ws.cell(r + 1, 2, "S1")  # summary rows have no grade
    for i in range(10):
        ws.cell(r + 1, first_day_col + i, 3)
    wb.save(path)
    return path


def test_modal_shift_rules():
    assert modal_shift({"S1": 3, "S2": 3, "S3": 1}) == "S1"  # tie: earlier code
    assert modal_shift({"S2": 1, "S3": 4, "S4": 20}) == "S3"  # S4 never beats S1-S3
    assert modal_shift({"S4": 5}) == "S4"
    assert modal_shift({}) is None


def test_reads_people_grade_filter_location_and_modal_shift(tmp_path):
    p = make_roster(tmp_path / "r.xlsx")
    rd = read_analytics_roster(p)
    assert rd.sheet == "Schedule"
    names = [x.name for x in rd.people]
    assert names == list(TEAM)  # the Leadership row and the summary rows are skipped
    by = {x.name: x for x in rd.people}
    assert by["Alpha Tester"].location == "Pune" and by["Alpha Tester"].usual_shift == "S1"
    assert by["Bravo Tester"].usual_shift == "S2"
    assert by["Charlie Tester"].usual_shift == "S1"  # 3 v 3 tie -> earlier code
    assert by["Charlie Tester"].on_call_days == 1  # bare "C"
    assert by["Juliet Tester"].usual_shift == "S4"
    assert not rd.warnings


def test_tolerant_to_header_wording_position_and_missing_date_row(tmp_path):
    p = make_roster(tmp_path / "r2.xlsx", title="Roster Nov", offset=6, name_hdr="Name", grade_hdr="Team",
                    with_dates=False)
    rd = read_analytics_roster(p)
    assert len(rd.people) == 4
    assert any("no date row" in w for w in rd.warnings)


def test_merge_over_two_months_sums_shifts(tmp_path):
    a = make_roster(tmp_path / "oct.xlsx")
    team2 = {"Alpha Tester": ("Pune", ["S2"] * 20), "Bravo Tester": ("Hyderabad", ["S2"] * 3)}
    b = make_roster(tmp_path / "nov.xlsx", team=team2)
    people = read_analytics_people([a, b])
    by = {x.name: x for x in people}
    assert by["Alpha Tester"].usual_shift == "S2"  # 6 S1 vs 22 S2 across both months
    assert by["Alpha Tester"].shifts["S1"] == 6
    assert "Charlie Tester" in by  # present in one month only
    assert len(merge_readings([read_analytics_roster(a)])) == 4


def test_not_a_roster_raises(tmp_path):
    wb = openpyxl.Workbook()
    wb.active["A1"] = "hello"
    p = tmp_path / "x.xlsx"
    wb.save(p)
    with pytest.raises(AnalyticsRosterError):
        read_analytics_roster(p)


def test_draft_config_dict_is_a_valid_config(tmp_path):
    people = read_analytics_people([make_roster(tmp_path / "r.xlsx")])
    cfg = draft_config_dict(
        people, window=("2026-12-25", "2027-01-01"),
        on_call=["Alpha Tester"], mexico=["Juliet Tester"],
        availability={"Bravo Tester": {"from": "2026-12-28", "to": "2026-12-30"}},
        short_names={"Alpha Tester": "Alpha"},
    )
    roles = {p["name"]: p["role"] for p in cfg["people"]}
    assert roles == {"Alpha Tester": "on_call", "Bravo Tester": "support", "Charlie Tester": "support",
                     "Juliet Tester": "mexico"}
    c = parse_analytics_config(cfg)
    assert c.person("Alpha").usual_shift == "S1"
    assert c.person("Bravo Tester").available is not None
    assert len(c.slots) == 34


def test_draft_config_unknown_name_fails_loudly(tmp_path):
    people = read_analytics_people([make_roster(tmp_path / "r.xlsx")])
    with pytest.raises(AnalyticsRosterError, match="not on the roster"):
        draft_config_dict(people, window=("2026-12-25", "2027-01-01"), on_call=["Nobody Here"])
