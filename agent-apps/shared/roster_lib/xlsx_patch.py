"""
Text-level xlsx sheet reader and cell patcher for the live shift-roster workbook.

Why not openpyxl: loading the master with openpyxl is slow (it can carry
130k+ conditional-format rules) and saving it silently drops threaded comments,
persons, the sensitivity label, extLst conditional formatting / validation and
some drawings. So this module never round-trips the workbook through an object
model. It treats the .xlsx as a zip of byte blobs and rewrites exactly one of
them - the target worksheet part - by splicing text inside <sheetData>. The
bytes before <sheetData> (views, cols, ...) and after </sheetData> (merges,
conditional formatting, validation, hyperlinks, extLst, ...) are carried over
verbatim, so even a 40 MB conditional-format blob is neither parsed nor
re-serialised. Every other package part is copied with its original ZipInfo
(name, order, timestamp, compression method).

Writing text: inline strings vs shared strings (decision)
    The roster's colouring is driven by conditional formatting that evaluates
    the cell TEXT (SEARCH("shift-1", E16), cellIs = "P", ...). It does not care
    how the text is stored, because Excel resolves a shared or inline string to
    the same text value before evaluating any rule, data validation or formula.
    Excel itself reads t="inlineStr" cells as ordinary text constants and
    converts them to shared strings the next time it saves, so the first save
    by a human normalises them.

    We therefore never append to xl/sharedStrings.xml (that would rewrite a
    second part, require count/uniqueCount bookkeeping, and risk index drift).
    Instead:
      * if the exact text already exists as a plain <si><t> entry, the cell
        references that index (t="s") - byte-for-byte what Excel would write
        for the common codes (Shift-1, NS, HOL, ...);
      * otherwise the cell gets t="inlineStr" with <is><t xml:space="preserve">.
    t="str" is deliberately NOT used: it is the cached-result type of a formula
    cell, and on a non-formula cell it is non-conformant.
    Referencing an existing index leaves sst@count (total references) slightly
    stale; Excel does not validate it. Pass reuse_shared_strings=False to force
    inline strings everywhere.

Safety properties
    * dst must differ from src; the result is written to a temp file and moved
      into place only after the self-check passes.
    * Formula cells are refused unless allow_formula_overwrite=True; a shared /
      array formula master is always refused. Overwriting a formula also prunes
      the matching xl/calcChain.xml entry (otherwise Excel reports a corrupt
      file), which is the only other part that can change.
    * Idempotent: writing the text a cell already holds does not touch it.
    * Self-check before saving: the patched sheetData is well-formed XML, the
      edited cells read back as requested and every other cell is unchanged.
"""

from __future__ import annotations

import os
import posixpath
import re
import tempfile
import zipfile
from dataclasses import dataclass, field
from typing import Iterable, Iterator, Mapping, Optional, Union

from lxml import etree

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
REL_OFFICE_DOC = NS_REL + "/officeDocument"
REL_SHARED_STRINGS = NS_REL + "/sharedStrings"
REL_CALC_CHAIN = NS_REL + "/calcChain"

MAX_ROW = 1_048_576
MAX_COL = 16_384
MAX_CELL_CHARS = 32_767

CellKey = tuple[int, int]
CellRef = Union[CellKey, str]
Edits = Mapping[CellRef, Optional[str]]


class XlsxPatchError(Exception):
    """Base class for package / patch failures."""


class SheetNotFoundError(XlsxPatchError):
    pass


class FormulaOverwriteError(XlsxPatchError):
    pass


# ---------------------------------------------------------------------------
# Cell references


def col_to_num(letters: str) -> int:
    n = 0
    for ch in letters.upper():
        if not "A" <= ch <= "Z":
            raise ValueError(f"bad column letters: {letters!r}")
        n = n * 26 + ord(ch) - 64
    return n


def num_to_col(n: int) -> str:
    if n < 1:
        raise ValueError(f"column number must be >= 1, got {n}")
    out = ""
    while n:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out


_REF_RE = re.compile(r"^\$?([A-Za-z]{1,3})\$?(\d+)$")


def parse_ref(ref: str) -> CellKey:
    m = _REF_RE.match(ref.strip())
    if not m:
        raise ValueError(f"bad cell reference: {ref!r}")
    return int(m.group(2)), col_to_num(m.group(1))


def format_ref(row: int, col: int) -> str:
    return f"{num_to_col(col)}{row}"


