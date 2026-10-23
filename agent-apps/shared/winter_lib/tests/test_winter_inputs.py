from datetime import date, timedelta

import pytest

from roster_lib.roster_io import load_roster
from winter_lib import winter_inputs as wi
from winter_lib.winter_config import parse_config
from winter_testkit import (WINDOW_START, constant, example_dict, make_config, make_shift_roster,
                            make_staff_roster)


def span(first, last, code, weekdays_only=True):
    out, d = {}, first
    while d <= last:
        if not weekdays_only or d.weekday() < 5:
            out[d] = code
        d += timedelta(days=1)
    return out


def merged(*parts):
    out = {}
    for p in parts:
        out.update(p)
    return out


LB_FIRST, LB_LAST = date(2026, 8, 25), date(2026, 12, 24)


@pytest.fixture
def files(tmp_path):
    placeholder = span(WINDOW_START, date(2027, 1, 1), "HOL", weekdays_only=False)
    sections = [
        ("L2", [
            ("Ann Alpha", "Hyderabad", "L2 DIS USI", merged(span(LB_FIRST, LB_LAST, "Shift-1"), placeholder)),
            ("Ben Bravo", "Pune", "Complaints", merged(span(LB_FIRST, date(2026, 9, 30), "Shift-1"),
                                                        span(date(2026, 10, 1), LB_LAST, "Shift-3"))),
            ("Cleo Charlie", "Mexico", "L2 DIS US", merged(span(LB_FIRST, LB_LAST, "US-CST"))),
            ("Dev Delta", "Bengaluru", "DIS USI", span(LB_FIRST, LB_LAST, "S2")),
            ("Edie Echo", "Chennai", "DIS USI", merged(span(date(2026, 1, 5), date(2026, 8, 20), "Shift-1"))),
        ]),
        ("DEP", [
            ("Fay Foxtrot", "Gurgaon", "Loyalty", span(LB_FIRST, LB_LAST, "11AM-8PM")),
            ("Gus Golf", "Kolkata", "DEP USI", merged(span(LB_FIRST, LB_LAST, "Shift-4"), {date(2026, 9, 1): "P"})),
        ]),
        ("Governance", [("Hal Hotel", "US", "Governance", span(LB_FIRST, LB_LAST, "Shift-1"))]),
        ("L N S 2.0", [("Ivy India", "Hyderabad", "LNS 2.0", span(LB_FIRST, LB_LAST, "Shift-2"))]),
        ("Unlisted", [("Jon Juliet", "Pune", "Unlisted", span(LB_FIRST, LB_LAST, "Shift-1"))]),
    ]
    roster = make_shift_roster(tmp_path / "shift.xlsx", sections)
    staff_rows = [
        ("DIS L2", "Ann Alpha", "L2", "Hyderabad", "India"),
        ("Complaints", "Ben Bravo", "Complaints", "Pune", "India"),
        ("DIS L2", "Cleo Charlie", "L2", "Mexico", "Mexico"),
        ("DIS", "Devan Delta", "L2", "Bengaluru", "India"),  # fuzzy: shift roster says "Dev Delta"
        ("DIS L2", "Edie Echo", "L2", "Chennai", "India"),  # no shift history in the lookback
        ("DEP", "Fay Foxtrot", "Loyalty", "Gurgaon", "India"),
        ("DEP", "Gus Golf", "L2", "Kolkata", "India"),
        ("DEP", "Kim Kilo", "L2", "Hyderabad", "India"),  # staff only, DEP
        ("Integration HUB", "Lee Lima", "L2", "Hyderabad", "India"),  # new person, no history
        ("LNS 2.0", "Ivy India", "L2", "Hyderabad", "India"),
        ("Analytics", "Mia Mike", "L2", "Pune", "India"),
        ("Leadership", "Ned November", "Tech M", "Hyderabad", "India"),
        ("PMO", "Oz Oscar", "PMO", "Hyderabad", "India"),
        ("SFMC", "Pat Papa", "SFMC", "Hyderabad", "India"),
        ("Unlisted", "Jonathan Juliet", "x", "Pune", "India"),
    ]
    staff = make_staff_roster(tmp_path / "staff.xlsx", staff_rows)
    return staff, roster


