"""Local-AI suggestions for the Subcategory2 review queue.

prepare_data.py classifies what it can with the proven rules (per-number history,
Sub-Category tags, short-description history, the trend-notes keyword rules, state
placeholders). Whatever those rules leave as "Needs Review" is handed to the local
Ollama model here, which suggests a Subcategory2 from the incident's Short
description, Resolution notes and the same rules, grounded in the most similar
tickets the team has already classified in previous months.

The model only ever SUGGESTS: suggestions are stored on the review queue
(`ai_suggestion`) and the human still confirms them in the review panel. Nothing
here can change a rule-based classification, and the status placeholders
(WIP / Cancelled) can never be suggested.

Privacy: ticket text only goes to a loopback Ollama server. A non-local
OLLAMA_BASE_URL is refused, so operational data cannot leave the machine.
"""
import hashlib
import json
import math
import os
import re
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_BASE_URL = "http://127.0.0.1:11434"
# Measured on this team's own tickets (Sept 2026 review queue, integrated GPU): qwen3.5:4b was as accurate as gemma4:12b (11/20 vs 8/20)
# and 2.5x faster, so it comes first for this batch task.
MODEL_PREFERENCE = ("qwen3.5:4b", "gemma4:12b", "llama3.2:latest")
NEW_LABEL = "NEW"
MIN_LABEL_COUNT = 2
MIN_LABEL_SHARE = 0.0003
NOTES_SNIPPET_CHARS = 220
PROMPT_NOTES_CHARS = 600
NEIGHBOURS = 10
PLACEHOLDERS = frozenset({"wip", "cancelled", "needs review"})
LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "::1", "[::1]"})
SUBCATEGORY_PATTERN = re.compile(r"sub\s*-?\s*category\s*:\s*([^\r\n]+?)(?:\s+symptom reported|\r|\n|$)", re.IGNORECASE)

# Business rules from reference/monthly trend notes (updated).docx that are not
# plain keyword lists (the keyword lists are rendered from prepare_data's own
# SUBCATEGORY_KEYWORD_RULES so the AI can never drift from the rule-based code).
EXTRA_RULES = (
    "All access related keywords -> Access Related.",
    "Disconnect PIN update and unit update - pins -> DXT / HAE related issues (use the closest 'Unit Update' or DXT/HAE label).",
    "Payment issues: see the payment keyword list above.",
    "Classify by what the incident is ABOUT (the issue type), not by who it was routed to.",
    "Use 'Other' for one-off requests that fit no specific label instead of forcing a poor match.",
    "WIP and Cancelled are status placeholders set from the ticket State. Never output them.",
)


def normalize(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def collapse(text, limit=None):
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    return text[:limit] if limit else text


def extract_tag(notes):
    match = SUBCATEGORY_PATTERN.search(str(notes or ""))
    return match.group(1).strip(" .:-") if match else ""


def is_placeholder(label):
    return normalize(label) in PLACEHOLDERS


# ---------------------------------------------------------------------------
# Ollama (loopback only)
# ---------------------------------------------------------------------------


class AiUnavailable(Exception):
    """The local model can't be used (down, not installed, non-local URL...)."""


def base_url(env=None):
    env = os.environ if env is None else env
    url = (env.get("OLLAMA_BASE_URL") or "").strip().rstrip("/") or DEFAULT_BASE_URL
    host = (urlparse(url).hostname or "").lower()
    if host not in LOCAL_HOSTS and f"[{host}]" not in LOCAL_HOSTS:
        raise AiUnavailable(f"refusing to send incident text to a non-local AI server ({host or url})")
    return url


def choose_model(installed, env=None):
    """MONTHLY_AI_MODEL / OLLAMA_MODEL pin > this task's preference order, limited to what
    is installed. None when nothing usable is installed."""
    env = os.environ if env is None else env
    installed_by_key = {name.lower(): name for name in installed}

    def has(name):
        key = name.lower()
        if key in installed_by_key:
            return installed_by_key[key]
        return next((v for k, v in installed_by_key.items() if k.split(":")[0] == key and ":" not in key), None)

    for wanted in (env.get("MONTHLY_AI_MODEL"), env.get("OLLAMA_MODEL"), *MODEL_PREFERENCE):
        if wanted and has(wanted.strip()):
            return has(wanted.strip())
    return None

class OllamaClient:
    def __init__(self, url=None, timeout=180):
        self.url = url or base_url()
        self.timeout = timeout

    def _request(self, path, payload=None, timeout=None):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self.url + path, data=data, headers={"Content-Type": "application/json"}
        )
        # No proxies: this must stay on the loopback interface.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=timeout or self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise AiUnavailable(f"local AI server not reachable ({exc})") from exc

    def installed_models(self):
        return [m.get("name", "") for m in self._request("/api/tags", timeout=5).get("models", [])]

    def chat_json(self, model, system, user, schema, num_ctx=4096, num_predict=120):
        reply = self._request(
            "/api/chat",
            {
                "model": model,
                "stream": False,
                "think": False,
                "format": schema,
                "keep_alive": "10m",
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "options": {"temperature": 0, "num_ctx": num_ctx, "num_predict": num_predict},
            },
        )
        content = (reply.get("message") or {}).get("content", "")
        try:
            parsed = json.loads(content)
        except ValueError as exc:
            raise ValueError(f"model returned invalid JSON: {content[:120]!r}") from exc
        if not isinstance(parsed, dict):
            raise ValueError("model returned a non-object")
        return parsed


