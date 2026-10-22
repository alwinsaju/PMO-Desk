from datetime import date, timedelta

import pytest

from roster_lib import cycles
from roster_lib.cycles import (
    Availability,
    Cycle,
    DateSpan,
    crosses_date,
    cycle_availability,
    cycle_containing,
    cycle_for,
    cycles_in_year,
    next_cycle,
    previous_cycle,
    rotation_sunday,
    split_at_year_boundary,
    weeks,
)

VECTORS = [
    (2026, 8, date(2026, 8, 2)),
    (2026, 10, date(2026, 10, 4)),
    (2026, 12, date(2026, 11, 29)),
    (2027, 2, date(2027, 1, 31)),
    (2027, 4, date(2027, 4, 4)),
    (2027, 6, date(2027, 5, 30)),
    (2027, 8, date(2027, 8, 1)),
    (2027, 10, date(2027, 10, 3)),
    (2027, 12, date(2027, 11, 28)),
]


@pytest.mark.parametrize("year,month,expected", VECTORS)
def test_rotation_sunday_vectors(year, month, expected):
    c = cycle_for(year, month)
    assert c.rotation_sunday == expected
    assert c.start == expected
    assert rotation_sunday(date(year, month, 1)) == expected


def test_dec_2026_cycle_end():
    c = cycle_for(2026, 12)
    assert c.end == date(2027, 1, 30)
    assert c.first_month == date(2026, 12, 1)
    assert c.label == "Dec 2026"


def test_no_legacy_exception_for_june_2026():
    # May 31 2026 is a Sunday -> last Sunday of May, by the plain rule.
    assert cycle_for(2026, 6).start == date(2026, 5, 31)


@pytest.mark.parametrize("last_weekday,expected_rule", [
    # Build a cycle month whose previous month ends on each weekday and check the rule.
    (0, "last"), (1, "last"), (6, "last"), (2, "first"), (3, "first"), (4, "first"), (5, "first"),
])
def test_rule_for_every_previous_month_end_weekday(last_weekday, expected_rule):
    found = {}
    for year in range(2020, 2045):
        for month in cycles.CYCLE_FIRST_MONTHS:
            first = date(year, month, 1)
            prev_end = first - timedelta(days=1)
            found.setdefault(prev_end.weekday(), (first, prev_end))
    first, prev_end = found[last_weekday]
    rot = rotation_sunday(first)
    assert rot.weekday() == 6
    if expected_rule == "last":
        assert rot.month == prev_end.month and prev_end - rot <= timedelta(days=2)
        assert prev_end - rot < timedelta(days=7)
    else:
        assert rot.month == first.month and rot.day <= 7


def test_leap_year_february_previous_month():
    # Feb is never the "previous month" of a cycle start, but Mar-ending-in-Feb cycles
    # exercise leap-year arithmetic: Apr cycle looks at Mar 31; Feb cycle looks at Jan 31.
    # 2028 is a leap year; make sure the Feb-2028 cycle and its neighbours still tile.
    c = cycle_for(2028, 2)
    assert c.start.weekday() == 6
    assert next_cycle(c).start == c.end + timedelta(days=1)
    assert previous_cycle(c).end == c.start - timedelta(days=1)
    # Leap-day membership.
    assert cycle_containing(date(2028, 2, 29)).contains(date(2028, 2, 29))


def test_cycles_tile_for_many_years():
    cs = []
    for y in range(2020, 2046):
        cs.extend(cycles_in_year(y))
    assert len(cs) == 26 * 6
    for a, b in zip(cs, cs[1:]):
        assert b.start == a.end + timedelta(days=1)
        assert next_cycle(a) == b
        assert previous_cycle(b) == a
    for c in cs:
        assert c.start.weekday() == 6, c
        assert c.end.weekday() == 5, c
        assert c.days % 7 == 0
        assert 8 * 7 <= c.days <= 9 * 7 + 7  # roughly two months
        assert c.first_month.day == 1


def test_cycles_in_year_order_and_months():
    cs = cycles_in_year(2027)
    assert [c.first_month.month for c in cs] == [2, 4, 6, 8, 10, 12]
    assert all(c.first_month.year == 2027 for c in cs)


def test_cycle_for_rejects_non_cycle_month():
    for bad in (1, 3, 5, 7, 9, 11):
        with pytest.raises(ValueError):
            cycle_for(2026, bad)


def test_cycle_containing_every_day():
    d = date(2026, 1, 1)
    while d < date(2028, 3, 1):
        c = cycle_containing(d)
        assert c.contains(d)
        d += timedelta(days=1)


def test_cycle_containing_boundaries():
    c = cycle_for(2026, 12)
    assert cycle_containing(c.start) == c
    assert cycle_containing(c.end) == c
    assert cycle_containing(c.start - timedelta(days=1)) == previous_cycle(c)
    assert cycle_containing(c.end + timedelta(days=1)) == next_cycle(c)


def test_weeks_are_sunday_to_saturday_and_contiguous():
    c = cycle_for(2026, 10)
    ws = weeks(c)
    assert len(ws) * 7 == c.days
    assert ws[0][0] == c.start and ws[-1][1] == c.end
    for sun, sat in ws:
        assert sun.weekday() == 6 and sat.weekday() == 5
        assert sat - sun == timedelta(days=6)
    for (_, sat), (sun, _) in zip(ws, ws[1:]):
        assert sun == sat + timedelta(days=1)


