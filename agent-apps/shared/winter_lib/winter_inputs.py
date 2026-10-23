"""
Build the people list for the winter plan: who is in which team and what is their
USUAL SHIFT.

Sources
  * the staff roster (`PDT Staff Roster.xlsx`-style: one row per person with a team
    label, full name, location, roll-off / contract dates): team membership;
  * the shift roster (sheet `PDT Operate`, read through `roster_lib.roster_io`):
    each person's usual shift = the MODAL working shift code (canonical, via
    `roster_lib.codes`) over the lookback range that ends the day BEFORE the window
    starts (default the 4 months before it). The window's own cells are placeholders
    and are never read: the reader is only ever asked for dates before `window.start`.

Rules
  * ties in the mode are broken by the most recent occurrence, then by the code table order;
  * `config.shift_overrides` beat history; `config.default_new_person_shift` (off by
    default) gives people with no history a shift (with a warning); everybody else
    without history is reported in `needs_shift` so the UI can ask;
  * exclusions come from the config (team-label patterns on the staff-roster team columns
    and the roster section, person list, name patterns); every exclusion is listed;
  * people on the staff roster but not the shift roster, and vice versa, are WARNINGS.
    Names are matched exactly (case/space-insensitive), then by the same words in any order,
    then by `config.name_aliases`, then (same team only, unique candidate) by a conservative
    fuzzy rule; fuzzy matches are reported so the PMO can confirm them.
    People only on the shift roster are scheduled only when `include_shift_roster_only`.
  * the staff roster's `Roll-off date` column is read and exposed (`StaffRow.roll_off`) but NOT
    used to exclude anybody: in the real file it holds one placeholder date for nearly everybody.
    Name rolled-off people in `exclusions.people`.

Public API
    read_staff_roster(path, sheet_name=None) -> StaffRoster
    usual_shift(roster, person, first, last) -> (code | None, counts, last_seen)
    build_inputs(staff_path, roster_path, cfg, *, staff_sheet=None, roster_sheet="PDT Operate") -> InputsResult
"""

from __future__ import annotations

import os
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Optional, Sequence, Union

import openpyxl

from roster_lib import codes
from roster_lib.config import name_key
from roster_lib.holiday_matrix import DEFAULT_LOCATION_CODES
from roster_lib.roster_io import Person as RosterPerson
from roster_lib.roster_io import Roster, load_roster

from .winter_config import WinterConfig, label_key
from .winter_types import DISPLAY, ERROR, INFO, WARNING, Finding, PlanPerson

PathLike = Union[str, os.PathLike]
LOCATION_SHORT = {k.casefold(): v for k, v in DEFAULT_LOCATION_CODES.items()}
_HEADER_SCAN_ROWS = 15
_THIN_HISTORY_DAYS = 10


class StaffRosterError(Exception):
    """The staff roster does not look like a staff list."""


# ---------------------------------------------------------------------------
# staff roster


@dataclass(frozen=True)
class StaffRow:
    name: str
    team_label: str  # first "Team" column
    secondary_label: str  # a second "Team" column, if the sheet has one
    city: str  # "India -Location" style column
    country: str  # "Location" column
    roll_off: Optional[date]
    contract_end: Optional[date]
    row: int


@dataclass(frozen=True)
class StaffRoster:
    rows: tuple[StaffRow, ...]
    sheet_name: str
    header_row: int
    warnings: tuple[str, ...] = ()


