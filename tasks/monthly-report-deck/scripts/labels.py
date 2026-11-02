"""Fold spelling variants of the same category into one label.

People type "softgood issue", "Soft Goods Issue", "soft good isse" for the same category,
and every variant used to become its own option. Two labels are the same when, after
lower-casing, dropping punctuation/spaces and ignoring a plural "s" per word, their digits
are identical (so "CMS 1.0 issues" and "CMS 2.0 Issues" stay apart) and they are either
identical or - a typo - differ by at most one character (two for 20+ characters).

Guards against merging genuinely different categories:
  * short labels (under 12 characters) must match exactly: "EDQ Issue" is not "EOD Issue";
  * the first letter must match;
  * a typo may only introduce words nobody uses elsewhere: "Referral issue" is not a typo
    of "Deferral issue" because "referral" is a real word of another category;
  * a label that adds a whole word ("Unit Update - Arm Used" vs "... Arm Used PIN") is
    more than a typo away.

The most used spelling of a group becomes its canonical label. The TypeScript twin of
this logic (src/components/apps/tasks-app/labelMatch.ts) must stay in step; both are
tested with the same cases.
"""
import re
from collections import Counter

FUZZY_MIN_LENGTH = 12
LONG_LENGTH = 20
KNOWN_WORD_MIN_COUNT = 10
REPLACEMENT_CHAR = "\ufffd"


def _stem(word):
    return word[:-1] if len(word) > 3 and word.endswith("s") and not word.endswith("ss") else word


def label_words(label):
    return [_stem(word) for word in re.sub(r"[^a-z0-9]+", " ", str(label or "").lower()).split()]


def label_key(label):
    return "".join(label_words(label))


def _digits(key):
    return re.findall(r"\d+", key)


def _within(a, b, limit):
    """True when the edit distance of a and b is at most `limit` (small limits only)."""
    if abs(len(a) - len(b)) > limit:
        return False
    previous = list(range(len(b) + 1))
    for i, char_a in enumerate(a, start=1):
        current = [i]
        for j, char_b in enumerate(b, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (char_a != char_b)))
        if min(current) > limit:
            return False
        previous = current
    return previous[-1] <= limit


def _close(label, other, is_known_word):
    """Same label up to a typo; `is_known_word(word)` says whether a word is in real use."""
    key, other_key = label_key(label), label_key(other)
    if not key or not other_key:
        return False
    if key == other_key:
        return True
    longest = max(len(key), len(other_key))
    if longest < FUZZY_MIN_LENGTH or key[0] != other_key[0] or _digits(key) != _digits(other_key):
        return False
    if not _within(key, other_key, 2 if longest >= LONG_LENGTH else 1):
        return False
    own_words = set(label_words(other))
    return not any(word not in own_words and is_known_word(word) for word in label_words(label))


def same_label(a, b):
    """Typo-tolerant comparison of two labels with no knowledge of other labels."""
    return _close(a, b, lambda word: False)


def clean_label(label):
    return re.sub(r"\s+", " ", str(label or "")).strip()


class LabelCanonicalizer:
    """Maps any spelling to the most used spelling of its group.

    `counts` is how often each spelling was used. Labels are visited most used first;
    each joins the first representative it is the same as, or becomes a new one, so a chain
    of near matches can never merge two genuinely different labels."""

    def __init__(self, counts):
        merged = Counter()
        for label, count in counts.items():
            label = clean_label(label)
            if label:
                merged[label] += count
        self._word_use = Counter()
        for label, count in merged.items():
            for word in set(label_words(label)):
                self._word_use[word] += count
        self.representatives = []
        self._by_key = {}
        self._mapping = {}
        # A spelling with a broken character is never preferred as the canonical one; ties
        # keep the order the labels were given (newest first when learned from history).
        order = sorted(merged.items(), key=lambda item: (REPLACEMENT_CHAR in item[0], -item[1]))
        for label, count in order:
            representative = self._find(label, count)
            if representative is None:
                self.representatives.append(label)
                self._by_key[label_key(label)] = label
                representative = label
            self._mapping[label] = representative

    def _find(self, label, own_count=0):
        key = label_key(label)
        if key in self._by_key:
            return self._by_key[key]
        own_words = set(label_words(label))

        def known(word):
            # use of the word by other labels, not by this very spelling
            return self._word_use[word] - (own_count if word in own_words else 0) >= KNOWN_WORD_MIN_COUNT

        return next((rep for rep in self.representatives if _close(label, rep, known)), None)

    def __call__(self, label):
        label = clean_label(label)
        if not label:
            return label
        return self._mapping.get(label) or self._find(label) or label
