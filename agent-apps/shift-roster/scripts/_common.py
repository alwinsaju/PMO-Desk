"""Shared helpers for the Shift Roster task scripts.

Every script of this task is headless (stdin closed, never prompts), resolves the task
folder from this file (`scripts/..`), reads and writes plain files under `input/`,
`output/` and `config/`, and reports failures as ONE readable line on stderr plus a
non-zero exit code (never a traceback; set SHIFT_ROSTER_DEBUG=1 to get one).

This module holds what the scripts share: path layout, atomic JSON writes, loading the
inputs with readable errors, cycle ids, the form field ids and the conversion of the
flat answers file into the roster_lib answers, flag/diff serialisation, and the
config save with a backup. It imports the shared `roster_lib` from `../shared`.

Nothing here contains a real name or real data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import traceback
import zipfile
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Optional, Sequence

TASK_DIR = Path(__file__).resolve().parent.parent
SHARED_DIR = TASK_DIR.parent / "shared"
if str(SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(SHARED_DIR))

from roster_lib.audit import AuditError, file_record, sha256_file  # noqa: E402
from roster_lib.checks import schedule_from_roster  # noqa: E402
from roster_lib.codes import DEFAULT_TABLE, Kind, counts_as_code  # noqa: E402
from roster_lib.config import ConfigError, RotationConfig, load_config, save_config  # noqa: E402
from roster_lib.cycle_builder import CycleBuilderError, Flag, Plan, flag_delta, make_rechecker  # noqa: E402
from roster_lib.draft_builder import DraftBuildError, SnapshotError  # noqa: E402
from roster_lib.draft_diff import DraftDiff, diff_draft  # noqa: E402
from roster_lib.final_build import FinalBuildError, FinalBuildRefused  # noqa: E402
from roster_lib.next_year_file import NextYearError  # noqa: E402
from roster_lib.cycles import Cycle, cycle_availability, cycle_containing, cycle_for, next_cycle  # noqa: E402
from roster_lib.holiday_matrix import HolidayMatrix, HolidayMatrixError, load_holiday_matrix  # noqa: E402
from roster_lib.pto import PtoEntry, PtoImportError, read_pto_workbook  # noqa: E402
from roster_lib.roster_io import DEFAULT_SHEET, Roster, RosterFormatError, load_roster  # noqa: E402
from roster_lib.xlsx_patch import XlsxPatchError  # noqa: E402

SHEET_NAME = DEFAULT_SHEET  # "PDT Operate"
ANALYSIS_FORMAT = "shift-roster-analysis/1"
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

# ---- form field ids ---------------------------------------------------------------------
# Every id is "<kind>:<name>"; the name is a roster name or a PTO import name.
F_SHIFT = "shift"  # ask-me: shift for the cycle (KEEP or a code)
F_PATTERN = "pattern"  # ask-me: weekly off pattern (optional)
F_NEW = "new"  # new person: new_seat | replaces:<old name>
F_SEAT_SHIFT = "seat_shift"  # new seat only
F_SEAT_PATTERN = "seat_pattern"  # new seat only
F_SEAT_TEAM = "seat_team"  # new seat only
F_SEAT_ROTATION = "seat_rotation"  # new seat only
F_PTO = "pto"  # PTO import name -> roster name | SKIP

AUTO = "AUTO"
KEEP = "KEEP"
SKIP = "SKIP"
NEW_SEAT = "new_seat"
REPLACES_PREFIX = "replaces:"
ROTATION_CHOICES = ("PERMANENT", "AUTO_SWAP", "ASK_ME", "UNCLASSIFIED")
PATTERN_LABELS = {"MON_FRI": "Mon-Fri", "WED_SUN": "Wed-Sun"}


class TaskError(Exception):
    """A readable failure: printed on one line to stderr, exit code 1."""


# roster_lib errors whose message is already readable: reported like a TaskError
LIBRARY_ERRORS = (CycleBuilderError, DraftBuildError, SnapshotError, FinalBuildError,
                  FinalBuildRefused, NextYearError, XlsxPatchError, AuditError)


# ---- paths ------------------------------------------------------------------------------

class Paths:
    """Every file of the task, derived from the task folder."""

    def __init__(self, root: Path | str | None = None):
        self.root = Path(root).resolve() if root else TASK_DIR
        r = self.root
        self.input_dir = r / "input"
        self.output = r / "output"
        self.config_dir = r / "config"
        self.roster = self.input_dir / "roster.xlsx"
        self.holidays = self.input_dir / "holiday-roster.xlsx"
        self.pto = self.input_dir / "pto-import.xlsx"
        self.run_params = self.input_dir / "run-params.json"
        self.config = self.config_dir / "rotation-config.json"
        self.config_backups = self.config_dir / "backups"
        self.options = self.output / "options.json"
        self.ask_me = self.output / "ask-me.json"
        self.answers = self.output / "ask-me-answers.json"
        self.analysis = self.output / "analysis.json"
        self.plan = self.output / "plan.json"
        self.flags = self.output / "flags.json"
        self.diff = self.output / "roster-diff.json"
        self.report = self.output / "report-data.json"
        self.final_dir = self.output / "final"
        self.backups_dir = self.output / "backups"
        self.audit_dir = self.output / "audit"

    def draft(self, cycle_id_text: str) -> Path:
        return self.output / f"Roster DRAFT {cycle_id_text}.xlsx"

    def rel(self, path: Path | str) -> str:
        """`path` relative to the task folder with forward slashes (what the JSON files hold)."""
        p = Path(path).resolve()
        try:
            return p.relative_to(self.root).as_posix()
        except ValueError:
            return p.as_posix()

    def stale_outputs(self) -> list[Path]:
        """Derived files that belong to one run; analyze removes them when a new run starts."""
        return [self.ask_me, self.answers, self.plan, self.flags, self.diff, self.report]


# ---- running a script -------------------------------------------------------------------

def run_script(impl: Callable[[Paths], None], argv: Sequence[str] | None = None,
               task_dir: Path | str | None = None) -> int:
    """Run `impl(paths)`; map failures to a one-line stderr message and an exit code."""
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--task-dir", default=None,
                        help="task folder (default: the folder this script belongs to)")
    try:
        # an in-process call with an explicit task folder never reads the host's sys.argv
        args = list(argv) if argv is not None else ([] if task_dir is not None else None)
        ns = parser.parse_args(args)
    except SystemExit as exc:  # argparse already printed the reason
        return int(exc.code or 2)
    paths = Paths(task_dir or ns.task_dir)
    try:
        impl(paths)
        return 0
    except (TaskError, *LIBRARY_ERRORS) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 - never leak a traceback into the task log
        print(f"ERROR: unexpected {type(exc).__name__}: {exc}", file=sys.stderr)
        if os.environ.get("SHIFT_ROSTER_DEBUG"):
            traceback.print_exc()
        return 2


# ---- files ------------------------------------------------------------------------------

def dumps(data: Any) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def write_text(path: Path, text: str) -> None:
    """Atomic write (temp file in the same folder, then replace); UTF-8, LF."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def write_json(path: Path, data: Any) -> None:
    write_text(path, dumps(data))


