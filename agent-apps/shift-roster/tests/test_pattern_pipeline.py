"""PATTERN groups through the task scripts (analyze -> build_draft): a two-person on-call
alternation in the synthetic roster is detected, continued into the draft, shown in the analysis,
the Draft Summary and flags.json, and a group with no stable pattern is asked about."""

import json
import random
from datetime import date, timedelta

from openpyxl import load_workbook

import synth
from pipeline import Pipeline
from roster_lib.checks import daterange
from roster_lib.config import load_config, save_config
from roster_lib.cycle_builder import Plan

PAIR = ("Person 10", "Person 11")  # the synthetic Device Support people


def alternating(person: str, d: date) -> str:
    """A 2-week alternation, as CMS does it: Mon-Fri shifts, the on-call weekend alternates."""
    week = (d - synth.START).days // 7  # 2026-08-02 is a Sunday: week 0
    code = "Shift-3" if person == PAIR[0] else "11AM-8PM"
    if 1 <= d.weekday() + 1 <= 5 and d.weekday() < 5:
        return code
    mine = (week % 2 == 0) == (person == PAIR[0])
    if d.weekday() == 5 and mine:  # Saturday of an "own" week
        return "OC"
    if d.weekday() == 6 and ((week - 1) % 2 == 0) == (person == PAIR[0]) and week > 0:
        return "OC"  # the Sunday after the Saturday on-call
    return ""


def pattern_pipeline(tmp_path, *, noise=False) -> Pipeline:
    p = Pipeline(tmp_path / "t")
    rng = random.Random(5)
    edits = {}
    for person in PAIR:
        for d in daterange(synth.START, synth.OCT.end):
            edits[(person, d)] = (rng.choice(["Shift-1", "Shift-3", "", "OC"]) if noise
                                  else alternating(person, d))
    synth.patch_master(p.world, edits)
    cfg = load_config(p.paths.config)
    for person in PAIR:
        cfg.update_person(person, rotation="PATTERN", pattern_group="pair", shift=None)
    save_config(cfg, p.paths.config)
    return p


def test_detected_pattern_is_continued_and_reported(tmp_path):
    p = pattern_pipeline(tmp_path)
    assert p.prepare() == 0 and p.analyze() == 0
    analysis = json.loads(p.paths.analysis.read_text(encoding="utf-8"))
    group = analysis["analysis"]["pattern_groups"][0]
    assert group["group"] == "pair" and group["detected"] and group["period_weeks"] == 2
    assert group["members"] == 2 and group["weeks_observed"] == 17 and group["confidence"] >= 0.99
    assert group["duty_members"] == 2 and "2-week pattern" in group["summary"]
    # nothing to ask for the pair: the form is the usual one
    assert not [f for f in p.form()["fields"] if f["label"] in PAIR]
    p.answer()
    assert p.build_draft() == 0

    plan = Plan.from_json(p.paths.plan.read_text(encoding="utf-8"))
    cells = {**plan.edits, **plan.remainder_edits}
    for person in PAIR:
        for d in daterange(synth.DEC.start, synth.DEC.end):
            got = cells.get((person, d)) or plan.preserved.get((person, d), "")
            assert got in (alternating(person, d), "HOL"), (person, d, got)
    # on-call weekends exist (the generic copy-forward would have dropped every one of them)
    assert sum(1 for (n, d), t in cells.items() if n in PAIR and t == "OC") >= 8
    # flags.json: an INFO flag says what was found and where it resumed
    flags = json.loads(p.paths.flags.read_text(encoding="utf-8"))["flags"]
    info = [f for f in flags if f["kind"] == "PATTERN_CONTINUED"]
    assert len(info) == 1 and info[0]["severity"] == "info"
    assert "pair: 2-week pattern" in info[0]["message"] and "continuing from week" in info[0]["message"]
    assert not [f for f in flags if f["kind"] == "PATTERN_NOT_DETECTED"]
    # the draft's Draft Summary lists the group; the config keeps the learned pattern
    ws = load_workbook(p.draft())["Draft summary"] if "Draft summary" in load_workbook(p.draft()).sheetnames \
        else load_workbook(p.draft())["Draft Summary"]
    texts = {str(c.value) for row in ws.iter_rows() for c in row if c.value is not None}
    assert "Pattern groups (weekly template rotations)" in texts
    assert any("pair: 2-week pattern" in t for t in texts)
    assert plan.config_after.pattern_groups["pair"]["period_weeks"] == 2
    assert plan.run_info["pattern_groups"][0]["start_phase"] == ((synth.DEC.start - synth.START).days // 7) % 2


def test_the_checks_and_the_diff_use_the_templates(tmp_path):
    p = pattern_pipeline(tmp_path)
    p.run_to_diff()
    diff = p.diff_json()
    assert diff["blocking"] == []
    flags = json.loads(p.paths.flags.read_text(encoding="utf-8"))["flags"]
    # no weekly-off false alarm for the on-call people
    assert not [f for f in flags if f["kind"] == "HOL_HOL_ON_WEEKLY_OFF" and f["person"] in PAIR]


def test_undetectable_pair_is_asked_and_flagged_not_guessed(tmp_path):
    p = pattern_pipeline(tmp_path, noise=True)
    assert p.prepare() == 0 and p.analyze() == 0
    form = p.form()
    asked = {f["label"] for f in form["fields"] if f["label"] in PAIR}
    assert asked == set(PAIR)
    first = next(f for f in form["fields"] if f["label"] == PAIR[0])
    assert "no weekly pattern" in first["description"] and "KEEP" in first["description"]
    assert first["default"] == "KEEP"
    p.answer()
    assert p.build_draft() == 0
    flags = json.loads(p.paths.flags.read_text(encoding="utf-8"))["flags"]
    not_found = [f for f in flags if f["kind"] == "PATTERN_NOT_DETECTED"]
    assert len(not_found) == 1 and not_found[0]["severity"] == "warning"
    assert not [f for f in flags if f["kind"] == "PATTERN_CONTINUED"]
