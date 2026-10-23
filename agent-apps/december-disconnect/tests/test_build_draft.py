"""build_draft.py: both drafts, the flags, the answers merged into config copies, archive and
stability on a re-run (synthetic data only)."""

import json
from datetime import date

import pytest

from _common import sha256_file
from pipeline import Pipeline
from synth import FUZZY_ROSTER_NAME, FUZZY_STAFF_NAME, WINDOW, WINDOW_TEXT


@pytest.fixture(scope="module")
def drafted(tmp_path_factory):
    p = Pipeline(tmp_path_factory.mktemp("draft") / "t")
    p.inputs_before = {k: sha256_file(getattr(p.paths, k)) for k in
                       ("roster", "staff", "analytics_a", "analytics_b", "winter_config", "analytics_config")}
    p.run_to_draft()
    return p


@pytest.fixture()
def p(tmp_path):
    q = Pipeline(tmp_path / "t")
    q.prepare()
    q.analyze()
    return q


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def plan_cells(p):
    cells = {}
    for name, d, code in load(p.paths.plan)["cells"]:
        cells.setdefault(name, {})[date.fromisoformat(d)] = code
    return cells


def an_plan(p):
    return load(p.paths.analytics_plan)


# ---- what a normal draft contains -----------------------------------------------------------------------

def test_both_drafts_and_the_files_around_them(drafted):
    p = drafted
    out = p.paths.output
    for name in (f"Winter Coverage DRAFT {WINDOW_TEXT}.xlsx",
                 f"Winter Coverage DRAFT {WINDOW_TEXT}.xlsx.snapshot.json",
                 f"Analytics Winter Coverage DRAFT {WINDOW_TEXT}.xlsx",
                 f"Analytics Winter Coverage DRAFT {WINDOW_TEXT}.xlsx.snapshot.json",
                 "plan.json", "analytics-plan.json", "flags.json", "report-data.json", "draft-meta.json",
                 "winter-config.effective.json", "analytics-config.effective.json"):
        assert (out / name).is_file(), name
    meta = load(p.paths.meta)
    assert meta["window"] == WINDOW and meta["counts"] == {"people": 23, "slots": 34}
    assert meta["files"] == {"main": f"output/Winter Coverage DRAFT {WINDOW_TEXT}.xlsx",
                             "analytics": f"output/Analytics Winter Coverage DRAFT {WINDOW_TEXT}.xlsx"}
    assert len(meta["roster_names"]) >= 23 and set(meta["plan_hashes"]) == {"main", "analytics"}


def test_report_data_is_task_relative_and_names_the_analytics_workbook(drafted):
    r = drafted.report()
    assert r["stage"] == "draft"
    assert r["workbook_path"] == f"output/Winter Coverage DRAFT {WINDOW_TEXT}.xlsx"
    s = r["summary"]
    assert s["analytics_workbook_path"] == f"output/Analytics Winter Coverage DRAFT {WINDOW_TEXT}.xlsx"
    assert (s["analytics_slots_filled"], s["analytics_slots_total"]) == (34, 34)
    assert s["people"] == 23 and s["flags"]["error"] == 0 and s["stability"] is False
    assert sum(s["days_histogram"].values()) == 23 and set(s["days_histogram"]) <= {"3", "4", "5"}
    assert s["seed"] == 20261225 and s["mip_gap"] == 0.0 and s["archived_files"] == 0
    for path in (r["workbook_path"], s["analytics_workbook_path"]):
        assert not path.startswith("/") and ":" not in path


def test_flags_json_follows_the_contract(drafted):
    f = drafted.flags()
    assert set(f) == {"counts", "flags"} and f["counts"]["error"] == 0
    assert sum(f["counts"].values()) == len(f["flags"])
    keys = [x["key"] for x in f["flags"]]
    assert len(keys) == len(set(keys)) and all(keys)
    for x in f["flags"]:
        assert {"key", "severity", "kind", "person", "date", "message"} <= set(x)
        assert x["severity"] in ("error", "warning", "info")
        if x["plan"] == "main":
            assert x["kind"].startswith("WINTER_") and x["message"].startswith("[Main] ")
        else:
            assert x["plan"] == "analytics"
            assert x["kind"].startswith("ANALYTICS_") and x["message"].startswith("[Analytics] ")
    kinds = {x["kind"] for x in f["flags"]}
    assert {"WINTER_SHIFT_ASSUMED", "WINTER_NAME_CONFIRMED", "WINTER_STAFF_NOT_ON_SHIFT_ROSTER",
            "ANALYTICS_NOTE", "ANALYTICS_ROSTER_REFRESH"} <= kinds
    # severities are sorted errors first, and each source is tagged for the diff step
    ranks = [{"error": 0, "warning": 1, "info": 2}[x["severity"]] for x in f["flags"]]
    assert ranks == sorted(ranks)
    assert {x["source"] for x in f["flags"]} <= {"audit", "plan", "input"}


