import copy
import json
from datetime import date
from pathlib import Path

import pytest

from roster_lib import config as cfgmod
from roster_lib.config import (
    ConfigError,
    Person,
    Rotation,
    RotationConfig,
    classify,
    load_config,
    name_key,
    next_shift,
    parse_config,
    save_config,
)

EXAMPLE = Path(cfgmod.__file__).parent / "examples" / "rotation_config.example.json"

BASE = {
    "version": 1,
    "people": [
        {"name": "Person A1", "team": "Operate", "location": "Blr", "rotation": "PERMANENT",
         "shift": "S1"},
    ],
}


def doc(**overrides):
    d = copy.deepcopy(BASE)
    d.update(overrides)
    return d


def problems_of(data):
    with pytest.raises(ConfigError) as err:
        parse_config(data)
    return err.value.problems


def test_example_loads_and_covers_all_categories():
    cfg = load_config(EXAMPLE)
    assert {classify(p) for p in cfg.people} == set(Rotation)
    assert cfg.seed == 12345 and cfg.has_data_threshold == 0.95
    assert cfg.min_staff == {"DIS": 3, "DEP": 3, "L3": 3, "default": 2}
    assert cfg.team_aliases == {"L2": "DIS", "L N S 2.0": "LNS 2.0"}
    assert len(cfg.people) == 7


def test_example_is_canonical_form(tmp_path):
    cfg = load_config(EXAMPLE)
    out = save_config(cfg, tmp_path / "out.json")
    assert out.read_bytes() == EXAMPLE.read_bytes().replace(b"\r\n", b"\n")


def test_example_uses_only_synthetic_names():
    allowed = {"Alice Test", "Bob Sample", "Carol Example", "Dave Demo", "Erin Placeholder",
               "Frank Mock", "Grace Fixture"}
    assert {p.name for p in load_config(EXAMPLE).people} == allowed


def test_defaults_when_optional_keys_absent():
    cfg = parse_config(BASE)
    assert cfg.min_staff == {"DIS": 3, "DEP": 3, "L3": 3, "default": 2}
    assert cfg.team_aliases == {"L2": "DIS"}
    assert cfg.has_data_threshold == 0.95
    assert cfg.seed == 0
    assert cfg.location_codes["Bengaluru"] == "Blr"
    assert cfg.people[0].name == "Person A1"


def test_defaults_are_not_shared_between_instances():
    a, b = parse_config(BASE), parse_config(BASE)
    a.min_staff["default"] = 9
    a.location_codes["X"] = "Xx"
    a.team_aliases["Zed"] = "Z"
    assert b.min_staff["default"] == 2 and "X" not in b.location_codes
    assert "Zed" not in b.team_aliases


def test_classify_and_next_shift():
    people = {
        "perm": Person("A", "T", "Blr", Rotation.PERMANENT, shift="S3"),
        "swap": Person("B", "T", "Blr", Rotation.AUTO_SWAP, shift="S1", partner="S2"),
        "ask": Person("C", "T", "Blr", Rotation.ASK_ME, shift="S1"),
        "unc": Person("D", "T", "Blr", Rotation.UNCLASSIFIED),
    }
    assert classify(people["perm"]) is Rotation.PERMANENT
    assert next_shift(people["perm"]) == "S3"
    assert next_shift(people["swap"]) == "S2"
    assert next_shift(people["ask"]) is None and next_shift(people["unc"]) is None


def test_tolerant_values_are_normalised():
    d = doc(people=[{"name": "  Person   A1 ", "team": " Operate ", "location": "bengaluru",
                     "rotation": "auto_swap", "shift": "Shift 3"}])
    p = parse_config(d).people[0]
    assert p.name == "Person A1" and p.team == "Operate"
    assert p.rotation is Rotation.AUTO_SWAP
    assert p.shift == "S3" and p.partner == "S4"  # partner derived when omitted


def test_location_by_name_or_code_case_insensitive():
    cfg = parse_config(doc(people=[
        {"name": "A", "team": "T", "location": "PUNE", "rotation": "ASK_ME"},
        {"name": "B", "team": "T", "location": "pun", "rotation": "ASK_ME"},
    ]))
    assert [cfg.resolve_location_code(p.location) for p in cfg.people] == ["Pun", "Pun"]
    assert cfg.resolve_location_code("Nowhere") is None


