"""
Shared look and layout helpers for the winter-coverage workbooks (xlsxwriter).

The look matches last year's coverage workbook: Arial, dark gray #282728 with
the green accent #86BC25, pastel "chips", a white tile with the Takeda logo at
the top-left, a dark title banner, KPI tiles and red/amber/green heat maps.
Everything is built on xlsxwriter, all row/column arguments are ZERO-based
(like xlsxwriter itself).

Public API (kept small on purpose; the main plan and the analytics plan both
import it)

    new_workbook(path) -> xlsxwriter.Workbook
        Workbook with the common defaults: Arial 10, no NaN/Inf, strings stay
        strings, Excel recalculates on load.

    Styles(workbook)
        .get(name, **overrides) -> Format        cached named format
        .names() -> list[str]                    every named format
        Names: see FORMAT_SPECS (title, note, kpi_label_<tone>, kpi_value_<tone>,
        th, th_left, th_weekend, team_name, cell, cell_center, band, total,
        chip_morning/evening/night, day_<type>, heat_*, ...).

    banner(ws, styles, last_col, title, subtitle, note, logo_path=None, logo_cols=2) -> next_row
        Rows 0-2: [logo tile | dark title banner], the one-line note, a thin
        green accent bar. Returns the first free row (3).

    logo_tile(ws, styles, logo_path, first_row, first_col, last_row, last_col)
        Merged white tile with the logo scaled to fit (fixed 163 x 51 px image
        in a 66 pt tall row; falls back to a blank tile when the file is absent).

    kpi_tile(ws, styles, row, first_col, last_col, label, formula_or_value, tone="neutral", cached=None)
        Two-row tile: small caps label (row) and big value (row + 1). `tone` is
        one of neutral / good / warn / bad. A string starting with "=" is written
        as a formula (with `cached` as its cached result).

    heatmap_cf(ws, styles, first_row, first_col, last_row, last_col, min_col)
        Three conditional formats for a team x day count block: red when 0,
        green when >= the team's minimum (the number in column `min_col` of the
        same row), amber when below it. Red wins over green for a 0 minimum.

    shift_code_cf(ws, styles, first_row, first_col, last_row, last_col, display_codes)
        Pastel fill per shift code (exact text match) for a by-person grid.

    day_chip_format(styles, label) -> Format      chip for Christmas / Weekend / ...
    STD_WIDTHS                                    standard column widths (characters)
    COLORS                                        the palette (hex strings)

Limitations: xlsxwriter writes formulas with the cached values the caller gives
(default 0); the workbook asks Excel to fully recalculate on open, so the first
open shows live values. winter_lib tests verify cached == recalculated with a
formula evaluator (real Excel / LibreOffice were not available when written).
"""

from __future__ import annotations

import os
from typing import Any, Iterable, Optional, Union

import xlsxwriter
from xlsxwriter.utility import xl_rowcol_to_cell

FONT = "Arial"

COLORS: dict[str, str] = {
    # brand
    "dark": "#282728",
    "dark2": "#3D3C3D",
    "dark3": "#4B4A4B",
    "green": "#86BC25",
    "white": "#FFFFFF",
    # text
    "text": "#374151",
    "muted": "#6B7280",
    "faint": "#9AA1AC",
    "light_text": "#D4D4D4",
    # surfaces
    "page": "#F7F8FA",
    "zebra": "#F8F9FB",
    "band": "#E3E8EF",
    "line": "#D9DEE6",
    # heat (fill, text)
    "red_fill": "#F3B1AC",
    "red_text": "#A31D1D",
    "amber_fill": "#FFE08A",
    "amber_text": "#7A5A00",
    "green_fill": "#D6ECC4",
    "green_text": "#2F6B1F",
    # KPI backgrounds
    "kpi_neutral": "#F1F3F6",
    "kpi_good": "#EEF6DC",
    "kpi_warn": "#FFF4D1",
    "kpi_bad": "#FDE3E1",
    # pastel chips (fill, text)
    "chip_morning": "#FFEAA8",
    "chip_morning_text": "#7A5A00",
    "chip_evening": "#CDE2F6",
    "chip_evening_text": "#1D4E89",
    "chip_night": "#B4C1EE",
    "chip_night_text": "#1E2A78",
    "chip_blue": "#C7D7F5",
    "chip_blue_text": "#1D3E8A",
    "chip_gray": "#E5E7EB",
    "chip_gray_text": "#4B5563",
}

# Pastel fill per shift (display text of the dropdown value).
SHIFT_FILLS: dict[str, str] = {
    "Shift-1": "#D6ECC4",
    "Shift-2": "#FFEAA8",
    "Shift-3": "#CDE2F6",
    "Shift-4": "#E2D3F1",
    "Shift-5": "#F8D2E2",
    "NS": "#B4C1EE",
    "US-CST": "#C4EADB",
    "US-PST": "#FAD3BB",
    "11AM-8PM": "#F1E8D4",
    "8am-5pm CST": "#D3EAEC",
}