def test_a_flag_states_where_the_analytics_draft_is(drafted):
    f = drafted.flags()["flags"]
    note = next(x for x in f if x["kind"] == "ANALYTICS_DRAFT_FILE")
    assert note["severity"] == "info"
    assert f"output/Analytics Winter Coverage DRAFT {WINDOW_TEXT}.xlsx" in note["message"]
    main = next(x for x in f if x["kind"] == "WINTER_DRAFT_FILE")
    assert f"Winter Coverage DRAFT {WINDOW_TEXT}.xlsx" in main["message"]


def test_extra_slot_notes_of_the_analytics_plan_are_info_flags(drafted):
    notes = [x for x in drafted.flags()["flags"] if x["kind"] == "ANALYTICS_NOTE"]
    assert notes and all(x["severity"] == "info" for x in notes)
    assert {x["message"].removeprefix("[Analytics] ") for x in notes} == set(an_plan(drafted)["notes"])


def test_the_plans_meet_the_rules(drafted):
    cells = plan_cells(drafted)
    assert len(cells) == 23
    assert all(3 <= len(days) <= 5 for days in cells.values())
    ap = an_plan(drafted)
    assert ap["status"] in ("optimal", "feasible") and len(ap["assignments"]) == 34
    assert set(ap["on_call"]) == {f"2026-12-{d}" for d in (25, 26, 27, 28, 29, 30, 31)} | {"2027-01-01"}


def test_new_people_get_the_answered_shift_and_the_source_is_recorded(drafted):
    plan = load(drafted.paths.plan)
    hub = [x for x in plan["people"] if x["name"].startswith("Hub")]
    assert len(hub) == 3 and all(x["usual_shift"] == "S1" and x["shift_source"] == "answer" for x in hub)
    # the fuzzy match was confirmed: the plan uses the shift-roster name, remembering the staff spelling
    p = next(x for x in plan["people"] if x["name"] == FUZZY_ROSTER_NAME)
    assert p["staff_name"] == FUZZY_STAFF_NAME and p["shift_source"] == "history"


def test_real_configs_and_inputs_are_never_written(drafted):
    after = {k: sha256_file(getattr(drafted.paths, k)) for k in drafted.inputs_before}
    assert after == drafted.inputs_before
    eff = load(drafted.paths.winter_effective)
    assert eff["default_new_person_shift"] is None
    assert eff["name_aliases"] == {FUZZY_STAFF_NAME: FUZZY_ROSTER_NAME}
    # the Oct/Nov rosters refreshed one usual shift in the effective analytics config only
    cfg = load(drafted.paths.analytics_config)
    ana = load(drafted.paths.analytics_effective)
    diffs = [a["name"] for a, b in zip(cfg["people"], ana["people"]) if a["usual_shift"] != b["usual_shift"]]
    assert diffs == [cfg["people"][0]["name"]]


def test_two_runs_give_the_same_plans_and_flags(tmp_path):
    runs = []
    for name in ("a", "b"):
        q = Pipeline(tmp_path / name)
        q.run_to_draft()
        runs.append(q)
    a, b = runs
    for f in ("plan.json", "analytics-plan.json", "flags.json", "ask-me.json", "winter-config.effective.json",
              "analytics-config.effective.json"):
        assert (a.paths.output / f).read_bytes() == (b.paths.output / f).read_bytes(), f
    ma, mb = load(a.paths.meta), load(b.paths.meta)
    assert ma["plan_hashes"] == mb["plan_hashes"] and ma["roster_names"] == mb["roster_names"]


def test_log_lines_hold_counts_only(tmp_path, capsys):
    q = Pipeline(tmp_path / "t")
    q.run_to_draft()
    out = capsys.readouterr().out
    assert "draft: window" in out and "34 of 34" in out
    for secret in ("Sample", "Hub0", "Tester", "Alpha", "DEP02"):
        assert secret not in out


# ---- the answers change the plans -----------------------------------------------------------------------

