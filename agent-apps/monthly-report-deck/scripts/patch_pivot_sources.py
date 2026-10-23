import argparse
import io
import os
import re
import tempfile
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CACHE_PREFIX = "xl/pivotCache/pivotCacheDefinition"

ET.register_namespace("", MAIN_NS)
ET.register_namespace("r", REL_NS)


def patch_local_pivot_sources(workbook_path, last_row):
    workbook_path = Path(workbook_path)
    temporary = tempfile.NamedTemporaryFile(
        delete=False,
        dir=workbook_path.parent,
        prefix=f".{workbook_path.stem}-",
        suffix=workbook_path.suffix,
    )
    temporary_path = Path(temporary.name)
    temporary.close()
    patched = 0

    try:
        with ZipFile(workbook_path, "r") as source_archive, ZipFile(temporary_path, "w") as output_archive:
            for entry in source_archive.infolist():
                data = source_archive.read(entry.filename)
                if entry.filename.startswith(CACHE_PREFIX) and entry.filename.endswith(".xml"):
                    for _, namespace in ET.iterparse(io.BytesIO(data), events=("start-ns",)):
                        prefix, uri = namespace
                        if prefix != "xml":
                            ET.register_namespace(prefix or "", uri)
                    root = ET.fromstring(data)
                    source = root.find(f".//{{{MAIN_NS}}}worksheetSource")
                    relationship_id = source.get(f"{{{REL_NS}}}id") if source is not None else None
                    if source is not None and source.get("sheet") == "Incidents" and not relationship_id:
                        ref = source.get("ref")
                        if not ref or not re.search(r"\d+$", ref):
                            raise ValueError(f"Unsupported local pivot source range in {entry.filename}: {ref}")
                        source.set("ref", re.sub(r"\d+$", str(last_row), ref))
                        declaration = b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                        data = declaration + ET.tostring(root, encoding="utf-8")
                        patched += 1
                output_archive.writestr(entry, data)
        os.replace(temporary_path, workbook_path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise

    if not patched:
        raise ValueError("No local Incidents pivot caches were found")
    return patched


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workbook", required=True)
    parser.add_argument("--last-row", required=True, type=int)
    args = parser.parse_args()
    patched = patch_local_pivot_sources(args.workbook, args.last_row)
    print(f"Local pivot cache definitions patched: {patched}")


if __name__ == "__main__":
    main()