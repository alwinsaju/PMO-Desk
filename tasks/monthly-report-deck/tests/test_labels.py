"""Spelling variants of one category collapse into one label; different categories do not."""
from collections import Counter

import pytest

from scripts.labels import LabelCanonicalizer, label_key, same_label

# The same cases are asserted by labelMatch.test.mjs (TypeScript twin).
SAME = [
    ("Soft Goods Issue", "softgoods issue"),
    ("Soft Goods Issue", "softgood issue"),
    ("Soft Goods Issue", "soft good isse"),
    ("Soft Goods Issue", "SoftGodds Issue"),
    ("Software Issue", "Software Isse"),
    ("Print Label", "print labels"),
    ("Donor Reaction Issue", "donor  reactions issue"),
    ("Unit Update - Plasma Volume", "unit update - plasma voulume"),
    ("NA", "n/a"),
]
DIFFERENT = [
    ("EDQ Issue", "EOD Issue"),
    ("CMS 1.0 issues", "CMS 2.0 Issues"),
    ("Unit Update - Arm Used", "Unit Update - Arm Used PIN"),
    ("Physical Issue", "Physical related issue"),
    ("Donor Reaction record issue", "donor reaction issue"),
    ("HAE Issue", "DXT Issue"),
]


@pytest.mark.parametrize("a,b", SAME)
def test_spelling_variants_are_the_same_label(a, b):
    assert same_label(a, b) and same_label(b, a)


@pytest.mark.parametrize("a,b", DIFFERENT)
def test_different_categories_are_not_merged(a, b):
    assert not same_label(a, b) and not same_label(b, a)


def test_label_key_ignores_case_spacing_punctuation_and_plurals():
    assert label_key(" Soft  Goods-Issue ") == label_key("softgood issues") == "softgoodissue"
    assert label_key("") == "" and label_key(None) == ""


def test_canonical_label_is_the_most_used_spelling():
    canon = LabelCanonicalizer(Counter({"Soft Goods Issue": 39, "softgoods issue": 30, "softgood issue": 1,
                                        "soft good isse": 1, "Other": 5}))
    assert canon("softgood issue") == canon("soft good isse") == canon("SOFTGOODS ISSUE") == "Soft Goods Issue"
    assert canon("Other") == "Other"
    assert canon("Brand New Category") == "Brand New Category"  # unknown labels are kept (whitespace cleaned)
    assert canon("  Brand   New Category ") == "Brand New Category"
    assert canon("   ") == ""


def test_a_typo_cannot_turn_a_real_category_into_another():
    counts = Counter({"Deferral issue": 169, "Referral bonus issue": 40, "Referral issue": 2})
    canon = LabelCanonicalizer(counts)
    assert canon("Referral issue") == "Referral issue"  # "referral" is a real word of another category
    assert canon("Deferral issue") == "Deferral issue"


def test_chains_of_near_matches_do_not_merge_different_labels():
    # a~b and b~c by one character each, but a and c are two apart
    canon = LabelCanonicalizer(Counter({"Donor Entry Issues here": 50, "Donor Entry Issuess here": 3, "Donor Entry Isssue here x": 2}))
    assert canon("Donor Entry Issues here") == "Donor Entry Issues here"


def test_broken_characters_are_never_the_preferred_spelling():
    canon = LabelCanonicalizer(Counter({"lab \ufffd import issue": 100, "lab import issue": 10}))
    assert canon("lab \ufffd import issue") == "lab import issue"