# ---------------------------------------------------------------------------
# Examples from previous months: vocabulary + nearest-neighbour retrieval
# ---------------------------------------------------------------------------


def make_example(short_description, notes, label, count=1):
    return {
        "sd": collapse(short_description, 200),
        "tag": extract_tag(notes),
        "notes": collapse(notes, NOTES_SNIPPET_CHARS),
        "label": label,
        "n": count,
    }


def build_vocabulary(examples, canonicalize=lambda label: label, extra_labels=()):
    """The labels the model may choose from, most frequent first: every real label
    proven at least MIN_LABEL_COUNT times in history (one-off typos and stray values
    stay out, though the human can still pick them), plus the labels the trend-notes
    rules name. Case-insensitive de-dup; the most frequent spelling wins.
    Placeholders are never offered. Returns (labels, {label: past ticket count})."""
    counts = Counter()
    spelling = defaultdict(Counter)
    for example in examples:
        label = canonicalize(example["label"])
        if not label or is_placeholder(label):
            continue
        counts[normalize(label)] += example.get("n", 1)
        spelling[normalize(label)][label] += example.get("n", 1)
    # With a few thousand tickets a label seen twice counts; with a year of history
    # (tens of thousands) the bar scales up so the model is not offered stray one-offs.
    minimum = max(MIN_LABEL_COUNT, round(sum(counts.values()) * MIN_LABEL_SHARE))
    keep = {key for key, count in counts.items() if count >= minimum}
    for label in extra_labels:
        if label and not is_placeholder(label):
            key = normalize(canonicalize(label))
            keep.add(key)
            spelling[key][canonicalize(label)] += 0
    vocabulary = [spelling[key].most_common(1)[0][0] for key in sorted(keep, key=lambda k: -counts[k])]
    return vocabulary, {label: counts[normalize(label)] for label in vocabulary}


class ExampleIndex:
    """TF-IDF cosine nearest neighbours over (short description, tag, notes)."""

    def __init__(self, examples):
        self.examples = [e for e in examples if e.get("label") and not is_placeholder(e["label"])]
        self.vectors = []
        document_frequency = Counter()
        tokenised = []
        for example in self.examples:
            tokens = self._tokens(example)
            tokenised.append(tokens)
            document_frequency.update(set(tokens))
        total = max(len(self.examples), 1)
        self.idf = {t: math.log((1 + total) / (1 + df)) + 1 for t, df in document_frequency.items()}
        self.postings = defaultdict(list)
        for position, tokens in enumerate(tokenised):
            vector = self._vector(tokens)
            self.vectors.append(vector)
            for token in vector[0]:
                self.postings[token].append(position)

    @staticmethod
    def _tokens(example):
        # The short description is the strongest signal: count it twice.
        text = f"{example['sd']} {example['sd']} {example.get('tag', '')} {example.get('notes', '')}"
        return [t for t in normalize(text).split() if len(t) > 1]

    def _vector(self, tokens):
        weights = {t: (1 + math.log(c)) * self.idf.get(t, math.log(2 + len(self.examples)) + 1)
                   for t, c in Counter(tokens).items()}
        norm = math.sqrt(sum(w * w for w in weights.values())) or 1.0
        return weights, norm

    def nearest(self, example, k=NEIGHBOURS):
        weights, norm = self._vector(self._tokens(example))
        scores = defaultdict(float)
        for token, weight in weights.items():
            for position in self.postings.get(token, ()):
                scores[position] += weight * self.vectors[position][0][token]
        ranked = sorted(
            ((score / (norm * self.vectors[p][1]), p) for p, score in scores.items()),
            reverse=True,
        )
        return [(similarity, self.examples[p]) for similarity, p in ranked[:k]]


