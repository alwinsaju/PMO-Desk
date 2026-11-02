"""The incident knowledge repository: extraction, merging, guide and use by prepare_data.

Synthetic workbooks only; no client or PMO data."""
import json
from datetime import date

import openpyxl

from scripts import build_knowledge as kb
from scripts.prepare_data import OUTPUT_HEADERS, canonicalize_subcategory, learn_from_history, repository_tables


def write_sheet(path, sheet, headers, rows):
    workbook = openpyxl.Workbook()
    ws = workbook.active
    ws.title = sheet
    ws.append(headers)
    for row in rows:
        ws.append(row)
    workbook.save(path)


def make_source(tmp_path):
    jan = tmp_path / "01. January"
    feb = tmp_path / "02. February"
    jan.mkdir()
    feb.mkdir()
    # January: ServiceNow-style headers, the label lives in "Sub category"
    write_sheet(
        jan / "Top Trending Jan.xlsx",
        "Incidents",
        ["Number", "Short Description", "Resolution notes", "State", "Assignment group", "Sub category"],
        [
            ["INC1", "DIS - Unable to print label", "Category: A Sub-Category: Print labels Symptom reported: x", "Closed", "G", "Print labels"],
            ["INC2", "Old WIP", "n", "In Progress", "G", "WIP"],
            ["INC3", "Report please", "n", "Closed", "G", "Information requested"],
        ],
    )
    # February: INC1 is re-classified; a duplicate "Tags" style column must not confuse us
    write_sheet(
        feb / "All Incident Feb 2026 (excl Infra).xlsx",
        "Incidents",
        ["Number", "Tags", "Short description", "Resolution notes", "State", "Assignment group", "SUB CATEGORY"],
        [
            ["INC1", "x", "DIS - Unable to print label", "Sub-Category: Print Label", "Closed", "G", "Print Label"],
            ["INC4", None, "Fast Pass app down", "n", "Closed", "G", "Application Issue"],
        ],
    )
    return [
        ("2026-01", "01. January/Top Trending*.xlsx", "Incidents", 0),
        ("2026-02", "02. February/All Incident Feb 2026*.xlsx", "Incidents", 0),
        ("2026-03", "03. March/missing.xlsx", "Incidents", 0),
    ]


def test_build_records_newest_label_wins_and_placeholders_are_skipped(tmp_path):
    sources = make_source(tmp_path)
    logs = []
    records, stats = kb.build_records(tmp_path, sources, logs.append)

    assert set(records) == {"INC1", "INC3", "INC4"}  # the WIP ticket is not knowledge
    assert records["INC1"]["label"] == "Print Label" and records["INC1"]["month"] == "2026-02"
    assert records["INC1"]["first_seen"] == "2026-01"
    assert records["INC3"]["month"] == "2026-01"
    assert [s["classified"] for s in stats] == [2, 2] and stats[0]["placeholders"] == 1
    assert any("no file matches" in line for line in logs)


def test_find_columns_uses_the_first_matching_header_and_the_label_column():
    columns = kb.find_columns(["Number", "Tags", "Short  Description", "Category", "Category", "SUB CATEGORY"])
    assert columns == {"number": 0, "short_description": 2, "category": 3, "label": 5}


def test_repository_files_guide_conflicts_and_examples(tmp_path):
    sources = make_source(tmp_path)
    out = tmp_path / "knowledge"
    manifest = kb.write_repository(tmp_path, out, canonicalize_subcategory, sources, log=lambda *_: None)

    assert manifest["tickets"] == 3 and manifest["sources"][0]["month"] == "2026-01"
    january = [json.loads(line) for line in (out / "incidents-2026-01.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [r["number"] for r in january] == ["INC3"]
    guide = json.loads((out / "category-guide.json").read_text(encoding="utf-8"))
    assert guide["Print Label"]["count"] == 1 and guide["Print Label"]["typical_tags"] == ["Print Label"]
    assert json.loads((out / "conflicts.json").read_text(encoding="utf-8"))["max_accuracy_from_description_alone"] == 1.0
    examples = kb.load_examples(out)
    assert {e["label"] for e in examples} == {"Print Label", "Information Requested", "Application Issue"}


def test_conflicting_descriptions_lower_the_measured_ceiling():
    records = {
        f"INC{i}": {"short_description": "Same text", "label": label, "month": "2026-01", "tag": ""}
        for i, label in enumerate(["A", "A", "A", "B"])
    }
    canon = kb.canonical_labels(records, lambda label: label)
    conflicts = kb.build_conflicts(records, canon)
    assert conflicts["conflicting_descriptions"] == 1
    assert conflicts["max_accuracy_from_description_alone"] == 0.75


def test_label_spelling_variants_merge_to_the_most_frequent_spelling():
    records = {f"INC{i}": {"label": label, "short_description": "x", "month": "m", "tag": ""}
               for i, label in enumerate(["Print Label", "Print Label", "print label", "PRINT LABEL"])}
    canon = kb.canonical_labels(records, lambda label: label)
    assert set(canon.values()) == {"Print Label"}


def test_repository_months_fill_in_history_without_a_workbook(tmp_path):
    out = tmp_path / "knowledge"
    out.mkdir()
    (out / "incidents-2026-02.jsonl").write_text(
        json.dumps({"number": "INC9", "short_description": "Fingerprint stuck", "resolution_notes": "n",
                    "label": "fingerprint issue", "label_canonical": "Fingerprint Issue", "state": "Closed"}) + "\n",
        encoding="utf-8",
    )
    (out / "incidents-2026-10.jsonl").write_text(
        json.dumps({"number": "INC10", "short_description": "Later", "resolution_notes": "n",
                    "label": "Other", "label_canonical": "Other", "state": "Closed"}) + "\n",
        encoding="utf-8",
    )
    tables = repository_tables(out, before_month=date(2026, 10, 1), covered_months=set())
    assert [t[0] for t in tables] == [date(2026, 2, 1)]  # the report month and later are never learned
    assert tables[0][1] == list(OUTPUT_HEADERS)

    history = learn_from_history([], knowledge_dir=out, before_month=date(2026, 10, 1))
    assert history.known_by_number["INC9"] == (None, "Fingerprint Issue")
    assert history.subcategory_by_short_description["fingerprint stuck"] == "Fingerprint Issue"
    assert "Fingerprint Issue" in history.subcategory_options
    assert repository_tables(out, None, covered_months={date(2026, 2, 1)}) == [
        t for t in repository_tables(out, None, set()) if t[0] != date(2026, 2, 1)
    ]


def test_label_guide_shows_what_each_category_contains():
    from scripts import ai_classify as ai

    guide = {"Print Label": {"typical_descriptions": [{"text": "DIS - Unable to print label", "count": 5}],
                             "keywords": ["print", "label"]}}
    text = ai.render_label_guide(["Print Label", "Other"], {"Print Label": 9, "Other": 3}, guide)
    assert "- Print Label (9): e.g. DIS - Unable to print label [keywords: print, label]" in text
    assert "- Other (3)" in text
    system = ai.build_system_prompt("RULES", ["Print Label"], {"Print Label": 9}, guide)
    assert "examples show what belongs in each" in system and "RULES" in system
