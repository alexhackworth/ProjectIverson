#!/usr/bin/env python3
"""ProjectIverson lock-model backtest on the 2025 season of Kash Patel's Legacy (Sleeper).

Population: every starter actually used by a manager in the 2025 league, per week.
Train weeks 1-12 / test weeks 13-25. Outputs a summary JSON for the app.
"""
import json, os, math, urllib.request, concurrent.futures as cf, random
from collections import defaultdict

OUT = "/tmp/cvbt"; os.makedirs(OUT, exist_ok=True)
PL = "1288558717381382144"
UA = {"User-Agent": "ProjectIverson-backtest"}

def fetch(url, name):
    p = os.path.join(OUT, name)
    if not os.path.exists(p):
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
            open(p, "wb").write(r.read())
    with open(p) as f:
        return json.load(f)

league = fetch(f"https://api.sleeper.app/v1/league/{PL}", "league.json")
SC = league["scoring_settings"]
def fp(s):
    if not s: return 0.0
    return round(sum(s.get(k, 0) * v for k, v in SC.items()), 2)

W = list(range(1, 26))
tasks = []
for w in W:
    tasks += [(f"https://api.sleeper.com/stats/nba/2025/{w}?season_type=regular", f"s{w}.json"),
              (f"https://api.sleeper.com/projections/nba/2025/{w}?season_type=regular", f"p{w}.json"),
              (f"https://api.sleeper.app/v1/league/{PL}/matchups/{w}", f"m{w}.json")]
with cf.ThreadPoolExecutor(6) as ex:
    list(ex.map(lambda t: fetch(*t), tasks))

# ---------------------------------------------------------------- per-player game logs
games = defaultdict(dict)          # pid -> date -> {w, act, played, proj}
for w in W:
    for e in fetch("", f"s{w}.json") or []:
        if not e.get("date") or not e.get("player_id"): continue
        st = e.get("stats") or {}
        played = bool(st) and ((st.get("min", 0) or 0) > 0 or (st.get("sp", 0) or 0) > 0 or (st.get("gp", 0) or 0) > 0)
        games[e["player_id"]][e["date"]] = {"w": w, "act": fp(st) if played else 0.0, "played": played, "proj": None}
    for e in fetch("", f"p{w}.json") or []:
        if not e.get("date") or not e.get("player_id"): continue
        g = games[e["player_id"]].get(e["date"])
        pr = fp(e.get("stats"))
        if g is not None: g["proj"] = pr

def prior_ctx(pid, before_date):
    """season-to-date and recent averages from games strictly before the week"""
    played = [g["act"] for d, g in sorted(games[pid].items()) if d < before_date and g["played"]]
    avg = sum(played) / len(played) if played else None
    rec = played[-5:]
    ravg = sum(rec) / len(rec) if rec else None
    if len(played) >= 4:
        m = avg; sd = math.sqrt(sum((x - m) ** 2 for x in played) / (len(played) - 1))
        cv = sd / m if m > 0 else None
    else:
        cv = None
    return avg, ravg, cv, len(played)

# ---------------------------------------------------------------- starter population + real decisions
pw = []   # player-week records
for w in W:
    for m in fetch("", f"m{w}.json") or []:
        pts = m.get("players_points") or {}
        for pid in (m.get("starters") or []):
            if not pid or pid == "0": continue
            gl = [dict(g, date=d) for d, g in sorted(games[pid].items()) if g["w"] == w]
            if not gl: continue
            avg, ravg, cv, n = prior_ctx(pid, gl[0]["date"])
            locked_idx = None
            P = pts.get(pid)
            if P is not None:
                hits = [i for i, g in enumerate(gl) if abs(g["act"] - P) < 0.011]
                if hits:
                    locked_idx = hits[-1] if abs(gl[-1]["act"] - P) < 0.011 else hits[0]
            pw.append({"w": w, "pid": pid, "rid": m["roster_id"], "games": gl, "avg": avg, "ravg": ravg, "pcv": cv, "n": n,
                       "real": P, "real_idx": locked_idx})
