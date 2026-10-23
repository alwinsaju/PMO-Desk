import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

import openpyxl


RAW_HEADERS = [
    "Number",
    "Requested for",
    "Opened",
    "Updated",
    "Assigned to",
    "Category",
    "Subcategory",
    "Configuration item",
    "Priority",
    "Short description",
    "State",
    "Assignment group",
    "Duration",
    "Active",
    "On hold reason",
    "Resolution notes",
    "MTTR(Mean Time to Resolve)",
]

OUTPUT_HEADERS = [
    "Number",
    "Requested for",
    "Opened",
    "Updated",
    "Assigned to",
    "Org",
    "Category",
    "Subcategory",
    "Configuration item",
    "Priority",
    "Short description",
    "State",
    "AG2",
    "Assignment group",
    "Duration",
    "Active",
    "On hold reason",
    "Resolution notes",
    "MTTR(Mean Time to Resolve)",
    "Subcategory2",
]

NEEDS_REVIEW = "Needs Review"
SUBCATEGORY_PATTERN = re.compile(r"sub\s*-?\s*category\s*:\s*([^\r\n]+)", re.IGNORECASE)
AGENT_DIR = Path(__file__).resolve().parent.parent
WORKSPACE_DIR = AGENT_DIR.parent
ROSTER_PATH = WORKSPACE_DIR / "shared" / "roster" / "Names.xlsx"

sys.path.insert(0, str(WORKSPACE_DIR / "shared" / "roster"))
from name_matching import match_roster_to_raw  # noqa: E402


@dataclass
class PreparedIncidents:
    headers: list[str]
    rows: list[list[object]]
    review_reasons: dict[str, list[str]]
    subcategory_options: list[str]

    @property
    def review_incident_numbers(self):
        return list(self.review_reasons)


