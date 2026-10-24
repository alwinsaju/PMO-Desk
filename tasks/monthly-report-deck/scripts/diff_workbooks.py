"""Read-only diff between the agent-generated August workbook and the user's fixed copy.

Compares:
  - Trend analysis: every cell, plus month-block layout (row 1 headers, row 3 totals)
  - Incidents: keyed by Number (col A); compares all columns, focus Subcategory2
  - Charts / Org / Review Needed: quick cell diff summary

Read-only: openpyxl read_only + data_only, NEVER save (corrupts pivot caches).
"""
from __future__ import annotations

import sys
from collections import Counter, defaultdict

import openpyxl

ORIG = r"C:\Projects\AI OS\tasks\monthly-report-deck\output\Monthly Incidents Trend Analysis - August 2026.xlsx"
FIXED = r"C:\Users\alsaju\Downloads\Monthly Incidents Trend Analysis - August 2026.xlsx"

OUT = r"C:\Projects\AI OS\tasks\monthly-report-deck\output\workbook-diff.txt"


def norm(v):
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip()
        return s if s else None
    return v


def load(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    data = {}
    for ws in wb.worksheets:
        data[ws.title] = [list(r) for r in ws.iter_rows(values_only=True)]
    wb.close()
    return data


def main():
    orig = load(ORIG)
    fixed = load(FIXED)
    lines = []

    def emit(s=""):
        lines.append(str(s))

    # ---- Trend analysis ------------------------------------------------
    emit("=" * 80)
    emit("TREND ANALYSIS")
    emit("=" * 80)
    o, f = orig["Trend analysis"], fixed["Trend analysis"]
    emit(f"rows: orig={len(o)} fixed={len(f)}  cols: orig={max(len(r) for r in o)} fixed={max(len(r) for r in f)}")

    def colmap(rows, hdr_row=0):
        m = {}
        for ci, v in enumerate(rows[hdr_row]):
            if v is not None:
                m[ci] = v
        return m

    emit("\nMonth headers (row 1) ORIG : " + str(colmap(o)))
    emit("Month headers (row 1) FIXED: " + str(colmap(f)))
    emit("\nTotals (row 3) ORIG : " + str({i: v for i, v in enumerate(o[2]) if v is not None}))
    emit("Totals (row 3) FIXED: " + str({i: v for i, v in enumerate(f[2]) if v is not None}))

    # cell-level diff
    maxr = max(len(o), len(f))
    diffcells = []
    for ri in range(maxr):
        orow = o[ri] if ri < len(o) else []
        frow = f[ri] if ri < len(f) else []
        maxc = max(len(orow), len(frow))
        for ci in range(maxc):
            ov = norm(orow[ci]) if ci < len(orow) else None
            fv = norm(frow[ci]) if ci < len(frow) else None
            if ov != fv:
                diffcells.append((ri + 1, ci + 1, ov, fv))
    emit(f"\nChanged cells in Trend analysis: {len(diffcells)}")
    by_col = Counter(c for _, c, _, _ in diffcells)
    emit("Changed-cell count by column: " + str(sorted(by_col.items())))
    # group changes by row-band to see the pattern (labels rows 6+)
    by_row = defaultdict(list)
    for r, c, ov, fv in diffcells:
        by_row[r].append((c, ov, fv))
    for r in sorted(by_row)[:60]:
        emit(f"  R{r}: " + "; ".join(f"c{c}: {ov!r} -> {fv!r}" for c, ov, fv in by_row[r][:6]))

    # ---- Incidents ------------------------------------------------------
    emit("\n" + "=" * 80)
    emit("INCIDENTS")
    emit("=" * 80)
    o, f = orig["Incidents"], fixed["Incidents"]
    hdr = o[0]
    emit(f"rows: orig={len(o)} fixed={len(f)}")
    okey = {norm(r[0]): r for r in o[1:] if r and r[0] is not None}
    fkey = {norm(r[0]): r for r in f[1:] if r and r[0] is not None}
    emit(f"incident keys: orig={len(okey)} fixed={len(fkey)}")
    missing_in_fixed = sorted(set(okey) - set(fkey))
    missing_in_orig = sorted(set(fkey) - set(okey))
    emit(f"Numbers only in ORIG : {len(missing_in_fixed)} -> {missing_in_fixed[:20]}")
    emit(f"Numbers only in FIXED: {len(missing_in_orig)} -> {missing_in_orig[:20]}")

    sub_idx = hdr.index("Subcategory2")
    col_diffs = Counter()
    sub_changes = []
    sub_matrix = Counter()
    for k in sorted(set(okey) & set(fkey)):
        orow, frow = okey[k], fkey[k]
        for ci, name in enumerate(hdr):
            ov = norm(orow[ci]) if ci < len(orow) else None
            fv = norm(frow[ci]) if ci < len(frow) else None
            if ov != fv:
                col_diffs[name] += 1
                if name == "Subcategory2":
                    sub_changes.append((k, ov, fv))
                    sub_matrix[(str(ov), str(fv))] += 1
    emit("\nIncidents changed-cell count by column: " + str(dict(col_diffs)))
    emit(f"\nSubcategory2 changes: {len(sub_changes)}")
    emit("Transition matrix (orig -> fixed : count):")
    for (ov, fv), n in sorted(sub_matrix.items(), key=lambda x: -x[1]):
        emit(f"  {ov!r:45s} -> {fv!r:45s} : {n}")
    emit("\nFirst 120 Subcategory2 changes (Number, orig, fixed):")
    for k, ov, fv in sub_changes[:120]:
        emit(f"  {k}: {ov!r} -> {fv!r}")

    # ---- other sheets ----------------------------------------------------
    for sheet in ("Charts", "Org", "Review Needed"):
        emit("\n" + "=" * 80)
        emit(sheet.upper())
        emit("=" * 80)
        o, f = orig[sheet], fixed[sheet]
        maxr = max(len(o), len(f))
        n = 0
        samples = []
        for ri in range(maxr):
            orow = o[ri] if ri < len(o) else []
            frow = f[ri] if ri < len(f) else []
            maxc = max(len(orow), len(frow))
            for ci in range(maxc):
                ov = norm(orow[ci]) if ci < len(orow) else None
                fv = norm(frow[ci]) if ci < len(frow) else None
                if ov != fv:
                    n += 1
                    if len(samples) < 40:
                        samples.append(f"  R{ri+1}C{ci+1}: {ov!r} -> {fv!r}")
        emit(f"changed cells: {n}")
        emit("\n".join(samples))

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    print(f"wrote {OUT} ({len(lines)} lines)")


if __name__ == "__main__":
    sys.exit(main())
