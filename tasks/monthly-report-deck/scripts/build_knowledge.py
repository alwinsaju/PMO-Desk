"""Build the incident knowledge repository from the monthly trend-analysis workbooks.

Every monthly workbook the team produced holds incidents the PMO already classified
(the "Subcategory2" / "SUB CATEGORY" column). This script reads all of them and writes
a local repository the Subcategory2 classifier learns from:

  <out>/incidents-YYYY-MM.jsonl   one proven classification per ticket (newest month wins)
  <out>/category-guide.json       per category: aliases, counts, typical tickets, keywords
  <out>/conflicts.json            descriptions the team classified in more than one way
  <out>/knowledge.json            manifest (sources, counts, label statistics)

The data is real operational data: the output folder lives under `reference/`, which is
ignored by Git. Run:

  python scripts/build_knowledge.py --source "C:/path/to/2026" [--out reference/knowledge]
"""
import argparse
import json
import math
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai_classify  # noqa: E402
from labels import LabelCanonicalizer  # noqa: E402

TASK_DIR = Path(__file__).resolve().parent.parent
DEFAULT_OUT = TASK_DIR / "reference" / "knowledge"
NOTES_LIMIT = 1500

# Header names (case/space-insensitive) of the columns we read, in priority order.
COLUMNS = {
    "number": ("number",),
    "short_description": ("short description",),
    "resolution_notes": ("resolution notes",),
    "state": ("state",),
    "category": ("category",),
    "subcategory": ("subcategory",),
    "configuration_item": ("configuration item",),
    "assignment_group": ("assignment group",),
    "tag": ("sub cat 1",),
}
LABEL_HEADERS = ("subcategory2", "sub category")  # compared after normalising spaces/case

# (month, path pattern relative to the source folder, sheet, priority). Later priority
# overrides earlier within the same month. Months are processed oldest to newest and a
# ticket's newest real label wins, exactly like prepare_data's history learning.
SOURCES = [
    ("2026-01", "01. January/Top Trending*.xlsm", "Incidents", 0),
    ("2026-02", "02. February/All Incident Feb 2026*.xlsx", "Incidents", 0),
    ("2026-03", "03. March/Monthly incident trend March*.xlsx", "Incidents", 0),
    ("2026-04", "04. April/Monthly incident trend April*.xlsx", "Page 1", 0),
    ("2026-05", "05. May/Monthly Incidents Trend Analysis - May*.xlsx", "Monthly trends - Data", 0),
    ("2026-06", "06. June/incident-June2026-chitra.xlsx", "Page 1", 0),
    ("2026-07", "07. July/Monthly Incidents Trend Analysis - July*.xlsx", "Incidents", 0),
    ("2026-08", "08. August/Monthly Incidents Trend Analysis - August 2026.xlsx", "Incidents", 0),
    ("2026-08", "08. August/Monthly Incidents Trend Analysis - August 2026 (Updated).xlsx", "Incidents", 1),
    ("2026-09", "09. September/Monthly Incidents Trend Analysis - September 2026*.xlsx", "Incidents", 0),
    ("2026-10", "10. October/Monthly Incidents Trend Analysis - October 2026*.xlsx", "Incidents", 0),
]


def header_key(value):
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def find_columns(header):
    """Map our field names (and the label) to column indexes; the first match wins so
    duplicate headers (e.g. a second 'Tags' or 'Category') never override the real one."""
    keys = [header_key(h) for h in header]
    found = {}
    for field, names in COLUMNS.items():
        for name in names:
            if name in keys:
                found[field] = keys.index(name)
                break
    for name in LABEL_HEADERS:
        if name in keys:
            found["label"] = keys.index(name)
            break
    return found