def _normalize_key(key: CellRef) -> CellKey:
    if isinstance(key, str):
        row, col = parse_ref(key)
    else:
        row, col = key
    if not (1 <= row <= MAX_ROW and 1 <= col <= MAX_COL):
        raise ValueError(f"cell out of range: row={row} col={col}")
    return row, col


# ---------------------------------------------------------------------------
# XML text helpers

_ENT_RE = re.compile(r"&(#x[0-9A-Fa-f]+|#[0-9]+|lt|gt|amp|quot|apos);")
_X_ESC_RE = re.compile(r"_x([0-9A-Fa-f]{4})_")
_X_LIT_RE = re.compile(r"_(x[0-9A-Fa-f]{4}_)")
_INVALID_XML_CHARS_RE = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f￾￿\ud800-\udfff]")
_NAMED = {"lt": "<", "gt": ">", "amp": "&", "quot": '"', "apos": "'"}


def _entity(m: re.Match) -> str:
    g = m.group(1)
    if g[0] != "#":
        return _NAMED[g]
    return chr(int(g[2:], 16)) if g[1] in "xX" else chr(int(g[1:]))


def decode_text(raw: str) -> str:
    """Raw XML text node -> the string Excel would show.

    Mirrors what an XML parser plus Excel's own escaping would produce: CRLF
    and lone CR in the markup normalise to LF, character references expand
    (so &#13; yields a real CR), then _xHHHH_ escapes decode.
    """
    if "\r" in raw:
        raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    if "&" in raw:
        raw = _ENT_RE.sub(_entity, raw)
    if "_x" in raw:
        raw = _X_ESC_RE.sub(lambda m: chr(int(m.group(1), 16)), raw)
    return raw


def encode_text(text: str) -> str:
    """Cell text -> XML text node content (inverse of decode_text)."""
    if _INVALID_XML_CHARS_RE.search(text):
        raise ValueError("text contains characters that are not valid in XML")
    text = _X_LIT_RE.sub(r"_x005F_\1", text)
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\r", "&#13;")
    )


_ATTR_RE = re.compile(r"""([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')""")


def _attrs(s: str) -> dict[str, str]:
    return {m.group(1): (m.group(2) if m.group(2) is not None else m.group(3)) for m in _ATTR_RE.finditer(s)}


# ---------------------------------------------------------------------------
# Package structure


@dataclass(frozen=True)
class SheetInfo:
    name: str
    part: str
    sheet_id: int
    state: str  # "visible" | "hidden" | "veryHidden"


def _read_rels(zf: zipfile.ZipFile, rels_part: str) -> list[dict[str, str]]:
    if rels_part not in zf.namelist():
        return []
    root = etree.fromstring(zf.read(rels_part))
    return [dict(el.attrib) for el in root if el.tag == f"{{{NS_PKG_REL}}}Relationship"]


def _resolve_target(base_part: str, target: str) -> str:
    if target.startswith("/"):
        return target[1:]
    return posixpath.normpath(posixpath.join(posixpath.dirname(base_part), target))


def _workbook_part(zf: zipfile.ZipFile) -> str:
    for rel in _read_rels(zf, "_rels/.rels"):
        if rel.get("Type") == REL_OFFICE_DOC:
            return _resolve_target("", rel["Target"])
    raise XlsxPatchError("package has no officeDocument relationship")


def _rels_path_for(part: str) -> str:
    return posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels")


def _workbook_related_part(zf: zipfile.ZipFile, rel_type: str) -> Optional[str]:
    wb_part = _workbook_part(zf)
    for rel in _read_rels(zf, _rels_path_for(wb_part)):
        if rel.get("Type") == rel_type:
            return _resolve_target(wb_part, rel["Target"])
    return None


def list_sheets(zf: zipfile.ZipFile) -> list[SheetInfo]:
    wb_part = _workbook_part(zf)
    rels = {r["Id"]: r for r in _read_rels(zf, _rels_path_for(wb_part))}
    root = etree.fromstring(zf.read(wb_part))
    sheets_el = root.find(f"{{{NS_MAIN}}}sheets")
    out: list[SheetInfo] = []
    if sheets_el is None:
        return out
    for el in sheets_el:
        rid = el.get(f"{{{NS_REL}}}id")
        rel = rels.get(rid or "")
        if rel is None:
            raise XlsxPatchError(f"sheet {el.get('name')!r} has no relationship {rid!r}")
        out.append(
            SheetInfo(
                name=el.get("name", ""),
                part=_resolve_target(wb_part, rel["Target"]),
                sheet_id=int(el.get("sheetId", "0")),
                state=el.get("state", "visible"),
            )
        )
    return out


