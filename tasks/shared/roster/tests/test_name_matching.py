import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import name_matching


class FakeSheet:
    def __init__(self, rows):
        self.rows = rows
        self.max_row = len(rows)

    def cell(self, row, column):
        return SimpleNamespace(value=self.rows[row - 1][column - 1])


class FakeWorkbook:
    def __init__(self, worksheet):
        self.worksheet = worksheet

    def __getitem__(self, _):
        return self.worksheet


def test_load_roster_returns_stripped_names_and_available_emails(monkeypatch):
    worksheet = FakeSheet(
        [
            ["Full Name", "Email"],
            ["  Ada Lovelace  ", " ada@example.com "],
            ["Grace Hopper", None],
            [None, "ignored@example.com"],
        ]
    )
    workbook = FakeWorkbook(worksheet)
    monkeypatch.setattr(
        name_matching,
        "openpyxl",
        SimpleNamespace(load_workbook=lambda *_args, **_kwargs: workbook),
        raising=False,
    )

    roster_names, email_by_roster_name = name_matching.load_roster("Names.xlsx")

    assert roster_names == ["Ada Lovelace", "Grace Hopper"]
    assert email_by_roster_name == {"Ada Lovelace": "ada@example.com"}


def _roster_with(monkeypatch, rows):
    workbook = FakeWorkbook(FakeSheet(rows))
    monkeypatch.setattr(
        name_matching,
        "openpyxl",
        SimpleNamespace(load_workbook=lambda *_args, **_kwargs: workbook),
        raising=False,
    )


def test_load_roster_refuses_a_roster_without_any_email(monkeypatch):
    _roster_with(monkeypatch, [["Full Name", "Email"], ["Ada Lovelace", None], ["Grace Hopper", ""]])

    with pytest.raises(SystemExit, match="no email addresses"):
        name_matching.load_roster("Names.xlsx")


def test_load_roster_refuses_an_empty_roster(monkeypatch):
    _roster_with(monkeypatch, [["Full Name", "Email"]])

    with pytest.raises(SystemExit, match="no names"):
        name_matching.load_roster("Names.xlsx")