# ---------------------------------------------------------------------------
# Prompting
# ---------------------------------------------------------------------------


def render_rules(keyword_rules, state_rules):
    lines = ["Rules from the monthly trend notes (apply them first):"]
    for terms, label in keyword_rules:
        lines.append(f"- if the ticket mentions {', '.join(terms)} -> {label}")
    lines.extend(f"- {rule}" for rule in EXTRA_RULES)
    return "\n".join(lines)


def render_label_guide(vocabulary, label_counts, guide):
    """The allowed labels, each with how often it was used and what tickets in it look
    like in the team's own history (typical descriptions and keywords), so the model
    learns what each category MEANS rather than just its name."""
    by_key = {normalize(label): info for label, info in (guide or {}).items()}
    lines = []
    for label in vocabulary:
        info = by_key.get(normalize(label))
        line = f"- {label} ({label_counts.get(label, 0)})"
        if info:
            typical = " | ".join(d["text"][:60] for d in info.get("typical_descriptions", [])[:3])
            keywords = ", ".join(info.get("keywords", [])[:6])
            if typical:
                line += f": e.g. {typical}"
            if keywords:
                line += f" [keywords: {keywords}]"
        lines.append(line)
    return "\n".join(lines)


def build_system_prompt(rules_text, vocabulary, label_counts, guide=None):
    # The label list lives in the system prompt: it is identical for every ticket, so
    # Ollama reuses its cached prefix and only the per-ticket part is processed.
    if guide:
        labels = "Allowed labels (number = past tickets; examples show what belongs in each):\n" + \
            render_label_guide(vocabulary, label_counts, guide)
    else:
        labels = "Allowed labels: " + "; ".join(f"{label} ({label_counts.get(label, 0)})" for label in vocabulary)
    return (
        "You classify ServiceNow incidents of a plasma-donation IT support team into ONE "
        "'Subcategory2' label for the monthly trend report.\n"
        "Use the Short description, the Resolution notes and the rules below. Similar tickets "
        "the team already classified are the strongest evidence: prefer the label they used "
        "when the ticket is the same kind of problem. Choose only from the allowed label list "
        "(the number is how many past tickets used it; answer with the label only). "
        f"If truly none fits, answer label '{NEW_LABEL}' and put a short Title Case name in "
        "new_label (same style as the existing labels).\n"
        "confidence: high = rule or near-identical past ticket; medium = reasonable fit; "
        "low = a guess.\n"
        "Answer with JSON: first 'issue' (one plain sentence, max 20 words: what actually "
        "went wrong or what was requested, from the description and the resolution notes), "
        "then 'label', then 'confidence'.\n\n"
        + rules_text
        + "\n\n"
        + labels
    )


def label_votes(neighbours):
    """Which labels the most similar past tickets carry: similarity weighted, and
    lifted for labels used on many tickets with that wording. [(label, share)]."""
    scores = Counter()
    for similarity, example in neighbours:
        scores[example["label"]] += similarity * (1 + example.get("n", 1) ** 0.5)
    total = sum(scores.values()) or 1.0
    return [(label, score / total) for label, score in scores.most_common(4)]


def build_user_prompt(incident, neighbours):
    notes = collapse(incident.get("resolution_notes"), PROMPT_NOTES_CHARS)
    lines = ["Similar past tickets (label <- ticket):"]
    for similarity, example in neighbours[:6]:
        detail = example["tag"] or example["notes"]
        lines.append(f"- [{example['label']}] {example['sd']}" + (f" | {detail[:100]}" if detail else ""))
    votes = label_votes(neighbours)
    if votes:
        lines.append(
            "Labels of the most similar past tickets overall: "
            + ", ".join(f"{label} {round(share * 100)}%" for label, share in votes)
            + ". Follow this unless the incident's own text clearly points elsewhere."
        )
    lines += [
        "",
        "Incident to classify:",
        f"Short description: {collapse(incident.get('short_description'), 300)}",
        f"Resolution notes: {notes or '(none)'}",
        f"Category / Subcategory: {incident.get('category') or '-'} / {incident.get('subcategory') or '-'}",
        f"Assignment group: {incident.get('assignment_group') or '-'}",
    ]
    return "\n".join(lines)