def resolve_sheet(zf: zipfile.ZipFile, sheet_name: str) -> SheetInfo:
    """Sheet name -> SheetInfo via workbook.xml + rels (never assumes sheet1)."""
    sheets = list_sheets(zf)
    for s in sheets:
        if s.name == sheet_name:
            return s
    raise SheetNotFoundError(
        f"sheet {sheet_name!r} not found; workbook has {[s.name for s in sheets]}"
    )


def resolve_sheet_part(zf: zipfile.ZipFile, sheet_name: str) -> str:
    return resolve_sheet(zf, sheet_name).part


# ---------------------------------------------------------------------------
# Shared strings


@dataclass
class SharedStrings:
    texts: list[str] = field(default_factory=list)
    # text -> index of the first entry that is plain (no rich runs / phonetics),
    # i.e. safe to reference for a cell that must hold exactly that text.
    plain_index: dict[str, int] = field(default_factory=dict)


_SI_RE = re.compile(r"<si(?:\s[^>]*)?(?:/>|>(.*?)</si>)", re.S)
_RPH_RE = re.compile(r"<rPh\b.*?</rPh>", re.S)
_T_RE = re.compile(r"<t(?:\s[^>]*)?(?:/>|>(.*?)</t>)", re.S)
_PLAIN_SI_RE = re.compile(r"^\s*<t(?:\s[^>]*)?(?:/>|>.*?</t>)\s*$", re.S)


def parse_shared_strings(data: bytes) -> SharedStrings:
    text = data.decode("utf-8")
    out = SharedStrings()
    for i, m in enumerate(_SI_RE.finditer(text)):
        inner = m.group(1) or ""
        stripped = _RPH_RE.sub("", inner)
        value = decode_text("".join(t.group(1) or "" for t in _T_RE.finditer(stripped)))
        out.texts.append(value)
        if _PLAIN_SI_RE.match(inner):
            out.plain_index.setdefault(value, i)
    return out


def load_shared_strings(zf: zipfile.ZipFile) -> SharedStrings:
    part = _workbook_related_part(zf, REL_SHARED_STRINGS)
    if part is None or part not in zf.namelist():
        return SharedStrings()
    return parse_shared_strings(zf.read(part))


# ---------------------------------------------------------------------------
# Sheet XML splitting and cell scanning


@dataclass(frozen=True)
class SheetCell:
    row: int
    col: int
    text: str  # raw text; "" when blank. Numbers keep their lexical <v> form.
    is_formula: bool
    style: Optional[str]
    cell_type: Optional[str]  # the t attribute (s, str, inlineStr, b, e, n) or None


_SHEETDATA_OPEN_RE = re.compile(rb"<sheetData(?=[\s>/])")


def split_sheet_xml(data: bytes) -> tuple[bytes, str, bytes]:
    """Split a worksheet part into (prefix, sheetData inner text, suffix).

    prefix ends with the <sheetData> start tag, suffix starts with
    </sheetData>. For an empty self-closing <sheetData/> the tag is expanded.
    Only the sheetData body is decoded; prefix and suffix stay bytes.
    """
    m = _SHEETDATA_OPEN_RE.search(data)
    if m is None:
        raise XlsxPatchError("worksheet has no unprefixed <sheetData> element")
    tag_end = data.index(b">", m.end())
    if data[tag_end - 1 : tag_end] == b"/":
        prefix = data[: tag_end - 1].rstrip() + b">"
        return prefix, "", b"</sheetData>" + data[tag_end + 1 :]
    close = data.find(b"</sheetData>", tag_end)
    if close < 0:
        raise XlsxPatchError("worksheet <sheetData> is not closed")
    return data[: tag_end + 1], data[tag_end + 1 : close].decode("utf-8"), data[close:]


_ROW_RE = re.compile(r"<row\b([^>]*?)(?:/>|>(.*?)</row>)", re.S)
_CELL_RE = re.compile(r"<c\b([^>]*?)(?:/>|>(.*?)</c>)", re.S)
_ROW_R_RE = re.compile(r'(?<![\w:-])r="(\d+)"')
_CELL_R_RE = re.compile(r'(?<![\w:-])r="([A-Za-z]+)(\d+)"')
_T_ATTR_RE = re.compile(r'\s+(?<![\w:-])t="([^"]*)"')
_S_ATTR_RE = re.compile(r'(?<![\w:-])s="([^"]*)"')
_V_RE = re.compile(r"<v(?:\s[^>]*)?(?:/>|>(.*?)</v>)", re.S)
_IS_RE = re.compile(r"<is\b.*?</is>|<is\s*/>", re.S)
_F_RE = re.compile(r"<f\b[^>]*?(?:/>|>.*?</f>)", re.S)
_F_OPEN_RE = re.compile(r"<f\b([^>]*?)/?>")