def test_name_key():
    assert name_key("  Alice   TEST ") == name_key("alice test")
    assert name_key("Alice\tTest") == "alice test"
    assert name_key("Alice") != name_key("Alicia")
    assert name_key("Ａlice") == "alice"  # full-width A


def test_find_is_case_and_space_insensitive():
    cfg = load_config(EXAMPLE)
    assert cfg.find("  ALICE   test").name == "Alice Test"
    assert cfg.find("Nobody Here") is None


def test_errors_collected_all_at_once():
    d = doc(
        version=2, seed="x", has_data_threshold=1.5,
        min_staff={"DIS": -1, "L3": "3"},
        people=[
            {"name": "A", "team": "T", "location": "Atlantis", "rotation": "PERMANENT"},
            {"name": "a ", "team": "T", "location": "Blr", "rotation": "NOPE"},
            {"name": "B", "team": "T", "location": "Blr", "rotation": "AUTO_SWAP"},
            {"name": "C", "team": "T", "location": "Blr", "rotation": "AUTO_SWAP", "shift": "S5"},
            {"name": "D", "team": "T", "location": "Blr", "rotation": "AUTO_SWAP",
             "shift": "S1", "partner": "S4"},
            {"name": "E", "team": "T", "location": "Blr", "rotation": "PERMANENT",
             "shift": "S1", "partner": "S2"},
            {"name": "F", "team": "T", "location": "Blr", "rotation": "PERMANENT", "shift": "HOL"},
            {"name": "G", "location": "Blr", "rotation": "PERMANENT", "bogus": 1},
            "not an object",
        ],
        extra=1,
    )
    text = "\n".join(problems_of(d))
    for needle in ("unknown top-level key 'extra'", "version must be 1", "seed must be an integer",
                   "has_data_threshold", "'default'", "min_staff['DIS']", "min_staff['L3']",
                   "unknown location 'Atlantis'", "duplicate name", "rotation must be one of",
                   "AUTO_SWAP needs a shift", "S5 has no partner", "does not match shift S1",
                   "partner is only valid for AUTO_SWAP", "invalid shift 'HOL'",
                   "team is required", "unknown field 'bogus'", "must be an object"):
        assert needle in text, needle


def test_config_error_message_lists_problems():
    with pytest.raises(ConfigError, match="people must be a list"):
        parse_config({"version": 1, "people": "x"})


def test_top_level_must_be_object():
    assert problems_of([]) == ["top level must be a JSON object"]


