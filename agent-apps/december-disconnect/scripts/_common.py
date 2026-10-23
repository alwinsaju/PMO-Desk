"""Shared helpers for the December Disconnect task scripts.

Every script of this task is headless (stdin closed, never prompts), resolves the task folder
from this file (`scripts/..`), reads and writes plain files under `input/`, `output/` and
`config/`, and reports a failure as ONE readable line on stderr plus a non-zero exit code
(never a traceback; set DECEMBER_DISCONNECT_DEBUG=1 to get one). Logs are COUNTS ONLY: no
person name is ever printed (names live in the gitignored files only), so messages built here
mention kinds and counts, and library messages that may quote a name are scrubbed.

This module holds what the scripts share: the path layout, atomic JSON writes, loading the
inputs with readable errors, the window id, the form field ids and the conversion of the flat
answers file, merging the answers into copies of the two configs, flag serialisation, hashing,
the previous-run archive, and the optional task config (`config/task-config.json`).

It imports the shared `winter_lib` and `roster_lib` from `../shared`. Nothing here contains a
real name or real data.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import shutil
import sys
import tempfile
import traceback
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Optional, Sequence

TASK_DIR = Path(__file__).resolve().parent.parent
SHARED_DIR = TASK_DIR.parent / "shared"
if str(SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(SHARED_DIR))

from roster_lib.audit import AuditError, file_record, sha256_file  # noqa: E402
from roster_lib.config import name_key  # noqa: E402
from roster_lib.roster_io import DEFAULT_SHEET, Roster, RosterFormatError, load_roster  # noqa: E402
from winter_lib.analytics_config import (  # noqa: E402
    AnalyticsConfig, AnalyticsConfigError, parse_analytics_config)
from winter_lib.analytics_inputs import (  # noqa: E402
    AnalyticsRosterError, RosterReading, merge_readings, modal_shift, read_analytics_roster)
from winter_lib.analytics_workbook import AnalyticsWorkbookError  # noqa: E402
from winter_lib.winter_build import NeedsShiftError  # noqa: E402
from winter_lib.winter_config import ConfigError, WinterConfig, parse_config  # noqa: E402
from winter_lib.winter_inputs import StaffRoster, StaffRosterError, read_staff_roster  # noqa: E402
from winter_lib.winter_plan import PlanInputError, WinterPlan  # noqa: E402
from winter_lib.winter_snapshot import SnapshotError  # noqa: E402
from winter_lib.winter_types import DISPLAY, display_code  # noqa: E402

SHEET_NAME = DEFAULT_SHEET  # "PDT Operate"
ANALYSIS_FORMAT = "december-disconnect-analysis/1"
DEBUG_ENV = "DECEMBER_DISCONNECT_DEBUG"
MAIN_TAG, ANALYTICS_TAG = "[Main]", "[Analytics]"
MAIN_ROWS, ANALYTICS_ROWS = 5, 3  # availability exception rows in the form

# ---- form field ids -----------------------------------------------------------------------
F_SHIFT = "shift"  # shift for a person without history
F_NAME = "name"  # a fuzzy name match: roster name | SKIP
F_AVAIL_PERSON, F_AVAIL_DATES, F_AVAIL_MODE = "avail_person", "avail_dates", "avail_mode"
F_AAVAIL_PERSON, F_AAVAIL_DATES, F_AAVAIL_MODE = "aavail_person", "aavail_dates", "aavail_mode"
NONE = "NONE"
SKIP = "SKIP"
MODES = ("unavailable", "only_available")
MODE_LABELS = {"unavailable": "Not available on these dates",
               "only_available": "Available ONLY on these dates"}
DEFAULT_ASSUMED_SHIFT = "S1"


class TaskError(Exception):
    """A readable failure: printed on one line to stderr, exit code 1."""


def scrub(text: Any) -> str:
    """A library message with every quoted fragment blanked: configs quote person names."""
    return re.sub(r"'[^']*'|\"[^\"]*\"", "'..'", str(text))


def first_lines(problems: Sequence[str], limit: int = 5) -> str:
    shown = "; ".join(scrub(p) for p in problems[:limit])
    return shown + (f"; and {len(problems) - limit} more" if len(problems) > limit else "")


# errors whose message is already readable and holds no name
LIBRARY_ERRORS = (AuditError, AnalyticsWorkbookError, SnapshotError)


# ---- paths --------------------------------------------------------------------------------

class Paths:
    """Every file of the task, derived from the task folder."""

    def __init__(self, root: Path | str | None = None):
        self.root = Path(root).resolve() if root else TASK_DIR
        r = self.root
        self.input_dir = r / "input"
        self.output = r / "output"
        self.config_dir = r / "config"
        self.roster = self.input_dir / "roster.xlsx"
        self.staff = self.input_dir / "staff-roster.xlsx"
        self.analytics_a = self.input_dir / "analytics-a.xlsx"
        self.analytics_b = self.input_dir / "analytics-b.xlsx"
        self.run_params = self.input_dir / "run-params.json"
        self.winter_config = self.config_dir / "winter-config.json"
        self.analytics_config = self.config_dir / "analytics-config.json"
        self.task_config = self.config_dir / "task-config.json"
        self.options = self.output / "options.json"
        self.ask_me = self.output / "ask-me.json"
        self.answers = self.output / "ask-me-answers.json"
        self.analysis = self.output / "analysis.json"
        self.meta = self.output / "draft-meta.json"
        self.plan = self.output / "plan.json"
        self.analytics_plan = self.output / "analytics-plan.json"
        self.previous_plan = self.output / "previous-plan.json"
        self.previous_analytics_plan = self.output / "previous-analytics-plan.json"
        self.winter_effective = self.output / "winter-config.effective.json"
        self.analytics_effective = self.output / "analytics-config.effective.json"
        self.flags = self.output / "flags.json"
        self.diff = self.output / "roster-diff.json"
        self.report = self.output / "report-data.json"
        self.final_dir = self.output / "final"
        self.archive_dir = self.output / "archive"
        self.audit_dir = self.output / "audit"

    def draft_main(self, window_text: str) -> Path:
        return self.output / f"Winter Coverage DRAFT {window_text}.xlsx"

    def draft_analytics(self, window_text: str) -> Path:
        return self.output / f"Analytics Winter Coverage DRAFT {window_text}.xlsx"

    def rel(self, path: Path | str) -> str:
        """`path` relative to the task folder with forward slashes (what the JSON files hold)."""
        p = Path(path).resolve()
        try:
            return p.relative_to(self.root).as_posix()
        except ValueError:
            return p.as_posix()

    def stale_outputs(self) -> list[Path]:
        """Derived files that belong to one run; analyze removes them when a new run starts.
        (`previous-plan.json` is NOT stale: it is the stability reference of the next draft.)"""
        return [self.ask_me, self.answers, self.plan, self.analytics_plan, self.flags, self.diff,
                self.report, self.meta, self.winter_effective, self.analytics_effective]

    def analytics_rosters(self) -> list[Path]:
        return [p for p in (self.analytics_a, self.analytics_b) if p.exists()]


# ---- running a script ---------------------------------------------------------------------

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
    except Exception as exc:  # noqa: BLE001 - never leak a traceback (or a name) into the task log
        print(f"ERROR: unexpected {type(exc).__name__}", file=sys.stderr)
        if os.environ.get(DEBUG_ENV):
            traceback.print_exc()
        return 2


# ---- files --------------------------------------------------------------------------------

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
        raise TaskError(f"{what} ({path.name}) cannot be read: {type(exc).__name__}") from None


def remove_quietly(paths: Iterable[Path]) -> int:
    n = 0
    for p in paths:
        try:
            p.unlink()
            n += 1
        except FileNotFoundError:
            pass
        except OSError as exc:
            raise TaskError(f"cannot remove the old file {p.name}: {type(exc).__name__}") from None
    return n


def now_stamp(moment: datetime | None = None) -> str:
    return (moment or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")


def sha256_of_text(text: str) -> str:
    import hashlib
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def copy_verified(src: Path, dst: Path) -> None:
    """Copy `src` to `dst` through a temp file in the same folder; the sha256 must match."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{dst.name}.", suffix=".tmp", dir=dst.parent)
    os.close(fd)
    try:
        shutil.copyfile(src, tmp)
        if sha256_file(tmp) != sha256_file(src):
            raise TaskError(f"the copy of {src.name} could not be verified")
        os.replace(tmp, dst)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


