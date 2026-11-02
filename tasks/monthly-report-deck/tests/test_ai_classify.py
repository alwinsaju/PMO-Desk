"""Local-AI suggestions: vocabulary, retrieval, validation and the queue pass.

No real model or network: a fake client stands in for Ollama, and the synthetic
tickets contain no client or PMO data."""
import json

import pytest

from scripts.prepare_data import (
    NEEDS_REVIEW,
    STATE_SUBCATEGORY_RULES,
    SUBCATEGORY_KEYWORD_RULES,
    PreparedIncidents,
    add_ai_suggestions,
    canonicalize_subcategory,
)
from scripts.prepare_data import ai_classify as ai  # the module prepare_data uses, so monkeypatching is seen


def example(sd, label, notes="", n=1):
    item = ai.make_example(sd, notes, label)
    item["n"] = n
    return item


EXAMPLES = [
    example("Printer not printing labels", "Print Label", n=5),
    example("Cannot print donor label", "Print Label", n=3),
    example("Password reset for donor", "donor password reset", n=4),
    example("Donor locked out of account", "Access Related", "Category: Application Sub-Category: Employee Access", n=6),
    example("One-off typo ticket", "Softwar Isse", n=1),
    example("Old status", "WIP", n=9),
]


class FakeClient:
    def __init__(self, answers=None, error=None):
        self.answers = answers or []
        self.error = error
        self.calls = []

    def chat_json(self, model, system, user, schema, **_):
        self.calls.append({"model": model, "system": system, "user": user, "schema": schema})
        if self.error:
            raise self.error
        answer = self.answers.pop(0) if self.answers else {"issue": "A label will not print.", "label": "Print Label", "confidence": "high"}
        if isinstance(answer, Exception):
            raise answer
        return answer


def make_classifier(client, examples=EXAMPLES):
    return ai.Classifier(
        client,
        "test-model",
        examples,
        SUBCATEGORY_KEYWORD_RULES,
        STATE_SUBCATEGORY_RULES,
        canonicalize_subcategory,
    )


def incident(number, sd, notes="", state="NEEDS", current=NEEDS_REVIEW):
    return {
        "number": number,
        "short_description": sd,
        "resolution_notes": notes,
        "category": "Application/Software",
        "subcategory": "Error/Issue",
        "state": state,
        "assignment_group": "Group",
        "assigned_to": None,
        "current_subcategory2": current,
        "review_reasons": ["Subcategory2 could not be classified"],
    }


def test_base_url_refuses_a_non_local_server():
    assert ai.base_url({}) == "http://127.0.0.1:11434"
    assert ai.base_url({"OLLAMA_BASE_URL": "http://localhost:11434/"}) == "http://localhost:11434"
    with pytest.raises(ai.AiUnavailable):
        ai.base_url({"OLLAMA_BASE_URL": "https://example.com"})


def test_choose_model_prefers_env_pins_then_this_tasks_order():
    installed = ["gemma4:12b", "qwen3.5:4b", "llama3.2:latest"]
    assert ai.choose_model(installed, {"MONTHLY_AI_MODEL": "llama3.2:latest"}) == "llama3.2:latest"
    assert ai.choose_model(installed, {"OLLAMA_MODEL": "gemma4:12b"}) == "gemma4:12b"
    assert ai.choose_model(installed, {}) == "qwen3.5:4b"
    assert ai.choose_model(["gemma4:12b", "llama3.2:latest"], {}) == "gemma4:12b"
    assert ai.choose_model(["llama3.2:latest"], {"OLLAMA_MODEL": "gemma4:12b"}) == "llama3.2:latest"
    assert ai.choose_model(["unknown:1b"], {}) is None


def test_vocabulary_keeps_proven_labels_and_drops_placeholders_and_one_offs():
    vocabulary, counts = ai.build_vocabulary(
        EXAMPLES, canonicalize_subcategory, extra_labels=["Payment Issue", "WIP"]
    )
    assert "Print Label" in vocabulary and "Access Related" in vocabulary
    assert "donor password reset" in vocabulary
    assert "Payment Issue" in vocabulary  # named by the trend-notes rules
    assert "Softwar Isse" not in vocabulary  # seen once
    assert "WIP" not in vocabulary
    assert counts["Print Label"] == 8 and vocabulary[0] == "Print Label"  # most used first


def test_vocabulary_merges_aliases_and_case_variants():
    examples = [example("a", "Password reset", n=2), example("b", "donor password reset", n=2),
                example("c", "access issue", n=2), example("d", "Access Related", n=1)]
    vocabulary, counts = ai.build_vocabulary(examples, canonicalize_subcategory)
    assert sorted(vocabulary, key=str.lower) == ["Access Related", "donor password reset"]
    assert counts == {"donor password reset": 4, "Access Related": 3}


