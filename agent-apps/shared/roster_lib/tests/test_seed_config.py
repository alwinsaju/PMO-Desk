"""Seeding a rotation config from a roster + a names file (synthetic names only)."""

from __future__ import annotations

import json
from datetime import date

import pytest
from cycle_testkit import AUG, DEC, make_roster
from xlsx_fixtures import build_roster_workbook

from roster_lib.checks import schedule_from_roster
from roster_lib.config import Rotation, load_config
from roster_lib.seed_config import (
    SeedNamesError,
    latest_cycle_with_data,
    load_seed_names,
    main,
    min_staff_proposal,
    parse_seed_names,
    seed_config,
)

NAMES = {
    "permanent": [f"Dep Person {i}" for i in range(4)] + ["Lead Three 0", "Lead Three 1"],
    "auto_swap": [
        {"shifts": ["S1", "S2"], "names": [f"Dis Morning {i:02d}" for i in range(1, 7)]},
        {"shifts": ["S3", "S4"], "names": [f"Dis Evening {i:02d}" for i in range(1, 7)]},
    ],
    "ask_me": ["Dis Us"],
}


def rotation_of(result, name):
    return result.config.find(name).rotation


def test_seed_assigns_categories_shifts_teams_and_leaves_the_rest_unclassified():
    roster = make_roster()
    result = seed_config(roster, parse_seed_names(NAMES))
    cfg = result.config
    assert rotation_of(result, "Dep Person 0") is Rotation.PERMANENT
    assert rotation_of(result, "Dis Morning 01") is Rotation.AUTO_SWAP
    assert cfg.find("Dis Morning 01").shift == "S1" and cfg.find("Dis Morning 01").partner == "S2"
    assert cfg.find("Dis Evening 04").shift == "S4"
    assert rotation_of(result, "Dis Us") is Rotation.ASK_ME and cfg.find("Dis Us").shift == "US-CST"
    # not listed: UNCLASSIFIED (Lead Three 2, Lab people, the new hire)
    for name in ("Lead Three 2", "Lab Person 0", "Lab Person 1", "Dis New Hire"):
        assert rotation_of(result, name) is Rotation.UNCLASSIFIED
    assert cfg.find("Dep Person 0").subteam == "DEP" and cfg.find("Dep Person 0").team == "Operate"
    assert cfg.find("Dep Person 0").location == "Blr"
    assert cfg.find("Lab Person 0").location == "Pun"
    assert cfg.team_of(cfg.find("Dis Morning 01")) == "DIS"  # roster section L2 -> DIS
    # excluded sections are not in the config at all
    assert cfg.find("Gov Person 0") is None and cfg.find("Gov Person 1") is None
    assert result.cycle == AUG
    assert cfg.seed == 2026


def test_summary_is_counts_only_and_report_lists_unlisted_people():
    roster = make_roster()
    result = seed_config(roster, parse_seed_names(NAMES))
    s = result.summary
    assert s["roster_people"] == 25 and s["in_scope"] == 23 and s["excluded"] == 2
    assert s["seeded"] == 23 and s["unmatched"] == 0 and s["conflicts"] == 0
    assert s["by_category"] == {"ASK_ME": 1, "AUTO_SWAP": 12, "PERMANENT": 6, "UNCLASSIFIED": 4}
    assert s["latest_cycle"] == "Aug 2026" and s["unlisted_unclassified"] == 4
    assert all(isinstance(v, (int, str, dict, type(None))) for v in s.values())
    names = {p.name for p in roster.people}
    assert not any(isinstance(v, str) and v in names for v in s.values())
    assert set(result.report["unclassified_people"]) == {
        "Lead Three 2", "Lab Person 0", "Lab Person 1", "Dis New Hire"}