def response_schema(vocabulary):
    # "issue" comes first on purpose: the model states what the ticket is really about
    # (in its own words) before it chooses, so the label follows from an understanding
    # of the problem instead of a keyword match.
    return {
        "type": "object",
        "properties": {
            "issue": {"type": "string"},
            "label": {"type": "string", "enum": [*vocabulary, NEW_LABEL]},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            "new_label": {"type": "string"},
        },
        "required": ["issue", "label", "confidence"],
    }


def explain(label, neighbours, is_new):
    """Why the label is plausible, in the team's own history: the closest ticket that
    used it (the model's free-text reasoning is skipped, it is the slow part on CPU)."""
    if is_new:
        return "No similar past ticket uses this label; the model proposed a new category."
    for similarity, example in neighbours:
        if normalize(example["label"]) == normalize(label):
            return f'Similar past ticket: "{example["sd"][:80]}" ({round(similarity * 100)}% match)'
    return "No close past ticket used this label."


def interpret(parsed, vocabulary, neighbours, canonicalize=lambda label: label):
    """Validate a model answer into a suggestion dict, or None when unusable."""
    by_key = {normalize(label): label for label in vocabulary}
    label = str(parsed.get("label", "")).strip()
    is_new = False
    if label.upper() == NEW_LABEL:
        label = collapse(parsed.get("new_label"), 60)
        existing = by_key.get(normalize(canonicalize(label)))
        if existing:
            label = existing
        else:
            is_new = True
    else:
        label = by_key.get(normalize(canonicalize(label)))
    if not label or is_placeholder(label):
        return None
    confidence = str(parsed.get("confidence", "low")).lower()
    if confidence not in ("high", "medium", "low"):
        confidence = "low"
    evidence = max(
        (similarity for similarity, example in neighbours if normalize(example["label"]) == normalize(label)),
        default=0.0,
    )
    # The model's self-reported confidence is capped by evidence from real history:
    # "high" needs a close past ticket with the same label, a label no similar ticket
    # used is at best "medium" (an opinion without precedent), a brand new one is "low".
    if is_new:
        confidence = "low"
    elif evidence >= 0.6:
        confidence = "high" if confidence != "low" else "medium"
    elif evidence >= 0.3:
        confidence = "medium"
    else:
        confidence = "medium" if confidence == "high" else "low"
    return {
        "label": label,
        "confidence": confidence,
        "reason": explain(label, neighbours, is_new),
        "issue": collapse(parsed.get("issue"), 200),
        "vote_label": (label_votes(neighbours) or [(None, 0)])[0][0],
        "vote_share": round((label_votes(neighbours) or [(None, 0.0)])[0][1], 2),
        "is_new": is_new,
        "similar": [
            {"label": example["label"], "short_description": example["sd"], "similarity": round(s, 2)}
            for s, example in neighbours[:3]
        ],
    }


def incident_group_key(incident):
    notes = collapse(incident.get("resolution_notes"), 300)
    return normalize(incident.get("short_description")) + "|" + normalize(extract_tag(notes) or notes[:120])


NOTES_MIN_WORDS = 8
NOTES_SIMILARITY = 0.85
DESCRIPTION_OVERLAP = 0.3
PARENT_NOTES_PREFIX = "resolution notes copied from parent incident"


def _overlap(a, b):
    return len(a & b) / len(a | b) if a and b else 0.0


def _notes_words(notes):
    """Words of a resolution note that say what was done. Anything with a digit (ticket
    numbers, dates, serials, ids) is dropped, so notes that differ only in those match."""
    return [w for w in normalize(notes).split() if len(w) > 1 and not any(c.isdigit() for c in w)]


