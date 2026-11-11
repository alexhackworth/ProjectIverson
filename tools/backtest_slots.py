#!/usr/bin/env python3
"""Slot-based lock engine vs per-player model, 2025 Kash Patel's Legacy.

Rules modeled (from the league): a lineup slot holds the score of whoever is in it; until locked, any eligible
player whose game hasn't tipped can be put in (bench or free agent), replacing the slot's score; a slot can't keep a
score if its player is moved out or plays again unless it is locked first. Decisions are made once per night (no
same-night swaps). A slot's value with banked score s and future best draws X_t is max(s, M) where
M_t = max(D_t, M_{t+1}),  D_t = p*M_{t+1} + (1-p)*E[max(X_t, M_{t+1})]  (a scratch scores 0, so you'd draw again).
"""
import io, os, math, contextlib, json, random
from collections import defaultdict
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    exec(open(os.path.join(os.path.dirname(__file__), "backtest.py")).read())

# positions
POS = {}
for w in W:
    for e in fetch("", f"s{w}.json") or []:
        p = e.get("player") or {}
        if e.get("player_id") and p.get("fantasy_positions"): POS[e["player_id"]] = set(p["fantasy_positions"])
SLOTS = [s for s in league["roster_positions"] if s not in ("BN", "IR")]
ELIG = {"PG": {"PG"}, "SG": {"SG"}, "G": {"PG", "SG"}, "SF": {"SF"}, "PF": {"PF"}, "F": {"SF", "PF"}, "C": {"C"}}
SPEC = {"C": 0, "PG": 0, "SG": 0, "SF": 0, "PF": 0, "G": 1, "F": 1, "UTIL": 2}
def eligible(pid, slot):
    return slot == "UTIL" or bool(POS.get(pid, set()) & ELIG.get(slot, set()))

def emax(mu, c, cv):
    sd = max(4, cv * max(mu, 0)); z = (c - mu) / sd
    return c * Phi(z) + mu * (1 - Phi(z)) + sd * phi(z)
def draw_value(mu, M, p, cv):
    return p * M + (1 - p) * emax(mu, M, cv)

def week_games(pid, w):
    gl = [dict(g, date=d) for d, g in sorted(games[pid].items()) if g["w"] == w]
    for i in range(1, len(gl)):        # restore pre-game projection for surprise absences
        if not gl[i]["played"] and gl[i - 1]["played"] and (gl[i]["proj"] or 0) < 1:
            gl[i]["proj"] = gl[i - 1]["proj"]
    return {g["date"]: g for g in gl}

def avg_before(pid, d):
    pl = [g["act"] for dd, g in sorted(games[pid].items()) if dd < d and g["played"]]
    return sum(pl) / len(pl) if pl else 15.0

def mu_of_g(g, pid):
    return g["proj"] if g["proj"] is not None else avg_before(pid, g["date"]) * 0.95

def allocate(open_slots, nights, sched, occupied=frozenset()):
    """Greedy: each night, slots (lowest banked first, most specific first) take the best eligible unassigned player.
    Players sitting in other slots (locked, or holding a banked score) are off limits."""
    plan = defaultdict(dict)   # slot_idx -> night -> (pid, mu)
    for d in nights:
        taken = set()
        order = sorted(open_slots, key=lambda k: (open_slots[k]["s"] if open_slots[k]["s"] is not None else -1, SPEC[SLOTS[k]]))
        for k in order:
            best = None
            for pid, gmap in sched.items():
                g = gmap.get(d)
                if not g or pid in taken or not eligible(pid, SLOTS[k]): continue
                if pid in occupied and pid != open_slots[k]["occ"]: continue
                mu = mu_of_g(g, pid)
                if best is None or mu > best[1]: best = (pid, mu)
            if best: plan[k][d] = best; taken.add(best[0])
    return plan

def run_slots(m, w, p_future, p_tonight, cv, fa_pool=None, fa_budget=0):
    roster = [x for x in (m.get("players") or []) if x and x != "0"]
    starters = [x for x in (m.get("starters") or [])]
    sched = {pid: week_games(pid, w) for pid in roster}
    fa_used = 0
    dates = sorted({d for gm in sched.values() for d in gm} | ({d for gm in (fa_pool or {}).values() for d in gm}))
    slots = {k: {"occ": starters[k] if k < len(starters) else None, "s": None, "locked": False} for k in range(len(SLOTS))}
    for di, d in enumerate(dates):
        open_slots = {k: v for k, v in slots.items() if not v["locked"]}
        if not open_slots: break
        pool = dict(sched)
        if fa_pool and fa_used < fa_budget: pool.update(fa_pool)
        occupied = frozenset(v["occ"] for v in slots.values() if v["occ"] and (v["locked"] or v["s"] is not None))
        plan = allocate(open_slots, dates[di:], pool, occupied)
        for k, v in open_slots.items():
            fut = [plan[k].get(t) for t in dates[di + 1:]]
            M = 0.0
            for x in reversed(fut):
                if x: M = max(M, draw_value(x[1], M, p_future, cv))
            tonight = plan[k].get(d)
            hold = max(v["s"] if v["s"] is not None else 0.0, M)
            occ_plays = v["occ"] in sched and d in sched[v["occ"]]
            if tonight and draw_value(tonight[1], M, p_tonight, cv) > hold + 1e-9:
                pid = tonight[0]; g = pool[pid][d]
                v["s"] = g["act"] if g["played"] else 0.0; v["occ"] = pid
                if fa_pool and pid in fa_pool and pid not in sched: fa_used += 1
            elif occ_plays and v["s"] is not None:
                v["locked"] = True
    return sum((v["s"] or 0.0) for v in slots.values())

