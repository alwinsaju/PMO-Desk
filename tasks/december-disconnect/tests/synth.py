"""A synthetic December Disconnect task folder for the pipeline tests (no real names or data).

`build_world(root)` creates `root/{input,output,config}` holding

* `input/roster.xlsx`       the winter_lib sample shift roster (people in DIS, DEP, L3, CMS 2.0, LNS 2.0
                            with usual shifts in the four months before the window; the window itself
                            holds HOL placeholders; a Governance person who is excluded);
* `input/staff-roster.xlsx` the matching staff roster, plus three Integration HUB people with NO shift
                            history (they need a shift answer), an Analytics row (excluded) and one
                            person whose staff-roster spelling is a near miss of the shift roster's
                            (a fuzzy name match to confirm);
* `input/analytics-a.xlsx`, `input/analytics-b.xlsx`  two monthly Analytics rosters for the refresh;
* `config/winter-config.json`, `config/analytics-config.json`  the winter_lib example configs
                            (default new-person shift S1, exclusions cleared);
* `config/task-config.json` pointing at a synthetic shift-roster rotation config (the cross-task
                            target) inside the temp folder, never at the real one.
"""

from __future__ import annotations

import atexit
import copy
import json
import shutil
import tempfile
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import openpyxl

from _common import Paths
from analytics_fixtures import synthetic_dict
from winter_testkit import example_dict, make_sample_files

FUZZY_STAFF_NAME = "DEP02 Sampel"  # the staff roster's spelling
FUZZY_ROSTER_NAME = "DEP02 Sample"  # the shift roster's spelling
WINDOW = "2026-12-25..2027-01-01"
WINDOW_TEXT = "2026-12-25 to 2027-01-01"


@dataclass
class World:
    root: Path
    paths: Paths
    names: dict  # team -> names (shift roster spelling)
    shift_roster_config: Path


def winter_config_dict() -> dict:
    d = copy.deepcopy(example_dict())
    d["availability"], d["shift_overrides"], d["name_aliases"] = {}, {}, {}
    d["exclusions"] = {"team_patterns": ["Leadership", "Governance", "PMO", "Analytics"],
                       "people": [], "name_patterns": []}
    d["default_new_person_shift"] = "S1"
    d["solver"]["time_limit_s"] = 60
    return d


def analytics_config_dict() -> dict:
    return copy.deepcopy(synthetic_dict())


def write_analytics_roster(path: Path, usual: dict[str, str], *, month_start=date(2026, 10, 1),
                           days=31):
    """A monthly Analytics roster in the layout analytics_inputs reads (Schedule sheet, Resource Name /
    Grade / Location headers, a date row). `usual` maps a full name to the shift worked on most days."""
    wb = openpyxl.Workbook()
    wb.active.title = "Master"
    ws = wb.create_sheet("Schedule")
    first_col, hdr = 4, 19
    for i in range(days):
        ws.cell(hdr - 7, first_col + i, month_start + timedelta(days=i))
    ws.cell(hdr, 1, "Location")
    ws.cell(hdr, 2, "Resource Name")
    ws.cell(hdr, 3, "Grade")
    ws.cell(hdr, 4, "Shift Schedule")
    r = hdr + 1
    for name, code in usual.items():
        ws.cell(r, 1, "Pune")
        ws.cell(r, 2, name)
        ws.cell(r, 3, "Analytics")
        for i in range(days):
            if (month_start + timedelta(days=i)).weekday() < 5:
                ws.cell(r, first_col + i, code)
        r += 1
    wb.save(path)


def analytics_rosters_usual() -> dict[str, str]:
    """Usual shifts in the synthetic Oct/Nov rosters: the first person differs from the config."""
    cfg = analytics_config_dict()
    usual = {p["name"]: p["usual_shift"] for p in cfg["people"]}
    first = cfg["people"][0]["name"]
    usual[first] = "S3" if usual[first] != "S3" else "S2"
    return usual