def cfg_with(**changes):
    d = example_dict()
    d["availability"], d["shift_overrides"], d["name_aliases"] = {}, {}, {}
    d["exclusions"] = {"team_patterns": ["Leadership", "Governance", "PMO", "Analytics"], "people": [],
                       "name_patterns": []}
    d.update(changes)
    return parse_config(d)


def test_read_staff_roster_detects_header_and_columns(files):
    staff, _ = files
    sr = wi.read_staff_roster(staff)
    assert sr.sheet_name == "Takeda PDT Operate Team" and sr.header_row == 1
    assert len(sr.rows) == 15
    r = next(x for x in sr.rows if x.name == "Ann Alpha")
    assert (r.team_label, r.secondary_label, r.city, r.country) == ("DIS L2", "L2", "Hyderabad", "India")
    assert r.roll_off == date(2026, 9, 26) and r.contract_end == date(2027, 3, 31)


def test_staff_roster_without_cached_full_name_uses_first_and_last(tmp_path):
    p = make_staff_roster(tmp_path / "s.xlsx", [("DEP", "Zed Zulu", "", "Pune", "India")], with_full_name=False)
    assert wi.read_staff_roster(p).rows[0].name == "Zed Zulu"


def test_staff_roster_header_not_on_first_row(tmp_path):
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Staff list"])
    ws.append([])
    ws.append(["Section", "First Name", "Last Name"])
    ws.append(["DEP", "Abe", "Able"])
    wb.save(tmp_path / "x.xlsx")
    r = wi.read_staff_roster(tmp_path / "x.xlsx")
    assert r.header_row == 3 and r.rows[0].name == "Abe Able" and r.rows[0].team_label == "DEP"


def test_staff_roster_without_header_raises(tmp_path):
    import openpyxl
    wb = openpyxl.Workbook()
    wb.active.append(["a", "b"])
    wb.save(tmp_path / "x.xlsx")
    with pytest.raises(wi.StaffRosterError):
        wi.read_staff_roster(tmp_path / "x.xlsx")


def test_usual_shift_is_modal_and_never_reads_the_window(files):
    _, roster_path = files
    r = load_roster(roster_path)
    ann = r.find("Ann Alpha")[0]
    code, counts, last = wi.usual_shift(r, ann, LB_FIRST, LB_LAST)
    assert code == "S1" and set(counts) == {"S1"}  # the window's HOL placeholders are not read
    ben = r.find("Ben Bravo")[0]
    assert wi.usual_shift(r, ben, LB_FIRST, LB_LAST)[0] == "S3"  # Oct 1 - Dec 24 outnumbers Aug 25 - Sep 30
    assert wi.usual_shift(r, r.find("Gus Golf")[0], LB_FIRST, LB_LAST)[0] == "S4"  # leave days do not count
    assert wi.usual_shift(r, r.find("Cleo Charlie")[0], LB_FIRST, LB_LAST)[0] == "US-CST"
    assert wi.usual_shift(r, r.find("Fay Foxtrot")[0], LB_FIRST, LB_LAST)[0] == "11AM-8PM"
    assert wi.usual_shift(r, r.find("Edie Echo")[0], LB_FIRST, LB_LAST)[0] is None


def test_usual_shift_tie_goes_to_the_most_recent(tmp_path):
    cells = merged(span(date(2026, 10, 5), date(2026, 10, 9), "Shift-1"), span(date(2026, 11, 2), date(2026, 11, 6), "Shift-3"))
    path = make_shift_roster(tmp_path / "t.xlsx", [("L2", [("Tia Tango", "Pune", "x", cells)])])
    r = load_roster(path)
    assert wi.usual_shift(r, r.people[0], LB_FIRST, LB_LAST)[0] == "S3"
    # a range ending before the later block sees only the earlier one
    assert wi.usual_shift(r, r.people[0], LB_FIRST, date(2026, 10, 31))[0] == "S1"


def test_usual_shift_range_outside_roster_raises(tmp_path):
    path = make_shift_roster(tmp_path / "t.xlsx", [("L2", [("Tia Tango", "Pune", "x", {})])], days=30)
    r = load_roster(path)
    with pytest.raises(ValueError):
        wi.usual_shift(r, r.people[0], date(2027, 1, 1), date(2027, 2, 1))