def run_v3(m, w, p, cv):
    tot = 0.0
    for pid in (m.get("starters") or []):
        if not pid or pid == "0": continue
        gl = sorted(week_games(pid, w).values(), key=lambda g: g["date"])
        if not gl: continue
        val = None
        for i, g in enumerate(gl):
            val = g["act"] if g["played"] else 0.0
            rest = [mu_of_g(x, pid) for x in gl[i + 1:]]
            if not rest: break
            M = 0.0
            for mu in reversed(rest): M = max(M, draw_value(mu, M, p, cv))
            if val >= M: break
        tot += val or 0.0
    return tot

# free-agent pool per week: best unrostered players (top 25 by projection that week)
def fa_pool_for(w):
    rostered = {x for m in fetch("", f"m{w}.json") or [] for x in (m.get("players") or [])}
    cands = defaultdict(float)
    for pid, gm in games.items():
        if pid in rostered: continue
        for d, g in gm.items():
            if g["w"] == w and g["proj"]: cands[pid] = max(cands[pid], g["proj"])
    top = sorted(cands, key=lambda k: -cands[k])[:25]
    return {pid: week_games(pid, w) for pid in top}

rows = []
for w in W:
    ms = fetch("", f"m{w}.json") or []
    if not any(m.get("points") for m in ms): continue
    fa = fa_pool_for(w)
    for m in ms:
        if not m.get("starters"): continue
        rows.append({"w": w, "rid": m["roster_id"], "real": m.get("points") or 0,
                     "v3": run_v3(m, w, 0.10, 0.25),
                     "slots": run_slots(m, w, 0.10, 0.05, 0.25),
                     "slots_p10": run_slots(m, w, 0.10, 0.10, 0.25),
                     "slots_fa2": run_slots(m, w, 0.10, 0.05, 0.25, fa, 2)})
def summ(rs, label):
    n = len(rs); k = lambda key: sum(r[key] for r in rs) / n
    print(f"  {label} (team-weeks n={n}): real {k('real'):.1f} | v3 per-player {k('v3'):.1f} | slots+bench {k('slots'):.1f} | slots+bench (10% scratch tonight) {k('slots_p10'):.1f} | slots+bench+2 FA adds {k('slots_fa2'):.1f}")
print("Team points per week (11 slots):")
summ([r for r in rows if r["w"] <= 12], "TRAIN wk1-12"); summ([r for r in rows if r["w"] > 12], "TEST wk13-25"); summ(rows, "ALL")
te = [r for r in rows if r["w"] > 12]
d = [r["slots"] - r["v3"] for r in te]; random.seed(3)
bs = sorted(sum(random.choice(d) for _ in d) / len(d) for _ in range(2000))
print(f"slots+bench minus v3 on TEST: {sum(d)/len(d):+.2f} pts/team-week (95% CI {bs[50]:+.2f} to {bs[1950]:+.2f})")
d2 = [r["slots"] - r["real"] for r in te]
print(f"slots+bench minus real managers on TEST: {sum(d2)/len(d2):+.2f} pts/team-week")
by = defaultdict(list)
for r in rows: by[r["rid"]].append(r)
for rid, rs in sorted(by.items()):
    n = len(rs); print(f"  roster {rid:2d}: real {sum(x['real'] for x in rs)/n:6.1f}  slots {sum(x['slots'] for x in rs)/n:6.1f}  v3 {sum(x['v3'] for x in rs)/n:6.1f}")
json.dump({"n": len(rows), "test": {k: round(sum(r[k] for r in te)/len(te), 2) for k in ("real", "v3", "slots", "slots_p10", "slots_fa2")},
           "gain_vs_v3": [round(sum(d)/len(d), 2), round(bs[50], 2), round(bs[1950], 2)], "gain_vs_real": round(sum(d2)/len(d2), 2)},
          open("/tmp/cvbt/slots_summary.json", "w"), indent=1)