multi = [r for r in pw if len(r["games"]) >= 2 and r["avg"] is not None]
train = [r for r in multi if r["w"] <= 12]
test = [r for r in multi if r["w"] > 12]
print(f"starter player-weeks: {len(pw)}  with >=2 games & history: {len(multi)}  train {len(train)}  test {len(test)}")

# ---------------------------------------------------------------- assumption tests
def mu_of(g, r, how="proj", wb=None):
    p = g["proj"]; a = r["avg"]; ra = r["ravg"]
    if how == "proj": return p if p is not None else (a * 0.95 if a else 0)
    if how == "avg": return a or 0
    if how == "blend":
        wp, wa, wr, b = wb
        pp = p if p is not None else (a or 0)
        return max(0, wp * pp + wa * (a or pp) + wr * (ra or a or pp) + b)
    raise ValueError

allg_train = [(g, r) for r in train for g in r["games"]]
allg_test = [(g, r) for r in test for g in r["games"]]
def err(pairs, how, wb=None):
    e = [g["act"] - mu_of(g, r, how, wb) for g, r in pairs]
    return sum(abs(x) for x in e) / len(e), math.sqrt(sum(x * x for x in e) / len(e)), sum(e) / len(e)

print("\n[1] Projection accuracy on test games (MAE, RMSE, bias=actual-pred)")
for how in ["proj", "avg"]:
    print(f"  {how:6s}", ["%.2f" % x for x in err(allg_test, how)])

# fit blend weights by least squares on train (normal equations, 4 params)
def lstsq(pairs):
    X = []; y = []
    for g, r in pairs:
        p = g["proj"] if g["proj"] is not None else (r["avg"] or 0)
        a = r["avg"] or p; ra = r["ravg"] or a
        X.append([p, a, ra, 1.0]); y.append(g["act"])
    k = 4
    A = [[sum(X[n][i] * X[n][j] for n in range(len(X))) for j in range(k)] for i in range(k)]
    bvec = [sum(X[n][i] * y[n] for n in range(len(X))) for i in range(k)]
    for i in range(k):          # gaussian elimination
        piv = A[i][i]
        for j in range(i, k): A[i][j] /= piv
        bvec[i] /= piv
        for r2 in range(k):
            if r2 != i:
                f = A[r2][i]
                for j in range(i, k): A[r2][j] -= f * A[i][j]
                bvec[r2] -= f * bvec[i]
    return bvec
WB = lstsq(allg_train)
print("  blend weights (proj, season avg, last-5 avg, intercept):", ["%.3f" % x for x in WB])
print(f"  blend ", ["%.2f" % x for x in err(allg_test, "blend", WB)])

print("\n[2] Spread & shape of outcomes (train): actual / predicted")
ratios = [g["act"] / mu_of(g, r, "blend", WB) for g, r in allg_train if mu_of(g, r, "blend", WB) > 5]
ratios.sort()
zero = sum(1 for x in ratios if x == 0) / len(ratios)
mean_r = sum(ratios) / len(ratios)
sd_r = math.sqrt(sum((x - mean_r) ** 2 for x in ratios) / len(ratios))
nz = [x for x in ratios if x > 0]
mnz = sum(nz) / len(nz); sdnz = math.sqrt(sum((x - mnz) ** 2 for x in nz) / len(nz))
skew = sum((x - mnz) ** 3 for x in nz) / len(nz) / sdnz ** 3
print(f"  n={len(ratios)}  zero-score games (DNP) = {zero:.1%}  overall CV = {sd_r:.3f}  CV when he plays = {sdnz:.3f}  skew when he plays = {skew:.2f}")
qs = [ratios[min(len(ratios) - 1, int(q / 100 * len(ratios)))] for q in (5, 25, 50, 75, 95)]
print("  ratio percentiles 5/25/50/75/95:", ["%.2f" % q for q in qs])

print("\n[3] Are games in the same week independent? (corr of consecutive residuals, train)")
res_pairs = []
for r in train:
    rs = [g["act"] - mu_of(g, r, "blend", WB) for g in r["games"]]
    res_pairs += list(zip(rs, rs[1:]))
