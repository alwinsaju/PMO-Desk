"""Test setup: put the task scripts, the shared libraries and the winter_lib test kit on sys.path
(the scripts import `_common`, `winter_lib` and `roster_lib` the same way when run directly)."""

import sys
from pathlib import Path

TASK = Path(__file__).resolve().parents[1]
SHARED = TASK.parent / "shared"
for p in (SHARED / "winter_lib" / "tests", SHARED, TASK / "tests", TASK / "scripts"):
    s = str(p)
    if s not in sys.path:
        sys.path.insert(0, s)
