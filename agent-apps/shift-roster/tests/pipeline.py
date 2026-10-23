"""Drive the task scripts in order, the way the Tasks app does (through their `main()`)."""

from __future__ import annotations

import json
import shutil
from datetime import date
from pathlib import Path

from draft_testkit import pmo_save
from synth import World, answer_defaults, build_world, write_run_params

PTO_FIELD = "pto:Persn 07"


class Pipeline:
    def __init__(self, root: Path, **world_kw):
        self.world: World = build_world(root, **world_kw)
        self.paths = self.world.paths
        self.root = root
        self.cycle = "2026-12"

    # ---- steps (each returns the exit code) ----
    def prepare(self) -> int:
        import prepare_options  # imported lazily: a script is importable as soon as it exists

        return prepare_options.main(task_dir=self.root)

    def analyze(self, cycle: str = "2026-12") -> int:
        import analyze

        self.cycle = cycle
        write_run_params(self.paths, cycle)
        return analyze.main(task_dir=self.root)

    def form(self) -> dict:
        return json.loads(self.paths.ask_me.read_text(encoding="utf-8"))

    def answer(self, overrides: dict | None = None) -> dict:
        """Default answers (new person: new seat, near PTO name: Person 07) + overrides."""
        form = self.form()
        answers = answer_defaults(form)
        if PTO_FIELD in answers:
            answers[PTO_FIELD] = "Person 07"
        answers.update(overrides or {})
        self.paths.answers.write_text(json.dumps(answers, indent=2), encoding="utf-8")
        return answers

    def write_answers(self, answers: dict) -> None:
        self.paths.answers.write_text(json.dumps(answers, indent=2), encoding="utf-8")

    def build_draft(self) -> int:
        import build_draft

        return build_draft.main(task_dir=self.root)

    def draft(self) -> Path:
        return self.paths.draft(self.cycle)

    def pmo_edit(self, edits: dict[tuple[str, date], str]) -> Path:
        """The user edits cells in Excel and saves the draft in place (sidecar stays)."""
        tmp = self.root / "excel-save.xlsx"
        pmo_save(self.draft(), tmp, edits)
        shutil.copyfile(tmp, self.draft())
        tmp.unlink()
        return self.draft()

    def diff(self) -> int:
        import diff_draft

        return diff_draft.main(task_dir=self.root)

    def diff_json(self) -> dict:
        return json.loads(self.paths.diff.read_text(encoding="utf-8"))

    def finalize(self) -> int:
        import finalize

        return finalize.main(task_dir=self.root)

    def report(self) -> dict:
        return json.loads(self.paths.report.read_text(encoding="utf-8"))

    def run_to_draft(self, overrides: dict | None = None) -> None:
        assert self.prepare() == 0
        assert self.analyze() == 0
        self.answer(overrides)
        assert self.build_draft() == 0

    def run_to_diff(self, edits=None) -> None:
        self.run_to_draft()
        if edits:
            self.pmo_edit(edits)
        assert self.diff() == 0


# a few user edits that are inside the Dec 2026 cycle
EDITS = {("Person 01", date(2026, 12, 7)): "PTO",
         ("Person 06", date(2026, 12, 8)): "",
         ("Person 09", date(2026, 12, 9)): "On-call"}
