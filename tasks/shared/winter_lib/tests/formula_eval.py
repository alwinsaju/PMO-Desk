"""
A small, restricted Excel formula evaluator for TESTS (real Excel / LibreOffice were not available).

It evaluates exactly the subset the winter workbooks use, with Excel semantics for the parts that matter here:

    operators   + - * / & = <> < > <= >=  unary - and --   (comparison/arithmetic broadcast over ranges)
    functions   IF AND OR NOT SUM COUNT MAX MIN SUMPRODUCT COUNTIF COUNTIFS SUMIF MATCH(exact) ISNUMBER ISERROR
                IFERROR MID LEN CHAR ABS
    references  A1, $A$1, A1:B2 and 'Sheet name'!A1:B2 (cross-sheet)

COUNTIF-style criteria support the comparison prefixes (>= <= <> > < =) and the wildcards ? * ~ ; a text wildcard
criterion matches TEXT cells only (a number, a blank or "" never matches "?*"), as in Excel. Blank cells read as 0
in arithmetic and as "" in text operations. Errors propagate (#N/A, #VALUE!, #DIV/0!, #NAME?, #REF!).

    ev = Evaluator(path)
    problems = ev.check()          # every formula cell: recalculated value must equal the cached value, no errors

Anything outside the subset raises `Unsupported` (a failing test), never a silent wrong answer. Limitation: this is
an independent re-implementation of the semantics, not Excel; keep the formulas simple and well known.
"""

from __future__ import annotations

import math
import re
from datetime import date, datetime
from typing import Any, Callable, Optional

import openpyxl
from openpyxl.utils import column_index_from_string, get_column_letter
from openpyxl.utils.datetime import to_excel


class Unsupported(Exception):
    pass


class XlErr:
    def __init__(self, code: str):
        self.code = code

    def __repr__(self) -> str:
        return self.code

    def __eq__(self, other: object) -> bool:
        return isinstance(other, XlErr) and other.code == self.code

    def __hash__(self) -> int:
        return hash(self.code)


NA, VALUE, DIV0, NAME, REF = XlErr("#N/A"), XlErr("#VALUE!"), XlErr("#DIV/0!"), XlErr("#NAME?"), XlErr("#REF!")


class Arr:
    """A 2-D array of scalars (a range or an array expression)."""

    def __init__(self, rows: list[list[Any]]):
        self.rows = rows

    @property
    def shape(self) -> tuple[int, int]:
        return len(self.rows), (len(self.rows[0]) if self.rows else 0)

    def flat(self):
        return [v for r in self.rows for v in r]


# ---------------------------------------------------------------- tokenizer

_TOKEN = re.compile(r"""
    (?P<ws>\s+)
  | (?P<str>"(?:[^"]|"")*")
  | (?P<ref>(?:(?:'(?:[^']|'')+'|[A-Za-z_][\w\.]*)!)?\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)(?![\w(])
  | (?P<num>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)
  | (?P<func>[A-Za-z_][\w\.]*)\(
  | (?P<bool>TRUE|FALSE)
  | (?P<op><=|>=|<>|[-+*/&=<>(),])
""", re.X)


def tokenize(text: str) -> list[tuple[str, str]]:
    pos, out = 0, []
    while pos < len(text):
        m = _TOKEN.match(text, pos)
        if not m:
            raise Unsupported(f"cannot tokenize {text[pos:pos + 20]!r} in {text[:60]!r}")
        pos = m.end()
        kind = m.lastgroup
        if kind == "ws":
            continue
        out.append((kind, m.group(kind)))
        if kind == "func":
            out.append(("op", "("))
    return out


# ---------------------------------------------------------------- semantics helpers


def is_text(v: Any) -> bool:
    return isinstance(v, str)


def to_num(v: Any):
    if isinstance(v, XlErr):
        return v
    if v is None:
        return 0
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return VALUE
    return VALUE


def to_text(v: Any):
    if isinstance(v, XlErr):
        return v
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, float) and v == int(v) and abs(v) < 1e15:
        return str(int(v))
    if isinstance(v, float):
        return repr(round(v, 12))
    return str(v)


def to_bool(v: Any):
    if isinstance(v, XlErr):
        return v
    if isinstance(v, str):
        if v.upper() in ("TRUE", "FALSE"):
            return v.upper() == "TRUE"
        return VALUE
    n = to_num(v)
    return n if isinstance(n, XlErr) else bool(n)