def _h(text: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").casefold()).strip()


def _as_date(v: Any) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        try:
            return date.fromisoformat(v.strip()[:10])
        except ValueError:
            return None
    return None


def _text(v: Any) -> str:
    return "" if v is None else " ".join(str(v).split())


def read_staff_roster(path: PathLike, sheet_name: Optional[str] = None) -> StaffRoster:
    """Read the staff list. Header detection is tolerant: the first of the top rows that has a team
    column and either a full-name column or first + last name columns. The first sheet that is not
    hidden is used unless `sheet_name` is given."""
    wb = openpyxl.load_workbook(os.fspath(path), data_only=True, read_only=False)
    try:
        if sheet_name is None:
            visible = [s for s in wb.worksheets if s.sheet_state == "visible"]
            ws = (visible or wb.worksheets)[0]
        else:
            ws = wb[sheet_name]
        grid = [list(r) for r in ws.iter_rows(values_only=True)]
        title = ws.title
    finally:
        wb.close()

    header_row = None
    cols: dict[str, Any] = {}
    for r, row in enumerate(grid[:_HEADER_SCAN_ROWS]):
        heads = [_h(c) for c in row]
        team_cols = [i for i, h in enumerate(heads) if h in ("team", "team name", "section")]
        full = next((i for i, h in enumerate(heads) if h in ("full name", "name", "employee name")), None)
        first = next((i for i, h in enumerate(heads) if h in ("first name", "firstname")), None)
        last = next((i for i, h in enumerate(heads) if h in ("last name", "lastname", "surname")), None)
        if team_cols and (full is not None or (first is not None and last is not None)):
            header_row = r
            cols = {
                "team": team_cols[0],
                "team2": team_cols[1] if len(team_cols) > 1 else None,
                "full": full, "first": first, "last": last,
                "roll": next((i for i, h in enumerate(heads) if h in ("roll off date", "rolloff date", "roll off")),
                             None),
                "contract_end": next((i for i, h in enumerate(heads) if h == "contract end date"), None),
                "city": next((i for i, h in enumerate(heads) if h in ("india location", "india  location",
                                                                      "city", "base location")), None),
                "country": next((i for i, h in enumerate(heads) if h == "location"), None),
            }
            break
    if header_row is None:
        raise StaffRosterError(
            f"{os.path.basename(os.fspath(path))}: no header row with a Team column and a name column in the "
            f"first {_HEADER_SCAN_ROWS} rows of sheet {title!r}")

    def cell(row: Sequence[Any], key: str) -> Any:
        i = cols.get(key)
        return row[i] if i is not None and i < len(row) else None

    rows: list[StaffRow] = []
    warnings: list[str] = []
    for r in range(header_row + 1, len(grid)):
        row = grid[r]
        name = _text(cell(row, "full"))
        if not name or name.startswith("="):  # blank, or a formula Excel never cached
            f, l = _text(cell(row, "first")), _text(cell(row, "last"))
            name = " ".join(x for x in (f, l) if x)
        if not name:
            continue
        rows.append(StaffRow(
            name=name,
            team_label=_text(cell(row, "team")),
            secondary_label=_text(cell(row, "team2")),
            city=_text(cell(row, "city")),
            country=_text(cell(row, "country")),
            roll_off=_as_date(cell(row, "roll")),
            contract_end=_as_date(cell(row, "contract_end")),
            row=r + 1,
        ))
    if not rows:
        raise StaffRosterError(f"no people rows below the header on row {header_row + 1}")
    keys = Counter(name_key(s.name) for s in rows)
    dup = [k for k, c in keys.items() if c > 1]
    if dup:
        warnings.append(f"{len(dup)} name(s) appear more than once in the staff roster")
    return StaffRoster(tuple(rows), title, header_row + 1, tuple(warnings))


# ---------------------------------------------------------------------------
# usual shift


def usual_shift(roster: Roster, person: RosterPerson, first: date, last: date
                ) -> tuple[Optional[str], Counter, Optional[date]]:
    """(modal shift code, counts per shift code, last day with that code) over first..last inclusive.

    Only SHIFT codes count (not leave, on-call, blanks or custom hours). The range is clipped to the
    roster's own dates; raises ValueError when it lies beyond them entirely."""
    first = max(first, roster.first_date)
    last = min(last, roster.last_date)
    if last < first:
        raise ValueError("the lookback range lies outside the shift roster's dates")
    counts: Counter = Counter()
    last_seen: dict[str, date] = {}
    d = first
    for text in roster.row_texts(person, first, last):
        parsed = codes.try_parse_code(text)
        if parsed is not None and parsed.canonical in DISPLAY:
            counts[parsed.canonical] += 1
            last_seen[parsed.canonical] = d
        d += timedelta(days=1)
    if not counts:
        return None, counts, None
    order = {c: i for i, c in enumerate(DISPLAY)}
    best = sorted(counts, key=lambda c: (-counts[c], -(last_seen[c].toordinal()), order[c]))[0]
    return best, counts, last_seen[best]


# ---------------------------------------------------------------------------
# name matching


def _tokens(name: str) -> frozenset[str]:
    return frozenset(re.sub(r"[^\w\s]", "", name_key(name)).split())


def _edit_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _fuzzy_close(a: str, b: str) -> bool:
    """Conservative: same words but one missing/extra, or one word within edit distance 2, or a
    shared whole word plus the rest within edit distance 2 (initials / short forms)."""
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return False
    if ta <= tb or tb <= ta:
        return True
    common = ta & tb
    ra, rb = sorted(ta - common), sorted(tb - common)
    if common and _edit_distance(" ".join(ra), " ".join(rb)) <= 2:
        return True
    if len(ta) == len(tb) and len(ra) == 1 and len(rb) == 1 and _edit_distance(ra[0], rb[0]) <= 2:
        return True
    return False


@dataclass(frozen=True)
class NameMatch:
    staff: StaffRow
    shift: RosterPerson
    how: str  # exact | words | alias | fuzzy


def match_names(
    staff: Sequence[tuple[StaffRow, Optional[str]]],
    shift: Sequence[tuple[RosterPerson, Optional[str]]],
    aliases: dict[str, str],
) -> tuple[list[NameMatch], list[StaffRow], list[RosterPerson]]:
    """Pair staff-roster rows with shift-roster people. Each side is (row, resolved team or None).
    Returns (matches, staff only, shift only)."""
    by_key: dict[str, list[int]] = {}
    for i, (p, _) in enumerate(shift):
        by_key.setdefault(name_key(p.name), []).append(i)
    taken: set[int] = set()
    matches: list[NameMatch] = []
    pending: list[tuple[StaffRow, Optional[str]]] = []

    def take(s: StaffRow, i: int, how: str) -> None:
        taken.add(i)
        matches.append(NameMatch(s, shift[i][0], how))

    for s, team in staff:
        alias = aliases.get(name_key(s.name))
        hit = None
        if alias is not None:
            hit = next((i for i in by_key.get(name_key(alias), []) if i not in taken), None)
            if hit is not None:
                take(s, hit, "alias")
                continue
        hit = next((i for i in by_key.get(name_key(s.name), []) if i not in taken), None)
        if hit is not None:
            take(s, hit, "exact")
            continue
        pending.append((s, team))

    still: list[tuple[StaffRow, Optional[str]]] = []
    for s, team in pending:
        ts = _tokens(s.name)
        cands = [i for i, (p, _) in enumerate(shift) if i not in taken and _tokens(p.name) == ts]
        if len(cands) == 1:
            take(s, cands[0], "words")
        else:
            still.append((s, team))

    for s, team in still:
        if team is None:
            continue
        cands = [i for i, (p, t) in enumerate(shift)
                 if i not in taken and t == team and _fuzzy_close(s.name, p.name)]
        if len(cands) == 1:
            # the shift person must not be a better fit for another unmatched staff row
            rivals = [x for x, tm in still if x is not s and tm == team and _fuzzy_close(x.name, shift[cands[0]][0].name)]
            if not rivals:
                take(s, cands[0], "fuzzy")
    matched_staff = {id(m.staff) for m in matches}
    staff_only = [s for s, _ in staff if id(s) not in matched_staff]
    shift_only = [p for i, (p, _) in enumerate(shift) if i not in taken]
    return matches, staff_only, shift_only


# ---------------------------------------------------------------------------
# result


@dataclass(frozen=True)
class ExcludedPerson:
    name: str
    reason: str
    source: str  # staff | shift roster


@dataclass
class InputsResult:
    people: list[PlanPerson]  # scheduled, each with a usual shift
    needs_shift: list[PlanPerson]  # in the staff roster, no shift history, no override: ask the user
    excluded: list[ExcludedPerson]
    unmapped: list[str]  # staff-roster people whose team is not a winter team (not scheduled)
    findings: list[Finding]
    lookback: tuple[date, date]
    stats: dict[str, Any] = field(default_factory=dict)

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == WARNING]

    def by_team(self) -> dict[str, list[PlanPerson]]:
        out: dict[str, list[PlanPerson]] = {}
        for p in self.people:
            out.setdefault(p.team, []).append(p)
        return out


