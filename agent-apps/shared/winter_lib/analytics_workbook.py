"""
Analytics winter plan workbook (new file via xlsxwriter, formula-linked, three visible tabs).

    Daily View    leadership one-pager: per date who is on call, who works which slot (with the
                  start time in IST) and the Mexico slot; KPI tiles on top.
    Winter Roster the editable template. One row per slot (date, day type, slot code, start,
                  hours, time zone) plus an `On call` row per day. The `Assigned` column has a
                  NAME DROPDOWN (the Analytics people list on By Person) and a per-row `Check`
                  formula; the other tabs update by formula.
    By Person     per-person table (slot / on-call per date, counts vs target, holiday/weekend
                  days, rows flagged, availability grid) and a RULE CHECK table (PASS / FAIL).
    _snapshot     veryHidden: every assignment as written plus meta (plan hash...). The same
                  snapshot is written next to the file as `<file>.snapshot.json`, so a later
                  step can diff the user's edits (see analytics_audit.diff_against_snapshot).

Build flow: the file is written once, every formula is evaluated with analytics_formula_eval
(a restricted evaluator; real Excel / LibreOffice were not available), then the file is written
again with those results as the formulas' cached values and re-verified (zero errors, cached ==
recalculated). Excel still fully recalculates on open (fullCalcOnLoad).

The Winter Roster column layout is part of the contract with analytics_audit (it finds the
table by its header labels, not by position, so a user may insert columns or rows).
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from datetime import date, datetime, time
from pathlib import Path
from typing import Any, Optional, Union

from xlsxwriter.utility import xl_col_to_name

from . import xlsx_style as sty
from .analytics_config import (
    AnalyticsConfig, IST, MEXICO, ON_CALL_LABEL, ON_CALL_CODE, PersonCfg, ROLE_MEXICO, ROLE_ON_CALL,
    ROLE_SUPPORT,
)
from .analytics_formula_eval import ExcelError, FormulaCheck, Workbook as EvalWorkbook, check_workbook_formulas
from .analytics_plan import AnalyticsPlan, fmt_dates, ordinal, slot_template_rows, standard_counts

SHEET_DAILY = "Daily View"
SHEET_ROSTER = "Winter Roster"
SHEET_PERSON = "By Person"
SHEET_SNAPSHOT = "_snapshot"

SNAPSHOT_SCHEMA = "analytics-winter-snapshot/1"
SNAPSHOT_MARK = "analytics-winter-snapshot"
SNAPSHOT_HEADER = ("kind", "date", "slot", "code", "start", "zone", "person")
SIDECAR_SUFFIX = ".snapshot.json"

ROSTER_HEADERS = ("Date", "Day type", "Holiday / weekend", "Slot", "Start (IST)", "Hours (IST)", "Time zone",
                  "Assigned", "Check", "Key (helper)")
ROLE_TEXT = {ROLE_SUPPORT: "Support", ROLE_ON_CALL: ON_CALL_LABEL, ROLE_MEXICO: "Mexico"}
DEFAULT_LOGO = Path(__file__).resolve().parent.parent / "assets" / "takeda-logo.png"

PathLike = Union[str, os.PathLike]


class AnalyticsWorkbookError(Exception):
    """The workbook could not be built (nothing is left behind)."""


@dataclass(frozen=True)
class RosterRow:
    date: date
    label: str  # S1, S2-A ... or "On call"
    code: str  # S1..S4 or OC
    start: time
    zone: str
    kind: str  # "slot" | "oc"
    person: str  # display name ("" when open)


@dataclass
class BuildResult:
    path: str
    sidecar_path: str
    plan_hash: str
    formula_check: FormulaCheck
    notes: list[str] = field(default_factory=list)


def roster_rows(config: AnalyticsConfig, plan: AnalyticsPlan) -> list[RosterRow]:
    """The Winter Roster rows: each day's slots in template order, then its On call row."""
    who = {(a.date, a.label): a.person for a in plan.assignments}
    template = slot_template_rows(config)
    oc_start = _t(config.shift_hours.get(ON_CALL_CODE, ("06:00", "08:00"))[0])
    rows: list[RosterRow] = []
    for d in config.dates:
        for s in template:
            if s.date == d:
                rows.append(RosterRow(d, s.label, s.code, s.start, s.zone, "slot", who.get((d, s.label), "")))
        rows.append(RosterRow(d, ON_CALL_LABEL, ON_CALL_CODE, oc_start, IST, "oc", plan.on_call.get(d, "")))
    return rows


def _t(hhmm: str) -> time:
    h, m = hhmm.split(":")
    return time(int(h), int(m))


def _dt(d: date) -> datetime:
    return datetime(d.year, d.month, d.day)


def _q(sheet: str) -> str:
    return "'" + sheet.replace("'", "''") + "'"


# ---- snapshot ------------------------------------------------------------------

