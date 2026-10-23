"""
Audit of a finished Analytics winter workbook, read back from the FILE (not from the plan).

`audit_analytics_plan(path, config)` opens the workbook with openpyxl and checks the Winter
Roster tab against the config, so it works on the file as the user left it: edited by hand,
re-saved by Excel, columns or rows inserted. The table is located by its header labels
(`Date`, `Slot`, `Assigned`, optionally `Time zone`), never by cell address, and only
constants are read (names typed or picked from the dropdown). It never depends on the hidden
`_snapshot` sheet or the sidecar.

Findings (structured; severity error / warning / info; rule id; plain-English message):

    grid           the slot rows match the config template (date x code counts)
    filled         every slot has a person                    ("34 of 34 slots filled")
    people_list    every name is on the Analytics people list (short or full name, any case)
    slot_counts    counts per person: standard count, availability cuts, extra slot(s); an
                   extra slot beyond the standard is an INFO exception, not an error, when the
                   person may take one
    double_slot    nobody works two slots on one day
    on_call_day    nobody works a slot on their own on-call day
    one_on_call    exactly one named person on call every day
    on_call_days   on-call days shared out as configured (8 days / 2 people = 4 each)
    availability   nobody placed on a day they are not available
    roles          on-call rows go to on-call people, Mexico (S4) slots to the Mexico person
    formula_errors no formula cell holds an error value (cached values as Excel saved them)
    file           the workbook cannot be read / has no Winter Roster table

`diff_against_snapshot(path)` lists what the user changed relative to the plan as written
(the hidden `_snapshot` sheet, else the sidecar), keyed by date and slot label.
"""

from __future__ import annotations

import re
import unicodedata
import warnings
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Optional

import openpyxl

from roster_lib.config import name_key

from .analytics_config import (
    AnalyticsConfig, IST_CODES, MEXICO, ON_CALL_LABEL, PersonCfg, ROLE_MEXICO, ROLE_ON_CALL,
)
from .analytics_plan import Assignment, evaluate_preferences, fmt_dates, slot_template_rows, standard_counts
from .analytics_workbook import (
    AnalyticsSnapshot, SHEET_ROSTER, read_snapshot_sheet, read_snapshot_sidecar,
)

EPOCH = date(1899, 12, 30)
ERROR_TEXTS = {"#N/A", "#REF!", "#VALUE!", "#DIV/0!", "#NAME?", "#NULL!", "#NUM!"}
_ON_CALL_KEYS = {"on call", "oncall", "oc"}


@dataclass(frozen=True)
class Finding:
    severity: str  # "error" | "warning" | "info"
    rule: str
    message: str
    where: str = ""  # e.g. "Dec 28 S1" or "Winter Roster row 12"

    def to_dict(self) -> dict[str, str]:
        return {"severity": self.severity, "rule": self.rule, "message": self.message, "where": self.where}


@dataclass
class AuditResult:
    path: str
    findings: list[Finding] = field(default_factory=list)
    filled: int = 0
    total_slots: int = 0
    counts: dict[str, int] = field(default_factory=dict)  # slots per person (display names)
    on_call_counts: dict[str, int] = field(default_factory=dict)
    assignments: list[Assignment] = field(default_factory=list)
    on_call: dict[date, str] = field(default_factory=dict)
    preferences: dict[str, int] = field(default_factory=dict)

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "error"]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "warning"]

    @property
    def infos(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "info"]

    @property
    def ok(self) -> bool:
        return not self.errors

    def by_rule(self, rule: str) -> list[Finding]:
        return [f for f in self.findings if f.rule == rule]

    def summary(self) -> str:
        head = f"{self.filled} of {self.total_slots} slots filled; {len(self.errors)} error(s), {len(self.warnings)} warning(s)"
        return head

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path, "ok": self.ok, "filled": self.filled, "total_slots": self.total_slots,
            "counts": dict(self.counts), "on_call_counts": dict(self.on_call_counts),
            "preferences": dict(self.preferences),
            "findings": [f.to_dict() for f in self.findings],
        }


@dataclass(frozen=True)
class SheetRow:
    row: int
    date: date
    label: str
    zone: str  # "" when the file has no zone column
    assigned: str  # as typed ("" when blank)
    formula: bool = False


def _dstr(d: date) -> str:
    return f"{d:%b} {d.day}"


def _clean(v: Any) -> str:
    if v is None:
        return ""
    return " ".join(unicodedata.normalize("NFKC", str(v)).replace(" ", " ").split())