def _cell_text(cell_type: Optional[str], inner: str, shared: Optional[list[str]]) -> str:
    if cell_type == "inlineStr":
        im = _IS_RE.search(inner)
        if not im:
            return ""
        stripped = _RPH_RE.sub("", im.group(0))
        return decode_text("".join(t.group(1) or "" for t in _T_RE.finditer(stripped)))
    vm = _V_RE.search(inner)
    if not vm or vm.group(1) is None:
        return ""
    raw = vm.group(1)
    if cell_type == "s":
        if shared is None:
            raise XlsxPatchError("sheet uses shared strings but none were supplied")
        try:
            return shared[int(raw)]
        except (ValueError, IndexError):
            raise XlsxPatchError(f"bad shared string index {raw!r}") from None
    return decode_text(raw)


def iter_sheet_cells(body: str, shared: Optional[list[str]] = None) -> Iterator[SheetCell]:
    """Yield every <c> in a sheetData body, in document order.

    Tolerates omitted r attributes (implicit numbering). This is a generator
    so a caller can stream through a very large sheet without materialising it.
    """
    prev_row = 0
    for rm in _ROW_RE.finditer(body):
        rattr = _ROW_R_RE.search(rm.group(1))
        row = int(rattr.group(1)) if rattr else prev_row + 1
        prev_row = row
        inner = rm.group(2)
        if not inner:
            continue
        prev_col = 0
        for cm in _CELL_RE.finditer(inner):
            cattrs = cm.group(1)
            ref = _CELL_R_RE.search(cattrs)
            col = col_to_num(ref.group(1)) if ref else prev_col + 1
            prev_col = col
            tm = _T_ATTR_RE.search(cattrs)
            ctype = tm.group(1) if tm else None
            cinner = cm.group(2) or ""
            sm = _S_ATTR_RE.search(cattrs)
            yield SheetCell(
                row=row,
                col=col,
                text=_cell_text(ctype, cinner, shared) if cinner else "",
                is_formula=bool(cinner) and _F_RE.search(cinner) is not None,
                style=sm.group(1) if sm else None,
                cell_type=ctype,
            )


@dataclass
class LoadedSheet:
    info: SheetInfo
    cells: dict[CellKey, SheetCell]  # every cell that has text or a formula
    max_row: int
    max_col: int
    merges: list[tuple[int, int, int, int]]  # (row1, col1, row2, col2)

    def text(self, row: int, col: int) -> str:
        c = self.cells.get((row, col))
        return c.text if c else ""


_MERGE_BLOCK_RE = re.compile(rb"<mergeCells\b[^>]*?>(.*?)</mergeCells>", re.S)
_MERGE_REF_RE = re.compile(rb'<mergeCell\b[^>]*?ref="([^"]+)"')


def parse_merges(suffix: bytes) -> list[tuple[int, int, int, int]]:
    out = []
    block = _MERGE_BLOCK_RE.search(suffix)
    if not block:
        return out
    for m in _MERGE_REF_RE.finditer(block.group(1)):
        ref = m.group(1).decode("ascii")
        a, _, b = ref.partition(":")
        r1, c1 = parse_ref(a)
        r2, c2 = parse_ref(b or a)
        out.append((r1, c1, r2, c2))
    return out


def load_sheet(src_path: Union[str, os.PathLike], sheet_name: str) -> LoadedSheet:
    """Read a sheet's cell texts without any object model.

    Only the sheetData slice is decoded and scanned; the (possibly enormous)
    conditional-formatting section after it is searched only for <mergeCells>.
    """
    with zipfile.ZipFile(src_path) as zf:
        info = resolve_sheet(zf, sheet_name)
        shared = load_shared_strings(zf).texts
        data = zf.read(info.part)
    _, body, suffix = split_sheet_xml(data)
    cells: dict[CellKey, SheetCell] = {}
    max_row = max_col = 0
    for c in iter_sheet_cells(body, shared):
        if c.text or c.is_formula:
            cells[(c.row, c.col)] = c
        max_row = max(max_row, c.row)
        max_col = max(max_col, c.col)
    return LoadedSheet(info, cells, max_row, max_col, parse_merges(suffix))


