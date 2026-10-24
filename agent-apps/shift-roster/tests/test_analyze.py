"""analyze.py: the question form and the analysis record."""

import json
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

import synth
from pipeline import Pipeline
from roster_lib.audit import sha256_file


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def fields_by_id(p: Pipeline) -> dict:
    return {f["id"]: f for f in p.form()["fields"]}


def test_form_fields_for_ask_me_new_person_and_pto(tmp_path):
    p = Pipeline(tmp_path / "t")
    assert p.prepare() == 0 and p.analyze() == 0
    form = p.form()
    assert form["title"] == "Questions for cycle 2026-12"
    ids = [f["id"] for f in form["fields"]]
    assert ids == [
        "shift:Person 02", "pattern:Person 02", "shift:Person 04", "pattern:Person 04",
        "new:Person 14", "seat_shift:Person 14", "seat_pattern:Person 14",
        "seat_team:Person 14", "seat_rotation:Person 14", "pto:Persn 07"]
    f = {x["id"]: x for x in form["fields"]}

    # ask-me people: shift is required (default KEEP), the weekly off is optional
    s2 = f["shift:Person 02"]
    assert (s2["group"], s2["type"], s2["required"], s2["default"]) == ("Ask-me", "select", True, "KEEP")
    values = [o["value"] for o in s2["options"]]
    assert values[:3] == ["KEEP", "S1", "S2"]
    assert {"S5", "NS", "US-CST", "US-PST", "11AM-8PM", "MX-8-5"} <= set(values)
    assert s2["description"].startswith("Current: US-CST, Mon-Fri")
    assert "ASK_ME" in s2["description"] and s2["label"] == "Person 02"
    assert f["shift:Person 04"]["description"].startswith("Current: S3, Mon-Fri")
    assert "UNCLASSIFIED" in f["shift:Person 04"]["description"]
    pat = f["pattern:Person 02"]
    assert (pat["required"], pat["default"], pat["label"]) == (False, "AUTO", "Person 02 weekly off")
    assert [o["value"] for o in pat["options"]] == ["AUTO", "MON_FRI", "WED_SUN"]

    # a new person: new seat or one of the leavers, plus optional follow-ups
    new = f["new:Person 14"]
    assert (new["group"], new["required"]) == ("New people", True) and "default" not in new
    assert [(o["value"], o["label"]) for o in new["options"]] == [
        ("new_seat", "New seat"), ("replaces:Gone Person", "Replaces Gone Person")]
    for key in ("seat_shift", "seat_pattern", "seat_team", "seat_rotation"):
        assert f[f"{key}:Person 14"]["required"] is False
        assert "Only used when 'New seat'" in f[f"{key}:Person 14"]["description"]
    assert f["seat_shift:Person 14"]["default"] == "S1"  # most common shift of their section
    assert "KEEP" not in [o["value"] for o in f["seat_shift:Person 14"]["options"]]
    assert f["seat_team:Person 14"]["default"] == "Operate"
    assert f["seat_rotation:Person 14"]["default"] == "UNCLASSIFIED"

    # PTO: the exact name (Person 06) is silent, the near name asks, the stranger is reported
    pto = f["pto:Persn 07"]
    assert (pto["group"], pto["required"]) == ("PTO matches", True)
    options = [o["value"] for o in pto["options"]]
    assert options[-1] == "SKIP" and "Person 07" in options
    assert "1 row(s), 2026-12-16 .. 2026-12-16" in pto["description"]
    assert not any(i.startswith("pto:Person 06") or i.startswith("pto:Nobody") for i in ids)


def test_analysis_record(tmp_path):
    p = Pipeline(tmp_path / "t")
    assert p.prepare() == 0 and p.analyze() == 0
    rec = load(p.paths.analysis)
    assert rec["format"] == "shift-roster-analysis/1" and rec["blocked"] is False
    assert rec["cycle"] == {
        "id": "2026-12", "label": "Dec 2026 - Jan 2027", "short_label": "Dec 2026",
        "first_month": "2026-12-01", "start": "2026-11-29", "end": "2027-01-30",
        "rotation_sunday": "2026-11-29", "previous": "Oct 2026"}
    assert rec["availability"]["enabled"] is True and rec["availability"]["coverage"] == 1.0
    for key, path in (("roster", p.paths.roster), ("holidays", p.paths.holidays),
                      ("pto", p.paths.pto), ("config", p.paths.config)):
        assert rec["inputs"][key]["sha256"] == sha256_file(path)
    assert rec["form_info"]["new_people"] == {
        "Person 14": {"section": "LNS 2.0", "location": "Mexico", "in_config": False}}
    assert rec["form_info"]["removed"] == ["Gone Person"]
    assert rec["form_info"]["shift_people"] == ["Person 02", "Person 04"]
    assert list(rec["form_info"]["pto_names"]) == ["Persn 07"]
    assert rec["pto_unmatched"] == ["Nobody Here"]
    assert rec["analysis"]["year_boundary"]["crosses"] is True
    assert rec["analysis"]["active_people"] == 14
    assert rec["analysis"]["excluded_people"] == ["Person 15", "Person 16"]


