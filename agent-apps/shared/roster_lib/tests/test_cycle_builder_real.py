"""Read-only dry run of the cycle builder on the real reference roster (structure and counts
only; skipped when the reference file is absent). The real 2026 holiday matrix is not
supplied yet, so the label-derived approximation from `roster_testkit` stands in for it."""

from __future__ import annotations

from collections import Counter
from datetime import date
from pathlib import Path

import pytest
from roster_testkit import label_derived_matrix

from roster_lib.checks import schedule_from_roster
from roster_lib.codes import counts_as_code
from roster_lib.config import RotationConfig
from roster_lib.cycle_builder import active_people, analyze_cycle, build_plan
from roster_lib.cycles import cycle_availability, cycle_for, cycles_in_year
from roster_lib.roster_io import load_roster
from roster_lib.seed_config import parse_seed_names, seed_config

REAL = (Path(__file__).resolve().parents[2] / "roster-reference"
        / "Shiftroster_Takeda_Redesigned_v2.xlsx")
needs_real = pytest.mark.skipif(not REAL.exists(), reason="real roster reference file not present")


@pytest.fixture(scope="module")
def world():
    roster = load_roster(REAL)
    # nobody is listed, so everyone in scope is UNCLASSIFIED and answers "KEEP"
    config = seed_config(roster, parse_seed_names({})).config
    matrix = label_derived_matrix(roster.holiday_labels(expand_merges=True))
    return roster, config, matrix


@needs_real
def test_real_scope_and_availability(world):
    roster, config, _ = world
    active = active_people(roster.people, config)
    assert (len(roster.people), len(active)) == (50, 47)
    schedule = schedule_from_roster(roster)
    sub = {p.name: schedule[p.name] for p in active}
    enabled = [c.label for c in cycles_in_year(2026) + cycles_in_year(2027)
               if cycle_availability(c, sub, [p.name for p in active], counts_as_code,
                                     config.has_data_threshold).enabled]
    assert enabled == ["Oct 2026", "Dec 2026"]  # the only cycles whose previous cycle is complete


@needs_real
def test_real_dec_2026_cycle_crosses_the_year_boundary(world):
    roster, config, matrix = world
    dec = cycle_for(2026, 12)
    assert (dec.start, dec.end) == (date(2026, 11, 29), date(2027, 1, 30))
    analysis = analyze_cycle(roster, config, dec, holiday_matrix=matrix)
    assert analysis.availability.enabled and analysis.year_boundary["crosses"]
    assert Counter((r.stage, r.kind) for r in analysis.required_answers) == {
        ("rotation", "UNCLASSIFIED"): 47}
    answers = {"rotation": {r.name: {"shift": "KEEP"} for r in analysis.required_answers}}
    plan = build_plan(roster, config, dec, answers, holiday_matrix=matrix)
    # 34 days in the file (29 Nov .. 1 Jan), 29 after it, for each of the 47 people in scope
    # (cells that already hold a leave code in the file are preserved, not edited)
    assert len(plan.edits) + len(plan.preserved) == 47 * 34 and len(plan.remainder_edits) == 47 * 29
    assert plan.run_info["counts"]["preserved_leave"] == len(plan.preserved)
    assert not set(plan.preserved) & set(plan.edits)
    assert plan.shift_changes == []  # KEEP everywhere
    kinds = plan.flags_by_kind()
    assert kinds["YEAR_BOUNDARY"] == 1 and kinds["UNCLASSIFIED_PERSON"] == 47
    assert kinds["HOLIDAY_MATRIX_NO_ROWS"] == 1  # the stand-in matrix has no 2027 rows
    assert plan.to_json() == build_plan(roster, config, dec, answers, holiday_matrix=matrix
                                        ).to_json()
    active = {p.name for p in active_people(roster.people, config)}
    excluded = {p.name for p in roster.people} - active
    assert not excluded & {n for n, _ in plan.edits}
    assert isinstance(plan.config_after, RotationConfig)