if res_pairs:
    xs, ys = zip(*res_pairs); mx = sum(xs) / len(xs); my = sum(ys) / len(ys)
    cov = sum((a - mx) * (b - my) for a, b in res_pairs) / len(res_pairs)
    sx = math.sqrt(sum((a - mx) ** 2 for a in xs) / len(xs)); sy = math.sqrt(sum((b - my) ** 2 for b in ys) / len(ys))
    print(f"  corr = {cov / (sx * sy):.3f}  (n={len(res_pairs)})")

print("\n[4] Leakage check: projection for games he did NOT play vs did play (test)")
dnp = [g["proj"] for g, r in allg_test if not g["played"] and g["proj"] is not None]
pl = [g["proj"] for g, r in allg_test if g["played"] and g["proj"] is not None]
print(f"  mean proj when DNP {sum(dnp)/max(1,len(dnp)):.1f} (n={len(dnp)}), when played {sum(pl)/max(1,len(pl)):.1f}; DNP with proj<1: {sum(1 for x in dnp if x<1)/max(1,len(dnp)):.0%}")

# ---------------------------------------------------------------- value functions
def phi(z): return math.exp(-0.5 * z * z) / math.sqrt(2 * math.pi)
def Phi(z): return 0.5 * (1 + math.erf(z / math.sqrt(2)))
def emax_normal(mu, c, cv):
    sd = max(4, cv * max(mu, 0)); z = (c - mu) / sd
    return c * Phi(z) + mu * (1 - Phi(z)) + sd * phi(z)
QGRID = [ratios[min(len(ratios) - 1, int((i + 0.5) / 200 * len(ratios)))] for i in range(200)]
def emax_emp(mu, c, grid=QGRID):
    return sum(max(mu * q, c) for q in grid) / len(grid)
def mean_emp(mu, grid=QGRID): return mu * sum(grid) / len(grid)

def make_policy(kind, **kw):
    def value(mus):
        if not mus: return None
        if kind == "normal":
            v = max(0, mus[-1])
            for m in reversed(mus[:-1]): v = emax_normal(m, v, kw["cv"])
            return v
        v = mean_emp(mus[-1])
        for m in reversed(mus[:-1]): v = emax_emp(m, v)
        return v
    return value

def simulate(r, strat):
    gl = r["games"]
    for i, g in enumerate(gl):
        if i == len(gl) - 1: return g["act"], i
        if strat(g["act"], gl[i + 1:], r, i): return g["act"], i
    return gl[-1]["act"], len(gl) - 1

def model_strategy(value_fn, how, k=1.0, wb=None):
    def s(score, rest, r, i):
        v = value_fn([mu_of(g, r, how, wb) for g in rest])
        return score >= k * v
    return s

STRATS = {
    "Always roll (last game counts)": lambda s, rest, r, i: False,
    "Lock the first game": lambda s, rest, r, i: True,
    "v2.1 sheet rule (lock at 120% of avg)": lambda s, rest, r, i: s >= 1.2 * (r["avg"] or 0),
    "Current model (normal 30%, raw proj)": model_strategy(make_policy("normal", cv=0.30), "proj"),
}
for cv in (0.20, 0.25, 0.35, 0.40, 0.45, 0.50):
    STRATS[f"normal {int(cv*100)}%, raw proj"] = model_strategy(make_policy("normal", cv=cv), "proj")
for cv in (0.30, 0.40, 0.45):
    STRATS[f"normal {int(cv*100)}%, blended proj"] = model_strategy(make_policy("normal", cv=cv), "blend", wb=WB)
STRATS["empirical (DNP-aware), raw proj"] = model_strategy(make_policy("emp"), "proj")
STRATS["empirical (DNP-aware), blended proj"] = model_strategy(make_policy("emp"), "blend", wb=WB)
for k in (0.95, 1.05):
    STRATS[f"empirical blended, lock at {k}x"] = model_strategy(make_policy("emp"), "blend", k=k, wb=WB)

