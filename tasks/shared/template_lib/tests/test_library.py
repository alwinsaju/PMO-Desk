import json

import pytest

from template_lib import (
    Html,
    apply_email_template,
    body_to_html,
    load_library,
    render_text,
    template_for,
    templates_dir,
)

KEY = "task:weekly-aging-report"


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("AI_OS_TEMPLATES_DIR", raising=False)
    monkeypatch.delenv("AI_OS_PMO_DATA_DIR", raising=False)


def write_library(folder, templates):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "library.json").write_text(
        json.dumps({"version": 1, "templates": templates}), encoding="utf-8"
    )


def tpl(**over):
    base = {
        "id": "tpl_0123456789ab",
        "name": "Mine",
        "kind": "email",
        "subject": "Aging | {{date_subject}}",
        "to": "",
        "cc": "",
        "body": "Hi Team,\n\n{{total}} incidents",
        "usedBy": [KEY],
    }
    base.update(over)
    return base


class TestWhereItLives:
    def test_nothing_without_a_folder(self):
        assert templates_dir() is None
        assert load_library() == []

    def test_explicit_folder_wins_over_the_data_folder(self, monkeypatch, tmp_path):
        monkeypatch.setenv("AI_OS_PMO_DATA_DIR", str(tmp_path / "pmo"))
        assert templates_dir() == tmp_path / "pmo" / "templates"
        monkeypatch.setenv("AI_OS_TEMPLATES_DIR", str(tmp_path / "tpl"))
        assert templates_dir() == tmp_path / "tpl"


class TestLoading:
    def test_missing_file_means_no_templates(self, monkeypatch, tmp_path):
        monkeypatch.setenv("AI_OS_TEMPLATES_DIR", str(tmp_path))
        assert load_library() == []
        assert template_for(KEY) is None

    @pytest.mark.parametrize("content", ["{ not json", "[]", '{"templates": 5}', ""])
    def test_unreadable_file_falls_back_and_says_so(self, monkeypatch, tmp_path, capsys, content):
        monkeypatch.setenv("AI_OS_TEMPLATES_DIR", str(tmp_path))
        (tmp_path / "library.json").write_text(content, encoding="utf-8")
        assert load_library() == []
        assert "[templates]" in capsys.readouterr().err

    def test_reads_a_file_with_a_byte_order_mark(self, monkeypatch, tmp_path):
        monkeypatch.setenv("AI_OS_TEMPLATES_DIR", str(tmp_path))
        (tmp_path / "library.json").write_text(
            "\ufeff" + json.dumps({"templates": [tpl()]}), encoding="utf-8"
        )
        assert template_for(KEY)["name"] == "Mine"

    def test_finds_the_template_a_task_uses_and_skips_junk(self, monkeypatch, tmp_path):
        monkeypatch.setenv("AI_OS_TEMPLATES_DIR", str(tmp_path))
        write_library(tmp_path, [5, tpl(id="x", usedBy=["task:other"]), tpl(), tpl(usedBy="oops")])
        assert template_for(KEY)["id"] == "tpl_0123456789ab"
        assert template_for("task:nothing") is None


class TestRenderText:
    def test_fills_names_in_one_pass_and_leaves_unknown_ones(self):
        assert render_text("{{a}} {{ b }} {{c}}", {"a": "{{b}}", "b": 7}) == "{{b}} 7 {{c}}"


