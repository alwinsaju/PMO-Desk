"""
Shared roster/ServiceNow name matching, used by both weekly-backlog-report
and weekly-aging-report to match this shared roster's Full Name entries
against a ServiceNow export's raw "Assigned to" text.

ServiceNow's "Assigned to" text doesn't always match the roster spelling
exactly (word order, typos, or a genuinely different display name for the
same person). match_roster_to_raw:
1. Exact match (case/word-order-insensitive token match) - silent.
2. KNOWN_ALIASES - hardcoded, confirmed-by-hand pairs for people whose
   ServiceNow name is too different to fuzzy-match safely. Add to this dict
   if a new such mismatch turns up (same dict serves both reports, since
   they read the same ServiceNow instance).
3. Conservative fuzzy fallback (single missing/extra token, or one token
   within edit-distance 2) - used, but flagged for the user to confirm.
"""

import openpyxl


KNOWN_ALIASES = {
    "Dileepu Gowda": "Dileepu a",
    "Meghana Meghana": "Meghana Nittala",
    "Saranya Saranya": "Saranya Kurada",
}


def load_roster(path):
    workbook = openpyxl.load_workbook(path, data_only=True)
    worksheet = workbook["Sheet1"]
    roster_names = []
    email_by_roster_name = {}
    for row in range(2, worksheet.max_row + 1):
        name = worksheet.cell(row=row, column=1).value
        email = worksheet.cell(row=row, column=2).value
        if name:
            name = name.strip()
            roster_names.append(name)
            if email:
                email_by_roster_name[name] = email.strip()
    # Plain messages (SystemExit prints without a traceback) so the Tasks app can show them as they are.
    if not roster_names:
        raise SystemExit(
            "The team roster has no names. Upload Names.xlsx with Full Name in column A and Email in column B."
        )
    if not email_by_roster_name:
        raise SystemExit(
            "The team roster has no email addresses. Upload Names.xlsx with Full Name in column A "
            "and Email in column B."
        )
    return roster_names, email_by_roster_name


def edit_distance(a, b):
    if a == b:
        return 0
    la, lb = len(a), len(b)
    dp = list(range(lb + 1))
    for i in range(1, la + 1):
        prev = dp[0]
        dp[0] = i
        for j in range(1, lb + 1):
            cur = dp[j]
            dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = cur
    return dp[lb]


def tokens_of(name):
    return frozenset(name.lower().replace(".", "").split())


def match_roster_to_raw(roster_names, raw_names):
    """Returns (raw_to_roster dict, unmatched_roster list, flagged list)."""
    raw_token_map = {r: tokens_of(r) for r in raw_names}
    raw_to_roster = {}
    unmatched = []
    flagged = []

    for name in roster_names:
        if name in KNOWN_ALIASES and KNOWN_ALIASES[name] in raw_names:
            raw_to_roster[KNOWN_ALIASES[name]] = name
            continue

        ntoks = tokens_of(name)
        best = None
        for raw, rtoks in raw_token_map.items():
            if rtoks == ntoks:
                best = (raw, 1.0, "exact")
                break
            is_subset_diff1 = (rtoks <= ntoks and len(ntoks) - len(rtoks) == 1) or (
                ntoks <= rtoks and len(rtoks) - len(ntoks) == 1
            )
            if is_subset_diff1:
                cand = (raw, 0.85, "missing/extra token")
                if best is None or cand[1] > best[1]:
                    best = cand
            elif len(rtoks) == len(ntoks) and len(rtoks) >= 2:
                common = rtoks & ntoks
                only_r, only_n = list(rtoks - common), list(ntoks - common)
                if len(only_r) == 1 and len(only_n) == 1 and edit_distance(only_r[0], only_n[0]) <= 2:
                    cand = (raw, 0.75, f"typo ({only_n[0]!r} vs {only_r[0]!r})")
                    if best is None or cand[1] > best[1]:
                        best = cand

        if best is None:
            unmatched.append(name)
        else:
            raw, conf, reason = best
            raw_to_roster[raw] = name
            if conf < 1.0:
                flagged.append((name, raw, conf, reason))

    return raw_to_roster, unmatched, flagged
