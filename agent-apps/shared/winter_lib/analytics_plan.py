"""
Analytics winter plan solver: a small MILP (HiGHS via scipy.optimize.milp).

Hard rules (always exact; never traded against preferences):
  cover            every slot of the template is filled
  one_slot_per_day nobody works two slots on the same day
  on_call_day_free nobody works a slot on their own on-call day
  one_on_call      exactly one person is on call every day
  on_call_days     each on-call person gets their share of on-call days (8 days / 2 = 4)
  slot_counts      each person works their standard number of slots (4; on-call people 1;
                   fewer when availability does not allow it); extra slots needed to fill the
                   grid go to eligible people and are reported in `notes`
  availability     nobody is placed (slot or on call) on a day they are not available

Soft preferences (weights in config.weights, minimised):
  usual_shift      stay on the shift type the person usually works (Oct/Nov rosters)
  holiday          1-2 holiday/weekend duty days per person (a slot or on-call day on a
                   holiday/weekend date counts)
  block            slot days in one contiguous block
  oncall_block     on-call days in one contiguous block (halves)
  turnaround       no late shift (S3) followed by an early shift (S1) the next day
  extra_slot       taking a slot beyond the standard count

Deterministic: variables are built in sorted order, solved to proven optimality
(mip_rel_gap 0) and ties are broken by tiny cost perturbations drawn from
random.Random(config.seed). Infeasibility never raises: the plan comes back with
status "infeasible" and `problems` naming the rule(s) that cannot be met.
"""

from __future__ import annotations

import hashlib
import json
import random
from dataclasses import dataclass, field
from datetime import date, time
from typing import Iterable, Optional

import numpy as np
from scipy.optimize import milp, LinearConstraint, Bounds
from scipy.sparse import coo_matrix

from .analytics_config import (
    AnalyticsConfig, IST_CODES, MEXICO, ON_CALL_LABEL, PersonCfg, ROLE_ON_CALL, ROLE_SUPPORT, SlotSpec,
)

RULES = ("one_slot_per_day", "on_call_day_free", "one_on_call", "on_call_days", "slot_counts", "availability")

RULE_TEXT = {
    "cover": "the slots cannot all be covered by the people available",
    "one_slot_per_day": "no person may work two slots on the same day",
    "on_call_day_free": "no person may work a slot on their own on-call day",
    "one_on_call": "exactly one person must be on call every day",
    "on_call_days": "the on-call days cannot be shared out as configured",
    "slot_counts": "the slot counts per person cannot add up to the slots in the template",
    "availability": "people's availability leaves some slots or on-call days without anyone",
}

BIG = 100.0  # cost of a deficit slot (fewer than standard); never chosen unless forced


@dataclass(frozen=True)
class SlotRow:
    """One row of the slot template with its display label (S2-A / S2-B when a code repeats)."""

    date: date
    code: str
    label: str
    start: time
    zone: str


def slot_template_rows(config: AnalyticsConfig) -> list[SlotRow]:
    """The slot grid as ordered rows with labels; the same order the workbook uses."""
    ordered = sorted(config.slots, key=lambda s: (s.date, s.start, s.code, s.zone))
    totals: dict[tuple[date, str], int] = {}
    for s in ordered:
        totals[(s.date, s.code)] = totals.get((s.date, s.code), 0) + 1
    seen: dict[tuple[date, str], int] = {}
    rows: list[SlotRow] = []
    for s in ordered:
        k = (s.date, s.code)
        i = seen.get(k, 0)
        seen[k] = i + 1
        label = s.code if totals[k] == 1 else f"{s.code}-{chr(ord('A') + i)}"
        rows.append(SlotRow(s.date, s.code, label, s.start, s.zone))
    return rows


@dataclass(frozen=True)
class Assignment:
    date: date
    code: str
    label: str
    start: time
    zone: str
    person: str  # display name

    def to_dict(self) -> dict[str, str]:
        return {"date": self.date.isoformat(), "code": self.code, "label": self.label,
                "start": self.start.strftime("%H:%M"), "zone": self.zone, "person": self.person}