def read_cell_texts(
    src_path: Union[str, os.PathLike],
    sheet_name: str,
    refs: Optional[Iterable[CellRef]] = None,
) -> dict[CellKey, str]:
    """Raw texts of the requested cells (blank -> ""), or of all non-blank cells."""
    sheet = load_sheet(src_path, sheet_name)
    if refs is None:
        return {k: c.text for k, c in sheet.cells.items()}
    return {k: sheet.text(*k) for k in (_normalize_key(r) for r in refs)}


# ---------------------------------------------------------------------------
# Patching


@dataclass
class PatchResult:
    part: str
    written: int = 0
    cleared: int = 0
    unchanged: int = 0
    created_cells: int = 0
    created_rows: int = 0
    shared_string_refs: int = 0
    inline_strings: int = 0
    formulas_overwritten: int = 0
    changed_parts: tuple[str, ...] = ()


def _normalize_edits(edits: Edits) -> dict[CellKey, Optional[str]]:
    out: dict[CellKey, Optional[str]] = {}
    for key, value in edits.items():
        k = _normalize_key(key)
        if k in out:
            raise ValueError(f"duplicate edit for {format_ref(*k)}")
        if value is not None:
            if not isinstance(value, str):
                raise TypeError(f"{format_ref(*k)}: value must be str or None, got {type(value).__name__}")
            if value == "":
                value = None
            elif len(value) > MAX_CELL_CHARS:
                raise ValueError(f"{format_ref(*k)}: text longer than {MAX_CELL_CHARS} chars")
            else:
                try:
                    encode_text(value)
                except ValueError as e:
                    raise ValueError(f"{format_ref(*k)}: {e}") from None
        out[k] = value
    return out


