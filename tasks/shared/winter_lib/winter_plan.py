"""
The main winter coverage plan: a deterministic MILP (HiGHS through scipy.optimize.milp).

Decision variables: x[person, day] in {0, 1} (the person works that day on their USUAL shift; one
slot per person per day by construction). Everything else is a slack or an indicator that lets the
model state each rule as a soft penalty, so the model is ALWAYS feasible: a rule that the data makes
impossible (a team with fewer available people than its minimum, a person unavailable on too many
days) shows up as a reported shortfall, never as a crash or a silently weakened rule.

Hard bounds: nobody works more than their ceiling (`rules.max_days`, 3 for best-effort teams).
Penalised terms (all weights are config values, see `winter_config.Weights`):

    shortfall     people below a team's required minimum on a day       1000 x day weight / head
    nobody        a best-effort team with nobody on a day                100 x day weight
    extra days    the 4th day 400, the 5th day 600 (only if a team needs the slot)
    days short    a person below min_days (only when unavoidable)       5000 / day
    lane          no one in a Morning / Evening / Night-US lane on a day, for teams of 5+ people with a
                  lane of 3+ people                                      60 x day weight
    sub-team      no one from a sub-team (e.g. Complaints, Loyalty)      40 x day weight
    fairness      each person should have 1-2 of the holiday/weekend days (Dec 25-27, Jan 1)   5 / day
    blocks        one contiguous block per person preferred              1 / extra block
    stability     when re-solving with `previous_plan`: every changed person-day   30 / cell

Day weights: weekday 3, holiday 2, weekend 1.

Determinism: HiGHS is deterministic for identical input; on top of that every x gets a tiny
deterministic perturbation (< 1e-3 each, derived from sha256(seed | name | date)) so ties between
equal-cost plans are broken the same way every run. The seed, options, weights, model size, status,
objective, dual bound and optimality gap are logged in `RunInfo`. If HiGHS stops at the time limit
the incumbent is used and `RunInfo.time_limit_hit` is set (timing is the one non-deterministic input).
If no solution at all comes back a deterministic greedy fallback plan is returned and flagged.

API
    solve_winter_plan(people, cfg, previous_plan=None, *, time_limit_s=None) -> WinterPlan
    WinterPlan: window, people, cells {(name, date): canonical shift}, run_info, findings
        .code(name, d), .days_of(name), .headcount(team, d), .to_json(), WinterPlan.from_json(text)
        .plan_hash() (sha256 of the content: window, people, cells; not the run log)
"""

from __future__ import annotations

import hashlib
import json
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Mapping, Optional, Sequence

import numpy as np
from scipy.optimize import LinearConstraint, Bounds, milp
from scipy.sparse import csr_matrix

from .winter_config import WinterConfig
from .winter_types import ERROR, INFO, WARNING, Finding, PlanPerson, lane_name

PLAN_SCHEMA = "winter-plan/1"
PERTURBATION = 1e-3  # upper bound of the per-cell tie-break cost


class PlanInputError(ValueError):
    """The people list cannot be planned (missing shift, duplicate name, unknown team)."""


# ---------------------------------------------------------------------------
# plan data class


@dataclass
class RunInfo:
    status: str = ""
    success: bool = False
    objective: Optional[float] = None
    dual_bound: Optional[float] = None
    mip_gap: Optional[float] = None
    solve_seconds: float = 0.0
    nodes: Optional[int] = None
    time_limit_hit: bool = False
    fallback: bool = False
    seed: int = 0
    solver: str = "HiGHS via scipy.optimize.milp"
    options: dict[str, Any] = field(default_factory=dict)
    weights: dict[str, Any] = field(default_factory=dict)
    model: dict[str, int] = field(default_factory=dict)
    terms: dict[str, float] = field(default_factory=dict)  # objective breakdown of the returned plan
    stability: bool = False

    def to_dict(self, include_timing: bool = False) -> dict[str, Any]:
        d = {
            "status": self.status, "success": self.success, "objective": _r(self.objective),
            "dual_bound": _r(self.dual_bound), "mip_gap": _r(self.mip_gap, 9), "nodes": self.nodes,
            "time_limit_hit": self.time_limit_hit, "fallback": self.fallback, "seed": self.seed,
            "solver": self.solver, "options": self.options, "weights": self.weights, "model": self.model,
            "terms": {k: _r(v) for k, v in sorted(self.terms.items())}, "stability": self.stability,
        }
        if include_timing:
            d["solve_seconds"] = round(self.solve_seconds, 3)
        return d

    @staticmethod
    def from_dict(d: Mapping[str, Any]) -> "RunInfo":
        return RunInfo(
            status=d.get("status", ""), success=bool(d.get("success")), objective=d.get("objective"),
            dual_bound=d.get("dual_bound"), mip_gap=d.get("mip_gap"), solve_seconds=float(d.get("solve_seconds", 0.0)),
            nodes=d.get("nodes"), time_limit_hit=bool(d.get("time_limit_hit")), fallback=bool(d.get("fallback")),
            seed=int(d.get("seed", 0)), solver=d.get("solver", ""), options=dict(d.get("options", {})),
            weights=dict(d.get("weights", {})), model=dict(d.get("model", {})), terms=dict(d.get("terms", {})),
            stability=bool(d.get("stability")))


