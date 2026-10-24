"""
Periodic weekly-template rotation (category `PATTERN`).

Some teams do not rotate with a plain shift swap: a GROUP of people share a duty that moves
between them on a timetable, e.g. three people taking turns on the weekend shift with
Sunday on-call, while two of them also swap their weekday shifts every six weeks, or two
people alternating the on-call weekends. Each person's week (Sunday..Saturday, 7 raw cell
texts) is then one of a few templates, and the sequence of templates repeats with a period
of P weeks (the whole group together: the members are interdependent).

    detect_pattern(cells_by_person, weeks)   find the smallest period and the templates
    continue_pattern(detection, cycle)       extend them into a cycle, continuing the phase
    plan_pattern_groups(...)                 the above for every PATTERN group of a config

Pure functions: no files, no randomness. Names appear only in the data passed in.

Detection
  A week's evidence per person is 7 cell tokens. Tokens are canonical (`S3`, `OC`, a custom
  time range, blank) so "ON-call" and "On-call" are the same on-call; the RAW text is kept for
  writing. Leave codes (P, T, SL, HOL, COMP) are noise and act as wildcards (a day off in a
  duty week says nothing about the template); blank cells are real evidence (a weekly off).
  Weeks before a person's first non-blank cell are wildcards too (a new joiner has no pattern
  yet). Candidate periods P = 1..`max_period`; week i is compared with week i-P cell by cell
  (wildcards skipped). The smallest P whose agreement is at least `min_confidence` over at
  least `min_overlap` compared weeks wins; with fewer than P + `min_overlap` weeks of history
  a long period cannot be proven and the group is NOT detected (never guessed). The template
  of phase k is, per person and weekday, the most frequent token seen in the weeks of that
  phase (ties: the latest) and the most frequent raw text used for it.
  `period` forces P (a config override) and then only needs one compared week.

Phase
  Phase is date arithmetic: `((sunday - anchor).days // 7) % P`, where `anchor` is the Sunday
  that starts template 0. It never resets at a cycle or year boundary; a cycle always starts
  on a Sunday so every cycle is a whole number of weeks and no cell is written twice or
  skipped (a weekend that starts on the last Saturday of one cycle and ends with the Sunday
  on-call of the next is covered by consecutive phases).

Stored state
  The learned templates, period and anchor are saved in the config (`pattern_groups[id]`) so
  the NEXT-YEAR file, which holds only a few weeks, can continue a rotation whose period is
  longer than its history. History is preferred when it proves a pattern; otherwise the stored
  state is used when the weeks that ARE in the file agree with it (>= `min_confidence`).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Mapping, Sequence

from .codes import BLANK, CUSTOM, is_leave_code, try_parse_code
from .config import RotationConfig, name_key
from .cycles import Cycle, weeks as cycle_weeks

DEFAULT_MAX_PERIOD_WEEKS = 52
DEFAULT_MIN_OVERLAP_WEEKS = 6
DEFAULT_MIN_CONFIDENCE = 0.95
OBSERVED_WEEKS_REPORTED = 4

Token = str | None  # None = wildcard (leave noise / no data); "" = blank (weekly off)


# ---- tokens -----------------------------------------------------------------------------

def cell_token(raw: str | None) -> Token:
    """Canonical evidence of one cell: None for leave/no data, "" for blank, else a code."""
    if raw is None:
        return None
    parsed = try_parse_code(raw)
    if parsed is None:
        return "?" + " ".join(raw.split()).casefold()  # unknown text is compared as written
    if parsed.canonical == BLANK:
        return ""
    if is_leave_code(parsed.canonical):
        return None
    if parsed.canonical == CUSTOM:
        return "C:" + " ".join((parsed.custom or raw).split()).casefold()
    return parsed.canonical


def _canonical_text(token: str) -> str:
    if token in ("S1", "S2", "S3", "S4", "S5"):
        return f"Shift-{token[1]}"
    if token.startswith(("C:", "?")):
        return token.split(":", 1)[-1].lstrip("?")
    return token


def sunday_of(d: date) -> date:
    return d - timedelta(days=(d.weekday() + 1) % 7)


# ---- the detection result -----------------------------------------------------------------

@dataclass(frozen=True)
class PatternDetection:
    group: str
    members: tuple[str, ...]
    detected: bool
    period: int | None
    confidence: float | None  # share of agreeing cells over the compared weeks
    anchor: date | None  # the Sunday that starts template 0
    source: str  # "history" | "stored" | "override" | "none"
    overlap_weeks: int  # weeks that were compared with the week one period earlier
    weeks_observed: int
    reason: str
    templates: Mapping[str, tuple[tuple[str, ...], ...]] = field(default_factory=dict)
    unknown_cells: int = 0  # template cells never observed (filled from the person's habit)
    observed: tuple[tuple[date, int], ...] = ()  # (sunday, phase) of the last observed weeks
    inactive: tuple[str, ...] = ()  # members with no data at all: not part of the pattern

    def phase_of(self, sunday: date) -> int:
        assert self.period and self.anchor
        return ((sunday_of(sunday) - self.anchor).days // 7) % self.period

    def week_texts(self, name: str, sunday: date) -> tuple[str, ...]:
        """The 7 raw texts (Sunday..Saturday) of `name` in the week starting `sunday`."""
        return self.templates[name][self.phase_of(sunday)]

    def works(self, name: str, d: date) -> bool | None:
        """Whether the template has `name` working (a non-blank cell) on `d`; None when the
        person is not part of the detected pattern."""
        if not self.detected or name not in self.templates:
            return None
        return bool(self.week_texts(name, sunday_of(d))[(d.weekday() + 1) % 7].strip())

    def to_config(self) -> dict[str, Any]:
        """The `pattern_groups[id]` entry that stores this detection."""
        assert self.detected and self.period and self.anchor
        return {"period_weeks": self.period, "anchor": self.anchor.isoformat(),
                "template": {n: [list(w) for w in weeks_] for n, weeks_ in self.templates.items()}}

    # -- description ---------------------------------------------------------------------
    def duty(self) -> dict[str, Any]:
        """The weekend/on-call channel of the templates: its own (shorter) period, the people
        who hold it and how many consecutive weeks one person keeps a Saturday duty."""
        if not self.detected or not self.period:
            return {}
        names = list(self.templates)
        p = self.period

        def signature(ph: int):
            return tuple((self.templates[n][ph][0] != "") * 1 + 2 * (self.templates[n][ph][6] != "")
                         for n in names)

        sigs = [signature(ph) for ph in range(p)]
        duty_period = next((d for d in range(1, p + 1)
                            if p % d == 0 and all(sigs[i] == sigs[(i + d) % p] for i in range(p))), p)
        holders = [n for n in names if any(self.templates[n][ph][6] or self.templates[n][ph][0]
                                           for ph in range(p))]
        stints: list[int] = []
        for n in names:
            flags = [bool(self.templates[n][ph][6]) for ph in range(p)]
            if not any(flags) or all(flags):
                continue
            start = next(i for i in range(p) if flags[i] and not flags[i - 1])
            run = 0
            for k in range(p):
                if flags[(start + k) % p]:
                    run += 1
                elif run:
                    stints.append(run)
                    run = 0
            if run:
                stints.append(run)
        return {"duty_period_weeks": duty_period, "duty_members": len(holders),
                "weekend_stint_weeks": (max(set(stints), key=stints.count) if stints else None)}

    def summary(self, start: date | None = None) -> str:
        if not self.detected:
            return f"{self.group}: pattern not detected ({self.reason})"
        text = f"{self.group}: {self.period}-week pattern"
        duty = self.duty()
        if duty.get("duty_members"):
            text += (f" ({duty['duty_members']} people share the weekend/on-call duty, repeating "
                     f"every {duty['duty_period_weeks']} weeks")
            if duty.get("weekend_stint_weeks"):
                text += f", {duty['weekend_stint_weeks']} week(s) per turn"
            text += ")"
        if start is not None and self.period:
            text += f", continuing from week {self.phase_of(start) + 1} of {self.period}"
        return text


# ---- detection ----------------------------------------------------------------------------

def _week_tokens(raw: tuple[str | None, ...]) -> tuple[Token, ...]:
    return tuple(cell_token(r) for r in raw)


def _prepare(cells_by_person: Mapping[str, Mapping[date, str]], sundays: Sequence[date]):
    """-> (names with data, {week number: {name: (raw7, tokens7)}}, base Sunday)."""
    sundays = sorted({sunday_of(s) for s in sundays})
    names = list(cells_by_person)
    active: dict[str, int] = {}  # first week index with a non-blank cell
    for n in names:
        cells = cells_by_person[n]
        for i, s in enumerate(sundays):
            if any((cells.get(s + timedelta(days=k)) or "").strip() for k in range(7)):
                active[n] = i
                break
    base = sundays[0] if sundays else None
    weeks_: dict[int, dict[str, tuple[tuple[str | None, ...], tuple[Token, ...]]]] = {}
    for i, s in enumerate(sundays):
        wn = (s - base).days // 7
        row = {}
        for n in names:
            if n not in active:
                continue
            if i < active[n]:
                raw = (None,) * 7  # not yet on the team: wildcard
            else:
                cells = cells_by_person[n]
                raw = tuple(cells.get(s + timedelta(days=k)) for k in range(7))
            row[n] = (raw, _week_tokens(raw))
        weeks_[wn] = row
    return list(active), weeks_, base


def _agreement(weeks_: Mapping[int, Mapping[str, tuple]], names: Sequence[str], p: int
               ) -> tuple[int, int, int]:
    """(matched cells, compared cells, compared weeks) of week i against week i-p."""
    matched = compared = pairs = 0
    for wn, row in weeks_.items():
        prior = weeks_.get(wn - p)
        if prior is None:
            continue
        pairs += 1
        for n in names:
            a, b = row[n][1], prior[n][1]
            for x, y in zip(a, b):
                if x is None or y is None:
                    continue
                compared += 1
                matched += x == y
    return matched, compared, pairs


def _divisors(p: int) -> list[int]:
    return [d for d in range(1, p + 1) if p % d == 0]


def _cell_consensus(seq: Mapping[int, str], p: int, tolerance: int) -> tuple[int, dict[int, str]]:
    """The smallest divisor d of `p` at which one cell position (one person, one weekday) has a
    d-week cycle, and the consensus token per residue mod d.

    d is accepted when at most `tolerance` weeks disagree with the d-week consensus AND no
    disagreeing token is confirmed by a second week of the same phase (mod p): a lone
    exception (one on-call typed on one Saturday) is outvoted by the weeks of its sub-cycle
    instead of being copied into the next period, while a pattern seen twice is kept. d = p
    is the plain per-phase vote and is always acceptable."""
    for d in _divisors(p):
        votes: dict[int, dict[str, list]] = {}
        for wn, tok in seq.items():
            v = votes.setdefault(wn % d, {}).setdefault(tok, [0, wn])
            v[0] += 1
            v[1] = max(v[1], wn)
        consensus = {r: max(t, key=lambda x: (t[x][0], t[x][1])) for r, t in votes.items()}
        if d == p:
            return d, consensus
        wrong = [wn for wn, tok in seq.items() if tok != consensus[wn % d]]
        phases = Counter(wn % p for wn in wrong)
        if len(wrong) <= tolerance and all(c < 2 for c in phases.values()):
            return d, consensus
    raise AssertionError("unreachable")  # d == p always returns


def _build_templates(weeks_: Mapping[int, Mapping[str, tuple]], names: Sequence[str], p: int,
                     min_confidence: float = DEFAULT_MIN_CONFIDENCE
                     ) -> tuple[dict[str, tuple[tuple[str, ...], ...]], int]:
    """Per phase, person and weekday: the consensus token (see `_cell_consensus`) and the most
    frequent raw text used for it. -> (templates, number of cells never observed)."""
    templates: dict[str, list[list[str]]] = {n: [[""] * 7 for _ in range(p)] for n in names}
    unknown = 0
    habit_raw: dict[tuple[str, str], Counter] = {}
    habit_tok: dict[tuple[str, int], Counter] = {}
    for wn, row in weeks_.items():
        for n in names:
            raw, tok = row[n]
            for k in range(7):
                if tok[k] is None:
                    continue
                habit_tok.setdefault((n, k), Counter())[tok[k]] += 1
                if raw[k] is not None:
                    habit_raw.setdefault((n, tok[k]), Counter())[raw[k]] += 1
    for n in names:
        for k in range(7):
            seq = {wn: row[n][1][k] for wn, row in weeks_.items() if row[n][1][k] is not None}
            tolerance = int((1 - min_confidence) * len(seq) + 1e-9)
            d, consensus = _cell_consensus(seq, p, tolerance) if seq else (p, {})
            for ph in range(p):
                token = consensus.get(ph % d)
                text = None
                if token is not None:
                    raws: Counter = Counter()
                    last: dict[str, int] = {}
                    for wn, row in weeks_.items():
                        if wn % d == ph % d and row[n][1][k] == token and row[n][0][k] is not None:
                            raws[row[n][0][k]] += 1
                            last[row[n][0][k]] = wn
                    if raws:
                        text = max(raws, key=lambda r: (raws[r], last[r]))
                else:
                    unknown += 1
                    habit = habit_tok.get((n, k))
                    token = habit.most_common(1)[0][0] if habit else ""
                if text is None:
                    h = habit_raw.get((n, token))
                    text = (max(h, key=lambda r: (h[r], r)) if h else
                            ("" if token == "" else _canonical_text(token)))
                templates[n][ph][k] = "" if token == "" else text
    return {n: tuple(tuple(w) for w in templates[n]) for n in names}, unknown


def detect_pattern(
    cells_by_person: Mapping[str, Mapping[date, str]],
    weeks: Sequence[date],
    *,
    group: str = "",
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
    max_period: int = DEFAULT_MAX_PERIOD_WEEKS,
    min_overlap: int = DEFAULT_MIN_OVERLAP_WEEKS,
    period: int | None = None,
) -> PatternDetection:
    """Find the smallest period (in weeks) at which a group's weekly templates repeat.

    `cells_by_person` is `{name: {date: raw text}}`, `weeks` the Sundays of the weeks to read
    (whole Sunday-Saturday weeks that exist in the data). See the module docstring. Never
    guesses: when nothing repeats well enough the result is `detected=False` with a reason."""
    members = tuple(cells_by_person)
    sundays = sorted({sunday_of(s) for s in weeks})
    names, weeks_, base = _prepare(cells_by_person, sundays)
    inactive = tuple(n for n in members if n not in names)
    n_weeks = len(sundays)

    def fail(reason: str, **kw) -> PatternDetection:
        return PatternDetection(group, members, False, None, kw.get("confidence"), None, "none",
                                kw.get("overlap", 0), n_weeks, reason, inactive=inactive)

    if not names:
        return fail("no member has any data in the roster")
    working = sum(1 for row in weeks_.values() for n in names for t in row[n][1] if t)
    if not working:
        return fail("no member has a working cell in the weeks read")
    if n_weeks < 2:
        return fail(f"only {n_weeks} whole week(s) of history")
    span = (sundays[-1] - sundays[0]).days // 7 + 1

    candidates = [period] if period else range(1, min(max_period, span - 1) + 1)
    best: tuple[float, int, int] | None = None
    chosen = None
    for p in candidates:
        if p > span - 1 and not period:
            break
        matched, compared, pairs = _agreement(weeks_, names, p)
        if not compared:
            continue
        conf = matched / compared
        needed = 1 if period else min_overlap
        if pairs >= needed and (best is None or conf > best[0]):
            best = (conf, p, pairs)
        if pairs >= needed and conf >= min_confidence - 1e-12:
            chosen = (p, conf, pairs)
            break
    if chosen is None:
        if period:
            return fail(f"the configured period of {period} weeks does not repeat in the "
                        f"{n_weeks} weeks of history"
                        + (f" (agreement {best[0]:.0%} over {best[2]} weeks)" if best else
                           f" (needs more than {period} weeks)"),
                        confidence=best[0] if best else None, overlap=best[2] if best else 0)
        detail = (f"; the best candidate, {best[1]} weeks, agrees on {best[0]:.0%} of cells over "
                  f"{best[2]} weeks" if best else "")
        return fail(f"no weekly pattern of up to {min(max_period, span - 1)} weeks repeats "
                    f"in the {n_weeks} weeks of history (needs {min_confidence:.0%} agreement over "
                    f"at least {min_overlap} weeks{detail})",
                    confidence=best[0] if best else None, overlap=best[2] if best else 0)

    p, conf, pairs = chosen
    templates, unknown = _build_templates(weeks_, names, p, min_confidence)
    last = sorted(weeks_)[-OBSERVED_WEEKS_REPORTED:]
    observed = tuple((base + timedelta(days=7 * wn), wn % p) for wn in last)
    return PatternDetection(
        group, members, True, p, conf, base, "override" if period else "history", pairs, n_weeks,
        f"{p}-week pattern, {conf:.0%} of cells agree over {pairs} compared weeks",
        templates, unknown, observed, inactive)


def stored_detection(group: str, members: Sequence[str], settings: Mapping[str, Any]
                     ) -> PatternDetection | None:
    """The detection stored in the config (`pattern_groups[id]`), or None if it has none."""
    template = settings.get("template")
    if not template or not settings.get("anchor") or not settings.get("period_weeks"):
        return None
    by_key = {name_key(n): n for n in members}
    templates = {by_key[name_key(n)]: tuple(tuple(w) for w in weeks_)
                 for n, weeks_ in template.items() if name_key(n) in by_key}
    if not templates:
        return None
    return PatternDetection(
        group, tuple(members), True, int(settings["period_weeks"]), None,
        date.fromisoformat(settings["anchor"]), "stored", 0, 0,
        "stored in the config", templates)


def verify(detection: PatternDetection, cells_by_person: Mapping[str, Mapping[date, str]],
           weeks: Sequence[date]) -> tuple[float | None, int]:
    """Agreement of a (stored) detection with the weeks that are in the data:
    (share of agreeing cells, weeks compared); None when nothing could be compared."""
    matched = compared = 0
    pairs = 0
    for s in sorted({sunday_of(w) for w in weeks}):
        week_hit = False
        for n, template in detection.templates.items():
            cells = cells_by_person.get(n)
            if not cells:
                continue
            want = detection.week_texts(n, s)
            for k in range(7):
                got = cell_token(cells.get(s + timedelta(days=k)))
                if got is None:
                    continue
                compared += 1
                week_hit = True
                matched += got == cell_token(want[k])
        pairs += week_hit
    return (matched / compared if compared else None), pairs


def continue_pattern(detection: PatternDetection, cycle: Cycle) -> dict[str, dict[date, str]]:
    """Every cell of `cycle` for the detected group: `{name: {date: raw text}}`, written with
    the exact raw strings each person used for the template (including on-call strings).
    The phase continues by date from the anchor, so it does not reset at a cycle start."""
    if not detection.detected:
        raise ValueError("cannot continue a pattern that was not detected")
    out: dict[str, dict[date, str]] = {n: {} for n in detection.templates}
    for sunday, _saturday in cycle_weeks(cycle):
        for n in detection.templates:
            texts = detection.week_texts(n, sunday)
            for k in range(7):
                out[n][sunday + timedelta(days=k)] = texts[k]
    return out


# ---- groups of a config -------------------------------------------------------------------

def history_weeks(cells_by_person: Mapping[str, Mapping[date, str]], before: date
                  ) -> list[date]:
    """The Sundays of every whole Sunday-Saturday week that lies before `before` and is fully
    present (all 7 dates) for at least one person; weeks only partly in the file are skipped."""
    dates: set[date] = set()
    for cells in cells_by_person.values():
        dates.update(d for d in cells if d < before)
    out = []
    for s in sorted({sunday_of(d) for d in dates}):
        if s + timedelta(days=6) < before and all(
                any(s + timedelta(days=k) in cells for cells in cells_by_person.values())
                for k in range(7)):
            out.append(s)
    return out


@dataclass(frozen=True)
class GroupPlan:
    """One PATTERN group planned for one cycle."""

    group: str
    members: tuple[str, ...]  # config order
    detection: PatternDetection
    cycle: Cycle

    @property
    def detected(self) -> bool:
        return self.detection.detected

    def rows(self) -> dict[str, dict[date, str]]:
        return continue_pattern(self.detection, self.cycle) if self.detected else {}

    def report(self) -> dict[str, Any]:
        d = self.detection
        out: dict[str, Any] = {
            "group": self.group, "members": len(self.members), "detected": d.detected,
            "source": d.source, "reason": d.reason,
            "period_weeks": d.period, "confidence": None if d.confidence is None
            else round(d.confidence, 4),
            "overlap_weeks": d.overlap_weeks, "weeks_observed": d.weeks_observed,
            "anchor": d.anchor.isoformat() if d.anchor else None,
            "start_phase": None, "observed_phases": [], "unknown_cells": d.unknown_cells,
            "inactive_members": len(d.inactive), "summary": d.summary(self.cycle.start)}
        if d.detected:
            out["start_phase"] = d.phase_of(self.cycle.start)
            out["observed_phases"] = [[s.isoformat(), ph] for s, ph in d.observed]
            out.update(d.duty())
        return out


def plan_pattern_groups(
    config: RotationConfig, roster_names: Sequence[str],
    schedule: Mapping[str, Mapping[date, str]], cycle: Cycle, *,
    history: Mapping[str, Mapping[date, str]] | None = None,
    max_period: int = DEFAULT_MAX_PERIOD_WEEKS, min_overlap: int = DEFAULT_MIN_OVERLAP_WEEKS,
) -> dict[str, GroupPlan]:
    """Plan every PATTERN group of `config` for `cycle`: `{group id: GroupPlan}`.

    Members are the PATTERN people of the group who are on the roster (`roster_names`).
    History = `schedule` (+ the older `history`) before the cycle start: detection from
    history first, else the state stored in the config when the weeks in the file agree with
    it, else not detected."""
    on_roster = {name_key(n): n for n in roster_names}
    plans: dict[str, GroupPlan] = {}
    for gid, people in config.pattern_group_members().items():
        names = [on_roster[name_key(p.name)] for p in people if name_key(p.name) in on_roster]
        if not names:
            continue
        merged = {}
        for n in names:
            cells = dict((history or {}).get(n, {}))
            cells.update(schedule.get(n, {}))
            merged[n] = cells
        weeks_ = history_weeks(merged, cycle.start)
        settings = config.pattern_group_settings(gid)
        threshold = config.pattern_min_confidence
        period = settings.get("period_weeks") if not settings.get("template") else None
        det = detect_pattern(merged, weeks_, group=gid, min_confidence=threshold,
                             max_period=max_period, min_overlap=min_overlap, period=period)
        if not det.detected:
            stored = stored_detection(gid, names, settings)
            if stored is not None:
                conf, pairs = verify(stored, merged, weeks_)
                if conf is not None and pairs >= 1 and conf >= threshold - 1e-12:
                    det = PatternDetection(
                        gid, tuple(names), True, stored.period, conf, stored.anchor, "stored",
                        pairs, len(weeks_),
                        f"continued from the state stored in the config: {conf:.0%} of cells "
                        f"agree over the {pairs} week(s) in the roster",
                        stored.templates, 0, (), det.inactive)
                else:
                    shown = "no week to compare" if conf is None else f"{conf:.0%} agreement"
                    det = PatternDetection(
                        gid, tuple(names), False, None, conf, None, "none", pairs, len(weeks_),
                        det.reason + f"; the stored pattern does not fit the roster ({shown})",
                        inactive=det.inactive)
        plans[gid] = GroupPlan(gid, tuple(names), det, cycle)
    return plans
