"""
Writer for the main winter workbook: three formula-linked tabs plus a hidden snapshot.

    Winter Coverage      KPI tiles; team x day heat map of headcount against each team's minimum; Min/day, people,
                         days-minimum-met, person-days and a plain-English status per team.
    Winter Daily Roster  one block per date: Morning / Evening / Night-US rows, one column per team, names only,
                         and a "Total on shift" row (mirrors last year's "December 2025 disconnect" sheet).
    Winter Plan          the EDITABLE by-person grid (people grouped by team, with team / location / usual shift /
                         lane, one column per date) with a shift-code dropdown, Days worked and holiday/weekend
                         day counts. Edits flow into the other two tabs through formulas.
    _snapshot            veryHidden: every plan-grid cell as written + meta (plan hash, window, config hash),
                         mirrored in `<file>.snapshot.json` (see winter_snapshot).

Formula strategy: only widely compatible functions (COUNTIF, COUNTIFS, SUMIF, SUMPRODUCT, IF, AND, MATCH, ISNUMBER, MID,
CHAR, SUM, COUNT, MAX). Names on the daily roster are built with per-person IF terms concatenated and trimmed with MID
(no TEXTJOIN / dynamic arrays), referencing the name cells and the Winter Plan's shift-key table, so renames and code edits
flow through. Every formula is written WITH its cached value (computed here from the plan) and the workbook is flagged to
recalculate fully on open. A team with so many people that its per-lane formula would pass 8,000 characters raises
ValueError (Excel's limit is 8,192).

API
    write_winter_workbook(path, plan, cfg, *, logo_path=DEFAULT_LOGO, sidecar=True) -> WorkbookResult
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Optional, Sequence, Union

from xlsxwriter.utility import xl_col_to_name, xl_rowcol_to_cell

from . import xlsx_style as xs
from .winter_config import WinterConfig
from .winter_plan import WinterPlan
from .winter_snapshot import (SNAPSHOT_SHEET, Snapshot, SnapshotCell, sidecar_path_for, snapshot_rows)
from .winter_types import DISPLAY, LANE_LABEL, LANES, PlanPerson, display_code, lane_hours, lane_name

from roster_lib import codes

SHEET_COVERAGE = "Winter Coverage"
SHEET_DAILY = "Winter Daily Roster"
SHEET_PLAN = "Winter Plan"
DEFAULT_LOGO = os.path.join(os.path.dirname(__file__), "..", "assets", "takeda-logo.png")
LIBRARY_ID = "winter_lib/main-plan/1"
MAX_FORMULA_CHARS = 8000

# Winter Plan column positions (0-based)
C_INDEX, C_NAME, C_LOC, C_TEAM, C_USUAL, C_LANE, C_DAY0 = 0, 1, 2, 3, 4, 5, 6
PLAN_FIRST_ROW = 7  # 1-based first group-header row


def _q(sheet: str) -> str:
    return "'" + sheet + "'!"


PQ = _q(SHEET_PLAN)


@dataclass
class Group:
    team: str
    label: str
    min_per_day: int
    best_effort: bool
    header_row: int  # 1-based
    first: int  # 1-based first person row (== header_row + 1)
    last: int  # 1-based last person row (== header_row when empty)
    people: list[PlanPerson]
    rows: dict[str, int] = field(default_factory=dict)  # person name -> 1-based row


@dataclass
class PlanLayout:
    groups: list[Group]
    n_days: int
    dw_col: int  # "Days worked" column (0-based)
    fair_col: int  # "Holiday / weekend days" column
    last_row: int  # last row used by the people block (1-based)
    total_row: int  # 1-based
    key_col: int  # shift-key table first column (0-based)
    key_first_row: int  # 1-based
    key_order: list[str]  # display codes in key-table order
    lane_ranges: dict[str, tuple[int, int]]  # lane -> (first, last) 1-based rows of its codes in the key table

    @property
    def day_cols(self) -> list[int]:
        return [C_DAY0 + i for i in range(self.n_days)]

    @property
    def first_row(self) -> int:
        return PLAN_FIRST_ROW

    def plan_col_letter(self, k: int) -> str:
        return xl_col_to_name(C_DAY0 + k)

    def lane_range_ref(self, lane: str) -> str:
        r1, r2 = self.lane_ranges[lane]
        c = xl_col_to_name(self.key_col)
        return f"{PQ}${c}${r1}:${c}${r2}"

    def block_range(self, col0: int, absolute_col: bool = False) -> str:
        c = xl_col_to_name(col0)
        c = f"${c}" if absolute_col else c
        return f"{PQ}{c}${self.first_row}:{c}${self.last_row}"

    def group_of(self, team: str) -> Group:
        return next(g for g in self.groups if g.team == team)


@dataclass
class WorkbookResult:
    path: str
    sidecar_path: Optional[str]
    snapshot: Snapshot
    plan_hash: str
    config_hash: str
    layout: PlanLayout
    sha256: str


def key_table_order() -> tuple[list[str], dict[str, str]]:
    """Display codes sorted by lane (Morning, Evening, Night/US) then dropdown order, and code -> lane."""
    lane_of = {display_code(c): lane_name(c) for c in DISPLAY}
    order = []
    for lane in (LANE_LABEL[l] for l in LANES):
        order += [display_code(c) for c in DISPLAY if lane_name(c) == lane]
    return order, lane_of


def build_layout(plan: WinterPlan, cfg: WinterConfig) -> PlanLayout:
    row = PLAN_FIRST_ROW
    groups: list[Group] = []
    for t in cfg.teams:
        people = [p for p in plan.people if p.team == t.name]
        g = Group(t.name, t.label, t.min_per_day, t.best_effort, row, row + 1, row + len(people) if people else row,
                  people)
        for i, p in enumerate(people):
            g.rows[p.name] = row + 1 + i
        groups.append(g)
        row = g.last + 1
    last = row - 1
    n = len(plan.window)
    dw = C_DAY0 + n
    order, lane_of = key_table_order()
    ranges: dict[str, tuple[int, int]] = {}
    first_key = PLAN_FIRST_ROW
    for i, code in enumerate(order):
        r = first_key + i
        lane = lane_of[code]
        a, b = ranges.get(lane, (r, r))
        ranges[lane] = (min(a, r), max(b, r))
    return PlanLayout(groups, n, dw, dw + 1, last, last + 1, dw + 3, first_key, order, ranges)


# ---------------------------------------------------------------------------
# helpers


def _dt(d: date) -> datetime:
    return datetime(d.year, d.month, d.day)


def _runs(labels: Sequence[str]) -> list[tuple[int, int, str]]:
    """Consecutive equal labels -> (first index, last index, label)."""
    out: list[tuple[int, int, str]] = []
    for i, lab in enumerate(labels):
        if out and out[-1][2] == lab:
            out[-1] = (out[-1][0], i, lab)
        else:
            out.append((i, i, lab))
    return out


def _title_date(d: date) -> str:
    return f"{d:%a} {d.day} {d:%b %Y}".upper()


def _subtitle(cfg: WinterConfig, what: str) -> str:
    return f"{what}  ·  {_title_date(cfg.start)} – {_title_date(cfg.end)}"


def _fair_cols(plan: WinterPlan, cfg: WinterConfig) -> list[int]:
    fair = set(cfg.fair_days)
    return [i for i, d in enumerate(plan.window) if d in fair]


def _day_header(ws, st: xs.Styles, row0: int, first_col: int, plan: WinterPlan, cfg: WinterConfig,
                chip_row: int, date_row: int, weekday_row: Optional[int]) -> None:
    labels = [cfg.day_label(d) for d in plan.window]
    for a, b, lab in _runs(labels):
        fmt = xs.day_chip_format(st, lab)
        if a == b:
            ws.write(chip_row, first_col + a, lab, fmt)
        else:
            ws.merge_range(chip_row, first_col + a, chip_row, first_col + b, lab, fmt)
    for i, d in enumerate(plan.window):
        weekend = d.weekday() >= 5
        ws.write_datetime(date_row, first_col + i, _dt(d), st.get("date_weekend" if weekend else "date"))
        if weekday_row is not None:
            ws.write_datetime(weekday_row, first_col + i, _dt(d), st.get("weekday_weekend" if weekend else "weekday"))


def _page(ws, landscape: bool = True) -> None:
    if landscape:
        ws.set_landscape()
    ws.set_paper(9)
    ws.fit_to_pages(1, 0)
    ws.hide_gridlines(2)


# ---------------------------------------------------------------------------
# Winter Plan


def _write_plan_sheet(ws, st: xs.Styles, plan: WinterPlan, cfg: WinterConfig, lay: PlanLayout, logo) -> None:
    n = lay.n_days
    last_col = lay.fair_col
    nxt = xs.banner(
        ws, st, last_col, "Winter Holiday Coverage", _subtitle(cfg, "BY PERSON"),
        f"Everyone works at least {cfg.min_days} days, up to {cfg.max_days} where a team needs the slots  ·  "
        + "  ·  ".join(f"{t.label} needs {t.min_per_day}" for t in cfg.teams if not t.best_effort and t.min_per_day)
        + "  ·  pick a cell's dropdown to change a shift: team counts here and the other tabs update automatically.",
        logo)
    ws.set_row(3, 24)
    ws.set_row(4, 20)
    ws.set_row(5, 16)
    # header block
    ws.merge_range(3, C_INDEX, 5, C_NAME, "Team member", st.get("th_left"))
    ws.merge_range(3, C_LOC, 5, C_LOC, "Loc", st.get("th"))
    ws.merge_range(3, C_TEAM, 5, C_TEAM, "Team", st.get("th"))
    ws.merge_range(3, C_USUAL, 5, C_USUAL, "Usual shift", st.get("th"))
    ws.merge_range(3, C_LANE, 5, C_LANE, "Lane", st.get("th"))
    _day_header(ws, st, 0, C_DAY0, plan, cfg, 3, 4, 5)
    ws.merge_range(3, lay.dw_col, 5, lay.dw_col, "Days worked", st.get("th"))
    ws.merge_range(3, lay.fair_col, 5, lay.fair_col, "Holiday / weekend days", st.get("th"))

    widths = xs.STD_WIDTHS
    ws.set_column(C_INDEX, C_INDEX, widths["index"])
    ws.set_column(C_NAME, C_NAME, widths["name"])
    ws.set_column(C_LOC, C_LOC, widths["location"])
    ws.set_column(C_TEAM, C_TEAM, widths["team"])
    ws.set_column(C_USUAL, C_USUAL, widths["shift"])
    ws.set_column(C_LANE, C_LANE, widths["lane"])
    ws.set_column(C_DAY0, C_DAY0 + n - 1, widths["day"])
    ws.set_column(lay.dw_col, lay.dw_col, widths["count"])
    ws.set_column(lay.fair_col, lay.fair_col, widths["wide_count"])
    ws.set_column(lay.fair_col + 1, lay.fair_col + 1, 3)
    ws.set_column(lay.key_col, lay.key_col, 14)
    ws.set_column(lay.key_col + 1, lay.key_col + 2, 16)

    fair_cols = _fair_cols(plan, cfg)
    counts_by_person = {p.name: [d for d in plan.window if (p.name, d) in plan.cells] for p in plan.people}
    idx = 0
    dc0, dcN = xl_col_to_name(C_DAY0), xl_col_to_name(C_DAY0 + n - 1)
    for g in lay.groups:
        h0 = g.header_row - 1
        ws.set_row(h0, 22)
        ws.merge_range(h0, C_INDEX, h0, C_NAME, g.label, st.get("band"))
        ws.write_number(h0, C_LOC, g.min_per_day, st.get("band_center", num_format='[=0]"BE";0'))
        npeople = len(g.people)
        if g.people:
            ws.write_formula(h0, C_TEAM, f'=COUNTIF({xl_col_to_name(C_TEAM)}{g.first}:{xl_col_to_name(C_TEAM)}{g.last},"?*")&" people"',
                             st.get("band_center"), f"{npeople} people")
        else:
            ws.write_string(h0, C_TEAM, "0 people", st.get("band_center"))
        ws.write_blank(h0, C_USUAL, None, st.get("section_fill"))
        ws.write_blank(h0, C_LANE, None, st.get("section_fill"))
        for k, d in enumerate(plan.window):
            col = xl_col_to_name(C_DAY0 + k)
            if g.people:
                f = f'=COUNTIF({col}{g.first}:{col}{g.last},"?*")'
            else:
                f = "=0"
            ws.write_formula(h0, C_DAY0 + k, f, st.get("band_count"), plan.headcount(g.team, d))
        ws.write_blank(h0, lay.dw_col, None, st.get("section_fill"))
        ws.write_blank(h0, lay.fair_col, None, st.get("section_fill"))
        if g.people:
            xs.heatmap_cf(ws, st, h0, C_DAY0, h0, C_DAY0 + n - 1, C_LOC)
        for j, p in enumerate(g.people):
            r = g.first + j  # 1-based
            r0 = r - 1
            idx += 1
            zebra = "#FFFFFF" if idx % 2 else xs.COLORS["zebra"]
            ws.set_row(r0, 21)
            ws.write_number(r0, C_INDEX, idx, st.get("index", bg_color=zebra))
            ws.write_string(r0, C_NAME, p.name, st.get("name", bg_color=zebra))
            ws.write_string(r0, C_LOC, p.location, st.get("cell_muted", bg_color=zebra))
            ws.write_string(r0, C_TEAM, g.label, st.get("cell", bg_color=zebra))
            ws.write_string(r0, C_USUAL, display_code(p.usual_shift), st.get("cell_center", bg_color=zebra))
            ws.write_string(r0, C_LANE, p.lane or "", st.get("cell_muted", bg_color=zebra))
            for k, d in enumerate(plan.window):
                code = plan.code(p.name, d)
                fmt = st.get("grid", bg_color=zebra)
                if code:
                    ws.write_string(r0, C_DAY0 + k, display_code(code), fmt)
                else:
                    ws.write_blank(r0, C_DAY0 + k, None, fmt)
            ws.write_formula(r0, lay.dw_col, f'=COUNTIF({dc0}{r}:{dcN}{r},"?*")', st.get("count"),
                             len(counts_by_person[p.name]))
            if fair_cols:
                f = "=" + "+".join(f'COUNTIF({xl_col_to_name(C_DAY0 + k)}{r},"?*")' for k in fair_cols)
            else:
                f = "=0"
            nfair = sum(1 for d in counts_by_person[p.name] if d in set(cfg.fair_days))
            ws.write_formula(r0, lay.fair_col, f, st.get("count_muted"), nfair)
        if g.people:
            rng = (g.first - 1, C_DAY0, g.last - 1, C_DAY0 + n - 1)
            ws.data_validation(*rng, {
                "validate": "list",
                "source": f"=${xl_col_to_name(lay.key_col)}${lay.key_first_row}:${xl_col_to_name(lay.key_col)}"
                          f"${lay.key_first_row + len(lay.key_order) - 1}",
                "ignore_blank": True,
                "error_type": "stop",
                "error_title": "Pick a shift code",
                "error_message": "Choose one of the shift codes from the list, or leave the cell empty for a day off.",
                "input_title": "Shift",
                "input_message": "Pick a shift to work this day, or clear the cell for a day off.",
            })
            xs.shift_code_cf(ws, st, *rng, display_codes=lay.key_order)
            tl = xl_rowcol_to_cell(g.first - 1, C_DAY0)
            usual = xl_rowcol_to_cell(g.first - 1, C_USUAL, col_abs=True)
            ws.conditional_format(*rng, {
                "type": "formula", "criteria": f'=AND({tl}<>"",{tl}<>{usual})',
                "format": st.wb.add_format({"bold": True, "border": 2, "border_color": "#E08A00"}),
            })
            dw_rng = (g.first - 1, lay.dw_col, g.last - 1, lay.dw_col)
            dwc = xl_rowcol_to_cell(g.first - 1, lay.dw_col)
            ws.conditional_format(*dw_rng, {"type": "formula", "criteria": f"={dwc}={cfg.min_days}",
                                            "format": st.wb.add_format(st.props("heat_green"))})
            ws.conditional_format(*dw_rng, {"type": "formula",
                                            "criteria": f"=AND({dwc}>{cfg.min_days},{dwc}<={cfg.max_days})",
                                            "format": st.wb.add_format(st.props("heat_amber"))})
            ws.conditional_format(*dw_rng, {"type": "formula",
                                            "criteria": f"=OR({dwc}<{cfg.min_days},{dwc}>{cfg.max_days})",
                                            "format": st.wb.add_format(st.props("heat_red"))})
    # total row
    t0 = lay.total_row - 1
    ws.set_row(t0, 22)
    ws.merge_range(t0, C_INDEX, t0, C_NAME, "Total on shift", st.get("total"))
    for c in (C_LOC, C_TEAM, C_USUAL, C_LANE):
        ws.write_blank(t0, c, None, st.get("total"))
    for k, d in enumerate(plan.window):
        col = xl_col_to_name(C_DAY0 + k)
        f = "=" + "+".join(f"{col}{g.header_row}" for g in lay.groups)
        ws.write_formula(t0, C_DAY0 + k, f, st.get("total_center"), sum(plan.headcount(g.team, d) for g in lay.groups))
    dwl = xl_col_to_name(lay.dw_col)
    fl = xl_col_to_name(lay.fair_col)
    ws.write_formula(t0, lay.dw_col, f"=SUM({dwl}{lay.first_row}:{dwl}{lay.last_row})", st.get("total_center"),
                     len(plan.cells))
    nfair_total = sum(1 for (nm, d) in plan.cells if d in set(cfg.fair_days))
    ws.write_formula(t0, lay.fair_col, f"=SUM({fl}{lay.first_row}:{fl}{lay.last_row})", st.get("total_center"),
                     nfair_total)
    # footnote
    fair_text = ", ".join(f"{d:%b} {d.day}" for d in cfg.fair_days)
    defaults = [p.name for p in plan.people if p.shift_source == "default"]
    note = ("Not scheduled: " + ", ".join(cfg.excluded_team_patterns) + " (Analytics plans its shifts separately). "
            "Each person works their usual shift (the most common shift in the months before the window); a cell that "
            "differs from the usual shift gets an orange border. "
            + (f"Shifts for {', '.join(defaults)} are defaults: change them with the dropdown. " if defaults else "")
            + f"Holiday / weekend days = {fair_text}.  ·  Best-effort teams (BE) have no daily minimum: "
              f"their people work at most {cfg.best_effort_max_days} days.")
    ws.set_row(lay.total_row + 1, 40)
    ws.merge_range(lay.total_row + 1, 0, lay.total_row + 1, lay.fair_col, note, st.get("footnote"))
    # shift key table
    kc = lay.key_col
    ws.merge_range(3, kc, 4, kc + 2, "Shift key", st.get("th"))
    ws.write(5, kc, "Code", st.get("th_sub"))
    ws.write(5, kc + 1, "Hours (IST)", st.get("th_sub"))
    ws.write(5, kc + 2, "Lane", st.get("th_sub"))
    order, lane_of = key_table_order()
    canon_of = {display_code(c): c for c in DISPLAY}
    for i, code in enumerate(order):
        r0 = lay.key_first_row - 1 + i
        lane = lane_of[code]
        chip = {"Morning": "chip_morning", "Evening": "chip_evening", "Night/US": "chip_night"}[lane]
        ws.write_string(r0, kc, code, st.get("cell_center"))
        ws.write_string(r0, kc + 1, lane_hours(canon_of[code]), st.get("cell_muted"))
        ws.write_string(r0, kc + 2, lane, st.get(chip))
    ws.freeze_panes(6, C_LOC)
    ws.set_zoom(90)
    _page(ws)


# ---------------------------------------------------------------------------
# Winter Coverage


def _tile_spans(first: int, n_cols: int, tiles: int) -> list[tuple[int, int]]:
    base, extra = divmod(n_cols, tiles)
    spans, c = [], first
    for i in range(tiles):
        w = base + (1 if i < extra else 0)
        spans.append((c, c + max(w, 1) - 1))
        c += max(w, 1)
    return spans


def _write_coverage_sheet(ws, st: xs.Styles, plan: WinterPlan, cfg: WinterConfig, lay: PlanLayout, logo) -> None:
    n = lay.n_days
    T = len(lay.groups)
    C_TEAMC, C_PEOPLE, C_MIN, C_D0 = 1, 2, 3, 4
    dm, pdc, stc = C_D0 + n, C_D0 + n + 1, C_D0 + n + 2
    last_col = stc
    xs.banner(ws, st, last_col, "Winter Holiday Coverage", _subtitle(cfg, "BY TEAM & DAY"),
              "Live view of the Winter Plan tab: how many people each team has on shift every day. "
              "Edit shifts on the Winter Plan tab; everything here updates.", logo)
    widths = xs.STD_WIDTHS
    ws.set_column(0, 0, widths["index"])
    ws.set_column(C_TEAMC, C_TEAMC, widths["team_heat"])
    ws.set_column(C_PEOPLE, C_PEOPLE, widths["min"])
    ws.set_column(C_MIN, C_MIN, widths["min"] + 1)
    ws.set_column(C_D0, C_D0 + n - 1, 11.5)
    ws.set_column(dm, dm, 14)
    ws.set_column(pdc, pdc, 14)
    ws.set_column(stc, stc, widths["status"])

    first_team_row = 10  # 1-based
    last_team_row = first_team_row + T - 1
    d0l, dnl = xl_col_to_name(C_D0), xl_col_to_name(C_D0 + n - 1)
    heat = f"{d0l}{first_team_row}:{dnl}{last_team_row}"
    minr = f"$D{first_team_row}:$D{last_team_row}"
    heat_vs = f"{d0l}{first_team_row}:{dnl}{last_team_row}"
    min_vs = f"D{first_team_row}:D{last_team_row}"

    # python-side values for cached results
    counts = {g.team: [plan.headcount(g.team, d) for d in plan.window] for g in lay.groups}
    mins = {g.team: g.min_per_day for g in lay.groups}
    req = [g for g in lay.groups if g.min_per_day > 0]
    days_worked = {p.name: len([1 for d in plan.window if (p.name, d) in plan.cells]) for p in plan.people}
    nppl = len(plan.people)
    ok_people = sum(1 for v in days_worked.values() if cfg.min_days <= v <= cfg.max_days)

    ws.set_row(3, 18)
    ws.set_row(4, 36)
    ws.set_row(5, 10)
    spans = _tile_spans(C_TEAMC, C_D0 + n - C_TEAMC, 5)
    plan_m = f"{PQ}${xl_col_to_name(lay.dw_col)}${lay.first_row}:${xl_col_to_name(lay.dw_col)}${lay.last_row}"
    met = sum(1 for g in req for c in counts[g.team] if c >= g.min_per_day)
    below = sum(1 for g in req for c in counts[g.team] if c < g.min_per_day)
    total_req = len(req) * n
    nobody_be = sum(1 for g in lay.groups if g.min_per_day == 0 for c in counts[g.team] if c == 0)
    extra = sum(max(0, v - cfg.min_days) for v in days_worked.values())
    tiles = [
        (f"PEOPLE WORKING {cfg.min_days}–{cfg.max_days} DAYS",
         f'=COUNTIFS({plan_m},">={cfg.min_days}",{plan_m},"<={cfg.max_days}")&" / "&COUNT({plan_m})',
         "neutral", f"{ok_people} / {nppl}"),
        ("REQUIRED TEAM-DAYS MEETING THE MINIMUM",
         f'=SUMPRODUCT(({min_vs}>0)*({heat_vs}>={min_vs}))&" / "&(SUMPRODUCT(--({min_vs}>0))*{n})',
         "good", f"{met} / {total_req}"),
        ("REQUIRED TEAM-DAYS BELOW THE MINIMUM",
         f"=SUMPRODUCT(({min_vs}>0)*({heat_vs}<{min_vs}))", "warn" if below == 0 else "bad", below),
        ("BEST-EFFORT TEAM-DAYS WITH NOBODY",
         f"=SUMPRODUCT(({min_vs}=0)*({heat_vs}=0))", "warn", nobody_be),
        (f"EXTRA DAYS BEYOND {cfg.min_days} (TOTAL)",
         f"=SUMPRODUCT(({plan_m}>{cfg.min_days})*({plan_m}-{cfg.min_days}))", "neutral", extra),
    ]
    for (a, b), (label, formula, tone, cached) in zip(spans, tiles):
        xs.kpi_tile(ws, st, 3, a, b, label, formula, tone, cached)
    # section band + headers
    ws.set_row(6, 22)
    ws.merge_range(6, 0, 6, last_col, "HEADS ON SHIFT  ·  BY TEAM AND DAY", st.get("section"))
    ws.set_row(7, 24)
    ws.set_row(8, 22)
    ws.merge_range(7, 0, 8, 0, "", st.get("th"))
    ws.merge_range(7, C_TEAMC, 8, C_TEAMC, "Team", st.get("th_left"))
    ws.merge_range(7, C_PEOPLE, 8, C_PEOPLE, "People", st.get("th"))
    ws.merge_range(7, C_MIN, 8, C_MIN, "Min / day", st.get("th"))
    _day_header(ws, st, 0, C_D0, plan, cfg, 7, 8, None)
    ws.merge_range(7, dm, 8, dm, "Days min met", st.get("th"))
    ws.merge_range(7, pdc, 8, pdc, "Person-days", st.get("th"))
    ws.merge_range(7, stc, 8, stc, "Status", st.get("th_left"))

    team_col = f"{PQ}$D${lay.first_row}:$D${lay.last_row}"
    for i, g in enumerate(lay.groups):
        r = first_team_row + i  # 1-based
        r0 = r - 1
        ws.set_row(r0, 28)
        ws.write_string(r0, C_TEAMC, g.label, st.get("team_name", bg_color="#FFFFFF"))
        tcell = f"$B{r}"
        npeople = len(g.people)
        ws.write_formula(r0, C_PEOPLE, f"=COUNTIF({team_col},{tcell})", st.get("cell_center", font_size=10), npeople)
        ws.write_formula(r0, C_MIN, f"={PQ}$C${g.header_row}", st.get("heat_min"), g.min_per_day)
        for k, d in enumerate(plan.window):
            pc = f"{PQ}{xl_col_to_name(C_DAY0 + k)}${lay.first_row}:{xl_col_to_name(C_DAY0 + k)}${lay.last_row}"
            ws.write_formula(r0, C_D0 + k, f'=COUNTIFS({team_col},{tcell},{pc},"?*")', st.get("heat"), counts[g.team][k])
        rng = f"{d0l}{r}:{dnl}{r}"
        if g.min_per_day > 0:
            mval = sum(1 for c in counts[g.team] if c >= g.min_per_day)
            ws.write_formula(r0, dm, f'=COUNTIF({rng},">="&D{r})', st.get("cell_center", font_size=10), mval)
        else:
            mval = sum(1 for c in counts[g.team] if c > 0)
            ws.write_formula(r0, dm, f'=COUNTIF({rng},">0")', st.get("cell_center", font_size=10), mval)
        pdays = sum(days_worked[p.name] for p in g.people)
        mcol = f"{PQ}${xl_col_to_name(lay.dw_col)}${lay.first_row}:${xl_col_to_name(lay.dw_col)}${lay.last_row}"
        ws.write_formula(r0, pdc, f"=SUMIF({team_col},{tcell},{mcol})", st.get("cell_center", font_size=10), pdays)
        zeros = sum(1 for c in counts[g.team] if c == 0)
        if g.min_per_day > 0:
            f = (f'=IF({xl_col_to_name(dm)}{r}={n},"✓ Min "&D{r}&"/day met every day","Below min on "&({n}-'
                 f'{xl_col_to_name(dm)}{r})&" day(s)"&IF(COUNTIF({rng},0)>0," · nobody on "&COUNTIF({rng},0),""))')
            if mval == n:
                val = f"✓ Min {g.min_per_day}/day met every day"
            else:
                val = f"Below min on {n - mval} day(s)" + (f" · nobody on {zeros}" if zeros else "")
        else:
            f = (f'=IF({xl_col_to_name(dm)}{r}={n},"✓ Covered every day","Nobody on "&COUNTIF({rng},0)&" day(s) · best '
                 f'effort ({cfg.best_effort_max_days} days each, none added)")')
            val = ("✓ Covered every day" if mval == n else
                   f"Nobody on {zeros} day(s) · best effort ({cfg.best_effort_max_days} days each, none added)")
        ws.write_formula(r0, stc, f, st.get("status"), val)
    xs.heatmap_cf(ws, st, first_team_row - 1, C_D0, last_team_row - 1, C_D0 + n - 1, C_MIN)
    ws.conditional_format(first_team_row - 1, stc, last_team_row - 1, stc, {
        "type": "text", "criteria": "containing", "value": "✓", "format": st.wb.add_format(st.props("text_green"))})
    ws.conditional_format(first_team_row - 1, stc, last_team_row - 1, stc, {
        "type": "text", "criteria": "containing", "value": "Nobody", "format": st.wb.add_format(st.props("text_red"))})
    ws.conditional_format(first_team_row - 1, stc, last_team_row - 1, stc, {
        "type": "text", "criteria": "containing", "value": "Below", "format": st.wb.add_format(st.props("text_amber"))})
    # all-teams row
    tr = last_team_row + 1
    tr0 = tr - 1
    ws.set_row(tr0, 22)
    ws.write_string(tr0, C_TEAMC, "All teams", st.get("total"))
    ws.write_blank(tr0, 0, None, st.get("total"))
    ws.write_formula(tr0, C_PEOPLE, f"=SUM({xl_col_to_name(C_PEOPLE)}{first_team_row}:{xl_col_to_name(C_PEOPLE)}{last_team_row})",
                     st.get("total_center"), sum(len(g.people) for g in lay.groups))
    ws.write_blank(tr0, C_MIN, None, st.get("total"))
    for k, d in enumerate(plan.window):
        c = xl_col_to_name(C_D0 + k)
        ws.write_formula(tr0, C_D0 + k, f"=SUM({c}{first_team_row}:{c}{last_team_row})", st.get("total_center"),
                         sum(counts[g.team][k] for g in lay.groups))
    ws.write_blank(tr0, dm, None, st.get("total"))
    c = xl_col_to_name(pdc)
    ws.write_formula(tr0, pdc, f"=SUM({c}{first_team_row}:{c}{last_team_row})", st.get("total_center"),
                     sum(days_worked[p.name] for g in lay.groups for p in g.people))
    ws.write_blank(tr0, stc, None, st.get("total"))
    ws.set_row(tr0 + 2, 36)
    ws.merge_range(tr0 + 2, 0, tr0 + 2, last_col,
                   "Counts are formulas linked to the Winter Plan tab. Amber = below the minimum, red = nobody. "
                   "Best-effort teams have no daily minimum: they are covered where possible within "
                   f"{cfg.best_effort_max_days} days each, with no extra days added.  Who exactly is on each day, by shift "
                   "and team: see the Winter Daily Roster tab.", st.get("footnote"))
    ws.freeze_panes(9, 2)
    _page(ws)


# ---------------------------------------------------------------------------
# Winter Daily Roster


def _names_formula(lay: PlanLayout, g: Group, k: int, lane: str) -> str:
    col = xl_col_to_name(C_DAY0 + k)
    rng = lay.lane_range_ref(lane)
    namecol = xl_col_to_name(C_NAME)
    terms = []
    for p in g.people:
        r = g.rows[p.name]
        terms.append(f'IF(ISNUMBER(MATCH({PQ}{col}{r},{rng},0)),CHAR(10)&{PQ}${namecol}{r},"")')
    f = "=MID(" + "&".join(terms) + ",2,2000)"
    if len(f) > MAX_FORMULA_CHARS:
        raise ValueError(f"team {g.label!r} has too many people for one daily-roster formula ({len(f)} characters)")
    return f


def _write_daily_sheet(ws, st: xs.Styles, plan: WinterPlan, cfg: WinterConfig, lay: PlanLayout, logo) -> None:
    n = lay.n_days
    teams = lay.groups
    T = len(teams)
    first_team_col = 3
    all_col = first_team_col + T
    xs.banner(ws, st, all_col, "Winter Holiday Coverage", _subtitle(cfg, "DAILY ROSTER"),
              "Who is on, by date, shift and team — the same layout as last year's December disconnect sheet. Names update "
              "automatically from the Winter Plan tab. Total row: green = team meets its daily minimum, amber = below it, "
              "red = nobody.", logo)
    widths = xs.STD_WIDTHS
    ws.set_column(0, 0, widths["roster_label"])
    ws.set_column(1, 1, widths["roster_date"])
    ws.set_column(2, 2, 12)
    ws.set_column(first_team_col, all_col - 1, widths["roster_team"])
    ws.set_column(all_col, all_col, 11)
    ws.set_row(3, 30)
    ws.write(3, 0, "Day type", st.get("th"))
    ws.write(3, 1, "Date", st.get("th"))
    ws.write(3, 2, "Shift", st.get("th"))
    for i, g in enumerate(teams):
        ws.write_string(3, first_team_col + i, g.label, st.get("th"))
    ws.write(3, all_col, "All teams", st.get("th"))
    ws.set_row(4, 18)
    ws.write_blank(4, 0, None, st.get("th_min"))
    ws.write_blank(4, 1, None, st.get("th_min"))
    ws.write(4, 2, "Min / day", st.get("th_min"))
    for i, g in enumerate(teams):
        ws.write_formula(4, first_team_col + i, f"={PQ}$C${g.header_row}", st.get("th_min", num_format='[=0]"best effort";0'),
                         g.min_per_day)
    ws.write_blank(4, all_col, None, st.get("th_min"))

    lane_chip = {"Morning": "chip_morning", "Evening": "chip_evening", "Night/US": "chip_night"}
    lane_label = {"Morning": "Morning", "Evening": "Evening", "Night/US": "Night / US"}
    team_col = f"{PQ}$D${lay.first_row}:$D${lay.last_row}"
    row0 = 5
    for k, d in enumerate(plan.window):
        dayc = xl_col_to_name(C_DAY0 + k)
        # python-side contents
        names: dict[tuple[str, str], list[str]] = {}
        for g in teams:
            for p in g.people:
                if (p.name, d) in plan.cells:
                    ln = lane_name(plan.cells[(p.name, d)])
                    if ln:
                        names.setdefault((g.team, ln), []).append(p.name)
        label = cfg.day_label(d)
        lane_rows = []
        for li, lane in enumerate(("Morning", "Evening", "Night/US")):
            r0 = row0 + li
            lane_rows.append(r0)
            mx = max([len(names.get((g.team, lane), [])) for g in teams] + [1])
            ws.set_row(r0, max(24, min(12.5 * mx + 8, 200)))
            ws.write_string(r0, 2, lane_label[lane], st.get(lane_chip[lane]))
            for i, g in enumerate(teams):
                cell = names.get((g.team, lane), [])
                if g.people:
                    ws.write_formula(r0, first_team_col + i, _names_formula(lay, g, k, lane), st.get("names"),
                                     "\n".join(cell))
                else:
                    ws.write_blank(r0, first_team_col + i, None, st.get("names"))
            rng = lay.lane_range_ref(lane)
            col_rng = f"{PQ}{dayc}${lay.first_row}:{dayc}${lay.last_row}"
            total_lane = sum(len(names.get((g.team, lane), [])) for g in teams)
            ws.write_formula(r0, all_col, f"=SUMPRODUCT(--ISNUMBER(MATCH({col_rng},{rng},0)))",
                             st.get("roster_total"), total_lane)
        tr0 = row0 + 3
        ws.set_row(tr0, 24)
        ws.write_string(tr0, 2, "Total on shift", st.get("roster_total_label"))
        for i, g in enumerate(teams):
            col_rng = f"{PQ}{dayc}${lay.first_row}:{dayc}${lay.last_row}"
            hdr = xl_rowcol_to_cell(3, first_team_col + i, row_abs=True)
            ws.write_formula(tr0, first_team_col + i, f'=COUNTIFS({team_col},{hdr},{col_rng},"?*")', st.get("roster_total"),
                             plan.headcount(g.team, d))
        a, b = xl_col_to_name(first_team_col), xl_col_to_name(all_col - 1)
        ws.write_formula(tr0, all_col, f"=SUM({a}{tr0 + 1}:{b}{tr0 + 1})", st.get("total_center", font_size=12),
                         sum(plan.headcount(g.team, d) for g in teams))
        # merged day type + date
        chip = xs.day_chip_format(st, label)
        ws.merge_range(row0, 0, tr0, 0, label, chip)
        ws.merge_range(row0, 1, tr0, 1, "", st.get("roster_date"))
        ws.write_datetime(row0, 1, _dt(d), st.get("roster_date"))
        # heat on the total row
        tl = xl_rowcol_to_cell(tr0, first_team_col)
        minc = xl_rowcol_to_cell(4, first_team_col, row_abs=True)
        rr = (tr0, first_team_col, tr0, all_col - 1)
        ws.conditional_format(*rr, {"type": "formula", "criteria": f"={tl}=0",
                                    "format": st.wb.add_format(st.props("heat_red")), "stop_if_true": True})
        ws.conditional_format(*rr, {"type": "formula", "criteria": f"={tl}>={minc}",
                                    "format": st.wb.add_format(st.props("heat_green")), "stop_if_true": True})
        ws.conditional_format(*rr, {"type": "formula", "criteria": f"={tl}<{minc}",
                                    "format": st.wb.add_format(st.props("heat_amber"))})
        row0 += 4
    ws.set_row(row0 + 1, 30)
    ws.merge_range(row0 + 1, 0, row0 + 1, all_col,
                   "Shifts are grouped by the start time of each person's shift: Morning before 12:00, Evening 12:00-18:00, "
                   "Night / US after 18:00 (IST). The lane of a name follows the code in its Winter Plan cell.",
                   st.get("footnote"))
    ws.freeze_panes(5, 3)
    ws.set_zoom(90)
    _page(ws)


# ---------------------------------------------------------------------------
# snapshot + entry point


def build_snapshot(plan: WinterPlan, cfg: WinterConfig, lay: PlanLayout) -> Snapshot:
    cells: list[SnapshotCell] = []
    people_meta = []
    for g in lay.groups:
        for p in g.people:
            r = g.rows[p.name]
            people_meta.append({**p.to_dict(), "row": r, "team_label": g.label})
            for k, d in enumerate(plan.window):
                cells.append(SnapshotCell(p.name, d, display_code(plan.code(p.name, d)), r, C_DAY0 + k + 1))
    ri = plan.run_info
    meta = {
        "library": LIBRARY_ID,
        "plan_hash": plan.plan_hash(),
        "config_hash": cfg.config_hash(),
        "window": {"start": cfg.start.isoformat(), "end": cfg.end.isoformat(),
                   "days": [d.isoformat() for d in plan.window]},
        "sheet": SHEET_PLAN,
        "sheets": [SHEET_COVERAGE, SHEET_DAILY, SHEET_PLAN],
        "first_day_col": C_DAY0 + 1,
        "first_person_row": lay.first_row,
        "last_person_row": lay.last_row,
        "teams": [{"team": g.team, "label": g.label, "min_per_day": g.min_per_day, "best_effort": g.best_effort,
                   "header_row": g.header_row} for g in lay.groups],
        "people": people_meta,
        "rules": {"min_days": cfg.min_days, "max_days": cfg.max_days,
                  "best_effort_max_days": cfg.best_effort_max_days},
        "run": {"seed": ri.seed, "status": ri.status, "mip_gap": ri.mip_gap, "objective": ri.objective,
                "fallback": ri.fallback, "time_limit_hit": ri.time_limit_hit},
    }
    return Snapshot(meta, cells)


def write_winter_workbook(path: Union[str, os.PathLike], plan: WinterPlan, cfg: WinterConfig, *,
                          logo_path: Optional[Union[str, os.PathLike]] = DEFAULT_LOGO,
                          sidecar: bool = True) -> WorkbookResult:
    """Write the three-tab workbook (+ hidden `_snapshot` and, by default, `<path>.snapshot.json`)."""
    path = os.fspath(path)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    lay = build_layout(plan, cfg)
    snap = build_snapshot(plan, cfg, lay)
    logo = logo_path if logo_path and os.path.exists(logo_path) else None

    wb = xs.new_workbook(path)
    wb.set_properties({"title": "Winter Holiday Coverage", "subject": f"{cfg.start} to {cfg.end}",
                       "comments": f"Generated by {LIBRARY_ID}; plan {snap.meta['plan_hash'][:12]}"})
    st = xs.Styles(wb)
    ws_cov = wb.add_worksheet(SHEET_COVERAGE)
    ws_day = wb.add_worksheet(SHEET_DAILY)
    ws_plan = wb.add_worksheet(SHEET_PLAN)
    ws_snap = wb.add_worksheet(SNAPSHOT_SHEET)
    _write_coverage_sheet(ws_cov, st, plan, cfg, lay, logo)
    _write_daily_sheet(ws_day, st, plan, cfg, lay, logo)
    _write_plan_sheet(ws_plan, st, plan, cfg, lay, logo)
    for r, row in enumerate(snapshot_rows(snap)):
        for c, v in enumerate(row):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                ws_snap.write_number(r, c, v)
            else:
                ws_snap.write_string(r, c, v)
    ws_snap.very_hidden()
    ws_cov.activate()
    ws_cov.set_first_sheet()
    wb.close()

    sidecar_path = None
    if sidecar:
        sidecar_path = sidecar_path_for(path)
        with open(sidecar_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(snap.to_json())
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return WorkbookResult(path, sidecar_path, snap, snap.meta["plan_hash"], snap.meta["config_hash"], lay, h.hexdigest())
