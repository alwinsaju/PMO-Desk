import os
from datetime import datetime

import openpyxl

from scripts.prepare_data import (
    OUTPUT_HEADERS,
    PreparedIncidents,
    build_metrics,
    find_history_workbooks,
    find_latest_template,
    get_report_month,
    prepare_incidents,
    write_staging_workbook,
)


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


def write_workbook(path, sheet_name, headers, rows):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = sheet_name
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    workbook.save(path)


def write_roster(path, names):
    write_workbook(path, "Sheet1", ["Full Name", "Email"], [[name, f"{index}@deloitte.com"] for index, name in enumerate(names)])


def raw_row(number, state, short_description, assignment_group, resolution_notes):
    return [
        number,
        "Test User",
        datetime(2026, 7, 1, 8, 0),
        datetime(2026, 7, 31, 20, 0),
        "Known Analyst",
        "Application/Software",
        "Error/Issue",
        "Test configuration item",
        "2 - High",
        short_description,
        state,
        assignment_group,
        120,
        False,
        None,
        resolution_notes,
        120,
    ]


def test_prepare_incidents_preserves_known_labels_and_flags_unknowns(tmp_path):
    raw_path = tmp_path / "incident (20).xlsx"
    template_path = tmp_path / "July.xlsx"
    roster_path = tmp_path / "Names.xlsx"
    unknown_row = raw_row("INC300", "New", "Unrecognized issue", "Unknown-Group", "No classification clues")
    unknown_row[4] = "Unknown Analyst"
    unknown_row[7] = "Mystery unlisted hardware"  # CI unseen in history -> no learned AG2
    alert_row = raw_row(
        "INC200",
        "Closed",
        "server - WUSNAMDISFILV01",
        "PDT-DonorInfoSystem-US",
        "",
    )
    alert_row[4] = None

    write_workbook(
        raw_path,
        "Page 1",
        RAW_HEADERS,
        [
            raw_row("INC100", "Closed", "Updated text", "AppSrvc-DIS-PDT-IT-GLBL", "Updated notes"),
            alert_row,
            unknown_row,
        ],
    )
    write_workbook(
        template_path,
        "Incidents",
        OUTPUT_HEADERS,
        [
            [
                "INC100",
                "Test User",
                datetime(2026, 7, 1, 8, 0),
                datetime(2026, 7, 2, 8, 0),
                "Known Analyst",
                "Deloitte",
                "Application/Software",
                "Error/Issue",
                "Test configuration item",
                "2 - High",
                "Old text",
                "In Progress",
                "DIS",
                "AppSrvc-DIS-PDT-IT-GLBL",
                30,
                True,
                None,
                "Old notes",
                30,
                "Unit Update - Volume",
            ],
            [
                "INC099",
                "Test User",
                datetime(2026, 7, 1, 7, 0),
                datetime(2026, 7, 1, 7, 5),
                None,
                "Deloitte",
                "Application/Software",
                "Error/Issue",
                "Test server",
                "2 - High",
                "server - historical",
                "Closed",
                "DIS",
                "PDT-DonorInfoSystem-US",
                30,
                False,
                None,
                "Closed the task associated with alert: Alert99",
                30,
                "Alert",
            ],
        ],
    )
    write_roster(roster_path, ["Known Analyst"])

    result = prepare_incidents(raw_path, template_path, roster_path)

    assert result.headers == OUTPUT_HEADERS
    assert len(result.rows) == 3
    assert result.rows[0][10] == "Updated text"
    assert result.rows[0][11] == "Closed"
    assert result.rows[0][5] == "Deloitte"
    assert result.rows[0][12] == "DIS"
    assert result.rows[0][19] == "Unit Update - Volume"
    assert result.rows[1][5] == "Deloitte"
    assert result.rows[1][12] == "DIS"
    assert result.rows[1][19] == "Alert"
    assert result.rows[2][5] == "Non-Deloitte"
    assert result.rows[2][12] == "Needs Review"
    assert result.rows[2][19] == "Needs Review"
    assert result.review_incident_numbers == ["INC300"]
    assert result.review_reasons == {
        "INC300": [
            "AG2 could not be derived from Configuration item or Assignment group",
            "Subcategory2 could not be classified",
        ]
    }


