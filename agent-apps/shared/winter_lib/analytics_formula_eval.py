"""
A small, restricted spreadsheet formula evaluator used to verify the analytics workbook.

Real Excel and LibreOffice were NOT available when the analytics plan was built, so the
workbook's formulas are checked here instead: every formula cell is recalculated from
the cell constants in the finished file and compared with the cached value stored in
the file. The evaluator only implements the functions the analytics workbook uses, on
purpose; an unsupported function or syntax is reported as an evaluation error (so it
can never silently pass).

Supported
    literals    numbers, "strings" (doubled quotes), TRUE / FALSE
    references  A1, $A$1, A1:B9, 'Sheet name'!A1:B9 (same-workbook, no 3-D, no whole columns)
    operators   + - * /  &  = <> < > <= >=  unary -  and parentheses
    functions   IF IFERROR AND OR NOT ISNA ISNUMBER ISBLANK INDEX MATCH(exact) COUNTIF
                COUNTIFS COUNTA COUNT SUM MAX MIN TRIM MID CHAR LEN ROWS

COUNTIF(S) criteria follow Excel: a leading <>, >=, <=, =, > or <; case-insensitive text;
the wildcards ? and * (so "?*" means "any non-empty text"); numbers compare numerically.

Limitation: this is an independent re-implementation, not Excel. It proves the formulas are
internally consistent and error-free under these semantics; the workbook is also written
with fullCalcOnLoad so Excel recomputes everything the first time the file is opened.
"""

from __future__ import annotations

import re
import warnings
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Callable, Optional

import openpyxl
from openpyxl.utils import column_index_from_string, get_column_letter

EPOCH = datetime(1899, 12, 30)


class ExcelError:
    """An Excel error value such as #N/A or #REF!."""

    def __init__(self, code: str):
        self.code = code

    def __repr__(self) -> str:
        return self.code

    def __eq__(self, other: object) -> bool:
        return isinstance(other, ExcelError) and other.code == self.code

    def __hash__(self) -> int:
        return hash(self.code)


NA = ExcelError("#N/A")
VALUE = ExcelError("#VALUE!")
REF = ExcelError("#REF!")
NAME = ExcelError("#NAME?")
DIV0 = ExcelError("#DIV/0!")


class FormulaError(Exception):
    """Unsupported or malformed formula (never swallowed by IFERROR)."""


@dataclass
class Range:
    sheet: str
    row0: int
    col0: int
    values: list[list[Any]]  # rows of cell values

    @property
    def rows(self) -> int:
        return len(self.values)

    @property
    def cols(self) -> int:
        return len(self.values[0]) if self.values else 0

    def flat(self) -> list[Any]:
        return [v for row in self.values for v in row]


# ---- tokenizer ---------------------------------------------------------------

_TOKEN = re.compile(
    r"""\s*(?:
      (?P<num>\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)
     |(?P<str>"(?:[^"]|"")*")
     |(?P<ref>(?:'(?:[^']|'')+'!|[A-Za-z_][A-Za-z0-9_.]*!)?\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)
     |(?P<func>[A-Za-z_][A-Za-z0-9_.]*)\s*\(
     |(?P<bool>TRUE|FALSE)\b
     |(?P<op><>|<=|>=|[-+*/&=<>(),])
    )""",
    re.X,
)


def _tokenize(src: str) -> list[tuple[str, str]]:
    pos, out = 0, []
    s = src
    while pos < len(s):
        if s[pos:].strip() == "":
            break
        m = _TOKEN.match(s, pos)
        if not m or m.end() == pos:
            raise FormulaError(f"cannot parse {s[pos:pos + 20]!r}")
        pos = m.end()
        for kind in ("num", "str", "ref", "func", "bool", "op"):
            if m.group(kind) is not None:
                out.append((kind, m.group(kind)))
                break
    return out


# ---- parser (AST as nested tuples) --------------------------------------------

