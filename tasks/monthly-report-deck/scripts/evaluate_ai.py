"""Measure how well the classifier would have done on a past month (leave-one-month-out).

Trains on the knowledge repository months BEFORE the chosen month and replays the
pipeline on that month's new tickets:

  1. the proven rules (alert / Sub-Category tag / same short description / trend-notes
     keywords, newest month's convention wins) - the same order prepare_data uses;
  2. the local AI model, only for what the rules left unresolved.

It reports accuracy for each stage against what the team actually saved, so a change to
the prompt, model or repository can be judged by numbers, not impressions.

  python scripts/evaluate_ai.py --month 2026-10 [--limit 60] [--model qwen3.5:4b]
"""
import argparse
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai_classify as ai  # noqa: E402
import build_knowledge as kb  # noqa: E402
import prepare_data as pd  # noqa: E402

N = ai.normalize


def load_records(knowledge_dir):
    records = []
    for path in sorted(Path(knowledge_dir).glob("incidents-*.jsonl")):
        records += [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return records


def newest_wins(table):
    return {key: months[max(months)].most_common(1)[0][0] for key, months in table.items() if key}


def learn_rules(train):
    by_text = defaultdict(lambda: defaultdict(Counter))
    by_sd = defaultdict(lambda: defaultdict(Counter))
    for rec in train:
        label = rec["label_canonical"]
        by_text[N(label)][rec["month"]][label] += 1
        if rec["tag"]:
            by_text[N(rec["tag"])][rec["month"]][label] += 1
        by_sd[N(rec["short_description"])][rec["month"]][label] += 1
    return newest_wins(by_text), newest_wins(by_sd)


def rule_classify(rec, by_text, by_sd):
    notes = rec["resolution_notes"]
    if "task associated with alert" in notes.lower() or N(rec["assignment_group"]) == "pdt donorinfosystem us":
        return "Alert", "alert"
    if rec["tag"] and by_text.get(N(rec["tag"])):
        return by_text[N(rec["tag"])], "tag"
    if by_sd.get(N(rec["short_description"])):
        return by_sd[N(rec["short_description"])], "short description"
    keyword = pd.subcategory_from_keywords(rec["short_description"], notes)
    return (keyword, "keyword") if keyword else (None, None)


def same(a, b):
    return N(pd.canonicalize_subcategory(a or "")) == N(pd.canonicalize_subcategory(b or ""))


def as_incident(rec):
    return {
        "number": rec["number"],
        "short_description": rec["short_description"],
        "resolution_notes": rec["resolution_notes"],
        "category": rec["category"],
        "subcategory": rec["subcategory"],
        "assignment_group": rec["assignment_group"],
    }


def evaluate(knowledge_dir, month, model, base_url, limit, log=print):
    records = load_records(knowledge_dir)
    train = [r for r in records if r["month"] < month]
    test = [r for r in records if r["month"] == month and r["first_seen"] == month]
    log(f"train: {len(train)} tickets before {month}; test: {len(test)} new tickets in {month}")
    by_text, by_sd = learn_rules(train)

    stages = defaultdict(lambda: [0, 0])
    residual = []
    for rec in test:
        predicted, how = rule_classify(rec, by_text, by_sd)
        if predicted:
            stages[how][0] += 1
            stages[how][1] += same(predicted, rec["label_canonical"])
        else:
            residual.append(rec)
    resolved = sum(v[0] for v in stages.values())
    correct = sum(v[1] for v in stages.values())
    log(f"rules: resolved {resolved}/{len(test)}, correct {correct} ({correct / max(resolved, 1):.1%}); "
        + ", ".join(f"{k} {v[1]}/{v[0]}" for k, v in stages.items()))
    log(f"left for the AI: {len(residual)} tickets")

    canon = kb.canonical_labels({r["number"]: r for r in train}, pd.canonicalize_subcategory)
    guide = kb.build_guide({r["number"]: r for r in train}, canon)
    examples = []
    index = {}
    for rec in sorted(train, key=lambda r: r["month"], reverse=True):
        key = (N(rec["short_description"]), N(rec["label_canonical"]))
        if key in index:
            index[key]["n"] += 1
        else:
            index[key] = ai.make_example(rec["short_description"], rec["resolution_notes"], rec["label_canonical"])
    examples = list(index.values())

    client = ai.OllamaClient(url=base_url, timeout=300)
    chosen = model or ai.choose_model(client.installed_models())
    classifier = ai.Classifier(
        client, chosen, examples, pd.SUBCATEGORY_KEYWORD_RULES, pd.STATE_SUBCATEGORY_RULES,
        pd.canonicalize_subcategory, [label for _, label in pd.SUBCATEGORY_KEYWORD_RULES], guide,
    )
    log(f"model {chosen}; {len(classifier.vocabulary)} labels offered; {len(examples)} examples")

    groups = {}
    for rec in residual:
        groups.setdefault(ai.incident_group_key(as_incident(rec)), []).append(rec)
    keys = list(groups)[:limit]
    results, by_confidence = [], defaultdict(lambda: [0, 0])
    started = time.monotonic()
    for position, key in enumerate(keys, start=1):
        members = groups[key]
        try:
            suggestion = classifier.classify(as_incident(members[0]))
        except Exception as exc:  # keep going; count it as a miss
            log(f"  error {members[0]['number']}: {exc}")
            suggestion = None
        for rec in members:
            hit = bool(suggestion) and same(suggestion["label"], rec["label_canonical"])
            results.append({"number": rec["number"], "gold": rec["label_canonical"],
                            "predicted": suggestion and suggestion["label"],
                            "confidence": suggestion and suggestion["confidence"],
                            "issue": suggestion and suggestion["issue"],
                            "vote_label": suggestion and suggestion.get("vote_label"),
                            "short_description": rec["short_description"], "hit": hit})
            if suggestion:
                by_confidence[suggestion["confidence"]][0] += 1
                by_confidence[suggestion["confidence"]][1] += hit
        if position % 10 == 0:
            log(f"  {position}/{len(keys)} groups, {(time.monotonic() - started) / position:.1f}s each")
    ai_correct = sum(r["hit"] for r in results)
    other = sum(same("Other", r["gold"]) for r in results)
    log(f"AI: {ai_correct}/{len(results)} correct ({ai_correct / max(len(results), 1):.1%}); "
        f"always-'Other' baseline {other}/{len(results)}; by confidence "
        + ", ".join(f"{k} {v[1]}/{v[0]}" for k, v in sorted(by_confidence.items())))
    overall = correct + ai_correct
    total = resolved + len(results)
    log(f"whole pipeline: {overall}/{total} = {overall / max(total, 1):.1%} of {len(test)} new tickets"
        + (" (AI sampled)" if len(keys) < len(groups) else ""))
    summary = {"month": month, "model": chosen, "test": len(test), "rules_resolved": resolved,
               "rules_correct": correct, "ai_tickets": len(results), "ai_correct": ai_correct,
               "results": results}
    out = Path(knowledge_dir) / f"eval-{month}.json"
    out.write_text(json.dumps(summary, indent=1, ensure_ascii=False), encoding="utf-8")
    log(f"details: {out}")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--month", required=True, help="YYYY-MM to replay")
    parser.add_argument("--knowledge", default=str(kb.DEFAULT_OUT))
    parser.add_argument("--model")
    parser.add_argument("--base-url", default=None, help="loopback Ollama URL (default OLLAMA_BASE_URL / 11434)")
    parser.add_argument("--limit", type=int, default=1000, help="max unique unresolved tickets to ask the AI about")
    args = parser.parse_args()
    evaluate(args.knowledge, args.month, args.model, args.base_url or ai.base_url(), args.limit)


if __name__ == "__main__":
    main()