def read_rows(path, sheet):
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        rows = workbook[sheet].iter_rows(values_only=True)
        columns = find_columns(next(rows))
        missing = [f for f in ("number", "short_description", "label") if f not in columns]
        if missing:
            raise ValueError(f"{Path(path).name} / {sheet}: missing column(s) {missing}")
        for row in rows:
            record = {
                field: row[index] if index < len(row) else None for field, index in columns.items()
            }
            number = str(record.get("number") or "").strip()
            if number.upper().startswith("INC"):
                record["number"] = number
                yield record
    finally:
        workbook.close()


def clean_label(value):
    label = ai_classify.collapse(value, 80)
    return label


def build_records(source, sources=SOURCES, log=print):
    """Newest real label per ticket across all months. Returns ({number: record}, stats)."""
    records = {}
    first_seen = {}
    stats = []
    for month, pattern, sheet, _priority in sorted(sources, key=lambda s: (s[0], s[3])):
        matches = sorted(Path(source).glob(pattern))
        if not matches:
            log(f"{month}: no file matches {pattern!r} - skipped")
            continue
        path = matches[0]
        seen = real = placeholder = 0
        for rec in read_rows(path, sheet):
            seen += 1
            first_seen.setdefault(rec["number"], month)
            label = clean_label(rec.get("label"))
            if not label:
                continue
            if ai_classify.is_placeholder(label):
                placeholder += 1
                continue
            real += 1
            entry = {
                "number": rec["number"],
                "month": month,
                "short_description": ai_classify.collapse(rec.get("short_description"), 300),
                "resolution_notes": ai_classify.collapse(rec.get("resolution_notes"), NOTES_LIMIT),
                "tag": ai_classify.extract_tag(rec.get("resolution_notes")),
                "category": ai_classify.collapse(rec.get("category"), 80),
                "subcategory": ai_classify.collapse(rec.get("subcategory"), 80),
                "configuration_item": ai_classify.collapse(rec.get("configuration_item"), 120),
                "assignment_group": ai_classify.collapse(rec.get("assignment_group"), 120),
                "state": ai_classify.collapse(rec.get("state"), 30),
                "label": label,
                "source": path.name,
            }
            records[rec["number"]] = entry  # newer months overwrite older ones
        stats.append({"month": month, "file": path.name, "sheet": sheet, "rows": seen,
                      "classified": real, "placeholders": placeholder})
        log(f"{month}: {path.name} [{sheet}] rows={seen} classified={real} placeholders={placeholder}")
    for number, entry in records.items():
        entry["first_seen"] = first_seen[number]
    return records, stats


def canonical_labels(records, canonicalize):
    """Merge spelling variants (case, spacing, plurals, typos - see labels.py), after the
    alias table, into the most frequent spelling. Returns {raw label: canonical label}."""
    counts = Counter(canonicalize(rec["label"]) for rec in records.values())
    canon = LabelCanonicalizer(counts)
    return {rec["label"]: canon(canonicalize(rec["label"])) for rec in records.values()}


def build_guide(records, canon, top_descriptions=8, top_keywords=12):
    by_label = defaultdict(list)
    for rec in records.values():
        by_label[canon[rec["label"]]].append(rec)
    token_labels = defaultdict(set)
    label_tokens = {}
    for label, items in by_label.items():
        tokens = Counter()
        for item in items:
            tokens.update(set(t for t in ai_classify.normalize(
                f"{item['short_description']} {item['tag']}").split() if len(t) > 2))
        label_tokens[label] = tokens
        for token in tokens:
            token_labels[token].add(label)
    guide = {}
    total_labels = max(len(by_label), 1)
    for label, items in sorted(by_label.items(), key=lambda kv: -len(kv[1])):
        descriptions = Counter(ai_classify.normalize(i["short_description"]) for i in items)
        exemplar = {}
        for item in items:
            exemplar.setdefault(ai_classify.normalize(item["short_description"]), item["short_description"])
        scored = sorted(
            ((count * math.log(1 + total_labels / len(token_labels[token])), token)
             for token, count in label_tokens[label].items() if count >= 3),
            reverse=True,
        )
        guide[label] = {
            "count": len(items),
            "months": dict(sorted(Counter(i["month"] for i in items).items())),
            "aliases": dict(Counter(i["label"] for i in items).most_common()),
            "typical_descriptions": [
                {"text": exemplar[key], "count": count}
                for key, count in descriptions.most_common(top_descriptions) if key
            ],
            "typical_tags": [t for t, _ in Counter(i["tag"] for i in items if i["tag"]).most_common(5)],
            "keywords": [token for _, token in scored[:top_keywords]],
        }
    return guide