class _Parser:
    def __init__(self, tokens: list[tuple[str, str]]):
        self.t = tokens
        self.i = 0

    def peek(self) -> Optional[tuple[str, str]]:
        return self.t[self.i] if self.i < len(self.t) else None

    def take(self) -> tuple[str, str]:
        tok = self.t[self.i]
        self.i += 1
        return tok

    def expect(self, op: str) -> None:
        tok = self.peek()
        if not tok or tok != ("op", op):
            raise FormulaError(f"expected {op!r}")
        self.i += 1

    def parse(self):
        node = self.comparison()
        if self.peek() is not None:
            raise FormulaError(f"unexpected {self.peek()[1]!r}")
        return node

    def comparison(self):
        left = self.concat()
        while self.peek() and self.peek()[0] == "op" and self.peek()[1] in ("=", "<>", "<", ">", "<=", ">="):
            op = self.take()[1]
            left = ("cmp", op, left, self.concat())
        return left

    def concat(self):
        left = self.additive()
        while self.peek() == ("op", "&"):
            self.take()
            left = ("cat", left, self.additive())
        return left

    def additive(self):
        left = self.term()
        while self.peek() and self.peek()[0] == "op" and self.peek()[1] in "+-" and len(self.peek()[1]) == 1:
            op = self.take()[1]
            left = ("arith", op, left, self.term())
        return left

    def term(self):
        left = self.unary()
        while self.peek() and self.peek()[0] == "op" and self.peek()[1] in ("*", "/"):
            op = self.take()[1]
            left = ("arith", op, left, self.unary())
        return left

    def unary(self):
        if self.peek() == ("op", "-"):
            self.take()
            return ("neg", self.unary())
        if self.peek() == ("op", "+"):
            self.take()
            return self.unary()
        return self.primary()

    def primary(self):
        tok = self.peek()
        if tok is None:
            raise FormulaError("unexpected end")
        kind, text = self.take()
        if kind == "num":
            return ("lit", float(text))
        if kind == "str":
            return ("lit", text[1:-1].replace('""', '"'))
        if kind == "bool":
            return ("lit", text == "TRUE")
        if kind == "ref":
            return ("ref", text)
        if kind == "func":
            name = text.upper()
            args = []
            if self.peek() == ("op", ")"):
                self.take()
                return ("call", name, args)
            while True:
                if self.peek() == ("op", ","):  # empty argument
                    args.append(("lit", None))
                else:
                    args.append(self.comparison())
                if self.peek() == ("op", ","):
                    self.take()
                    continue
                self.expect(")")
                break
            return ("call", name, args)
        if (kind, text) == ("op", "("):
            node = self.comparison()
            self.expect(")")
            return node
        raise FormulaError(f"unexpected {text!r}")


def parse_formula(formula: str):
    src = formula[1:] if formula.startswith("=") else formula
    return _Parser(_tokenize(src)).parse()


# ---- value helpers -------------------------------------------------------------

def to_serial(v: Any) -> Any:
    if isinstance(v, datetime):
        return (v - EPOCH).total_seconds() / 86400.0
    if isinstance(v, date):
        return float((datetime(v.year, v.month, v.day) - EPOCH).days)
    if isinstance(v, time):
        return (v.hour * 3600 + v.minute * 60 + v.second) / 86400.0
    if isinstance(v, timedelta):
        return v.total_seconds() / 86400.0
    return v


def num_to_text(x: float) -> str:
    if float(x).is_integer():
        return str(int(x))
    return repr(round(x, 15)).rstrip("0").rstrip(".")


def to_text(v: Any) -> Any:
    if isinstance(v, ExcelError):
        return v
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return num_to_text(float(v))
    return str(v)


def to_number(v: Any) -> Any:
    if isinstance(v, ExcelError):
        return v
    if v is None or v == "":
        return 0.0
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v))
    except ValueError:
        return VALUE


def truthy(v: Any) -> Any:
    if isinstance(v, ExcelError):
        return v
    if isinstance(v, str):
        if v.upper() in ("TRUE", "FALSE"):
            return v.upper() == "TRUE"
        return VALUE
    return bool(v) if v is not None else False