def test_inexact_names_are_never_guessed_and_confirmation_resolves_them():
    data = {**NAMES, "permanent": NAMES["permanent"] + ["Lab Person", "Totally Unknown"]}
    roster = make_roster()
    result = seed_config(roster, parse_seed_names(data))
    bad = {tuple(u["seed_name"]): u for u in result.report["unmatched"]}
    assert set(bad) == {("Lab Person",), ("Totally Unknown",)}
    assert [c["roster_name"] for c in bad[("Lab Person",)]["candidates"]] == [
        "Lab Person 0", "Lab Person 1"]  # one word fewer: asked, not accepted
    assert bad[("Totally Unknown",)]["candidates"] == []
    assert result.summary["unmatched"] == 2
    assert rotation_of(result, "Lab Person 0") is Rotation.UNCLASSIFIED
    data["confirmed"] = {"Lab Person": "Lab Person 1"}
    again = seed_config(roster, parse_seed_names(data))
    assert rotation_of(again, "Lab Person 1") is Rotation.PERMANENT
    assert [tuple(u["seed_name"]) for u in again.report["unmatched"]] == [("Totally Unknown",)]


def test_alternative_spellings_and_ambiguity():
    data = {"permanent": [["Nobody Here", "Lab Person 1"], ["Lab Person 0", "Lab Person 1"]]}
    result = seed_config(make_roster(), parse_seed_names(data))
    assert rotation_of(result, "Lab Person 1") is Rotation.PERMANENT  # the one exact alternative
    assert len(result.report["unmatched"]) == 1
    assert "ambiguous" in result.report["unmatched"][0]["reason"]
    assert rotation_of(result, "Lab Person 0") is Rotation.UNCLASSIFIED


def test_auto_swap_outside_its_pair_is_a_conflict_not_a_guess():
    data = {"auto_swap": [{"shifts": ["S3", "S4"], "names": ["Dis Morning 01", "Dis Evening 01"]}]}
    result = seed_config(make_roster(), parse_seed_names(data))
    assert rotation_of(result, "Dis Evening 01") is Rotation.AUTO_SWAP
    assert rotation_of(result, "Dis Morning 01") is Rotation.UNCLASSIFIED  # on S1, not S3/S4
    conflicts = result.report["conflicts"]
    assert [(c["name"], c["current_shift"], c["listed_pair"]) for c in conflicts] == [
        ("Dis Morning 01", "S1", ["S3", "S4"])]


def test_person_listed_in_two_categories_keeps_the_first():
    data = {"permanent": ["Lab Person 0"], "ask_me": ["Lab Person 0"]}
    result = seed_config(make_roster(), parse_seed_names(data))
    assert rotation_of(result, "Lab Person 0") is Rotation.PERMANENT
    assert result.report["duplicates"][0]["ignored"] == "ASK_ME"


def test_unknown_location_is_reported_and_person_left_out():
    roster = make_roster()
    roster.people = tuple(p if p.name != "Lab Person 0" else type(p)(
        p.name, "Atlantis", p.team_label, p.section, p.row) for p in roster.people)
    result = seed_config(roster, parse_seed_names({}))
    assert result.config.find("Lab Person 0") is None
    assert result.report["location_problems"] == [{"name": "Lab Person 0", "location": "Atlantis"}]
    assert result.summary["location_problems"] == 1


def test_latest_cycle_with_data_skips_empty_cycles():
    roster = make_roster()  # only AUG has data; the file runs to 31 Dec 2026
    names = [p.name for p in roster.people if p.section != "Governance"]
    sched = schedule_from_roster(roster)
    assert latest_cycle_with_data(sched, roster.last_date, names) == AUG
    assert latest_cycle_with_data({}, roster.last_date, names) is None
    # a cycle that runs past the end of the file is never "the latest cycle with data"
    partial = make_roster(filled=(AUG, DEC), last_date=date(2027, 1, 1))
    assert latest_cycle_with_data(schedule_from_roster(partial), partial.last_date, names) == AUG
    assert latest_cycle_with_data(sched, roster.last_date, []) is None