def test_bad_json_and_missing_file(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    with pytest.raises(ConfigError, match="not valid JSON"):
        load_config(bad)
    with pytest.raises(ConfigError, match="cannot read"):
        load_config(tmp_path / "missing.json")


def test_utf8_bom_tolerated(tmp_path):
    p = tmp_path / "bom.json"
    p.write_bytes(b"\xef\xbb\xbf" + json.dumps(BASE).encode())
    assert load_config(p).people[0].name == "Person A1"


@pytest.mark.parametrize("bad", [0, -0.5, 1.01, True, "0.9", None])
def test_threshold_rejected(bad):
    assert any("has_data_threshold" in p for p in problems_of(doc(has_data_threshold=bad)))


@pytest.mark.parametrize("good", [0.5, 1, 1.0, 0.95])
def test_threshold_accepted(good):
    assert parse_config(doc(has_data_threshold=good)).has_data_threshold == float(good)


def test_bool_not_accepted_as_int():
    assert any("seed" in p for p in problems_of(doc(seed=True)))
    assert any("min_staff" in p for p in problems_of(doc(min_staff={"default": True})))


def test_location_codes_validation():
    assert any("duplicate codes" in p for p in problems_of(
        doc(location_codes={"A": "x", "B": "X"})))
    assert any("location_codes" in p for p in problems_of(doc(location_codes={})))
    cfg = parse_config(doc(location_codes={"Alpha": "Alp"}, people=[
        {"name": "A", "team": "T", "location": "alp", "rotation": "ASK_ME"}]))
    assert cfg.resolve_location_code("Alpha") == "Alp"


def test_min_staff_for():
    cfg = load_config(EXAMPLE)
    assert cfg.min_staff_for("dis") == 3
    assert cfg.min_staff_for("Other") == 2
    assert cfg.min_staff_for(None) == 2
    assert cfg.min_staff_for("default") == 2


def test_min_staff_for_team_uses_aliases_and_defaults():
    cfg = load_config(EXAMPLE)
    # rule: 3 for DIS, DEP and L3; 2 for every other team
    assert [cfg.min_staff_for_team(t) for t in ("DIS", "DEP", "L3")] == [3, 3, 3]
    assert [cfg.min_staff_for_team(t) for t in ("Lab", "Device Support", "CMS 2.0", "EKS",
                                                "LNS 2.0", "Governance", None)] == [2] * 7
    assert cfg.min_staff_for_team("L2") == 3  # section title -> DIS
    assert cfg.min_staff_for_team("  l2 ") == 3
    assert cfg.min_staff_for_team("l n s  2.0") == 2  # alias -> LNS 2.0 -> default


def test_team_of_accepts_sections_and_person_objects():
    from roster_lib.roster_io import Person as RosterPerson
    cfg = load_config(EXAMPLE)
    assert cfg.team_of("L2") == "DIS"
    assert cfg.team_of("l n s 2.0") == "LNS 2.0"
    assert cfg.team_of("  Device   Support ") == "Device Support"  # no alias: own team
    assert cfg.team_of("") is None and cfg.team_of(None) is None
    assert cfg.team_of(RosterPerson("P", "Blr", "L2 DIS USI", "L2", 16)) == "DIS"
    assert cfg.team_of(RosterPerson("P", "Blr", "Lab", "Lab", 70)) == "Lab"
    assert cfg.team_of(Person("A", "Operate", "Blr", Rotation.ASK_ME, subteam="L2")) == "DIS"
    assert cfg.team_of(Person("A", "Operate", "Blr", Rotation.ASK_ME)) == "Operate"


def test_team_aliases_validation_and_replace_semantics():
    cfg = parse_config(doc(team_aliases={"Alpha": "A-team"}))
    assert cfg.team_aliases == {"Alpha": "A-team"}  # replaces the default
    assert cfg.team_of("L2") == "L2" and cfg.team_of("alpha") == "A-team"
    assert any("team_aliases must be" in p for p in problems_of(doc(team_aliases=["x"])))
    assert any("team_aliases must be" in p for p in problems_of(doc(team_aliases={"L2": ""})))
    assert any("team_aliases must be" in p for p in problems_of(doc(team_aliases={"L2": 3})))
    assert any("duplicate sections" in p for p in problems_of(
        doc(team_aliases={"L2": "DIS", " l2": "X"})))
    assert any("duplicate team keys" in p for p in problems_of(
        doc(min_staff={"default": 2, "DIS": 3, "dis": 2})))


def test_team_aliases_saved_deterministically(tmp_path):
    cfg = parse_config(doc(team_aliases={"zeta": "Z", "L2": "DIS", "Alpha": "A"}))
    text = save_config(cfg, tmp_path / "t.json").read_text(encoding="utf-8")
    assert list(json.loads(text)["team_aliases"]) == ["Alpha", "L2", "zeta"]
    assert load_config(tmp_path / "t.json").team_aliases == cfg.team_aliases


def test_add_update_remove_person():
    cfg = parse_config(BASE)
    added = cfg.add_person(Person("  Person  B2 ", "Operate", "Hyd", Rotation.AUTO_SWAP,
                                  shift="S2"))
    assert added.name == "Person B2" and added.partner == "S1"
    assert cfg.find("person b2") is added

    with pytest.raises(ConfigError, match="already exists"):
        cfg.add_person(Person("PERSON b2", "Operate", "Hyd", Rotation.ASK_ME))
    with pytest.raises(ConfigError, match="unknown location"):
        cfg.add_person(Person("Person C3", "Operate", "Mars", Rotation.ASK_ME))
    assert len(cfg.people) == 2  # failed adds changed nothing

    upd = cfg.update_person("person b2", rotation="permanent", shift="S4")
    assert upd.rotation is Rotation.PERMANENT and upd.shift == "S4" and upd.partner is None
    assert cfg.find("Person B2") == upd and len(cfg.people) == 2

    upd = cfg.update_person("Person B2", rotation=Rotation.AUTO_SWAP)
    assert upd.partner == "S3"

    with pytest.raises(ConfigError, match="invalid rotation"):
        cfg.update_person("Person B2", rotation="bogus")
    with pytest.raises(ConfigError, match="unknown person field"):
        cfg.update_person("Person B2", colour="red")
    with pytest.raises(ConfigError, match="unknown person"):
        cfg.update_person("Nobody", team="X")
    with pytest.raises(ConfigError, match="already exists"):
        cfg.update_person("Person B2", name="person a1")
    assert cfg.find("Person B2").rotation is Rotation.AUTO_SWAP  # unchanged by failures

    cfg.update_person("Person B2", name="Person B2 Renamed")
    assert cfg.find("Person B2") is None and cfg.find("person b2 renamed")

    assert cfg.remove_person("Person A1").name == "Person A1"
    with pytest.raises(ConfigError):
        cfg.remove_person("Person A1")


def test_update_to_auto_swap_without_swappable_shift_fails():
    cfg = parse_config(doc(people=[{"name": "A", "team": "T", "location": "Blr",
                                    "rotation": "PERMANENT", "shift": "NS"}]))
    with pytest.raises(ConfigError, match="no partner"):
        cfg.update_person("A", rotation="AUTO_SWAP")


def test_save_is_deterministic_sorted_and_roundtrips(tmp_path):
    cfg = RotationConfig()
    cfg.add_person(Person("zed Last", "Operate", "Pun", Rotation.PERMANENT, shift="NS"))
    cfg.add_person(Person("Bob Sample", "Operate", "Blr", Rotation.ASK_ME, subteam="DIS"))
    cfg.add_person(Person("alice Test", "Operate", "Hyd", Rotation.UNCLASSIFIED))
    a = save_config(cfg, tmp_path / "a.json")
    cfg.people.reverse()
    b = save_config(cfg, tmp_path / "b.json")
    assert a.read_bytes() == b.read_bytes()
    text = a.read_text(encoding="utf-8")
    assert text.endswith("}\n") and "\r" not in text
    names = [p["name"] for p in json.loads(text)["people"]]
    assert names == ["alice Test", "Bob Sample", "zed Last"]  # case-insensitive order
    again = load_config(a)
    assert again.to_dict() == cfg.to_dict()
    keys = list(json.loads(text)["people"][1])
    assert keys == ["name", "team", "subteam", "location", "rotation"]  # fixed key order
    assert list(json.loads(text)["min_staff"])[-1] == "default"


def test_save_refuses_invalid_in_memory_edit(tmp_path):
    cfg = parse_config(BASE)
    cfg.people[0] = Person("Person A1", "Operate", "Atlantis", Rotation.PERMANENT)
    with pytest.raises(ConfigError):
        save_config(cfg, tmp_path / "x.json")
    assert not (tmp_path / "x.json").exists()


def test_non_ascii_names_survive_roundtrip(tmp_path):
    cfg = RotationConfig()
    cfg.add_person(Person("Zoë Tést", "Operate", "Blr", Rotation.ASK_ME))
    path = save_config(cfg, tmp_path / "u.json")
    assert "Zoë" in path.read_text(encoding="utf-8")
    assert load_config(path).people[0].name == "Zoë Tést"


def test_people_by_rotation():
    cfg = load_config(EXAMPLE)
    assert [p.name for p in cfg.people_by_rotation(Rotation.AUTO_SWAP)] == [
        "Bob Sample", "Carol Example"]


# ---- excluded sections, disconnect windows, per-team minimums ------------------------

def test_excluded_defaults_and_example():
    cfg = parse_config(BASE)
    assert cfg.excluded_sections == ["Governance"]
    assert cfg.excluded_section_patterns == ["Leadership", "Governance", "PMO", "Analytics"]
    assert cfg.disconnect_windows == [] and cfg.disconnect_dates() == frozenset()
    ex = load_config(EXAMPLE)
    assert len(ex.disconnect_windows) == 1
    assert len(ex.disconnect_dates()) == 8  # 25 Dec .. 1 Jan inclusive


@pytest.mark.parametrize("section,expected", [
    ("Governance", True), ("  governance ", True), ("Leadership Team", True),
    ("PMO", True), ("Analytics", True), ("Data ANALYTICS ops", True), ("Programme PMO Office", True),
    ("L2", False), ("Device Support", False), ("Lab", False), ("", False),
])
def test_is_excluded_section(section, expected):
    assert parse_config(BASE).is_excluded_section(section) is expected


def test_is_excluded_section_accepts_people_and_aliases():
    from roster_lib.roster_io import Person as RosterPerson
    cfg = parse_config(doc(excluded_sections=["DIS"], excluded_section_patterns=[]))
    assert cfg.is_excluded_section(RosterPerson("P", "Blr", "x", "L2", 16))  # L2 -> DIS (alias)
    assert not cfg.is_excluded_section(RosterPerson("P", "Blr", "x", "Lab", 17))
    assert cfg.is_excluded_section(Person("A", "Operate", "Blr", Rotation.ASK_ME, subteam="L2"))
    assert not cfg.is_excluded_section(Person("A", "Operate", "Blr", Rotation.ASK_ME))


def test_excluded_lists_replace_defaults_and_validate():
    cfg = parse_config(doc(excluded_sections=[], excluded_section_patterns=["Ops"]))
    assert not cfg.is_excluded_section("Governance") and cfg.is_excluded_section("Big OPS")
    assert any("excluded_sections must be" in p for p in problems_of(doc(excluded_sections="x")))
    assert any("excluded_sections must be" in p for p in problems_of(doc(excluded_sections=[""])))
    assert any("duplicate entries" in p for p in problems_of(
        doc(excluded_section_patterns=["PMO", " pmo"])))
    assert any("excluded_section_patterns must be" in p for p in problems_of(
        doc(excluded_section_patterns=[1])))


def test_disconnect_windows_parse_validate_and_save(tmp_path):
    cfg = parse_config(doc(disconnect_windows=[
        {"start": "2027-01-04", "end": "2027-01-05"}, {"start": "2026-12-25", "end": "2026-12-26"}]))
    assert cfg.disconnect_dates() == {date(2026, 12, 25), date(2026, 12, 26),
                                      date(2027, 1, 4), date(2027, 1, 5)}
    saved = json.loads(save_config(cfg, tmp_path / "w.json").read_text(encoding="utf-8"))
    assert saved["disconnect_windows"] == [{"start": "2026-12-25", "end": "2026-12-26"},
                                           {"start": "2027-01-04", "end": "2027-01-05"}]
    assert load_config(tmp_path / "w.json").to_dict() == cfg.to_dict()
    bad = problems_of(doc(disconnect_windows=[
        {"start": "2026-12-27", "end": "2026-12-25"}, {"start": "nope", "end": "2026-12-25"},
        {"start": "2026-12-25"}, "x",
        {"start": "2027-02-01", "end": "2027-02-10"}, {"start": "2027-02-10", "end": "2027-02-12"}]))
    text = "\n".join(bad)
    for needle in ("is before start", "must be ISO dates", "exactly 'start' and 'end'",
                   "must be an object", "overlap"):
        assert needle in text, needle
    assert any("disconnect_windows must be" in p for p in problems_of(
        doc(disconnect_windows="x")))


def test_min_staff_zero_override_means_no_minimum():
    cfg = parse_config(doc(min_staff={"DIS": 0, "Lab": 1, "default": 2}))
    assert cfg.min_staff_for_team("L2") == 0  # alias -> DIS -> 0
    assert cfg.min_staff_for_team("Lab") == 1 and cfg.min_staff_for_team("EKS") == 2
    assert parse_config(doc(min_staff={"default": 0})).min_staff_for_team("anything") == 0
    # defaults when no override is given: 3 for DIS/DEP/L3, 2 otherwise
    assert [parse_config(BASE).min_staff_for_team(t) for t in ("L2", "DEP", "L3", "Lab")] == [
        3, 3, 3, 2]