# Standard column widths in characters.
STD_WIDTHS: dict[str, float] = {
    "index": 5.0,
    "name": 28.0,
    "location": 7.0,
    "team": 17.0,
    "shift": 12.0,
    "lane": 10.0,
    "day": 12.4,
    "count": 11.0,
    "wide_count": 13.0,
    "team_heat": 26.0,
    "min": 9.0,
    "status": 62.0,
    "roster_team": 19.0,
    "roster_label": 17.0,
    "roster_date": 13.0,
}

_DAY_CHIPS = {
    "christmas": ("red_fill", "red_text"),
    "new year": ("red_fill", "red_text"),
    "weekend": ("chip_gray", "chip_gray_text"),
    "winter disconnect": ("chip_blue", "chip_blue_text"),
}


def _c(name: str) -> str:
    return COLORS[name]


def _spec(**kw: Any) -> dict[str, Any]:
    return {"font_name": FONT, "font_size": 10, "font_color": _c("text"), "valign": "vcenter", **kw}


def _build_specs() -> dict[str, dict[str, Any]]:
    s: dict[str, dict[str, Any]] = {}
    s["base"] = _spec()
    s["logo_tile"] = _spec(bg_color=_c("white"), align="center")
    s["title"] = _spec(font_size=16, bold=True, font_color=_c("white"), bg_color=_c("dark"),
                       align="left", text_wrap=True, indent=1)
    s["note"] = _spec(font_size=8.5, font_color=_c("muted"), bg_color=_c("page"), align="left", text_wrap=True,
                      indent=1)
    s["accent"] = _spec(bg_color=_c("green"))
    s["footnote"] = _spec(font_size=8.5, font_color=_c("muted"), align="left", text_wrap=True, valign="top")
    s["section"] = _spec(font_size=9, bold=True, font_color=_c("dark"), bg_color=_c("band"), align="left")
    s["section_fill"] = _spec(bg_color=_c("band"))
    # table headers
    s["th"] = _spec(font_size=9, bold=True, font_color=_c("white"), bg_color=_c("dark"), align="center",
                    text_wrap=True)
    s["th_left"] = _spec(font_size=11, bold=True, font_color=_c("white"), bg_color=_c("dark"), align="left",
                         indent=1)
    s["th_weekend"] = _spec(font_size=9, bold=True, font_color=_c("light_text"), bg_color=_c("dark3"),
                            align="center", text_wrap=True)
    s["th_sub"] = _spec(font_size=8, font_color=_c("white"), bg_color=_c("dark"), align="center")
    s["th_sub_weekend"] = _spec(font_size=8, font_color=_c("light_text"), bg_color=_c("dark3"), align="center")
    s["th_min"] = _spec(font_size=8, bold=True, font_color=_c("white"), bg_color=_c("dark2"), align="center")
    # body
    s["team_name"] = _spec(bold=True, font_color=_c("dark"), align="left", indent=1)
    s["cell"] = _spec(font_size=9, align="left", indent=1)
    s["cell_center"] = _spec(font_size=9, align="center")
    s["cell_muted"] = _spec(font_size=9, font_color=_c("muted"), align="center")
    s["index"] = _spec(font_size=8, font_color=_c("faint"), align="center")
    s["name"] = _spec(font_color=_c("dark"), align="left", indent=1)
    s["grid"] = _spec(font_size=9, align="center", text_wrap=True, border=1, border_color=_c("line"))
    s["count"] = _spec(font_size=10, bold=True, font_color=_c("dark"), align="center")
    s["count_muted"] = _spec(font_size=9, font_color=_c("muted"), align="center")
    s["heat"] = _spec(font_size=13, bold=True, align="center", bg_color=_c("page"), border=1,
                      border_color=_c("white"))
    s["heat_min"] = _spec(bold=True, align="center", num_format='[=0]"best effort";0')
    s["status"] = _spec(font_size=9, bold=True, align="left", text_wrap=True, indent=1)
    s["band"] = _spec(font_size=9, bold=True, font_color=_c("muted"), bg_color=_c("band"), align="left", indent=1)
    s["band_center"] = _spec(font_size=8, bold=True, font_color=_c("muted"), bg_color=_c("band"), align="center")
    s["band_count"] = _spec(font_size=11, bold=True, font_color=_c("dark"), bg_color=_c("band"), align="center")
    s["total"] = _spec(font_size=10, bold=True, font_color=_c("white"), bg_color=_c("dark2"), align="left",
                       indent=1)
    s["total_center"] = _spec(font_size=11, bold=True, font_color=_c("white"), bg_color=_c("dark2"),
                              align="center")
    s["names"] = _spec(font_size=9, align="left", text_wrap=True, valign="top", indent=1, border=1,
                       border_color=_c("line"))
    s["roster_date"] = _spec(font_size=11, bold=True, font_color=_c("dark"), bg_color=_c("page"), align="center",
                             text_wrap=True, num_format="ddd d mmm")
    s["roster_total"] = _spec(font_size=12, bold=True, font_color=_c("dark"), bg_color=_c("band"),
                              align="center")
    s["roster_total_label"] = _spec(font_size=9, bold=True, font_color=_c("muted"), bg_color=_c("band"),
                                    align="center")
    s["date"] = _spec(font_size=9, bold=True, font_color=_c("white"), bg_color=_c("dark"), align="center",
                      num_format="d mmm")
    s["date_weekend"] = _spec(font_size=9, bold=True, font_color=_c("light_text"), bg_color=_c("dark3"),
                              align="center", num_format="d mmm")
    s["weekday"] = _spec(font_size=8, font_color=_c("white"), bg_color=_c("dark"), align="center",
                         num_format="ddd")
    s["weekday_weekend"] = _spec(font_size=8, font_color=_c("light_text"), bg_color=_c("dark3"), align="center",
                                 num_format="ddd")
    # lane chips
    for lane, key in (("morning", "chip_morning"), ("evening", "chip_evening"), ("night", "chip_night")):
        s[f"chip_{lane}"] = _spec(font_size=9, bold=True, font_color=_c(f"{key}_text"), bg_color=_c(key),
                                  align="center", text_wrap=True)
    # day-type chips
    for label, (fill, text) in _DAY_CHIPS.items():
        s[f"day_{label.replace(' ', '_')}"] = _spec(font_size=8, bold=True, font_color=_c(text),
                                                    bg_color=_c(fill), align="center", text_wrap=True)
    # KPI tiles
    kpi_tone_text = {"neutral": "dark", "good": "green_text", "warn": "amber_text", "bad": "red_text"}
    for tone, text in kpi_tone_text.items():
        s[f"kpi_label_{tone}"] = _spec(font_size=8, bold=True, font_color=_c("muted"), bg_color=_c(f"kpi_{tone}"),
                                       align="center", text_wrap=True)
        s[f"kpi_value_{tone}"] = _spec(font_size=20, bold=True, font_color=_c(text),
                                       bg_color=_c(f"kpi_{tone}"), align="center")
    # CF dxf formats (applied through conditional_format, so only colors matter)
    s["heat_red"] = {"bg_color": _c("red_fill"), "font_color": _c("red_text")}
    s["heat_amber"] = {"bg_color": _c("amber_fill"), "font_color": _c("amber_text")}
    s["heat_green"] = {"bg_color": _c("green_fill"), "font_color": _c("green_text")}
    s["text_red"] = {"font_color": _c("red_text")}
    s["text_amber"] = {"font_color": _c("amber_text")}
    s["text_green"] = {"font_color": _c("green_text")}
    return s