def test_nearest_examples_are_the_most_similar_tickets():
    index = ai.ExampleIndex(EXAMPLES)
    probe = ai.make_example("Label will not print at the center", "", "?")
    labels = [found["label"] for _, found in index.nearest(probe, k=2)]
    assert labels[0] == "Print Label"
    assert all(not ai.is_placeholder(e["label"]) for e in index.examples)


def test_interpret_accepts_known_labels_and_caps_unsupported_confidence():
    neighbours = [(0.9, EXAMPLES[0]), (0.4, EXAMPLES[1])]
    vocabulary = ["Print Label", "Access Related"]
    ok = ai.interpret({"label": "print label", "confidence": "high", "reason": "x"}, vocabulary, neighbours)
    assert ok["label"] == "Print Label" and ok["confidence"] == "high" and not ok["is_new"]
    unsupported = ai.interpret({"label": "Access Related", "confidence": "high"}, vocabulary, neighbours)
    assert unsupported["confidence"] == "medium"
    guess = ai.interpret({"label": "Access Related", "confidence": "low"}, vocabulary, neighbours)
    assert guess["confidence"] == "low"
    weak = ai.interpret({"label": "Print Label", "confidence": "low"}, vocabulary, [(0.4, EXAMPLES[0])])
    assert weak["confidence"] == "medium"  # a moderately similar past ticket used it
    assert ok["reason"].startswith('Similar past ticket: "Printer not printing labels"')
    assert ai.interpret({"label": "Bogus", "confidence": "high"}, vocabulary, neighbours) is None


def test_interpret_new_labels_are_low_confidence_and_placeholders_are_refused():
    vocabulary = ["Print Label"]
    neighbours = [(0.2, EXAMPLES[0])]
    new = ai.interpret({"label": "NEW", "new_label": "Drive Mapping", "confidence": "high"}, vocabulary, neighbours)
    assert new["label"] == "Drive Mapping" and new["is_new"] and new["confidence"] == "low"
    reused = ai.interpret({"label": "NEW", "new_label": "print label", "confidence": "low"}, vocabulary, neighbours)
    assert reused["label"] == "Print Label" and not reused["is_new"]
    assert ai.interpret({"label": "NEW", "new_label": "WIP", "confidence": "high"}, vocabulary, neighbours) is None
    assert ai.interpret({"label": "NEW", "new_label": " ", "confidence": "high"}, vocabulary, neighbours) is None


def test_notes_that_are_almost_the_same_share_a_group_and_one_model_call():
    base = "Category: Application/Software Sub-Category: Employee Access Symptom reported: Offboarding Request for {} Root cause: NA Resolution: access removed and user confirmed"
    queue = {"incidents": [
        incident("INC1", "Email - Offboarding Request", base.format("Sam 20250101")),
        incident("INC2", "Email - Deactivation Request", base.format("Alex 20250202") + " today"),
        incident("INC3", "Unrelated", "Replaced the label printer ribbon and cleaned the print head then tested a label"),
        incident("INC4", "Short", "fixed"),
        incident("INC5", "Other tag", base.replace("Employee Access", "Hardware Fix").format("Pat 3")),
    ]}
    groups = ai.assign_notes_groups(queue["incidents"])
    by_number = {i["number"]: i.get("notes_group") for i in queue["incidents"]}
    assert groups == 1
    assert by_number["INC1"] == by_number["INC2"] and by_number["INC1"]
    assert by_number["INC3"] is None and by_number["INC4"] is None  # different / too short to mean anything
    assert by_number["INC5"] is None  # same text but a different Sub-Category tag

    client = FakeClient()
    ai.suggest_for_queue(queue, make_classifier(client), log=lambda *_: None)
    assert queue["incidents"][0]["ai_suggestion"] == queue["incidents"][1]["ai_suggestion"]
    assert len(client.calls) == 4  # the pair is classified once (INC1/INC2), plus INC3, INC4, INC5


def test_label_votes_weigh_similarity_and_frequency_and_reach_the_suggestion():
    neighbours = [(0.9, example("a", "Other", n=1)), (0.5, example("b", "Hardware Issue", n=24))]
    votes = ai.label_votes(neighbours)
    assert votes[0][0] == "Hardware Issue" and abs(sum(share for _, share in votes) - 1) < 1e-9
    prompt = ai.build_user_prompt({"short_description": "x"}, neighbours)
    assert "Labels of the most similar past tickets overall: Hardware Issue" in prompt
    suggestion = ai.interpret({"issue": "i", "label": "Other", "confidence": "low"}, ["Other", "Hardware Issue"], neighbours)
    assert suggestion["vote_label"] == "Hardware Issue" and 0 < suggestion["vote_share"] < 1


def test_prompt_carries_the_rules_vocabulary_and_similar_tickets():
    client = FakeClient()
    classifier = make_classifier(client)
    classifier.classify(incident("INC1", "Printer will not print labels", "Replaced toner"))
    call = client.calls[0]
    assert "shipment, bol, consignee" in call["system"]
    assert "Never output them" in call["system"]
    assert "Print Label" in call["user"] and "Replaced toner" in call["user"]
    enum = call["schema"]["properties"]["label"]["enum"]
    assert "NEW" in enum and "WIP" not in enum and "Softwar Isse" not in enum


