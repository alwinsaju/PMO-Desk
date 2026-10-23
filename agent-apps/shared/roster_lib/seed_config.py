"""
Seed a rotation config from the roster file and a list of names.

The names live in a GITIGNORED JSON file (this module and its tests contain none):

    {"permanent":   ["Full Name", ["Preferred Name", "Alternative Name"], ...],
     "auto_swap":   [{"shifts": ["S1", "S2"], "names": ["Full Name", ...]},
                     {"shifts": ["S3", "S4"], "names": [...]}],
     "ask_me":      [...],
     "unclassified": [...],                  # optional: same as not listing them
     "not_on_roster": [...],                 # part of the team but not on the roster: never
                                             # reported as unmatched, no config entry
     "confirmed":   {"seed name": "roster name"}}   # optional answers to earlier questions

A list entry may be one name or a list of alternative spellings of the SAME person
(any one that matches exactly is used). Names are matched to the roster with the
PTO matcher (`pto.match_names`): the same words in any order/case match; anything
close but not exact (one word more or fewer, a typo) is NEVER guessed - it goes to
the unmatched report with its candidates, and a `confirmed` entry resolves it on
the next run.

Rules
  - Scope: roster people not in an excluded section (`config.is_excluded_section`).
  - team = `team` argument (default "Operate"), subteam = the person's roster section,
    location = the roster Loc resolved to a config location code; a location that
    does not resolve is reported (the person is left out of the config).
  - rotation = the listed category; anyone in scope who is not listed is UNCLASSIFIED.
  - shift = the shift the person worked in the latest cycle with data
    (`rotation.derive_state`); none when it is custom hours or unknown. For AUTO_SWAP
    people the listed pair is INFORMATIONAL: the rotation derives the partner from the
    OBSERVED shift, so a person observed outside their listed pair stays AUTO_SWAP
    (shift = the observed one; `listed_pair_differs` in the report notes it, no
    conflict). An observed shift with no partner puts them on the ask-me list at run time.

Unmatched names, ambiguous names, `not_on_roster` entries found on the roster and
location problems are written to the report (gitignored); `SeedResult.summary` holds
counts only.

Run (from `agent-apps/shared`):
    ..\\.venv\\Scripts\\python.exe -m roster_lib.seed_config --roster ROSTER.xlsx \\
        --names seed-names.json --config-out rotation-config.json \\
        --unmatched-out seed-unmatched.json [--min-staff-out min-staff-proposal.json]
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Mapping, Sequence

from .checks import is_shift_canonical, schedule_from_roster
from .codes import partner_shift
from .config import Person, Rotation, RotationConfig, name_key, save_config
from .cycle_builder import active_people, headcount_table
from .cycles import Cycle, cycle_containing, previous_cycle
from .pto import match_names
from .roster_io import Person as RosterPerson
from .roster_io import load_roster
from .rotation import derive_state

DEFAULT_TEAM = "Operate"
DEFAULT_SEED = 2026
_MIN_DATA_SHARE = 0.5  # share of people with a derivable shift for a cycle to count as "data"

_CATEGORY_KEYS = (("permanent", Rotation.PERMANENT), ("ask_me", Rotation.ASK_ME),
                  ("unclassified", Rotation.UNCLASSIFIED))


class SeedNamesError(ValueError):
    """The seed-names file is not in the documented shape."""


@dataclass(frozen=True)
class SeedEntry:
    alternatives: tuple[str, ...]  # spellings of one person
    category: Rotation
    pair: tuple[str, str] | None = None  # AUTO_SWAP only


@dataclass
class SeedNames:
    entries: list[SeedEntry]
    confirmed: dict[str, str]
    not_on_roster: list[tuple[str, ...]] = field(default_factory=list)  # alternatives per person


@dataclass
class SeedResult:
    config: RotationConfig
    cycle: Cycle | None  # the latest cycle with data, used for each person's current shift
    report: dict[str, Any]  # unmatched / conflicts / problems (names allowed: gitignored)
    summary: dict[str, Any]  # counts only
    matched: dict[str, str] = field(default_factory=dict)  # roster name -> category


def _alternatives(raw: Any, label: str) -> tuple[str, ...]:
    items = [raw] if isinstance(raw, str) else raw
    if (not isinstance(items, list) or not items
            or not all(isinstance(v, str) and v.strip() for v in items)):
        raise SeedNamesError(f"{label}: each entry must be a name or a non-empty list of names")
    return tuple(" ".join(v.split()) for v in items)


def parse_seed_names(data: Any) -> SeedNames:
    if not isinstance(data, Mapping):
        raise SeedNamesError("the seed-names file must be a JSON object")
    known = {"permanent", "auto_swap", "ask_me", "unclassified", "not_on_roster", "confirmed"}
    extra = sorted(set(data) - known)
    if extra:
        raise SeedNamesError(f"unknown key(s): {', '.join(extra)}")
    entries: list[SeedEntry] = []
    for key, rotation in _CATEGORY_KEYS:
        for i, raw in enumerate(data.get(key) or [], start=1):
            entries.append(SeedEntry(_alternatives(raw, f"{key}[{i}]"), rotation))
    for g, group in enumerate(data.get("auto_swap") or [], start=1):
        shifts = group.get("shifts") if isinstance(group, Mapping) else None
        if (not isinstance(shifts, list) or len(shifts) != 2
                or partner_shift(str(shifts[0])) != str(shifts[1])):
            raise SeedNamesError(f"auto_swap[{g}]: 'shifts' must be a partner pair "
                                 "([\"S1\", \"S2\"] or [\"S3\", \"S4\"])")
        for i, raw in enumerate(group.get("names") or [], start=1):
            entries.append(SeedEntry(_alternatives(raw, f"auto_swap[{g}].names[{i}]"),
                                     Rotation.AUTO_SWAP, (str(shifts[0]), str(shifts[1]))))
    confirmed = data.get("confirmed") or {}
    if not isinstance(confirmed, Mapping) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in confirmed.items()):
        raise SeedNamesError("'confirmed' must map seed names to roster names")
    absent = [_alternatives(raw, f"not_on_roster[{i}]")
              for i, raw in enumerate(data.get("not_on_roster") or [], start=1)]
    return SeedNames(entries, dict(confirmed), absent)


def load_seed_names(path: str | Path) -> SeedNames:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SeedNamesError(f"cannot read {path}: {exc}") from exc
    return parse_seed_names(data)


def latest_cycle_with_data(schedule: Mapping[str, Mapping[date, str]], last_date: date,
                           people: Sequence[str]) -> Cycle | None:
    """The most recent COMPLETE cycle (ending on or before the file's last date) in which at
    least half of `people` have a derivable shift."""
    if not people:
        return None
    cycle = cycle_containing(last_date)
    for _ in range(14):
        have = 0
        if cycle.end <= last_date:
            have = sum(1 for n in people
                       if derive_state({d: t for d, t in schedule.get(n, {}).items()
                                        if cycle.contains(d)}, cycle) is not None)
        if have >= _MIN_DATA_SHARE * len(people):
            return cycle
        cycle = previous_cycle(cycle)
    return None


def _plain(name: str) -> str:
    """Words only: commas and brackets (`Last, First`, `Name (Alias)`) are not part of a name."""
    return " ".join(re.sub(r"[,()]", " ", name).split())


def _match_entry(entry: SeedEntry, roster_names: Sequence[str], confirmed: Mapping[str, str]
                 ) -> tuple[str | None, str, list[dict[str, str]]]:
    """-> (roster name, reason, candidates). The name is None unless exactly one roster
    person matches exactly (same words, any order/case, ignoring commas and brackets) or
    by confirmation."""
    originals: dict[str, list[str]] = {}
    for n in roster_names:
        originals.setdefault(_plain(n), []).append(n)
    plain_roster = list(originals)
    plain_confirmed = {_plain(k): _plain(v) for k, v in confirmed.items()}
    hits: dict[str, str] = {}
    candidates: dict[str, str] = {}
    for alt in entry.alternatives:
        report = match_names([_plain(alt)], plain_roster, plain_confirmed)
        if _plain(alt) in report.exact:
            for original in originals[report.exact[_plain(alt)]]:
                hits[original] = alt
        for cand in report.needs_confirmation.get(_plain(alt), []):
            for original in originals[cand.roster_name]:
                candidates[original] = cand.reason
    if len(hits) == 1:
        return next(iter(hits)), "", []
    if len(hits) > 1:
        return None, "ambiguous: the alternatives match different people", [
            {"roster_name": n, "reason": "exact match"} for n in sorted(hits)]
    if candidates:
        return None, "no exact match; close names exist (add to 'confirmed' to accept)", [
            {"roster_name": n, "reason": r} for n, r in sorted(candidates.items())]
    return None, "no matching person in scope", []


def seed_config(roster, names: SeedNames, *, base: RotationConfig | None = None,
                team: str = DEFAULT_TEAM, seed: int = DEFAULT_SEED,
                cycle: Cycle | None = None) -> SeedResult:
    """Build a config for the roster's in-scope people from the seed names (see docstring)."""
    config = base if base is not None else RotationConfig(seed=seed)
    config.people = []
    active: list[RosterPerson] = active_people(roster.people, config)
    active_names = [p.name for p in active]
    schedule = schedule_from_roster(roster)
    cycle = cycle or latest_cycle_with_data(schedule, roster.last_date, active_names)

    report: dict[str, Any] = {"unmatched": [], "duplicates": [], "listed_pair_differs": [],
                              "not_on_roster_found": [], "location_problems": [],
                              "unclassified_people": []}
    absent = set()
    for alternatives in names.not_on_roster:
        roster_name, _, _ = _match_entry(SeedEntry(alternatives, Rotation.UNCLASSIFIED),
                                         active_names, names.confirmed)
        if roster_name is not None:  # listed as absent but present: reported, not excluded
            report["not_on_roster_found"].append({"seed_name": list(alternatives),
                                                  "roster_name": roster_name})
        else:
            absent.add(alternatives)
    chosen: dict[str, SeedEntry] = {}
    for entry in names.entries:
        roster_name, reason, candidates = _match_entry(entry, active_names, names.confirmed)
        if roster_name is None:
            report["unmatched"].append({"seed_name": list(entry.alternatives),
                                        "category": entry.category.value, "reason": reason,
                                        "candidates": candidates})
        elif roster_name in chosen and chosen[roster_name].category is not entry.category:
            report["duplicates"].append({
                "roster_name": roster_name, "kept": chosen[roster_name].category.value,
                "ignored": entry.category.value,
                "reason": "listed in two categories; the first one is kept"})
        else:
            chosen.setdefault(roster_name, entry)

    matched: dict[str, str] = {}
    for p in active:
        entry = chosen.get(p.name)
        category = entry.category if entry else Rotation.UNCLASSIFIED
        location = config.resolve_location_code(p.location_code or "")
        if location is None:
            report["location_problems"].append({"name": p.name, "location": p.location_code})
            continue
        state = derive_state({d: t for d, t in schedule[p.name].items()
                              if cycle is not None and cycle.contains(d)}, cycle) \
            if cycle is not None else None
        shift = state.code if state is not None and is_shift_canonical(state.code) else None
        if category is Rotation.AUTO_SWAP and (shift is None or shift not in entry.pair):
            report["listed_pair_differs"].append({  # informational: the observed shift rules
                "name": p.name, "listed_pair": list(entry.pair), "current_shift": shift})
        config.add_person(Person(p.name, team, location, category, subteam=p.section,
                                 shift=shift))
        matched[p.name] = category.value
        if category is Rotation.UNCLASSIFIED and entry is None:
            report["unclassified_people"].append(p.name)

    by_category: dict[str, int] = {}
    for value in matched.values():
        by_category[value] = by_category.get(value, 0) + 1
    summary = {
        "roster_people": len(roster.people), "in_scope": len(active),
        "excluded": len(roster.people) - len(active),
        "seeded": len(matched), "by_category": dict(sorted(by_category.items())),
        "seed_names_listed": len(names.entries),
        "unmatched": len(report["unmatched"]),
        "listed_pair_differs": len(report["listed_pair_differs"]),
        "not_on_roster": len(absent), "not_on_roster_found": len(report["not_on_roster_found"]),
        "duplicates": len(report["duplicates"]),
        "location_problems": len(report["location_problems"]),
        "unlisted_unclassified": len(report["unclassified_people"]),
        "latest_cycle": cycle.label if cycle else None,
    }
    return SeedResult(config, cycle, report, summary, matched)


def min_staff_proposal(roster, config: RotationConfig, cycle: Cycle | None) -> dict[str, Any]:
    """Per team: headcount, people per shift in `cycle`, the spec minimum and whether it is
    attainable per shift. Counts only (no names)."""
    if cycle is None:
        return {"cycle": None, "teams": {}}
    schedule = schedule_from_roster(roster)
    table = headcount_table(schedule, active_people(roster.people, config), config, cycle)
    return {"cycle": cycle.label, "teams": table}


def _write_json(path: str | Path, data: Any) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Seed a rotation config from a roster file.")
    ap.add_argument("--roster", required=True)
    ap.add_argument("--sheet", default="PDT Operate")
    ap.add_argument("--names", required=True, help="seed-names JSON (gitignored)")
    ap.add_argument("--config-out", required=True)
    ap.add_argument("--unmatched-out", required=True)
    ap.add_argument("--min-staff-out")
    ap.add_argument("--team", default=DEFAULT_TEAM)
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    args = ap.parse_args(argv)

    roster = load_roster(args.roster, args.sheet)
    result = seed_config(roster, load_seed_names(args.names), team=args.team, seed=args.seed)
    save_config(result.config, args.config_out)
    _write_json(args.unmatched_out, result.report)
    if args.min_staff_out:
        _write_json(args.min_staff_out, min_staff_proposal(roster, result.config, result.cycle))
    print(json.dumps(result.summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