def test_main_availability_exception_keeps_a_person_off_the_dates(p, tmp_path):
    base = Pipeline(tmp_path / "base")
    base.run_to_draft()
    cells = plan_cells(base)
    victim = "DIS00 Sample"
    day = next(iter(sorted(cells[victim])))
    p.answer({"avail_person_1": victim, "avail_dates_1": day.isoformat(), "avail_mode_1": "unavailable"})
    assert p.build_draft() == 0
    assert day in plan_cells(base)[victim] and day not in plan_cells(p)[victim]
    assert len(plan_cells(p)[victim]) >= 3
    eff = load(p.paths.winter_effective)
    assert eff["availability"][victim]["unavailable"] == [day.isoformat()]
    exc = [x for x in p.flags()["flags"] if x["kind"] == "WINTER_AVAILABILITY_EXCEPTION"]
    assert len(exc) == 1 and victim in exc[0]["message"]


def test_only_available_exception(p):
    victim = "DIS01 Sample"
    p.answer({"avail_person_2": victim, "avail_dates_2": "2026-12-28..2026-12-31", "avail_mode_2": "only_available"})
    assert p.build_draft() == 0
    days = plan_cells(p)[victim]
    assert 3 <= len(days) <= 4 and all(date(2026, 12, 28) <= d <= date(2026, 12, 31) for d in days)


def test_analytics_availability_exception(p, tmp_path):
    base = Pipeline(tmp_path / "base")
    base.run_to_draft()
    first = an_plan(base)["assignments"][0]
    who, day = first["person"], first["date"]
    p.answer({"aavail_person_1": who, "aavail_dates_1": day, "aavail_mode_1": "unavailable"})
    assert p.build_draft() == 0
    mine = [a for a in an_plan(p)["assignments"] if a["person"] == who and a["date"] == day]
    assert mine == [] and an_plan(p)["on_call"].get(day) != who
    assert len(an_plan(p)["assignments"]) == 34
    eff = load(p.paths.analytics_effective)
    person = next(x for x in eff["people"] if (x.get("short_name") or x["name"]) == who)
    assert day not in person["available"]
    assert [x for x in p.flags()["flags"] if x["kind"] == "ANALYTICS_AVAILABILITY_EXCEPTION"]


def test_skipping_a_name_match_excludes_the_person(p):
    p.answer({f"name:{FUZZY_STAFF_NAME}": "SKIP"})
    assert p.build_draft() == 0
    assert FUZZY_ROSTER_NAME not in plan_cells(p) and FUZZY_STAFF_NAME not in plan_cells(p)
    assert FUZZY_STAFF_NAME in load(p.paths.winter_effective)["exclusions"]["people"]
    skipped = [x for x in p.flags()["flags"] if x["kind"] == "WINTER_NAME_SKIPPED"]
    assert skipped and skipped[0]["severity"] == "warning"


def test_shift_answers_are_used(p):
    p.answer({"shift:Hub01 Sample": "S3"})
    assert p.build_draft() == 0
    people = {x["name"]: x for x in load(p.paths.plan)["people"]}
    assert people["Hub01 Sample"]["usual_shift"] == "S3" and people["Hub00 Sample"]["usual_shift"] == "S1"


# ---- failures -------------------------------------------------------------------------------------------

def test_missing_and_incomplete_answers_are_refused_without_names(p, capsys):
    assert p.build_draft() == 1
    err = capsys.readouterr().err
    assert "answers file is missing" in err and "4 question(s)" in err
    p.write_answers({"shift:Hub00 Sample": "S1"})
    assert p.build_draft() == 1
    err = capsys.readouterr().err
    assert "unanswered (name: 1, shift: 2)" in err
    for secret in ("Hub0", "Sample", "Sampel"):
        assert secret not in err
    p.write_answers({**p.answer(), "stale:Old Person": "x"})
    assert p.build_draft() == 1
    err = capsys.readouterr().err
    assert "not in the form" in err and "Old Person" not in err
    assert not list(p.paths.output.glob("*Coverage DRAFT*"))


def test_an_answer_outside_the_options_is_refused(p, capsys):
    p.answer({"shift:Hub00 Sample": "S9"})
    assert p.build_draft() == 1
    assert "not one of the options (shift: 1)" in capsys.readouterr().err


