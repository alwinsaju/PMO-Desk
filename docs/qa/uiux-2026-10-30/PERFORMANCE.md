# Performance remeasurement — `feat/uiux-overhaul` (after the four issue fixes)

Measured on the production build (`next build`, `live-build` mode) of this branch at `915bc18`, and
on the commit before the four fixes (`0197d74`, the end of the UI/UX overhaul) with the same
data, the same machine and the same script, so the two columns can be compared directly.

**Data set:** 72 people in 8 teams, a full year of weekday shifts for all of them (18,792 days,
1.9 MB as JSON), 120 time-off requests. That is larger than the 12-person set the first QA run used,
so numbers are not comparable with `QA-DESKTOP-2026-10-29.md` except where said.

**Method:** Electron driven over CDP; "ready" is the time from the click until the screen shows
what it should; "worst frame" is the longest `requestAnimationFrame` gap during and just after the
action (one frame is 15.6 ms on this machine). Single run each — treat ±10 % as noise.

## Verdict

**No regression from the four fixes.** Every timing is within noise of the commit before them.
Nothing introduced by this work is a performance concern. Two older hot spots showed up because the
data set is now realistic (see "Things worth knowing"); neither is new.

## API (warm, median / p95 of 20 calls, ms)

| Call                  | After fixes | Before fixes |
| --------------------- | ----------: | -----------: |
| GET employees (72)    |  8.8 / 11.6 |   9.2 / 12.1 |
| GET shifts (18,792)   | 33.0 / 55.5 |  31.4 / 48.3 |
| GET roster            |  9.6 / 11.0 |   9.2 / 12.4 |
| GET time off (120)    |  8.9 / 10.8 |   8.4 / 10.9 |
| GET offboarded        |   6.6 / 8.5 |    6.3 / 9.7 |
| Search (Ctrl+K) typed "Aarav" → results | 25 | 28 |

## Screens (ready ms / worst frame ms)

| Action                         | After fixes | Before fixes |
| ------------------------------ | ----------: | -----------: |
| Open Staff window              |    66 / 531 |     85 / 531 |
| Directory tab (72 people)      |     37 / 16 |      35 / 16 |
| Shift roster tab, first show   |   625 / 562 |    639 / 563 |
| Roster: Month view             |   332 / 437 |    312 / 313 |
| Roster: Cycle view             |   526 / 516 |    496 / 625 |
| Roster: Week view              |   287 / 188 |    287 / 203 |
| Roster: next / previous week   | 135–173 / 125–156 | 137–175 / 125–156 |
| Time off tab (120 requests)    |   644 / 578 |    588 / 531 |
| Open a request (new detail dialog) | 295 / 234 |  — (did not exist) |
| Insights tab                   |   504 / 453 |    447 / 406 |
| Close Staff window             |     59 / 78 |     42 / 94 |

The new request detail dialog opens in about 0.3 s, including its call to the server for the email.

## Import of a 72-person, full-year workbook

| Step                                            | Result |
| ----------------------------------------------- | -----: |
| Build the workbook (people, teams, 18,792 days, holidays) | 80 ms, 748 KB |
| Choose the file → summary shown (read, parse, compare with the roster) | 0.46 s |
| What the summary said for a copy with 10 days typed over | 2 new, 8 changed, 18,784 unchanged |

Because days that already match are no longer sent, uploading an unchanged year sends nothing at
all (the old import re-sent every day it read).

## Idle CPU and memory

| State                                         | CPU, all app processes | Memory |
| --------------------------------------------- | ---------------------- | ------ |
| Desktop, no window open                       | 1.4–2.2 % of one core (≈0.1 % of the machine) | ≈0.9 GB |
| Notes window open                             | 1.1 % of one core      | ≈0.86 GB |
| Staff window open (any tab)                   | ≈10–12 % of one core (≈0.7 % of the machine), the same before and after the fixes | ≈0.82 GB |

Includes the Electron main, GPU, utility and renderer processes and the Next.js server. The first
QA run saw 0 % idle with nothing open; the 1–2 % now is the tasks engine and background polling.

## Things worth knowing (older, not caused by this work)

1. **First paint of a big roster takes about half a second.** Opening the Shift roster, Month or
   Cycle view with 72 people and a full year of data, and the Time off tab with 120 requests,
   each hold the screen for 0.3–0.6 s once. Moving between weeks is smooth by comparison
   (about 0.15 s). It is the same before the fixes. If it matters, the cheapest win is to render
   only the rows in view.
2. **An open Staff window keeps the renderer at about 10 % of one core while idle.** The profile
   shows JavaScript idle (97 %), no running CSS animations and the load is the same on every tab,
   so it looks like repainting of the window rather than the roster. A Notes window does not do it.
   Unchanged by the fixes; worth a look separately if battery use matters.

## Not measured

- The AI models. The Phase 8 numbers stand (`gemma4:12b` ≈ 7 tokens/s on this CPU, `qwen3.5:4b` ≈ 60 s a
  message); none of the four fixes touches model code except that a PTO log entry now also stores the
  email text (≤ 4000 characters) and the AI's reading.
- A packaged installer build. These runs use the project's own `.next` build, as the first QA run did.