def test_crosses_date_and_split():
    c = cycle_for(2026, 12)  # 2026-11-29 .. 2027-01-30
    assert crosses_date(c, date(2026, 12, 31))
    assert not crosses_date(c, c.end)  # file ends exactly at cycle end
    assert not crosses_date(c, c.start - timedelta(days=1))
    assert crosses_date(c, c.start)

    part, rest = split_at_year_boundary(c, date(2026, 12, 31))
    assert part == DateSpan(date(2026, 11, 29), date(2026, 12, 31))
    assert rest == DateSpan(date(2027, 1, 1), date(2027, 1, 30))
    assert len(list(part.dates())) + len(list(rest.dates())) == c.days

    assert split_at_year_boundary(c, c.end) == (DateSpan(c.start, c.end), None)
    assert split_at_year_boundary(c, c.end + timedelta(days=40)) == (DateSpan(c.start, c.end), None)
    assert split_at_year_boundary(c, c.start - timedelta(days=1)) == (None, DateSpan(c.start, c.end))


# ---- cycle_availability -------------------------------------------------

def _code(text):
    return text.strip() in {"S1", "S2", "S3", "P", "HOL"}


def _fill(people, cycle, skip_weeks=(), only_people=None):
    cells = {}
    for p in people:
        cells[p] = {}
        if only_people is not None and p not in only_people:
            continue
        for i, (sun, _) in enumerate(weeks(cycle)):
            if i in skip_weeks:
                continue
            cells[p][sun + timedelta(days=2)] = "S1"
    return cells


def test_availability_enabled_when_full_coverage():
    target = cycle_for(2026, 12)
    prev = previous_cycle(target)
    people = ["Person A1", "Person A2"]
    result = cycle_availability(target, _fill(people, prev), people, _code)
    assert isinstance(result, Availability)
    assert result.enabled
    assert "100%" in result.reason
    assert result.coverage == 1.0
    assert result.failing_people == ()


def test_availability_disabled_when_a_person_has_a_gap_at_default_threshold():
    target = cycle_for(2026, 12)
    prev = previous_cycle(target)
    people = ["Person A1", "Person A2"]
    cells = _fill(people, prev)
    cells["Person A2"].pop(weeks(prev)[3][0] + timedelta(days=2))
    result = cycle_availability(target, cells, people, _code)
    assert not result.enabled
    assert result.failing_people == ("Person A2",)
    assert "Person A2" in result.reason and "Oct 2026" in result.reason
    assert 0.8 < result.coverage < 1.0
    assert f"{result.coverage:.0%}" in result.reason


def test_availability_threshold_is_configurable():
    target = cycle_for(2026, 12)
    prev = previous_cycle(target)
    people = ["Person A1"]
    cells = _fill(people, prev, skip_weeks=(0,))
    assert not cycle_availability(target, cells, people, _code).enabled
    assert cycle_availability(target, cells, people, _code, threshold=0.8).enabled


def test_availability_leave_codes_count_and_blank_does_not():
    target = cycle_for(2026, 12)
    prev = previous_cycle(target)
    p = "Person A1"
    cells = {p: {}}
    for sun, _ in weeks(prev):
        cells[p][sun + timedelta(days=1)] = "P"
    assert cycle_availability(target, cells, [p], _code).enabled
    cells[p][weeks(prev)[0][0] + timedelta(days=1)] = "   "
    assert not cycle_availability(target, cells, [p], _code).enabled


def test_availability_only_active_people_matter():
    target = cycle_for(2026, 12)
    prev = previous_cycle(target)
    cells = _fill(["Person A1", "Person Gone"], prev, only_people={"Person A1"})
    assert cycle_availability(target, cells, ["Person A1"], _code).enabled
    assert not cycle_availability(target, cells, ["Person A1", "Person Gone"], _code).enabled


def test_availability_ignores_cells_outside_previous_cycle():
    target = cycle_for(2026, 12)
    cells = {"Person A1": {target.start + timedelta(days=2): "S1"}}  # wrong cycle
    assert not cycle_availability(target, cells, ["Person A1"], _code).enabled


def test_availability_no_previous_data_and_bootstrap():
    target = cycle_for(2026, 12)
    off = cycle_availability(target, {}, ["Person A1"], _code)
    assert not off.enabled and "no roster data" in off.reason and "Oct 2026" in off.reason
    on = cycle_availability(target, {}, ["Person A1"], _code, bootstrap=True)
    assert on.enabled and "first cycle" in on.reason


def test_availability_bootstrap_does_not_excuse_partial_data():
    target = cycle_for(2026, 12)
    prev = previous_cycle(target)
    cells = _fill(["Person A1", "Person A2"], prev, only_people={"Person A1"})
    assert not cycle_availability(target, cells, ["Person A1", "Person A2"], _code,
                                  bootstrap=True).enabled


def test_availability_no_active_people_is_disabled():
    result = cycle_availability(cycle_for(2026, 12), {}, [], _code, bootstrap=True)
    assert not result.enabled and "no active people" in result.reason


def test_availability_invalid_threshold():
    for bad in (0, -0.1, 1.5):
        with pytest.raises(ValueError):
            cycle_availability(cycle_for(2026, 12), {}, ["Person A1"], _code, threshold=bad)


def test_availability_reason_truncates_long_failure_lists():
    target = cycle_for(2026, 12)
    people = [f"Person B{i}" for i in range(8)]
    result = cycle_availability(target, _fill(people, previous_cycle(target),
                                              only_people={"Person B0"}), people, _code)
    assert not result.enabled
    assert len(result.failing_people) == 7
    assert "and 2 more" in result.reason


def test_cycle_is_immutable_and_hashable():
    c = cycle_for(2026, 12)
    assert isinstance(c, Cycle)
    with pytest.raises(Exception):
        c.start = date(2020, 1, 1)
    assert len({c, cycle_for(2026, 12)}) == 1