def evaluate(pop):
    out = {}
    roll = sum(r["games"][-1]["act"] for r in pop) / len(pop)
    orc = sum(max(g["act"] for g in r["games"]) for r in pop) / len(pop)
    for name, s in STRATS.items():
        v = sum(simulate(r, s)[0] for r in pop) / len(pop)
        out[name] = (v, (v - roll) / (orc - roll) if orc > roll else 0)
    real = [r for r in pop if r["real"] is not None]
    rv = sum(r["real"] for r in real) / len(real)
    out["Real managers in your league"] = (rv, (rv - roll) / (orc - roll))
    out["Perfect hindsight (best game)"] = (orc, 1.0)
    return out, roll

print("\n[5] Strategy results: avg points per starter-week (and share of the possible gain over always-roll captured)")
for label, pop in (("TRAIN wk1-12", train), ("TEST wk13-25", test)):
    res, roll = evaluate(pop)
    print(f"  {label}  (n={len(pop)})")
    for name, (v, cap) in sorted(res.items(), key=lambda x: -x[1][0]):
        print(f"    {v:6.2f}  {cap:6.1%}  {name}")

# ---------------------------------------------------------------- managers 2025 vs model (test + train, all weeks)
users = {u["user_id"]: u for u in fetch(f"https://api.sleeper.app/v1/league/{PL}/users", "users.json")}
rosters = fetch(f"https://api.sleeper.app/v1/league/{PL}/rosters", "rosters.json")
best = model_strategy(make_policy("emp"), "blend", wb=WB)
by = defaultdict(lambda: [0, 0, 0, 0, 0])
for r in multi:
    if r["real"] is None: continue
    m, _ = simulate(r, best); orc = max(g["act"] for g in r["games"]); roll = r["games"][-1]["act"]
    b = by[r["rid"]]; b[0] += r["real"]; b[1] += m; b[2] += orc; b[3] += roll; b[4] += 1
print("\n[6] 2025 managers: points per starter-week   real | tuned model | always-roll | hindsight   (lock IQ = captured share)")
team_rows = []
for rid, (real, mod, orc, roll, n) in sorted(by.items(), key=lambda x: -(x[1][0] - x[1][3]) / x[1][4]):
    ro = next(x for x in rosters if x["roster_id"] == rid); u = users.get(ro["owner_id"], {})
    nm = (u.get("metadata") or {}).get("team_name") or u.get("display_name")
    iq = (real - roll) / (orc - roll) if orc > roll else 0
    team_rows.append({"rid": rid, "team": nm, "n": n, "real": real / n, "model": mod / n, "roll": roll / n, "oracle": orc / n, "lockIQ": iq,
                      "modelIQ": (mod - roll) / (orc - roll)})
    print(f"  {nm[:26]:26s} n={n:4d}  {real/n:6.2f} | {mod/n:6.2f} | {roll/n:6.2f} | {orc/n:6.2f}   IQ {iq:5.1%}  model gain over real {((mod-real)/n):+.2f}/starter-week")

# ---------------------------------------------------------------- write summary for the app
grid20 = [round(QGRID[i * 10 + 5], 4) for i in range(20)]
res_test, roll_test = evaluate(test)
summary = {
  "season": "2025", "league": league["name"].strip(), "trainWeeks": "1-12", "testWeeks": "13-25",
  "nTrain": len(train), "nTest": len(test),
  "blend": {"proj": round(WB[0], 4), "avg": round(WB[1], 4), "recent": round(WB[2], 4), "intercept": round(WB[3], 3)},
  "ratioQuantiles": [round(q, 4) for q in QGRID],
  "dnpRate": round(zero, 4), "cvPlayed": round(sdnz, 3), "cvAll": round(sd_r, 3),
  "test": {k: {"pts": round(v, 2), "captured": round(c, 4)} for k, (v, c) in res_test.items()},
  "managers": team_rows,
}
json.dump(summary, open(os.path.join(OUT, "summary.json"), "w"), indent=1)
print("\nwrote", os.path.join(OUT, "summary.json"))