@dataclass
class AnalyticsSnapshot:
    meta: dict[str, Any]
    rows: list[list[str]]  # [kind, date, slot, code, start, zone, person]

    def to_dict(self) -> dict[str, Any]:
        return {"schema": SNAPSHOT_SCHEMA, "meta": self.meta, "rows": self.rows}

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, ensure_ascii=False, indent=1) + "\n"

    def digest(self) -> str:
        blob = json.dumps({"meta": self.meta, "rows": self.rows}, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()

    def person_map(self) -> dict[tuple[str, str], str]:
        """{(date ISO, slot label or 'On call'): person} as written."""
        return {(r[1], r[2]): r[6] for r in self.rows}


def make_snapshot(config: AnalyticsConfig, plan: AnalyticsPlan, rows: list[RosterRow]) -> AnalyticsSnapshot:
    meta = {
        "plan_hash": plan.plan_hash,
        "config_hash": plan.config_hash,
        "seed": plan.seed,
        "window": {"start": config.dates[0].isoformat(), "end": config.dates[-1].isoformat()},
        "slots": len(config.slots),
        "people": [p.display for p in config.people],
        "counts": dict(plan.counts),
        "on_call_counts": dict(plan.on_call_counts),
        "notes": list(plan.notes),
        "generated_by": "winter_lib.analytics_workbook",
    }
    body = [[r.kind, r.date.isoformat(), r.label, r.code, r.start.strftime("%H:%M"), r.zone, r.person] for r in rows]
    return AnalyticsSnapshot(meta, body)


def sidecar_path_for(path: PathLike) -> str:
    return os.fspath(path) + SIDECAR_SUFFIX


def read_snapshot_sidecar(path: PathLike) -> Optional[AnalyticsSnapshot]:
    """The sidecar of a workbook (`<file>.snapshot.json`), None when absent."""
    p = Path(sidecar_path_for(path))
    if not p.exists():
        return None
    data = json.loads(p.read_text(encoding="utf-8"))
    if data.get("schema") != SNAPSHOT_SCHEMA:
        raise AnalyticsWorkbookError("the sidecar is not an analytics winter snapshot")
    return AnalyticsSnapshot(dict(data["meta"]), [list(r) for r in data["rows"]])


def read_snapshot_sheet(path: PathLike) -> Optional[AnalyticsSnapshot]:
    """The snapshot held in the veryHidden `_snapshot` sheet, None when the sheet is missing."""
    import warnings
    import openpyxl
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = openpyxl.load_workbook(path, data_only=True)
    try:
        if SHEET_SNAPSHOT not in wb.sheetnames:
            return None
        ws = wb[SHEET_SNAPSHOT]
        if ws.cell(1, 1).value != SNAPSHOT_MARK or ws.cell(1, 2).value != SNAPSHOT_SCHEMA:
            raise AnalyticsWorkbookError("the _snapshot sheet does not carry the analytics snapshot marker")
        meta: dict[str, Any] = {}
        rows: list[list[str]] = []
        in_rows = False
        for r in range(2, ws.max_row + 1):
            first = ws.cell(r, 1).value
            if first is None:
                continue
            if not in_rows:
                if str(first).startswith("meta."):
                    meta[str(first)[5:]] = json.loads(str(ws.cell(r, 2).value))
                elif tuple(str(ws.cell(r, c).value) for c in range(1, 8)) == SNAPSHOT_HEADER:
                    in_rows = True
                continue
            rows.append(["" if ws.cell(r, c).value is None else str(ws.cell(r, c).value) for c in range(1, 8)])
        return AnalyticsSnapshot(meta, rows)
    finally:
        wb.close()


# ---- writing -------------------------------------------------------------------

class _Ctx:
    """Writes formulas with cached values from a previous evaluation pass."""

    def __init__(self, cached: dict[tuple[str, int, int], Any]):
        self.cached = cached

    def value(self, ws, row: int, col: int) -> Any:
        v = self.cached.get((ws.get_name(), row + 1, col + 1), 0)
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        return v.code if isinstance(v, ExcelError) else v

    def formula(self, ws, row: int, col: int, formula: str, fmt=None) -> None:
        ws.write_formula(row, col, formula, fmt, self.value(ws, row, col))


def _person_note(config: AnalyticsConfig, plan: AnalyticsPlan, p: PersonCfg) -> str:
    std = standard_counts(config)
    got = plan.counts.get(p.display, 0)
    if p.role == ROLE_MEXICO:
        return f"Mexico slots (S4), {got} in total"
    if p.role == ROLE_ON_CALL:
        n_oc = plan.on_call_counts.get(p.display, 0)
        return f"On call {n_oc} days + {got} slot{'s' if got != 1 else ''}"
    parts = []
    if p.available is not None:
        parts.append(f"Available {fmt_dates(sorted(p.available))} only")
    if got > std[p.key]:
        parts.append(f"takes a {ordinal(got)} slot")
    return " · ".join(parts)


def _summary_text(config: AnalyticsConfig, plan: AnalyticsPlan) -> str:
    n_ist, n_mx = len(config.ist_slots), len(config.mexico_slots)
    days = len(config.dates)
    d0, d1 = config.dates[0], config.dates[-1]
    span = f"{d0:%a} {d0.day} {d0:%b %Y} – {d1:%a} {d1.day} {d1:%b %Y}"
    n_oc = len(config.on_call_people)
    each = days // n_oc if n_oc else 0
    return (
        f"{n_ist + n_mx} slots over {days} days ({span}): {n_ist} in IST hours (S1–S3) and {n_mx} "
        f"Mexico-time slots (S4). Everyone not on call works {config.slots_per_person} slots unless noted; the "
        f"{'two ' if n_oc == 2 else ''}on-call people work {config.on_call_slots_each} slot each plus {each} "
        f"on-call days, so exactly one person is on call every day."
    )


def _write(path: str, config: AnalyticsConfig, plan: AnalyticsPlan, rows: list[RosterRow],
           snapshot: AnalyticsSnapshot, cached: dict, logo_path: Optional[str]) -> None:
    wb = sty.new_workbook(path)
    st = sty.Styles(wb)
    ctx = _Ctx(cached)
    ws_dv = wb.add_worksheet(SHEET_DAILY)
    ws_wr = wb.add_worksheet(SHEET_ROSTER)
    ws_bp = wb.add_worksheet(SHEET_PERSON)
    ws_sn = wb.add_worksheet(SHEET_SNAPSHOT)
    ws_dv.set_tab_color("#86BC25")
    ws_wr.set_tab_color("#A5D36B")
    ws_bp.set_tab_color("#282728")
    for ws in (ws_dv, ws_wr, ws_bp):
        ws.hide_gridlines(2)
        ws.set_landscape()
        ws.fit_to_pages(1, 0)
        ws.set_paper(9)

    dates = config.dates
    nd = len(dates)
    people = config.people
    np_ = len(people)
    logo = logo_path if logo_path else (config.logo or str(DEFAULT_LOGO))
    subtitle_span = f"{dates[0]:%a} {dates[0].day} {dates[0]:%b %Y} – {dates[-1]:%a} {dates[-1].day} {dates[-1]:%b %Y}".upper()
    title = config.title
    summary = _summary_text(config, plan)

    # ---- geometry --------------------------------------------------------------
    # Winter Roster
    R0 = 4  # first data row (0-based); header row is 3
    RN = R0 + len(rows) - 1
    e0, eN = R0 + 1, RN + 1  # Excel row numbers

    def wr(col: str) -> str:  # absolute range on the Winter Roster, qualified for other sheets
        return f"{_q(SHEET_ROSTER)}!${col}${e0}:${col}${eN}"

    def lc(col: str) -> str:  # same range, local to the Winter Roster
        return f"${col}${e0}:${col}${eN}"

    # By Person
    P0 = 6
    PN = P0 + np_ - 1
    p0, pN = P0 + 1, PN + 1
    c_date0 = 5
    c_slots, c_slot_t, c_oc, c_oc_t, c_hol, c_flags, c_check, c_notes = (c_date0 + nd + i for i in range(8))
    c_av0 = c_notes + 2
    names_rng = f"{_q(SHEET_PERSON)}!$C${p0}:$C${pN}"
    roles_rng = f"{_q(SHEET_PERSON)}!$D${p0}:$D${pN}"
    av_rng = f"{_q(SHEET_PERSON)}!${xl_col_to_name(c_av0)}${p0}:${xl_col_to_name(c_av0 + nd - 1)}${pN}"
    av_dates = f"{_q(SHEET_PERSON)}!${xl_col_to_name(c_av0)}$5:${xl_col_to_name(c_av0 + nd - 1)}$5"

    # ---- formats ---------------------------------------------------------------
    zebra = ["#FFFFFF", "#F8F9FB"]
    day_index = {d: i for i, d in enumerate(dates)}

    def cell_fmt(d: date, **kw):
        props = {"bg_color": zebra[day_index[d] % 2], "border": 1, "border_color": sty.COLORS["line"], **kw}
        return st.get("cell_center", **props)

    # =========================== Winter Roster ====================================
    ws = ws_wr
    last_col = 8
    sty.banner(ws, st, last_col, title, f"WINTER ROSTER  ·  {len(config.slots)} SLOTS  ·  {subtitle_span}",
               "This is the editable plan: pick a name from the dropdown in the Assigned column (slot rows and the "
               "On call row of each day). The Daily View and By Person tabs update automatically. One slot per "
               "person per day; the on-call person has no slot on their on-call days.", logo)
    for c, h in enumerate(ROSTER_HEADERS):
        ws.write(3, c, h, st.get("th"))
    ws.set_row(3, 28)
    ws.set_column(0, 0, 13)
    ws.set_column(1, 1, 18)
    ws.set_column(2, 2, 11)
    ws.set_column(3, 3, 10)
    ws.set_column(4, 4, 11)
    ws.set_column(5, 5, 13)
    ws.set_column(6, 6, 10)
    ws.set_column(7, 7, 24)
    ws.set_column(8, 8, 18)
    ws.set_column(9, 9, 22, None, {"hidden": True})
    n_names = f"MATCH($H{{e}},{names_rng},0)"
    for i, row in enumerate(rows):
        r = R0 + i
        e = r + 1
        oc_row = row.kind == "oc"
        base = {"bg_color": "#FFF4D1"} if oc_row else {}
        d = row.date
        ws.set_row(r, 18)
        ws.write_datetime(r, 0, _dt(d), cell_fmt(d, num_format="ddd d mmm", bold=True, **base))
        ws.write(r, 1, config.day_label(d), sty.day_chip_format(st, config.day_label(d)))
        ws.write(r, 2, "Yes" if config.is_holiday(d) else "–", cell_fmt(d, font_color=sty.COLORS["muted"], **base))
        ws.write(r, 3, row.label, cell_fmt(d, bold=True, **base))
        ws.write_datetime(r, 4, row.start, cell_fmt(d, num_format="hh:mm", **base))
        ws.write(r, 5, config.hours_text(row.code), cell_fmt(d, **base))
        ws.write(r, 6, row.zone, cell_fmt(d, **base))
        input_fmt = st.get("cell_center", bold=True, bg_color="#FFFFFF", border=1, border_color="#9AA1AC", font_size=10)
        if row.person:
            ws.write(r, 7, row.person, input_fmt)
        else:
            ws.write_blank(r, 7, None, input_fmt)
        m = n_names.format(e=e)
        role_ix = f"INDEX({roles_rng},{m})"
        avail = f"INDEX({av_rng},{m},MATCH($A{e},{av_dates},0))"
        if oc_row:
            wrong = f'IF({role_ix}<>"{ON_CALL_LABEL}","Not on-call person",'
            tail = f'IF(COUNTIFS({lc("A")},$A{e},{lc("D")},"<>{ON_CALL_LABEL}",{lc("H")},$H{e})>0,"Slot same day","OK")'
        else:
            wrong = f'IF(({role_ix}="{ROLE_TEXT[ROLE_MEXICO]}")<>($G{e}="{MEXICO}"),"Wrong zone",'
            tail = (f'IF(COUNTIFS({lc("A")},$A{e},{lc("D")},"{ON_CALL_LABEL}",{lc("H")},$H{e})>0,"On call same day",'
                    f'IF(COUNTIFS({lc("A")},$A{e},{lc("D")},"<>{ON_CALL_LABEL}",{lc("H")},$H{e})>1,"Double slot","OK"))')
        formula = (f'=IF($H{e}="","Open",IF(ISNA({m}),"Not on list",{wrong}'
                   f'IF({avail}="No","Not available",{tail}))))')
        ctx.formula(ws, r, 8, formula, st.get("cell_center", bold=True, border=1, border_color=sty.COLORS["line"],
                                              bg_color=zebra[day_index[d] % 2]))
        ctx.formula(ws, r, 9, f'=$H{e}&"|"&$A{e}&"|"&IF($D{e}="{ON_CALL_LABEL}","OC","S")')
    names_dv = f"={names_rng}"
    ws.data_validation(R0, 7, RN, 7, {
        "validate": "list", "source": names_dv, "ignore_blank": True,
        "error_title": "Not on the Analytics list", "error_message": "Pick a name from the dropdown.",
        "input_title": "Assigned", "input_message": "Choose a person from the list.",
    })
    fmt_green = wb.add_format({"font_color": sty.COLORS["green_text"], "bg_color": sty.COLORS["green_fill"]})
    fmt_amber = wb.add_format({"font_color": sty.COLORS["amber_text"], "bg_color": sty.COLORS["amber_fill"]})
    fmt_red = wb.add_format({"font_color": sty.COLORS["red_text"], "bg_color": sty.COLORS["red_fill"]})
    ws.conditional_format(R0, 8, RN, 8, {"type": "cell", "criteria": "==", "value": '"OK"', "format": fmt_green})
    ws.conditional_format(R0, 8, RN, 8, {"type": "cell", "criteria": "==", "value": '"Open"', "format": fmt_amber})
    ws.conditional_format(R0, 8, RN, 8, {"type": "formula", "criteria": f'=AND($I{e0}<>"OK",$I{e0}<>"Open")',
                                          "format": fmt_red})
    ws.conditional_format(R0, 7, RN, 7, {"type": "formula", "criteria": f'=$I{e0}="Open"', "format": fmt_amber})
    ws.conditional_format(R0, 7, RN, 7, {"type": "formula", "criteria": f'=AND($I{e0}<>"OK",$I{e0}<>"Open")',
                                          "format": fmt_red})
    ws.freeze_panes(4, 4)
    foot = RN + 2
    ws.merge_range(foot, 0, foot, last_col,
                   "Slot codes follow the Analytics winter template: S1 8AM–5PM, S2 11AM–8PM, S3 2PM–11PM "
                   "(IST) and S4 10PM–7AM IST = 10:30AM–7:30PM in Mexico. On call is 6–8 AM IST. "
                   + " ".join(plan.notes), st.get("footnote"))
    ws.set_row(foot, 60)

    # =========================== By Person ========================================
    ws = ws_bp
    last_bp = c_av0 + nd - 1
    sty.banner(ws, st, last_bp, title, f"BY PERSON  ·  {subtitle_span}",
               "Calculated from the Winter Roster tab – nothing to edit here. Each date cell shows the slot a "
               "person works that day (OC = on call). Targets come from the plan; a Review in Check means the "
               "Winter Roster no longer matches the plan or breaks a rule for that person.", logo, logo_cols=3)
    ws.set_column(0, 0, 5)
    ws.set_column(1, 1, 26)
    ws.set_column(2, 2, 14)
    ws.set_column(3, 3, 10)
    ws.set_column(4, 4, 11)
    ws.set_column(c_date0, c_date0 + nd - 1, 11.5)
    ws.set_column(c_slots, c_check, 9.5)
    ws.set_column(c_notes, c_notes, 34)
    ws.set_column(c_notes + 1, c_notes + 1, 3)
    ws.set_column(c_av0, c_av0 + nd - 1, 7.5)
    th = st.get("th")
    for c, label in enumerate(("#", "Team member", "Name", "Role", "Location")):
        ws.merge_range(3, c, 5, c, label, th)
    for i, d in enumerate(dates):
        hol = config.is_holiday(d)
        ws.write(3, c_date0 + i, config.day_label(d), sty.day_chip_format(st, config.day_label(d)))
        ws.write_datetime(4, c_date0 + i, _dt(d), st.get("date_weekend" if hol else "date"))
        ws.write_datetime(5, c_date0 + i, _dt(d), st.get("weekday_weekend" if hol else "weekday"))
        ws.write(3, c_av0 + i, config.day_label(d), sty.day_chip_format(st, config.day_label(d)))
        ws.write_datetime(4, c_av0 + i, _dt(d), st.get("date_weekend" if hol else "date"))
        ws.write_datetime(5, c_av0 + i, _dt(d), st.get("weekday_weekend" if hol else "weekday"))
    for c, label in ((c_slots, "Slots"), (c_slot_t, "Target"), (c_oc, "On-call days"), (c_oc_t, "Target"),
                     (c_hol, "Holiday / weekend days"), (c_flags, "Rows flagged"), (c_check, "Check"),
                     (c_notes, "Notes")):
        ws.merge_range(3, c, 5, c, label, th)
    ws.set_row(3, 26)
    ws.set_row(5, 14)
    first_av = xl_col_to_name(c_av0)
    sdate0 = xl_col_to_name(c_date0)
    sdate1 = xl_col_to_name(c_date0 + nd - 1)
    K = wr("J")
    grid_codes: list[str] = []
    for i, p in enumerate(people):
        r = P0 + i
        e = r + 1
        ws.set_row(r, 20)
        ws.write(r, 0, i + 1, st.get("index"))
        ws.write(r, 1, p.name, st.get("name"))
        ws.write(r, 2, p.display, st.get("team_name"))
        ws.write(r, 3, ROLE_TEXT[p.role], st.get("cell_center"))
        ws.write(r, 4, p.location, st.get("cell_center"))
        for j, d in enumerate(dates):
            col = xl_col_to_name(c_date0 + j)
            f = (f'=TRIM(IFERROR(INDEX({wr("D")},MATCH($C{e}&"|"&{col}$5&"|S",{K},0)),"")'
                 f'&IF(ISNUMBER(MATCH($C{e}&"|"&{col}$5&"|OC",{K},0))," OC",""))')
            ctx.formula(ws, r, c_date0 + j, f, st.get("grid"))
            ws.write(r, c_av0 + j, "Yes" if p.is_available(d) else "No", st.get("cell_center"))
        ctx.formula(ws, r, c_slots, f'=COUNTIFS({wr("H")},$C{e},{wr("D")},"<>{ON_CALL_LABEL}")', st.get("count"))
        ws.write(r, c_slot_t, plan.counts.get(p.display, 0), st.get("count_muted"))
        ctx.formula(ws, r, c_oc, f'=COUNTIFS({wr("H")},$C{e},{wr("D")},"{ON_CALL_LABEL}")', st.get("count"))
        ws.write(r, c_oc_t, plan.on_call_counts.get(p.display, 0), st.get("count_muted"))
        ctx.formula(ws, r, c_hol, f'=COUNTIFS({wr("H")},$C{e},{wr("C")},"Yes")', st.get("count"))
        ctx.formula(ws, r, c_flags, f'=COUNTIFS({wr("H")},$C{e})-COUNTIFS({wr("H")},$C{e},{wr("I")},"OK")',
                    st.get("count"))
        s_, st_, o_, ot_, f_ = (xl_col_to_name(x) for x in (c_slots, c_slot_t, c_oc, c_oc_t, c_flags))
        ctx.formula(ws, r, c_check, f'=IF(AND({s_}{e}={st_}{e},{o_}{e}={ot_}{e},{f_}{e}=0),"OK","Review")',
                    st.get("cell_center", bold=True))
        ws.write(r, c_notes, _person_note(config, plan, p), st.get("cell"))
    # chips for slot codes and on call, red for unavailable
    grid = (P0, c_date0, PN, c_date0 + nd - 1)
    chip = {"S1": "#D6ECC4", "S2": "#FFEAA8", "S3": "#CDE2F6", "S4": "#B4C1EE"}
    tl = f"{xl_col_to_name(c_date0)}{p0}"
    ws.conditional_format(*grid, {"type": "formula", "criteria": f'=ISNUMBER(SEARCH("OC",{tl}))',
                                  "format": wb.add_format({"bg_color": "#FFD9A0", "bold": True})})
    for code, fill in chip.items():
        ws.conditional_format(*grid, {"type": "formula", "criteria": f'=LEFT({tl},2)="{code}"',
                                      "format": wb.add_format({"bg_color": fill})})
    ws.conditional_format(P0, c_av0, PN, c_av0 + nd - 1, {"type": "cell", "criteria": "==", "value": '"No"',
                                                         "format": fmt_red})
    ws.conditional_format(P0, c_check, PN, c_check, {"type": "cell", "criteria": "==", "value": '"OK"',
                                                    "format": fmt_green})
    ws.conditional_format(P0, c_check, PN, c_check, {"type": "cell", "criteria": "==", "value": '"Review"',
                                                    "format": fmt_red})

    # rule check table
    rr = PN + 2
    ws.merge_range(rr, 0, rr, 7, "RULE CHECK", st.get("section"))
    hdr = rr + 1
    ws.merge_range(hdr, 1, hdr, 4, "Rule", st.get("th_left"))
    ws.write(hdr, 5, "Found", th)
    ws.write(hdr, 6, "Expected", th)
    ws.write(hdr, 7, "Result", th)
    ws.write(hdr, 0, "", th)
    date_hdr = [f"${xl_col_to_name(c_date0 + j)}$5" for j in range(nd)]
    one_oc = "+".join(
        f'IF(COUNTIFS({wr("D")},"{ON_CALL_LABEL}",{wr("A")},{dh},{wr("H")},"?*")=1,1,0)' for dh in date_hdr)
    n_slots_total = len(config.slots)
    rules = [
        (f"All {n_slots_total} slots have a person",
         f'=COUNTIFS({wr("D")},"<>{ON_CALL_LABEL}",{wr("H")},"?*")', f'=COUNTIF({wr("D")},"<>{ON_CALL_LABEL}")'),
        ("Slot and on-call counts per person match the plan",
         f'=COUNTIF(${xl_col_to_name(c_check)}${p0}:${xl_col_to_name(c_check)}${pN},"OK")', f"=COUNTA($C${p0}:$C${pN})"),
        ("No double slots (two slots on the same day)", f'=COUNTIF({wr("I")},"Double slot")', "=0"),
        ("No slot on a person's own on-call day",
         f'=COUNTIF({wr("I")},"On call same day")+COUNTIF({wr("I")},"Slot same day")', "=0"),
        ("Exactly one person on call every day", "=" + one_oc, f"=COUNT({date_hdr[0]}:{date_hdr[-1]})"),
        ("Availability respected", f'=COUNTIF({wr("I")},"Not available")', "=0"),
        ("Every name is on the Analytics people list", f'=COUNTIF({wr("I")},"Not on list")', "=0"),
        ("On call only for the on-call people, Mexico slots only for the Mexico person",
         f'=COUNTIF({wr("I")},"Not on-call person")+COUNTIF({wr("I")},"Wrong zone")', "=0"),
    ]
    first_rule = hdr + 1
    for k, (label, found, expected) in enumerate(rules):
        r = first_rule + k
        e = r + 1
        ws.merge_range(r, 1, r, 4, label, st.get("cell"))
        ws.write(r, 0, k + 1, st.get("index"))
        ctx.formula(ws, r, 5, found, st.get("count"))
        ctx.formula(ws, r, 6, expected, st.get("count_muted"))
        ctx.formula(ws, r, 7, f'=IF(F{e}=G{e},"PASS","FAIL")', st.get("cell_center", bold=True))
        ws.set_row(r, 20)
    last_rule = first_rule + len(rules) - 1
    ws.conditional_format(first_rule, 7, last_rule, 7, {"type": "cell", "criteria": "==", "value": '"PASS"',
                                                       "format": fmt_green})
    ws.conditional_format(first_rule, 7, last_rule, 7, {"type": "cell", "criteria": "==", "value": '"FAIL"',
                                                       "format": fmt_red})
    res_rng_local = f"$H${first_rule + 1}:$H${last_rule + 1}"
    res_rng = f"{_q(SHEET_PERSON)}!{res_rng_local}"
    pbn = last_rule + 2
    ws.merge_range(pbn, 0, pbn, c_notes, " ".join(plan.notes) if plan.notes else "No exceptions to the standard slot counts.",
                   st.get("footnote"))
    ws.set_row(pbn, 44)
    ws.freeze_panes(P0, c_date0)

    # =========================== Daily View ========================================
    ws = ws_dv
    last_dv = 7
    sty.banner(ws, st, last_dv, title, f"DAY-BY-DAY ROSTER  ·  {subtitle_span}", summary, logo)
    ws.set_row(1, 42)
    ws.set_column(0, 0, 17)
    ws.set_column(1, 1, 13)
    ws.set_column(2, 4, 21)
    ws.set_column(5, 5, 22)
    ws.set_column(6, 6, 17)
    ws.set_column(7, 7, 12)
    n_slot_rows = f'COUNTIF({wr("D")},"<>{ON_CALL_LABEL}")'
    tiles = [
        (0, 1, "SLOTS FILLED", f'=COUNTIFS({wr("D")},"<>{ON_CALL_LABEL}",{wr("H")},"?*")&" / "&{n_slot_rows}'),
        (2, 2, "IST SLOTS", f'=COUNTIFS({wr("G")},"{IST}",{wr("D")},"<>{ON_CALL_LABEL}",{wr("H")},"?*")&" / "'
                            f'&COUNTIFS({wr("G")},"{IST}",{wr("D")},"<>{ON_CALL_LABEL}")'),
        (3, 3, "MEXICO SLOTS", f'=COUNTIFS({wr("G")},"{MEXICO}",{wr("D")},"<>{ON_CALL_LABEL}",{wr("H")},"?*")&" / "'
                              f'&COUNTIFS({wr("G")},"{MEXICO}",{wr("D")},"<>{ON_CALL_LABEL}")'),
        (4, 5, "ON-CALL DAYS COVERED", f'=COUNTIFS({wr("D")},"{ON_CALL_LABEL}",{wr("H")},"?*")&" / "'
                                       f'&COUNTIF({wr("D")},"{ON_CALL_LABEL}")'),
        (6, 7, "RULE CHECKS PASSING", f'=COUNTIF({res_rng},"PASS")&" / "&ROWS({res_rng})'),
    ]
    ws.set_row(3, 22)
    ws.set_row(4, 36)
    for c0, c1, label, f in tiles:
        sty.kpi_tile(ws, st, 3, c0, c1, label, f, "neutral", cached=ctx.value(ws, 4, c0))
    ws.set_row(5, 8)
    ws.merge_range(6, 0, 6, last_dv, "WHO IS WORKING EACH DAY", st.get("section"))
    head = 7
    th2 = st.get("th")
    headers = [
        "Day type", "Date",
        f"S1 · {config.hours_text('S1')}\nstarts {config.shift_hours['S1'][0]} IST",
        f"S2 · {config.hours_text('S2')}\nstarts {config.shift_hours['S2'][0]} IST",
        f"S3 · {config.hours_text('S3')}\nstarts {config.shift_hours['S3'][0]} IST",
        f"S4 · MEXICO\n{config.hours_text('S4')} IST (starts {config.shift_hours['S4'][0]})",
        f"On call\n{config.hours_text('OC')} IST", "Slots filled",
    ]
    for c, h in enumerate(headers):
        ws.write(head, c, h, th2)
    ws.set_row(head, 36)
    code_cols = {"S1": 2, "S2": 3, "S3": 4, "S4": 5}
    row_no = {}  # roster row -> Excel row number
    for i, row in enumerate(rows):
        row_no[i] = R0 + i + 1
    daycell = st.get("names", align="center", indent=0)
    for k, d in enumerate(dates):
        r = head + 1 + k
        idx = [i for i, row in enumerate(rows) if row.date == d]
        ws.write(r, 0, config.day_label(d), sty.day_chip_format(st, config.day_label(d)))
        ws.write_datetime(r, 1, _dt(d), st.get("roster_date"))
        max_lines = 1
        for code, col in code_cols.items():
            ridx = [i for i in idx if rows[i].kind == "slot" and rows[i].code == code]
            max_lines = max(max_lines, len(ridx))
            if not ridx:
                ws.write(r, col, "—", st.get("cell_muted", border=1, border_color=sty.COLORS["line"]))
                continue
            parts = [f'IF({_q(SHEET_ROSTER)}!$H${row_no[i]}<>"",CHAR(10)&{_q(SHEET_ROSTER)}!$H${row_no[i]},"")'
                     for i in ridx]
            ctx.formula(ws, r, col, f'=MID({"&".join(parts)},2,200)', daycell)
        oc_i = next(i for i in idx if rows[i].kind == "oc")
        ctx.formula(ws, r, 6, f'=IF({_q(SHEET_ROSTER)}!$H${row_no[oc_i]}="","",{_q(SHEET_ROSTER)}!$H${row_no[oc_i]})',
                    st.get("names", align="center", indent=0, bold=True))
        ctx.formula(ws, r, 7, f'=COUNTIFS({wr("A")},$B{r + 1},{wr("D")},"<>{ON_CALL_LABEL}",{wr("H")},"?*")&" / "'
                              f'&COUNTIFS({wr("A")},$B{r + 1},{wr("D")},"<>{ON_CALL_LABEL}")',
                    st.get("cell_center", bold=True))
        ws.set_row(r, max(30, 15 * max_lines + 6))
    dv_last = head + nd
    ws.conditional_format(head + 1, 7, dv_last, 7, {
        "type": "formula", "criteria": f'=LEFT($H{head + 2},FIND(" ",$H{head + 2})-1)=MID($H{head + 2},FIND("/",$H{head + 2})+2,9)',
        "format": fmt_green})
    ws.conditional_format(head + 1, 7, dv_last, 7, {
        "type": "formula", "criteria": f'=LEFT($H{head + 2},FIND(" ",$H{head + 2})-1)<>MID($H{head + 2},FIND("/",$H{head + 2})+2,9)',
        "format": fmt_red})
    fn = dv_last + 2
    ws.merge_range(fn, 0, fn, last_dv,
                   ((" ".join(plan.notes) + "  ·  ") if plan.notes else "")
                   + "S4 is the Mexico-time shift, 10PM–7AM IST = 10:30AM–7:30PM in Mexico.  ·  "
                     "This view is calculated from the Winter Roster tab – edit names there.",
                   st.get("footnote"))
    ws.set_row(fn, 52)
    ws.freeze_panes(head + 1, 0)

    # =========================== _snapshot =========================================
    ws = ws_sn
    ws.write(0, 0, SNAPSHOT_MARK)
    ws.write(0, 1, SNAPSHOT_SCHEMA)
    r = 1
    for k in sorted(snapshot.meta):
        ws.write(r, 0, f"meta.{k}")
        ws.write(r, 1, json.dumps(snapshot.meta[k], sort_keys=True, ensure_ascii=False))
        r += 1
    for c, h in enumerate(SNAPSHOT_HEADER):
        ws.write(r, c, h)
    r += 1
    for rec in snapshot.rows:
        for c, v in enumerate(rec):
            ws.write(r, c, v)
        r += 1
    ws.very_hidden()
    ws_dv.activate()
    ws_dv.set_first_sheet()
    wb.close()


def build_analytics_workbook(config: AnalyticsConfig, plan: AnalyticsPlan, path: PathLike, *,
                             logo_path: Optional[PathLike] = None,
                             write_sidecar: bool = True) -> BuildResult:
    """Write the analytics winter workbook (and its sidecar). Raises AnalyticsWorkbookError.

    The formulas are evaluated and verified (zero errors, cached == recalculated) before the
    file is put in place; on any failure nothing is left at `path`.
    """
    if not plan.ok:
        raise AnalyticsWorkbookError("the plan is infeasible: " + "; ".join(plan.problems or ["no solution"]))
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    rows = roster_rows(config, plan)
    snap = make_snapshot(config, plan, rows)
    logo = os.fspath(logo_path) if logo_path else None
    t1 = out.with_name(out.stem + ".pass1.tmp.xlsx")
    t2 = out.with_name(out.stem + ".pass2.tmp.xlsx")
    try:
        _write(os.fspath(t1), config, plan, rows, snap, {}, logo)
        values = EvalWorkbook(t1).evaluate_all()
        _write(os.fspath(t2), config, plan, rows, snap, values, logo)
        check = check_workbook_formulas(t2)
        if not check.ok:
            raise AnalyticsWorkbookError("formula check failed: " + "; ".join((check.errors + check.mismatches)[:5]))
        os.replace(t2, out)
    finally:
        for t in (t1, t2):
            try:
                t.unlink()
            except FileNotFoundError:
                pass
    sidecar = ""
    if write_sidecar:
        sidecar = sidecar_path_for(out)
        with open(sidecar, "w", encoding="utf-8", newline="\n") as f:
            f.write(snap.to_json())
    final = check_workbook_formulas(out)
    return BuildResult(str(out), sidecar, plan.plan_hash, final, list(plan.notes))