def test_prepare_incidents_canonicalizes_known_subcategory_variants(tmp_path):
    raw_path = tmp_path / "incident.xlsx"
    template_path = tmp_path / "July.xlsx"
    roster_path = tmp_path / "Names.xlsx"
    tagged_row = raw_row(
        "INC400", "Resolved", "Login trouble", "AppSrvc-DIS-PDT-IT-GLBL",
        "Sub-Category: Access Issue - resolved after reset",
    )
    write_workbook(raw_path, "Page 1", RAW_HEADERS, [tagged_row])
    write_workbook(
        template_path,
        "Incidents",
        OUTPUT_HEADERS,
        [
            [
                "INC500", "Test User", datetime(2026, 7, 1, 8, 0), datetime(2026, 7, 1, 9, 0),
                "Known Analyst", "Deloitte", "Application/Software", "Error/Issue",
                "Test configuration item", "2 - High", "Login trouble", "Resolved", "DIS",
                "AppSrvc-DIS-PDT-IT-GLBL", 30, True, None,
                "Sub-Category: Access Issue - resolved after reset", 30, "Access Issue",
            ],
        ],
    )
    write_roster(roster_path, ["Known Analyst"])

    result = prepare_incidents(raw_path, template_path, roster_path)

    assert result.rows[0][19] == "Access Related"


def test_prepare_incidents_state_rules_override_other_classifications(tmp_path):
    raw_path = tmp_path / "incident.xlsx"
    template_path = tmp_path / "July.xlsx"
    roster_path = tmp_path / "Names.xlsx"
    shipment_row = raw_row(
        "INC600", "New", "Shipment delayed", "AppSrvc-DIS-PDT-IT-GLBL",
        "Consignee reported missing box, no other notes",
    )
    # State placeholders win over keyword matches, extracted tags, and even a proven
    # template label for the same incident number (trend-notes rule, per July workbook).
    cancelled_row = raw_row(
        "INC700", "Cancelled", "Shipment delayed duplicate", "AppSrvc-DIS-PDT-IT-GLBL",
        "Consignee reported missing box",
    )
    on_hold_row = raw_row(
        "INC800", "On Hold", "Login trouble", "AppSrvc-DIS-PDT-IT-GLBL",
        "Sub-Category: Access Issue - awaiting caller",
    )
    in_progress_known_row = raw_row(
        "INC900", "In Progress", "Volume update", "AppSrvc-DIS-PDT-IT-GLBL", "",
    )
    write_workbook(raw_path, "Page 1", RAW_HEADERS, [shipment_row, cancelled_row, on_hold_row, in_progress_known_row])
    write_workbook(
        template_path,
        "Incidents",
        OUTPUT_HEADERS,
        [
            [
                "INC900", "Test User", datetime(2026, 7, 1, 8, 0), datetime(2026, 7, 1, 9, 0),
                "Known Analyst", "Deloitte", "Application/Software", "Error/Issue",
                "Test configuration item", "2 - High", "Volume update", "Closed", "DIS",
                "AppSrvc-DIS-PDT-IT-GLBL", 30, True, None, "Volume notes", 30, "Unit Update - Volume",
            ],
        ],
    )
    write_roster(roster_path, ["Known Analyst"])

    result = prepare_incidents(raw_path, template_path, roster_path)

    assert result.rows[0][19] == "Shipment issue"
    assert result.rows[1][19] == "Cancelled"
    assert result.rows[2][19] == "WIP"
    assert result.rows[3][19] == "WIP"
    assert result.review_incident_numbers == []