def test_min_staff_proposal_counts():
    roster = make_roster()
    result = seed_config(roster, parse_seed_names(NAMES))
    prop = min_staff_proposal(roster, result.config, result.cycle)
    assert prop["cycle"] == "Aug 2026"
    dis = prop["teams"]["DIS"]
    assert dis["headcount"] == 14 and dis["spec_min"] == 3
    assert dis["per_shift"] == {"S1": 3, "S2": 3, "S3": 4, "S4": 3, "US-CST": 1}
    assert dis["attainable"]["S1"] is True and dis["attainable"]["US-CST"] is False
    assert prop["teams"]["Lab"] == {
        "headcount": 2, "per_shift": {"S1": 2}, "no_shift": 0, "spec_min": 2,
        "attainable": {"S1": True}, "lowest_shift_headcount": 2}
    assert min_staff_proposal(roster, result.config, None) == {"cycle": None, "teams": {}}


@pytest.mark.parametrize("bad,needle", [
    ([], "JSON object"), ({"nope": 1}, "unknown key"),
    ({"permanent": [1]}, "permanent[1]"), ({"permanent": [[]]}, "permanent[1]"),
    ({"auto_swap": [{"shifts": ["S1", "S3"], "names": []}]}, "partner pair"),
    ({"auto_swap": [{"names": []}]}, "partner pair"),
    ({"confirmed": {"a": 1}}, "confirmed"),
])
def test_seed_names_validation(bad, needle):
    with pytest.raises(SeedNamesError, match=needle if needle != "permanent[1]" else r"permanent\[1\]"):
        parse_seed_names(bad)


def test_load_seed_names_errors(tmp_path):
    with pytest.raises(SeedNamesError, match="cannot read"):
        load_seed_names(tmp_path / "missing.json")
    p = tmp_path / "n.json"
    p.write_text("{bad", encoding="utf-8")
    with pytest.raises(SeedNamesError, match="cannot read"):
        load_seed_names(p)


def test_command_line_end_to_end(tmp_path, capsys):
    info = build_roster_workbook(tmp_path / "roster.xlsx", days=120, start=date(2026, 6, 1))
    names = tmp_path / "names.json"
    names.write_text(json.dumps({"permanent": ["Person 01"], "ask_me": ["Person 02", "Person 99"]}),
                     encoding="utf-8")
    out = {"config": tmp_path / "out" / "cfg.json", "unmatched": tmp_path / "out" / "un.json",
           "min": tmp_path / "out" / "min.json"}
    code = main(["--roster", str(tmp_path / "roster.xlsx"), "--names", str(names),
                 "--config-out", str(out["config"]), "--unmatched-out", str(out["unmatched"]),
                 "--min-staff-out", str(out["min"]), "--seed", "5"])
    assert code == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary["unmatched"] == 1 and summary["seeded"] > 5
    cfg = load_config(out["config"])
    assert cfg.seed == 5 and cfg.find("Person 01").rotation is Rotation.PERMANENT
    assert cfg.find("Person 02").rotation is Rotation.ASK_ME
    unmatched = json.loads(out["unmatched"].read_text(encoding="utf-8"))
    assert [u["seed_name"] for u in unmatched["unmatched"]] == [["Person 99"]]
    assert json.loads(out["min"].read_text(encoding="utf-8"))["teams"]
    assert info.people  # fixture built


def test_commas_and_brackets_are_not_part_of_a_name():
    roster = make_roster()
    roster.people = tuple(p if p.name != "Lab Person 0" else type(p)(
        "Person, Lab 0", p.location_code, p.team_label, p.section, p.row) for p in roster.people)
    roster._schedule["Person, Lab 0"] = roster._schedule.pop("Lab Person 0")
    data = {"permanent": ["Lab 0 Person", ["Other", "Lab (Person) 0"]]}
    result = seed_config(roster, parse_seed_names(data))
    assert rotation_of(result, "Person, Lab 0") is Rotation.PERMANENT
    assert len(result.report["unmatched"]) == 0