def _r(v: Optional[float], nd: int = 6) -> Optional[float]:
    return None if v is None else round(float(v), nd)


@dataclass
class WinterPlan:
    window: tuple[date, ...]
    people: list[PlanPerson]
    cells: dict[tuple[str, date], str]  # (name, day) -> canonical shift code; absent = not working
    run_info: RunInfo = field(default_factory=RunInfo)
    findings: list[Finding] = field(default_factory=list)

    # -- queries ----------------------------------------------------------

    def code(self, name: str, d: date) -> Optional[str]:
        return self.cells.get((name, d))

    def days_of(self, name: str) -> list[date]:
        return [d for d in self.window if (name, d) in self.cells]

    def person(self, name: str) -> PlanPerson:
        for p in self.people:
            if p.name == name:
                return p
        raise KeyError(name)

    def team_of(self) -> dict[str, str]:
        return {p.name: p.team for p in self.people}

    def headcount(self, team: str, d: date) -> int:
        return sum(1 for p in self.people if p.team == team and (p.name, d) in self.cells)

    def day_counts(self) -> dict[str, int]:
        return {p.name: len(self.days_of(p.name)) for p in self.people}

    # -- serialisation ----------------------------------------------------

    def content_dict(self) -> dict[str, Any]:
        return {
            "schema": PLAN_SCHEMA,
            "window": [d.isoformat() for d in self.window],
            "people": [p.to_dict() for p in self.people],
            "cells": [[n, d.isoformat(), c] for (n, d), c in sorted(self.cells.items(), key=lambda kv: (kv[0][0], kv[0][1]))],
        }

    def to_json(self, include_timing: bool = False) -> str:
        d = self.content_dict()
        d["run_info"] = self.run_info.to_dict(include_timing)
        d["findings"] = [f.to_dict() for f in self.findings]
        return json.dumps(d, sort_keys=True, ensure_ascii=False, indent=1) + "\n"

    def plan_hash(self) -> str:
        return hashlib.sha256(
            json.dumps(self.content_dict(), sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ).hexdigest()

    @staticmethod
    def from_json(text: str) -> "WinterPlan":
        d = json.loads(text)
        if d.get("schema") != PLAN_SCHEMA:
            raise ValueError(f"not a {PLAN_SCHEMA} document")
        return WinterPlan(
            window=tuple(date.fromisoformat(x) for x in d["window"]),
            people=[PlanPerson.from_dict(p) for p in d["people"]],
            cells={(n, date.fromisoformat(iso)): c for n, iso, c in d["cells"]},
            run_info=RunInfo.from_dict(d.get("run_info", {})),
            findings=[Finding.from_dict(f) for f in d.get("findings", [])],
        )


# ---------------------------------------------------------------------------
# model builder


class _Model:
    def __init__(self) -> None:
        self.cost: list[float] = []
        self.lb: list[float] = []
        self.ub: list[float] = []
        self.integer: list[int] = []
        self.rows: list[tuple[dict[int, float], float, float]] = []
        self.const = 0.0  # constant part of the objective (not given to the solver)

    def var(self, lb: float, ub: float, cost: float = 0.0, integer: bool = True) -> int:
        self.cost.append(cost)
        self.lb.append(lb)
        self.ub.append(ub)
        self.integer.append(1 if integer else 0)
        return len(self.cost) - 1

    def row(self, coeffs: Mapping[int, float], lb: float = -np.inf, ub: float = np.inf) -> None:
        self.rows.append((dict(coeffs), lb, ub))

    def matrix(self) -> csr_matrix:
        data, ri, ci = [], [], []
        for i, (coeffs, _, _) in enumerate(self.rows):
            for j, v in coeffs.items():
                ri.append(i)
                ci.append(j)
                data.append(v)
        return csr_matrix((data, (ri, ci)), shape=(len(self.rows), len(self.cost)))


def _perturbation(seed: int, name: str, d: date) -> float:
    h = hashlib.sha256(f"{seed}|{name}|{d.isoformat()}".encode("utf-8")).digest()
    return (int.from_bytes(h[:6], "big") / float(1 << 48)) * PERTURBATION


def _validate(people: Sequence[PlanPerson], cfg: WinterConfig) -> None:
    problems = []
    seen = set()
    for p in people:
        if p.usual_shift is None:
            problems.append(f"{p.name!r} has no usual shift (needs_shift)")
        if p.team not in cfg.team_names:
            problems.append(f"{p.name!r}: team {p.team!r} is not in the rules table")
        if p.name in seen:
            problems.append(f"duplicate name {p.name!r}")
        seen.add(p.name)
    if problems:
        raise PlanInputError("; ".join(problems))


def _lane_groups(people: Sequence[PlanPerson]) -> dict[tuple[str, str], list[int]]:
    """Teams of 5+ people -> {(team, lane): [person index]} for lanes with 3+ people."""
    by_team: dict[str, list[int]] = defaultdict(list)
    for i, p in enumerate(people):
        by_team[p.team].append(i)
    out: dict[tuple[str, str], list[int]] = {}
    for team, idx in by_team.items():
        if len(idx) < 5:
            continue
        lanes: dict[str, list[int]] = defaultdict(list)
        for i in idx:
            lane = lane_name(people[i].usual_shift)
            if lane:
                lanes[lane].append(i)
        for lane, members in lanes.items():
            if len(members) >= 3:
                out[(team, lane)] = members
    return out


def solve_winter_plan(
    people: Sequence[PlanPerson],
    cfg: WinterConfig,
    previous_plan: Optional[WinterPlan] = None,
    *,
    time_limit_s: Optional[float] = None,
) -> WinterPlan:
    """Solve the plan (see module docstring). Raises PlanInputError for an unusable people list."""
    people = list(people)
    _validate(people, cfg)
    days = list(cfg.days)
    nd = len(days)
    w = cfg.weights
    m = _Model()

    # --- x variables (only on available days)
    avail = [set(cfg.available_dates(p.name)) for p in people]
    x: dict[tuple[int, int], int] = {}
    prev_cells = previous_plan.cells if previous_plan is not None else {}
    prev_names = {p.name for p in previous_plan.people} if previous_plan is not None else set()
    for i, p in enumerate(people):
        for k, d in enumerate(days):
            if d not in avail[i]:
                continue
            c = _perturbation(cfg.seed, p.name, d)
            if previous_plan is not None and p.name in prev_names:
                if (p.name, d) in prev_cells:
                    c -= w.stability  # leaving a previously planned day costs `stability`
                    m.const += w.stability
                else:
                    c += w.stability  # adding a new day costs `stability`
            x[(i, k)] = m.var(0, 1, c)

    if previous_plan is not None:
        known = {(p.name, d) for i, p in enumerate(people) for k, d in enumerate(days) if (i, k) in x}
        names = {p.name for p in people}
        m.const += w.stability * sum(1 for (n, d) in prev_cells if n in names and d in set(days) and (n, d) not in known)

    team_members: dict[str, list[int]] = defaultdict(list)
    for i, p in enumerate(people):
        team_members[p.team].append(i)

    # --- per team-day coverage
    for t in cfg.teams:
        members = team_members.get(t.name, [])
        for k, d in enumerate(days):
            heads = {x[(i, k)]: 1.0 for i in members if (i, k) in x}
            wd = cfg.day_weight(d)
            if t.best_effort:
                z = m.var(0, 1, w.best_effort_nobody * wd)
                m.row({**heads, z: 1.0}, lb=1.0)
            else:
                s = m.var(0, t.min_per_day, w.shortfall * wd, integer=True)
                m.row({**heads, s: 1.0}, lb=float(t.min_per_day))

    # --- days per person
    min_days = cfg.min_days
    for i, p in enumerate(people):
        mine = {x[(i, k)]: 1.0 for k in range(nd) if (i, k) in x}
        ceiling = min(cfg.max_days_for(p.team), nd)
        extras = max(0, ceiling - min_days)
        e_vars: list[int] = []
        for k in range(extras):
            cost = w.extra_day[k] if k < len(w.extra_day) else w.extra_day[-1]
            e_vars.append(m.var(0, 1, cost))
        for a, b in zip(e_vars, e_vars[1:]):
            m.row({b: 1.0, a: -1.0}, ub=0.0)  # the 5th day only after the 4th
        m.row({**mine, **{e: -1.0 for e in e_vars}}, ub=float(min(min_days, ceiling)))  # sum x <= 3 + extras
        ds = m.var(0, min_days, w.days_shortfall, integer=True)
        m.row({**mine, ds: 1.0}, lb=float(min_days))

    # --- lane coverage (teams of 5+, lanes of 3+)
    for (team, lane), members in sorted(_lane_groups(people).items()):
        for k, d in enumerate(days):
            heads = {x[(i, k)]: 1.0 for i in members if (i, k) in x}
            l = m.var(0, 1, w.lane * cfg.day_weight(d))
            m.row({**heads, l: 1.0}, lb=1.0)

    # --- sub-team coverage
    subs: dict[tuple[str, str], list[int]] = defaultdict(list)
    for i, p in enumerate(people):
        if p.subteam:
            subs[(p.team, p.subteam)].append(i)
    for (team, sub), members in sorted(subs.items()):
        for k, d in enumerate(days):
            heads = {x[(i, k)]: 1.0 for i in members if (i, k) in x}
            u = m.var(0, 1, w.subteam * cfg.day_weight(d))
            m.row({**heads, u: 1.0}, lb=1.0)

    # --- fairness on holiday / weekend days
    fair_idx = [k for k, d in enumerate(days) if d in set(cfg.fair_days)]
    if fair_idx and w.fairness > 0:
        for i, p in enumerate(people):
            mine = {x[(i, k)]: 1.0 for k in fair_idx if (i, k) in x}
            lo = m.var(0, cfg.fair_min, w.fairness, integer=False)
            hi = m.var(0, len(fair_idx), w.fairness, integer=False)
            m.row({**mine, lo: 1.0}, lb=float(cfg.fair_min))
            m.row({**mine, hi: -1.0}, ub=float(cfg.fair_max))

    # --- one contiguous block per person preferred
    if w.block > 0:
        for i in range(len(people)):
            for k in range(nd):
                if (i, k) not in x:
                    continue
                b = m.var(0, 1, w.block, integer=False)
                row = {b: 1.0, x[(i, k)]: -1.0}
                if k > 0 and (i, k - 1) in x:
                    row[x[(i, k - 1)]] = 1.0
                m.row(row, lb=0.0)  # b >= x[k] - x[k-1]

    # --- solve
    limit = float(time_limit_s if time_limit_s is not None else cfg.time_limit_s)
    options = {"time_limit": limit, "mip_rel_gap": cfg.mip_rel_gap, "presolve": True, "disp": False}
    info = RunInfo(seed=cfg.seed, options={"time_limit_s": limit, "mip_rel_gap": cfg.mip_rel_gap,
                                           "presolve": True, "threads": "solver default"},
                   weights=w.to_dict(), stability=previous_plan is not None,
                   model={"variables": len(m.cost), "binaries_and_integers": int(sum(m.integer)),
                          "constraints": len(m.rows), "x": len(x)})
    start = time.perf_counter()
    res = None
    try:
        a = m.matrix()
        lbs = np.array([r[1] for r in m.rows], dtype=float)
        ubs = np.array([r[2] for r in m.rows], dtype=float)
        res = milp(c=np.array(m.cost), constraints=LinearConstraint(a, lbs, ubs),
                   integrality=np.array(m.integer), bounds=Bounds(np.array(m.lb), np.array(m.ub)), options=options)
    except Exception as e:  # never crash: fall back below
        info.status = f"solver error: {type(e).__name__}: {e}"
    info.solve_seconds = time.perf_counter() - start

    chosen: Optional[dict[tuple[int, int], int]] = None
    if res is not None:
        info.status = str(res.message).strip()
        info.time_limit_hit = (res.status == 1)
        info.nodes = getattr(res, "mip_node_count", None)
        info.dual_bound = getattr(res, "mip_dual_bound", None)
        info.mip_gap = getattr(res, "mip_gap", None)
        if res.x is not None:
            info.success = bool(res.success)
            info.objective = float(res.fun) + m.const
            if info.dual_bound is not None:
                info.dual_bound = float(info.dual_bound) + m.const
            sol = res.x
            chosen = {key: 1 for key, j in x.items() if sol[j] > 0.5}
    if chosen is None:
        info.fallback = True
        info.success = False
        chosen = _greedy(people, cfg, days, avail)
    cells = {(people[i].name, days[k]): people[i].usual_shift for (i, k) in chosen}  # type: ignore[misc]
    plan = WinterPlan(tuple(days), people, cells, info)
    info.terms = score_plan(plan, cfg, previous_plan)
    plan.findings = shortfall_findings(plan, cfg)
    if info.fallback:
        plan.findings.insert(0, Finding(WARNING, "solver_fallback",
                                        "the solver returned no solution; a simple deterministic fallback plan is "
                                        "shown: review it carefully"))
    elif info.time_limit_hit:
        plan.findings.insert(0, Finding(WARNING, "time_limit",
                                        f"the solver stopped at the {limit:g} s limit; optimality gap "
                                        f"{'unknown' if info.mip_gap is None else format(info.mip_gap, '.2%')}"))
    return plan


def score_plan(plan: WinterPlan, cfg: WinterConfig, previous_plan: Optional[WinterPlan] = None) -> dict[str, float]:
    """The objective of a plan in cost units, by term (independent of the solver; the solver's objective
    equals `total` up to the tie-break perturbation, < 1). `*_units` entries count the raw events."""
    w = cfg.weights
    days = list(plan.window)
    people = plan.people
    cells = plan.cells
    terms = defaultdict(float)
    by_team: dict[str, list[int]] = defaultdict(list)
    for i, p in enumerate(people):
        by_team[p.team].append(i)

    def on(i: int, d: date) -> bool:
        return (people[i].name, d) in cells

    for t in cfg.teams:
        mem = by_team.get(t.name, [])
        for d in days:
            heads = sum(1 for i in mem if on(i, d))
            wd = cfg.day_weight(d)
            if t.best_effort:
                if heads == 0:
                    terms["nobody"] += w.best_effort_nobody * wd
                    terms["nobody_units"] += 1
            elif heads < t.min_per_day:
                terms["shortfall"] += w.shortfall * wd * (t.min_per_day - heads)
                terms["shortfall_units"] += t.min_per_day - heads
    fair = set(cfg.fair_days)
    for i, p in enumerate(people):
        n = sum(1 for d in days if on(i, d))
        for k in range(max(0, n - cfg.min_days)):
            terms["extra_days"] += w.extra_day[k] if k < len(w.extra_day) else w.extra_day[-1]
            terms["extra_days_units"] += 1
        short = max(0, cfg.min_days - n)
        terms["days_short"] += w.days_shortfall * short
        terms["days_short_units"] += short
        f = sum(1 for d in days if d in fair and on(i, d))
        slack = max(0, cfg.fair_min - f) + max(0, f - cfg.fair_max)
        terms["fairness"] += w.fairness * slack
        terms["fairness_units"] += slack
        starts = sum(1 for k, d in enumerate(days) if on(i, d) and (k == 0 or not on(i, days[k - 1])))
        terms["blocks"] += w.block * starts
        terms["blocks_units"] += starts
    for (team, lane), members in _lane_groups(people).items():
        for d in days:
            if not any(on(i, d) for i in members):
                terms["lane"] += w.lane * cfg.day_weight(d)
                terms["lane_units"] += 1
    subs: dict[tuple[str, str], list[int]] = defaultdict(list)
    for i, p in enumerate(people):
        if p.subteam:
            subs[(p.team, p.subteam)].append(i)
    for members in subs.values():
        for d in days:
            if not any(on(i, d) for i in members):
                terms["subteam"] += w.subteam * cfg.day_weight(d)
                terms["subteam_units"] += 1
    if previous_plan is not None:
        names = {p.name for p in people}
        prev_names = {p.name for p in previous_plan.people}
        changed = 0
        for p in people:
            if p.name not in prev_names:
                continue
            for d in days:
                if ((p.name, d) in cells) != ((p.name, d) in previous_plan.cells):
                    changed += 1
        terms["stability"] = w.stability * changed
        terms["stability_units"] = changed
    terms["person_days"] = float(len(cells))
    terms["total"] = sum(terms[k] for k in ("shortfall", "nobody", "extra_days", "days_short", "fairness", "blocks",
                                            "lane", "subteam", "stability"))
    return dict(terms)


def shortfall_findings(plan: WinterPlan, cfg: WinterConfig) -> list[Finding]:
    """Findings computed from the plan itself: required-minimum shortfalls (ERROR, with a count-based
    reason), best-effort team-days with nobody (INFO), people under min_days (ERROR) and extra days (INFO)."""
    out: list[Finding] = []
    by_team: dict[str, list[PlanPerson]] = defaultdict(list)
    for p in plan.people:
        by_team[p.team].append(p)
    for t in cfg.teams:
        members = by_team.get(t.name, [])
        for d in plan.window:
            heads = plan.headcount(t.name, d)
            if t.best_effort:
                if heads == 0:
                    out.append(Finding(INFO, "best_effort_gap",
                                       f"{t.label}: nobody on {d.isoformat()} (best effort)", team=t.name, date=d))
                continue
            if heads < t.min_per_day:
                avail = [p for p in members if d in set(cfg.available_dates(p.name))]
                cap = sum(min(cfg.max_days_for(p.team), len([x for x in cfg.available_dates(p.name)])) for p in members)
                need = t.min_per_day * len(plan.window)
                if len(members) < t.min_per_day:
                    why = f"the team has only {len(members)} member(s) in the plan"
                elif len(avail) < t.min_per_day:
                    why = f"only {len(avail)} of {len(members)} team member(s) are available that day"
                elif cap < need:
                    why = (f"the team's {len(members)} member(s) can supply at most {cap} person-days in the window "
                           f"but {need} are needed")
                else:
                    why = "the other days and the 3-5 day rule leave no one free"
                out.append(Finding(ERROR, "team_min",
                                   f"{t.label}: {heads} of {t.min_per_day} required on {d.isoformat()} ({why})",
                                   team=t.name, date=d))
    for p in plan.people:
        n = len(plan.days_of(p.name))
        if n < cfg.min_days:
            avail = len(cfg.available_dates(p.name))
            out.append(Finding(ERROR, "days_below_min",
                               f"{p.name}: {n} day(s), below {cfg.min_days} "
                               f"({avail} available day(s) in the window)", team=p.team, person=p.name))
    extra = sum(max(0, n - cfg.min_days) for n in plan.day_counts().values())
    if extra:
        out.append(Finding(INFO, "extra_days", f"{extra} extra person-day(s) beyond {cfg.min_days} were added to "
                           "cover required minimums"))
    return out


def _greedy(people: Sequence[PlanPerson], cfg: WinterConfig, days: Sequence[date],
            avail: Sequence[set[date]]) -> dict[tuple[int, int], int]:
    """Deterministic fallback: give everybody min_days available days, then fill required teams by the
    least-loaded available member. Only used when the solver returns nothing."""
    chosen: dict[tuple[int, int], int] = {}
    load = [0] * len(people)
    nd = len(days)
    team_members: dict[str, list[int]] = defaultdict(list)
    for i, p in enumerate(people):
        team_members[p.team].append(i)
    for t in cfg.teams:
        mem = team_members.get(t.name, [])
        if t.best_effort:
            continue
        for k, d in enumerate(days):
            have = sum(1 for i in mem if (i, k) in chosen)
            for i in sorted(mem, key=lambda i: (load[i], i)):
                if have >= t.min_per_day:
                    break
                if (i, k) in chosen or d not in avail[i] or load[i] >= min(cfg.max_days_for(t.name), nd):
                    continue
                chosen[(i, k)] = 1
                load[i] += 1
                have += 1
    for i, p in enumerate(people):
        for k, d in enumerate(days):
            if load[i] >= cfg.min_days:
                break
            if (i, k) not in chosen and d in avail[i]:
                chosen[(i, k)] = 1
                load[i] += 1
    return chosen
