from datetime import timedelta

import pytest

from roster_lib.codes import Pattern, works_on
from roster_lib.config import Person, Rotation, RotationConfig
from roster_lib.cycles import cycle_for, previous_cycle
from roster_lib.roster_changes import (
    apply_changes,
    ask_me_list,
    detect_changes,
)
from roster_lib.roster_io import Person as RosterPerson
from roster_lib.rotation import InvalidAnswers, MissingAnswers, rotate

AUG = cycle_for(2026, 8)
PREV = previous_cycle(AUG)
MF, WS = Pattern.MON_FRI, Pattern.WED_SUN


def fill(pattern, text):
    cells, d = {}, PREV.start
    while d <= PREV.end:
        cells[d] = text if works_on(pattern, d) else ""
        d += timedelta(days=1)
    return cells


def rp(name, loc="Hyderabad", team="L2 DIS"):
    return RosterPerson(name, loc, team, "L2", 1)


def base_config():
    c = RotationConfig()
    c.add_person(Person("Old Swapper", "Operate", "Blr", Rotation.AUTO_SWAP, "DIS", "S1"))
    c.add_person(Person("Stays Here", "Operate", "Che", Rotation.PERMANENT, "DEP", "S3"))
    c.add_person(Person("Leaves Soon", "Operate", "Pun", Rotation.PERMANENT, "DEP", "S5"))
    c.add_person(Person("Asked Often", "Operate", "Gur", Rotation.ASK_ME, "DIS"))
    c.add_person(Person("Unsorted One", "Operate", "Kol", Rotation.UNCLASSIFIED, None))
    return c


PREV_SCHED = {
    "Old Swapper": fill(MF, "Shift-1"), "Stays Here": fill(MF, "Shift-3"),
    "Leaves Soon": fill(MF, "Shift-5"), "Asked Often": fill(WS, "Shift-2"),
    "Unsorted One": fill(MF, "Shift-1"),
}


def test_detect_new_and_removed():
    roster = [rp("old swapper"), rp("Stays  Here"), rp("Asked Often"), rp("Unsorted One"),
              rp("Brand New")]
    ch = detect_changes(roster, base_config(), PREV_SCHED)
    assert [(n.name, n.in_config) for n in ch.new] == [("Brand New", False)]
    assert [r.name for r in ch.removed] == ["Leaves Soon"]
    assert not ch.is_empty
    assert ch.new[0].location_code == "Hyderabad"


def test_config_person_without_previous_codes_is_new():
    sched = dict(PREV_SCHED)
    sched["Stays Here"] = {d: "" for d in sched["Stays Here"]}
    roster = [rp(n) for n in ("Old Swapper", "Stays Here", "Leaves Soon", "Asked Often",
                              "Unsorted One")]
    ch = detect_changes(roster, base_config(), sched)
    assert [(n.name, n.in_config) for n in ch.new] == [("Stays Here", True)]
    assert ch.removed == []


def test_no_changes():
    roster = [rp(p) for p in PREV_SCHED]
    assert detect_changes(roster, base_config(), PREV_SCHED).is_empty


def test_replacement_inherits_and_new_seat_gets_pool_average():
    roster = [rp(n) for n in ("Old Swapper", "Stays Here", "Asked Often", "Unsorted One")]
    roster += [rp("Heir Apparent", "Pune"), rp("Fresh Face", "Chennai")]
    config = base_config()
    ch = detect_changes(roster, config, PREV_SCHED)
    answers = {
        "heir apparent": {"replaces": "leaves soon"},
        "Fresh Face": {"new_seat": {"rotation": "AUTO_SWAP", "shift": "S4", "team": "Operate",
                                    "subteam": "DIS"}},
    }
    out = apply_changes(config, answers, ch, roster)
    assert config.find("Leaves Soon") is not None  # input config untouched
    assert out.config.find("Leaves Soon") is None  # removed dropped
    heir = out.config.find("Heir Apparent")
    assert (heir.rotation, heir.shift, heir.subteam, heir.team) == (
        Rotation.PERMANENT, "S5", "DEP", "Operate")
    assert heir.location == "Pun"  # from the roster's Loc, not the old person
    fresh = out.config.find("Fresh Face")
    assert (fresh.rotation, fresh.shift, fresh.partner, fresh.location) == (
        Rotation.AUTO_SWAP, "S4", "S3", "Che")
    assert out.inherited_counters == {"Heir Apparent": "Leaves Soon"}
    assert out.replaces == out.inherited_counters
    assert out.pool_average_seats == {"Fresh Face"}
    assert out.rotation_answers == {"Fresh Face": {"shift": "S4", "pattern": "WED_SUN"}}

    # feed straight into the rotation
    res = rotate(PREV_SCHED, out.config, AUG, {**out.rotation_answers,
                                                "Asked Often": {"shift": "KEEP"},
                                                "Unsorted One": {"shift": "KEEP"}},
                 people=roster, replaces=out.replaces)
    heir_row = res.schedule["Heir Apparent"]
    assert {t for t in heir_row.values() if t} == {"Shift-5"}  # the seat continues unchanged
    assert {t for t in res.schedule["Fresh Face"].values() if t} == {"Shift-4"}