def test_subcategory_options_deduped_case_insensitively(tmp_path):
    raw_path = tmp_path / "incident.xlsx"
    template_path = tmp_path / "July.xlsx"
    roster_path = tmp_path / "Names.xlsx"
    write_workbook(raw_path, "Page 1", RAW_HEADERS, [raw_row("INC100", "New", "x", "AppSrvc-DIS-PDT-IT-GLBL", "")])
    # The same real-world label typed with different casings across history
    # must collapse to a single dropdown option (template spelling wins).
    def template_row(number, sub2):
        return [
            number, "Test User", datetime(2026, 7, 1, 8, 0), datetime(2026, 7, 1, 9, 0),
            "Known Analyst", "Deloitte", "Application/Software", "Error/Issue",
            "Test configuration item", "2 - High", "x", "Closed", "DIS",
            "AppSrvc-DIS-PDT-IT-GLBL", 30, True, None, "notes", 30, sub2,
        ]
    write_workbook(
        template_path,
        "Incidents",
        OUTPUT_HEADERS,
        [
            template_row("INC1", "db monitoring"),
            template_row("INC2", "DB monitoring"),
            template_row("INC3", "DB Monitoring"),
            template_row("INC4", "Access Related"),
        ],
    )
    write_roster(roster_path, ["Known Analyst"])

    result = prepare_incidents(raw_path, template_path, roster_path)

    normalized = [o.lower() for o in result.subcategory_options]
    assert len(normalized) == len(set(normalized)), "options contain a case-insensitive duplicate"
    db_options = [o for o in result.subcategory_options if "monitoring" in o.lower()]
    assert db_options == ["db monitoring"]


def test_prepare_incidents_uses_roster_instead_of_template_org(tmp_path):
    raw_path = tmp_path / "incident.xlsx"
    template_path = tmp_path / "July.xlsx"
    roster_path = tmp_path / "Names.xlsx"
    deloitte_row = raw_row("INC100", "Closed", "Issue", "AppSrvc-DIS-PDT-IT-GLBL", "Notes")
    deloitte_row[4] = "Sharal Priya M"
    external_row = raw_row("INC200", "Closed", "Issue", "AppSrvc-DIS-PDT-IT-GLBL", "Notes")
    external_row[4] = "External Analyst"
    write_workbook(raw_path, "Page 1", RAW_HEADERS, [deloitte_row, external_row])
    write_workbook(
        template_path,
        "Incidents",
        OUTPUT_HEADERS,
        [
            ["INC100", None, None, None, "Sharal Priya M", "Non-Deloitte"] + [None] * 14,
            ["INC200", None, None, None, "External Analyst", "Deloitte"] + [None] * 14,
        ],
    )
    write_roster(roster_path, ["Sharal Priya M"])

    result = prepare_incidents(raw_path, template_path, roster_path)

    assert result.rows[0][5] == "Deloitte"
    assert result.rows[1][5] == "Non-Deloitte"


def test_find_latest_template_skips_wrong_shaped_newer_files(tmp_path):
    old_valid = tmp_path / "Monthly Incidents Trend Analysis - July.xlsx"
    newer_wrong_shape = tmp_path / "Monthly Incidents Trend Analysis - Feb.xlsx"
    write_workbook(old_valid, "Incidents", OUTPUT_HEADERS, [])
    write_workbook(newer_wrong_shape, "Incidents", RAW_HEADERS, [])
    os.utime(old_valid, (1000, 1000))
    os.utime(newer_wrong_shape, (2000, 2000))

    result = find_latest_template(tmp_path, "Monthly Incidents Trend Analysis - *.xlsx")

    assert result == old_valid


def test_prepare_incidents_rejects_duplicate_numbers(tmp_path):
    raw_path = tmp_path / "incident.xlsx"
    template_path = tmp_path / "July.xlsx"
    roster_path = tmp_path / "Names.xlsx"
    duplicate = raw_row("INC100", "Closed", "Issue", "Group", "Notes")
    write_workbook(raw_path, "Page 1", RAW_HEADERS, [duplicate, duplicate])
    write_workbook(template_path, "Incidents", OUTPUT_HEADERS, [])
    write_roster(roster_path, ["Known Analyst"])

    try:
        prepare_incidents(raw_path, template_path, roster_path)
    except ValueError as error:
        assert "duplicate incident number" in str(error).lower()
    else:
        raise AssertionError("Expected duplicate incident numbers to be rejected")