def _cmp_values(a: Any, b: Any) -> int:
    """-1, 0, 1 with Excel ordering: numbers < text < booleans; text case-insensitive."""
    def norm(x: Any, other: Any) -> Any:
        if x is None:
            if isinstance(other, str):
                return ""
            if isinstance(other, bool):
                return False
            return 0.0
        return x

    a2, b2 = norm(a, b), norm(b, a)

    def rank(x: Any) -> int:
        return 2 if isinstance(x, bool) else 1 if isinstance(x, str) else 0

    ra, rb = rank(a2), rank(b2)
    if ra != rb:
        return -1 if ra < rb else 1
    if ra == 1:
        x, y = a2.casefold(), b2.casefold()
    else:
        x, y = float(a2), float(b2)
    return (x > y) - (x < y)


# ---- criteria for COUNTIF(S) ---------------------------------------------------

def _wild_to_regex(pat: str) -> re.Pattern:
    out, i = [], 0
    while i < len(pat):
        ch = pat[i]
        if ch == "~" and i + 1 < len(pat):
            out.append(re.escape(pat[i + 1]))
            i += 2
            continue
        out.append(".*" if ch == "*" else "." if ch == "?" else re.escape(ch))
        i += 1
    return re.compile("^" + "".join(out) + "$", re.I | re.S)


def make_criterion(crit: Any) -> Callable[[Any], bool]:
    if isinstance(crit, bool):
        return lambda v: isinstance(v, bool) and v == crit
    if isinstance(crit, (int, float)):
        return lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and float(v) == float(crit)
    if crit is None:
        crit = ""
    s = str(crit)
    op = "="
    for cand in ("<>", ">=", "<=", "=", ">", "<"):
        if s.startswith(cand):
            op, s = cand, s[len(cand):]
            break
    try:
        num = float(s)
    except ValueError:
        num = None
    if num is not None:
        def num_match(v: Any) -> bool:
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                return op == "<>"
            x = float(v)
            return {"=": x == num, "<>": x != num, ">": x > num, "<": x < num, ">=": x >= num, "<=": x <= num}[op]
        return num_match
    rx = _wild_to_regex(s) if any(ch in s for ch in "*?~") else None

    def text_match(v: Any) -> bool:
        if op in ("=", "<>"):
            if v is None:
                eq = s == ""
            elif isinstance(v, str):
                eq = bool(rx.match(v)) if rx else v.casefold() == s.casefold()
            else:
                eq = False if s != "" else False
            return eq if op == "=" else not eq
        if not isinstance(v, str):
            return False
        c = (v.casefold() > s.casefold()) - (v.casefold() < s.casefold())
        return {">": c > 0, "<": c < 0, ">=": c >= 0, "<=": c <= 0}[op]
    return text_match


# ---- workbook model ------------------------------------------------------------

@dataclass
class _Sheet:
    name: str
    consts: dict[tuple[int, int], Any] = field(default_factory=dict)
    formulas: dict[tuple[int, int], str] = field(default_factory=dict)