def test_analysis_is_deterministic(tmp_path):
    p = Pipeline(tmp_path / "t")
    assert p.prepare() == 0 and p.analyze() == 0
    a, b = p.paths.ask_me.read_bytes(), p.paths.analysis.read_bytes()
    assert p.analyze() == 0
    assert (p.paths.ask_me.read_bytes(), p.paths.analysis.read_bytes()) == (a, b)


def test_nothing_to_ask_gives_a_form_without_required_fields(tmp_path):
    p = Pipeline(tmp_path / "t", pto=False, new_person=False)
    cfg = load(p.paths.config)
    for person in cfg["people"]:
        if person["rotation"] in ("ASK_ME", "UNCLASSIFIED"):
            person["rotation"] = "PERMANENT"
            person["shift"] = "S3"
    cfg["people"] = [x for x in cfg["people"] if x["name"] != synth.LEAVER]  # a leaver needs no answer
    p.paths.config.write_text(json.dumps(cfg), encoding="utf-8")
    assert p.prepare() == 0 and p.analyze() == 0
    assert p.form() == {"title": "Questions for cycle 2026-12", "fields": []}
    assert load(p.paths.analysis)["analysis"]["ready"] is True


def test_person_without_a_shift_in_the_previous_cycle_must_pick_one(tmp_path):
    p = Pipeline(tmp_path / "t")
    # only leave codes last cycle: not "new" (has codes) but no shift to keep
    edits = {}
    d = synth.OCT.start
    while d <= synth.OCT.end:
        edits[("Person 05", d)] = "P"
        d += timedelta(days=1)
    synth.patch_master(p.world, edits)
    assert p.prepare() == 0 and p.analyze() == 0
    f = fields_by_id(p)["shift:Person 05"]
    assert f["required"] is True and "default" not in f
    assert "KEEP" not in [o["value"] for o in f["options"]]
    assert f["description"].startswith("Current: no shift found")


def test_a_new_run_removes_the_files_of_the_previous_one(tmp_path):
    p = Pipeline(tmp_path / "t")
    assert p.prepare() == 0 and p.analyze() == 0
    p.answer()
    for f in (p.paths.plan, p.paths.flags, p.paths.diff, p.paths.report):
        f.write_text("{}", encoding="utf-8")
    old_draft = p.paths.draft("2026-12")
    old_draft.write_bytes(b"a draft the user may still need")
    assert p.analyze() == 0
    assert not any(f.exists() for f in (p.paths.answers, p.paths.plan, p.paths.flags,
                                        p.paths.diff, p.paths.report))
    assert p.paths.options.exists() and p.paths.ask_me.exists()
    assert old_draft.exists()  # a draft is never deleted by the analysis


def test_unavailable_cycle_fails_with_the_reason(tmp_path, capsys):
    p = Pipeline(tmp_path / "t")
    assert p.prepare() == 0
    assert p.analyze("2027-02") == 1
    err = capsys.readouterr().err
    assert err.startswith("ERROR: cycle 2027-02 cannot be built:") and "unavailable" in err
    assert "Traceback" not in err
    rec = load(p.paths.analysis)
    assert rec["blocked"] is True and "Feb 2027 is unavailable" in rec["blockers"][0]
    assert not p.paths.ask_me.exists()  # no stale form from an earlier cycle is left behind


def test_failure_modes_give_one_readable_line(tmp_path, capsys):
    p = Pipeline(tmp_path / "t")
    assert p.prepare() == 0

    assert p.analyze("2026-11") == 1
    assert "is not a cycle first month" in capsys.readouterr().err
    assert p.analyze("december") == 1
    assert "is not a cycle id" in capsys.readouterr().err

    p.paths.run_params.unlink()
    import analyze
    assert analyze.main(task_dir=p.root) == 1
    assert "no cycle was selected" in capsys.readouterr().err

    saved = p.paths.holidays.read_bytes()
    p.paths.holidays.write_bytes(b"junk")
    assert p.analyze() == 1
    err = capsys.readouterr().err
    assert "cannot be built" in err and "uploaded Holiday Roster cannot be used" in err
    p.paths.holidays.write_bytes(saved)

    p.paths.pto.write_bytes(b"junk")
    assert p.analyze() == 1
    assert "PTO import" in capsys.readouterr().err
    p.paths.pto.unlink()

    cfg = p.paths.config.read_bytes()
    p.paths.config.unlink()
    assert p.analyze() == 1
    assert "rotation config is missing" in capsys.readouterr().err
    p.paths.config.write_bytes(cfg)

    p.paths.roster.unlink()
    assert p.analyze() == 1
    assert "roster workbook is missing" in capsys.readouterr().err


def test_analyze_runs_as_a_subprocess_with_closed_stdin(tmp_path):
    p = Pipeline(tmp_path / "t")
    assert p.prepare() == 0
    synth.write_run_params(p.paths, "2026-12")
    script = Path(__file__).resolve().parents[1] / "scripts" / "analyze.py"
    done = subprocess.run([sys.executable, str(script), "--task-dir", str(p.root)],
                          stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stderr
    assert "10 form field(s), 4 required" in done.stdout
    bad = subprocess.run([sys.executable, str(script), "--task-dir", str(tmp_path / "empty")],
                         stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=120)
    assert bad.returncode == 1 and bad.stderr.startswith("ERROR: no cycle was selected")