def test_get_report_month_uses_latest_opened_month_for_union_export():
    rows = [
        ["INC100", None, datetime(2026, 6, 30, 23, 59)],
        ["INC200", None, datetime(2026, 7, 1).date()],
        ["INC300", None, datetime(2026, 8, 31, 23, 59)],
    ]

    assert get_report_month(rows) == datetime(2026, 8, 1).date()


def test_build_metrics_scopes_intake_resolved_and_backlog_for_union_export():
    def metric_row(opened, state, org):
        row = [None] * len(OUTPUT_HEADERS)
        row[2] = opened
        row[5] = org
        row[11] = state
        return row

    rows = [
        metric_row(datetime(2026, 8, 1), "Closed", "Deloitte"),
        metric_row(datetime(2026, 8, 31, 23, 59), "On Hold", "Deloitte"),
        metric_row(datetime(2026, 8, 15), "In Progress", "Non-Deloitte"),
        metric_row(datetime(2026, 7, 31), "Resolved", "Deloitte"),
        metric_row(datetime(2026, 7, 30), "In Progress", "Deloitte"),
        metric_row(datetime(2026, 7, 29), "On Hold", "Non-Deloitte"),
        metric_row(datetime(2026, 7, 28), "Cancelled", "Deloitte"),
        metric_row(datetime(2026, 7, 27), "Closed", "Non-Deloitte"),
    ]

    metrics = build_metrics(rows, datetime(2026, 8, 1).date())

    assert metrics["intake"] == 2
    assert metrics["closed_or_resolved"] == 3
    assert metrics["in_progress"] == 2
    assert metrics["on_hold"] == 2
    assert metrics["backlog"] == 2
    assert metrics["state_counts"] == {
        "Cancelled": 1,
        "Closed": 2,
        "In Progress": 2,
        "On Hold": 2,
        "Resolved": 1,
    }


def template_row(number, subcategory2, short_description="x", state="Closed",
                 assignment_group="AppSrvc-DIS-PDT-IT-GLBL",
                 configuration_item="PDT - BioLife Donor Information System (DIS) - Production",
                 resolution_notes="notes", ag2="DIS"):
    return [
        number, "Test User", datetime(2026, 7, 1, 8, 0), datetime(2026, 7, 1, 9, 0),
        "Known Analyst", "Deloitte", "Application/Software", "Error/Issue",
        configuration_item, "2 - High", short_description, state, ag2,
        assignment_group, 30, True, None, resolution_notes, 30, subcategory2,
    ]


def test_ag2_prefers_configuration_item_over_assignment_group(tmp_path):
    raw_path = tmp_path / "incident.xlsx"
    template_path = tmp_path / "July.xlsx"
    roster_path = tmp_path / "Names.xlsx"
    # Same DEP queue, three different systems: the CI names the system the ticket
    # is about, which outranks the routed team (August 2026 review corrections).
    # Short description "x" is learnable from the template so only AG2 is under test.
    dps_ci_row = raw_row("INC100", "Closed", "x", "AppSrvc-PDT-IT-DEP-GLBL", "Notes")
    dps_ci_row[7] = "PDT - BioLife Donor Payment System (DPS) - Production"
    lns_ci_row = raw_row("INC200", "Closed", "x", "AppSrvc-PDT-IT-GLBL", "Notes")
    lns_ci_row[7] = "Lookback Notification System 2.0 - Production"
    blank_ci_row = raw_row("INC300", "Closed", "x", "AppSrvc-PDT-IT-DEP-GLBL", "Notes")
    blank_ci_row[7] = None
    write_workbook(raw_path, "Page 1", RAW_HEADERS, [dps_ci_row, lns_ci_row, blank_ci_row])
    write_workbook(template_path, "Incidents", OUTPUT_HEADERS, [template_row("INC900", "Payment Issue")])
    write_roster(roster_path, ["Known Analyst"])

    result = prepare_incidents(raw_path, template_path, roster_path)

    assert result.rows[0][12] == "DPS"
    assert result.rows[1][12] == "LNS 2.0"
    assert result.rows[2][12] == "DEP"
    assert result.review_incident_numbers == []


