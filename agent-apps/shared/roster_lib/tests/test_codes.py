from datetime import date, time, timedelta

import pytest

from roster_lib import codes
from roster_lib.codes import (
    DEFAULT_TABLE,
    Kind,
    Lane,
    Pattern,
    UnknownCode,
    counts_as_code,
    default_pattern,
    forced_pattern,
    hours_of,
    is_leave_code,
    is_working_code,
    lane_of,
    lane_of_start,
    parse_code,
    partner_shift,
    resolve_table,
    try_parse_code,
    works_on,
)


@pytest.mark.parametrize("text", [
    "S3", "s3", "S 3", "S-3", " S3 ", "Shift 3", "shift 3", "Shift-3", "SHIFT-3", "shift3",
    "Shift 3 ", "\tShift  3\n", "Shift_3", "s.3", "Shift–3",
])
def test_s3_variants(text):
    p = parse_code(text)
    assert p.canonical == "S3"
    assert p.raw == text  # raw preserved exactly, including whitespace


@pytest.mark.parametrize("text,canonical", [
    ("S1", "S1"), ("Shift 1", "S1"), ("s2", "S2"), ("shift-2", "S2"), ("S4", "S4"),
    ("S5", "S5"), ("shift 5", "S5"),
    ("NS", "NS"), ("ns", "NS"), ("Night Shift", "NS"), ("night-shift", "NS"),
    ("US-CST", "US-CST"), ("us cst", "US-CST"), ("US_CST", "US-CST"), ("uscst", "US-CST"),
    ("US-PST", "US-PST"), ("us pst", "US-PST"), ("US–PST", "US-PST"),
    ("11AM-8PM", "11AM-8PM"), ("11am-8pm", "11AM-8PM"), ("11 AM - 8 PM", "11AM-8PM"),
    ("11am 8pm", "11AM-8PM"),
    ("8am-5pm CST", "MX-8-5"), ("8AM-5PM CST", "MX-8-5"), ("8 am - 5 pm cst", "MX-8-5"),
    ("MX-8-5", "MX-8-5"), ("mx 8 5", "MX-8-5"),
    ("HOL", "HOL"), ("hol", "HOL"), ("Holiday", "HOL"),
    ("P", "P"), ("p", "P"), ("PTO", "P"), ("pto", "P"),
    ("T", "T"), ("t", "T"),
    ("SL", "SL"), ("sl", "SL"), ("Sick Leave", "SL"),
    ("OC", "OC"), ("On-call", "OC"), ("on call", "OC"), ("ON-CALL", "OC"), ("oncall", "OC"),
    ("COMP", "COMP"), ("Comp Off", "COMP"), ("comp-off", "COMP"),
    ("off", "BLANK"), ("WO", "BLANK"), ("Weekly Off", "BLANK"),
])
def test_known_variants(text, canonical):
    assert parse_code(text).canonical == canonical


@pytest.mark.parametrize("text", ["", "   ", None, "\n"])
def test_blank(text):
    p = parse_code(text)
    assert p.canonical == "BLANK"
    assert p.raw == ("" if text is None else text)


@pytest.mark.parametrize("text", [
    "IST 6:00-3:00AM", "6:00-15:00", "10:30 - 19:30 IST", "7am-4pm", "7 AM to 4 PM",
    "9:00 to 6:00", "IST 6:00–3:00AM",
])
def test_custom_time_ranges_kept_verbatim(text):
    p = parse_code(text)
    assert p.canonical == "CUSTOM" and p.is_custom
    assert p.custom == text.strip()
    assert p.raw == text


@pytest.mark.parametrize("text", ["S6", "Shift 9", "XYZ", "hello", "3-4", "S3S4", "---", "??", "12", "US", "Sx3"])
def test_unknown_junk(text):
    with pytest.raises(UnknownCode) as err:
        parse_code(text)
    assert err.value.raw == text
    assert text in str(err.value)
    assert try_parse_code(text) is None


def test_non_string_input_is_stringified():
    with pytest.raises(UnknownCode):
        parse_code(3)


def test_counts_as_code():
    assert counts_as_code("S1") and counts_as_code("Shift 3") and counts_as_code("P")
    assert counts_as_code("IST 6:00-3:00AM") and counts_as_code("OC")
    assert not counts_as_code("") and not counts_as_code(None) and not counts_as_code("  ")
    assert not counts_as_code("garbage")


def test_table_hours():
    expect = {
        "S1": (time(8), time(17)), "S2": (time(8), time(17)),
        "S3": (time(14), time(23)), "S4": (time(14), time(23)),
        "S5": (time(11, 30), time(20, 30)),
        "NS": (time(19), time(4)),
        "US-CST": (time(21), time(6)), "US-PST": (time(23), time(8)),
        "11AM-8PM": (time(11), time(20)),
    }
    for code, hrs in expect.items():
        assert hours_of(code) == hrs
    assert hours_of("MX-8-5") == (time(19, 30), time(4, 30))
    for code in ("HOL", "P", "T", "SL", "COMP", "OC", "BLANK", "CUSTOM", "nope"):
        assert hours_of(code) is None


