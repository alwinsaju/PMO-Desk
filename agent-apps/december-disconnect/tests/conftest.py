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


import shutil  # noqa: E402

import pytest  # noqa: E402


@pytest.fixture(scope="session")
def draft_template(tmp_path_factory):
    """A task folder that went prepare -> analyze -> answers -> build_draft once (copied per test)."""
    from pipeline import Pipeline

    p = Pipeline(tmp_path_factory.mktemp("draft-template") / "t")
    p.run_to_draft()
    return p.root


@pytest.fixture()
def draft_world(draft_template, tmp_path):
    """A private copy of the drafted task folder."""
    from pipeline import Pipeline

    root = tmp_path / "t"
    shutil.copytree(draft_template, root)
    return Pipeline.adopt(root)