class Workbook:
    """Cell constants and formulas of a finished .xlsx plus an evaluator for the formulas."""

    def __init__(self, path: str | Path):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            wb = openpyxl.load_workbook(path, data_only=False)
            cached_wb = openpyxl.load_workbook(path, data_only=True)
        self.path = str(path)
        self.sheets: dict[str, _Sheet] = {}
        self.cached: dict[tuple[str, int, int], Any] = {}
        for ws in wb.worksheets:
            sh = _Sheet(ws.title)
            cws = cached_wb[ws.title]
            for row in ws.iter_rows():
                for c in row:
                    v = c.value
                    if v is None:
                        continue
                    if isinstance(v, str) and v.startswith("=") and c.data_type == "f":
                        sh.formulas[(c.row, c.column)] = v
                        self.cached[(ws.title, c.row, c.column)] = to_serial(cws.cell(c.row, c.column).value)
                    elif hasattr(v, "text") and c.data_type == "f":  # ArrayFormula
                        sh.formulas[(c.row, c.column)] = "=" + str(v.text).lstrip("=")
                    else:
                        sh.consts[(c.row, c.column)] = to_serial(v)
            self.sheets[ws.title] = sh
        self._ast: dict[str, Any] = {}
        self._values: dict[tuple[str, int, int], Any] = {}
        self._active: set[tuple[str, int, int]] = set()
        wb.close()
        cached_wb.close()

    # -- cell access --
    def cell(self, sheet: str, row: int, col: int) -> Any:
        sh = self.sheets.get(sheet)
        if sh is None:
            return REF
        key = (sheet, row, col)
        if (row, col) in sh.formulas:
            if key in self._values:
                return self._values[key]
            if key in self._active:
                raise FormulaError(f"circular reference at {sheet}!{get_column_letter(col)}{row}")
            self._active.add(key)
            try:
                val = self._eval_formula(sheet, sh.formulas[(row, col)])
            finally:
                self._active.discard(key)
            self._values[key] = val
            return val
        return sh.consts.get((row, col))

    def _eval_formula(self, sheet: str, formula: str) -> Any:
        try:
            ast = self._ast.get(formula)
            if ast is None:
                ast = self._ast[formula] = parse_formula(formula)
            val = self._eval(ast, sheet)
            if isinstance(val, Range):
                val = val.values[0][0] if val.values else None
            return 0.0 if val is None else val
        except FormulaError as e:
            return ExcelError(f"#UNSUPPORTED({e})")

    # -- evaluation --
    def _range(self, ref: str, cur_sheet: str) -> Range | ExcelError:
        sheet = cur_sheet
        if "!" in ref:
            sname, ref = ref.rsplit("!", 1)
            sheet = sname[1:-1].replace("''", "'") if sname.startswith("'") else sname
        ref = ref.replace("$", "")
        a, _, b = ref.partition(":")
        b = b or a
        ma, mb = re.match(r"([A-Z]+)(\d+)$", a), re.match(r"([A-Z]+)(\d+)$", b)
        c0, r0 = column_index_from_string(ma.group(1)), int(ma.group(2))
        c1, r1 = column_index_from_string(mb.group(1)), int(mb.group(2))
        if sheet not in self.sheets:
            return REF
        r0, r1, c0, c1 = min(r0, r1), max(r0, r1), min(c0, c1), max(c0, c1)
        values = [[self.cell(sheet, r, c) for c in range(c0, c1 + 1)] for r in range(r0, r1 + 1)]
        return Range(sheet, r0, c0, values)

    def _scalar(self, v: Any) -> Any:
        if isinstance(v, Range):
            if v.rows == 1 and v.cols == 1:
                return v.values[0][0]
            return VALUE
        return v

    def _eval(self, node, sheet: str) -> Any:
        kind = node[0]
        if kind == "lit":
            return node[1]
        if kind == "ref":
            return self._range(node[1], sheet)
        if kind == "neg":
            n = to_number(self._scalar(self._eval(node[1], sheet)))
            return n if isinstance(n, ExcelError) else -n
        if kind == "arith":
            a = to_number(self._scalar(self._eval(node[2], sheet)))
            b = to_number(self._scalar(self._eval(node[3], sheet)))
            if isinstance(a, ExcelError):
                return a
            if isinstance(b, ExcelError):
                return b
            if node[1] == "+":
                return a + b
            if node[1] == "-":
                return a - b
            if node[1] == "*":
                return a * b
            return DIV0 if b == 0 else a / b
        if kind == "cat":
            a = to_text(self._scalar(self._eval(node[1], sheet)))
            b = to_text(self._scalar(self._eval(node[2], sheet)))
            if isinstance(a, ExcelError):
                return a
            if isinstance(b, ExcelError):
                return b
            return a + b
        if kind == "cmp":
            a = self._scalar(self._eval(node[2], sheet))
            b = self._scalar(self._eval(node[3], sheet))
            if isinstance(a, ExcelError):
                return a
            if isinstance(b, ExcelError):
                return b
            c = _cmp_values(a, b)
            return {"=": c == 0, "<>": c != 0, "<": c < 0, ">": c > 0, "<=": c <= 0, ">=": c >= 0}[node[1]]
        if kind == "call":
            return self._call(node[1], node[2], sheet)
        raise FormulaError(f"bad node {kind}")

    def _args(self, args, sheet):
        return [self._eval(a, sheet) for a in args]

    def _call(self, name: str, args, sheet: str) -> Any:
        ev = lambda a: self._scalar(self._eval(a, sheet))
        if name == "IF":
            cond = truthy(ev(args[0]))
            if isinstance(cond, ExcelError):
                return cond
            if cond:
                return ev(args[1]) if len(args) > 1 else True
            return ev(args[2]) if len(args) > 2 else False
        if name == "IFERROR":
            v = ev(args[0])
            return ev(args[1]) if isinstance(v, ExcelError) else v
        if name in ("AND", "OR"):
            vals = []
            for a in args:
                r = self._eval(a, sheet)
                items = r.flat() if isinstance(r, Range) else [r]
                for x in items:
                    if isinstance(x, ExcelError):
                        return x
                    if x is None or (isinstance(x, str) and isinstance(r, Range)):
                        continue
                    t = truthy(x)
                    if isinstance(t, ExcelError):
                        return t
                    vals.append(t)
            return all(vals) if name == "AND" else any(vals)
        if name == "NOT":
            t = truthy(ev(args[0]))
            return t if isinstance(t, ExcelError) else not t
        if name == "ISNA":
            return ev(args[0]) == NA
        if name == "ISNUMBER":
            v = ev(args[0])
            return isinstance(v, (int, float)) and not isinstance(v, bool)
        if name == "ISBLANK":
            return ev(args[0]) is None
        if name in ("COUNTA", "COUNT", "SUM", "MAX", "MIN"):
            items = []
            for a in args:
                r = self._eval(a, sheet)
                items += r.flat() if isinstance(r, Range) else [r]
            errs = [x for x in items if isinstance(x, ExcelError)]
            if errs and name != "COUNTA":
                return errs[0]
            if name == "COUNTA":
                return float(sum(1 for x in items if x is not None))  # a formula returning "" still counts
            nums = [float(x) for x in items if isinstance(x, (int, float)) and not isinstance(x, bool)]
            if name == "COUNT":
                return float(len(nums))
            if name == "SUM":
                return float(sum(nums))
            if not nums:
                return 0.0
            return max(nums) if name == "MAX" else min(nums)
        if name == "ROWS":
            r = self._eval(args[0], sheet)
            return float(r.rows) if isinstance(r, Range) else 1.0
        if name == "TRIM":
            v = to_text(ev(args[0]))
            return v if isinstance(v, ExcelError) else re.sub(" +", " ", v).strip(" ")
        if name == "LEN":
            v = to_text(ev(args[0]))
            return v if isinstance(v, ExcelError) else float(len(v))
        if name == "CHAR":
            n = to_number(ev(args[0]))
            return n if isinstance(n, ExcelError) else chr(int(n))
        if name == "MID":
            s = to_text(ev(args[0]))
            st, ln = to_number(ev(args[1])), to_number(ev(args[2]))
            for x in (s, st, ln):
                if isinstance(x, ExcelError):
                    return x
            if st < 1 or ln < 0:
                return VALUE
            return s[int(st) - 1:int(st) - 1 + int(ln)]
        if name == "MATCH":
            look = ev(args[0])
            rng = self._eval(args[1], sheet)
            mtype = to_number(ev(args[2])) if len(args) > 2 else 1.0
            if mtype != 0:
                raise FormulaError("MATCH supports only exact match (0)")
            if isinstance(look, ExcelError):
                return look
            if not isinstance(rng, Range):
                return NA
            for i, v in enumerate(rng.flat(), start=1):
                if v is not None and not isinstance(v, ExcelError) and look is not None and _cmp_values(v, look) == 0:
                    if isinstance(v, str) != isinstance(look, str):
                        continue
                    return float(i)
            return NA
        if name == "INDEX":
            rng = self._eval(args[0], sheet)
            if not isinstance(rng, Range):
                return VALUE
            r = to_number(ev(args[1])) if len(args) > 1 else 0.0
            c = to_number(ev(args[2])) if len(args) > 2 else None
            for x in (r, c):
                if isinstance(x, ExcelError):
                    return x
            r = int(r)
            if c is None:  # one-dimensional shortcut
                flat = rng.flat()
                if rng.rows == 1 or rng.cols == 1:
                    return flat[r - 1] if 1 <= r <= len(flat) else REF
                return REF
            c = int(c)
            if not (1 <= r <= rng.rows and 1 <= c <= rng.cols):
                return REF
            return rng.values[r - 1][c - 1]
        if name in ("COUNTIF", "COUNTIFS"):
            pairs = [(args[i], args[i + 1]) for i in range(0, len(args), 2)] if name == "COUNTIFS" else [(args[0], args[1])]
            if name == "COUNTIFS" and len(args) % 2:
                raise FormulaError("COUNTIFS needs range/criteria pairs")
            ranges, tests = [], []
            for rarg, carg in pairs:
                r = self._eval(rarg, sheet)
                if not isinstance(r, Range):
                    return VALUE
                crit = ev(carg)
                if isinstance(crit, ExcelError):
                    return crit
                ranges.append(r.flat())
                tests.append(make_criterion(crit))
            n = len(ranges[0])
            if any(len(r) != n for r in ranges):
                return VALUE
            return float(sum(1 for i in range(n) if all(t(r[i]) for r, t in zip(ranges, tests))))
        raise FormulaError(f"function {name} is not supported")

    # -- public --
    def formula_cells(self) -> list[tuple[str, int, int]]:
        return [(s.name, r, c) for s in self.sheets.values() for (r, c) in sorted(s.formulas)]

    def evaluate_all(self) -> dict[tuple[str, int, int], Any]:
        return {key: self.cell(*key) for key in self.formula_cells()}


