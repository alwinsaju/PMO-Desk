"""
Step 2 "Rotate": build the new cycle's shifts from the previous cycle.

Deterministic and unit-tested; no randomness, no LLM judgment. Leave (PTO,
HOL, ...) is NOT written here: it comes in later steps.

Inputs
  prev_schedule   {person name: {date: raw cell text}} for the previous cycle
                  (blank "" = weekly off). Names are exactly as in the roster.
  config          `config.RotationConfig` (categories PERMANENT / AUTO_SWAP /
                  ASK_ME / UNCLASSIFIED); apply roster changes first.
  cycle           the NEW `cycles.Cycle`.
  answers         for people that cannot be rotated automatically (ASK_ME,
                  UNCLASSIFIED, new seats, no previous data):
                      {"<name>": {"shift": "S3", "pattern": "MON_FRI"}}
                  `shift`: S1..S5, NS, US-CST, US-PST, 11AM-8PM, MX-8-5, or
                  "KEEP" (existing people only: keep the current shift).
                  `pattern`: "MON_FRI" or "WED_SUN" (also "Mon-Fri"/"Wed-Sun");
                  optional: omitted means the current pattern when the shift
                  is unchanged, else the code's default (S2/S4 are always
                  Wed-Sun). `text` (optional): the exact string to write.
                  Names are matched with `config.name_key`. A missing answer
                  raises `MissingAnswers` (never a guess); a bad one raises
                  `InvalidAnswers`.
  history         optional earlier schedule (same shape, older dates) used only
                  to find the string a person used for a shift before.
  replaces        {new person: replaced person} (from roster_changes): a new
                  person without data of their own takes the seat's state from
                  the replaced person's previous-cycle cells.

Deriving the current state (`derive_state`), from the previous cycle's weeks
(Sunday-Saturday):
  - leave codes (HOL, P, T, SL, COMP) and on-call (OC) are ignored as evidence
    of the shift; a week with unrecognised text or two different working codes
    is "odd" and is skipped;
  - the current shift is the code of the LAST clean week, over the trailing run
    of weeks that carry that code (so a mid-cycle change uses the last full
    weeks); the string kept is the exact raw text most used for it there
    (CUSTOM time-range text is carried verbatim);
  - the weekly-off pattern is the modal pattern of the weeks that fit exactly
    one pattern (Mon-Fri: Sat+Sun blank; Wed-Sun: Mon+Tue blank, leave days
    count as working days); if none fits, the weekdays the person worked decide.

Rotation rules
  PERMANENT   same code, same exact string, same pattern (blank weekly offs).
  AUTO_SWAP   S1<->S2, S3<->S4; the pattern follows the NEW code (S2/S4 =
              Wed-Sun, S1/S3 = Mon-Fri). String written for the new code, first
              match wins (`choose_text`):
                1. the exact string THIS person used for that code most recently
                   (previous cycle, then `history`);
                2. the most common string for that code in the person's team in
                   the previous cycle (ties: alphabetical);
                3. the person's own string restyled (`Shift-1` -> `Shift-2`);
                4. canonical `Shift-N`.
  ASK_ME / UNCLASSIFIED / no previous data: from `answers`.

Swap Sunday: nothing special is coded; the plain pattern rule gives the verified
behaviour. A person moving to Wed-Sun works the swap Sunday as the new code, is
off Mon-Tue and works Wed-Sun; a person moving to Mon-Fri is off the swap Sunday
and starts Monday; everyone else continues by their pattern.

Headcount per team and canonical shift is compared before and after (people
with a state before only; new seats are excluded); any change is a warning.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Iterable, Mapping, Sequence

from .codes import (
    BLANK,
    CUSTOM,
    DEFAULT_TABLE,
    Kind,
    Pattern,
    default_pattern,
    forced_pattern,
    is_leave_code,
    partner_shift,
    try_parse_code,
    works_on,
)
from .config import Rotation, RotationConfig, name_key
from .cycles import Cycle, previous_cycle, weeks
from .roster_io import Person as RosterPerson

Schedule = Mapping[str, Mapping[date, str]]


class MissingAnswers(ValueError):
    """People who need an answer before the rotation can be built (nothing is guessed)."""

    def __init__(self, reasons: Mapping[str, str]):
        self.reasons = dict(reasons)
        self.names = list(self.reasons)
        super().__init__("Answers needed for: " + "; ".join(
            f"{n} ({r})" for n, r in self.reasons.items()))


class InvalidAnswers(ValueError):
    """An answer cannot be used; `problems` lists every one."""

    def __init__(self, problems: Sequence[str]):
        self.problems = list(problems)
        super().__init__("Invalid answers: " + "; ".join(self.problems))


@dataclass(frozen=True)
class PersonState:
    code: str  # canonical shift code, or "CUSTOM" for time-range text
    text: str  # exact raw string to carry forward
    pattern: Pattern | None  # None only if it could not be determined
    pattern_from_weeks: bool  # False: inferred from worked weekdays (weaker evidence)
    weeks_used: int
    unparseable: int  # cells in the previous cycle that were not recognised

    @property
    def label(self) -> str:
        """Short name for reports: the code, or the custom text."""
        return self.text.strip() if self.code == CUSTOM else self.code


@dataclass(frozen=True)
class ShiftChange:
    person: str
    old_shift: str
    new_shift: str
    effective: date  # the rotation Sunday (cycle start)
    first_worked: date | None  # first date worked in the new shift
    old_pattern: Pattern | None
    new_pattern: Pattern


@dataclass
class RotationResult:
    schedule: dict[str, dict[date, str]]
    changes: list[ShiftChange] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    old_states: dict[str, PersonState] = field(default_factory=dict)

    @property
    def edits(self) -> dict[tuple[str, date], str]:
        """Every cell of the new cycle as (name, date) -> text ("" clears)."""
        return {(n, d): t for n, cells in self.schedule.items() for d, t in cells.items()}


# ---- deriving the current state -------------------------------------------------

def canonical_text(code: str) -> str:
    """The text written when nothing better is known: `Shift-N` for S1-S5, else the code."""
    if code in ("S1", "S2", "S3", "S4", "S5"):
        return f"Shift-{code[1]}"
    return code


def _custom_key(custom: str) -> str:
    return " ".join(custom.split()).casefold()


@dataclass
class _Week:
    sunday: date
    kinds: list[str]  # per day: W working, L leave/on-call, O blank, U unrecognised
    working: list[tuple[date, tuple, str]]  # (date, code key, raw)

    @property
    def clean(self) -> bool:
        return "U" not in self.kinds and len({k for _, k, _ in self.working}) == 1

    @property
    def key(self) -> tuple:
        return self.working[0][1]

    def fits(self, pattern: Pattern) -> bool:
        for i, kind in enumerate(self.kinds):
            if works_on(pattern, self.sunday + timedelta(days=i)):
                if kind not in ("W", "L"):
                    return False
            elif kind != "O":
                return False
        return True


def _read_weeks(cells: Mapping[date, str], prev: Cycle) -> tuple[list[_Week], int]:
    out: list[_Week] = []
    unparseable = 0
    for sunday, _ in weeks(prev):
        kinds, working = [], []
        for i in range(7):
            d = sunday + timedelta(days=i)
            raw = cells.get(d, "") or ""
            parsed = try_parse_code(raw)
            if parsed is None:
                kinds.append("U")
                unparseable += 1
            elif parsed.canonical == BLANK:
                kinds.append("O")
            elif is_leave_code(parsed.canonical) or DEFAULT_TABLE[parsed.canonical].kind is Kind.ON_CALL:
                kinds.append("L")
            else:
                kinds.append("W")
                key = (CUSTOM, _custom_key(parsed.custom or "")) if parsed.is_custom \
                    else (parsed.canonical, "")
                working.append((d, key, raw))
        out.append(_Week(sunday, kinds, working))
    return out, unparseable


def _mode_latest(items: Iterable[tuple[object, date]]):
    """Most frequent value; ties go to the one seen most recently."""
    stats: dict[object, list] = {}
    for value, when in items:
        s = stats.setdefault(value, [0, when])
        s[0] += 1
        s[1] = max(s[1], when)
    return max(stats, key=lambda v: (stats[v][0], stats[v][1])) if stats else None


def derive_state(cells: Mapping[date, str] | None, prev: Cycle) -> PersonState | None:
    """Current shift/string/pattern from the previous cycle's cells; None if no clean week."""
    if not cells:
        return None
    all_weeks, unparseable = _read_weeks(cells, prev)
    clean = [w for w in all_weeks if w.clean]
    if not clean:
        return None
    last_key = clean[-1].key
    segment: list[_Week] = []
    for w in reversed(clean):
        if w.key != last_key:
            break
        segment.append(w)
    segment.reverse()

    raw = _mode_latest((r, d) for w in segment for d, _, r in w.working)
    votes = []
    for w in segment:
        fitting = [p for p in Pattern if w.fits(p)]
        if len(fitting) == 1:
            votes.append((fitting[0], w.sunday))
    pattern = _mode_latest(votes)
    from_weeks = pattern is not None
    if pattern is None:
        days = [d for w in segment for d, _, _ in w.working]
        weekend = any(d.weekday() in (5, 6) for d in days)
        early = any(d.weekday() in (0, 1) for d in days)
        if weekend and not early:
            pattern = Pattern.WED_SUN
        elif early and not weekend:
            pattern = Pattern.MON_FRI
    code = last_key[0]
    return PersonState(code, raw, pattern, from_weeks, len(segment), unparseable)