def test_every_canonical_code_is_in_table_and_aliases_resolve_to_it():
    for code in DEFAULT_TABLE:
        if code in ("BLANK", "CUSTOM"):
            continue
        assert parse_code(code).canonical == code or code == "MX-8-5"
    assert set(codes._ALIASES.values()) <= set(DEFAULT_TABLE)


def test_default_and_forced_patterns():
    assert default_pattern("S1") is Pattern.MON_FRI
    assert default_pattern("S2") is Pattern.WED_SUN
    assert default_pattern("S3") is Pattern.MON_FRI
    assert default_pattern("S4") is Pattern.WED_SUN
    for c in ("S5", "NS", "US-CST", "US-PST", "11AM-8PM", "MX-8-5"):
        assert default_pattern(c) is Pattern.MON_FRI
    for c in ("HOL", "P", "OC", "BLANK", "CUSTOM", "zzz"):
        assert default_pattern(c) is None
    assert forced_pattern("S2") is Pattern.WED_SUN and forced_pattern("S4") is Pattern.WED_SUN
    assert forced_pattern("S1") is None and forced_pattern("NS") is None


def test_works_on_pattern_every_weekday():
    sunday = date(2026, 11, 29)
    assert sunday.weekday() == 6
    names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    mon_fri = {"Mon", "Tue", "Wed", "Thu", "Fri"}
    wed_sun = {"Wed", "Thu", "Fri", "Sat", "Sun"}
    for i, n in enumerate(names):
        d = sunday + timedelta(days=i)
        assert works_on(Pattern.MON_FRI, d) == (n in mon_fri), n
        assert works_on(Pattern.WED_SUN, d) == (n in wed_sun), n
    # 5 working days a week either way
    week = [sunday + timedelta(days=i) for i in range(7)]
    assert sum(works_on(Pattern.MON_FRI, d) for d in week) == 5
    assert sum(works_on(Pattern.WED_SUN, d) for d in week) == 5


def test_working_and_leave_classification():
    for c in ("S1", "S2", "S3", "S4", "S5", "NS", "US-CST", "US-PST", "11AM-8PM", "MX-8-5",
              "CUSTOM", "OC"):
        assert is_working_code(c) and not is_leave_code(c), c
    for c in ("HOL", "P", "T", "SL", "COMP"):
        assert is_leave_code(c) and not is_working_code(c), c
    assert not is_working_code("BLANK") and not is_leave_code("BLANK")
    assert not is_working_code("bogus") and not is_leave_code("bogus")


def test_partner_shift():
    assert partner_shift("S1") == "S2" and partner_shift("S2") == "S1"
    assert partner_shift("S3") == "S4" and partner_shift("S4") == "S3"
    for c in ("S5", "NS", "US-CST", "HOL", "BLANK", "zzz"):
        assert partner_shift(c) is None


def test_lanes():
    assert lane_of("S1") is Lane.MORNING and lane_of("S2") is Lane.MORNING
    assert lane_of("S3") is Lane.EVENING and lane_of("S4") is Lane.EVENING
    assert lane_of("S5") is Lane.MORNING
    assert lane_of("11AM-8PM") is Lane.MORNING
    for c in ("NS", "US-CST", "US-PST", "MX-8-5"):
        assert lane_of(c) is Lane.NIGHT_US, c
    for c in ("HOL", "P", "OC", "BLANK", "CUSTOM"):
        assert lane_of(c) is None


def test_lane_boundaries():
    assert lane_of_start(time(11, 59)) is Lane.MORNING
    assert lane_of_start(time(12, 0)) is Lane.EVENING
    assert lane_of_start(time(18, 0)) is Lane.EVENING
    assert lane_of_start(time(18, 1)) is Lane.NIGHT_US
    assert lane_of_start(time(0, 0)) is Lane.MORNING


def test_timing_key_override_changes_hours_and_lane_only():
    key = {"S3": ("10:00", "19:00"), "NS": (time(13, 0), time(22, 0))}
    assert hours_of("S3", key) == (time(10), time(19))
    assert lane_of("S3", key) is Lane.MORNING
    assert lane_of("NS", key) is Lane.EVENING
    assert hours_of("S1", key) == (time(8), time(17))  # untouched
    # default table is not mutated
    assert hours_of("S3") == (time(14), time(23))
    assert resolve_table(key)["S3"].default_pattern is Pattern.MON_FRI
    assert resolve_table(None) is DEFAULT_TABLE
    assert resolve_table({}) is DEFAULT_TABLE


@pytest.mark.parametrize("bad", [{"HOL": ("08:00", "17:00")}, {"S9": ("08:00", "17:00")},
                                 {"S1": ("8am", "17:00")}, {"S1": ("25:00", "17:00")}])
def test_timing_key_validation(bad):
    with pytest.raises(ValueError):
        resolve_table(bad)