@dataclass
class FormulaCheck:
    path: str
    formula_count: int = 0
    errors: list[str] = field(default_factory=list)  # formulas that evaluate to an error / unsupported
    mismatches: list[str] = field(default_factory=list)  # cached value != recalculated value

    @property
    def ok(self) -> bool:
        return not self.errors and not self.mismatches


def _same(cached: Any, calc: Any) -> bool:
    if isinstance(calc, ExcelError):
        return False
    if cached is None:
        cached = ""
    if calc is None:
        calc = ""
    if isinstance(calc, bool) or isinstance(cached, bool):
        return cached == calc
    if isinstance(calc, (int, float)) and isinstance(cached, (int, float)):
        return abs(float(calc) - float(cached)) < 1e-9
    return str(cached) == str(calc)


def _addr(sheet: str, row: int, col: int) -> str:
    return f"{sheet}!{get_column_letter(col)}{row}"


def check_workbook_formulas(path: str | Path) -> FormulaCheck:
    """Recalculate every formula in the file; list evaluation errors and cached-value mismatches."""
    wb = Workbook(path)
    out = FormulaCheck(str(path))
    values = wb.evaluate_all()
    out.formula_count = len(values)
    for key, calc in values.items():
        cached = wb.cached.get(key)
        where = _addr(*key)
        if isinstance(calc, ExcelError):
            out.errors.append(f"{where}: {calc.code}")
        elif isinstance(cached, str) and cached.startswith("#") and cached.endswith(("!", "?", "A")):
            out.errors.append(f"{where}: cached value {cached}")
        elif not _same(cached, calc):
            out.mismatches.append(f"{where}: cached {cached!r} != recalculated {calc!r}")
    return out