# ---- choosing the string to write -----------------------------------------------

def _restyle(raw: str, old_code: str, new_code: str) -> str | None:
    """Swap the digit in `raw` (Shift-1 -> Shift-2) if that yields a clean parse."""
    numeric = ("S1", "S2", "S3", "S4", "S5")
    if old_code not in numeric or new_code not in numeric:
        return None
    if sum(ch.isdigit() for ch in raw) != 1 or raw.count(old_code[1]) != 1:
        return None
    candidate = raw.replace(old_code[1], new_code[1])
    parsed = try_parse_code(candidate)
    return candidate if parsed is not None and parsed.canonical == new_code else None


def choose_text(
    target_code: str,
    own_cells: Mapping[date, str] | None,
    team_texts: Mapping[str, int] | None,
    current: PersonState | None,
    before: date | None = None,
) -> str:
    """The string to write for `target_code`, by the documented fallback order.

    0. the person's current string if the code is unchanged;
    1. the exact string they used for `target_code` most recently in `own_cells`
       (dates before `before` when given);
    2. the most common team string (`team_texts`: raw -> count; ties alphabetical);
    3. their current string restyled (Shift-1 -> Shift-2);
    4. canonical `Shift-N` / the code itself.
    """
    if current is not None and current.code == target_code:
        return current.text
    for d in sorted(own_cells or {}, reverse=True):
        if before is not None and d >= before:
            continue
        raw = own_cells[d]
        parsed = try_parse_code(raw)
        if parsed is not None and parsed.canonical == target_code and raw.strip():
            return raw
    if team_texts:
        return min(team_texts, key=lambda r: (-team_texts[r], r))
    if current is not None:
        restyled = _restyle(current.text, current.code, target_code)
        if restyled is not None:
            return restyled
    return canonical_text(target_code)


