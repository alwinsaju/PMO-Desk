"""GET /tasks/{id}/draft-summary: the Outlook draft's recipients / subject echoed
from output/email-data.json for the 'Confirm & send' dialog."""
import json

import pytest

import main as backend
from test_platform import client, make_legacy_task, make_link, write

URL = "/tasks/legacy/draft-summary"


def summary(tmp_path, content=None):
    folder = make_legacy_task(tmp_path)
    if content is not None:
        write(folder, "output/email-data.json", content)
    return client().get(URL).json()


def test_summary_none_when_file_missing(tmp_path):
    assert summary(tmp_path) == {"ok": True, "summary": None}


@pytest.mark.parametrize("content", ["{nope", ["a"]])
def test_summary_none_when_file_is_not_json_or_not_an_object(tmp_path, content):
    assert summary(tmp_path, content) == {"ok": True, "summary": None}


def test_summary_none_without_recipients(tmp_path):
    assert summary(tmp_path, {"subject": "S", "to": " ; ", "cc": []}) == {"ok": True, "summary": None}


def test_summary_splits_recipient_strings_on_semicolons_only(tmp_path):
    result = summary(tmp_path, {
        "to": "USPDTOperate <u@x.com>",
        "cc": "Peethambaram, Sreela <s@x.com>; Atchula, Rupavani <r@x.com>;",
        "subject": "  Backlog Incidents | May 4  ",
        "attachments": ["C:\\work\\output\\Backlog.xlsx", "/tmp/other.xlsx"],
    })
    assert result == {"ok": True, "summary": {
        "to": ["USPDTOperate <u@x.com>"],
        "cc": ["Peethambaram, Sreela <s@x.com>", "Atchula, Rupavani <r@x.com>"],
        "subject": "Backlog Incidents | May 4",
        "attachments": ["Backlog.xlsx", "other.xlsx"],
    }}


def test_summary_accepts_lists_and_drops_junk(tmp_path):
    result = summary(tmp_path, {"to": ["a@x.com", 5, "", None, " b@x.com "], "cc": None,
                                "subject": 7, "attachments": "single.xlsx"})
    assert result["summary"] == {"to": ["a@x.com", "b@x.com"], "cc": [], "subject": "", "attachments": ["single.xlsx"]}


def test_summary_caps_list_length_and_value_length(tmp_path):
    result = summary(tmp_path, {"to": [f"p{i}@x.com" for i in range(80)], "subject": "s" * 500})["summary"]
    assert len(result["to"]) == 50 and result["to"][-1] == "p49@x.com"
    assert result["subject"] == "s" * 300


def test_summary_returns_only_whitelisted_fields(tmp_path):
    result = summary(tmp_path, {"to": "a@x.com", "rows": [{"secret": 1}], "workbook_path": "C:\\p.xlsx"})["summary"]
    assert set(result) == {"to", "cc", "subject", "attachments"}


def test_summary_unknown_task_is_refused(tmp_path):
    make_legacy_task(tmp_path)
    assert client().get("/tasks/ghost/draft-summary").json()["ok"] is False


def test_summary_does_not_follow_a_symlinked_output(tmp_path):
    folder = make_legacy_task(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "email-data.json").write_text(json.dumps({"to": "evil@x.com"}))
    make_link(folder / "output", outside)
    backend.discover_tasks()
    assert client().get(URL).json() == {"ok": True, "summary": None}
