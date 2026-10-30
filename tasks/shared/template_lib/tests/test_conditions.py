"""Conditional blocks and snippets: the same cases as src/lib/templates/templates.test.mjs ("shared vectors"),
so the Python and TypeScript renderers cannot drift apart."""
import json

import pytest

from template_lib import apply_email_template, body_to_html, render_text
from template_lib.library import resolve_conditions, snippet_key

# (template, values, snippets, expected plain text)
VECTORS = [
    ("{{#if total}}Total: {{total}}{{/if}}", {"total": "5"}, {}, "Total: 5"),
    ("{{#if total}}Total: {{total}}{{/if}}", {"total": "0"}, {}, ""),
    ("A{{#if x}}B{{else}}C{{/if}}D", {"x": "1"}, {}, "ABD"),
    ("A{{#if x}}B{{else}}C{{/if}}D", {"x": ""}, {}, "ACD"),
    ("A{{#if x}}B{{else}}C{{/if}}D", {}, {}, "ACD"),
    ("{{#if n > 3}}many{{else}}few{{/if}}", {"n": "5"}, {}, "many"),
    ("{{#if n > 3}}many{{else}}few{{/if}}", {"n": "2"}, {}, "few"),
    ("{{#if n > 3}}many{{else}}few{{/if}}", {"n": "abc"}, {}, "few"),
    ("{{#if n >= 3}}y{{/if}}", {"n": "3"}, {}, "y"),
    ("{{#if n != 3}}y{{else}}n{{/if}}", {"n": "3"}, {}, "n"),
    ("{{#if a}}1{{#if b}}2{{/if}}3{{/if}}", {"a": "1", "b": "1"}, {}, "123"),
    ("{{#if a}}1{{#if b}}2{{/if}}3{{/if}}", {"a": "1", "b": "0"}, {}, "13"),
    ("{{#if a}}1{{#if b}}2{{/if}}3{{/if}}", {"a": "0", "b": "1"}, {}, ""),
    ("{{#if s = open}}yes{{else}}no{{/if}}", {"s": "Open"}, {}, "yes"),
    ("{{ #if a }}x{{ /if }}", {"a": "1"}, {}, "x"),
    ("{{#if a}}x", {"a": "1"}, {}, "{{#if a}}x"),
    ("Hi{{> sig}}", {}, {"sig": "\n--\nPat"}, "Hi\n--\nPat"),
    ("Hi {{> nope}}", {}, {"sig": "x"}, "Hi {{> nope}}"),
    ("{{> a}}", {}, {"a": "A+{{> b}}", "b": "B"}, "A+B"),
    ("{{> sig}} {{name}}", {"name": "Pat"}, {"sig": "{{#if name}}Hello {{/if}}"}, "Hello  Pat"),
    ("Keep {{unknown}} as typed", {}, {}, "Keep {{unknown}} as typed"),
]


@pytest.mark.parametrize("source,values,snippets,expected", VECTORS)
def test_plain_text_matches_the_shared_vectors(source, values, snippets, expected):
    assert render_text(source, values, snippets) == expected


def test_conditions_resolve_before_html_is_built():
    html = body_to_html("Hi\n\n{{#if n > 0}}You have {{n}} open.{{/if}}\n\nBye", {"n": "3"})
    assert "You have 3 open." in html
    assert "{{" not in html
    assert "You have" not in body_to_html("Hi\n\n{{#if n > 0}}You have {{n}} open.{{/if}}\n\nBye", {"n": "0"})


def test_snippet_keys_follow_the_name():
    assert snippet_key("Email signature") == "email_signature"
    assert snippet_key("  9 lives ") == "s_9_lives"
    assert snippet_key("***") == ""


def test_a_template_uses_snippets_from_the_library(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_OS_TEMPLATES_DIR", str(tmp_path))
    library = {
        "version": 1,
        "templates": [
            {
                "id": "tpl_0123456789ab",
                "name": "Mine",
                "kind": "email",
                "subject": "Aging {{total}}",
                "to": "",
                "cc": "",
                "body": "Hi\n\n{{#if total > 10}}That is a lot.{{/if}}\n\n{{> signature}}",
                "usedBy": ["task:weekly-aging-report"],
            },
            {
                "id": "tpl_0123456789ac",
                "name": "Signature",
                "kind": "snippet",
                "subject": "",
                "to": "",
                "cc": "",
                "body": "Thanks,\nPat",
                "usedBy": [],
            },
        ],
    }
    (tmp_path / "library.json").write_text(json.dumps(library), encoding="utf-8")
    data = {}
    apply_email_template("task:weekly-aging-report", data, {"total": "42"})
    assert "That is a lot." in data["body_html"]
    assert "Thanks,<br>Pat" in data["body_html"]
    assert data["subject"] == "Aging 42"
