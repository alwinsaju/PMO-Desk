from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from scripts.patch_pivot_sources import patch_local_pivot_sources


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006"
XR_NS = "http://schemas.microsoft.com/office/spreadsheetml/2014/revision"


def cache_xml(ref, sheet, relationship_id=None):
    relationship = f' r:id="{relationship_id}"' if relationship_id else ""
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<pivotCacheDefinition xmlns="{MAIN_NS}" xmlns:r="{REL_NS}" xmlns:mc="{MC_NS}"
    xmlns:xr="{XR_NS}" mc:Ignorable="xr" xr:uid="test-id">
  <cacheSource type="worksheet">
    <worksheetSource ref="{ref}" sheet="{sheet}"{relationship}/>
  </cacheSource>
</pivotCacheDefinition>
""".encode()


def read_source(path, name):
    with ZipFile(path) as archive:
        root = ET.fromstring(archive.read(name))
    source = root.find(f".//{{{MAIN_NS}}}worksheetSource")
    return root, source


def test_patch_local_pivot_sources_preserves_external_caches(tmp_path):
    workbook_path = tmp_path / "report.xlsx"
    local_s = "xl/pivotCache/pivotCacheDefinition1.xml"
    local_t = "xl/pivotCache/pivotCacheDefinition2.xml"
    external = "xl/pivotCache/pivotCacheDefinition3.xml"
    with ZipFile(workbook_path, "w", ZIP_DEFLATED) as archive:
        archive.writestr(local_s, cache_xml("A1:S8508", "Incidents"))
        archive.writestr(local_t, cache_xml("A1:T8508", "Incidents"))
        archive.writestr(external, cache_xml("A1:EL7041", "Incidents", "rId2"))
        archive.writestr("xl/workbook.xml", b"unchanged")

    patched = patch_local_pivot_sources(workbook_path, 8583)

    assert patched == 2
    root, source = read_source(workbook_path, local_s)
    assert source.get("ref") == "A1:S8583"
    assert root.get("refreshOnLoad") is None
    _, source = read_source(workbook_path, local_t)
    assert source.get("ref") == "A1:T8583"
    root, source = read_source(workbook_path, external)
    assert source.get("ref") == "A1:EL7041"
    assert root.get("refreshOnLoad") is None
    with ZipFile(workbook_path) as archive:
        assert archive.read("xl/workbook.xml") == b"unchanged"
        local_xml = archive.read(local_s)
        assert b"xmlns:mc=" in local_xml
        assert b"xmlns:xr=" in local_xml
        assert b"xmlns:ns" not in local_xml