def test_build_inputs_end_to_end(files):
    staff, roster = files
    res = wi.build_inputs(staff, roster, cfg_with())
    by = {p.name: p for p in res.people}
    ann = by["Ann Alpha"]
    assert (ann.team, ann.usual_shift, ann.location, ann.shift_source) == ("DIS", "S1", "Hyd", "history")
    assert by["Ben Bravo"].subteam == "Complaints" and by["Ben Bravo"].usual_shift == "S3"
    assert by["Cleo Charlie"].location == "Mex" and by["Cleo Charlie"].usual_shift == "US-CST"
    assert by["Fay Foxtrot"].team == "DEP" and by["Fay Foxtrot"].subteam == "Loyalty"
    assert by["Ivy India"].team == "LNS 2.0" and by["Ivy India"].usual_shift == "S2"
    # fuzzy match: the shift-roster spelling is used, the staff spelling kept
    assert "Dev Delta" in by and by["Dev Delta"].staff_name == "Devan Delta" and by["Dev Delta"].usual_shift == "S2"
    # new people -> needs_shift
    ns = {p.name: p for p in res.needs_shift}
    assert set(ns) == {"Edie Echo", "Kim Kilo", "Lee Lima"}
    assert ns["Lee Lima"].team == "Integration HUB" and ns["Lee Lima"].usual_shift is None
    # excluded
    ex = {e.name for e in res.excluded}
    assert {"Mia Mike", "Ned November", "Oz Oscar", "Hal Hotel"} <= ex
    assert "Mia Mike" not in by and "Hal Hotel" not in by
    assert sorted(res.unmapped) == ["Jonathan Juliet", "Pat Papa"]
    assert res.lookback == (LB_FIRST, LB_LAST)


def test_build_inputs_warnings_cover_both_directions(files):
    staff, roster = files
    res = wi.build_inputs(staff, roster, cfg_with())
    codes_ = [f.code for f in res.findings]
    assert codes_.count("name_fuzzy") == 1
    assert codes_.count("needs_shift") == 3
    assert "unmapped_team" in codes_
    staff_only = {f.person for f in res.findings if f.code == "staff_not_on_shift_roster"}
    assert {"Kim Kilo", "Lee Lima", "Pat Papa"} <= staff_only
    assert "Mia Mike" not in staff_only and "Ned November" not in staff_only  # excluded: not "missing"
    shift_only = {f.person for f in res.findings if f.code == "shift_roster_not_on_staff"}
    assert shift_only == {"Jon Juliet"}  # fuzzy "Jonathan Juliet" is not close enough and sits in an unlisted section
    assert res.stats["scheduled"] == len(res.people)


def test_name_alias_resolves_a_spelling_difference(files):
    staff, roster = files
    res = wi.build_inputs(staff, roster, cfg_with(name_aliases={"Devan Delta": "Dev Delta"}))
    assert res.stats["alias"] == 1 and res.stats["fuzzy"] == 0


def test_shift_override_and_default_new_person_shift(files):
    staff, roster = files
    res = wi.build_inputs(staff, roster, cfg_with(shift_overrides={"Lee Lima": "Shift 4"}))
    by = {p.name: p for p in res.people}
    assert by["Lee Lima"].usual_shift == "S4" and by["Lee Lima"].shift_source == "override"
    res = wi.build_inputs(staff, roster, cfg_with(default_new_person_shift="S1"))
    assert not res.needs_shift
    by = {p.name: p for p in res.people}
    assert by["Kim Kilo"].usual_shift == "S1" and by["Kim Kilo"].shift_source == "default"
    assert [f.code for f in res.findings].count("default_shift_used") == 3


def test_excluded_by_person_and_pattern(files):
    staff, roster = files
    res = wi.build_inputs(staff, roster, cfg_with(exclusions={
        "team_patterns": ["Leadership", "Governance", "PMO", "Analytics"], "people": ["ann alpha"],
        "name_patterns": ["Kilo"]}))
    names = {p.name for p in res.people + res.needs_shift}
    assert "Ann Alpha" not in names and "Kim Kilo" not in names
    assert {"Ann Alpha", "Kim Kilo"} <= {e.name for e in res.excluded}