# ---- headcount ------------------------------------------------------------------

def headcount_by_shift(
    schedule: Schedule, people: Iterable[RosterPerson], on_date: date
) -> dict[str, dict[str, int]]:
    """{team label: {canonical shift: people on that shift on `on_date`}}.

    Counts shift codes and custom hours (under "CUSTOM"); leave, blank and
    on-call cells are not counted.
    """
    counts: dict[str, Counter] = defaultdict(Counter)
    for person in people:
        raw = schedule.get(person.name, {}).get(on_date, "")
        parsed = try_parse_code(raw)
        if parsed is None:
            continue
        if parsed.is_custom or DEFAULT_TABLE[parsed.canonical].kind is Kind.SHIFT:
            counts[person.team_label][parsed.canonical] += 1
    return {t: dict(sorted(c.items())) for t, c in sorted(counts.items())}


# ---- answers --------------------------------------------------------------------

_SHIFT_KINDS = (Kind.SHIFT,)


def parse_pattern(value: object) -> Pattern:
    key = str(value).strip().upper().replace("-", "_").replace(" ", "_")
    for p in Pattern:
        if key in (p.name, p.value.upper().replace("-", "_")):
            return p
    raise ValueError(f"unknown pattern {value!r} (use MON_FRI or WED_SUN)")