def test_placeholder_labels_are_never_learned_from_history(tmp_path):
    raw_path = tmp_path / "incident.xlsx"
    template_path = tmp_path / "July.xlsx"
    roster_path = tmp_path / "Names.xlsx"
    # Last month every "DIS - Printer issue" ticket was still open (WIP). A Closed
    # ticket with that short description this month must NOT inherit the WIP
    # placeholder - it is unclassified and goes to the review queue.
    write_workbook(
        raw_path,
        "Page 1",
        RAW_HEADERS,
        [raw_row("INC100", "Closed", "DIS - Printer issue", "AppSrvc-DIS-PDT-IT-GLBL", "Replaced fuser")],
    )
    write_workbook(
        template_path,
        "Incidents",
        OUTPUT_HEADERS,
        [
            template_row("INC200", "WIP", short_description="DIS - Printer issue", state="On Hold"),
            template_row("INC201", "Cancelled", short_description="DIS - Printer issue", state="Cancelled"),
        ],
    )
    write_roster(roster_path, ["Known Analyst"])

    result = prepare_incidents(raw_path, template_path, roster_path)

    assert result.rows[0][19] == "Needs Review"
    assert result.review_incident_numbers == ["INC100"]
    assert result.review_reasons == {"INC100": ["Subcategory2 could not be classified"]}


def test_known_incident_with_placeholder_history_is_reclassified(tmp_path):
    raw_path = tmp_path / "incident.xlsx"
    template_path = tmp_path / "July.xlsx"
    roster_path = tmp_path / "Names.xlsx"
    # Both incidents were On Hold (WIP) in the previous workbook; now Closed. The
    # first can be re-inferred from its Sub-Category tag, the second has no signal
    # and must go to review rather than keep the stale WIP.
    write_workbook(
        raw_path,
        "Page 1",
        RAW_HEADERS,
        [
            raw_row("INC100", "Closed", "x", "AppSrvc-DIS-PDT-IT-GLBL", "Sub-Category: Access Issue - done"),
            raw_row("INC200", "Resolved", "Unseen description", "AppSrvc-DIS-PDT-IT-GLBL", "No clues here"),
        ],
    )
    write_workbook(
        template_path,
        "Incidents",
        OUTPUT_HEADERS,
        [
            template_row("INC100", "WIP", state="On Hold"),
            template_row("INC200", "WIP", state="On Hold"),
            template_row("INC300", "Access Related", resolution_notes="Sub-Category: Access Issue - reset"),
        ],
    )
    write_roster(roster_path, ["Known Analyst"])

    result = prepare_incidents(raw_path, template_path, roster_path)

    assert result.rows[0][19] == "Access Related"
    assert result.rows[0][12] == "DIS"
    assert result.rows[1][19] == "Needs Review"
    assert result.review_incident_numbers == ["INC200"]


