import json
import os
from datetime import datetime, timezone

import pytest

from roster_lib import audit


NOW = datetime(2026, 2, 1, 12, 0, 0, 123456, tzinfo=timezone.utc)


def test_sha_and_file_record(tmp_path):
    p = tmp_path / "a.bin"
    p.write_bytes(b"hello")
    assert audit.sha256_file(p) == audit.sha256_text("hello")
    rec = audit.file_record(p)
    assert rec == {"name": "a.bin", "sha256": audit.sha256_text("hello"), "bytes": 5}
    assert audit.file_record(None) is None


def test_canonical_json_is_deterministic():
    assert audit.canonical_json({"b": 1, "a": [1, {"d": 2, "c": 3}]}) == '{"a":[1,{"c":3,"d":2}],"b":1}'


def test_run_id_deterministic_from_inputs_and_time():
    a = audit.new_run_id({"m": "x"}, NOW)
    assert a == audit.new_run_id({"m": "x"}, NOW)
    assert a != audit.new_run_id({"m": "y"}, NOW)
    assert a != audit.new_run_id({"m": "x"}, NOW.replace(microsecond=1))
    assert a.startswith("20260201T120000123456Z-") and len(a.split("-")[1]) == 8
    assert audit.new_run_id({}, NOW.replace(tzinfo=None)) == audit.new_run_id({}, NOW)


def test_iso_utc():
    assert audit.iso_utc(NOW) == "2026-02-01T12:00:00.123456Z"


def test_write_audit_appends_and_never_overwrites(tmp_path):
    e1 = {"run_id": "r1", "x": 1}
    rec1 = audit.write_audit(tmp_path, e1, {"approver": "a"})
    assert os.path.basename(rec1.entry_path) == "r1.json"
    first_bytes = open(rec1.entry_path, "rb").read()
    e2 = {"run_id": "r1", "x": 2}  # same id: must not overwrite
    rec2 = audit.write_audit(tmp_path, e2, {"approver": "b"})
    assert rec2.run_id == "r1-2" and e2["run_id"] == "r1-2"
    assert open(rec1.entry_path, "rb").read() == first_bytes
    assert audit.read_audit_entry(tmp_path, "r1")["x"] == 1
    assert audit.read_audit_entry(tmp_path, "r1-2")["x"] == 2
    log = audit.read_audit_log(tmp_path)
    assert [l["run_id"] for l in log] == ["r1", "r1-2"] and log[1]["approver"] == "b"
    raw = open(rec1.log_path, "rb").read()
    assert raw.count(b"\n") == 2 and b"\r" not in raw
    audit.write_audit(tmp_path, {"run_id": "r3"})
    assert open(rec1.log_path, "rb").read().startswith(raw)  # append-only


def test_entry_is_valid_json_with_format(tmp_path):
    rec = audit.write_audit(tmp_path, {"run_id": "r", "name": "Ünï"})
    data = json.loads(open(rec.entry_path, encoding="utf-8").read())
    assert data["format"] == audit.AUDIT_FORMAT and data["name"] == "Ünï"


def test_missing_run_id_and_empty_log(tmp_path):
    with pytest.raises(audit.AuditError):
        audit.write_audit(tmp_path, {})
    assert audit.read_audit_log(tmp_path) == []