def normalize(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def most_common_map(values):
    return {key: counts.most_common(1)[0][0] for key, counts in values.items() if key and counts}


def add_choice(mapping, key, value):
    if key and value and value != NEEDS_REVIEW:
        mapping[key][value] += 1


def extract_subcategory(resolution_notes):
    match = SUBCATEGORY_PATTERN.search(str(resolution_notes or ""))
    return match.group(1).strip(" .:-") if match else None


def infer_ag2(assignment_group):
    group = normalize(assignment_group)
    rules = [
        (("donorinfosystem", "appsrvc dis"), "DIS"),
        (("appsrvc pdt it dep",), "DEP"),
        (("appsrvc pdt it dps",), "DPS"),
        (("device support",), "Device Support"),
        (("cms",), "CMS 2.0"),
        (("lns",), "LNS 2.0"),
        (("drs",), "DRS"),
        (("lab",), "Lab"),
    ]
    for terms, label in rules:
        if any(term in group for term in terms):
            return label
    return NEEDS_REVIEW

# AG2 is the system an incident is ABOUT, which the Configuration item names more
# reliably than the team queue the ticket is routed to (August 2026 review: 192
# incidents sat in DEP/DIS/CMS 2.0 queues but belonged to DPS/LNS 2.0/DRS/CMS 2.0 by
# CI). Word-boundary matching on the normalized CI - normalize() strips parentheses,
# so "(DPS)" is matched as the word " dps ". Bare " dis "/" dep " words are
# deliberately NOT rules: legacy "PDT - BioLife - DIS - ..." CI names are ambiguous
# there, so they fall through to the maps learned from previous months' workbooks.
CI_AG2_RULES = [
    ((" donor payment system ", " dps "), "DPS"),
    ((" lookback notification system ", " lns "), "LNS 2.0"),
    ((" donor reaction system ", " drs "), "DRS"),
    ((" calibration ", " cms "), "CMS 2.0"),
    ((" donor engagement platform ",), "DEP"),
    (
        (" workstation ", " handheld ", " printer ", " monitor ", " computer ",
         " mobile ", " device ", " peripheral ", " scanner ", " laptop ", " desktop "),
        "Device Support",
    ),
    ((" testing lab ",), "Lab"),
    ((" donor information system ", " cloud native "), "DIS"),
]


def infer_ag2_from_ci(configuration_item):
    text = f" {normalize(configuration_item)} "
    if not text.strip():
        return None
    for terms, label in CI_AG2_RULES:
        if any(term in text for term in terms):
            return label
    return None

# Same real-world category has been typed under multiple spellings across past months'
# workbooks (see reference workbook audit). Canonicalizing here keeps new months consistent
# with the spelling the business has confirmed is correct, rather than whichever spelling
# happens to be more common in the template's history.
SUBCATEGORY_ALIASES = {
    "access issue": "Access Related",
    "password reset": "donor password reset",
    "donor password reset": "donor password reset",
    "donor screening": "Donor Screening Issue",
    "destroy units update": "Destroyed Units Update",
    "destroy unit alert": "Destroyed Units Update",
    "destroy unit update": "Destroyed Units Update",
    "destroyed unit update": "Destroyed Units Update",
    "destroy unit": "Destroyed Units Update",
    "destroyed units update": "Destroyed Units Update",
    "cms 2 0 issue": "CMS 2.0 Issues",
    "cms 2 0 issues": "CMS 2.0 Issues",
    "lns 2 0": "LNS 2.0 Issues",
    "lns 2 0 issues": "LNS 2.0 Issues",
    "information request": "Information Requested",
    "information requested": "Information Requested",
    "boxing issues": "Boxing Issue",
    "boxing issue": "Boxing Issue",
    "edq issues": "EDQ Issue",
    "edq issue": "EDQ Issue",
}


def canonicalize_subcategory(label):
    return SUBCATEGORY_ALIASES.get(normalize(label), label)


# Keyword rules transcribed from reference/monthly trend notes (updated).docx. These only
# apply once an incident's own tag and the template's learned mappings have both failed,
# i.e. for the minority of incidents with no "Sub-Category:" note of their own.
SUBCATEGORY_KEYWORD_RULES = [
    (
        ("advance profile completion reconciliation", "donor reinstatement", "donor account wipe",
         "duplicate pdn", "pii data removal", "email change request"),
        "donor profile update",
    ),
    (
        ("report issue", "lost tube report", "report request", "timestamp request",
         "user guidance", "pin history", "cdcs report"),
        "information requested",
    ),
    (("shipment", "bol", "consignee", "vin", "partnumber"), "Shipment issue"),
    (("questionnaire",), "EDQ issues"),
    (("plasma box",), "Boxing issue"),
    (("labbox report",), "lab boxing issue"),
    (("missed lab import", "missing lab files", "backdate issue"), "db monitoring"),
    (("controls issue",), "CMS 1.0 issues"),
    (("s36 import",), "donor entry issue"),
    (("dreason",), "destroy code"),
    (("lab import report", "lap import", "spe scans", "sts summation"), "lab import issue"),
    (("quarantine",), "quarantine issue"),
    (("change process code", "process code update", "processed code update"), "unit update - processed"),
    (("unlock reaction",), "donor reaction record issue"),
    (("disconnect pin",), "unit update - pins"),
    (("inactive email", "missing takedaid", "not present in okta"), "donor password reset"),
    (("confirmatory report",), "unsuitable test summation report"),
    (
        ("coupon", "delay in process", "card issue", "referral bonus", "gift card",
         "account blocked", "card blocked", "remove card", "update card id",
         "card assignment processing", "update coupon code", "orphan unit payment",
         "audit report", "repeat fee bonus", "pending payment expiration",
         "multiple exclusive offers", "dpe update", "insert pending payment", "onbe issue"),
        "Payment Issue",
    ),
]

STATE_SUBCATEGORY_RULES = {
    "cancelled": "Cancelled",
    "on hold": "WIP",
    "in progress": "WIP",
}
BACKLOG_STATES = frozenset({"In Progress", "On Hold"})
RESOLVED_STATES = frozenset({"Closed", "Resolved", "Cancelled"})

# Normalized keys of the status placeholders. WIP/Cancelled describe where a ticket
# sits, not what it is about, so they may ONLY ever come from the current month's
# State field - never learned from previous months' workbooks (in July "DIS -
# Printer issue" tickets were mostly still open, so the learner mapped that short
# description straight to WIP and stamped it on August's Closed tickets).
PLACEHOLDER_KEYS = {normalize(value) for value in STATE_SUBCATEGORY_RULES.values()}

# Per reference/monthly trend notes (updated).docx, these state labels take precedence
# over every other classification: a Cancelled or still-open incident is a status
# placeholder, not an issue type. The proven July workbook applies this absolutely
# (every In Progress / On Hold row is WIP; effectively every Cancelled row is
# Cancelled), so it is enforced after all learned/extracted/keyword inference below.


def subcategory_from_keywords(short_description, notes):
    haystack = normalize(f"{short_description or ''} {notes or ''}")
    for terms, label in SUBCATEGORY_KEYWORD_RULES:
        if any(normalize(term) in haystack for term in terms):
            return label
    return None


def subcategory_from_state(state):
    return STATE_SUBCATEGORY_RULES.get(normalize(state))


def load_rows(path, sheet_name):
    workbook = openpyxl.load_workbook(path, data_only=True, read_only=False)
    if sheet_name not in workbook.sheetnames:
        raise ValueError(f'{Path(path).name} is missing required sheet "{sheet_name}"')
    sheet = workbook[sheet_name]
    headers = [sheet.cell(1, column).value for column in range(1, sheet.max_column + 1)]
    rows = [
        [sheet.cell(row, column).value for column in range(1, len(headers) + 1)]
        for row in range(2, sheet.max_row + 1)
        if sheet.cell(row, 1).value
    ]
    workbook.close()
    return headers, rows


def load_roster_names(roster_path):
    workbook = openpyxl.load_workbook(roster_path, data_only=True, read_only=False)
    sheet = workbook[workbook.sheetnames[0]]
    headers = [sheet.cell(1, column).value for column in range(1, sheet.max_column + 1)]
    if "Full Name" not in headers:
        raise ValueError(f'{Path(roster_path).name} is missing required column "Full Name"')
    name_column = headers.index("Full Name") + 1
    names = [
        str(sheet.cell(row, name_column).value).strip()
        for row in range(2, sheet.max_row + 1)
        if sheet.cell(row, name_column).value
    ]
    workbook.close()
    return names


@dataclass
class LearnedHistory:
    known_by_number: dict
    ag2_by_group: dict
    ag2_by_ci: dict
    subcategory_by_text: dict
    subcategory_by_short_description: dict
    subcategory_options: list


def learn_from_history(history_paths):
    """Merge classification knowledge from previous monthly workbooks, newest first.

    The task runs monthly; when a new month's export cannot be classified from the
    immediately preceding workbook alone, earlier months' workbooks (July, August,
    September, ... when building October) are the fallback reference - on conflict
    the newest proven value wins. WIP/Cancelled placeholders carry no category
    information, so they are never learned as Subcategory2 values; an incident whose
    newest known label is a placeholder keeps looking backwards, then re-infers.
    """
    known_by_number = {}
    ag2_group_maps = []
    ag2_ci_maps = []
    sub_text_maps = []
    sub_sd_maps = []
    subcategory_options = []
    seen_option_keys = set()

    for path in history_paths:
        template_headers, template_rows = load_rows(path, "Incidents")
        missing_headers = [header for header in OUTPUT_HEADERS if header not in template_headers]
        if missing_headers:
            raise ValueError(f"{Path(path).name} is missing required columns: {', '.join(missing_headers)}")
        template_indexes = {header: template_headers.index(header) for header in OUTPUT_HEADERS}

        ag2_choices = defaultdict(Counter)
        ci_choices = defaultdict(Counter)
        subcategory_choices = defaultdict(Counter)
        short_description_choices = defaultdict(Counter)
        for row in template_rows:
            number = row[template_indexes["Number"]]
            ag2 = row[template_indexes["AG2"]]
            subcategory2 = row[template_indexes["Subcategory2"]]
            is_real_label = (
                bool(subcategory2)
                and subcategory2 != NEEDS_REVIEW
                and normalize(subcategory2) not in PLACEHOLDER_KEYS
            )
            if number not in known_by_number:
                # AG2 from the newest sighting; Subcategory2 from the newest REAL label.
                known_by_number[number] = (ag2, subcategory2 if is_real_label else None)
            elif is_real_label and known_by_number[number][1] is None:
                known_by_number[number] = (known_by_number[number][0], subcategory2)
            add_choice(ag2_choices, normalize(row[template_indexes["Assignment group"]]), ag2)
            add_choice(ci_choices, normalize(row[template_indexes["Configuration item"]]), ag2)
            if not is_real_label:
                continue
            add_choice(subcategory_choices, normalize(subcategory2), subcategory2)
            extracted = extract_subcategory(row[template_indexes["Resolution notes"]])
            if normalize(extracted) not in PLACEHOLDER_KEYS:
                add_choice(subcategory_choices, normalize(extracted), subcategory2)
            add_choice(
                short_description_choices,
                normalize(row[template_indexes["Short description"]]),
                subcategory2,
            )
            key = normalize(subcategory2)
            if key not in seen_option_keys:
                seen_option_keys.add(key)
                subcategory_options.append(subcategory2)

        ag2_group_maps.append(most_common_map(ag2_choices))
        ag2_ci_maps.append(most_common_map(ci_choices))
        sub_text_maps.append(most_common_map(subcategory_choices))
        sub_sd_maps.append(most_common_map(short_description_choices))

    def merge_newest_first(maps):
        merged = {}
        for mapping in maps:
            for key, value in mapping.items():
                merged.setdefault(key, value)
        return merged

    # The dropdown vocabulary offered for manual classification in the review UI:
    # every real Subcategory2 any previous month has proven (deduped
    # case-insensitively, normalize-keyed, newest month's spelling wins), plus the
    # placeholder/keyword labels the trend notes define.
    for label in sorted({*STATE_SUBCATEGORY_RULES.values(), *(label for _, label in SUBCATEGORY_KEYWORD_RULES)}):
        key = normalize(label)
        if key and key not in seen_option_keys:
            seen_option_keys.add(key)
            subcategory_options.append(label)

    return LearnedHistory(
        known_by_number=known_by_number,
        ag2_by_group=merge_newest_first(ag2_group_maps),
        ag2_by_ci=merge_newest_first(ag2_ci_maps),
        subcategory_by_text=merge_newest_first(sub_text_maps),
        subcategory_by_short_description=merge_newest_first(sub_sd_maps),
        subcategory_options=subcategory_options,
    )


def prepare_incidents(raw_path, template_path, roster_path=ROSTER_PATH, history_paths=None):
    raw_headers, raw_rows = load_rows(raw_path, "Page 1")
    missing_headers = [header for header in RAW_HEADERS if header not in raw_headers]
    if missing_headers:
        raise ValueError(f"Raw export is missing required columns: {', '.join(missing_headers)}")

    raw_indexes = {header: raw_headers.index(header) for header in RAW_HEADERS}
    numbers = [row[raw_indexes["Number"]] for row in raw_rows]
    duplicates = sorted(number for number, count in Counter(numbers).items() if count > 1)
    if duplicates:
        raise ValueError(f"Raw export contains duplicate incident number(s): {', '.join(duplicates)}")

    history = learn_from_history(list(history_paths) if history_paths else [template_path])
    known_by_number = history.known_by_number
    ag2_by_group = history.ag2_by_group
    ag2_by_ci = history.ag2_by_ci
    subcategory_by_text = history.subcategory_by_text
    subcategory_by_short_description = history.subcategory_by_short_description
    subcategory_options = history.subcategory_options

    assigned_names = {
        str(row[raw_indexes["Assigned to"]]).strip()
        for row in raw_rows
        if row[raw_indexes["Assigned to"]]
    }
    raw_to_roster, _, _ = match_roster_to_raw(load_roster_names(roster_path), assigned_names)

    prepared_rows = []
    review_reasons = {}
    for raw_row in raw_rows:
        raw = {header: raw_row[index] for header, index in raw_indexes.items()}
        number = raw["Number"]
        assigned_to = str(raw["Assigned to"]).strip() if raw["Assigned to"] else None
        org = "Deloitte" if not assigned_to or assigned_to in raw_to_roster else "Non-Deloitte"
        group_key = normalize(raw["Assignment group"])
        known = known_by_number.get(number)
        if known:
            ag2, subcategory2 = known
            if ag2 == NEEDS_REVIEW:
                ag2 = None
            # A placeholder Subcategory2 from history carries no category meaning for
            # the current month - fall through and re-infer from this month's fields.
        else:
            ag2 = None
            subcategory2 = None

        if not ag2:
            # CI first: it names the system the incident is about; the assignment
            # group is only the queue the ticket is routed to.
            ag2 = (
                infer_ag2_from_ci(raw["Configuration item"])
                or ag2_by_ci.get(normalize(raw["Configuration item"]))
                or ag2_by_group.get(group_key)
                or infer_ag2(raw["Assignment group"])
            )

        if not subcategory2:
            notes = str(raw["Resolution notes"] or "")
            if "task associated with alert" in notes.lower() or group_key == "pdt donorinfosystem us":
                subcategory2 = "Alert"
            else:
                extracted = extract_subcategory(notes)
                subcategory2 = subcategory_by_text.get(normalize(extracted))
                if not subcategory2:
                    subcategory2 = subcategory_by_short_description.get(normalize(raw["Short description"]))
                if not subcategory2:
                    subcategory2 = subcategory_from_keywords(raw["Short description"], notes)

        state_subcategory = subcategory_from_state(raw["State"])
        if state_subcategory:
            subcategory2 = state_subcategory
        elif subcategory2 and normalize(subcategory2) in PLACEHOLDER_KEYS:
            # Defensive: placeholders may only come from the current State above.
            subcategory2 = None

        if subcategory2:
            subcategory2 = canonicalize_subcategory(subcategory2)
        else:
            subcategory2 = NEEDS_REVIEW

        output_row = [
            raw["Number"],
            raw["Requested for"],
            raw["Opened"],
            raw["Updated"],
            raw["Assigned to"],
            org,
            raw["Category"],
            raw["Subcategory"],
            raw["Configuration item"],
            raw["Priority"],
            raw["Short description"],
            raw["State"],
            ag2,
            raw["Assignment group"],
            raw["Duration"],
            raw["Active"],
            raw["On hold reason"],
            raw["Resolution notes"],
            raw["MTTR(Mean Time to Resolve)"],
            subcategory2,
        ]
        prepared_rows.append(output_row)
        reasons = []
        if ag2 == NEEDS_REVIEW:
            reasons.append("AG2 could not be derived from Configuration item or Assignment group")
        if subcategory2 == NEEDS_REVIEW:
            reasons.append("Subcategory2 could not be classified")
        if reasons:
            review_reasons[number] = reasons

    return PreparedIncidents(OUTPUT_HEADERS, prepared_rows, review_reasons, subcategory_options)


def build_review_queue(prepared):
    """The incidents the human must classify, with just the fields the review
    UI needs to decide Subcategory2 — written to output/review-incidents.json
    and served by agent-office's /review-incidents endpoint."""
    index = {header: prepared.headers.index(header) for header in prepared.headers}
    queue = []
    for row in prepared.rows:
        number = row[index["Number"]]
        reasons = prepared.review_reasons.get(number)
        if not reasons:
            continue
        queue.append(
            {
                "number": number,
                "short_description": row[index["Short description"]],
                "resolution_notes": row[index["Resolution notes"]],
                "category": row[index["Category"]],
                "subcategory": row[index["Subcategory"]],
                "state": row[index["State"]],
                "assignment_group": row[index["Assignment group"]],
                "assigned_to": row[index["Assigned to"]],
                "current_subcategory2": row[index["Subcategory2"]],
                "review_reasons": reasons,
            }
        )
    return {"count": len(queue), "options": prepared.subcategory_options, "incidents": queue}


def get_report_month(rows):
    opened_values = [row[2] for row in rows if row and row[0]]
    if not opened_values:
        raise ValueError("Raw export contains no incident rows")
    if not all(isinstance(value, (date, datetime)) for value in opened_values):
        raise ValueError('Every incident must have a valid "Opened" date')
    latest_opened = max(opened_values, key=lambda value: (value.year, value.month))
    return date(latest_opened.year, latest_opened.month, 1)


def write_staging_workbook(prepared, output_path):
    workbook = openpyxl.Workbook()
    incidents = workbook.active
    incidents.title = "Incidents"
    incidents.append(prepared.headers)
    for row in prepared.rows:
        incidents.append(row)

    org = workbook.create_sheet("Org")
    org.append(["Assigned to", "Org"])
    org_by_assignee = {
        row[4]: row[5]
        for row in prepared.rows
        if row[4]
    }
    if any(not row[4] and row[5] for row in prepared.rows):
        org.append([None, prepared.rows[[not row[4] for row in prepared.rows].index(True)][5]])
    for assigned_to in sorted(org_by_assignee, key=str.casefold):
        org.append([assigned_to, org_by_assignee[assigned_to]])

    review = workbook.create_sheet("Review Needed")
    review.append(prepared.headers + ["Review reason"])
    for row in prepared.rows:
        reasons = prepared.review_reasons.get(row[0])
        if reasons:
            review.append(row + ["; ".join(reasons)])

    for sheet in (incidents, review):
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        sheet.column_dimensions["A"].width = 14
        sheet.column_dimensions["K"].width = 45
        sheet.column_dimensions["R"].width = 70
    review.column_dimensions["U"].width = 55
    org.freeze_panes = "A2"
    org.auto_filter.ref = org.dimensions
    org.column_dimensions["A"].width = 32
    org.column_dimensions["B"].width = 16

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(output_path)


def find_latest(folder, pattern):
    candidates = [path for path in Path(folder).glob(pattern) if not path.name.startswith("~$")]
    if not candidates:
        raise FileNotFoundError(f'No file matching "{pattern}" found in {folder}')
    return max(candidates, key=lambda path: path.stat().st_mtime)


def is_valid_template(path):
    try:
        workbook = openpyxl.load_workbook(path, read_only=True)
        valid = "Incidents" in workbook.sheetnames
        if valid:
            headers = next(workbook["Incidents"].iter_rows(min_row=1, max_row=1, values_only=True))
            valid = all(header in headers for header in OUTPUT_HEADERS)
        workbook.close()
        return valid
    except Exception:
        return False


def find_latest_template(folder, pattern):
    # The reference folder holds both the current template and older months kept around for
    # classification research (see reference workbook audit). Several of those share this exact
    # naming pattern, so picking "most recently modified" alone can select a stale, wrong-shaped
    # file - only consider candidates that actually have the Incidents/Org/AG2/Subcategory2 model.
    candidates = [path for path in Path(folder).glob(pattern) if not path.name.startswith("~$")]
    valid_candidates = [path for path in candidates if is_valid_template(path)]
    if not valid_candidates:
        raise FileNotFoundError(
            f'No file matching "{pattern}" in {folder} has the required Incidents/Org/AG2/Subcategory2 columns'
        )
    return max(valid_candidates, key=lambda path: path.stat().st_mtime)


def build_metrics(rows, report_month):
    if not isinstance(report_month, date):
        raise ValueError("Report month must be a date")

    indexes = {header: OUTPUT_HEADERS.index(header) for header in ("Opened", "Org", "State")}
    opened_index = indexes["Opened"]
    org_index = indexes["Org"]
    state_index = indexes["State"]
    opened_values = [row[opened_index] for row in rows]
    if not all(isinstance(value, (date, datetime)) for value in opened_values):
        raise ValueError('Every prepared incident must have a valid "Opened" date')

    state_counts = Counter(str(row[11] or "(blank)") for row in rows)
    intake = sum(
        row[org_index] == "Deloitte"
        and opened.year == report_month.year
        and opened.month == report_month.month
        for row, opened in zip(rows, opened_values)
    )
    resolved = sum(
        row[org_index] == "Deloitte" and row[state_index] in RESOLVED_STATES
        for row in rows
    )
    backlog = sum(
        row[org_index] == "Deloitte" and row[state_index] in BACKLOG_STATES
        for row in rows
    )
    return {
        "intake": intake,
        "closed_or_resolved": resolved,
        "in_progress": state_counts["In Progress"],
        "on_hold": state_counts["On Hold"],
        "backlog": backlog,
        "state_counts": dict(sorted(state_counts.items())),
    }


MONTHLY_WORKBOOK_PATTERN = "Monthly Incidents Trend Analysis - *.xlsx"


def workbook_month(path):
    """The month a monthly analysis workbook reports on: the Trend analysis!A1
    current-month stamp (authoritative), falling back to a 'Month YYYY' file name."""
    try:
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
        try:
            value = None
            if "Trend analysis" in workbook.sheetnames:
                value = next(workbook["Trend analysis"].iter_rows(min_row=1, max_row=1, max_col=1, values_only=True))[0]
        finally:
            workbook.close()
        if isinstance(value, (date, datetime)):
            return date(value.year, value.month, 1)
    except Exception:
        pass
    match = re.search(r"-\s*([A-Za-z]+)\s+(\d{4})\.xlsx$", Path(path).name, re.IGNORECASE)
    if match:
        try:
            return datetime.strptime(f"{match.group(1)} {match.group(2)}", "%B %Y").date().replace(day=1)
        except ValueError:
            return None
    return None


def find_history_workbooks(folders, report_month):
    """All previous monthly workbooks across the given folders, newest month first.

    Classification knowledge accumulates month over month: when the newest template
    can't classify an incident, earlier months often can (and the newest corrected
    month wins any conflict). output/ is preferred over reference/ for the same
    month because it holds the user-reviewed deliverable. The report month's own
    file is excluded so re-running a month stays idempotent.
    """
    seen = []
    for folder_index, folder in enumerate(folders):
        for path in Path(folder).glob(MONTHLY_WORKBOOK_PATTERN):
            if path.name.startswith("~$"):
                continue
            month = workbook_month(path)
            if month is None or month >= report_month:
                continue
            if not is_valid_template(path):
                continue
            seen.append((month, folder_index, path))
    seen.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [path for _, _, path in seen]


def main():
    input_dir = AGENT_DIR / "input"
    reference_dir = AGENT_DIR / "reference"
    output_dir = AGENT_DIR / "output"
    raw_path = find_latest(input_dir, "incident*.xlsx")
    _, raw_rows = load_rows(raw_path, "Page 1")
    report_month = get_report_month(raw_rows)
    history_paths = find_history_workbooks([reference_dir, output_dir], report_month)
    if not history_paths:
        raise FileNotFoundError(
            f'No previous monthly workbook ("{MONTHLY_WORKBOOK_PATTERN}") with a month before '
            f"{report_month.strftime('%B %Y')} found in {reference_dir} or {output_dir}"
        )
    template_path = history_paths[0]

    prepared = prepare_incidents(raw_path, template_path, ROSTER_PATH, history_paths=history_paths)
    staging_path = output_dir / "prepared-incidents.xlsx"
    final_path = output_dir / f"Monthly Incidents Trend Analysis - {report_month.strftime('%B %Y')}.xlsx"
    sidecar_path = output_dir / "report-data.json"
    review_queue_path = output_dir / "review-incidents.json"
    write_staging_workbook(prepared, staging_path)

    sidecar = {
        "raw_path": str(raw_path.resolve()),
        "template_path": str(template_path.resolve()),
        "staging_path": str(staging_path.resolve()),
        "workbook_path": str(final_path.resolve()),
        "report_month": report_month.isoformat(),
        "report_month_display": report_month.strftime("%B %Y"),
        "incident_count": len(prepared.rows),
        "review_count": len(prepared.review_incident_numbers),
        "review_incident_numbers": prepared.review_incident_numbers,
        "metrics": build_metrics(prepared.rows, report_month),
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    sidecar_path.write_text(json.dumps(sidecar, indent=2), encoding="utf-8")
    review_queue_path.write_text(
        json.dumps(build_review_queue(prepared), indent=2, default=str), encoding="utf-8"
    )

    print(f"Raw export: {raw_path}")
    print(f"Reporting month: {sidecar['report_month_display']}")
    print(f"Incidents prepared: {sidecar['incident_count']}")
    print(f"Incidents requiring review: {sidecar['review_count']}")
    print(f"Staging workbook: {staging_path}")
    print(f"Report data: {sidecar_path}")
    print(f"Review queue: {review_queue_path}")


if __name__ == "__main__":
    main()