class _Patcher:
    def __init__(
        self,
        shared: SharedStrings,
        *,
        allow_formula_overwrite: bool,
        overwrite_nonblank: bool,
        reuse_shared_strings: bool,
        new_cell_style: Optional[int],
    ):
        self.shared = shared
        self.allow_formula = allow_formula_overwrite
        self.overwrite_nonblank = overwrite_nonblank
        self.reuse = reuse_shared_strings
        self.new_cell_style = new_cell_style
        self.result = PatchResult(part="")
        self.overwritten_formulas: set[CellKey] = set()

    # -- cell rendering -----------------------------------------------------

    def _content(self, text: Optional[str]) -> tuple[str, str]:
        """(t attribute text, child xml) for a value; ('','') when blank."""
        if text is None:
            return "", ""
        idx = self.shared.plain_index.get(text) if self.reuse else None
        if idx is not None:
            self.result.shared_string_refs += 1
            return ' t="s"', f"<v>{idx}</v>"
        self.result.inline_strings += 1
        return ' t="inlineStr"', f'<is><t xml:space="preserve">{encode_text(text)}</t></is>'

    def _render_cell(self, attrs: str, kept_children: str, text: Optional[str]) -> str:
        tattr, child = self._content(text)
        body = child + kept_children
        if body:
            return f"<c{attrs}{tattr}>{body}</c>"
        return f"<c{attrs}/>"

    def _patch_existing_cell(self, key: CellKey, cm: re.Match, text: Optional[str]) -> Optional[str]:
        """New XML for an existing cell, or None to leave it untouched."""
        attrs = cm.group(1)
        inner = cm.group(2) or ""
        ref = format_ref(*key)
        fm = _F_OPEN_RE.search(inner) if inner else None
        if fm is not None:
            fattrs = _attrs(fm.group(1))
            if not self.allow_formula:
                raise FormulaOverwriteError(
                    f"{ref} contains a formula; pass allow_formula_overwrite=True to replace it"
                )
            if fattrs.get("t") == "array" or ("ref" in fattrs and fattrs.get("t") == "shared"):
                raise FormulaOverwriteError(
                    f"{ref} is the master of a shared/array formula; refusing to remove it"
                )
            self.overwritten_formulas.add(key)
            self.result.formulas_overwritten += 1
        else:
            tm = _T_ATTR_RE.search(attrs)
            ctype = tm.group(1) if tm else None
            current = _cell_text(ctype, inner, self.shared.texts) if inner else ""
            # Already holds this value as text (a numeric cell reading "5" is not
            # the text "5", so only text-typed cells count) or is already blank.
            already_text = text is not None and ctype in ("s", "inlineStr", "str") and current == text
            already_blank = text is None and current == ""
            if already_text or already_blank:
                self.result.unchanged += 1
                return None
            if current != "" and not self.overwrite_nonblank:
                raise XlsxPatchError(f"{ref} is not blank and overwrite_nonblank=False")
        kept = inner
        if kept:
            kept = _F_RE.sub("", kept)
            kept = _V_RE.sub("", kept)
            kept = _IS_RE.sub("", kept)
        new_attrs = _T_ATTR_RE.sub("", attrs)
        if text is None:
            self.result.cleared += 1
        else:
            self.result.written += 1
        return self._render_cell(new_attrs, kept, text)

    def _new_cell(self, key: CellKey, row_attrs: str, text: str) -> str:
        style = self.new_cell_style
        if style is None:
            ra = _attrs(row_attrs)
            if ra.get("customFormat") in ("1", "true") and "s" in ra:
                style = int(ra["s"])
        sattr = f' s="{style}"' if style is not None else ""
        self.result.created_cells += 1
        self.result.written += 1
        return self._render_cell(f' r="{format_ref(*key)}"{sattr}', "", text)

    # -- row / body level ---------------------------------------------------

    def _patch_row(self, row: int, rm: re.Match, row_edits: dict[int, Optional[str]]) -> str:
        attrs = rm.group(1)
        inner = rm.group(2) or ""
        out: list[str] = []
        pos = 0
        pending = sorted(row_edits)
        pi = 0
        prev_col = 0
        for cm in _CELL_RE.finditer(inner):
            ref = _CELL_R_RE.search(cm.group(1))
            if ref is None:
                raise XlsxPatchError(f"row {row} has a cell without an r attribute; cannot patch safely")
            col = col_to_num(ref.group(1))
            if int(ref.group(2)) != row:
                raise XlsxPatchError(f"cell {ref.group(0)} sits in row {row}")
            if col <= prev_col:
                raise XlsxPatchError(f"row {row} cells are not in ascending column order")
            prev_col = col
            while pi < len(pending) and pending[pi] < col:
                self._emit_new(out, inner, pos, cm.start(), row, pending[pi], attrs, row_edits)
                pos = cm.start()
                pi += 1
            if pi < len(pending) and pending[pi] == col:
                new = self._patch_existing_cell((row, col), cm, row_edits[col])
                out.append(inner[pos : cm.start()])
                out.append(new if new is not None else cm.group(0))
                pos = cm.end()
                pi += 1
        while pi < len(pending):
            self._emit_new(out, inner, pos, len(inner), row, pending[pi], attrs, row_edits)
            pos = len(inner)
            pi += 1
        out.append(inner[pos:])
        new_inner = "".join(out)
        new_attrs = self._widen_spans(attrs, [c for c in row_edits if row_edits[c] is not None])
        if new_inner == inner and new_attrs == attrs:
            return rm.group(0)
        return f"<row{new_attrs}>{new_inner}</row>"

    def _emit_new(self, out, inner, pos, upto, row, col, row_attrs, row_edits) -> None:
        text = row_edits[col]
        out.append(inner[pos:upto])
        if text is None:  # clearing a cell that does not exist is a no-op
            self.result.unchanged += 1
            return
        out.append(self._new_cell((row, col), row_attrs, text))

    @staticmethod
    def _widen_spans(attrs: str, cols: list[int]) -> str:
        sm = re.search(r'(?<![\w:-])spans="(\d+):(\d+)"', attrs)
        if not sm or not cols:
            return attrs
        lo, hi = int(sm.group(1)), int(sm.group(2))
        nlo, nhi = min(lo, min(cols)), max(hi, max(cols))
        if (nlo, nhi) == (lo, hi):
            return attrs
        return attrs[: sm.start()] + f'spans="{nlo}:{nhi}"' + attrs[sm.end() :]

    def patch_body(self, body: str, edits: dict[CellKey, Optional[str]]) -> str:
        by_row: dict[int, dict[int, Optional[str]]] = {}
        for (r, c), v in edits.items():
            by_row.setdefault(r, {})[c] = v
        pending = sorted(by_row)
        pi = 0
        out: list[str] = []
        pos = 0
        prev_row = 0
        for rm in _ROW_RE.finditer(body):
            rattr = _ROW_R_RE.search(rm.group(1))
            if rattr is None:
                raise XlsxPatchError("sheet has a row without an r attribute; cannot patch safely")
            row = int(rattr.group(1))
            if row <= prev_row:
                raise XlsxPatchError(f"rows are not in ascending order at row {row}")
            prev_row = row
            while pi < len(pending) and pending[pi] < row:
                self._emit_new_row(out, body, pos, rm.start(), pending[pi], by_row[pending[pi]])
                pos = rm.start()
                pi += 1
            if pi < len(pending) and pending[pi] == row:
                out.append(body[pos : rm.start()])
                out.append(self._patch_row(row, rm, by_row[row]))
                pos = rm.end()
                pi += 1
        while pi < len(pending):
            self._emit_new_row(out, body, pos, len(body), pending[pi], by_row[pending[pi]])
            pos = len(body)
            pi += 1
        out.append(body[pos:])
        return "".join(out)

    def _emit_new_row(self, out, body, pos, upto, row, row_edits) -> None:
        cells = []
        for col in sorted(row_edits):
            if row_edits[col] is None:
                self.result.unchanged += 1
                continue
            cells.append(self._new_cell((row, col), "", row_edits[col]))
        out.append(body[pos:upto])
        if not cells:
            return
        out.append(f'<row r="{row}">{"".join(cells)}</row>')
        self.result.created_rows += 1