FORMAT_SPECS: dict[str, dict[str, Any]] = _build_specs()


class Styles:
    """Named xlsxwriter formats for one workbook (created lazily, then cached)."""

    def __init__(self, workbook: xlsxwriter.Workbook):
        self.wb = workbook
        self._cache: dict[tuple, Any] = {}

    def names(self) -> list[str]:
        return sorted(FORMAT_SPECS)

    def get(self, name: str, **overrides: Any):
        if name not in FORMAT_SPECS:
            raise KeyError(f"unknown format {name!r}")
        key = (name, tuple(sorted(overrides.items())))
        fmt = self._cache.get(key)
        if fmt is None:
            fmt = self.wb.add_format({**FORMAT_SPECS[name], **overrides})
            self._cache[key] = fmt
        return fmt

    def props(self, name: str, **overrides: Any) -> dict[str, Any]:
        """The raw property dict (used for conditional-format formats)."""
        return {**FORMAT_SPECS[name], **overrides}


def new_workbook(path: Union[str, os.PathLike]) -> xlsxwriter.Workbook:
    """A workbook with the shared defaults (Arial 10, strings stay strings, no NaN/Inf)."""
    return xlsxwriter.Workbook(
        os.fspath(path),
        {
            "default_format_properties": {"font_name": FONT, "font_size": 10, "font_color": _c("text")},
            "strings_to_numbers": False,
            "strings_to_formulas": False,
            "strings_to_urls": False,
            "nan_inf_to_errors": False,
        },
    )


