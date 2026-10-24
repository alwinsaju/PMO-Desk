"""Drive the task scripts in order, the way the Tasks app does (through their `main()`)."""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

import openpyxl

from synth import WINDOW, WINDOW_TEXT, World, answer_defaults, build_world, write_run_params


def _text(v):
    return None if v in ("", None) else v


class Pipeline:
    def __init__(self, root: Path, **world_kw):
        self.world: World = build_world(root, **world_kw)
        self.paths = self.world.paths
        self.root = root

    @classmethod
    def adopt(cls, root: Path) -> "Pipeline":
        """A pipeline on an existing task folder (a copy of a finished stage)."""
        from _common import Paths

        self = object.__new__(cls)
        self.root, self.paths, self.world = root, Paths(root), None
        return self

    # ---- steps (each returns the exit code) ----
    def prepare(self) -> int:
        import prepare_options  # imported lazily: a script is importable as soon as it exists

        return prepare_options.main(task_dir=self.root)

    def analyze(self, window: str = WINDOW) -> int:
        import analyze

        write_run_params(self.paths, window)
        return analyze.main(task_dir=self.root)

    def form(self) -> dict:
        return json.loads(self.paths.ask_me.read_text(encoding="utf-8"))

    def answer(self, overrides: dict | None = None) -> dict:
        answers = answer_defaults(self.form())
        answers.update(overrides or {})
        self.write_answers(answers)
        return answers

    def write_answers(self, answers: dict) -> None:
        self.paths.answers.write_text(json.dumps(answers, indent=2), encoding="utf-8")

    def build_draft(self) -> int:
        import build_draft

        return build_draft.main(task_dir=self.root)

    def diff(self) -> int:
        import diff_draft

        return diff_draft.main(task_dir=self.root)

    def finalize(self) -> int:
        import finalize

        return finalize.main(task_dir=self.root)

    # ---- files ----
    def main_draft(self) -> Path:
        return self.paths.draft_main(WINDOW_TEXT)

    def analytics_draft(self) -> Path:
        return self.paths.draft_analytics(WINDOW_TEXT)

    def diff_json(self) -> dict:
        return json.loads(self.paths.diff.read_text(encoding="utf-8"))

    def report(self) -> dict:
        return json.loads(self.paths.report.read_text(encoding="utf-8"))

    def flags(self) -> dict:
        return json.loads(self.paths.flags.read_text(encoding="utf-8"))

    def run_to_draft(self, overrides: dict | None = None) -> None:
        assert self.prepare() == 0
        assert self.analyze() == 0
        self.answer(overrides)
        assert self.build_draft() == 0

    # ---- the PMO edits the workbooks in Excel and saves them in place (the sidecars stay) ----
    def edit_main(self, edits: dict[tuple[str, date], str]) -> Path:
        """Set cells of the Winter Plan grid ({(person, date): text}; "" clears the cell)."""
        path = self.main_draft()
        wb = openpyxl.load_workbook(path)
        ws = wb["Winter Plan"]
        hdr = next(r for r in range(1, 15)
                   if "Team member" in (ws.cell(r, 1).value, ws.cell(r, 2).value))
        cols = {}
        for r in range(hdr, hdr + 3):
            for c in range(1, ws.max_column + 1):
                v = ws.cell(r, c).value
                if isinstance(v, datetime):
                    cols[v.date()] = c
            if cols:
                break
        rows = {str(ws.cell(r, 2).value): r for r in range(hdr + 1, ws.max_row + 1)}
        for (person, d), text in edits.items():
            ws.cell(rows[person], cols[d]).value = _text(text)
        wb.save(path)
        return path

    def edit_analytics(self, edits: dict[tuple[date, str], str]) -> Path:
        """Set Assigned cells of the Winter Roster ({(date, slot label): name}; None clears)."""
        path = self.analytics_draft()
        wb = openpyxl.load_workbook(path)
        ws = wb["Winter Roster"]
        hdr = next(r for r in range(1, 20) if ws.cell(r, 1).value == "Date")
        todo = dict(edits)
        for r in range(hdr + 1, ws.max_row + 1):
            v = ws.cell(r, 1).value
            d = v.date() if isinstance(v, datetime) else v
            key = (d, ws.cell(r, 4).value)
            if key in todo:
                ws.cell(r, 8).value = _text(todo.pop(key))
        assert not todo, "cells not found"
        wb.save(path)
        return path

    def run_to_diff(self, main_edits=None, analytics_edits=None, overrides=None) -> None:
        self.run_to_draft(overrides)
        if main_edits:
            self.edit_main(main_edits)
        if analytics_edits:
            self.edit_analytics(analytics_edits)
        assert self.diff() == 0