@dataclass
class AnalyticsPlan:
    status: str  # "optimal" | "feasible" | "infeasible"
    assignments: list[Assignment] = field(default_factory=list)
    on_call: dict[date, str] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)  # plain-English notes for the PMO
    problems: list[str] = field(default_factory=list)  # rules that cannot be met (infeasible)
    counts: dict[str, int] = field(default_factory=dict)  # slots per person
    on_call_counts: dict[str, int] = field(default_factory=dict)
    metrics: dict[str, int] = field(default_factory=dict)  # soft-preference tallies
    objective: Optional[float] = None
    plan_hash: str = ""
    config_hash: str = ""
    seed: int = 0

    @property
    def ok(self) -> bool:
        return self.status in ("optimal", "feasible")

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "assignments": [a.to_dict() for a in self.assignments],
            "on_call": {d.isoformat(): p for d, p in sorted(self.on_call.items())},
            "notes": list(self.notes),
            "problems": list(self.problems),
            "counts": dict(self.counts),
            "on_call_counts": dict(self.on_call_counts),
            "metrics": dict(self.metrics),
            "plan_hash": self.plan_hash,
            "config_hash": self.config_hash,
            "seed": self.seed,
        }


# ---- hashing -----------------------------------------------------------------

def config_hash(config: AnalyticsConfig) -> str:
    blob = json.dumps(config.to_dict(), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def hash_assignments(assignments: Iterable[Assignment], on_call: dict[date, str]) -> str:
    """Stable hash of every assignment and on-call day (what the workbook is built from)."""
    rows = sorted((a.date.isoformat(), a.start.strftime("%H:%M"), a.label, a.person) for a in assignments)
    oc = sorted((d.isoformat(), p) for d, p in on_call.items())
    return hashlib.sha256(json.dumps([rows, oc], ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


# ---- model builder -----------------------------------------------------------

class _Model:
    def __init__(self) -> None:
        self.cost: list[float] = []
        self.lb: list[float] = []
        self.ub: list[float] = []
        self.integer: list[int] = []
        self.rows: list[int] = []
        self.cols: list[int] = []
        self.vals: list[float] = []
        self.con_lo: list[float] = []
        self.con_hi: list[float] = []

    def var(self, cost: float = 0.0, lb: float = 0.0, ub: float = 1.0, integer: bool = True) -> int:
        self.cost.append(cost)
        self.lb.append(lb)
        self.ub.append(ub)
        self.integer.append(1 if integer else 0)
        return len(self.cost) - 1

    def con(self, terms: Iterable[tuple[int, float]], lo: float, hi: float) -> None:
        r = len(self.con_lo)
        merged: dict[int, float] = {}
        for c, v in terms:
            merged[c] = merged.get(c, 0.0) + v
        for c, v in merged.items():
            if v != 0.0:
                self.rows.append(r)
                self.cols.append(c)
                self.vals.append(v)
        self.con_lo.append(lo)
        self.con_hi.append(hi)

    def solve(self, time_limit: float):
        n = len(self.cost)
        a = coo_matrix((self.vals, (self.rows, self.cols)), shape=(len(self.con_lo), n)).tocsr()
        return milp(
            c=np.array(self.cost),
            constraints=LinearConstraint(a, np.array(self.con_lo), np.array(self.con_hi)),
            integrality=np.array(self.integer),
            bounds=Bounds(np.array(self.lb), np.array(self.ub)),
            options={"time_limit": float(time_limit), "mip_rel_gap": 0.0, "presolve": True, "disp": False},
        )


def _standard_counts(config: AnalyticsConfig) -> dict[str, int]:
    """Standard slot count per IST person (before extras), cut down by availability."""
    out: dict[str, int] = {}
    n_days = len(config.dates)
    for p in config.ist_people:
        want = config.on_call_slots_each if p.role == ROLE_ON_CALL else config.slots_per_person
        avail = n_days if p.available is None else len(p.available)
        out[p.key] = min(want, avail)
    return out


class _Built:
    """A built model plus the variable maps needed to read a solution back."""

    def __init__(self) -> None:
        self.m = _Model()
        self.x: dict[tuple[str, date, str], int] = {}
        self.oc: dict[tuple[str, date], int] = {}
        self.extra: dict[str, int] = {}
        self.deficit: dict[str, int] = {}


def _build(config: AnalyticsConfig, relax: frozenset[str]) -> _Built:
    b = _Built()
    m = b.m
    rng = random.Random(config.seed)
    w = config.weights
    dates = config.dates
    didx = {d: i for i, d in enumerate(dates)}
    people = config.ist_people
    oc_people = [p for p in people if p.role == ROLE_ON_CALL]
    n_oc = len(oc_people)

    # per (date, code) slot demand, IST only
    demand: dict[tuple[date, str], int] = {}
    start_of: dict[tuple[date, str], time] = {}
    for s in config.ist_slots:
        demand[(s.date, s.code)] = demand.get((s.date, s.code), 0) + 1
        start_of[(s.date, s.code)] = s.start
    keys = sorted(demand)

    def avail(p: PersonCfg, d: date) -> bool:
        return "availability" in relax or p.is_available(d)

    # slot variables (sorted creation order = deterministic)
    for pi, p in enumerate(people):
        for (d, c) in keys:
            if not avail(p, d):
                continue
            cost = 0.0
            if p.usual_shift in IST_CODES and c in IST_CODES:
                cost += w.usual_shift * abs(IST_CODES.index(p.usual_shift) - IST_CODES.index(c))
            cost += 1e-4 * rng.random()
            b.x[(p.key, d, c)] = m.var(cost)
    for p in oc_people:
        for d in dates:
            if avail(p, d):
                b.oc[(p.key, d)] = m.var(1e-4 * rng.random())

    def xs(p: PersonCfg, d: date) -> list[int]:
        return [b.x[(p.key, d, c)] for c in IST_CODES if (p.key, d, c) in b.x]

    # cover (never relaxed)
    for (d, c) in keys:
        m.con([(b.x[(p.key, d, c)], 1.0) for p in people if (p.key, d, c) in b.x], demand[(d, c)], demand[(d, c)])

    # one slot per person per day
    if "one_slot_per_day" not in relax:
        for p in people:
            for d in dates:
                v = xs(p, d)
                if len(v) > 1:
                    m.con([(i, 1.0) for i in v], 0, 1)

    # no slot on own on-call day
    if "on_call_day_free" not in relax:
        for p in oc_people:
            for d in dates:
                if (p.key, d) in b.oc:
                    m.con([(i, 1.0) for i in xs(p, d)] + [(b.oc[(p.key, d)], 1.0)], 0, 1)

    # exactly one on call per day (relaxed = at most one)
    for d in dates:
        terms = [(b.oc[(p.key, d)], 1.0) for p in oc_people if (p.key, d) in b.oc]
        m.con(terms, 0 if "one_on_call" in relax else 1, 1)

    # on-call days shared out
    if "on_call_days" not in relax and n_oc:
        base, rem = divmod(len(dates), n_oc)
        for p in oc_people:
            terms = [(b.oc[(p.key, d)], 1.0) for d in dates if (p.key, d) in b.oc]
            m.con(terms, base, base + (1 if rem else 0))

    # slot counts, with extras / deficits
    std = _standard_counts(config)
    for p in people:
        base = std[p.key]
        all_x = [i for d in dates for i in xs(p, d)]
        reduced = base < (config.on_call_slots_each if p.role == ROLE_ON_CALL else config.slots_per_person)
        if "slot_counts" in relax:
            continue
        terms = [(i, 1.0) for i in all_x]
        ev = None
        if p.extra_eligible and not reduced:
            ev = b.extra[p.key] = m.var(w.extra_slot + 1e-4 * rng.random())
            terms.append((ev, -1.0))
        dv = b.deficit[p.key] = m.var(BIG + 1e-4 * rng.random())
        terms.append((dv, 1.0))
        m.con(terms, base, base)  # sum x - extra + deficit == base

    # ---- soft terms ----
    hd = set(config.holiday_dates)
    for p in people:
        # holiday / weekend duty days: 1-2
        duty = []
        for d in dates:
            if d in hd:
                duty += [(i, 1.0) for i in xs(p, d)]
                if (p.key, d) in b.oc:
                    duty.append((b.oc[(p.key, d)], 1.0))
        can_hd = any(avail(p, d) for d in dates if d in hd)
        if can_hd and w.holiday > 0:
            lo = m.var(w.holiday, 0, 4, integer=False)
            m.con(duty + [(lo, 1.0)], 1, np.inf)  # duty + lo >= 1
        if w.holiday > 0 and duty:
            hi = m.var(w.holiday, 0, 8, integer=False)
            m.con([(i, -v) for i, v in duty] + [(hi, 1.0)], -2, np.inf)  # hi >= duty - 2

        # contiguous slot days (count runs)
        if w.block > 0:
            for di, d in enumerate(dates):
                cur = xs(p, d)
                if not cur:
                    continue
                s = m.var(w.block, 0, 1, integer=False)
                prev = xs(p, dates[di - 1]) if di > 0 else []
                m.con([(s, 1.0)] + [(i, -1.0) for i in cur] + [(i, 1.0) for i in prev], 0, np.inf)

        # quick turnaround: late shift then early shift next day
        if w.turnaround > 0:
            for di in range(len(dates) - 1):
                d, d2 = dates[di], dates[di + 1]
                late = [b.x[(p.key, d, c)] for (dd, c) in keys if dd == d and (p.key, d, c) in b.x
                        and start_of[(d, c)] >= time(14, 0)]
                early = [b.x[(p.key, d2, c)] for (dd, c) in keys if dd == d2 and (p.key, d2, c) in b.x
                         and start_of[(d2, c)] <= time(8, 0)]
                if late and early:
                    q = m.var(w.turnaround, 0, 1, integer=False)
                    m.con([(q, 1.0)] + [(i, -1.0) for i in late + early], -1, np.inf)  # q >= late+early-1

    # contiguous on-call halves
    if w.oncall_block > 0:
        for p in oc_people:
            for di, d in enumerate(dates):
                if (p.key, d) not in b.oc:
                    continue
                s = m.var(w.oncall_block, 0, 1, integer=False)
                terms = [(s, 1.0), (b.oc[(p.key, d)], -1.0)]
                if di > 0 and (p.key, dates[di - 1]) in b.oc:
                    terms.append((b.oc[(p.key, dates[di - 1])], 1.0))
                m.con(terms, 0, np.inf)
    return b


def _diagnose(config: AnalyticsConfig, limit: float) -> list[str]:
    """Which hard rule(s) make the plan infeasible: relax rules one at a time, then in pairs."""
    short = min(limit, 30.0)
    base_msgs: list[str] = []
    everything = frozenset(RULES)
    if _build(config, everything).m.solve(short).status == 2:
        return [RULE_TEXT["cover"]]
    for r in RULES:
        res = _build(config, frozenset([r])).m.solve(short)
        if res.status in (0, 1) and res.x is not None:
            base_msgs.append(RULE_TEXT[r])
    if base_msgs:
        return base_msgs
    for i, r1 in enumerate(RULES):
        for r2 in RULES[i + 1:]:
            res = _build(config, frozenset([r1, r2])).m.solve(short)
            if res.status in (0, 1) and res.x is not None:
                return [RULE_TEXT[r1], RULE_TEXT[r2]]
    return ["several rules conflict together: " + "; ".join(RULE_TEXT[r] for r in RULES)]


# ---- reading a solution back -------------------------------------------------

def _fmt_dates(dates: list[date]) -> str:
    """`Dec 28-30` / `Dec 28, Dec 30` text for a sorted list of dates."""
    if not dates:
        return "no days"
    runs: list[list[date]] = [[dates[0]]]
    for d in dates[1:]:
        if (d - runs[-1][-1]).days == 1:
            runs[-1].append(d)
        else:
            runs.append([d])
    parts = []
    for r in runs:
        if len(r) == 1:
            parts.append(f"{r[0]:%b} {r[0].day}")
        else:
            same = r[0].month == r[-1].month
            parts.append(f"{r[0]:%b} {r[0].day}–{r[-1].day}" if same
                         else f"{r[0]:%b} {r[0].day}–{r[-1]:%b} {r[-1].day}")
    return ", ".join(parts)


def _ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        suf = "th"
    else:
        suf = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suf}"


def evaluate_preferences(config: AnalyticsConfig, assignments: list[Assignment], on_call: dict[date, str]) -> dict[str, int]:
    """Tally how many soft preferences the plan misses (all counts; 0 = every preference met)."""
    by_person: dict[str, list[Assignment]] = {}
    for a in assignments:
        by_person.setdefault(a.person, []).append(a)
    usual_miss = 0
    turnaround = 0
    block_extra = 0
    holiday_out = 0
    oc_block_extra = 0
    for p in config.ist_people:
        mine = sorted(by_person.get(p.display, []), key=lambda a: a.date)
        for a in mine:
            if p.usual_shift in IST_CODES and a.zone != MEXICO and a.code != p.usual_shift:
                usual_miss += 1
        days = sorted({a.date for a in mine})
        runs = 0
        for i, d in enumerate(days):
            if i == 0 or (d - days[i - 1]).days > 1:
                runs += 1
        block_extra += max(0, runs - 1)
        for a in mine:
            nxt = [b for b in mine if (b.date - a.date).days == 1]
            if a.start >= time(14, 0) and any(b.start <= time(8, 0) for b in nxt):
                turnaround += 1
        oc_days = sorted(d for d, n in on_call.items() if n == p.display)
        ocr = sum(1 for i, d in enumerate(oc_days) if i == 0 or (d - oc_days[i - 1]).days > 1)
        oc_block_extra += max(0, ocr - 1)
        duty = {a.date for a in mine if a.date in config.holiday_dates} | {d for d in oc_days if d in config.holiday_dates}
        can = any(p.is_available(d) for d in config.holiday_dates)
        if (can and len(duty) < 1) or len(duty) > 2:
            holiday_out += 1
    return {"usual_shift_misses": usual_miss, "turnarounds": turnaround, "split_slot_blocks": block_extra,
            "holiday_range_misses": holiday_out, "split_on_call_blocks": oc_block_extra}


def _notes(config: AnalyticsConfig, counts: dict[str, int], oc_counts: dict[str, int]) -> list[str]:
    std = _standard_counts(config)
    notes: list[str] = []
    n_days = len(config.dates)
    for p in config.ist_people:
        want = config.on_call_slots_each if p.role == ROLE_ON_CALL else config.slots_per_person
        got = counts.get(p.display, 0)
        if p.available is not None and std[p.key] < want:
            days = sorted(p.available)
            notes.append(
                f"{p.display} is available {_fmt_dates(days)} only, so works {std[p.key]} "
                f"slot{'s' if std[p.key] != 1 else ''} instead of {want}."
            )
        if got > std[p.key]:
            extra = got - std[p.key]
            where = _ordinal(got)
            notes.append(
                f"{p.display} takes a {where} slot ({extra} more than the standard {std[p.key]}) "
                f"so that all {len(config.ist_slots)} IST slots are filled; this was the best fit "
                f"for the preferences."
            )
        elif got < std[p.key]:
            notes.append(f"{p.display} works {got} slot{'s' if got != 1 else ''}, fewer than the "
                         f"standard {std[p.key]}, because there are more people than slots.")
    n_oc = len(config.on_call_people)
    if n_oc:
        base, rem = divmod(n_days, n_oc)
        if rem:
            notes.append(f"{n_days} on-call days do not divide evenly between {n_oc} people: "
                         + ", ".join(f"{p.display} {oc_counts.get(p.display, 0)}" for p in config.on_call_people) + ".")
    return notes


def solve_analytics_plan(config: AnalyticsConfig) -> AnalyticsPlan:
    """Build the best plan for `config`. Never raises for infeasible inputs."""
    chash = config_hash(config)
    plan = AnalyticsPlan(status="infeasible", config_hash=chash, seed=config.seed)
    rows = slot_template_rows(config)

    # structural problems that need no solver
    mex_people = config.mexico_people
    mex_slots = [r for r in rows if r.zone == MEXICO]
    mex_assign: list[Assignment] = []
    structural: list[str] = []
    if mex_slots:
        per_day: dict[date, int] = {}
        for r in mex_slots:
            per_day[r.date] = per_day.get(r.date, 0) + 1
        if not mex_people:
            structural.append("there are Mexico slots but no Mexico person")
        else:
            doubled = sorted(d for d, n in per_day.items() if n > len(mex_people))
            if doubled:
                structural.append("a Mexico person cannot work two slots on the same day ("
                                  + _fmt_dates(doubled) + ")")
            busy: dict[date, set[str]] = {}
            for r in mex_slots:
                pick = None
                for p in sorted(mex_people, key=lambda q: (sum(1 for a in mex_assign if a.person == q.display), q.display)):
                    if p.is_available(r.date) and p.display not in busy.setdefault(r.date, set()):
                        pick = p
                        break
                if pick is None:
                    structural.append(f"nobody on the Mexico side is available for the Mexico slot on {_fmt_dates([r.date])}")
                    continue
                busy[r.date].add(pick.display)
                mex_assign.append(Assignment(r.date, r.code, r.label, r.start, r.zone, pick.display))
    if structural:
        plan.problems = structural
        return plan

    demand_total = sum(1 for r in rows if r.zone != MEXICO)
    if demand_total == 0 and not config.ist_people:
        plan.status = "optimal"
        plan.assignments = mex_assign
        return plan

    b = _build(config, frozenset())
    res = b.m.solve(config.time_limit_s)
    if res.x is None or res.status not in (0, 1):
        plan.problems = _diagnose(config, config.time_limit_s)
        return plan

    sol = res.x
    chosen: dict[tuple[date, str], list[str]] = {}
    pmap = {p.key: p for p in config.ist_people}
    order = {p.key: i for i, p in enumerate(config.people)}
    for (pk, d, c), idx in sorted(b.x.items(), key=lambda kv: (kv[0][1], kv[0][2], order[kv[0][0]])):
        if sol[idx] > 0.5:
            chosen.setdefault((d, c), []).append(pk)
    assignments: list[Assignment] = list(mex_assign)
    for r in rows:
        if r.zone == MEXICO:
            continue
        who = chosen.get((r.date, r.code), [])
        pk = who.pop(0)
        assignments.append(Assignment(r.date, r.code, r.label, r.start, r.zone, pmap[pk].display))
    assignments.sort(key=lambda a: (a.date, a.start, a.label))
    on_call: dict[date, str] = {}
    for (pk, d), idx in b.oc.items():
        if sol[idx] > 0.5:
            on_call[d] = pmap[pk].display

    counts: dict[str, int] = {p.display: 0 for p in config.people}
    for a in assignments:
        counts[a.person] += 1
    oc_counts: dict[str, int] = {p.display: 0 for p in config.on_call_people}
    for v in on_call.values():
        oc_counts[v] += 1

    plan.status = "optimal" if res.status == 0 else "feasible"
    plan.assignments = assignments
    plan.on_call = dict(sorted(on_call.items()))
    plan.counts = counts
    plan.on_call_counts = oc_counts
    plan.notes = _notes(config, counts, oc_counts)
    plan.metrics = evaluate_preferences(config, assignments, on_call)
    plan.objective = float(res.fun)
    plan.plan_hash = hash_assignments(assignments, on_call)
    if res.status == 1:
        plan.notes.append("The solver hit its time limit; the plan is valid but may not be the best possible.")
    return plan


# Public names for the helpers the workbook and the audit share.
fmt_dates = _fmt_dates
ordinal = _ordinal
standard_counts = _standard_counts