# ---- window ---------------------------------------------------------------------------------

_SHORT_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def window_id(start: date, end: date) -> str:
    """The id of the one selectable window, e.g. `2026-12-25..2027-01-01` (no spaces)."""
    return f"{start.isoformat()}..{end.isoformat()}"


def window_file_text(start: date, end: date) -> str:
    """The window as written into file names: `2026-12-25 to 2027-01-01`."""
    return f"{start.isoformat()} to {end.isoformat()}"


def window_label(start: date, end: date) -> str:
    def part(d: date, year: bool) -> str:
        return f"{_SHORT_MONTHS[d.month - 1]} {d.day}" + (f", {d.year}" if year else "")
    return f"{part(start, start.year != end.year)} - {part(end, True)}"


def parse_window_id(text: Any) -> tuple[date, date]:
    m = re.fullmatch(r"(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})", str(text or "").strip())
    if not m:
        raise TaskError(f"window {text!r} is not a window id such as 2026-12-25..2027-01-01")
    try:
        a, b = date.fromisoformat(m.group(1)), date.fromisoformat(m.group(2))
    except ValueError as exc:
        raise TaskError(f"window {text!r} is not a valid date range") from None
    if b < a:
        raise TaskError(f"window {text!r} ends before it starts")
    return a, b


def disconnect_days(start: date, end: date) -> tuple[date, date] | None:
    """The days STRICTLY between the two holidays (start+1 .. end-1), or None when there are none."""
    a, b = start + timedelta(days=1), end - timedelta(days=1)
    return (a, b) if a <= b else None


