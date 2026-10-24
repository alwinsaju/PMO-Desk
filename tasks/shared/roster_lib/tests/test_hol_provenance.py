"""HOL provenance: the program never writes a HOL it should not, and every HOL flag says where the
cell came from.

Background (PMO report "Pune shows HOL on non-holidays"): the master roster can hold HOL cells
typed by hand on days that are not holidays for that location. The build preserves existing leave
(keep-and-flag), so such cells reappear in the draft flagged HOL_STRAY. These tests pin that the
engine itself writes HOL only for a working person whose location is ticked that day, that the
self-check `INTERNAL_STRAY_HOL_WRITTEN` fires on a deliberately injected stray, and that master
cells are labelled `origin == "master"`. Synthetic data only; the real-file test asserts counts."""

from __future__ import annotations

import random
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

import pytest
from cycle_testkit import ANSWERS, DEC, EXCLUDED, INDIA, OCT, SPECS, make_config, make_roster
from roster_testkit import MEX, build, config, matrix_of, per_shift_config, person

from roster_lib import cycle_builder
from roster_lib.checks import daterange, is_working_cell, resolve_location
from roster_lib.codes import try_parse_code
from roster_lib.cycle_builder import Flag, Plan, build_plan, internal_stray_hol, make_rechecker
from roster_lib.cycles import cycle_for
from roster_lib.holiday_engine import assign_holidays, build_counters_from_schedule
from roster_lib.holiday_matrix import DEFAULT_LOCATION_CODES, is_off

ALL_LOCS = INDIA + [MEX]
START, END = date(2026, 10, 25), date(2026, 11, 28)


def is_hol(text: str) -> bool:
    parsed = try_parse_code(text or "")
    return parsed is not None and parsed.canonical == "HOL"


# ---- the invariant, randomized ---------------------------------------------------------

def _random_world(rng: random.Random):
    n = rng.randint(6, 16)
    specs = []
    for i in range(n):
        loc = rng.choice(ALL_LOCS + ["Zzz"])  # "Zzz": a location the matrix does not know
        section = rng.choice(["L2", "DEP", "L3", "Lab", "Device Support", "CMS 2.0"])
        shift = rng.choice(["Shift-1", "Shift-2", "Shift-3", "Shift-4", "Shift-5", "US-CST", "NS"])
        specs.append((f"P{i:02d}", loc, section, shift))
    people, schedule = build(specs, START, END)
    days = list(daterange(START, END))
    for name in schedule:  # random leave, on-call and manual HOL on random days
        for _ in range(rng.randint(0, 5)):
            schedule[name][rng.choice(days)] = rng.choice(["P", "T", "SL", "COMP", "HOL", "OC", "On-call"])
    rows = []
    for k in range(rng.randint(2, 8)):
        d = rng.choice(days)
        kind = rng.choice(["common", "common_mex", "specific", "mex"])
        if kind == "common":
            off = INDIA
        elif kind == "common_mex":
            off = INDIA + [MEX]
        elif kind == "mex":
            off = [MEX]
        else:
            off = rng.sample(ALL_LOCS, rng.randint(1, 4))
        rows.append((f"H{k}", d, off))
    # matrix_of needs unique (name, date); two rows on one day are legal
    return people, schedule, matrix_of(rows)


@pytest.mark.parametrize("seed", range(60))
def test_engine_never_writes_hol_off_location_or_on_a_non_working_day(seed):
    rng = random.Random(seed)
    people, schedule, matrix = _random_world(rng)
    cfg = per_shift_config() if rng.random() < 0.5 else config()
    cfg.min_staff["default"] = rng.randint(0, 3)
    counters = build_counters_from_schedule(schedule, people, matrix, 2026, cfg, START)
    result = assign_holidays(schedule, people, matrix, counters, cfg, START, END, seed=seed)
    locs = dict(cfg.location_codes)
    locs.update(matrix.location_codes)
    loc_of = {p.name: resolve_location(p.location_code, locs) for p in people}
    for (name, d), text in result.edits.items():
        assert text == "HOL"
        assert loc_of[name] is not None and is_off(matrix, loc_of[name], d), (name, d, loc_of[name])
        assert is_working_cell(schedule[name][d]), (name, d, schedule[name][d])  # not a weekly off / leave
    # and the cycle builder's self-check agrees (it works on the same two facts)
    cells = {k: v for k, v in result.edits.items()}
    assert internal_stray_hol(cells, schedule, people, matrix, cfg) == []


