import json

import openpyxl

from scripts.apply_resolutions import apply_to_staging, load_resolutions


def write_staging(path):
    workbook = openpyxl.Workbook()
    incidents = workbook.active
    incidents.title = "Incidents"
    incidents.append(["Number", "Short description", "Subcategory2"])
    incidents.append(["INC100", "Some issue", "Needs Review"])
    incidents.append(["INC200", "Another issue", "Needs Review"])
    incidents.append(["INC300", "Fine issue", "EDQ issue"])
    review = workbook.create_sheet("Review Needed")
    review.append(["Number", "Short description", "Subcategory2", "Review reason"])
    review.append(["INC100", "Some issue", "Needs Review", "Subcategory2 could not be classified"])
    review.append(["INC200", "Another issue", "Needs Review", "Subcategory2 could not be classified"])
    workbook.save(path)


def test_load_resolutions_skips_blank_and_skip(tmp_path):
    path = tmp_path / "resolutions.json"
    path.write_text(
        json.dumps(
            {
                "resolutions": [
                    {"number": "INC100", "subcategory2": "Access Related"},
                    {"number": "INC200", "subcategory2": "skip"},
                    {"number": "", "subcategory2": "WIP"},
                    {"number": "INC300", "subcategory2": "  "},
                ]
            }
        )
    )
    assert load_resolutions(path) == {"INC100": "Access Related"}


def test_load_resolutions_missing_or_corrupt(tmp_path):
    assert load_resolutions(tmp_path / "nope.json") == {}
    bad = tmp_path / "bad.json"
    bad.write_text("{ not json")
    assert load_resolutions(bad) == {}


def test_apply_to_staging_updates_incidents_and_review(tmp_path):
    staging = tmp_path / "prepared-incidents.xlsx"
    write_staging(staging)

    applied = apply_to_staging(staging, {"INC100": "Access Related", "INC999": "WIP"})

    assert applied == 1  # INC999 is not in the staging data
    workbook = openpyxl.load_workbook(staging)
    incidents = workbook["Incidents"]
    assert incidents.cell(2, 3).value == "Access Related"  # INC100 resolved
    assert incidents.cell(3, 3).value == "Needs Review"  # INC200 untouched
    assert incidents.cell(4, 3).value == "EDQ issue"  # already-classified untouched
    # Resolved incidents are classified now, so they leave the review queue
    # entirely - only the still-unresolved INC200 remains on Review Needed.
    review = workbook["Review Needed"]
    review_numbers = [review.cell(row, 1).value for row in range(2, review.max_row + 1)]
    assert "INC100" not in review_numbers
    assert review_numbers == ["INC200"]
    workbook.close()


def test_apply_to_staging_no_resolutions_is_noop(tmp_path):
    staging = tmp_path / "prepared-incidents.xlsx"
    write_staging(staging)
    assert apply_to_staging(staging, {}) == 0
    workbook = openpyxl.load_workbook(staging)
    assert workbook["Incidents"].cell(2, 3).value == "Needs Review"
    workbook.close()