def test_history_lookback_uses_all_previous_months_newest_wins(tmp_path):
    raw_path = tmp_path / "incident.xlsx"
    older_path = tmp_path / "July.xlsx"
    newer_path = tmp_path / "August.xlsx"
    roster_path = tmp_path / "Names.xlsx"
    # "Login trouble" was reclassified between July and August; the newest month
    # wins. INC700 was Closed (real label) in July, reopened (WIP) in August: the
    # placeholder is skipped and July's real label answers.
    write_workbook(
        raw_path,
        "Page 1",
        RAW_HEADERS,
        [
            raw_row("INC100", "Closed", "Login trouble", "AppSrvc-DIS-PDT-IT-GLBL", "No tag"),
            raw_row("INC700", "Closed", "Unique text", "AppSrvc-DIS-PDT-IT-GLBL", "No tag"),
        ],
    )
    write_workbook(
        older_path,
        "Incidents",
        OUTPUT_HEADERS,
        [
            template_row("INC700", "Hardware Issue", state="Closed"),
            template_row("INC800", "Access Related", short_description="Login trouble"),
        ],
    )
    write_workbook(
        newer_path,
        "Incidents",
        OUTPUT_HEADERS,
        [
            template_row("INC700", "WIP", state="In Progress"),
            template_row("INC900", "Application Issue", short_description="Login trouble"),
        ],
    )
    write_roster(roster_path, ["Known Analyst"])

    result = prepare_incidents(raw_path, newer_path, roster_path, history_paths=[newer_path, older_path])

    assert result.rows[0][19] == "Application Issue"
    assert result.rows[1][19] == "Hardware Issue"
    assert "Access Related" in result.subcategory_options
    assert "Application Issue" in result.subcategory_options


def test_history_examples_for_the_ai_are_real_labels_deduplicated_newest_first(tmp_path):
    raw_path = tmp_path / "incident.xlsx"
    older_path = tmp_path / "July.xlsx"
    newer_path = tmp_path / "August.xlsx"
    roster_path = tmp_path / "Names.xlsx"
    write_workbook(raw_path, "Page 1", RAW_HEADERS, [raw_row("INC1", "Closed", "x", "AppSrvc-DIS-PDT-IT-GLBL", "n")])
    write_workbook(
        older_path,
        "Incidents",
        OUTPUT_HEADERS,
        [
            template_row("INC800", "Access Related", short_description="Login trouble", resolution_notes="old note"),
            template_row("INC801", "WIP", short_description="Still open", state="On Hold"),
        ],
    )
    write_workbook(
        newer_path,
        "Incidents",
        OUTPUT_HEADERS,
        [
            template_row("INC900", "Access Related", short_description="login  TROUBLE", resolution_notes="new note"),
            template_row("INC901", "Access Related", short_description="Login trouble", resolution_notes="newer still"),
        ],
    )
    write_roster(roster_path, ["Known Analyst"])

    result = prepare_incidents(raw_path, newer_path, roster_path, history_paths=[newer_path, older_path])

    assert len(result.examples) == 1  # WIP is not an example; same text + label collapses
    only = result.examples[0]
    assert only["label"] == "Access Related" and only["n"] == 3
    assert only["notes"] == "new note"  # the newest month's wording is kept


def test_spelling_variants_of_one_category_are_listed_once_and_typos_resolve(tmp_path):
    raw_path = tmp_path / "incident.xlsx"
    template_path = tmp_path / "July.xlsx"
    roster_path = tmp_path / "Names.xlsx"
    write_workbook(
        raw_path,
        "Page 1",
        RAW_HEADERS,
        [raw_row("INC100", "Closed", "Unseen", "AppSrvc-DIS-PDT-IT-GLBL", "Sub-Category: soft good isse")],
    )
    write_workbook(
        template_path,
        "Incidents",
        OUTPUT_HEADERS,
        [
            template_row("INC1", "Soft Goods Issue"),
            template_row("INC2", "Soft Goods Issue"),
            template_row("INC3", "softgoods issue"),
            template_row("INC4", "softgood issue"),
            template_row("INC5", "Hardware Issue"),
            template_row("INC6", "CMS 1.0 issues"),
            template_row("INC7", "CMS 2.0 Issues"),
        ],
    )
    write_roster(roster_path, ["Known Analyst"])

    result = prepare_incidents(raw_path, template_path, roster_path)

    soft = [o for o in result.subcategory_options if "soft" in o.lower()]
    assert soft == ["Soft Goods Issue"]
    assert {"CMS 1.0 issues", "CMS 2.0 Issues"} <= set(result.subcategory_options)  # different digits stay apart
    assert result.rows[0][19] == "Soft Goods Issue"  # the typo'd tag still finds its category
    assert result.canonicalize("softgood  issues") == "Soft Goods Issue"


