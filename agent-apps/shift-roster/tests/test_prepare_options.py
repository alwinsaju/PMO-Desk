"""prepare_options.py: the cycle list with availability, reasons and the default."""

import json
from datetime import date, timedelta

import synth
from pipeline import Pipeline
from roster_lib.audit import sha256_file


def options(p: Pipeline) -> dict:
    return json.loads(p.paths.options.read_text(encoding="utf-8"))


def by_id(opts: dict) -> dict:
    return {c["id"]: c for c in opts["cycles"]}


def test_cycle_list_availability_and_default(tmp_path):
    p = Pipeline(tmp_path / "t")
    assert p.prepare() == 0
    opts = options(p)
    assert opts["roster"] == {"first_date": "2026-08-02", "last_date": "2027-01-01",
                              "people": 14, "people_total": 16, "excluded": 2}
    assert [c["id"] for c in opts["cycles"]] == ["2026-08", "2026-10", "2026-12", "2027-02"]
    assert opts["default"] == "2026-12" and opts["problems"] == []
    cycles = by_id(opts)
    assert cycles["2026-12"]["label"] == "Dec 2026 - Jan 2027"
    assert (cycles["2026-12"]["start"], cycles["2026-12"]["end"]) == ("2026-11-29", "2027-01-30")

    # enabled: the previous cycle has data
    assert cycles["2026-12"]["enabled"] and cycles["2026-12"]["coverage"] == 1.0
    assert "weeks of Oct 2026" in cycles["2026-12"]["reason"]
    assert cycles["2026-12"]["filled"] is False and cycles["2026-12"]["crosses_file_end"] is True
    assert cycles["2026-10"]["enabled"] and cycles["2026-10"]["filled"] is True
    assert "already has data" in cycles["2026-10"]["reason"]

    # grayed out, each with its reason
    aug, feb = cycles["2026-08"], cycles["2027-02"]
    assert not aug["enabled"] and "no roster data for the previous cycle (Jun 2026)" in aug["reason"]
    assert not feb["enabled"] and "fewer than 95% of the weeks of Dec 2026" in feb["reason"]
    assert feb["previous"] == "Dec 2026" and feb["filled"] is False
    for c in opts["cycles"]:
        assert c["reason"] and set(c) >= {"id", "label", "start", "end", "enabled", "reason",
                                          "coverage"}


def test_prepare_is_read_only_and_deterministic(tmp_path):
    p = Pipeline(tmp_path / "t")
    before = {f.name: sha256_file(f) for d in (p.paths.input_dir, p.paths.config_dir)
              for f in d.iterdir()}
    assert p.prepare() == 0
    first = p.paths.options.read_bytes()
    assert p.prepare() == 0
    assert p.paths.options.read_bytes() == first
    assert {f.name for f in p.paths.output.iterdir()} == {"options.json"}
    after = {f.name: sha256_file(f) for d in (p.paths.input_dir, p.paths.config_dir)
             for f in d.iterdir()}
    assert before == after


def test_missing_roster_is_reported_not_raised(tmp_path, capsys):
    p = Pipeline(tmp_path / "t")
    p.paths.roster.unlink()
    assert p.prepare() == 0
    opts = options(p)
    assert opts["roster"] is None and opts["cycles"] == [] and opts["default"] is None
    assert [x["severity"] for x in opts["problems"]] == ["error"]
    assert "roster workbook is missing" in opts["problems"][0]["message"]
    assert "Traceback" not in capsys.readouterr().err


def test_unreadable_roster_is_reported(tmp_path):
    p = Pipeline(tmp_path / "t")
    p.paths.roster.write_bytes(b"this is not an xlsx file")
    assert p.prepare() == 0
    opts = options(p)
    assert opts["cycles"] == [] and "cannot be opened" in opts["problems"][0]["message"]


def test_missing_or_invalid_config_disables_every_cycle(tmp_path):
    p = Pipeline(tmp_path / "t")
    p.paths.config.unlink()
    assert p.prepare() == 0
    opts = options(p)
    assert opts["roster"]["people"] == 16  # nothing is excluded without a config
    assert opts["cycles"] and not any(c["enabled"] for c in opts["cycles"])
    assert opts["default"] is None
    assert any("rotation config is missing" in x["message"] for x in opts["problems"])

    p.paths.config.write_text('{"version": 7, "people": []}', encoding="utf-8")
    assert p.prepare() == 0
    opts = options(p)
    assert any("rotation config has problems" in x["message"] for x in opts["problems"])
    cycles = by_id(opts)
    # a cycle with data is still grayed out, and says why
    assert not cycles["2026-12"]["enabled"] and "rotation config" in cycles["2026-12"]["reason"]


def test_bad_or_missing_holiday_roster_disables_every_cycle(tmp_path):
    p = Pipeline(tmp_path / "t")
    p.paths.holidays.write_bytes(b"junk")
    assert p.prepare() == 0
    opts = options(p)
    assert not any(c["enabled"] for c in opts["cycles"])
    assert any("Holiday Roster cannot be used" in x["message"] for x in opts["problems"])
    assert "Holiday Roster" in by_id(opts)["2026-12"]["reason"]

    p.paths.holidays.unlink()
    assert p.prepare() == 0
    assert any("Holiday Roster is missing" in x["message"] for x in options(p)["problems"])


def test_default_falls_back_to_the_latest_enabled_cycle(tmp_path):
    p = Pipeline(tmp_path / "t")
    # one person has no code in a whole Oct week: Dec's previous cycle is no longer complete
    week = {("Person 05", date(2026, 10, 11) + timedelta(days=i)): "" for i in range(7)}
    week.update({("Person 05", date(2026, 10, 18) + timedelta(days=i)): "" for i in range(7)})
    synth.patch_master(p.world, week)
    assert p.prepare() == 0
    opts = options(p)
    cycles = by_id(opts)
    assert not cycles["2026-12"]["enabled"]
    assert "e.g. Person 05" in cycles["2026-12"]["reason"]
    assert cycles["2026-12"]["coverage"] == 0.75
    assert [c["id"] for c in opts["cycles"] if c["enabled"]] == ["2026-10"]
    assert opts["default"] == "2026-10"  # every enabled cycle is filled: the latest one


def test_nothing_selectable_adds_a_warning(tmp_path):
    p = Pipeline(tmp_path / "t")
    synth.blank_cycle(p.world, synth.AUG)
    synth.blank_cycle(p.world, synth.OCT)
    assert p.prepare() == 0
    opts = options(p)
    assert not any(c["enabled"] for c in opts["cycles"]) and opts["default"] is None
    assert any(x["severity"] == "warning" and "no cycle can be selected" in x["message"]
               for x in opts["problems"])


def test_prepare_runs_as_a_subprocess_with_closed_stdin(tmp_path):
    import subprocess
    import sys
    from pathlib import Path

    p = Pipeline(tmp_path / "t")
    script = Path(__file__).resolve().parents[1] / "scripts" / "prepare_options.py"
    done = subprocess.run([sys.executable, str(script), "--task-dir", str(p.root)],
                          stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stderr
    assert options(p)["default"] == "2026-12" and "default 2026-12" in done.stdout