def _grow_dimension(prefix: bytes, rows: set[int], cols: set[int]) -> bytes:
    m = re.search(rb'<dimension\s+ref="([^"]+)"\s*/>', prefix)
    if not m or not rows:
        return prefix
    a, _, b = m.group(1).decode("ascii").partition(":")
    r1, c1 = parse_ref(a)
    r2, c2 = parse_ref(b or a)
    nr1, nr2 = min(r1, min(rows)), max(r2, max(rows))
    nc1, nc2 = min(c1, min(cols)), max(c2, max(cols))
    if (nr1, nc1, nr2, nc2) == (r1, c1, r2, c2):
        return prefix
    ref = f"{format_ref(nr1, nc1)}:{format_ref(nr2, nc2)}"
    return prefix[: m.start()] + f'<dimension ref="{ref}"/>'.encode() + prefix[m.end() :]


def _prune_calc_chain(data: bytes, sheet_id: int, remove: set[CellKey]) -> bytes:
    """Drop calcChain entries for `remove` cells of sheet `sheet_id`.

    calcChain entries inherit the i (sheet id) attribute from the previous
    entry when it is omitted, so after dropping an entry a kept entry that
    relied on the dropped one's i must state it explicitly.
    """
    text = data.decode("utf-8")
    out: list[str] = []
    pos = 0
    cur_i: Optional[int] = None  # effective sheet id of the entry being read
    emitted_i: Optional[int] = None  # effective sheet id of the last kept entry
    for m in re.finditer(r"<c\b([^>]*?)/>", text):
        a = _attrs(m.group(1))
        if "i" in a:
            cur_i = int(a["i"])
        out.append(text[pos : m.start()])
        pos = m.end()
        if cur_i == sheet_id and parse_ref(a["r"]) in remove:
            continue
        attrs = m.group(1)
        if "i" not in a and cur_i != emitted_i:
            attrs = re.sub(r'^(\s+r="[^"]+")', rf'\1 i="{cur_i}"', attrs, count=1)
        emitted_i = cur_i
        out.append(f"<c{attrs}/>")
    out.append(text[pos:])
    return "".join(out).encode("utf-8")


def _check_wellformed(prefix: bytes, body: str) -> None:
    m = re.search(rb"<worksheet\b[^>]*>", prefix)
    if not m:
        raise XlsxPatchError("worksheet root element not found")
    wrapper = m.group(0) + b"<sheetData>" + body.encode("utf-8") + b"</sheetData></worksheet>"
    try:
        etree.fromstring(wrapper, etree.XMLParser(huge_tree=True))
    except etree.XMLSyntaxError as e:  # pragma: no cover - would indicate a patcher bug
        raise XlsxPatchError(f"patched sheetData is not well-formed XML: {e}") from None


def _self_check(
    old_cells: dict[CellKey, SheetCell],
    new_body: str,
    shared: list[str],
    edits: dict[CellKey, Optional[str]],
    overwritten_formulas: set[CellKey],
) -> None:
    new_cells = {(c.row, c.col): c for c in iter_sheet_cells(new_body, shared)}
    for key, c in new_cells.items():
        if key in edits:
            continue
        old = old_cells.get(key)
        if old is None or (old.text, old.is_formula, old.style, old.cell_type) != (
            c.text,
            c.is_formula,
            c.style,
            c.cell_type,
        ):
            raise XlsxPatchError(f"self-check: untouched cell {format_ref(*key)} changed")
    for key in old_cells:
        if key not in edits and key not in new_cells:
            raise XlsxPatchError(f"self-check: untouched cell {format_ref(*key)} disappeared")
    for key, text in edits.items():
        c = new_cells.get(key)
        got = c.text if c else ""
        if got != (text or ""):
            raise XlsxPatchError(f"self-check: {format_ref(*key)} reads back differently than written")
        if c is not None and c.is_formula and key not in overwritten_formulas:
            raise XlsxPatchError(f"self-check: {format_ref(*key)} still holds a formula")