def read_selected_window(paths: Paths, cfg: WinterConfig) -> str:
    """The window the app selected (`params.window`); it must be the configured window."""
    if not paths.run_params.exists():
        raise TaskError("no window was selected (input/run-params.json is missing)")
    data = read_json(paths.run_params, "the run parameters")
    params = data.get("params") if isinstance(data, dict) else None
    value = params.get("window") if isinstance(params, dict) else None
    if not value:
        raise TaskError("no window was selected (params.window is missing in input/run-params.json)")
    start, end = parse_window_id(value)
    configured = window_id(cfg.start, cfg.end)
    if (start, end) != (cfg.start, cfg.end):
        raise TaskError(f"the selected window does not match the configured window {configured} "
                        "(change window in config/winter-config.json to build another window)")
    return configured


# ---- configs and inputs --------------------------------------------------------------------

def _read_config_json(path: Path, what: str) -> dict[str, Any]:
    if not path.exists():
        raise TaskError(f"the {what} config is missing (config/{path.name}); it is created once, "
                        "see README.md")
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        raise TaskError(f"the {what} config (config/{path.name}) is not valid JSON") from None
    if not isinstance(data, dict):
        raise TaskError(f"the {what} config (config/{path.name}) must be a JSON object")
    return data


def parse_winter(raw: Mapping[str, Any]) -> WinterConfig:
    try:
        return parse_config(raw)
    except ConfigError as exc:
        raise TaskError("the winter config has problems: " + first_lines(exc.problems)) from None


def parse_analytics(raw: Mapping[str, Any]) -> AnalyticsConfig:
    try:
        return parse_analytics_config(raw)
    except AnalyticsConfigError as exc:
        raise TaskError("the analytics config has problems: " + first_lines(exc.problems)) from None


def load_winter(paths: Paths, path: Path | None = None) -> tuple[WinterConfig, dict[str, Any]]:
    raw = _read_config_json(path or paths.winter_config, "winter")
    return parse_winter(raw), raw


def load_analytics(paths: Paths, path: Path | None = None) -> tuple[AnalyticsConfig, dict[str, Any]]:
    raw = _read_config_json(path or paths.analytics_config, "analytics")
    return parse_analytics(raw), raw