def test_find_history_workbooks_orders_newest_first_and_skips_current_month(tmp_path):
    reference_dir = tmp_path / "reference"
    output_dir = tmp_path / "output"
    reference_dir.mkdir()
    output_dir.mkdir()

    def monthly_workbook(path, month, valid=True):
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.title = "Incidents"
        sheet.append(OUTPUT_HEADERS if valid else RAW_HEADERS)
        trend = workbook.create_sheet("Trend analysis")
        trend["A1"] = month
        workbook.save(path)

    july = reference_dir / "Monthly Incidents Trend Analysis - July 2026.xlsx"
    august = output_dir / "Monthly Incidents Trend Analysis - August 2026.xlsx"
    august_ref = reference_dir / "Monthly Incidents Trend Analysis - August 2026.xlsx"
    invalid = reference_dir / "Monthly Incidents Trend Analysis - June 2026.xlsx"
    monthly_workbook(july, datetime(2026, 7, 1))
    monthly_workbook(august, datetime(2026, 8, 1))
    monthly_workbook(august_ref, datetime(2026, 8, 1))
    monthly_workbook(invalid, datetime(2026, 6, 1), valid=False)

    result = find_history_workbooks([reference_dir, output_dir], datetime(2026, 9, 1).date())
    # output/ holds the user-corrected deliverable, so it outranks reference/ for
    # the same month; the wrong-shaped June file is skipped.
    assert result == [august, august_ref, july]

    # Re-running August itself: the August files are excluded so the run stays
    # idempotent against the July template.
    result = find_history_workbooks([reference_dir, output_dir], datetime(2026, 8, 1).date())
    assert result == [july]


def test_write_staging_workbook_includes_review_rows(tmp_path):
    output_path = tmp_path / "prepared-incidents.xlsx"
    known = ["INC100"] + [None] * 19
    review = ["INC200"] + [None] * 19
    review[5] = "Needs Review"
    prepared = PreparedIncidents(
        OUTPUT_HEADERS,
        [known, review],
        {"INC200": ["Org could not be classified", "Subcategory2 could not be classified"]},
        [],
    )

    write_staging_workbook(prepared, output_path)

    workbook = openpyxl.load_workbook(output_path, data_only=True)
    assert workbook.sheetnames == ["Incidents", "Org", "Review Needed"]
    assert workbook["Incidents"].max_row == 3
    assert workbook["Review Needed"]["A2"].value == "INC200"
    assert workbook["Review Needed"]["U1"].value == "Review reason"
    assert workbook["Review Needed"]["U2"].value == (
        "Org could not be classified; Subcategory2 could not be classified"
    )
    assert workbook["Org"]["A1"].value == "Assigned to"
    assert all(not str(cell.value).startswith("INC") for cell in workbook["Org"]["A"] if cell.row > 1)


def test_write_staging_workbook_includes_blank_assignee_org_lookup(tmp_path):
    output_path = tmp_path / "prepared-incidents.xlsx"
    blank_assignee = ["INC100", None, None, None, None, "Deloitte"] + [None] * 14
    named_assignee = ["INC200", None, None, None, "Known Analyst", "Deloitte"] + [None] * 14
    external_assignee = ["INC300", None, None, None, "External Analyst", "Non-Deloitte"] + [None] * 14
    prepared = PreparedIncidents(
        OUTPUT_HEADERS,
        [blank_assignee, named_assignee, external_assignee],
        {},
        [],
    )

    write_staging_workbook(prepared, output_path)

    workbook = openpyxl.load_workbook(output_path, data_only=True)
    org_rows = {
        (workbook["Org"].cell(row, 1).value, workbook["Org"].cell(row, 2).value)
        for row in range(2, workbook["Org"].max_row + 1)
    }
    assert (None, "Deloitte") in org_rows
    assert ("Known Analyst", "Deloitte") in org_rows
    assert ("External Analyst", "Non-Deloitte") in org_rows