def test_unanswered_new_names_raise_missing_answers():
    roster = [rp(p) for p in PREV_SCHED] + [rp("Brand New"), rp("Another New")]
    config = base_config()
    ch = detect_changes(roster, config, PREV_SCHED)
    with pytest.raises(MissingAnswers) as err:
        apply_changes(config, {"Brand New": {"replaces": "x"}}, ch, roster)
    assert err.value.names == ["Another New"]


def test_invalid_answers_reported_together():
    roster = [rp(p) for p in list(PREV_SCHED)[:2]] + [rp("N One"), rp("N Two"), rp("N Three"),
                                                     rp("N Four")]
    config = base_config()
    ch = detect_changes(roster, config, PREV_SCHED)
    answers = {
        "N One": {"replaces": "Stays Here"},  # not a removed person (still in the roster)
        "N Two": {"new_seat": {"rotation": "PERMANENT", "shift": "S2", "pattern": "MON_FRI",
                               "team": "Operate"}},  # S2 is always Wed-Sun
        "N Three": {"new_seat": {"rotation": "PERMANENT", "shift": "S1"}},  # no team
        "N Four": {},
    }
    with pytest.raises(InvalidAnswers) as err:
        apply_changes(config, answers, ch, roster)
    assert len(err.value.problems) == 4


def test_two_new_people_cannot_replace_the_same_person():
    roster = [rp("Old Swapper"), rp("Heir One"), rp("Heir Two")]
    config = base_config()
    ch = detect_changes(roster, config, PREV_SCHED)
    with pytest.raises(InvalidAnswers) as err:
        apply_changes(config, {"Heir One": {"replaces": "Leaves Soon"},
                               "Heir Two": {"replaces": "Leaves Soon"}}, ch, roster)
    assert any("already replaced" in p for p in err.value.problems)


def test_existing_config_person_without_history_gets_updated_not_duplicated():
    sched = dict(PREV_SCHED)
    sched["Stays Here"] = {}
    roster = [rp(n) for n in PREV_SCHED]
    config = base_config()
    ch = detect_changes(roster, config, sched)
    ans = {"Stays Here": {"new_seat": {"rotation": "PERMANENT", "shift": "S1", "team": "Operate",
                                       "location": "Blr"}}}
    out = apply_changes(config, ans, ch, roster)
    assert [p.name for p in out.config.people].count("Stays Here") == 1
    assert out.config.find("Stays Here").shift == "S1"
    assert out.config.find("Stays Here").location == "Blr"


def test_ask_me_list():
    roster = [rp(n) for n in PREV_SCHED] + [rp("Fresh Face")]
    config = base_config()
    config.add_person(Person("Fresh Face", "Operate", "Blr", Rotation.PERMANENT, None, "S1"))
    config.add_person(Person("Nine Swap", "Operate", "Blr", Rotation.AUTO_SWAP, None, "S1"))
    sched = dict(PREV_SCHED)
    sched["Nine Swap"] = fill(MF, "Shift-5")
    roster.append(rp("Nine Swap"))
    items = ask_me_list(config, roster, sched)  # cycle inferred from the dates
    by_name = {i.name: i for i in items}
    assert list(by_name) == ["Asked Often", "Unsorted One", "Fresh Face", "Nine Swap"]
    ao = by_name["Asked Often"]
    assert (ao.current_shift, ao.current_pattern, ao.category, ao.current_text) == (
        "S2", "WED_SUN", "ASK_ME", "Shift-2")
    assert by_name["Unsorted One"].category == "UNCLASSIFIED"
    assert by_name["Fresh Face"].category == "NEW_SEAT"
    assert by_name["Fresh Face"].current_shift is None
    assert by_name["Nine Swap"].category == "AUTO_SWAP" and "no partner" in by_name["Nine Swap"].reason
    # a replacement covered by `replaces` is not asked
    sched2 = dict(sched)
    sched2["Gone"] = fill(MF, "Shift-1")
    items = ask_me_list(config, roster, sched2, AUG, replaces={"Fresh Face": "Gone"})
    assert "Fresh Face" not in [i.name for i in items]


def test_ask_me_list_empty_schedule_errors():
    with pytest.raises(ValueError):
        ask_me_list(base_config(), [], {})
