#!/usr/bin/env python3
"""Second pass: remove after-the-fact injury knowledge from 2025 projections and model late-scratch risk.
Run after tools/backtest.py (reuses its data and functions)."""
import json, os, sys, math
sys.argv = [sys.argv[0]]
import io, contextlib
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    exec(open(os.path.join(os.path.dirname(__file__), "backtest.py")).read())

def deleak(r):
    gl = [dict(g) for g in r["games"]]
    for i in range(1, len(gl)):
        if not gl[i]["played"] and gl[i - 1]["played"] and (gl[i]["proj"] or 0) < 1:
            gl[i]["proj"] = gl[i - 1]["proj"] if gl[i - 1]["proj"] else r["avg"]
            gl[i]["surprise"] = True
    return dict(r, games=gl)
trainD = [deleak(r) for r in train]; testD = [deleak(r) for r in test]

def surprise_rate(pop):
    n = s = 0
    for r in pop:
        for i in range(1, len(r["games"])):
            if r["games"][i - 1]["played"]:
                n += 1; s += (not r["games"][i]["played"])
    return s / n
p_tr = surprise_rate(train); p_te = surprise_rate(test)
print(f"[7] Late scratches: P(he sits a game right after playing one) train={p_tr:.1%} test={p_te:.1%}")

def policy_dnp(p, cv):
    def value(mus):
        if not mus: return None
        v = (1 - p) * max(0, mus[-1])
        for m in reversed(mus[:-1]): v = p * v + (1 - p) * emax_normal(m, v, cv)
        return v
    return value

cands = {"Current model (normal 30%, no scratch risk)": model_strategy(make_policy("normal", cv=0.30), "proj")}
for p in (0.03, 0.05, round(p_tr, 3), 0.10, 0.14):
    for cv in (0.25, 0.30, 0.35):
        cands[f"scratch risk {p:.0%}, spread {int(cv*100)}%"] = model_strategy(policy_dnp(p, cv), "proj")
base = {"Always roll (last game counts)": STRATS["Always roll (last game counts)"],
        "Lock the first game": STRATS["Lock the first game"],
        "v2.1 sheet rule (lock at 120% of avg)": STRATS["v2.1 sheet rule (lock at 120% of avg)"]}

def run(pop, strats):
    roll = sum(r["games"][-1]["act"] for r in pop) / len(pop)
    orc = sum(max(g["act"] for g in r["games"]) for r in pop) / len(pop)
    out = {k: sum(simulate(r, s)[0] for r in pop) / len(pop) for k, s in strats.items()}
    real = [r for r in pop if r["real"] is not None]
    out["Real managers in your league"] = sum(r["real"] for r in real) / len(real)
    out["Perfect hindsight (best game)"] = orc
    return {k: (v, (v - roll) / (orc - roll)) for k, v in out.items()}

allS = dict(base); allS.update(cands)
rt = run(trainD, allS)
best_name = max(cands, key=lambda k: rt[k][0])
print(f"\n[8] De-leaked results (avg pts per starter-week, share of possible gain captured)   best on TRAIN: {best_name}")
re = run(testD, allS)
for label, res in (("TRAIN", rt), ("TEST", re)):
    print(f"  {label}")
    for k, (v, c) in sorted(res.items(), key=lambda x: -x[1][0])[:8] + [x for x in sorted(res.items(), key=lambda x: -x[1][0]) if x[0] in ("Current model (normal 30%, no scratch risk)",)]:
        print(f"    {v:6.2f}  {c:6.1%}  {k}")
    for k in ("Real managers in your league", "v2.1 sheet rule (lock at 120% of avg)", "Always roll (last game counts)"):
        v, c = res[k]; print(f"    {v:6.2f}  {c:6.1%}  {k}")

# bootstrap the gap between best and current on test
import random
random.seed(7)
bs = cands[best_name]; cur = cands["Current model (normal 30%, no scratch risk)"]
diffs = [simulate(r, bs)[0] - simulate(r, cur)[0] for r in testD]
boots = []
for _ in range(2000):
    s = [random.choice(diffs) for _ in diffs]; boots.append(sum(s) / len(s))
boots.sort()
print(f"\n[9] Tuned vs current on TEST: {sum(diffs)/len(diffs):+.3f} pts per starter-week (95% CI {boots[50]:+.3f} to {boots[1950]:+.3f})")

# per-team 2025 with the tuned model
by = {}
for r in trainD + testD:
    if r["real"] is None: continue
    m, _ = simulate(r, bs); o = max(g["act"] for g in r["games"]); rl = r["games"][-1]["act"]
    b = by.setdefault(r["rid"], [0, 0, 0, 0, 0]); b[0] += r["real"]; b[1] += m; b[2] += o; b[3] += rl; b[4] += 1
rows = []
for rid, (real, mod, o, rl, n) in by.items():
    ro = next(x for x in rosters if x["roster_id"] == rid); u = users.get(ro["owner_id"], {})
    nm = (u.get("metadata") or {}).get("team_name") or u.get("display_name")
    rows.append({"rid": rid, "team": nm, "n": n, "real": round(real / n, 3), "model": round(mod / n, 3), "roll": round(rl / n, 3), "oracle": round(o / n, 3),
                 "lockIQ": round((real - rl) / (o - rl), 4), "modelIQ": round((mod - rl) / (o - rl), 4)})
rows.sort(key=lambda x: -x["lockIQ"])
print("\n[10] 2025 lock IQ by team (share of possible lock gain captured) vs tuned model")
for x in rows:
    print(f"  {x['team'][:26]:26s} IQ {x['lockIQ']:5.1%}   model {x['modelIQ']:5.1%}   left on table {x['model']-x['real']:+.2f}/starter-week")

p_best = float(best_name.split("risk ")[1].split("%")[0]) / 100 if "risk " in best_name else 0
cv_best = float(best_name.split("spread ")[1].split("%")[0]) / 100 if "spread " in best_name else 0.30
summary = json.load(open(os.path.join(OUT, "summary.json")))
summary.update({"scratchRate": round(p_tr, 4), "scratchRateTest": round(p_te, 4), "chosen": {"name": best_name, "p": p_best, "cv": cv_best},
                "deleaked": {"train": {k: [round(v, 3), round(c, 4)] for k, (v, c) in rt.items()}, "test": {k: [round(v, 3), round(c, 4)] for k, (v, c) in re.items()}},
                "tunedVsCurrent": {"mean": round(sum(diffs) / len(diffs), 4), "lo": round(boots[50], 4), "hi": round(boots[1950], 4)},
                "managers2025": rows})
json.dump(summary, open(os.path.join(OUT, "summary.json"), "w"), indent=1)
print("\nchosen:", summary["chosen"])