def _as_date(v: Any) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, (int, float)) and not isinstance(v, bool) and 20000 < v < 80000:
        return EPOCH + timedelta(days=int(v))
    if isinstance(v, str):
        try:
            return date.fromisoformat(v.strip()[:10])
        except ValueError:
            return None
    return None


def _norm_header(v: Any) -> str:
    return re.sub(r"[^a-z]", "", _clean(v).casefold())


def _is_on_call(label: str) -> bool:
    return re.sub(r"[-_]", " ", label.casefold()).strip() in _ON_CALL_KEYS


def _slot_code(label: str) -> str:
    m = re.match(r"^\s*(S\d+)", label, re.I)
    return m.group(1).upper() if m else ""


def read_roster_rows(path: str | Path) -> tuple[list[SheetRow], list[str]]:
    """The Winter Roster table rows of the file, plus problems that prevented reading them."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            wb = openpyxl.load_workbook(path, data_only=False)
    except Exception as e:  # unreadable / not an xlsx
        return [], [f"the workbook cannot be opened ({type(e).__name__}: {e})"]
    try:
        sheets = sorted(wb.worksheets, key=lambda w: 0 if w.title.strip().casefold() == SHEET_ROSTER.casefold() else 1)
        for ws in sheets:
            if ws.sheet_state == "veryHidden":
                continue
            for hr in range(1, min(ws.max_row, 40) + 1):
                cols: dict[str, int] = {}
                for c in range(1, min(ws.max_column, 30) + 1):
                    h = _norm_header(ws.cell(hr, c).value)
                    if h in ("date", "slot", "assigned", "timezone", "zone") and h not in cols:
                        cols[h] = c
                if {"date", "slot", "assigned"} <= set(cols):
                    zone_col = cols.get("timezone") or cols.get("zone")
                    rows: list[SheetRow] = []
                    for r in range(hr + 1, ws.max_row + 1):
                        d = _as_date(ws.cell(r, cols["date"]).value)
                        label = _clean(ws.cell(r, cols["slot"]).value)
                        if d is None or not label:
                            continue
                        raw = ws.cell(r, cols["assigned"]).value
                        is_formula = isinstance(raw, str) and raw.startswith("=")
                        rows.append(SheetRow(
                            r, d, label, _clean(ws.cell(r, zone_col).value) if zone_col else "",
                            "" if is_formula else _clean(raw), is_formula))
                    return rows, []
        return [], [f"no table with Date, Slot and Assigned columns found (expected the {SHEET_ROSTER!r} tab)"]
    finally:
        wb.close()


def _formula_error_cells(path: str | Path) -> list[str]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            wb = openpyxl.load_workbook(path, data_only=True)
    except Exception:
        return []
    out: list[str] = []
    try:
        for ws in wb.worksheets:
            for row in ws.iter_rows():
                for c in row:
                    if c.data_type == "e" or (isinstance(c.value, str) and c.value in ERROR_TEXTS):
                        out.append(f"{ws.title}!{c.coordinate}")
    finally:
        wb.close()
    return out


def audit_analytics_plan(path: str | Path, config: AnalyticsConfig) -> AuditResult:
    """Audit the workbook at `path` against `config` (see the module docstring)."""
    res = AuditResult(path=str(path), total_slots=len(config.slots))
    add = lambda sev, rule, msg, where="": res.findings.append(Finding(sev, rule, msg, where))

    rows, problems = read_roster_rows(path)
    if problems:
        for p in problems:
            add("error", "file", p)
        return res

    slot_rows = [r for r in rows if not _is_on_call(r.label)]
    oc_rows = [r for r in rows if _is_on_call(r.label)]
    for r in rows:
        if r.formula:
            add("error", "people_list", "the Assigned cell holds a formula instead of a name",
                f"{_dstr(r.date)} {r.label} (row {r.row})")

    # ---- grid vs template ----
    expected = Counter((s.date, s.code) for s in config.slots)
    found = Counter((r.date, _slot_code(r.label)) for r in slot_rows)
    for key in sorted(set(expected) | set(found)):
        e, f = expected.get(key, 0), found.get(key, 0)
        if e != f:
            d, code = key
            add("error", "grid", f"{_dstr(d)}: expected {e} {code} slot(s), found {f}", f"{_dstr(d)} {code}")
    dates_in_file = {r.date for r in rows}
    for d in config.dates:
        if d not in dates_in_file:
            add("error", "grid", f"{_dstr(d)} is missing from the Winter Roster", _dstr(d))

    # ---- resolve names ----
    person_of: dict[int, PersonCfg] = {}
    for r in rows:
        if not r.assigned:
            continue
        p = config.person(r.assigned)
        if p is None:
            add("error", "people_list", f"{r.assigned!r} is not on the Analytics people list",
                f"{_dstr(r.date)} {r.label} (row {r.row})")
        else:
            person_of[r.row] = p

    # ---- filled ----
    filled = 0
    for r in slot_rows:
        if r.assigned:
            filled += 1
        else:
            add("error", "filled", "no person assigned", f"{_dstr(r.date)} {r.label} (row {r.row})")
    res.filled = min(filled, len(config.slots))

    # ---- assignments / on call ----
    on_call: dict[date, str] = {}
    oc_by_date: dict[date, list[SheetRow]] = {}
    for r in oc_rows:
        oc_by_date.setdefault(r.date, []).append(r)
    for d in config.dates:
        named = [r for r in oc_by_date.get(d, []) if r.assigned]
        if not oc_by_date.get(d):
            add("error", "one_on_call", f"no On call row for {_dstr(d)}", _dstr(d))
        elif len(named) == 0:
            add("error", "one_on_call", f"nobody is on call on {_dstr(d)}", _dstr(d))
        elif len(named) > 1:
            add("error", "one_on_call", f"{len(named)} people are on call on {_dstr(d)}; exactly one is required",
                _dstr(d))
        if named and named[0].row in person_of:
            on_call[d] = person_of[named[0].row].display
    res.on_call = dict(sorted(on_call.items()))

    by_person_slots: dict[str, list[SheetRow]] = {}
    assigns: list[Assignment] = []
    template = {(s.date, s.label): s for s in slot_template_rows(config)}
    for r in slot_rows:
        p = person_of.get(r.row)
        if p is None:
            continue
        by_person_slots.setdefault(p.display, []).append(r)
        code = _slot_code(r.label)
        tpl = template.get((r.date, r.label))
        zone = r.zone or (tpl.zone if tpl else (MEXICO if code == "S4" else "IST"))
        start = tpl.start if tpl else time(0, 0)
        assigns.append(Assignment(r.date, code, r.label, start, zone, p.display))
    res.assignments = sorted(assigns, key=lambda a: (a.date, a.start, a.label))
    res.counts = {p.display: len(by_person_slots.get(p.display, [])) for p in config.people}
    res.on_call_counts = {p.display: sum(1 for v in on_call.values() if v == p.display)
                          for p in config.on_call_people}

    # ---- double slot / own on-call day ----
    for p in config.people:
        mine = by_person_slots.get(p.display, [])
        per_day = Counter(r.date for r in mine)
        for d, n in sorted(per_day.items()):
            if n > 1:
                add("error", "double_slot", f"{p.display} has {n} slots on {_dstr(d)}", f"{_dstr(d)} {p.display}")
            if on_call.get(d) == p.display:
                add("error", "on_call_day", f"{p.display} works a slot on their own on-call day ({_dstr(d)})",
                    f"{_dstr(d)} {p.display}")

    # ---- availability ----
    for p in config.people:
        for r in by_person_slots.get(p.display, []):
            if not p.is_available(r.date):
                add("error", "availability", f"{p.display} is not available on {_dstr(r.date)}",
                    f"{_dstr(r.date)} {r.label}")
        for d, who in on_call.items():
            if who == p.display and not p.is_available(d):
                add("error", "availability", f"{p.display} is not available on {_dstr(d)} (on call)", f"{_dstr(d)} On call")

    # ---- roles ----
    for d, who in on_call.items():
        p = config.person(who)
        if p is not None and p.role != ROLE_ON_CALL:
            add("error", "roles", f"{p.display} is not one of the on-call people but is on call on {_dstr(d)}",
                f"{_dstr(d)} On call")
    for r in slot_rows:
        p = person_of.get(r.row)
        if p is None:
            continue
        tpl = template.get((r.date, r.label))
        zone = r.zone or (tpl.zone if tpl else "")
        if zone == MEXICO and p.role != ROLE_MEXICO:
            add("error", "roles", f"{p.display} is not the Mexico person but works the Mexico slot",
                f"{_dstr(r.date)} {r.label}")
        if zone != MEXICO and p.role == ROLE_MEXICO:
            add("error", "roles", f"{p.display} (Mexico) works an IST slot", f"{_dstr(r.date)} {r.label}")

    # ---- slot counts ----
    std = standard_counts(config)
    n_mx = len(config.mexico_slots)
    for p in config.people:
        got = res.counts.get(p.display, 0)
        if p.role == ROLE_MEXICO:
            want = n_mx if len(config.mexico_people) == 1 else None
            if want is not None and got != want:
                add("error", "slot_counts", f"{p.display} works {got} Mexico slot(s); expected {want}", p.display)
            continue
        base = std[p.key]
        full = config.on_call_slots_each if p.role == ROLE_ON_CALL else config.slots_per_person
        most = base + (1 if (p.extra_eligible and base == full) else 0)
        if got < base:
            add("error", "slot_counts", f"{p.display} works {got} slot(s), fewer than the standard {base}", p.display)
        elif got > most:
            add("error", "slot_counts",
                f"{p.display} works {got} slot(s); at most {most} is allowed (standard {base}"
                f"{', one extra slot if needed' if most > base else ''})", p.display)
        elif got > base:
            add("info", "slot_counts",
                f"{p.display} works {got} slots, {got - base} more than the standard {base} (extra slot to fill the grid)",
                p.display)
        if base < full and got == base:
            add("info", "slot_counts",
                f"{p.display} works {got} slot(s): available {fmt_dates(sorted(p.available or []))} only", p.display)

    # ---- on-call days ----
    n_oc = len(config.on_call_people)
    if n_oc:
        base, rem = divmod(len(config.dates), n_oc)
        for p in config.on_call_people:
            got = res.on_call_counts.get(p.display, 0)
            if got < base or got > base + (1 if rem else 0):
                add("error", "on_call_days", f"{p.display} is on call {got} day(s); expected {base}"
                    f"{' or ' + str(base + 1) if rem else ''}", p.display)

    # ---- formula errors (cached values as saved) ----
    bad = _formula_error_cells(path)
    if bad:
        add("error", "formula_errors", f"{len(bad)} formula cell(s) show an error: " + ", ".join(bad[:8]), bad[0])

    # ---- soft preferences (information only) ----
    res.preferences = evaluate_preferences(config, res.assignments, res.on_call)
    if res.preferences.get("usual_shift_misses"):
        add("info", "preferences", f"{res.preferences['usual_shift_misses']} slot(s) are not on the person's usual shift")
    if res.preferences.get("turnarounds"):
        add("warning", "preferences", f"{res.preferences['turnarounds']} quick turnaround(s): a late shift followed by an early one")
    return res


# ---- snapshot diff ----------------------------------------------------------------

@dataclass(frozen=True)
class Change:
    date: date
    slot: str  # slot label or "On call"
    was: str
    now: str

    def to_dict(self) -> dict[str, str]:
        return {"date": self.date.isoformat(), "slot": self.slot, "was": self.was, "now": self.now}


@dataclass
class SnapshotDiff:
    source: Optional[str]  # "sheet" | "sidecar" | None
    plan_hash: str = ""
    changes: list[Change] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return bool(self.changes)


def diff_against_snapshot(path: str | Path) -> SnapshotDiff:
    """What the user changed since the plan was written (hidden sheet first, else the sidecar)."""
    snap: Optional[AnalyticsSnapshot] = None
    source: Optional[str] = None
    problems: list[str] = []
    side: Optional[AnalyticsSnapshot] = None
    try:
        side = read_snapshot_sidecar(path)
    except Exception as e:
        problems.append(f"sidecar unreadable: {e}")
    try:
        sheet = read_snapshot_sheet(path)
    except Exception as e:
        sheet = None
        problems.append(f"_snapshot sheet unreadable: {e}")
    if sheet is not None:
        snap, source = sheet, "sheet"
        if side is not None and side.digest() != sheet.digest():
            problems.append("the _snapshot sheet and the sidecar disagree; the sheet is used")
    elif side is not None:
        snap, source = side, "sidecar"
    if snap is None:
        problems.append("no snapshot found (neither the _snapshot sheet nor the sidecar)")
        return SnapshotDiff(None, "", [], problems)
    rows, read_problems = read_roster_rows(path)
    if read_problems:
        return SnapshotDiff(source, str(snap.meta.get("plan_hash", "")), [], problems + read_problems)
    now = {(r.date.isoformat(), ON_CALL_LABEL if _is_on_call(r.label) else r.label): r.assigned for r in rows}
    then = snap.person_map()
    changes: list[Change] = []
    for key in sorted(set(then) | set(now)):
        before, after = then.get(key, ""), now.get(key, "")
        if name_key(before) != name_key(after):
            changes.append(Change(date.fromisoformat(key[0]), key[1], before, after))
    return SnapshotDiff(source, str(snap.meta.get("plan_hash", "")), changes, problems)
