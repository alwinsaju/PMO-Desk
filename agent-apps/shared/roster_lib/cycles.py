"""
Cycle calendar for the shift roster.

A cycle is two months long. Cycles are named after their first month, which
is always Feb, Apr, Jun, Aug, Oct or Dec. Every cycle starts on its
"rotation Sunday" and ends on the Saturday before the NEXT cycle's rotation
Sunday, so consecutive cycles tile the calendar with no gap or overlap and
always consist of whole Sunday-Saturday weeks.

Rotation Sunday rule (no legacy/special-case exceptions):
- If the month BEFORE the cycle's first month ends on a Sunday, Monday or
  Tuesday, the rotation is the LAST Sunday of that previous month.
- Otherwise it is the FIRST Sunday of the cycle's first month.

Also here: splitting a cycle where the roster file's last date column falls
inside it (the remainder goes to a new next-year file), and the pure
`cycle_availability` check that decides whether a cycle can be selected.
All dates are plain `datetime.date`; there is no time-zone handling.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Callable, Iterable, Iterator, Mapping

CYCLE_FIRST_MONTHS = (2, 4, 6, 8, 10, 12)
DEFAULT_HAS_DATA_THRESHOLD = 0.95

_MONTH_ABBR = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


@dataclass(frozen=True)
class Cycle:
    first_month: date  # day 1 of the cycle's first month
    start: date  # the rotation Sunday
    end: date  # a Saturday
    rotation_sunday: date

    @property
    def label(self) -> str:
        return f"{_MONTH_ABBR[self.first_month.month - 1]} {self.first_month.year}"

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def contains(self, d: date) -> bool:
        return self.start <= d <= self.end


@dataclass(frozen=True)
class DateSpan:
    """An inclusive run of consecutive dates (a piece of a cycle)."""

    start: date
    end: date

    def dates(self) -> Iterator[date]:
        d = self.start
        while d <= self.end:
            yield d
            d += timedelta(days=1)


def rotation_sunday(first_month: date) -> date:
    """Rotation Sunday for the cycle whose first month starts at `first_month`."""
    previous_month_end = first_month.replace(day=1) - timedelta(days=1)
    wd = previous_month_end.weekday()  # Mon=0 .. Sun=6
    if wd in (6, 0, 1):  # Sunday, Monday, Tuesday -> last Sunday of previous month
        return previous_month_end - timedelta(days=(wd + 1) % 7)
    first = first_month.replace(day=1)
    return first + timedelta(days=(6 - first.weekday()) % 7)


def _shift_months(first_month: date, delta: int) -> date:
    index = first_month.year * 12 + (first_month.month - 1) + delta
    return date(index // 12, index % 12 + 1, 1)


def _build(first_month: date) -> Cycle:
    start = rotation_sunday(first_month)
    next_start = rotation_sunday(_shift_months(first_month, 2))
    return Cycle(first_month, start, next_start - timedelta(days=1), start)


def cycle_for(year: int, month: int) -> Cycle:
    """The cycle whose FIRST month is (year, month); month must be 2/4/6/8/10/12."""
    if month not in CYCLE_FIRST_MONTHS:
        raise ValueError(
            f"{year}-{month:02d} is not a cycle first month "
            f"(cycles start in {', '.join(map(str, CYCLE_FIRST_MONTHS))})"
        )
    return _build(date(year, month, 1))


def previous_cycle(cycle: Cycle) -> Cycle:
    return _build(_shift_months(cycle.first_month, -2))


def next_cycle(cycle: Cycle) -> Cycle:
    return _build(_shift_months(cycle.first_month, 2))


def cycles_in_year(year: int) -> list[Cycle]:
    """The six cycles whose first month falls in `year` (the Dec one may end next year)."""
    return [cycle_for(year, m) for m in CYCLE_FIRST_MONTHS]


def cycle_containing(d: date) -> Cycle:
    """The cycle that `d` falls in."""
    month = d.month - (d.month % 2)  # nearest cycle-first month at or before d's month
    first = date(d.year, month, 1) if month else date(d.year - 1, 12, 1)
    # The rotation Sunday can precede the first month, so also try the neighbours.
    for candidate in (_build(first), next_cycle(_build(first)), previous_cycle(_build(first))):
        if candidate.contains(d):
            return candidate
    raise AssertionError(f"no cycle contains {d}")  # unreachable: cycles tile the calendar


def weeks(cycle: Cycle) -> list[tuple[date, date]]:
    """Sunday-Saturday weeks of the cycle as (sunday, saturday) pairs."""
    return [
        (cycle.start + timedelta(days=7 * i), cycle.start + timedelta(days=7 * i + 6))
        for i in range(cycle.days // 7)
    ]


def crosses_date(cycle: Cycle, last_column_date: date) -> bool:
    """True if the roster file's last date column falls strictly inside the cycle."""
    return cycle.start <= last_column_date < cycle.end