def shift_roster_config_dict(windows=None) -> dict:
    return {"version": 1, "seed": 7, "min_staff": {"DIS": 2, "default": 1},
            "disconnect_windows": windows if windows is not None else [],
            "people": [{"name": "Person 01", "team": "Operate", "subteam": "L2",
                        "rotation": "AUTO_SWAP", "shift": "S1", "location": "Blr"}]}


SHIFT_ROSTER_CONFIG_REL = "other-task/config/rotation-config.json"


def write_json_file(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2) + chr(10), encoding="utf-8")


def _build_template(root: Path, *, fuzzy: bool, with_analytics_rosters: bool) -> dict:
    paths = Paths(root)
    for d in (paths.input_dir, paths.output, paths.config_dir):
        d.mkdir(parents=True, exist_ok=True)
    stage = root / "_stage"
    stage.mkdir()
    staff, roster, names = make_sample_files(stage, dis=8, dep=5, l3=3, cms=2, lns=2, hub=3)
    shutil.move(str(roster), paths.roster)
    if fuzzy:
        wb = openpyxl.load_workbook(staff)
        ws = wb.worksheets[0]
        for row in ws.iter_rows():
            for cell in row:
                if cell.value == FUZZY_ROSTER_NAME:
                    cell.value = FUZZY_STAFF_NAME
        wb.save(staff)
    shutil.move(str(staff), paths.staff)
    shutil.rmtree(stage)
    write_json_file(paths.winter_config, winter_config_dict())
    write_json_file(paths.analytics_config, analytics_config_dict())
    if with_analytics_rosters:
        usual = analytics_rosters_usual()
        write_analytics_roster(paths.analytics_a, usual, month_start=date(2026, 10, 1))
        write_analytics_roster(paths.analytics_b, usual, month_start=date(2026, 11, 1), days=30)
    sr_config = root / SHIFT_ROSTER_CONFIG_REL
    sr_config.parent.mkdir(parents=True, exist_ok=True)
    write_json_file(sr_config, shift_roster_config_dict())
    # a RELATIVE path: resolved against the task folder
    write_json_file(paths.task_config, {"shift_roster_config": SHIFT_ROSTER_CONFIG_REL})
    return names


def build_world(root: Path, *, fuzzy: bool = True, with_analytics_rosters: bool = True) -> World:
    """A fresh task folder at `root` (copied from a per-session template: building the sample
    workbooks takes a few seconds)."""
    key = (fuzzy, with_analytics_rosters)
    cache = _TEMPLATES.get(key)
    if cache is None:
        tmp = Path(tempfile.mkdtemp(prefix="dd-template-"))
        atexit.register(shutil.rmtree, tmp, ignore_errors=True)
        names = _build_template(tmp, fuzzy=fuzzy, with_analytics_rosters=with_analytics_rosters)
        cache = _TEMPLATES[key] = (tmp, names)
    template, names = cache
    shutil.copytree(template, root)
    return World(root, Paths(root), names, root / SHIFT_ROSTER_CONFIG_REL)


_TEMPLATES: dict = {}


def write_run_params(paths: Paths, window: str = WINDOW) -> None:
    paths.run_params.write_text(json.dumps({"params": {"window": window},
                                            "saved_at": "2026-10-23T00:00:00Z"}) + "\n",
                                encoding="utf-8")


def answer_defaults(form: dict, *, name_choice: str | None = None) -> dict:
    """Answers a user could give: each required select takes its default, else the first option that
    is not SKIP (name confirmations: the suggested roster name unless `name_choice` is given)."""
    answers = {}
    for f in form["fields"]:
        if not f.get("required"):
            continue
        values = [o["value"] for o in f["options"]]
        if f["id"].startswith("name:"):
            answers[f["id"]] = name_choice if name_choice in values else next(
                v for v in values if v != "SKIP")
        elif f.get("default") in values:
            answers[f["id"]] = f["default"]
        else:
            answers[f["id"]] = next(v for v in values if v != "SKIP")
    return answers
