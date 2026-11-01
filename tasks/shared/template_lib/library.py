"""
Template library for the task scripts.

The Templates app (PMO Desk) stores email and report templates in one file,
`library.json`, in the folder named by AI_OS_TEMPLATES_DIR (else the `templates`
folder inside AI_OS_PMO_DATA_DIR). A template lists the tasks and apps that use
it in `usedBy`, as keys like "task:weekly-aging-report". A task script asks
`apply_email_template` for its own key right after it has built its draft data:

  * no library, no template for the key, or an unreadable file -> the script's own
    wording is used, exactly as before;
  * a template for the key -> its subject, To, Cc and message replace the
    script's, with {{placeholders}} filled from the values the script passes.

The TypeScript twin is src/lib/templates/render.ts: same placeholder syntax
(unknown names are left as typed), same `**bold**`. Keep the two in step.

Nothing here sends anything; it only decides the text of a draft that a person
still reviews.
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Mapping

LIBRARY_FILE = "library.json"

_PLACEHOLDER = re.compile(r"\{\{\s*([a-z][a-z0-9_]*)\s*\}\}")
_SNIPPET = re.compile(r"\{\{\s*>\s*([a-z][a-z0-9_]*)\s*\}\}")
# An innermost {{#if ...}} block: no further #if inside it, so nested blocks resolve from the inside out.
_IF_BLOCK = re.compile(
    r"\{\{\s*#if\s+([a-z][a-z0-9_]*)(?:\s*(>=|<=|!=|>|<|=)\s*([^\s}]+))?\s*\}\}"
    r"((?:(?!\{\{\s*#if\b)[\s\S])*?)\{\{\s*/if\s*\}\}"
)
_ELSE = re.compile(r"\{\{\s*else\s*\}\}")
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_BLANK_LINE = re.compile(r"\n[ \t]*\n(?:[ \t]*\n)*")

_TEXT_STYLE = "font-size:11.0pt;font-family:'Aptos Narrow',sans-serif;color:#2D2D2D"
_PARAGRAPH = f'<p class=MsoNormal><span style="{_TEXT_STYLE}">%s</span><o:p></o:p></p>'
_BLANK_PARAGRAPH = "<p class=MsoNormal>&nbsp;<o:p></o:p></p>"


class Html(str):
    """A value that is already HTML (written by the script, never by a person)."""


def templates_dir() -> Path | None:
    explicit = os.environ.get("AI_OS_TEMPLATES_DIR", "").strip()
    if explicit:
        return Path(explicit)
    data = os.environ.get("AI_OS_PMO_DATA_DIR", "").strip()
    return Path(data) / "templates" if data else None


def _warn(message: str) -> None:
    print(f"[templates] {message}", file=sys.stderr)


def load_library() -> list[dict[str, Any]]:
    """The saved templates, or [] when there is no library or it cannot be read."""
    folder = templates_dir()
    if folder is None:
        return []
    path = folder / LIBRARY_FILE
    try:
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return []
    except (OSError, ValueError) as error:
        _warn(f"Could not read {path} ({error}); using the task's own wording.")
        return []
    items = raw.get("templates") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        _warn(f"{path} is not a template library; using the task's own wording.")
        return []
    return [item for item in items if isinstance(item, dict)]


def template_for(target_key: str) -> dict[str, Any] | None:
    """The template that `target_key` uses, if one is set."""
    for item in load_library():
        used_by = item.get("usedBy")
        if isinstance(used_by, list) and target_key in used_by:
            return item
    return None


def _text(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _one_line(value: str) -> str:
    return " ".join(value.split())


def snippet_key(name: str) -> str:
    """The key a snippet is used by: its name in lower case, every run of other characters as `_`."""
    key = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    if key and not key[0].isalpha():
        key = f"s_{key}"
    return key


def load_snippets() -> dict[str, str]:
    """The library's snippets (templates of kind "snippet"), by key, for {{> key}}."""
    out: dict[str, str] = {}
    for item in load_library():
        if item.get("kind") != "snippet":
            continue
        key = snippet_key(_text(item.get("name")))
        if key and key not in out:
            out[key] = _text(item.get("body"))
    return out