def test_suggest_for_queue_groups_identical_tickets_and_only_touches_eligible_ones(tmp_path):
    client = FakeClient()
    classifier = make_classifier(client)
    queue = {"incidents": [
        incident("INC1", "Printer will not print labels", "same"),
        incident("INC2", "Printer will not print labels", "same"),
        incident("INC3", "AG2 only", current="Hardware Issue"),
    ]}
    cache = tmp_path / "cache.json"
    logs = []
    suggested, failed = ai.suggest_for_queue(
        queue, classifier, cache, log=logs.append,
        eligible=lambda i: i["current_subcategory2"] == NEEDS_REVIEW,
    )
    assert (suggested, failed) == (2, 0)
    assert len(client.calls) == 1  # one model call for the two identical tickets
    assert queue["incidents"][0]["ai_suggestion"]["label"] == "Print Label"
    assert queue["incidents"][0]["ai_suggestion"]["issue"] == "A label will not print."
    assert queue["incidents"][1]["ai_suggestion"]["model"] == "test-model"
    assert "ai_suggestion" not in queue["incidents"][2]

    # a re-run answers from the cache
    rerun = {"incidents": [incident("INC9", "Printer will not print labels", "same")]}
    ai.suggest_for_queue(rerun, classifier, cache, log=logs.append)
    assert len(client.calls) == 1 and rerun["incidents"][0]["ai_suggestion"]["label"] == "Print Label"


def test_a_bad_answer_does_not_stop_the_rest():
    client = FakeClient(answers=[ValueError("bad json"), {"label": "Access Related", "confidence": "medium"}])
    classifier = make_classifier(client)
    queue = {"incidents": [incident("INC1", "first"), incident("INC2", "second")]}
    suggested, failed = ai.suggest_for_queue(queue, classifier, log=lambda *_: None)
    assert (suggested, failed) == (1, 1)
    assert "ai_suggestion" not in queue["incidents"][0]
    assert queue["incidents"][1]["ai_suggestion"]["label"] == "Access Related"


def test_unavailable_server_propagates_and_budget_stops_the_pass():
    queue = {"incidents": [incident("INC1", "first")]}
    with pytest.raises(ai.AiUnavailable):
        ai.suggest_for_queue(queue, make_classifier(FakeClient(error=ai.AiUnavailable("down"))), log=lambda *_: None)
    queue = {"incidents": [incident("INC1", "first"), incident("INC2", "second")]}
    suggested, _ = ai.suggest_for_queue(queue, make_classifier(FakeClient()), budget_seconds=-1, log=lambda *_: None)
    assert suggested == 0


def prepared_with(examples):
    return PreparedIncidents(["Number"], [], {}, ["Print Label"], examples)


def test_add_ai_suggestions_is_a_no_op_when_switched_off_or_unavailable(monkeypatch):
    queue = {"incidents": [incident("INC1", "Printer will not print labels")]}
    logs = []
    monkeypatch.setenv("MONTHLY_AI_SUGGEST", "0")
    add_ai_suggestions(prepared_with(EXAMPLES), queue, None, log=logs.append)
    assert "ai_suggestion" not in queue["incidents"][0] and "switched off" in logs[-1]

    monkeypatch.setenv("MONTHLY_AI_SUGGEST", "1")

    class Down:
        def __init__(self):
            raise ai.AiUnavailable("no server")

    monkeypatch.setattr(ai, "OllamaClient", Down)
    add_ai_suggestions(prepared_with(EXAMPLES), queue, None, log=logs.append)
    assert "ai_suggestion" not in queue["incidents"][0] and "skipped" in logs[-1]


def test_add_ai_suggestions_attaches_suggestions_from_the_local_model(monkeypatch, tmp_path):
    class Up(FakeClient):
        def __init__(self):
            super().__init__()

        def installed_models(self):
            return ["qwen3.5:4b"]

    monkeypatch.delenv("MONTHLY_AI_MODEL", raising=False)
    monkeypatch.delenv("OLLAMA_MODEL", raising=False)
    monkeypatch.setattr(ai, "OllamaClient", Up)
    queue = {"incidents": [incident("INC1", "Printer will not print labels"),
                           incident("INC2", "AG2 only", current="Hardware Issue")]}
    add_ai_suggestions(prepared_with(EXAMPLES), queue, tmp_path / "c.json", log=lambda *_: None)
    assert queue["incidents"][0]["ai_suggestion"]["label"] == "Print Label"
    assert queue["incidents"][0]["ai_suggestion"]["model"] == "qwen3.5:4b"
    assert "ai_suggestion" not in queue["incidents"][1]