def read_json(path: Path, what: str) -> Any:
    if not path.exists():
        raise TaskError(f"{what} not found ({path.name}); run the earlier steps first")
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise TaskError(f"{what} ({path.name}) cannot be read: {exc}") from None


def remove_quietly(paths: Iterable[Path]) -> int:
    n = 0
    for p in paths:
        try:
            p.unlink()
            n += 1
        except FileNotFoundError:
            pass
        except OSError as exc:
            raise TaskError(f"cannot remove the old file {p.name}: {exc}") from None
    return n


def now_stamp(moment: datetime | None = None) -> str:
    return (moment or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")


# ---- inputs -----------------------------------------------------------------------------

def _first_lines(problems: Sequence[str], limit: int = 6) -> str:
    shown = "; ".join(problems[:limit])
    return shown + (f"; and {len(problems) - limit} more" if len(problems) > limit else "")


def load_config_file(paths: Paths) -> RotationConfig:
    if not paths.config.exists():
        raise TaskError("the rotation config is missing (config/rotation-config.json); it is "
                        "created once from the roster with the seed_config tool, see README.md")
    try:
        return load_config(paths.config)
    except ConfigError as exc:
        raise TaskError("the rotation config has problems: " + _first_lines(exc.problems)) from None


def load_master(paths: Paths) -> Roster:
    if not paths.roster.exists():
        raise TaskError("the roster workbook is missing (input/roster.xlsx)")
    try:
        return load_roster(paths.roster, SHEET_NAME)
    except RosterFormatError as exc:
        raise TaskError(f"the roster workbook cannot be read: {exc}") from None
    except Exception as exc:  # noqa: BLE001 - not an xlsx, corrupt zip, ...
        raise TaskError(f"the roster workbook cannot be opened ({type(exc).__name__}); "
                        "is it a valid .xlsx file?") from None


def load_matrix_file(paths: Paths, config: RotationConfig | None = None
                     ) -> tuple[HolidayMatrix | None, list[str]]:
    """The Holiday Roster as a matrix, or (None, readable problems). The first sheet is used;
    when it has no header row the other sheets are tried."""
    if not paths.holidays.exists():
        return None, ["the Holiday Roster is missing (input/holiday-roster.xlsx)"]
    codes = dict(config.location_codes) if config is not None else None
    try:
        return load_holiday_matrix(paths.holidays, None, codes), []
    except HolidayMatrixError as first:
        try:
            from openpyxl import load_workbook
            names = load_workbook(paths.holidays, read_only=True).sheetnames
        except Exception:  # noqa: BLE001
            return None, list(first.problems)
        for name in names[1:]:
            try:
                return load_holiday_matrix(paths.holidays, name, codes), []
            except HolidayMatrixError:
                continue
        return None, list(first.problems)


def read_pto_file(paths: Paths) -> list[PtoEntry] | None:
    """The PTO import (None when the optional file is absent); bad rows raise TaskError."""
    if not paths.pto.exists():
        return None
    try:
        return read_pto_workbook(paths.pto)
    except PtoImportError as exc:
        raise TaskError("the PTO import has problems: " + _first_lines(exc.problems)) from None
    except Exception as exc:  # noqa: BLE001
        raise TaskError(f"the PTO import cannot be read ({type(exc).__name__})") from None


def input_records(paths: Paths) -> dict[str, dict[str, Any] | None]:
    """name / sha256 / bytes of each input that exists (None when absent)."""
    files = {"roster": paths.roster, "holidays": paths.holidays, "pto": paths.pto,
             "config": paths.config}
    return {key: (file_record(p) if p.exists() else None) for key, p in files.items()}


LABELS = {"roster": "the roster workbook", "holidays": "the Holiday Roster",
          "pto": "the PTO import", "config": "the rotation config"}


def changed_inputs(paths: Paths, recorded: Mapping[str, Any], keys: Sequence[str]
                   ) -> list[str]:
    """Readable messages for every input in `keys` that differs from the analysis record."""
    now = input_records(paths)
    out = []
    for key in keys:
        before = (recorded or {}).get(key)
        after = now.get(key)
        b = before["sha256"] if before else None
        a = after["sha256"] if after else None
        if a != b:
            out.append(f"{LABELS[key]} changed since the analysis")
    return out


# ---- cycles -----------------------------------------------------------------------------

def cycle_id(cycle: Cycle) -> str:
    return f"{cycle.first_month.year}-{cycle.first_month.month:02d}"


def cycle_range_label(cycle: Cycle) -> str:
    first = cycle.first_month
    second_index = first.year * 12 + first.month  # month after `first`, 0-based index
    y2, m2 = divmod(second_index, 12)
    return f"{MONTHS[first.month - 1]} {first.year} - {MONTHS[m2]} {y2}"


def parse_cycle_id(text: Any) -> Cycle:
    m = re.fullmatch(r"(\d{4})-(\d{2})", str(text or "").strip())
    if not m:
        raise TaskError(f"cycle {text!r} is not a cycle id such as 2026-12")
    try:
        return cycle_for(int(m.group(1)), int(m.group(2)))
    except ValueError as exc:
        raise TaskError(str(exc)) from None


def cycle_dict(cycle: Cycle) -> dict[str, str]:
    return {"id": cycle_id(cycle), "label": cycle_range_label(cycle),
            "short_label": cycle.label, "first_month": cycle.first_month.isoformat(),
            "start": cycle.start.isoformat(), "end": cycle.end.isoformat(),
            "rotation_sunday": cycle.rotation_sunday.isoformat()}


def candidate_cycles(first: date, last: date) -> list[Cycle]:
    """Every cycle that overlaps [first, last] plus the next cycle after `last`."""
    out: list[Cycle] = []
    cycle = cycle_containing(first)
    while cycle.start <= last:
        out.append(cycle)
        cycle = next_cycle(cycle)
    out.append(cycle)  # the first cycle that starts after the roster's last date
    return out


def cycle_is_filled(cycle: Cycle, schedule: Mapping[str, Mapping[date, str]],
                    names: Sequence[str], threshold: float) -> bool:
    """True when the cycle itself already holds data in the roster file, by the library's own
    "has data" rule (a cycle that runs past the file end never counts: its remainder lives in
    the next-year file)."""
    return cycle_availability(next_cycle(cycle), schedule, names, counts_as_code,
                              threshold).enabled


def read_selected_cycle(paths: Paths) -> Cycle:
    if not paths.run_params.exists():
        raise TaskError("no cycle was selected (input/run-params.json is missing)")
    data = read_json(paths.run_params, "the run parameters")
    params = data.get("params") if isinstance(data, dict) else None
    value = params.get("cycle") if isinstance(params, dict) else None
    if not value:
        raise TaskError("no cycle was selected (params.cycle is missing in input/run-params.json)")
    return parse_cycle_id(value)


# ---- the form -----------------------------------------------------------------------------

def field_id(kind: str, name: str) -> str:
    return f"{kind}:{name}"


def split_field_id(fid: str) -> tuple[str, str]:
    kind, _, name = fid.partition(":")
    return kind, name


def shift_codes() -> list[str]:
    """Canonical shift codes in table order (S1..S5, NS, US-CST, US-PST, 11AM-8PM, MX-8-5)."""
    return [code for code, info in DEFAULT_TABLE.items() if info.kind is Kind.SHIFT]


_SHIFT_LABELS = {"S1": "Shift 1", "S2": "Shift 2", "S3": "Shift 3", "S4": "Shift 4",
                 "S5": "Shift 5"}


def shift_options(include_keep: bool = True) -> list[dict[str, str]]:
    options = [{"value": KEEP, "label": "Keep current"}] if include_keep else []
    for code in shift_codes():
        label = _SHIFT_LABELS.get(code, code)
        if code != label:
            label = f"{label} ({code})"
        options.append({"value": code, "label": label})
    return options


def pattern_options() -> list[dict[str, str]]:
    return [{"value": AUTO, "label": "Automatic (keep current / the shift's default)"},
            {"value": "MON_FRI", "label": "Mon-Fri"},
            {"value": "WED_SUN", "label": "Wed-Sun"}]


def _empty(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _fmt_options(field: Mapping[str, Any]) -> list[str]:
    return [str(o.get("value")) for o in field.get("options") or []]


@dataclass
class ConvertedAnswers:
    structured: dict[str, dict[str, Any]]  # {"changes": ..., "rotation": ...}
    confirmed_pto: dict[str, str]
    skipped_pto: list[str]
    replacements: dict[str, str]  # new person -> replaced person
    answered: int


def convert_answers(form: Mapping[str, Any], flat: Any, info: Mapping[str, Any] | None = None
                    ) -> ConvertedAnswers:
    """Flat `{fieldId: value}` answers -> the roster_lib answers (see README "answers").

    Strict about what the form promised: unknown field ids, a value outside a select's
    options and a required field without an answer all raise `TaskError` (listing every
    problem). Optional fields fall back to their default. Follow-up `seat_*` fields only
    matter for a `new_seat` answer and are ignored otherwise.
    """
    info = info or {}
    if not isinstance(flat, Mapping):
        raise TaskError("the answers file must be an object {fieldId: value}")
    fields = {f["id"]: f for f in form.get("fields", [])}
    problems: list[str] = []
    unknown = sorted(set(flat) - set(fields))
    if unknown:
        problems.append(f"{len(unknown)} answer(s) are not in the form (stale answers?): "
                        + ", ".join(unknown[:5]))
    values: dict[str, Any] = {}
    for fid, f in fields.items():
        raw = flat.get(fid)
        if _empty(raw):
            if f.get("required"):
                problems.append(f"required question unanswered: {fid}")
                continue
            raw = f.get("default")
        if _empty(raw):
            continue
        allowed = _fmt_options(f)
        if allowed and str(raw) not in allowed:
            problems.append(f"{fid}: {raw!r} is not one of {', '.join(allowed[:12])}")
            continue
        values[fid] = str(raw).strip()
    if problems:
        raise TaskError("the answers are incomplete or invalid: " + _first_lines(problems, 8))

    changes: dict[str, Any] = {}
    rotation: dict[str, Any] = {}
    confirmed: dict[str, str] = {}
    skipped: list[str] = []
    replacements: dict[str, str] = {}
    people = (info.get("new_people") or {})
    for fid, value in values.items():
        kind, name = split_field_id(fid)
        if kind == F_SHIFT:
            rotation.setdefault(name, {})["shift"] = value
        elif kind == F_PATTERN:
            if value != AUTO:
                rotation.setdefault(name, {})["pattern"] = value
        elif kind == F_PTO:
            if value == SKIP:
                skipped.append(name)
            else:
                confirmed[name] = value
        elif kind == F_NEW:
            if value == NEW_SEAT:
                seat: dict[str, Any] = {
                    "rotation": values.get(field_id(F_SEAT_ROTATION, name), "UNCLASSIFIED"),
                    "shift": values.get(field_id(F_SEAT_SHIFT, name)),
                    "team": values.get(field_id(F_SEAT_TEAM, name)),
                }
                pattern = values.get(field_id(F_SEAT_PATTERN, name))
                if pattern and pattern != AUTO:
                    seat["pattern"] = pattern
                section = (people.get(name) or {}).get("section")
                if section:
                    seat["subteam"] = section
                changes[name] = {"new_seat": {k: v for k, v in seat.items() if v}}
            elif value.startswith(REPLACES_PREFIX):
                old = value[len(REPLACES_PREFIX):]
                changes[name] = {"replaces": old}
                replacements[name] = old
            else:
                problems.append(f"{fid}: unknown answer {value!r}")
    if problems:
        raise TaskError("the answers are invalid: " + _first_lines(problems, 8))
    return ConvertedAnswers({"changes": changes, "rotation": rotation},
                            dict(sorted(confirmed.items())), sorted(skipped),
                            dict(sorted(replacements.items())), len(values))


# ---- flags and diff serialisation -----------------------------------------------------------

_SEVERITY_RANK = {"ERROR": 0, "WARNING": 1, "INFO": 2}


def flag_order(f: Flag):
    """The same order roster_lib sorts plan flags in (severity, date, kind, who, what)."""
    return (_SEVERITY_RANK.get(f.severity, 9), f.date or date.min, f.kind, f.person or "",
            f.team or "", f.shift or "", f.message)


def add_flags(plan: Any, extra: Sequence[Flag]) -> None:
    """Append task-level flags to a plan and keep the library's sort order."""
    if extra:
        plan.flags = sorted(list(plan.flags) + list(extra), key=flag_order)


def flag_dict(flag: Flag) -> dict[str, Any]:
    d = flag.to_dict()
    d["severity"] = str(d["severity"]).lower()
    return d


def flag_counts(flags: Iterable[Any]) -> dict[str, int]:
    counts = {"error": 0, "warning": 0, "info": 0}
    for f in flags:
        sev = str(f["severity"] if isinstance(f, Mapping) else f.severity).lower()
        counts[sev] = counts.get(sev, 0) + 1
    return counts


def flags_payload(flags: Sequence[Flag]) -> dict[str, Any]:
    """`output/flags.json`: `{"counts": {error, warning, info}, "flags": [...]}`."""
    rows = [flag_dict(f) for f in flags]
    return {"counts": flag_counts(rows), "flags": rows}


def severity_lower(items: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for item in items:
        d = dict(item)
        d["severity"] = str(d.get("severity", "")).lower()
        out.append(d)
    return out


# ---- the config save ------------------------------------------------------------------------

def save_config_with_backup(paths: Paths, config_after: RotationConfig,
                            moment: datetime | None = None) -> Path | None:
    """Replace `config/rotation-config.json` with `config_after`, first keeping a timestamped,
    hash-verified copy of the previous file in `config/backups/`. Returns the backup path."""
    backup: Path | None = None
    if paths.config.exists():
        paths.config_backups.mkdir(parents=True, exist_ok=True)
        stamp = now_stamp(moment)
        backup = paths.config_backups / f"rotation-config.{stamp}.json"
        n = 1
        while backup.exists():
            n += 1
            backup = paths.config_backups / f"rotation-config.{stamp}-{n}.json"
        shutil.copy2(paths.config, backup)
        if sha256_file(backup) != sha256_file(paths.config):
            backup.unlink()
            raise TaskError("the config backup could not be verified; the config was not changed")
    fd, tmp = tempfile.mkstemp(prefix=".rotation-config.", suffix=".tmp", dir=paths.config_dir)
    os.close(fd)
    try:
        save_config(config_after, tmp)
        os.replace(tmp, paths.config)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return backup


def most_common(items: Iterable[str], default: str) -> str:
    counts = Counter(items)
    if not counts:
        return default
    best = max(counts.values())
    return sorted(k for k, v in counts.items() if v == best)[0]


def schedule_of(roster: Roster, names: Iterable[str]) -> dict[str, dict[date, str]]:
    full = schedule_from_roster(roster)
    return {n: dict(full[n]) for n in names if n in full}


def sha256_of_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ---- the draft diff (steps 5 and 7) ---------------------------------------------------------

def load_plan(paths: Paths) -> Plan:
    if not paths.plan.exists():
        raise TaskError("the plan is missing (output/plan.json); run the 'Build draft' step first")
    try:
        return Plan.from_json(paths.plan.read_text(encoding="utf-8"))
    except (OSError, ValueError, KeyError) as exc:
        raise TaskError(f"the plan (plan.json) cannot be read: {exc}") from None


def is_rechecked(flag: Any) -> bool:
    """True for the flag kinds `make_rechecker` recomputes on an edited schedule: the HOL check,
    the staffing check and the per-shift headcount minimum. Rotation warnings, PTO notes, the
    holiday engine's CANNOT_MEET_MINIMUM / NO_OFF_AT_MINIMUM and the like are plan-time facts."""
    return flag.kind.startswith("HOL_") or flag.kind in ("STAFFING_SHORTAGE", "HEADCOUNT_BELOW_MIN")


def carried_flag_count(plan: Plan) -> int:
    """Plan flags that cannot be re-checked after the user's edits (they simply carry over)."""
    return sum(1 for f in plan.flags if not is_rechecked(f))


def compute_diff(paths: Paths, cycle_id_text: str, plan: Plan, roster: Roster,
                 matrix: HolidayMatrix) -> DraftDiff:
    """Compare the saved draft with its snapshot and re-check the flags; the same call is made
    by `diff_draft.py` (what the user confirms) and `finalize.py` (what is built). The flag
    delta compares like with like: only the plan flags the re-checker recomputes are the
    "before" side, so a plan-time flag is never reported as resolved."""
    saved = paths.draft(cycle_id_text)
    if not saved.exists():
        raise TaskError(f"the draft {saved.name} is missing from output/; save your edits "
                        "in that file (do not rename it)")
    recheck = make_rechecker(roster, plan.config_after, plan.cycle, matrix, plan)
    try:
        return diff_draft(saved, master_path=paths.roster, recheck=recheck,
                          flags_before=[f for f in plan.flags if is_rechecked(f)],
                          flag_delta=flag_delta)
    except OSError as exc:
        raise TaskError(f"the saved draft cannot be read (is it still open in Excel?): "
                        f"{exc}") from None
    except zipfile.BadZipFile:
        raise TaskError(f"the saved draft {saved.name} is not a valid .xlsx file (damaged or "
                        "not saved as a workbook)") from None


def diff_payload(diff: DraftDiff, cycle_id_text: str,
                 extra_blocking: Sequence[Mapping[str, str]] = (), carried: int = 0
                 ) -> dict[str, Any]:
    """`output/roster-diff.json` (see the task platform contract). `flags.remaining` counts the
    re-checked flags that still stand plus `carried` plan-time flags that cannot be re-checked."""
    def change(c) -> dict[str, Any]:
        return {"person": c.person, "date": c.date.isoformat(), "before": c.before,
                "after": c.after}

    issues = []
    for i in diff.issues:
        row: dict[str, Any] = {"severity": i.severity, "kind": i.code, "message": i.message}
        if i.person:
            row["person"] = i.person
        if i.date:
            row["date"] = i.date.isoformat()
        issues.append(row)
    blocking = [{"kind": i["kind"], "message": i["message"]}
                for i in issues if i["severity"] == "error"]
    for b in extra_blocking:
        blocking.append({"kind": b["kind"], "message": b["message"]})
        issues.append({"severity": "error", **b})
    return {
        "cycle": cycle_id_text,
        "changes": [change(c) for c in diff.changes],
        "outside_changes": [change(c) for c in diff.outside_snapshot_changes],
        "issues": issues,
        "blocking": blocking,
        "flags": {"new": severity_lower(diff.flags_new),
                  "resolved": severity_lower(diff.flags_resolved),
                  "remaining": len(diff.flags_remaining) + carried,
                  "not_rechecked": carried},
        "counts": {"changes": len(diff.changes),
                   "outside_changes": len(diff.outside_snapshot_changes),
                   "issues": len(issues), "blocking": len(blocking),
                   "snapshot_cells": len(diff.snapshot)},
        "saved_draft": Path(diff.saved_draft).name,
        "saved_draft_sha256": diff.saved_draft_sha256,
        "snapshot_source": diff.snapshot_source,
        "recheck_ran": diff.recheck_ran,
        "outside_checked": diff.outside_checked,
    }