def _short_location(*raw: str) -> str:
    for r in raw:
        if r:
            return LOCATION_SHORT.get(r.casefold(), r[:3].title())
    return ""


def build_inputs(
    staff_path: PathLike,
    roster_path: PathLike,
    cfg: WinterConfig,
    *,
    staff_sheet: Optional[str] = None,
    roster_sheet: str = "PDT Operate",
    roster: Optional[Roster] = None,
    staff: Optional[StaffRoster] = None,
) -> InputsResult:
    """Merge the staff roster and the shift roster into the plan's people list (see module docstring)."""
    staff = staff or read_staff_roster(staff_path, staff_sheet)
    roster = roster or load_roster(roster_path, roster_sheet, section_aliases=dict(cfg.team_aliases))
    lb_first, lb_last = cfg.lookback_range()
    assert lb_last < cfg.start  # the window's own cells are never read
    findings: list[Finding] = []
    excluded: list[ExcludedPerson] = []
    unmapped: list[str] = []

    for w in staff.warnings:
        findings.append(Finding(WARNING, "staff_roster", w))
    for w in roster.warnings:
        findings.append(Finding(WARNING, "shift_roster", w))

    # --- staff rows: exclusion + team
    def staff_exclusion(s: StaffRow) -> Optional[str]:
        if cfg.is_excluded_name(s.name):
            return "excluded by name"
        for lab in (s.team_label, s.secondary_label):
            if cfg.is_excluded_label(lab):
                return f"team label {lab!r} is excluded"
        return None

    def staff_team(s: StaffRow) -> Optional[str]:
        return cfg.resolve_team(s.team_label) or cfg.resolve_team(s.secondary_label)

    staff_in: list[tuple[StaffRow, Optional[str]]] = []
    for s in staff.rows:
        why = staff_exclusion(s)
        if why:
            excluded.append(ExcludedPerson(s.name, why, "staff roster"))
        else:
            staff_in.append((s, staff_team(s)))

    # --- shift-roster people: exclusion + team
    shift_in: list[tuple[RosterPerson, Optional[str]]] = []
    for p in roster.people:
        why = None
        if cfg.is_excluded_name(p.name):
            why = "excluded by name"
        elif cfg.is_excluded_label(p.section) or cfg.is_excluded_label(p.team_label):
            why = f"section {p.section!r} is excluded"
        if why:
            excluded.append(ExcludedPerson(p.name, why, "shift roster"))
        else:
            shift_in.append((p, cfg.resolve_team(p.section) or cfg.resolve_team(p.team_label)))
    # an excluded person on one roster must not show up as "missing" on the other
    excluded_keys = {name_key(e.name) for e in excluded}
    excluded_tokens = {_tokens(e.name) for e in excluded}

    matches, staff_only, shift_only = match_names(staff_in, shift_in, dict(cfg.name_aliases))
    match_of = {id(m.staff): m for m in matches}
    team_of_shift = {id(p): t for p, t in shift_in}

    for m in matches:
        if m.how == "fuzzy":
            findings.append(Finding(WARNING, "name_fuzzy",
                                    f"staff roster {m.staff.name!r} was matched to shift roster {m.shift.name!r} "
                                    "by similar spelling: confirm, or add it to name_aliases",
                                    person=m.shift.name))

    staff_only_visible = [s for s in staff_only
                          if name_key(s.name) not in excluded_keys and _tokens(s.name) not in excluded_tokens]
    for s in staff_only_visible:
        findings.append(Finding(WARNING, "staff_not_on_shift_roster",
                                f"{s.name!r} is on the staff roster but not on the shift roster: no shift history",
                                person=s.name))
    for p in shift_only:
        findings.append(Finding(WARNING, "shift_roster_not_on_staff",
                                f"{p.name!r} is on the shift roster ({p.section}) but not on the staff roster"
                                + ("" if cfg.include_shift_roster_only else ": not scheduled"),
                                person=p.name))

    people: list[PlanPerson] = []
    needs: list[PlanPerson] = []
    order: dict[str, int] = {}

    def person_shift(name: str, rp: Optional[RosterPerson]) -> tuple[Optional[str], str, Counter]:
        key = name_key(name)
        if key in cfg.shift_overrides:
            return cfg.shift_overrides[key], "override", Counter()
        if rp is not None:
            try:
                code, counts, _ = usual_shift(roster, rp, lb_first, lb_last)
            except ValueError:
                findings.append(Finding(WARNING, "lookback_outside_roster",
                                        f"the lookback {lb_first}..{lb_last} is outside the shift roster's dates",
                                        person=name))
                return None, "", Counter()
            if code:
                return code, "history", counts
        return None, "", Counter()

    thin = 0
    # staff people
    for s, team in staff_in:
        m = match_of.get(id(s))
        rp = m.shift if m else None
        if team is None and rp is not None:
            team = team_of_shift.get(id(rp))
        if team is None:
            unmapped.append(s.name)
            findings.append(Finding(WARNING, "unmapped_team",
                                    f"{s.name!r}: team {s.team_label or s.secondary_label!r} is not a winter team, "
                                    "so the person is not scheduled (map it in staff_team_map or exclude it)",
                                    person=s.name))
            continue
        name = rp.name if rp is not None else s.name
        code, source, counts = person_shift(name, rp)
        if code and source == "history" and sum(counts.values()) < _THIN_HISTORY_DAYS:
            thin += 1
            findings.append(Finding(INFO, "thin_history",
                                    f"{name!r}: only {sum(counts.values())} shift day(s) in the lookback",
                                    team=team, person=name))
        if code is None and cfg.default_new_person_shift:
            code, source = cfg.default_new_person_shift, "default"
            findings.append(Finding(WARNING, "default_shift_used",
                                    f"{name!r} has no shift history: default shift "
                                    f"{DISPLAY[code]} assumed (change it in the plan)", team=team, person=name))
        subteam = _subteam(cfg, rp, s)
        loc = _short_location(rp.location_code if rp else "", s.city, s.country)
        pp = PlanPerson(name, team, loc, code, subteam, source, s.name if s.name != name else "")
        order[name_key(name)] = rp.row if rp else 100000 + s.row
        if code is None:
            needs.append(pp)
            findings.append(Finding(WARNING, "needs_shift",
                                    f"{name!r} ({team}) has no shift history: ask which shift to plan",
                                    team=team, person=name))
        else:
            people.append(pp)

    if cfg.include_shift_roster_only:
        for p in shift_only:
            team = team_of_shift.get(id(p))
            if team is None:
                unmapped.append(p.name)
                findings.append(Finding(WARNING, "unmapped_team",
                                        f"{p.name!r}: section {p.section!r} is not a winter team, not scheduled",
                                        person=p.name))
                continue
            code, source, counts = person_shift(p.name, p)
            pp = PlanPerson(p.name, team, _short_location(p.location_code), code, _subteam(cfg, p, None), source)
            order[name_key(p.name)] = p.row
            if code is None:
                needs.append(pp)
                findings.append(Finding(WARNING, "needs_shift", f"{p.name!r} ({team}) has no shift history: ask "
                                        "which shift to plan", team=team, person=p.name))
            else:
                people.append(pp)

    team_pos = {t.name: i for i, t in enumerate(cfg.teams)}

    def sort_key(p: PlanPerson):
        return team_pos[p.team], order.get(name_key(p.name), 10 ** 6), name_key(p.name)

    people.sort(key=sort_key)
    needs.sort(key=sort_key)

    names = [name_key(p.name) for p in people + needs]
    if len(names) != len(set(names)):
        findings.append(Finding(ERROR, "duplicate_name", "two people have the same name; names must be unique"))

    stats = {
        "staff_rows": len(staff.rows), "shift_rows": len(roster.people),
        "scheduled": len(people), "needs_shift": len(needs), "excluded": len(excluded),
        "unmapped": len(unmapped), "staff_only": len(staff_only_visible), "shift_only": len(shift_only),
        "matched": len(matches), "fuzzy": sum(1 for m in matches if m.how == "fuzzy"),
        "alias": sum(1 for m in matches if m.how == "alias"), "thin_history": thin,
        "per_team": dict(Counter(p.team for p in people + needs)),
    }
    return InputsResult(people, needs, excluded, unmapped, findings, (lb_first, lb_last), stats)


def _subteam(cfg: WinterConfig, rp: Optional[RosterPerson], s: Optional[StaffRow]) -> Optional[str]:
    wanted = {label_key(x): x for x in cfg.subteams}
    for lab in ((rp.team_label if rp else ""), (s.team_label if s else ""), (s.secondary_label if s else "")):
        if lab and label_key(lab) in wanted:
            return wanted[label_key(lab)]
    return None