def test_include_shift_roster_only(files):
    staff, roster = files
    res = wi.build_inputs(staff, roster, cfg_with(include_shift_roster_only=True,
                                                  staff_team_map={"DIS L2": "DIS", "DIS": "DIS", "Complaints": "DIS",
                                                                  "DEP": "DEP"}))
    # Jon Juliet sits in an unlisted section: reported unmapped, still not scheduled
    assert "Jon Juliet" in res.unmapped


def test_roll_off_column_does_not_exclude(files):
    staff, roster = files
    res = wi.build_inputs(staff, roster, cfg_with())
    assert all(s.roll_off == date(2026, 9, 26) for s in wi.read_staff_roster(staff).rows)
    assert any(p.name == "Ann Alpha" for p in res.people)


def test_people_are_ordered_by_team_then_roster_row(files):
    staff, roster = files
    res = wi.build_inputs(staff, roster, cfg_with())
    teams = [p.team for p in res.people]
    order = [t.name for t in make_config().teams]
    assert teams == sorted(teams, key=order.index)
    dis = [p.name for p in res.people if p.team == "DIS"]
    assert dis == ["Ann Alpha", "Ben Bravo", "Cleo Charlie", "Dev Delta"]


def test_build_inputs_is_deterministic(files):
    staff, roster = files
    a = wi.build_inputs(staff, roster, cfg_with())
    b = wi.build_inputs(staff, roster, cfg_with())
    assert [p.to_dict() for p in a.people] == [p.to_dict() for p in b.people]
    assert [f.to_dict() for f in a.findings] == [f.to_dict() for f in b.findings]


def test_match_names_tiers():
    from roster_lib.roster_io import Person as RP
    S = lambda n: wi.StaffRow(n, "DIS", "", "", "", None, None, 1)
    R = lambda n: RP(n, "Hyd", "x", "DIS", 1)
    matches, so, sho = wi.match_names(
        [(S("Alice Wong"), "DIS"), (S("Bob Smith"), "DIS"), (S("Carla Mendez"), "DIS"), (S("Dana Lee"), "DIS"),
         (S("Zoe Xu"), "DEP")],
        [(R("Wong Alice"), "DIS"), (R("bob  smith"), "DIS"), (R("Carlos Mendez"), "DIS"), (R("D. Lee"), "DIS"),
         (R("Zoe Xu Q"), "DIS")],
        {})
    how = {m.staff.name: m.how for m in matches}
    assert how["Alice Wong"] == "words" and how["Bob Smith"] == "exact" and how["Carla Mendez"] == "fuzzy"
    assert "Zoe Xu" in {s.name for s in so}  # different team: never fuzzy-matched
    assert "Zoe Xu Q" in {p.name for p in sho}


def test_fuzzy_requires_a_unique_candidate():
    from roster_lib.roster_io import Person as RP
    S = lambda n: wi.StaffRow(n, "DIS", "", "", "", None, None, 1)
    R = lambda n: RP(n, "Hyd", "x", "DIS", 1)
    matches, so, sho = wi.match_names([(S("Sam Ray"), "DIS")], [(R("Sam Rey"), "DIS"), (R("Sam Roy"), "DIS")], {})
    assert not matches and len(so) == 1 and len(sho) == 2


def test_lookback_is_taken_from_config(tmp_path):
    cells = merged(span(date(2026, 8, 3), date(2026, 8, 7), "Shift-1"), span(date(2026, 11, 2), date(2026, 11, 3), "Shift-3"))
    path = make_shift_roster(tmp_path / "t.xlsx", [("L2", [("Tia Tango", "Pune", "x", cells)])])
    staff = make_staff_roster(tmp_path / "s.xlsx", [("DIS L2", "Tia Tango", "L2", "Pune", "India")])
    four = wi.build_inputs(staff, path, cfg_with())
    six = wi.build_inputs(staff, path, cfg_with(lookback_months=6))
    assert four.people[0].usual_shift == "S3" and six.people[0].usual_shift == "S1"