def _rank(v: Any) -> int:
    if isinstance(v, bool):
        return 2
    return 1 if isinstance(v, str) else 0


def compare(op: str, a: Any, b: Any):
    if isinstance(a, XlErr):
        return a
    if isinstance(b, XlErr):
        return b
    if a is None:
        a = "" if isinstance(b, str) else (False if isinstance(b, bool) else 0)
    if b is None:
        b = "" if isinstance(a, str) else (False if isinstance(a, bool) else 0)
    ra, rb = _rank(a), _rank(b)
    if ra != rb:
        c = (ra > rb) - (ra < rb)
    elif isinstance(a, str):
        x, y = a.casefold(), b.casefold()
        c = (x > y) - (x < y)
    else:
        c = (a > b) - (a < b)
    return {"=": c == 0, "<>": c != 0, "<": c < 0, ">": c > 0, "<=": c <= 0, ">=": c >= 0}[op]


def arith(op: str, a: Any, b: Any):
    x, y = to_num(a), to_num(b)
    if isinstance(x, XlErr):
        return x
    if isinstance(y, XlErr):
        return y
    if op == "+":
        return x + y
    if op == "-":
        return x - y
    if op == "*":
        return x * y
    if y == 0:
        return DIV0
    return x / y


def broadcast(fn: Callable[[Any, Any], Any], a: Any, b: Any):
    if not isinstance(a, Arr) and not isinstance(b, Arr):
        return fn(a, b)
    A = a if isinstance(a, Arr) else Arr([[a]])
    B = b if isinstance(b, Arr) else Arr([[b]])
    (r1, c1), (r2, c2) = A.shape, B.shape
    if (r1 not in (r2, 1) and r2 != 1) or (c1 not in (c2, 1) and c2 != 1):
        raise Unsupported(f"array shapes {A.shape} and {B.shape} do not broadcast")
    R, C = max(r1, r2), max(c1, c2)
    return Arr([[fn(A.rows[i if r1 > 1 else 0][j if c1 > 1 else 0], B.rows[i if r2 > 1 else 0][j if c2 > 1 else 0])
                 for j in range(C)] for i in range(R)])


def scalar(v: Any):
    if isinstance(v, Arr):
        if v.shape == (1, 1):
            return v.rows[0][0]
        return v.rows[0][0] if v.rows else None  # implicit intersection (not used by the workbooks)
    return v


def _wild_to_re(pat: str) -> re.Pattern:
    out, i = "", 0
    while i < len(pat):
        ch = pat[i]
        if ch == "~" and i + 1 < len(pat):
            out += re.escape(pat[i + 1])
            i += 2
            continue
        out += ".*" if ch == "*" else "." if ch == "?" else re.escape(ch)
        i += 1
    return re.compile("^" + out + "$", re.I | re.S)


def make_criterion(crit: Any) -> Callable[[Any], bool]:
    if isinstance(crit, bool):
        return lambda v: v is crit
    if isinstance(crit, (int, float)):
        return lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and v == crit
    s = to_text(crit)
    m = re.match(r"^(<=|>=|<>|<|>|=)?(.*)$", s, re.S)
    op, operand = (m.group(1) or "="), m.group(2)
    try:
        num = float(operand)
    except ValueError:
        num = None
    if num is not None:
        def f(v):
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                return op == "<>"  # text / blank vs a number criterion
            return {"=": v == num, "<>": v != num, "<": v < num, ">": v > num, "<=": v <= num, ">=": v >= num}[op]
        return f
    if operand == "" and op in ("=", "<>"):
        return (lambda v: v is None or v == "") if op == "=" else (lambda v: not (v is None or v == ""))
    rx = _wild_to_re(operand)

    def g(v):
        if isinstance(v, str):
            hit = bool(rx.match(v))
        else:
            hit = False
        if op == "=":
            return hit
        if op == "<>":
            return not hit
        if not isinstance(v, str):
            return False
        a, b = v.casefold(), operand.casefold()
        return {"<": a < b, ">": a > b, "<=": a <= b, ">=": a >= b}[op]
    return g


# ---------------------------------------------------------------- evaluator


