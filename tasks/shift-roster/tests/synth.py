"""A synthetic Shift Roster task folder for the pipeline tests (no real names or data).

`build_world(root)` creates `root/{input,output,config}` holding

* `input/roster.xlsx`        the roster_lib fixture workbook (threaded comments, hyperlink,
                             hidden sheet, drawings, conditional formats, ...) from Sun 2026-08-02
                             to Fri 2027-01-01, with the Aug and Oct 2026 cycles filled in
                             (Person 05 also has one hand-typed leave day in the Dec cycle);
* `input/holiday-roster.xlsx` one common holiday in each of the Aug/Dec cycles, a regional one,
                             New Year (India + Mexico, the last day of the file) and one in
                             Jan 2027 beyond the file;
* `input/pto-import.xlsx`    one exact name, one near name (needs a confirmation), one stranger;
* `config/rotation-config.json`  everyone except Person 14 (new) plus one leaver.

The roster crosses the year end: the Dec 2026 cycle (2026-11-29 .. 2027-01-30) ends beyond the
file, so it also produces the next-year file.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from openpyxl import Workbook

from roster_lib.codes import forced_pattern, works_on, Pattern
from roster_lib.cycles import cycle_for
from roster_lib.xlsx_patch import patch_workbook

from _common import Paths
from xlsx_fixtures import SHEET, FixtureInfo, build_roster_workbook

START = date(2026, 8, 2)
DAYS = 153  # 2026-08-02 .. 2027-01-01
AUG = cycle_for(2026, 8)
OCT = cycle_for(2026, 10)
DEC = cycle_for(2026, 12)

# name -> (rotation, shift worked in the Aug cycle, section as the config subteam)
SPEC = {
    "Person 01": ("AUTO_SWAP", "S1", "L2"),
    "Person 02": ("ASK_ME", "US-CST", "L2"),
    "Person 03": ("AUTO_SWAP", "S3", "L2"),
    "Person 04": ("UNCLASSIFIED", "S3", "L2"),
    "Person 05": ("PERMANENT", "S1", "L2"),
    "Person 06": ("PERMANENT", "S1", "DEP"),
    "Person 07": ("PERMANENT", "S1", "DEP"),
    "Person 08": ("PERMANENT", "S5", "L3"),
    "Person 09": ("PERMANENT", "S5", "L3"),
    "Person 10": ("AUTO_SWAP", "S1", "Device Support"),
    "Person 11": ("PERMANENT", "S1", "Device Support"),
    "Person 12": ("PERMANENT", "S1", "Lab"),
    "Person 13": ("PERMANENT", "S1", "LNS 2.0"),
    "Person 14": ("PERMANENT", "S1", "LNS 2.0"),  # on the roster, not in the config: NEW
}
NEW_PERSON = "Person 14"
LEAVER = "Gone Person"
LEAVE_CELL = ("Person 05", date(2026, 12, 2))  # hand-typed leave inside the Dec cycle
LOCATION_CODE = {"Bengaluru": "Blr", "Chennai": "Che", "Gurgaon": "Gur", "Hyderabad": "Hyd",
                 "Kolkata": "Kol", "Pune": "Pun", "Mexico": "Mex"}


def code_text(code: str) -> str:
    return f"Shift-{code[1]}" if len(code) == 2 and code[0] == "S" else code


def shift_in(rotation: str, shift: str, k: int) -> str:
    """The shift worked in the k-th cycle after Aug (AUTO_SWAP people flip every cycle)."""
    flip = {"S1": "S2", "S2": "S1", "S3": "S4", "S4": "S3"}
    return flip.get(shift, shift) if rotation == "AUTO_SWAP" and k % 2 == 1 else shift


def cell_text(code: str, d: date) -> str:
    pattern = forced_pattern(code) or Pattern.MON_FRI
    return code_text(code) if works_on(pattern, d) else ""


@dataclass
class World:
    root: Path
    paths: Paths
    info: FixtureInfo

    def person(self, name: str):
        return self.info.person(name)


def _grid_edits(info: FixtureInfo) -> dict[tuple[int, int], str]:
    edits: dict[tuple[int, int], str] = {}
    last = START + timedelta(days=DAYS - 1)
    for name, (rotation, shift, _section) in SPEC.items():
        row = info.person(name).row
        for i in range(DAYS):
            d = START + timedelta(days=i)
            text = ""
            for k, cycle in enumerate((AUG, OCT)):
                if cycle.start <= d <= cycle.end:
                    text = cell_text(shift_in(rotation, shift, k), d)
            edits[(row, info.date_col(d))] = text
    name, d = LEAVE_CELL
    edits[(info.person(name).row, info.date_col(d))] = "P"
    assert last == date(2027, 1, 1)
    return edits


def write_matrix(path: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Holiday Roster"
    locs = ["Bengaluru", "Chennai", "Gurgaon", "Hyderabad", "Kolkata", "Pune", "Mexico"]
    for j, title in enumerate(["Holiday name", "Date", *locs], start=1):
        ws.cell(1, j, title)
    india = locs[:-1]
    rows = [
        ("Test Independence", date(2026, 8, 15), india),
        ("Test Regional", date(2026, 10, 20), ["Chennai", "Hyderabad"]),
        ("Test Common Day", date(2026, 12, 10), india),
        ("Test Regional Two", date(2026, 12, 17), ["Chennai"]),
        ("Test New Year", date(2027, 1, 1), india + ["Mexico"]),
        ("Test Republic Day", date(2027, 1, 26), india),
        ("Test Spring Day", date(2027, 3, 10), india),  # >= 3 rows in 2027: roster looks complete
    ]
    for i, (name, d, off) in enumerate(rows, start=2):
        ws.cell(i, 1, name)
        ws.cell(i, 2, d)
        for j, loc in enumerate(locs, start=3):
            if loc in off:
                ws.cell(i, j, "X")
    wb.save(path)


def write_pto(path: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "PTO"
    for j, title in enumerate(["Name", "From", "To", "Code"], start=1):
        ws.cell(1, j, title)
    rows = [
        ("Person 06", date(2026, 12, 14), date(2026, 12, 15), "P"),  # exact
        ("Persn 07", date(2026, 12, 16), date(2026, 12, 16), "P"),  # near several names
        ("Nobody Here", date(2026, 12, 17), date(2026, 12, 17), "P"),  # matches nobody
    ]
    for i, row in enumerate(rows, start=2):
        for j, v in enumerate(row, start=1):
            ws.cell(i, j, v)
    wb.save(path)


def config_dict(include_new: bool = False, include_leaver: bool = True) -> dict:
    people = []
    for name, (rotation, shift, section) in SPEC.items():
        if name == NEW_PERSON and not include_new:
            continue
        entry = {"name": name, "team": "Operate", "subteam": section, "rotation": rotation,
                 "location": None}
        if rotation in ("AUTO_SWAP", "PERMANENT"):
            entry["shift"] = shift_in(rotation, shift, 1)
        people.append(entry)
    if include_leaver:
        people.append({"name": LEAVER, "team": "Operate", "subteam": "LNS 2.0",
                       "rotation": "PERMANENT", "shift": "S1", "location": "Blr"})
    return {"version": 1, "seed": 7,
            "min_staff": {"DIS": 2, "default": 1},
            "disconnect_windows": [{"start": "2026-12-26", "end": "2026-12-31"}],
            "people": people}


def build_world(root: Path, *, pto: bool = True, new_person: bool = True) -> World:
    paths = Paths(root)
    for d in (paths.input_dir, paths.output, paths.config_dir):
        d.mkdir(parents=True, exist_ok=True)
    base = root / "base-roster.xlsx"
    info = build_roster_workbook(base, start=START, days=DAYS)
    patch_workbook(base, paths.roster, SHEET, _grid_edits(info))
    base.unlink()

    locations = {p.name: LOCATION_CODE[p.location] for p in info.people if p.location in LOCATION_CODE}
    cfg = config_dict(include_new=not new_person)
    for entry in cfg["people"]:
        if entry["name"] in locations:
            entry["location"] = locations[entry["name"]]
    paths.config.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")

    write_matrix(paths.holidays)
    if pto:
        write_pto(paths.pto)
    return World(root, paths, info)


def copy_world(src: Path, dst: Path) -> Paths:
    """A byte copy of a task folder (inputs, config, outputs)."""
    shutil.copytree(src, dst)
    return Paths(dst)


def write_run_params(paths: Paths, cycle: str) -> None:
    paths.run_params.write_text(json.dumps({"params": {"cycle": cycle},
                                            "saved_at": "2026-10-23T00:00:00Z"}) + "\n",
                                encoding="utf-8")


def answer_defaults(form: dict, *, new_choice: str = "new_seat") -> dict:
    """Answers a user could give: each required select takes its default, else the first
    option that is not SKIP (new people: `new_choice`)."""
    answers = {}
    for f in form["fields"]:
        if not f.get("required"):
            continue
        values = [o["value"] for o in f["options"]]
        if f["id"].startswith("new:"):
            answers[f["id"]] = new_choice if new_choice in values else values[0]
        elif f.get("default") in values:
            answers[f["id"]] = f["default"]
        else:
            answers[f["id"]] = next(v for v in values if v != "SKIP")
    return answers


def patch_master(world: World, edits: dict[tuple[str, date], str]) -> None:
    """Rewrite cells of the synthetic master (a test changing its own input file)."""
    resolved = {(world.person(n).row, world.info.date_col(d)): t for (n, d), t in edits.items()}
    tmp = world.root / "master-patched.xlsx"
    patch_workbook(world.paths.roster, tmp, SHEET, resolved)
    shutil.copyfile(tmp, world.paths.roster)
    tmp.unlink()


def blank_cycle(world: World, cycle, names=None) -> None:
    """Blank a whole cycle (inside the file) for `names` (default everybody with data)."""
    edits = {}
    for name in names or SPEC:
        d = cycle.start
        while d <= cycle.end and d <= START + timedelta(days=DAYS - 1):
            edits[(name, d)] = ""
            d += timedelta(days=1)
    patch_master(world, edits)