def build_conflicts(records, canon):
    """Short descriptions the team labelled in more than one way: the measured ceiling
    for any classifier that only sees the description."""
    by_description = defaultdict(Counter)
    for rec in records.values():
        key = ai_classify.normalize(rec["short_description"])
        if key:
            by_description[key][canon[rec["label"]]] += 1
    conflicting = {k: c for k, c in by_description.items() if len(c) > 1}
    tickets = sum(sum(c.values()) for c in by_description.values())
    minority = sum(sum(c.values()) - c.most_common(1)[0][1] for c in conflicting.values())
    return {
        "descriptions": len(by_description),
        "conflicting_descriptions": len(conflicting),
        "tickets": tickets,
        "tickets_off_majority_label": minority,
        "max_accuracy_from_description_alone": round(1 - minority / tickets, 4) if tickets else None,
        "top_conflicts": [
            {"description": k, "labels": dict(c.most_common())}
            for k, c in sorted(conflicting.items(), key=lambda kv: -sum(kv[1].values()))[:50]
        ],
    }


def write_repository(source, out_dir, canonicalize, sources=SOURCES, log=print):
    records, stats = build_records(source, sources, log)
    canon = canonical_labels(records, canonicalize)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("incidents-*.jsonl"):
        old.unlink()
    by_month = defaultdict(list)
    for rec in records.values():
        by_month[rec["month"]].append({**rec, "label_canonical": canon[rec["label"]]})
    for month, items in sorted(by_month.items()):
        with (out_dir / f"incidents-{month}.jsonl").open("w", encoding="utf-8") as handle:
            for item in sorted(items, key=lambda i: i["number"]):
                handle.write(json.dumps(item, ensure_ascii=False) + "\n")
    guide = build_guide(records, canon)
    conflicts = build_conflicts(records, canon)
    (out_dir / "category-guide.json").write_text(json.dumps(guide, indent=1, ensure_ascii=False), encoding="utf-8")
    (out_dir / "conflicts.json").write_text(json.dumps(conflicts, indent=1, ensure_ascii=False), encoding="utf-8")
    manifest = {
        "built_at": datetime.now().isoformat(timespec="seconds"),
        "sources": stats,
        "tickets": len(records),
        "categories": len(guide),
        "labels": {label: info["count"] for label, info in guide.items()},
        "max_accuracy_from_description_alone": conflicts["max_accuracy_from_description_alone"],
    }
    (out_dir / "knowledge.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8")
    log(f"Repository: {len(records)} classified tickets, {len(guide)} categories -> {out_dir}")
    return manifest


def load_examples(knowledge_dir):
    """The repository as classifier examples (same shape as prepare_data's history
    examples): one per (description, category) with a ticket count, newest wording kept."""
    knowledge_dir = Path(knowledge_dir)
    index = {}
    files = sorted(knowledge_dir.glob("incidents-*.jsonl"), reverse=True)
    for path in files:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            label = rec.get("label_canonical") or rec["label"]
            key = (ai_classify.normalize(rec["short_description"]), ai_classify.normalize(label))
            if key in index:
                index[key]["n"] += 1
            else:
                index[key] = ai_classify.make_example(rec["short_description"], rec["resolution_notes"], label)
    return list(index.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", required=True, help="folder holding the monthly folders (01. January ... 10. October)")
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args()
    from prepare_data import canonicalize_subcategory

    write_repository(args.source, args.out, canonicalize_subcategory)


if __name__ == "__main__":
    main()