@pytest.mark.parametrize("seed", range(8))
def test_build_plan_never_raises_the_internal_stray_flag(seed):
    rng = random.Random(1000 + seed)
    days = list(daterange(DEC.start, DEC.end))
    rows = []
    for k in range(rng.randint(3, 10)):
        d = rng.choice(days)
        off = rng.choice([INDIA, INDIA + [MEX], rng.sample(ALL_LOCS, rng.randint(1, 3)), [MEX]])
        rows.append((f"H{k}", d, off))
    # manual HOL typed on random non-holiday days of the cycle (inside the file)
    manual = {(s.name, rng.choice(days[:34])): "HOL" for s in rng.sample([x for x in SPECS if x.name not in EXCLUDED], 8)}
    roster = make_roster(filled=(OCT,), last_date=date(2026, 12, 31), hol_cells=manual)
    plan = build_plan(roster, make_config(1), DEC, ANSWERS, holiday_matrix=matrix_of(rows))
    assert "INTERNAL_STRAY_HOL_WRITTEN" not in plan.flags_by_kind()
    # nothing the program wrote is a master cell, and every master HOL is kept as typed
    kept = {k for k in manual if k[1] <= roster.last_date}
    assert kept <= set(plan.preserved) and not kept & set(plan.edits)
    for key in kept:
        assert plan.preserved[key] == "HOL"


# ---- the self-check itself ---------------------------------------------------------------

def test_self_check_flags_a_stray_hol_the_program_wrote():
    people, schedule = build([("A", "Pun", "L2", "Shift-1"), ("B", "Blr", "L2", "Shift-1"),
                              ("C", "Zzz", "L2", "Shift-1")], START, END)
    sat = date(2026, 10, 31)  # a weekly off for a Mon-Fri person
    matrix = matrix_of([("Pune Only", date(2026, 11, 4), ["Pun"])])
    cfg = per_shift_config()
    ok = {("A", date(2026, 11, 4)): "HOL"}
    assert internal_stray_hol(ok, schedule, people, matrix, cfg) == []
    bad = {("B", date(2026, 11, 4)): "HOL",  # Blr is not ticked
           ("A", date(2026, 11, 9)): "HOL",  # nobody is off that day
           ("C", date(2026, 11, 4)): "HOL",  # unknown location
           ("A", sat): "HOL"}  # not ticked either
    flags = internal_stray_hol(bad, schedule, people, matrix, cfg)
    assert len(flags) == 4 and {f.kind for f in flags} == {"INTERNAL_STRAY_HOL_WRITTEN"}
    assert all(f.severity == "ERROR" and f.origin == "program" for f in flags)
    assert any("unknown" in f.message for f in flags) and any("not ticked" in f.message for f in flags)
    # a ticked day on the person's weekly off is also refused
    matrix2 = matrix_of([("Pune Sat", sat, ["Pun"])])
    flags = internal_stray_hol({("A", sat): "HOL"}, schedule, people, matrix2, cfg)
    assert len(flags) == 1 and "does not work" in flags[0].message


def test_build_plan_reports_an_injected_engine_defect(monkeypatch):
    """If the engine ever produced a stray HOL, the plan carries an ERROR flag (never expected)."""
    real = cycle_builder.assign_holidays

    def broken(schedule, people, matrix, counters, cfg, start, end, **kw):
        result = real(schedule, people, matrix, counters, cfg, start, end, **kw)
        victim = next(p.name for p in people if p.location_code == "Pune")
        edits = dict(result.edits)
        edits[(victim, start + timedelta(days=3))] = "HOL"  # a Wednesday: not a holiday anywhere
        return type(result)(edits, result.assignments, result.counters_before, result.counters_after,
                            result.flags, result.seed, result.coverage, result.pool_average)

    monkeypatch.setattr(cycle_builder, "assign_holidays", broken)
    roster = make_roster(filled=(OCT,), last_date=date(2026, 12, 31))
    plan = build_plan(roster, make_config(1), DEC, ANSWERS,
                      holiday_matrix=matrix_of([("Common", date(2026, 12, 10), INDIA)]))
    stray = [f for f in plan.flags if f.kind == "INTERNAL_STRAY_HOL_WRITTEN"]
    assert len(stray) >= 1 and all(f.severity == "ERROR" and f.origin == "program" for f in stray)


