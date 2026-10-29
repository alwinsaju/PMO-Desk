# usage: summarize-perf.py <csv> <startISO> <endISO>  -> per-role mean/max CPU (% of one core), mean WS MB, total
import csv, sys, statistics as st
from datetime import datetime
f, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
p = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None) if s.endswith("Z") else datetime.fromisoformat(s)
a = p(a); b = p(b)
rows = {}
for r in csv.DictReader(open(f)):
    t = datetime.fromisoformat(r["time"]); t = t.replace(tzinfo=None)
    # csv times are local (+05:30): convert to UTC
    from datetime import timedelta
    t = t - timedelta(hours=5, minutes=30)
    if not (a <= t <= b): continue
    rows.setdefault(r["role"], []).append((float(r["cpu_core_pct"]), float(r["ws_mb"]), r["time"]))
tot_cpu = {}
for role, v in sorted(rows.items()):
    print(f"{role:28s} n={len(v):3d} cpu(core%) mean={st.mean(x[0] for x in v):5.2f} max={max(x[0] for x in v):5.1f} ws_mb mean={st.mean(x[1] for x in v):6.1f} max={max(x[1] for x in v):6.1f}")
# machine-total per sample timestamp
bt = {}
for role, v in rows.items():
    for c, w, t in v: bt.setdefault(t, [0, 0]); bt[t][0] += c; bt[t][1] += w
if bt:
    cpus = [x[0] for x in bt.values()]; ws = [x[1] for x in bt.values()]
    print(f"{'ALL APP PROCESSES':28s} cpu(core%) mean={st.mean(cpus):5.2f} max={max(cpus):5.1f}  => {st.mean(cpus)/16:.2f}% of 16-thread machine; total WS mean={st.mean(ws):.0f} MB max={max(ws):.0f} MB")