def split_at_year_boundary(
    cycle: Cycle, last_date: date
) -> tuple[DateSpan | None, DateSpan | None]:
    """Split a cycle at the roster file's last date column.

    Returns (part_in_file, remainder). Either is None when empty: a cycle that
    fits entirely returns (whole, None); one entirely after the file returns
    (None, whole). The remainder belongs in the next file.
    """
    whole = DateSpan(cycle.start, cycle.end)
    if last_date >= cycle.end:
        return whole, None
    if last_date < cycle.start:
        return None, whole
    return (DateSpan(cycle.start, last_date),
            DateSpan(last_date + timedelta(days=1), cycle.end))


@dataclass(frozen=True)
class Availability:
    enabled: bool
    reason: str
    coverage: float | None  # lowest per-person share of covered weeks (None if unmeasured)
    failing_people: tuple[str, ...] = ()


def cycle_availability(
    cycle: Cycle,
    cells: Mapping[str, Mapping[date, str]],
    active_people: Iterable[str],
    counts_as_code: Callable[[str], bool],
    threshold: float = DEFAULT_HAS_DATA_THRESHOLD,
    bootstrap: bool = False,
) -> Availability:
    """Decide whether `cycle` is selectable.

    It is enabled only if the PREVIOUS cycle "has data": every active person
    has at least one shift or leave code in >= `threshold` of that cycle's
    Sunday-Saturday weeks. `cells` maps person -> date -> raw cell text and
    `counts_as_code(text)` says whether text is a shift/leave code (blank and
    unparseable text should not count). With `bootstrap=True` a previous cycle
    with no data at all is allowed (first ever cycle); partial data is still
    judged normally. Returns the decision and a hover-friendly reason.
    """
    if not 0 < threshold <= 1:
        raise ValueError(f"threshold must be in (0, 1], got {threshold}")
    prev = previous_cycle(cycle)
    people = sorted(set(active_people))
    prev_weeks = weeks(prev)
    needed = threshold * len(prev_weeks)

    covered: dict[str, int] = {}
    for person in people:
        person_cells = cells.get(person, {})
        covered[person] = sum(
            1
            for sunday, saturday in prev_weeks
            if any(
                counts_as_code(person_cells.get(sunday + timedelta(days=i), "") or "")
                for i in range(7)
            )
        )

    any_data = any(covered.values())
    if not people:
        return Availability(False, f"{cycle.label} is unavailable: no active people were "
                                   f"supplied to check {prev.label} against.", None)
    if not any_data:
        if bootstrap:
            return Availability(True, f"{cycle.label} enabled as the first cycle: "
                                      f"no earlier data ({prev.label}) was expected.", 0.0)
        return Availability(False, f"{cycle.label} is unavailable: there is no roster data "
                                   f"for the previous cycle ({prev.label}).", 0.0)

    total = len(prev_weeks)
    lowest = min(covered.values()) / total
    failing = tuple(p for p in people if covered[p] < needed - 1e-9)
    if not failing:
        return Availability(
            True,
            f"{cycle.label} enabled: every active person has a shift or leave code in at "
            f"least {threshold:.0%} of the weeks of {prev.label} (lowest coverage {lowest:.0%}).",
            lowest,
        )
    shown = ", ".join(failing[:5]) + (f" and {len(failing) - 5} more" if len(failing) > 5 else "")
    return Availability(
        False,
        f"{cycle.label} is unavailable: {len(failing)} of {len(people)} active people have "
        f"codes in fewer than {threshold:.0%} of the weeks of {prev.label} "
        f"(lowest coverage {lowest:.0%}); e.g. {shown}.",
        lowest,
        failing,
    )