# ---- provenance on flags -----------------------------------------------------------------

def _plan_with_master_strays():
    pune = [s.name for s in SPECS if s.loc == "Pun"][:2]
    stray_day = date(2026, 12, 8)  # a Tuesday, a holiday nowhere
    manual = {(n, stray_day): "HOL" for n in pune}
    roster = make_roster(filled=(OCT,), last_date=date(2026, 12, 31), hol_cells=manual)
    matrix = matrix_of([("Common", date(2026, 12, 10), INDIA)])
    return roster, matrix, pune, stray_day, build_plan(roster, make_config(1), DEC, ANSWERS,
                                                       holiday_matrix=matrix)


def test_master_hol_flags_say_where_the_cell_came_from():
    roster, matrix, pune, stray_day, plan = _plan_with_master_strays()
    stray = [f for f in plan.flags if f.kind == "HOL_STRAY" and f.date == stray_day]
    assert sorted(f.person for f in stray) == sorted(pune)
    for f in stray:
        assert f.origin == "master"
        assert "already in the master roster; not added by this run" in f.message
    kept = [f for f in plan.flags if f.kind == "PRESERVED_LEAVE" and f.date == stray_day]
    assert len(kept) == 2 and all(f.origin == "master" for f in kept)
    assert all("already in the master roster; not added by this run" in f.message for f in kept)
    # what the program did write is "program" if it is ever flagged, never "master"
    written = {(n, date.fromisoformat(a["date"])) for a in plan.holiday_assignments for n in a["off"]}
    assert written and not written & set(plan.preserved)
    assert all(f.origin != "master" for f in plan.flags
               if f.kind.startswith("HOL_") and (f.person, f.date) in written)
    # flags.json shape: every entry carries `origin` (null when not about an existing HOL)
    rows = [f.to_dict() for f in plan.flags]
    assert all("origin" in r for r in rows)
    assert Counter(r["origin"] for r in rows if r["kind"] == "HOL_STRAY") == {"master": 2}
    # round trip through plan.json keeps it
    again = Plan.from_json(plan.to_json())
    assert [f.origin for f in again.flags] == [f.origin for f in plan.flags]
    assert Flag.from_dict({"kind": "X", "severity": "INFO", "message": "m"}).origin is None


def test_the_key_does_not_depend_on_the_origin():
    a = Flag("HOL_STRAY", "WARNING", "m", "P", date(2026, 12, 8), origin="master")
    b = Flag("HOL_STRAY", "WARNING", "m", "P", date(2026, 12, 8), origin="user")
    assert a.key == b.key


def test_recheck_labels_user_typed_hol_and_keeps_master_and_program_origins():
    roster, matrix, pune, stray_day, plan = _plan_with_master_strays()
    recheck = make_rechecker(roster, plan.config_after, DEC, matrix, plan)
    cycle_cells = {s.name: {d: "" for d in daterange(DEC.start, roster.last_date)} for s in SPECS}
    for (n, d), t in plan.edits.items():
        cycle_cells[n][d] = t
    for (n, d), t in plan.preserved.items():
        cycle_cells[n][d] = t
    other = next(s.name for s in SPECS if s.loc == "Hyd" and s.name not in pune)
    typed_day = date(2026, 12, 16)  # the user types a HOL on a working non-holiday day
    cycle_cells[other][typed_day] = "HOL"
    flags = recheck(cycle_cells)
    by = {(f.person, f.date): f for f in flags if f.kind == "HOL_STRAY"}
    assert by[(other, typed_day)].origin == "user"
    assert "typed into the draft" in by[(other, typed_day)].message
    assert all(by[(n, stray_day)].origin == "master" for n in pune)