def patch_workbook(
    src_path: Union[str, os.PathLike],
    dst_path: Union[str, os.PathLike],
    sheet_name: str,
    edits: Edits,
    *,
    allow_formula_overwrite: bool = False,
    overwrite_nonblank: bool = True,
    reuse_shared_strings: bool = True,
    new_cell_style: Optional[int] = None,
    verify: bool = True,
) -> PatchResult:
    """Write `edits` into one sheet of `src_path`, saving the result as `dst_path`.

    edits maps (row, col) 1-based tuples, or A1 strings, to text; None or ""
    clears the cell (keeps its style, i.e. weekly off). Text is always stored as
    text, so a code like "12" stays a string.

    Existing cells keep every attribute except t; missing cells and rows are
    created in order (a new cell takes new_cell_style, else the row's own style
    when the row has customFormat, else none). Only the target worksheet part
    is rewritten - plus xl/calcChain.xml when allow_formula_overwrite replaced
    formula cells. Everything else is copied entry-for-entry.

    overwrite_nonblank=False refuses to replace a cell that already has content
    (useful to guarantee a fill-only run never clobbers PMO edits).
    """
    src = os.path.abspath(os.fspath(src_path))
    dst = os.path.abspath(os.fspath(dst_path))
    if os.path.normcase(src) == os.path.normcase(dst):
        raise XlsxPatchError("dst_path must differ from src_path; the source is never modified in place")
    norm = _normalize_edits(edits)

    with zipfile.ZipFile(src) as zin:
        info = resolve_sheet(zin, sheet_name)
        shared = load_shared_strings(zin)
        sheet_bytes = zin.read(info.part)
        calc_part = _workbook_related_part(zin, REL_CALC_CHAIN)
        prefix, body, suffix = split_sheet_xml(sheet_bytes)

        patcher = _Patcher(
            shared,
            allow_formula_overwrite=allow_formula_overwrite,
            overwrite_nonblank=overwrite_nonblank,
            reuse_shared_strings=reuse_shared_strings,
            new_cell_style=new_cell_style,
        )
        patcher.result.part = info.part
        new_body = patcher.patch_body(body, norm)
        result = patcher.result

        changed_parts: list[str] = []
        replacements: dict[str, bytes] = {}
        if new_body != body:
            if verify:
                old_cells = {(c.row, c.col): c for c in iter_sheet_cells(body, shared.texts)}
                _check_wellformed(prefix, new_body)
                _self_check(old_cells, new_body, shared.texts, norm, patcher.overwritten_formulas)
            touched = {k for k, v in norm.items() if v is not None}
            new_prefix = _grow_dimension(prefix, {r for r, _ in touched}, {c for _, c in touched})
            replacements[info.part] = new_prefix + new_body.encode("utf-8") + suffix
            changed_parts.append(info.part)
            if patcher.overwritten_formulas and calc_part and calc_part in zin.namelist():
                pruned = _prune_calc_chain(zin.read(calc_part), info.sheet_id, patcher.overwritten_formulas)
                if pruned != zin.read(calc_part):
                    replacements[calc_part] = pruned
                    changed_parts.append(calc_part)
        result.changed_parts = tuple(changed_parts)

        fd, tmp = tempfile.mkstemp(suffix=".xlsx.tmp", dir=os.path.dirname(dst) or ".")
        os.close(fd)
        try:
            with zipfile.ZipFile(tmp, "w") as zout:
                for zi in zin.infolist():
                    data = replacements.get(zi.filename)
                    if data is None:
                        data = zin.read(zi)
                    out_info = zipfile.ZipInfo(zi.filename, zi.date_time)
                    out_info.compress_type = zi.compress_type
                    out_info.external_attr = zi.external_attr
                    out_info.create_system = zi.create_system
                    out_info.comment = zi.comment
                    out_info.extra = zi.extra
                    zout.writestr(out_info, data)
            os.replace(tmp, dst)
        except BaseException:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise
    return result