def test_a_changed_input_is_refused(p, capsys):
    p.answer()
    p.paths.staff.write_bytes(p.paths.staff.read_bytes() + b"x")
    assert p.build_draft() == 1
    assert "the staff roster changed since the analysis" in capsys.readouterr().err
    p.paths.staff.write_bytes(p.paths.staff.read_bytes()[:-1])  # restored
    p.paths.winter_config.write_text(p.paths.winter_config.read_text() + "\n", encoding="utf-8")
    assert p.build_draft() == 1
    assert "the winter config changed" in capsys.readouterr().err


def test_a_blocked_analysis_is_refused(p, capsys):
    a = load(p.paths.analysis)
    a["blocked"], a["blockers"] = True, ["something"]
    p.paths.analysis.write_text(json.dumps(a), encoding="utf-8")
    p.answer()
    assert p.build_draft() == 1
    assert "the analysis is blocked" in capsys.readouterr().err


def test_an_analytics_plan_that_cannot_be_built_stops_the_step(p, capsys):
    p.answer({"aavail_person_1": "Juliet", "aavail_dates_1": "2026-12-28..2026-12-31",
              "aavail_mode_1": "unavailable"})  # the only Mexico person
    assert p.build_draft() == 1
    err = capsys.readouterr().err
    assert "Analytics plan cannot be built" in err and "Juliet" not in err
    assert not list(p.paths.output.glob("*Coverage DRAFT*")) and not p.paths.plan.exists()


def test_bad_date_text_is_refused(p, capsys):
    p.answer({"avail_person_1": "DIS00 Sample", "avail_dates_1": "next tuesday"})
    assert p.build_draft() == 1
    assert "availability row 1" in capsys.readouterr().err


# ---- a re-run: archive and stability ----------------------------------------------------------------------

def test_a_rerun_archives_the_edited_draft_and_keeps_the_plan_stable(tmp_path):
    q = Pipeline(tmp_path / "t")
    q.run_to_draft()
    first_plan = load(q.paths.plan)
    # the PMO edits the draft; the edit must survive in the archive after a re-run
    victim = "DIS00 Sample"
    cells = plan_cells(q)
    day = sorted(cells[victim])[0]
    q.edit_main({(victim, day): ""})
    edited_sha = sha256_file(q.main_draft())
    (q.paths.output / "roster-diff.json").write_text("{}", encoding="utf-8")

    assert q.analyze() == 0 and (q.paths.output / "previous-plan.json").exists()
    q.answer()
    assert q.build_draft() == 0
    archives = sorted(q.paths.archive_dir.iterdir())
    assert len(archives) == 1
    names = {x.name for x in archives[0].iterdir()}
    # (analyze already moved the plans aside as the stability reference and dropped the stale diff:
    # what must survive is the PMO's edited workbooks)
    assert names == {f"Winter Coverage DRAFT {WINDOW_TEXT}.xlsx",
                     f"Winter Coverage DRAFT {WINDOW_TEXT}.xlsx.snapshot.json",
                     f"Analytics Winter Coverage DRAFT {WINDOW_TEXT}.xlsx",
                     f"Analytics Winter Coverage DRAFT {WINDOW_TEXT}.xlsx.snapshot.json"}
    assert sha256_file(archives[0] / f"Winter Coverage DRAFT {WINDOW_TEXT}.xlsx") == edited_sha
    # a fresh draft (no edit) with a stability reference: the same plan, flagged as such
    assert load(q.paths.plan)["cells"] == first_plan["cells"]
    s = q.report()["summary"]
    assert s["stability"] is True and s["archived_files"] == 4
    assert [x for x in q.flags()["flags"] if x["kind"] == "WINTER_STABILITY"]
    # running the step again without analyze archives the second draft too, with its plans and flags
    (q.paths.output / "roster-diff.json").write_text("{}", encoding="utf-8")
    assert q.build_draft() == 0
    archives = sorted(q.paths.archive_dir.iterdir())
    assert len(archives) == 2
    assert {"plan.json", "analytics-plan.json", "roster-diff.json", "flags.json", "draft-meta.json"} <= {
        x.name for x in archives[1].iterdir()}


def test_stability_keeps_unchanged_people_when_one_exception_is_added(tmp_path):
    q = Pipeline(tmp_path / "t")
    q.run_to_draft()
    before = plan_cells(q)
    victim = "DEP03 Sample"
    day = sorted(before[victim])[0]
    q.analyze()
    q.answer({"avail_person_1": victim, "avail_dates_1": day.isoformat()})
    assert q.build_draft() == 0
    after = plan_cells(q)
    assert day not in after[victim]
    changed = sum(1 for n in before if before[n] != after.get(n))
    assert changed <= 3, f"stability: {changed} people changed"