def logo_tile(ws, styles: Styles, logo_path: Optional[Union[str, os.PathLike]], first_row: int, first_col: int,
              last_row: int, last_col: int) -> None:
    fmt = styles.get("logo_tile")
    if (first_row, first_col) == (last_row, last_col):
        ws.write_blank(first_row, first_col, None, fmt)
    else:
        ws.merge_range(first_row, first_col, last_row, last_col, "", fmt)
    if logo_path and os.path.exists(logo_path):
        ws.insert_image(first_row, first_col, os.fspath(logo_path), _logo_options(logo_path))


def _logo_options(logo_path) -> dict[str, Any]:
    """Scale the logo to at most 150 x 50 px, keeping its aspect ratio."""
    try:
        from PIL import Image  # optional: pillow is installed alongside openpyxl users
        with Image.open(logo_path) as im:
            w, h = im.size
        scale = min(150.0 / w, 50.0 / h)
    except Exception:
        scale = 0.35
    return {"x_offset": 8, "y_offset": 8, "x_scale": scale, "y_scale": scale, "object_position": 1}


def banner(ws, styles: Styles, last_col: int, title: str, subtitle: str, note: str,
           logo_path: Optional[Union[str, os.PathLike]] = None, logo_cols: int = 2) -> int:
    """Rows 0-2: logo tile + title banner, note line, green accent bar. Returns next free row (3)."""
    ws.set_row(0, 66)
    ws.set_row(1, 30)
    ws.set_row(2, 5)
    logo_tile(ws, styles, logo_path, 0, 0, 0, logo_cols - 1)
    ws.merge_range(0, logo_cols, 0, last_col, "", styles.get("title"))
    big = styles.wb.add_format({**FORMAT_SPECS["title"], "font_size": 16, "bold": True})
    small = styles.wb.add_format({"font_name": FONT, "font_size": 9, "bold": False,
                                  "font_color": _c("green")})
    ws.write_rich_string(0, logo_cols, big, title + "\n", small, subtitle, styles.get("title"))
    ws.merge_range(1, 0, 1, last_col, note, styles.get("note"))
    for c in range(0, last_col + 1):
        ws.write_blank(2, c, None, styles.get("accent"))
    return 3


def kpi_tile(ws, styles: Styles, row: int, first_col: int, last_col: int, label: str,
             formula_or_value: Union[str, int, float], tone: str = "neutral", cached: Any = None) -> None:
    lf, vf = styles.get(f"kpi_label_{tone}"), styles.get(f"kpi_value_{tone}")
    if last_col > first_col:
        ws.merge_range(row, first_col, row, last_col, label, lf)
        ws.merge_range(row + 1, first_col, row + 1, last_col, "", vf)
    else:
        ws.write(row, first_col, label, lf)
    value_cell = (row + 1, first_col)
    if isinstance(formula_or_value, str) and formula_or_value.startswith("="):
        ws.write_formula(*value_cell, formula_or_value, vf, "" if cached is None else cached)
    else:
        ws.write(*value_cell, formula_or_value, vf)


def heatmap_cf(ws, styles: Styles, first_row: int, first_col: int, last_row: int, last_col: int,
               min_col: int) -> None:
    """Red when 0, green when >= the row's minimum (column `min_col`), amber when below it."""
    top_left = xl_rowcol_to_cell(first_row, first_col)
    min_cell = xl_rowcol_to_cell(first_row, min_col, col_abs=True)
    red = styles.wb.add_format(styles.props("heat_red"))
    green = styles.wb.add_format(styles.props("heat_green"))
    amber = styles.wb.add_format(styles.props("heat_amber"))
    ws.conditional_format(first_row, first_col, last_row, last_col, {
        "type": "formula", "criteria": f"={top_left}=0", "format": red, "stop_if_true": True})
    ws.conditional_format(first_row, first_col, last_row, last_col, {
        "type": "formula", "criteria": f"={top_left}>={min_cell}", "format": green, "stop_if_true": True})
    ws.conditional_format(first_row, first_col, last_row, last_col, {
        "type": "formula", "criteria": f"={top_left}<{min_cell}", "format": amber})


def shift_code_cf(ws, styles: Styles, first_row: int, first_col: int, last_row: int, last_col: int,
                  display_codes: Iterable[str]) -> None:
    for code in display_codes:
        fill = SHIFT_FILLS.get(code)
        if not fill:
            continue
        ws.conditional_format(first_row, first_col, last_row, last_col, {
            "type": "cell", "criteria": "==", "value": '"%s"' % code.replace('"', '""'),
            "format": styles.wb.add_format({"bg_color": fill}),
        })


def day_chip_format(styles: Styles, label: str):
    key = "day_" + label.strip().lower().replace(" ", "_")
    if key in FORMAT_SPECS:
        return styles.get(key)
    return styles.get("day_weekend")