def load_shift_roster(paths: Paths, cfg: WinterConfig) -> Roster:
    if not paths.roster.exists():
        raise TaskError("the shift roster workbook is missing (input/roster.xlsx)")
    try:
        return load_roster(paths.roster, SHEET_NAME, section_aliases=dict(cfg.team_aliases))
    except RosterFormatError as exc:
        raise TaskError(f"the shift roster workbook cannot be read: {scrub(exc)}") from None
    except Exception as exc:  # noqa: BLE001 - not an xlsx, corrupt zip, ...
        raise TaskError(f"the shift roster workbook cannot be opened ({type(exc).__name__}); "
                        "is it a valid .xlsx file?") from None


def load_staff(paths: Paths) -> StaffRoster:
    if not paths.staff.exists():
        raise TaskError("the PDT staff roster workbook is missing (input/staff-roster.xlsx)")
    try:
        return read_staff_roster(paths.staff)
    except StaffRosterError as exc:
        raise TaskError(f"the staff roster cannot be read: {scrub(exc)}") from None
    except Exception as exc:  # noqa: BLE001
        raise TaskError(f"the staff roster cannot be opened ({type(exc).__name__}); "
                        "is it a valid .xlsx file?") from None


def read_analytics_rosters(paths: Paths) -> list[RosterReading]:
    """The optional Oct/Nov Analytics rosters that were uploaded (bad files raise TaskError)."""
    readings = []
    for p in paths.analytics_rosters():
        try:
            readings.append(read_analytics_roster(p))
        except AnalyticsRosterError as exc:
            raise TaskError(f"the analytics roster {p.name} cannot be read: {scrub(exc)}") from None
        except Exception as exc:  # noqa: BLE001
            raise TaskError(f"the analytics roster {p.name} cannot be opened "
                            f"({type(exc).__name__})") from None
    return readings


def input_records(paths: Paths) -> dict[str, dict[str, Any] | None]:
    """name / sha256 / bytes of each input that exists (None when absent)."""
    files = {"roster": paths.roster, "staff": paths.staff, "analytics_a": paths.analytics_a,
             "analytics_b": paths.analytics_b, "winter_config": paths.winter_config,
             "analytics_config": paths.analytics_config}
    return {key: (file_record(p) if p.exists() else None) for key, p in files.items()}


LABELS = {"roster": "the shift roster", "staff": "the staff roster",
          "analytics_a": "the first Analytics roster", "analytics_b": "the second Analytics roster",
          "winter_config": "the winter config", "analytics_config": "the analytics config"}
INPUT_KEYS = tuple(LABELS)


