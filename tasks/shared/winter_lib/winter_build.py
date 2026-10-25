"""
One call from inputs to a finished, audited workbook.

    build_winter_coverage(staff_path, roster_path, config, output_path, *, shifts=None, previous_plan=None,
                          staff_sheet=None, roster_sheet="PDT Operate", logo_path=DEFAULT_LOGO) -> BuildResult

Steps: `winter_inputs.build_inputs` (people + usual shifts) -> `winter_plan.solve_winter_plan` ->
`winter_workbook.write_winter_workbook` (+ `<output>.snapshot.json` and `<output>.plan.json`) ->
`winter_audit.audit_winter_plan` on the FINISHED FILE (names from the staff / shift rosters are the roster list).

People without shift history (`needs_shift`) must be resolved first: pass `shifts={name: code}` (any tolerated spelling,
e.g. "Shift-1") for them, or set `default_new_person_shift` in the configuration. Otherwise `NeedsShiftError` carries the
list so the UI can ask. `previous_plan` (a `WinterPlan`) turns on the stability penalty for a re-solve.
"""

from __future__ import annotations

import dataclasses
import os
from dataclasses import dataclass
from typing import Mapping, Optional, Union

from roster_lib.config import name_key

from .winter_audit import AuditResult, audit_winter_plan
from .winter_config import WinterConfig
from .winter_inputs import InputsResult, build_inputs
from .winter_plan import WinterPlan, solve_winter_plan
from .winter_types import PlanPerson, canonical_shift
from .winter_workbook import DEFAULT_LOGO, WorkbookResult, write_winter_workbook

PathLike = Union[str, os.PathLike]
PLAN_JSON_SUFFIX = ".plan.json"


class NeedsShiftError(Exception):
    """Some people have no shift history and no answer yet; `people` lists them."""

    def __init__(self, people: list[PlanPerson]):
        super().__init__("no usual shift for: " + ", ".join(p.name for p in people))
        self.people = people


@dataclass
class BuildResult:
    inputs: InputsResult
    plan: WinterPlan
    workbook: WorkbookResult
    audit: AuditResult
    plan_json_path: str


def apply_shifts(inputs: InputsResult, shifts: Optional[Mapping[str, str]]) -> list[PlanPerson]:
    """The scheduled people plus the `needs_shift` people whose shift is supplied (source "answer")."""
    answers = {name_key(k): v for k, v in (shifts or {}).items()}
    people = list(inputs.people)
    missing = []
    for p in inputs.needs_shift:
        raw = answers.get(name_key(p.name))
        code = canonical_shift(raw) if raw is not None else None
        if raw is not None and code is None:
            raise ValueError(f"{p.name!r}: {raw!r} is not a working shift code")
        if code is None:
            missing.append(p)
        else:
            people.append(dataclasses.replace(p, usual_shift=code, shift_source="answer"))
    if missing:
        raise NeedsShiftError(missing)
    order = {name_key(p.name): i for i, p in enumerate(inputs.people + inputs.needs_shift)}
    people.sort(key=lambda p: order[name_key(p.name)])
    return people


def build_winter_coverage(staff_path: PathLike, roster_path: PathLike, config: WinterConfig, output_path: PathLike, *,
                          shifts: Optional[Mapping[str, str]] = None, previous_plan: Optional[WinterPlan] = None,
                          staff_sheet: Optional[str] = None, roster_sheet: str = "PDT Operate",
                          logo_path: Optional[PathLike] = DEFAULT_LOGO) -> BuildResult:
    inputs = build_inputs(staff_path, roster_path, config, staff_sheet=staff_sheet, roster_sheet=roster_sheet)
    people = apply_shifts(inputs, shifts)
    plan = solve_winter_plan(people, config, previous_plan)
    wb = write_winter_workbook(output_path, plan, config, logo_path=logo_path)
    plan_path = os.fspath(output_path) + PLAN_JSON_SUFFIX
    with open(plan_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(plan.to_json())
    audit = audit_winter_plan(output_path, config, roster_names=[p.name for p in people] + [p.staff_name for p in people if p.staff_name])
    return BuildResult(inputs, plan, wb, audit, plan_path)