def _read_answer(name: str, answer: Mapping, state: PersonState | None):
    """-> (code, pattern, text or None); raises ValueError with a readable message."""
    shift = answer.get("shift")
    if shift is None or str(shift).strip() == "":
        raise ValueError("answer has no 'shift'")
    if str(shift).strip().upper() == "KEEP":
        if state is None:
            raise ValueError("'KEEP' needs a previous shift to keep")
        code = state.code
    else:
        parsed = try_parse_code(str(shift))
        if parsed is None or DEFAULT_TABLE[parsed.canonical].kind not in _SHIFT_KINDS:
            raise ValueError(f"unusable shift {shift!r}")
        code = parsed.canonical
    pattern_raw = answer.get("pattern")
    if pattern_raw in (None, ""):
        if state is not None and state.code == code and state.pattern is not None:
            pattern = state.pattern
        else:
            pattern = default_pattern(code) or Pattern.MON_FRI
    else:
        pattern = parse_pattern(pattern_raw)
    forced = forced_pattern(code)
    if forced is not None and pattern is not forced:
        raise ValueError(f"{code} is always {forced.value}, not {pattern.value}")
    text = answer.get("text")
    if text not in (None, ""):
        parsed = try_parse_code(str(text))
        if parsed is None or parsed.canonical != code:
            raise ValueError(f"text {text!r} does not read as {code}")
    else:
        text = None
    return code, pattern, text


# ---- the rotation ---------------------------------------------------------------