class TestBodyToHtml:
    def test_paragraphs_line_breaks_and_bold(self):
        out = body_to_html("Hi Team,\n\nSee **{{n}} items**.\nThanks", {"n": 3})
        paras = out.split("<p class=MsoNormal>&nbsp;<o:p></o:p></p>")
        assert len(paras) == 2
        assert ">Hi Team,</span>" in paras[0]
        assert "See <b>3 items</b>.<br>Thanks" in paras[1]

    def test_escapes_the_template_and_every_value(self):
        out = body_to_html("a < b {{x}}", {"x": "<script>alert(1)</script> & **no**"})
        assert "<script>" not in out
        assert "a &lt; b" in out
        assert "&lt;script&gt;" in out and "&amp;" in out
        assert "<b>no</b>" not in out and "&#42;&#42;no&#42;&#42;" in out

    def test_trusted_html_values_are_kept(self):
        out = body_to_html("On {{d}}", {"d": Html("<b>22<sup>nd</sup> August</b>")})
        assert "On <b>22<sup>nd</sup> August</b>" in out

    def test_an_unknown_name_stays_visible_and_escaped(self):
        assert "{{oops}}" in body_to_html("{{oops}}", {})

    def test_accepts_windows_line_breaks_and_extra_blank_lines(self):
        out = body_to_html("a\r\n\r\n\r\n\r\nb", {})
        assert out.count("<p class=MsoNormal><span") == 2

    def test_matches_the_aging_report_paragraphs_it_replaces(self):
        body = (
            "Hi Team,\n\nPlease find below the list of **42 incidents** that were last updated "
            "prior to **5th August 2026**. We request that the assigned owners "
            "**prioritize review and next steps** for these items."
        )
        style = "font-size:11.0pt;font-family:'Aptos Narrow',sans-serif;color:#2D2D2D"
        expected = (
            f'<p class=MsoNormal><span style="{style}">Hi Team,</span><o:p></o:p></p>'
            "<p class=MsoNormal>&nbsp;<o:p></o:p></p>"
            f'<p class=MsoNormal><span style="{style}">Please find below the list of <b>42 incidents</b> '
            "that were last updated prior to <b>5th August 2026</b>. We request that the assigned owners "
            "<b>prioritize review and next steps</b> for these items.</span><o:p></o:p></p>"
        )
        assert body_to_html(body, {}) == expected


class TestApplyEmailTemplate:
    def base(self):
        return {"subject": "old", "to": "old-to", "cc": "old-cc", "rows": [1]}

    def test_without_a_template_nothing_changes(self, monkeypatch, tmp_path):
        monkeypatch.setenv("AI_OS_TEMPLATES_DIR", str(tmp_path))
        data = self.base()
        assert apply_email_template(KEY, data, {}) is None
        assert data == self.base()

    def test_applies_subject_body_and_recipients(self, monkeypatch, tmp_path, capsys):
        monkeypatch.setenv("AI_OS_TEMPLATES_DIR", str(tmp_path))
        write_library(tmp_path, [tpl(to="a@x.com", cc="b@x.com;\n c@x.com")])
        data = self.base()
        used = apply_email_template(KEY, data, {"date_subject": "5th August", "total": 42})
        assert used["name"] == "Mine"
        assert data["subject"] == "Aging | 5th August"
        assert data["to"] == "a@x.com"
        assert data["cc"] == "b@x.com; c@x.com"
        assert "42 incidents" in data["body_html"]
        assert data["rows"] == [1]
        assert "Using template: Mine" in capsys.readouterr().out

    def test_blank_recipients_keep_the_tasks_own(self, monkeypatch, tmp_path):
        monkeypatch.setenv("AI_OS_TEMPLATES_DIR", str(tmp_path))
        write_library(tmp_path, [tpl()])
        data = self.base()
        apply_email_template(KEY, data, {"date_subject": "d", "total": 1})
        assert (data["to"], data["cc"]) == ("old-to", "old-cc")

    def test_a_subject_value_cannot_add_a_header_line(self, monkeypatch, tmp_path):
        monkeypatch.setenv("AI_OS_TEMPLATES_DIR", str(tmp_path))
        write_library(tmp_path, [tpl()])
        data = self.base()
        apply_email_template(KEY, data, {"date_subject": "x\r\nBcc: evil@x.com", "total": 1})
        assert "\n" not in data["subject"] and "\r" not in data["subject"]

    def test_blank_subject_or_body_keeps_the_tasks_own(self, monkeypatch, tmp_path):
        monkeypatch.setenv("AI_OS_TEMPLATES_DIR", str(tmp_path))
        write_library(tmp_path, [tpl(subject=" ", body="  ")])
        data = self.base()
        apply_email_template(KEY, data, {})
        assert data["subject"] == "old" and "body_html" not in data