def changed_inputs(paths: Paths, recorded: Mapping[str, Any], keys: Sequence[str] = INPUT_KEYS
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


# ---- the optional task config ---------------------------------------------------------------

def shift_roster_config_path(paths: Paths) -> Path:
    """Where the shift-roster task keeps `rotation-config.json`. Default `../shift-roster/config/`;
    `config/task-config.json` may set `shift_roster_config` (absolute, or relative to this task).

    The key lives in its own file because `winter_lib` rejects unknown keys in the winter config."""
    default = paths.root.parent / "shift-roster" / "config" / "rotation-config.json"
    if not paths.task_config.exists():
        return default
    try:
        data = json.loads(paths.task_config.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        raise TaskError("config/task-config.json is not valid JSON") from None
    value = data.get("shift_roster_config") if isinstance(data, dict) else None
    if not value:
        return default
    p = Path(str(value))
    return p if p.is_absolute() else (paths.root / p).resolve()


# ---- shifts -----------------------------------------------------------------------------------

def shift_codes() -> list[str]:
    """The canonical shift codes the plan can use, in dropdown order (S1..S5, NS, US-CST, ...)."""
    return list(DISPLAY)


def shift_options() -> list[dict[str, str]]:
    return [{"value": code, "label": text if text == code else f"{text} ({code})"}
            for code, text in DISPLAY.items()]


# ---- the form ---------------------------------------------------------------------------------

def field_id(kind: str, name: str) -> str:
    return f"{kind}:{name}"


def split_field_id(fid: str) -> tuple[str, str]:
    kind, _, name = fid.partition(":")
    return kind, name


def _empty(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _fmt_options(field_: Mapping[str, Any]) -> list[str]:
    return [str(o.get("value")) for o in field_.get("options") or []]


_RANGE = re.compile(r"^(\d{4}-\d{2}-\d{2})\s*(?:\.\.|/|to)\s*(\d{4}-\d{2}-\d{2})$")


def parse_date_list(text: str, first: date, last: date) -> list[date]:
    """`2026-12-25, 2026-12-28..2026-12-30` -> sorted dates inside the window. ValueError (with
    no personal data) on a bad token or a date outside the window."""
    out: set[date] = set()
    for token in re.split(r"[,;\n]+", text):
        token = token.strip()
        if not token:
            continue
        m = _RANGE.match(token)
        try:
            if m:
                a, b = date.fromisoformat(m.group(1)), date.fromisoformat(m.group(2))
                if b < a:
                    raise ValueError(f"range {token!r} ends before it starts")
                days = [a + timedelta(days=i) for i in range((b - a).days + 1)]
            else:
                days = [date.fromisoformat(token)]
        except ValueError as exc:
            if "ends before" in str(exc):
                raise
            raise ValueError(f"{token!r} is not a date (use YYYY-MM-DD)") from None
        for d in days:
            if not first <= d <= last:
                raise ValueError(f"{d.isoformat()} is outside the window")
            out.add(d)
    return sorted(out)


@dataclass
class AvailabilityRow:
    plan: str  # "main" | "analytics"
    index: int
    person: str
    dates: list[date]
    mode: str  # unavailable | only_available


@dataclass
class ConvertedAnswers:
    shifts: dict[str, str]  # person -> canonical shift code
    name_alias: dict[str, str]  # staff-roster name -> shift-roster name (confirmed)
    name_skip: list[str]  # staff-roster names the user chose to skip (not scheduled)
    availability: list[AvailabilityRow]
    answered: int = 0

    def rows(self, plan: str) -> list[AvailabilityRow]:
        return [r for r in self.availability if r.plan == plan]


def convert_answers(form: Mapping[str, Any], flat: Any, window: tuple[date, date]) -> ConvertedAnswers:
    """Flat `{fieldId: value}` answers -> structured answers.

    Strict about what the form promised: unknown field ids, a value outside a select's options,
    a required field without an answer and a bad date list all raise `TaskError`; the message
    lists KINDS and COUNTS only (never a name). Optional fields fall back to their default."""
    if not isinstance(flat, Mapping):
        raise TaskError("the answers file must be an object {fieldId: value}")
    fields = {f["id"]: f for f in form.get("fields", [])}
    problems: list[str] = []
    unknown = sorted(set(flat) - set(fields))
    if unknown:
        problems.append(f"{len(unknown)} answer(s) are not in the form (stale answers?)")
    unanswered: Counter = Counter()
    bad_value: Counter = Counter()
    values: dict[str, str] = {}
    for fid, f in fields.items():
        raw = flat.get(fid)
        if _empty(raw):
            if f.get("required"):
                unanswered[split_field_id(fid)[0]] += 1
                continue
            raw = f.get("default")
        if _empty(raw):
            continue
        allowed = _fmt_options(f)
        if allowed and f.get("type", "select") == "select" and str(raw) not in allowed:
            bad_value[split_field_id(fid)[0]] += 1
            continue
        values[fid] = str(raw).strip()
    if unanswered:
        problems.append("required question(s) unanswered ("
                        + ", ".join(f"{k}: {v}" for k, v in sorted(unanswered.items())) + ")")
    if bad_value:
        problems.append("value(s) that are not one of the options ("
                        + ", ".join(f"{k}: {v}" for k, v in sorted(bad_value.items())) + ")")

    shifts: dict[str, str] = {}
    alias: dict[str, str] = {}
    skipped: list[str] = []
    for fid, value in values.items():
        kind, name = split_field_id(fid)
        if kind == F_SHIFT:
            shifts[name] = value
        elif kind == F_NAME:
            if value == SKIP:
                skipped.append(name)
            else:
                alias[name] = value

    rows: list[AvailabilityRow] = []
    for plan, count, kp, kd, km in (("main", MAIN_ROWS, F_AVAIL_PERSON, F_AVAIL_DATES, F_AVAIL_MODE),
                                    ("analytics", ANALYTICS_ROWS, F_AAVAIL_PERSON, F_AAVAIL_DATES,
                                     F_AAVAIL_MODE)):
        for i in range(1, count + 1):
            person = values.get(f"{kp}_{i}", NONE)
            if person in ("", NONE):
                continue
            text = values.get(f"{kd}_{i}", "")
            mode = values.get(f"{km}_{i}", MODES[0])
            if mode not in MODES:
                problems.append(f"{plan} availability row {i}: unknown mode")
                continue
            try:
                dates = parse_date_list(text, *window)
            except ValueError as exc:
                problems.append(f"{plan} availability row {i}: {exc}")
                continue
            if not dates:
                problems.append(f"{plan} availability row {i}: a person is chosen but no dates were given")
                continue
            rows.append(AvailabilityRow(plan, i, person, dates, mode))
    if problems:
        raise TaskError("the answers are incomplete or invalid: " + "; ".join(problems[:8]))
    return ConvertedAnswers(dict(sorted(shifts.items())), dict(sorted(alias.items())),
                            sorted(skipped), rows, len(values))


# ---- merging the answers into copies of the configs ----------------------------------------------

def _find_key(mapping: Mapping[str, Any], name: str) -> str | None:
    k = name_key(name)
    return next((key for key in mapping if name_key(str(key)) == k), None)


def merge_winter_raw(raw: Mapping[str, Any], converted: ConvertedAnswers) -> dict[str, Any]:
    """A COPY of the winter config with the answers merged in: confirmed name matches become
    `name_aliases`, skipped staff names become exclusions, availability exceptions are added to
    `availability`. `default_new_person_shift` is switched off (the form asks instead)."""
    out = copy.deepcopy(dict(raw))
    out["default_new_person_shift"] = None
    aliases = dict(out.get("name_aliases") or {})
    aliases.update(converted.name_alias)
    out["name_aliases"] = aliases
    if converted.name_skip:
        ex = dict(out.get("exclusions") or {})
        people = list(ex.get("people") or [])
        have = {name_key(p) for p in people}
        people += [n for n in converted.name_skip if name_key(n) not in have]
        ex["people"] = people
        out["exclusions"] = ex
    availability = copy.deepcopy(dict(out.get("availability") or {}))
    for row in converted.rows("main"):
        iso = [d.isoformat() for d in row.dates]
        key = _find_key(availability, row.person) or row.person
        spec = dict(availability.get(key) or {})
        if row.mode == "unavailable":
            spec["unavailable"] = sorted(set(spec.get("unavailable") or []) | set(iso))
        else:
            # "allowed" entries may be ranges in a hand-written config: expand them to compare
            existing = spec.get("allowed")
            if existing is None:
                spec["allowed"] = sorted(set(iso))
            else:
                spec["allowed"] = sorted(_expand(existing) & set(iso))
        availability[key] = spec
    if availability:
        out["availability"] = availability
    return out


def _expand(items: Iterable[str]) -> set[str]:
    out: set[str] = set()
    for it in items:
        m = _RANGE.match(str(it).strip())
        if m:
            a, b = date.fromisoformat(m.group(1)), date.fromisoformat(m.group(2))
            out |= {(a + timedelta(days=i)).isoformat() for i in range((b - a).days + 1)}
        else:
            out.add(str(it).strip())
    return out


@dataclass
class AnalyticsRefresh:
    """What refreshing the Analytics usual shifts from the Oct/Nov rosters changed (counts only)."""
    files: int = 0
    matched: int = 0
    updated: int = 0
    unchanged: int = 0
    kept_invalid: int = 0  # the roster's modal shift is not allowed for the person's role
    not_in_rosters: int = 0  # config people the rosters do not list: config value kept
    extra_in_rosters: int = 0  # people the rosters list that the config does not have

    def to_dict(self) -> dict[str, int]:
        return dict(self.__dict__)


def refresh_analytics_raw(raw: Mapping[str, Any], readings: Sequence[RosterReading]
                          ) -> tuple[dict[str, Any], AnalyticsRefresh]:
    """A COPY of the analytics config whose `usual_shift` values are refreshed from the rosters
    (modal S1-S3 shift over all uploaded months; people and roles stay as configured)."""
    out = copy.deepcopy(dict(raw))
    info = AnalyticsRefresh(files=len(readings))
    if not readings:
        return out, info
    merged = {name_key(p.name): p for p in merge_readings(list(readings))}
    seen: set[str] = set()
    for person in out.get("people") or []:
        keys = [name_key(str(person.get("name", ""))), name_key(str(person.get("short_name") or ""))]
        hit = next((merged[k] for k in keys if k and k in merged), None)
        if hit is None:
            info.not_in_rosters += 1
            continue
        seen.add(name_key(hit.name))
        info.matched += 1
        new = modal_shift(hit.shifts)
        role = person.get("role", "support")
        if new is None or (new == "S4" and role != "mexico"):
            info.kept_invalid += 1
            continue
        if person.get("usual_shift") == new:
            info.unchanged += 1
        else:
            person["usual_shift"] = new
            info.updated += 1
    info.extra_in_rosters = len(set(merged) - seen)
    return out, info


def merge_analytics_raw(raw: Mapping[str, Any], converted: ConvertedAnswers,
                        cfg_before: AnalyticsConfig) -> dict[str, Any]:
    """A COPY of the analytics config with the availability exceptions merged in as explicit
    `available` date lists (the person's own display name identifies the row)."""
    out = copy.deepcopy(dict(raw))
    people = out.get("people") or []
    window = set(cfg_before.dates)
    state: dict[str, set[date]] = {}
    for row in converted.rows("analytics"):
        person = cfg_before.person(row.person)
        if person is None:
            raise TaskError(f"analytics availability row {row.index}: the person is not on the analytics config")
        current = state.get(person.display)
        if current is None:
            current = set(person.available) if person.available is not None else set(window)
        wanted = set(row.dates)
        state[person.display] = (current - wanted) if row.mode == "unavailable" else (current & wanted)
    for entry in people:
        disp = str(entry.get("short_name") or entry.get("name"))
        if disp in state:
            entry["available"] = sorted(d.isoformat() for d in state[disp])
    return out


# ---- flags ------------------------------------------------------------------------------------

_SEVERITY_RANK = {"error": 0, "warning": 1, "info": 2}


def iso_or_none(d: Any) -> str | None:
    return d.isoformat() if d is not None else None


def main_flag(finding: Any, source: str = "audit", prefix: str = MAIN_TAG) -> dict[str, Any]:
    """A winter_audit / winter_inputs `Finding` as a flag (kind WINTER_<CODE>)."""
    return {"key": "", "severity": str(finding.severity).lower(),
            "kind": "WINTER_" + finding.code.upper(), "person": finding.person,
            "date": iso_or_none(finding.date), "team": finding.team,
            "message": f"{prefix} {finding.message}", "plan": "main", "source": source}


def analytics_flag(finding: Any, source: str = "audit") -> dict[str, Any]:
    """An analytics_audit `Finding` as a flag (kind ANALYTICS_<RULE>)."""
    return {"key": "", "severity": str(finding.severity).lower(),
            "kind": "ANALYTICS_" + finding.rule.upper(), "person": None, "date": None,
            "where": finding.where, "message": f"{ANALYTICS_TAG} {finding.message}",
            "plan": "analytics", "source": source}


def note_flag(kind: str, message: str, plan: str, source: str = "plan") -> dict[str, Any]:
    tag = MAIN_TAG if plan == "main" else ANALYTICS_TAG
    return {"key": "", "severity": "info", "kind": kind, "person": None, "date": None,
            "message": f"{tag} {message}", "plan": plan, "source": source}


def _flag_sort(f: Mapping[str, Any]):
    return (_SEVERITY_RANK.get(f["severity"], 9), f["plan"], f["kind"], f.get("date") or "",
            f.get("person") or "", f.get("where") or "", f["message"])


def assign_keys(flags: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sort the flags and give each a stable key. The key ignores the message text (it may carry
    counts that change when the user edits) and numbers repeats of the same identity."""
    ordered = sorted(flags, key=_flag_sort)
    seen: Counter = Counter()
    for f in ordered:
        ident = "|".join([f["kind"], f["plan"], f.get("team") or "", f.get("person") or "",
                          f.get("date") or "", f.get("where") or ""])
        seen[ident] += 1
        f["key"] = ident if seen[ident] == 1 else f"{ident}#{seen[ident]}"
    return ordered


def flag_counts(flags: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    counts = {"error": 0, "warning": 0, "info": 0}
    for f in flags:
        counts[f["severity"]] = counts.get(f["severity"], 0) + 1
    return counts


def flags_payload(flags: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """`output/flags.json`: `{"counts": {error, warning, info}, "flags": [...]}`."""
    rows = assign_keys(list(flags))
    return {"counts": flag_counts(rows), "flags": rows}


def audit_delta(before: Sequence[Mapping[str, Any]], after: Sequence[Mapping[str, Any]],
                carried: int = 0) -> dict[str, Any]:
    """New / resolved / remaining audit flags (errors and warnings; info lines are summaries that
    change with every edit). `remaining` also counts the plan-time flags that are not re-checked."""
    def pick(items):
        return {f["key"]: dict(f) for f in items if f["severity"] != "info"}
    b, a = pick(before), pick(after)
    return {"new": [a[k] for k in a if k not in b],
            "resolved": [b[k] for k in b if k not in a],
            "remaining": len([k for k in a if k in b]) + carried,
            "not_rechecked": carried}


# ---- the previous run ---------------------------------------------------------------------------

def load_previous_plan(paths: Paths, cfg: WinterConfig) -> WinterPlan | None:
    """The plan of the run being replaced (the stability reference), only when it covers the same
    window: `plan.json` (a re-run of the draft step) else `previous-plan.json` (set by analyze)."""
    for candidate in (paths.plan, paths.previous_plan):
        if not candidate.exists():
            continue
        try:
            plan = WinterPlan.from_json(candidate.read_text(encoding="utf-8"))
        except (OSError, ValueError, KeyError):
            continue
        if tuple(plan.window) == tuple(cfg.days):
            return plan
    return None


def keep_previous_plans(paths: Paths) -> int:
    """analyze: the plan files of the finished/abandoned run become the stability reference."""
    n = 0
    for src, dst in ((paths.plan, paths.previous_plan),
                     (paths.analytics_plan, paths.previous_analytics_plan)):
        if src.exists():
            os.replace(src, dst)
            n += 1
    return n


def previous_draft_files(paths: Paths) -> list[Path]:
    """Draft workbooks and their sidecars from an earlier build."""
    found: list[Path] = []
    for pattern in ("Winter Coverage DRAFT *", "Analytics Winter Coverage DRAFT *"):
        found += sorted(p for p in paths.output.glob(pattern) if p.is_file())
    return found


def archive_previous(paths: Paths, moment: datetime | None = None) -> tuple[Path | None, int]:
    """Move an earlier draft (workbooks, snapshot sidecars, their plan and diff files) into
    `output/archive/<UTC timestamp>/` so a re-run never destroys the user's edits."""
    drafts = previous_draft_files(paths)
    if not drafts:
        return None, 0
    stamp = now_stamp(moment)
    target = paths.archive_dir / stamp
    n = 1
    while target.exists():
        n += 1
        target = paths.archive_dir / f"{stamp}-{n}"
    target.mkdir(parents=True)
    moved = 0
    for src in drafts + [p for p in (paths.plan, paths.analytics_plan, paths.diff, paths.flags,
                                     paths.meta) if p.exists()]:
        os.replace(src, target / src.name)
        moved += 1
    return target, moved


def draft_meta(paths: Paths) -> dict[str, Any]:
    return read_json(paths.meta, "the draft record (draft-meta.json)")


def label_of(code: str | None) -> str:
    return display_code(code)