def assign_notes_groups(incidents, threshold=NOTES_SIMILARITY):
    """Mark incidents whose resolution notes are (almost) the same text with a shared
    `notes_group`, so one answer can be applied to all of them. Notes must be long enough
    to mean something and must not carry different Sub-Category tags. Returns the number
    of groups with two or more incidents."""
    docs = []
    for incident in incidents:
        notes = str(incident.get("resolution_notes") or "")
        words = _notes_words(notes)
        if len(words) < NOTES_MIN_WORDS:
            docs.append(None)
            continue
        inherited = normalize(notes).startswith(PARENT_NOTES_PREFIX)
        description = set(_notes_words(incident.get("short_description")))
        docs.append((incident, words, normalize(extract_tag(notes)), inherited, description))
    present = [d for d in docs if d]
    document_frequency = Counter()
    for _, words, *_rest in present:
        document_frequency.update(set(words))
    total = max(len(present), 1)
    vectors = []
    for _, words, *_rest in present:
        weights = {w: (1 + math.log(c)) * (math.log((1 + total) / (1 + document_frequency[w])) + 1)
                   for w, c in Counter(words).items()}
        vectors.append((weights, math.sqrt(sum(v * v for v in weights.values())) or 1.0))
    postings = defaultdict(list)
    for position, (weights, _) in enumerate(vectors):
        for word in weights:
            postings[word].append(position)

    parent = list(range(len(present)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, (weights, norm) in enumerate(vectors):
        scores = defaultdict(float)
        for word, weight in weights.items():
            for j in postings[word]:
                if j > i:
                    scores[j] += weight * vectors[j][0][word]
        for j, score in scores.items():
            tag_i, tag_j = present[i][2], present[j][2]
            if score / (norm * vectors[j][1]) < threshold or (tag_i and tag_j and tag_i != tag_j):
                continue
            # Notes copied from a parent incident describe the parent, not this ticket:
            # those only group when the tickets' own descriptions are alike too.
            if (present[i][3] or present[j][3]) and _overlap(present[i][4], present[j][4]) < DESCRIPTION_OVERLAP:
                continue
            parent[find(j)] = find(i)

    members = defaultdict(list)
    for i in range(len(present)):
        members[find(i)].append(present[i][0])
    groups = 0
    for number, items in enumerate((m for m in members.values() if len(m) > 1), start=1):
        groups += 1
        for incident in items:
            incident["notes_group"] = f"notes-{number}"
    return groups


class Classifier:
    def __init__(self, client, model, examples, keyword_rules, state_rules,
                 canonicalize=lambda label: label, extra_labels=(), guide=None, num_ctx=8192):
        self.client = client
        self.model = model
        self.canonicalize = canonicalize
        self.num_ctx = num_ctx
        self.index = ExampleIndex(examples)
        self.vocabulary, self.label_counts = build_vocabulary(examples, canonicalize, extra_labels)
        self.schema = response_schema(self.vocabulary)
        self.system = build_system_prompt(
            render_rules(keyword_rules, state_rules), self.vocabulary, self.label_counts, guide
        )

    def classify(self, incident):
        probe = make_example(incident.get("short_description"), incident.get("resolution_notes"), "?")
        neighbours = self.index.nearest(probe)
        user = build_user_prompt(incident, neighbours)
        parsed = self.client.chat_json(self.model, self.system, user, self.schema, num_ctx=self.num_ctx)
        return interpret(parsed, self.vocabulary, neighbours, self.canonicalize)


def load_guide(knowledge_dir):
    """The repository's category guide, or None when it hasn't been built."""
    if not knowledge_dir:
        return None
    try:
        return json.loads((Path(knowledge_dir) / "category-guide.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def cache_key(model, classifier, incident):
    material = json.dumps(
        [model, classifier.system, incident_group_key(incident), len(classifier.index.examples)]
    )
    return hashlib.sha1(material.encode("utf-8")).hexdigest()


def suggest_for_queue(queue, classifier, cache_path=None, budget_seconds=1200, log=print,
                      eligible=lambda incident: True):
    """Attach `ai_suggestion` to every eligible incident in the review queue. Identical
    tickets (same description and notes tag) are classified once; results are cached so
    a re-run only asks the model about what is new. Returns (suggested, failed)."""
    cache = {}
    if cache_path and Path(cache_path).exists():
        try:
            cache = json.loads(Path(cache_path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            cache = {}
    incidents = [i for i in queue.get("incidents", []) if eligible(i)]
    groups = defaultdict(list)
    for incident in incidents:
        groups[incident.get("notes_group") or incident_group_key(incident)].append(incident)
    started = time.monotonic()
    suggested = failed = 0
    for position, (group_key, members) in enumerate(groups.items(), start=1):
        key = cache_key(classifier.model, classifier, members[0])
        suggestion = cache.get(key)
        if suggestion is None:
            if time.monotonic() - started > budget_seconds:
                log(f"AI time budget reached; {len(groups) - position + 1} group(s) left for manual review")
                break
            try:
                suggestion = classifier.classify(members[0])
            except AiUnavailable:
                raise
            except Exception as exc:  # one bad answer must not stop the rest
                log(f"AI could not classify {members[0].get('number')}: {exc}")
                failed += len(members)
                continue
            if suggestion is None:
                failed += len(members)
                continue
            cache[key] = suggestion
            if cache_path:
                Path(cache_path).write_text(json.dumps(cache), encoding="utf-8")
        for member in members:
            member["ai_suggestion"] = {**suggestion, "model": classifier.model}
        suggested += len(members)
        log(f"AI suggestions: {suggested}/{len(incidents)}")
    return suggested, failed