def inline_snippets(source: str, snippets: Mapping[str, str] | None) -> str:
    """{{> key}} replaced by the snippet's text, up to three levels deep; an unknown key stays as typed."""
    if not snippets:
        return source
    text = source
    for _ in range(3):
        nxt = _SNIPPET.sub(lambda m: snippets.get(m.group(1), m.group(0)), text)
        if nxt == text:
            break
        text = nxt
    return text


def _truthy(value: Any) -> bool:
    v = str(value).strip().lower()
    return v not in ("", "0", "false", "no")


def _holds(value: Any, op: str | None, against: str | None) -> bool:
    if value is None:
        return False
    if not op or against is None:
        return _truthy(value)
    text = str(value).strip()
    try:
        a, b = float(text), float(against)
        numeric = text != ""
    except ValueError:
        numeric = False
    if numeric:
        return {">": a > b, ">=": a >= b, "<": a < b, "<=": a <= b, "=": a == b}.get(op, a != b)
    x, y = text.lower(), against.lower()
    if op == "=":
        return x == y
    if op == "!=":
        return x != y
    return False


def resolve_conditions(source: str, values: Mapping[str, Any]) -> str:
    """{{#if name}}...{{else}}...{{/if}} resolved innermost first. Same rules as render.ts: a name is true when
    it has a value that is not 0, false or no; `name > 0` (also >=, <, <=, =, !=) compares numbers when both
    sides are numbers, else text; a name with no value is false; an unmatched tag stays as typed."""
    text = source
    for _ in range(50):
        match = _IF_BLOCK.search(text)
        if match is None:
            break
        name, op, against, inner = match.groups()
        parts = _ELSE.split(inner)
        chosen = parts[0] if _holds(values.get(name), op, against) else (parts[1] if len(parts) > 1 else "")
        text = text[: match.start()] + chosen + text[match.end() :]
    return text


def render_text(source: str, values: Mapping[str, Any], snippets: Mapping[str, str] | None = None) -> str:
    """Plain text: conditions resolved, then each {{name}} replaced in one pass; a name with no value is left as typed."""

    def fill(match: re.Match[str]) -> str:
        name = match.group(1)
        return str(values[name]) if name in values else match.group(0)

    return _PLACEHOLDER.sub(fill, resolve_conditions(inline_snippets(source, snippets), values))


def _escape_value(value: Any) -> str:
    if isinstance(value, Html):
        return str(value)
    # A value never makes bold: its stars are written as character references.
    return html.escape(str(value)).replace("*", "&#42;")


def body_to_html(source: str, values: Mapping[str, Any], snippets: Mapping[str, str] | None = None) -> str:
    """The message as Outlook paragraphs: blank lines separate paragraphs, a single
    line break is a <br>, **bold** is bold, and every value is escaped (unless it is
    an `Html` value the script wrote itself). Snippets and {{#if}} blocks are resolved first."""
    text = resolve_conditions(inline_snippets(source, snippets), values)
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    paragraphs = []
    for block in _BLANK_LINE.split(text):
        out: list[str] = []
        position = 0
        for match in _PLACEHOLDER.finditer(block):
            out.append(html.escape(block[position : match.start()]))
            name = match.group(1)
            out.append(_escape_value(values[name]) if name in values else html.escape(match.group(0)))
            position = match.end()
        out.append(html.escape(block[position:]))
        line_html = _BOLD.sub(r"<b>\1</b>", "".join(out)).replace("\n", "<br>")
        paragraphs.append(_PARAGRAPH % line_html)
    return _BLANK_PARAGRAPH.join(paragraphs)


def apply_email_template(
    target_key: str,
    data: dict[str, Any],
    values: Mapping[str, Any],
) -> dict[str, Any] | None:
    """Overrides `data`'s subject, to, cc and (new) body_html from the template that
    `target_key` uses. A blank To or Cc keeps the script's own recipients. Returns
    the template used, or None when the script's own wording stays."""
    template = template_for(target_key)
    if template is None:
        return None
    snippets = load_snippets()
    subject = _one_line(render_text(_text(template.get("subject")), values, snippets))
    if subject:
        data["subject"] = subject
    for field in ("to", "cc"):
        recipients = _one_line(render_text(_text(template.get(field)), values, snippets))
        if recipients:
            data[field] = recipients
    body = _text(template.get("body"))
    if body.strip():
        data["body_html"] = body_to_html(body, values, snippets)
    print(f"Using template: {_text(template.get('name')) or target_key}")
    return template
