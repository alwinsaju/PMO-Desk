"""Test setup: put the task scripts, the shared roster_lib and its synthetic-workbook test kit
on sys.path (the scripts import `_common` and `roster_lib` the same way when run directly)."""

import sys
from pathlib import Path

TASK = Path(__file__).resolve().parents[1]
SHARED = TASK.parent / "shared"
for p in (SHARED / "roster_lib" / "tests", SHARED, TASK / "tests", TASK / "scripts"):
    s = str(p)
    if s not in sys.path:
        sys.path.insert(0, s)