def test_unknown_or_mixed_location_text_never_gets_a_program_hol():
    """Location text variants that do not resolve (e.g. a combined 'Mumbai & Pune') are unknown:
    they are never given HOL by the engine and are flagged unverifiable, not mapped to Pune."""
    locs = dict(DEFAULT_LOCATION_CODES)
    assert resolve_location("Pune", locs) == "Pun" and resolve_location(" pune ", locs) == "Pun"
    assert resolve_location("Pun", locs) == "Pun"
    for text in ("Mumbai & Pune", "Mumbai", "Pune/Mumbai", "", None):
        assert resolve_location(text, locs) is None
    people = [person("A", "Mumbai & Pune"), person("B", "Pune", row=17)]
    sched = {p.name: {d: "Shift-1" for d in daterange(START, END)} for p in people}
    matrix = matrix_of([("Pune Day", date(2026, 11, 4), ["Pun"])])
    result = assign_holidays(sched, people, matrix, {}, per_shift_config(), START, END, seed=1)
    assert result.edits == {("B", date(2026, 11, 4)): "HOL"}


# ---- real files (counts and dates only; skipped when absent) -----------------------------

REF = Path(__file__).resolve().parents[2] / "roster-reference"
REAL = REF / "Shiftroster_Takeda_Redesigned_v2.xlsx"
HOLIDAYS = REF / "Holiday Roster 2026.xlsx"
needs_real = pytest.mark.skipif(not (REAL.exists() and HOLIDAYS.exists()),
                                reason="real roster reference files not present")


@needs_real
def test_real_pune_hol_provenance_counts():
    from roster_lib.cycle_builder import analyze_cycle
    from roster_lib.holiday_matrix import load_holiday_matrix
    from roster_lib.roster_io import load_roster
    from roster_lib.seed_config import parse_seed_names, seed_config

    roster = load_roster(REAL)
    matrix = load_holiday_matrix(HOLIDAYS)
    cells = Counter()
    stray_dates = set()
    for p in roster.people:
        if p.location_code != "Pune":
            continue
        for d, t in zip(roster.dates, roster.row_texts(p)):
            if is_hol(t):
                ticked = is_off(matrix, "Pun", d)
                cells["ticked" if ticked else "stray"] += 1
                if not ticked:
                    stray_dates.add(d)
    # the strays are in the MASTER (nothing of this program is involved): 41 cells on 11 dates
    assert dict(cells) == {"ticked": 31, "stray": 41} and len(stray_dates) == 11
    assert {d.strftime("%a") for d in stray_dates} == {"Tue", "Wed", "Thu"}

    config = seed_config(roster, parse_seed_names({})).config
    dec = cycle_for(2026, 12)
    req = analyze_cycle(roster, config, dec, holiday_matrix=matrix).required_answers
    answers = {"rotation": {r.name: {"shift": "KEEP"} for r in req}}
    plan = build_plan(roster, config, dec, answers, holiday_matrix=matrix)
    pune = {p.name for p in roster.people if p.location_code == "Pune"}
    program_hol = {(n, d) for (n, d), t in {**plan.edits, **plan.remainder_edits}.items()
                   if is_hol(t) and n in pune}
    assert all(is_off(matrix, "Pun", d) for _, d in program_hol)  # never a Pune HOL off a holiday
    assert "INTERNAL_STRAY_HOL_WRITTEN" not in plan.flags_by_kind()
    pune_stray = [f for f in plan.flags if f.kind == "HOL_STRAY" and f.person in pune]
    assert len(pune_stray) == 8 and {f.date for f in pune_stray} == {date(2026, 12, 8), date(2026, 12, 24)}
    assert all(f.origin == "master" for f in pune_stray)
    kept_pune = {k for k, t in plan.preserved.items() if k[0] in pune and is_hol(t)}
    assert len(kept_pune) == 8