class Evaluator:
    def __init__(self, path):
        self.path = path
        self.wf = openpyxl.load_workbook(path, data_only=False)
        self.wv = openpyxl.load_workbook(path, data_only=True)
        self.cache: dict[tuple[str, int, int], Any] = {}
        self.stack: set[tuple[str, int, int]] = set()
        self._asts: dict[str, Any] = {}

    # -- cells
    def raw(self, sheet: str, r: int, c: int):
        cell = self.wf[sheet].cell(row=r, column=c)
        v = cell.value
        if isinstance(v, (datetime, date)):
            return to_excel(v)
        return v

    def is_formula(self, sheet: str, r: int, c: int) -> bool:
        v = self.wf[sheet].cell(row=r, column=c).value
        return isinstance(v, str) and v.startswith("=") and self.wf[sheet].cell(row=r, column=c).data_type == "f"

    def value(self, sheet: str, r: int, c: int):
        key = (sheet, r, c)
        if key in self.cache:
            return self.cache[key]
        if not self.is_formula(sheet, r, c):
            v = self.raw(sheet, r, c)
            self.cache[key] = v
            return v
        if key in self.stack:
            raise Unsupported(f"circular reference at {sheet}!{get_column_letter(c)}{r}")
        self.stack.add(key)
        try:
            text = self.raw(sheet, r, c)[1:]
            v = scalar(self.eval_formula(text, sheet))
        finally:
            self.stack.discard(key)
        self.cache[key] = v
        return v

    def cached(self, sheet: str, r: int, c: int):
        return self.wv[sheet].cell(row=r, column=c).value

    # -- parsing (recursive descent over tokens)
    def eval_formula(self, text: str, sheet: str):
        saved = (getattr(self, "_toks", None), getattr(self, "_pos", 0), getattr(self, "_sheet", None))
        self._toks, self._pos, self._sheet = tokenize(text), 0, sheet
        try:
            val = self._expr()
            if self._pos != len(self._toks):
                raise Unsupported(f"trailing tokens in {text[:80]!r}")
            return val
        finally:
            self._toks, self._pos, self._sheet = saved

    def _peek(self):
        return self._toks[self._pos] if self._pos < len(self._toks) else (None, None)

    def _take(self):
        t = self._toks[self._pos]
        self._pos += 1
        return t

    def _binary_level(self, ops, sub, fn):
        left = sub()
        while self._peek()[0] == "op" and self._peek()[1] in ops:
            op = self._take()[1]
            right = sub()
            left = broadcast(lambda a, b, op=op: fn(op, a, b), left, right)
        return left

    def _expr(self):
        return self._binary_level(("=", "<>", "<", ">", "<=", ">="), self._concat, compare)

    def _concat(self):
        return self._binary_level(("&",), self._additive,
                                  lambda op, a, b: a if isinstance(a, XlErr) else b if isinstance(b, XlErr)
                                  else to_text(a) + to_text(b))

    def _additive(self):
        return self._binary_level(("+", "-"), self._term, arith)

    def _term(self):
        return self._binary_level(("*", "/"), self._unary, arith)

    def _unary(self):
        t = self._peek()
        if t == ("op", "-"):
            self._take()
            v = self._unary()
            return broadcast(lambda a, _: arith("-", 0, a), v, 0)
        if t == ("op", "+"):
            self._take()
            return self._unary()
        return self._primary()

    def _primary(self):
        kind, val = self._take()
        if kind == "num":
            return float(val) if ("." in val or "e" in val.lower()) else int(val)
        if kind == "str":
            return val[1:-1].replace('""', '"')
        if kind == "bool":
            return val == "TRUE"
        if kind == "ref":
            return self._ref(val)
        if kind == "op" and val == "(":
            v = self._expr()
            if self._take() != ("op", ")"):
                raise Unsupported("missing )")
            return v
        if kind == "func":
            self._take()  # the "(" token
            return self._call(val.upper())
        raise Unsupported(f"unexpected token {kind} {val!r}")

    def _args_lazy(self):
        """Parse the argument list into closures so IF can be lazy."""
        args = []
        if self._peek() == ("op", ")"):
            self._take()
            return args
        while True:
            start = self._pos
            depth = 0
            # find the extent of this argument
            i = self._pos
            while True:
                k, v = self._toks[i]
                if k == "op" and v == "(":
                    depth += 1
                elif k == "op" and v == ")":
                    if depth == 0:
                        break
                    depth -= 1
                elif k == "op" and v == "," and depth == 0:
                    break
                i += 1
            sub = self._toks[start:i]
            sheet = self._sheet
            args.append((sub, sheet))
            self._pos = i
            k, v = self._take()
            if v == ")":
                return args

    def _eval_sub(self, sub, sheet):
        saved = (self._toks, self._pos, self._sheet)
        self._toks, self._pos, self._sheet = sub, 0, sheet
        try:
            v = self._expr()
            if self._pos != len(self._toks):
                raise Unsupported("bad argument")
            return v
        finally:
            self._toks, self._pos, self._sheet = saved

    def _ref(self, text: str):
        sheet = self._sheet
        if "!" in text:
            sh, text = text.rsplit("!", 1)
            sheet = sh[1:-1].replace("''", "'") if sh.startswith("'") else sh
            if sheet not in self.wf.sheetnames:
                return REF
        parts = text.replace("$", "").upper().split(":")
        def rc(p):
            m = re.match(r"^([A-Z]+)(\d+)$", p)
            return int(m.group(2)), column_index_from_string(m.group(1))
        r1, c1 = rc(parts[0])
        r2, c2 = rc(parts[-1])
        if len(parts) == 1:
            return self.value(sheet, r1, c1)
        r1, r2 = sorted((r1, r2))
        c1, c2 = sorted((c1, c2))
        return Arr([[self.value(sheet, r, c) for c in range(c1, c2 + 1)] for r in range(r1, r2 + 1)])

    # -- functions
    def _call(self, name: str):
        args = self._args_lazy()
        ev = lambda a: self._eval_sub(*a)
        if name == "IF":
            cond = to_bool(scalar(ev(args[0])))
            if isinstance(cond, XlErr):
                return cond
            if cond:
                return ev(args[1])
            return ev(args[2]) if len(args) > 2 else False
        if name == "IFERROR":
            v = ev(args[0])
            return ev(args[1]) if isinstance(scalar(v), XlErr) else v
        vals = [ev(a) for a in args]
        fn = getattr(self, "f_" + name.lower().replace(".", "_"), None)
        if fn is None:
            raise Unsupported(f"function {name} is not supported by the test evaluator")
        return fn(*vals)

    @staticmethod
    def _flat(*vals):
        out = []
        for v in vals:
            out.extend(v.flat() if isinstance(v, Arr) else [v])
        return out

    def f_and(self, *v):
        flat = [x for x in self._flat(*v) if x is not None]
        for x in flat:
            if isinstance(x, XlErr):
                return x
        return all(bool(to_num(x)) if not isinstance(x, str) else True for x in flat)

    def f_or(self, *v):
        flat = [x for x in self._flat(*v) if x is not None]
        for x in flat:
            if isinstance(x, XlErr):
                return x
        return any(bool(to_num(x)) if not isinstance(x, str) else True for x in flat)

    def f_not(self, v):
        b = to_bool(scalar(v))
        return b if isinstance(b, XlErr) else not b

    def f_sum(self, *v):
        total = 0
        for x in self._flat(*v):
            if isinstance(x, XlErr):
                return x
            if isinstance(x, (int, float)) and not isinstance(x, bool):
                total += x
        return total

    def f_count(self, *v):
        return sum(1 for x in self._flat(*v) if isinstance(x, (int, float)) and not isinstance(x, bool))

    def f_max(self, *v):
        nums = [x for x in self._flat(*v) if isinstance(x, (int, float)) and not isinstance(x, bool)]
        return max(nums) if nums else 0

    def f_min(self, *v):
        nums = [x for x in self._flat(*v) if isinstance(x, (int, float)) and not isinstance(x, bool)]
        return min(nums) if nums else 0

    def f_abs(self, v):
        n = to_num(scalar(v))
        return n if isinstance(n, XlErr) else abs(n)

    def f_len(self, v):
        t = to_text(scalar(v))
        return t if isinstance(t, XlErr) else len(t)

    def f_char(self, v):
        n = to_num(scalar(v))
        return n if isinstance(n, XlErr) else chr(int(n))

    def f_mid(self, text, start, length):
        t, s, n = to_text(scalar(text)), to_num(scalar(start)), to_num(scalar(length))
        for x in (t, s, n):
            if isinstance(x, XlErr):
                return x
        if s < 1 or n < 0:
            return VALUE
        return t[int(s) - 1:int(s) - 1 + int(n)]

    def f_isnumber(self, v):
        if isinstance(v, Arr):
            return Arr([[isinstance(x, (int, float)) and not isinstance(x, bool) for x in r] for r in v.rows])
        return isinstance(v, (int, float)) and not isinstance(v, bool)

    def f_iserror(self, v):
        if isinstance(v, Arr):
            return Arr([[isinstance(x, XlErr) for x in r] for r in v.rows])
        return isinstance(v, XlErr)

    def f_match(self, lookup, rng, mtype=0):
        if scalar(mtype) != 0:
            raise Unsupported("only exact MATCH (type 0) is supported")
        if not isinstance(rng, Arr):
            rng = Arr([[rng]])
        flat = rng.flat()

        def one(x):
            if isinstance(x, XlErr):
                return x
            if x is None:
                return NA
            for i, y in enumerate(flat, 1):
                if y is None or isinstance(y, XlErr):
                    continue
                if isinstance(x, str) and isinstance(y, str):
                    if x.casefold() == y.casefold():
                        return i
                elif not isinstance(x, str) and not isinstance(y, str) and x == y:
                    return i
            return NA

        if isinstance(lookup, Arr):
            return Arr([[one(x) for x in r] for r in lookup.rows])
        return one(lookup)

    def f_sumproduct(self, *arrs):
        arrs = [a if isinstance(a, Arr) else Arr([[a]]) for a in arrs]
        shape = arrs[0].shape
        if any(a.shape != shape for a in arrs):
            return VALUE
        total = 0
        for i in range(shape[0]):
            for j in range(shape[1]):
                prod = 1
                for a in arrs:
                    x = a.rows[i][j]
                    if isinstance(x, XlErr):
                        return x
                    if isinstance(x, bool) or not isinstance(x, (int, float)):
                        x = 0
                    prod *= x
                total += prod
        return total

    def _crit_mask(self, rng, crit):
        if not isinstance(rng, Arr):
            rng = Arr([[rng]])
        crit = scalar(crit)
        if isinstance(crit, XlErr):
            return crit
        f = make_criterion(crit)
        return [[bool(f(v)) for v in r] for r in rng.rows]

    def f_countif(self, rng, crit):
        m = self._crit_mask(rng, crit)
        return m if isinstance(m, XlErr) else sum(sum(r) for r in m)

    def f_countifs(self, *args):
        if len(args) % 2:
            return VALUE
        masks = [self._crit_mask(args[i], args[i + 1]) for i in range(0, len(args), 2)]
        for m in masks:
            if isinstance(m, XlErr):
                return m
        shape = (len(masks[0]), len(masks[0][0]))
        if any((len(m), len(m[0])) != shape for m in masks):
            return VALUE
        return sum(1 for i in range(shape[0]) for j in range(shape[1]) if all(m[i][j] for m in masks))

    def f_sumif(self, rng, crit, sum_rng=None):
        m = self._crit_mask(rng, crit)
        if isinstance(m, XlErr):
            return m
        sr = sum_rng if sum_rng is not None else rng
        sr = sr if isinstance(sr, Arr) else Arr([[sr]])
        total = 0
        for i, row in enumerate(m):
            for j, hit in enumerate(row):
                if hit:
                    x = sr.rows[i][j]
                    if isinstance(x, XlErr):
                        return x
                    if isinstance(x, (int, float)) and not isinstance(x, bool):
                        total += x
        return total

    # -- whole-workbook check
    def formula_cells(self):
        for ws in self.wf.worksheets:
            for row in ws.iter_rows():
                for cell in row:
                    if cell.data_type == "f" and isinstance(cell.value, str) and cell.value.startswith("="):
                        yield ws.title, cell.row, cell.column

    def check(self, tolerance: float = 1e-9) -> list[str]:
        problems = []
        n = 0
        for sheet, r, c in self.formula_cells():
            n += 1
            where = f"{sheet}!{get_column_letter(c)}{r}"
            try:
                got = self.value(sheet, r, c)
            except Unsupported as e:
                problems.append(f"{where}: unsupported ({e})")
                continue
            if isinstance(got, XlErr):
                problems.append(f"{where}: evaluates to {got.code}")
                continue
            want = self.cached(sheet, r, c)
            if isinstance(got, bool) or isinstance(want, bool):
                ok = bool(got) == bool(want)
            elif isinstance(got, (int, float)) and isinstance(want, (int, float)):
                ok = abs(got - want) <= tolerance
            else:
                ok = (got or "") == (want or "")
            if not ok:
                problems.append(f"{where}: cached {want!r} != recalculated {got!r}")
        self.checked = n
        return problems