def rotate(
    prev_schedule: Schedule,
    config: RotationConfig,
    cycle: Cycle,
    answers: Mapping[str, Mapping[str, str]] | None = None,
    *,
    people: Sequence[RosterPerson] | None = None,
    history: Schedule | None = None,
    replaces: Mapping[str, str] | None = None,
) -> RotationResult:
    """Build the new cycle's schedule (no leave); see the module docstring."""
    prev = previous_cycle(cycle)
    answers_by_key = {name_key(k): v for k, v in (answers or {}).items()}
    replaces_by_key = {name_key(k): v for k, v in (replaces or {}).items()}
    roster_by_key = {name_key(p.name): p for p in people or ()}
    names = [p.name for p in people] if people else [p.name for p in config.people]
    warnings: list[str] = []

    def prev_cells(name: str) -> Mapping[date, str]:
        return {d: t for d, t in prev_schedule.get(name, {}).items() if prev.contains(d)}

    def team_of(name: str) -> str:
        rp = roster_by_key.get(name_key(name))
        if rp is not None:
            return rp.team_label
        cp = config.find(name)
        return (cp.subteam or cp.team) if cp else ""

    states: dict[str, PersonState | None] = {}
    source: dict[str, str] = {}  # whose cells a person's state/history comes from
    for name in names:
        source[name] = name
        st = derive_state(prev_cells(name), prev)
        if st is None and name_key(name) in replaces_by_key:
            old = replaces_by_key[name_key(name)]
            st = derive_state(prev_cells(old), prev)
            if st is not None:
                source[name] = old
        states[name] = st

    team_texts: dict[tuple[str, str], Counter] = {}

    def team_counter(team: str, code: str) -> Counter:
        key = (team, code)
        if key not in team_texts:
            c: Counter = Counter()
            for n in names:
                if team_of(n) != team:
                    continue
                for d, raw in prev_cells(n).items():
                    parsed = try_parse_code(raw)
                    if parsed is not None and parsed.canonical == code and raw.strip():
                        c[raw] += 1
            team_texts[key] = c
        return team_texts[key]

    def own_history(name: str) -> dict[date, str]:
        src = source[name]
        merged = dict((history or {}).get(src, {}))
        merged.update(prev_cells(src))
        return merged

    missing: dict[str, str] = {}
    invalid: list[str] = []
    plan: dict[str, tuple[str, str, Pattern]] = {}  # name -> (code, text, pattern)

    def use_answer(name: str, state: PersonState | None) -> None:
        ans = answers_by_key.get(name_key(name))
        try:
            code, pattern, text = _read_answer(name, ans, state)
        except ValueError as exc:
            invalid.append(f"{name}: {exc}")
            return
        if text is None:
            text = choose_text(code, own_history(name), team_counter(team_of(name), code),
                               state, cycle.start)
        plan[name] = (code, text, pattern)

    for name in names:
        cp = config.find(name)
        state = states[name]
        has_answer = name_key(name) in answers_by_key
        if cp is None:
            missing[name] = "not in the rotation config (apply roster changes first)"
            continue
        if state is None:
            if has_answer:
                use_answer(name, None)
            else:
                missing[name] = "no previous-cycle data (new seat): needs shift and pattern"
            continue
        if cp.shift and (cp.shift != state.code):
            warnings.append(f"{name}: config shift {cp.shift} differs from the observed "
                            f"{state.label} in {prev.label}; the observed shift is used")
        if state.unparseable:
            warnings.append(f"{name}: {state.unparseable} unrecognised cell(s) in {prev.label} "
                            "were ignored")
        if cp.rotation in (Rotation.ASK_ME, Rotation.UNCLASSIFIED):
            if has_answer:
                use_answer(name, state)
            else:
                missing[name] = f"{cp.rotation.value}: needs shift and pattern"
            continue
        if has_answer and cp.rotation is Rotation.PERMANENT:
            warnings.append(f"{name}: answer ignored (PERMANENT people are copied forward)")
        pattern = state.pattern
        if pattern is None:
            pattern = default_pattern(state.code) or Pattern.MON_FRI
            warnings.append(f"{name}: weekly-off pattern could not be determined from "
                            f"{prev.label}; assuming {pattern.value}")
        elif not state.pattern_from_weeks:
            warnings.append(f"{name}: weekly-off pattern for {prev.label} inferred from the "
                            "weekdays worked (no clean week)")
        if cp.rotation is Rotation.PERMANENT:
            plan[name] = (state.code, state.text, pattern)
            continue
        # AUTO_SWAP
        partner = partner_shift(state.code)
        if partner is None:
            if has_answer:
                use_answer(name, state)
            else:
                missing[name] = (f"AUTO_SWAP but the current shift {state.label} has no "
                                 "partner (only S1<->S2, S3<->S4)")
            continue
        text = choose_text(partner, own_history(name),
                           team_counter(team_of(name), partner), state, cycle.start)
        plan[name] = (partner, text, default_pattern(partner) or Pattern.MON_FRI)

    if missing:
        raise MissingAnswers(missing)
    if invalid:
        raise InvalidAnswers(invalid)

    schedule: dict[str, dict[date, str]] = {}
    changes: list[ShiftChange] = []
    for name in names:
        code, text, pattern = plan[name]
        row: dict[date, str] = {}
        d = cycle.start
        while d <= cycle.end:
            row[d] = text if works_on(pattern, d) else ""
            d += timedelta(days=1)
        schedule[name] = row
        old = states[name]
        if old is not None and (old.code != code or (old.pattern or pattern) is not pattern
                                or (code == CUSTOM and old.text != text)):
            first = next((d for d, t in row.items() if t), None)
            changes.append(ShiftChange(name, old.label, text.strip() if code == CUSTOM else code,
                                       cycle.start, first, old.pattern, pattern))

    warnings.extend(_headcount_warnings(names, states, plan, team_of))
    return RotationResult(schedule, changes, warnings,
                          {n: s for n, s in states.items() if s is not None})


def _headcount_warnings(names, states, plan, team_of) -> list[str]:
    before: dict[str, Counter] = defaultdict(Counter)
    after: dict[str, Counter] = defaultdict(Counter)
    for name in names:
        old = states[name]
        if old is None:
            continue  # a new seat legitimately changes headcount
        team = team_of(name)
        before[team][old.code if old.code != CUSTOM else old.label] += 1
        new_code, new_text, _ = plan[name]
        after[team][new_code if new_code != CUSTOM else new_text.strip()] += 1
    out = []
    for team in sorted(set(before) | set(after)):
        for code in sorted(set(before[team]) | set(after[team])):
            if before[team][code] != after[team][code]:
                out.append(f"Headcount changed for team {team or '(none)'}: {code} "
                           f"{before[team][code]} -> {after[team][code]}")
    return out
