/* ProjectIverson — Performance, Team, Players and Trade Lab (beta) tabs. */
(() => {
"use strict";
const P = window.PI, C = window.PI_CHART, M = window.PI_MODEL;
const { $, esc, f1, f2 } = P;
const API = P.API, API2 = P.API2;
const cache = { raw:{}, logs:{}, proj:{}, news:{}, research:{}, trending:null, prevStats:{}, selPlayer:null, playersTeam:null };
const pct = x => x==null || isNaN(x) ? "–" : `${Math.round(x*100)}%`;
const sgn = x => (x>0?"+":"") + f1(x);
const mean = a => a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
const quant = (a,q) => { if(!a.length) return null; const s=[...a].sort((x,y)=>x-y); return s[Math.min(s.length-1, Math.max(0, Math.round(q*(s.length-1))))]; };
const ACC = "var(--accent-text)", REF = "rgba(243,245,248,.55)", MODEL = "#9fc4ff";
function reset(){ cache.raw = {}; cache.logs = {}; cache.proj = {}; cache.research = {}; cache.prevStats = {}; cache.playersTeam = null; cache.selPlayer = null; }
async function pool(items, n, fn){ const out = []; let i = 0; await Promise.all(Array.from({length:Math.min(n, items.length)}, async () => { while(i < items.length){ const k = i++; try{ out[k] = await fn(items[k]); }catch(e){ out[k] = null; } } })); return out; }
const scoreFn = () => P.scorer(P.S.league.scoring_settings || {});
const myRid = () => P.cfg.rosterId;
const nameOf = pid => P.S.info?.[pid]?.name || `Player ${pid}`;
function ownerOf(pid){ const r = P.S.rosters.find(x=>(x.players||[]).includes(pid)); return r ? r.roster_id : null; }
function loading(el, msg){ el.innerHTML = `<div class="card loadcard"><span class="live busy"></span>${esc(msg)}</div>`; }

/* ================================================================= week history */
async function weekRaw(w){
  const S = P.S, lid = P.cfg.leagueId, key = `pi:wk1:${lid}:${S.seasonYear}:${w}`;
  const done = w < S.maxWeek;
  if(cache.raw[w] && done) return cache.raw[w];
  if(done){ try{ const c = JSON.parse(P.store.get(key) || "null"); if(c){ cache.raw[w] = c; return c; } }catch(e){} }
  let matchups, stats, projs;
  if(S.raw && S.raw.wk === w){ ({matchups, stats, projs} = S.raw); }
  else [matchups, stats, projs] = await Promise.all([
    P.getJSON(`${API}/league/${lid}/matchups/${w}`), P.getJSON(`${API2}/stats/nba/${S.seasonYear}/${w}?season_type=regular`),
    P.getJSON(`${API2}/projections/nba/${S.seasonYear}/${w}?season_type=regular`)]);
  if(w === S.maxWeek - 1) cache.prevStats[w] = stats;
  const fp = scoreFn(), sb = {}, pb = {};
  for(const e of stats||[]){ if(!e.date) continue; const st = e.stats||{}; const played = Object.keys(st).length>0 && ((st.min||0)>0 || (st.sp||0)>0 || (st.gp||0)>0); (sb[e.player_id] ||= {})[e.date] = [played ? fp(st) : 0, played ? 1 : 0]; }
  for(const e of projs||[]){ if(e.date) (pb[e.player_id] ||= {})[e.date] = fp(e.stats); }
  const teams = {};
  for(const m of matchups||[]){
    const starters = (m.starters||[]).filter(x=>x && x!=="0");
    teams[m.roster_id] = { pts: m.points||0, mid: m.matchup_id, st: starters.map(pid => {
      const dates = [...new Set([...Object.keys(sb[pid]||{}), ...Object.keys(pb[pid]||{})])].sort();
      return { pid, real: m.players_points?.[pid] ?? null, g: dates.map(d => [d, sb[pid]?.[d]?.[0] ?? null, pb[pid]?.[d] ?? null, sb[pid]?.[d]?.[1] ?? 0]) };
    }) };
  }
  const out = { w, teams };
  cache.raw[w] = out;
  if(done) P.store.set(key, JSON.stringify(out));
  return out;
}
async function allWeeks(progress){
  const n = P.S.maxWeek, ws = Array.from({length:n},(_,i)=>i+1);
  let k = 0;
  return pool(ws, 2, async w => { const r = await weekRaw(w); k++; progress?.(k, n); return r; });
}
/** Decision analysis for one starter-week (completed games only). */
function analyze(s, today){
  const games = s.g.filter(x => x[1] != null && x[0] < today);
  if(games.length < 2 || s.real == null) return null;
  const acts = games.map(x=>x[1]), projs = games.map(x=>x[2] ?? acts.reduce((a,b)=>a+b,0)/acts.length);
  const near = (a,b) => Math.abs(a-b) < 0.011, L = acts.length-1;
  let realIdx = near(acts[L], s.real) ? L : acts.findIndex(a=>near(a, s.real)); if(realIdx < 0) realIdx = null;
  let modelIdx = L;
  for(let i=0;i<L;i++){ const v = P.contValue(projs.slice(i+1)); if(acts[i] >= v){ modelIdx = i; break; } }
  const roll = acts[L], oracle = Math.max(...acts), model = acts[modelIdx];
  const aligned = realIdx === modelIdx;
  let win = null, miss = null;
  if(aligned){
    const gain = modelIdx < L ? s.real - roll : s.real - acts[0];
    if(gain >= 3 && !(modelIdx === L && acts[0] === 0)) win = { gain, kind: modelIdx < L ? "lock" : "roll", alt: modelIdx < L ? roll : acts[0], day: games[modelIdx][0] };
  } else if(realIdx != null && model - s.real >= 4){
    miss = { lost: model - s.real, kind: modelIdx < realIdx ? "rolled-past" : "locked-early", modelDay: games[modelIdx][0], modelScore: model, realDay: games[realIdx][0] };
  }
  return { pid: s.pid, real: s.real, roll, oracle, model, aligned, realIdx, modelIdx, n: acts.length, win, miss, acts, dates: games.map(x=>x[0]) };
}
function weekSummary(raw, today){
  const out = {};
  for(const [rid, t] of Object.entries(raw.teams)){
    const rows = t.st.map(s=>analyze(s, today)).filter(Boolean);
    const sum = k => rows.reduce((a,r)=>a+r[k],0);
    const gainPossible = sum("oracle") - sum("roll");
    out[rid] = { rows, n: rows.length, real: sum("real"), model: sum("model"), roll: sum("roll"), oracle: sum("oracle"),
      iq: gainPossible > 0 ? (sum("real")-sum("roll"))/gainPossible : null, miq: gainPossible > 0 ? (sum("model")-sum("roll"))/gainPossible : null,
      aligned: rows.filter(r=>r.realIdx!=null).length ? rows.filter(r=>r.aligned).length / rows.filter(r=>r.realIdx!=null).length : null, pts: t.pts, mid: t.mid };
  }
  return out;
}

/* ================================================================= Performance */
async function renderPerformance(){
  const el = $("view-performance"), S = P.S, mine = String(myRid());
  loading(el, "Loading this season's weeks from Sleeper…");
  const raws = await allWeeks((k,n)=>{ const c = el.querySelector(".loadcard"); if(c) c.lastChild.textContent = `Loading week ${k} of ${n} from Sleeper…`; });
  const today = P.etToday();
  const weeks = raws.filter(Boolean).filter(r => r.w < S.maxWeek);   // in-progress week is judged on the Lock Console
  if(!weeks.length){ el.innerHTML = `<div class="tabhead"><div><h2>Performance</h2><p>Your first completed week will show up here once it's final.</p></div></div>`; return; }
  const sums = weeks.map(r => ({ w: r.w, s: weekSummary(r, today) }));
  const all = sums.flatMap(x => (x.s[mine]?.rows||[]).map(r => ({...r, w:x.w})));
  const season = rid => { const rs = sums.flatMap(x=>x.s[rid]?.rows||[]); const g = rs.reduce((a,r)=>a+r.oracle-r.roll,0); return { n: rs.length, iq: g>0 ? rs.reduce((a,r)=>a+r.real-r.roll,0)/g : null, miq: g>0 ? rs.reduce((a,r)=>a+r.model-r.roll,0)/g : null, left: rs.reduce((a,r)=>a+r.model-r.real,0), aligned: (()=>{ const k = rs.filter(r=>r.realIdx!=null); return k.length ? k.filter(r=>r.aligned).length/k.length : null; })() }; };
  const me = season(mine);
  const rids = Object.keys(sums[0]?.s || {});
  const league = rids.map(rid => ({ rid, ...season(rid) }));
  const lgIQ = mean(league.map(x=>x.iq).filter(x=>x!=null));
  const wins = all.filter(r=>r.win).sort((a,b)=>b.w-a.w || b.win.gain-a.win.gain);
  const misses = all.filter(r=>r.miss).sort((a,b)=>b.miss.lost-a.miss.lost).slice(0,6);
  const winPts = wins.reduce((a,r)=>a+r.win.gain,0);
  const tLabel = rid => P.teamLabel(Number(rid)).name;
  const winCard = r => `<div class="wincard"><div class="wc-top"><span class="wc-ic">${P.TROPHY}</span><b>+${f1(r.win.gain)} pts</b><span class="wc-tag">${r.w >= M.launchWeek ? "With CourtVision" : "Matched CourtVision"} · Week ${r.w}</span></div>
      <div class="wc-name">${esc(nameOf(r.pid))}</div>
      <p>${r.win.kind==="lock" ? `Locked ${P.dayName(r.win.day)} at ${f2(r.real)}, as CourtVision advised. Rolling to the end would have left ${f2(r.win.alt)}.` : `Rolled past a ${f2(r.win.alt)} game, as CourtVision advised, and finished with ${f2(r.real)}.`}</p></div>`;
  el.innerHTML = `
    <div class="tabhead"><div><h2>Performance</h2><p>How well your team locks, how often it follows CourtVision, and what that's worth. Built from your league's Sleeper history, so it covers both co-owners.</p></div></div>
    <section class="kpis">
      <div class="card kpi"><small>Lock IQ this season</small><b>${pct(me.iq)}</b><span>share of the possible lock gain you captured · league avg ${pct(lgIQ)}</span></div>
      <div class="card kpi"><small>CourtVision would capture</small><b>${pct(me.miq)}</b><span>on the same starters and weeks</span></div>
      <div class="card kpi"><small>Followed CourtVision</small><b>${pct(me.aligned)}</b><span>of ${me.n} lock decisions matched its call</span></div>
      <div class="card kpi win"><small>CourtVision wins</small><b>${wins.length}</b><span>${wins.length ? `+${f1(winPts)} pts versus the alternative` : "Wins show up here as games finish"}</span></div>
    </section>
    ${wins.length ? `<section class="card"><div class="cardhead"><h2>CourtVision wins</h2><span class="sub">Decisions that matched CourtVision and paid off by 3+ points</span></div><div class="wins">${wins.slice(0,9).map(winCard).join("")}</div></section>` : ""}
    <section class="grid2">
      <article class="card"><div class="cardhead"><h2>Lock IQ by week</h2><span class="sub">higher is better</span></div><div id="chIQ"></div></article>
      <article class="card"><div class="cardhead"><h2>Points left on the table</h2><span class="sub">CourtVision's result minus yours, per week</span></div><div id="chLeft"></div></article>
    </section>
    <section class="grid2">
      <article class="card"><div class="cardhead"><h2>League Lock IQ, ${esc(S.seasonYear)}</h2><span class="sub">all weeks so far</span></div><div id="chBoard"></div></article>
      <article class="card"><div class="cardhead"><h2>Biggest misses</h2><span class="sub">where a different call would have scored 4+ more</span></div>
        ${misses.length ? `<div class="misslist">${misses.map(r=>`<div class="missrow"><b>−${f1(r.miss.lost)}</b><div><div class="n">${esc(nameOf(r.pid))} · Week ${r.w}</div><span>${r.miss.kind==="rolled-past" ? `Rolled past ${f2(r.miss.modelScore)} on ${P.dayName(r.miss.modelDay)} (CourtVision said lock); ended with ${f2(r.real)}.` : `Locked ${f2(r.real)} on ${P.dayName(r.miss.realDay)}; CourtVision said roll, and he later scored ${f2(r.miss.modelScore)}.`}</span></div></div>`).join("")}</div>` : `<div class="empty">No big misses yet.</div>`}
      </article>
    </section>
    <section class="card" id="impactCard"></section>
    <section class="card"><div class="cardhead"><h2>Model report card</h2><span class="sub">${esc(M.version)} · tested on ${esc(M.backtest.league)} ${esc(M.backtest.season)}, ${esc(M.backtest.test)}</span></div>
      <div class="grid2 inner"><div><h3 class="mini-h">Average points kept per starter-week</h3><div id="chBT"></div><p class="note">Share of the possible gain (hindsight minus always-roll) in brackets. Upgrade over v2: +${f2(M.backtest.gain.mean)} pts per starter-week (95% CI +${f2(M.backtest.gain.lo)} to +${f2(M.backtest.gain.hi)}), about +${f1(M.backtest.gain.mean*11)} per team per week.</p></div>
      <div><h3 class="mini-h">Assumptions tested</h3><ul class="checks">${M.backtest.checks.map(c=>`<li class="${c.ok?"ok":"fix"}"><b>${esc(c.k)}</b><span>${esc(c.v)}</span><em>${c.ok?"holds":"fixed in v3"}</em></li>`).join("")}</ul>
      <h3 class="mini-h" style="margin-top:14px">2025 Lock IQ by team</h3><div id="chBT25"></div></div></div></section>
    <section class="card"><div class="cardhead"><h2>CourtVision usage</h2><span class="sub">this device only · no accounts or tracking servers</span></div><div class="grid2 inner"><div id="chUse"></div><div id="useStats"></div></div></section>`;

  const labels = sums.map(x=>`Wk ${x.w}`);
  C.line($("chIQ"), { labels, aria:"Lock IQ by week", fmt: v=>v==null?"–":pct(v), yTick: v=>pct(v), yMin: 0, yMax: 1,
    series:[ {name:"You", color:ACC, values: sums.map(x=>x.s[mine]?.iq ?? null)},
             {name:"League avg", color:REF, dash:"dash", values: sums.map(x=>mean(Object.values(x.s).map(t=>t.iq).filter(v=>v!=null)))},
             {name:"CourtVision", color:MODEL, dash:"dot", values: sums.map(x=>x.s[mine]?.miq ?? null)} ] });
  C.bars($("chLeft"), { labels, values: sums.map(x=>x.s[mine] ? x.s[mine].model - x.s[mine].real : 0), yName:"Points left", aria:"Points left on the table by week",
    color: v => v > 0 ? "var(--accent)" : "rgba(243,245,248,.4)", note: i => { const t = sums[i].s[mine]; return t ? `You kept ${f1(t.real)} on multi-game starters; CourtVision ${f1(t.model)}` : ""; } });
  C.hbars($("chBoard"), { fmt: pct, items: league.filter(x=>x.iq!=null).sort((a,b)=>b.iq-a.iq).map(x=>({ label: tLabel(x.rid), value: x.iq, mine: x.rid===mine, color: x.rid===mine ? ACC : "rgba(243,245,248,.38)",
    tip: `<b>${esc(tLabel(x.rid))}</b><div>Lock IQ<span>${pct(x.iq)}</span></div><div>CourtVision on their roster<span>${pct(x.miq)}</span></div><div>Followed CourtVision<span>${pct(x.aligned)}</span></div>` })) });
  C.hbars($("chBT"), { fmt: v=>f2(v), items: M.backtest.results.map(r=>({ label: r.name, sub: `(${pct(r.cap)})`, value: r.pts, mine: r.mine, color: r.mine ? ACC : r.ref ? "rgba(243,245,248,.22)" : "rgba(243,245,248,.42)" })) });
  C.hbars($("chBT25"), { fmt: pct, items: M.backtest.managers2025.map(r=>({ label: r.team, value: r.iq, mine: r.mine, color: r.mine ? ACC : "rgba(243,245,248,.38)", tip:`<b>${esc(r.team)}</b><div>Lock IQ 2025<span>${pct(r.iq)}</span></div><div>CourtVision v3 on their starters<span>${pct(r.model)}</span></div><div>Left on the table<span>${f2(r.left)}/starter-week</span></div>` })) });

  window.PI_IMPACT?.mount($("impactCard"));
  let u = {}; try{ u = JSON.parse(P.store.get("pi:usage") || "{}"); }catch(e){}
  const days = Array.from({length:14},(_,i)=>{ const d = new Date(); d.setDate(d.getDate()-13+i); return d.toLocaleDateString("en-CA"); });
  C.bars($("chUse"), { labels: days.map(d=>d.slice(5).replace("-","/")), values: days.map(d=>u.days?.[d]?.v||0), yName:"Visits", xName:"Day", aria:"Visits per day", fmt: v=>String(Math.round(v)) });
  const tot = (f) => Object.values(u.days||{}).reduce((a,d)=>a+f(d),0);
  const tabs = ["console","performance","team","players","trades"].map(t=>[t, tot(d=>d.tabs?.[t]||0)]);
  $("useStats").innerHTML = `<div class="ustats"><div><b>${tot(d=>d.v)}</b><small>visits since ${esc(u.first||"today")}</small></div><div><b>${Object.keys(u.days||{}).length}</b><small>days used</small></div><div><b>${tot(d=>d.acts?.day||0)}</b><small>day plans opened</small></div><div><b>${tot(d=>d.acts?.mark||0)}</b><small>locks marked</small></div></div>
    <div class="note" style="margin-top:10px">Tabs opened: ${tabs.map(([t,n])=>`${t==="trades"?"Trade Lab":t[0].toUpperCase()+t.slice(1)} ${n}`).join(" · ")}</div>
    <p class="note">Team-wide adoption is measured above as "Followed CourtVision", which comes from Sleeper and covers both co-owners.</p>`;
}

/* ================================================================= Team */
async function renderTeam(){
  const el = $("view-team"), S = P.S, mine = String(myRid());
  loading(el, "Loading team history…");
  const raws = (await allWeeks()).filter(Boolean);
  const today = P.etToday();
  const rids = Object.keys(raws[0]?.teams || {});
  const wkLabels = raws.map(r=>`Wk ${r.w}${r.w===S.maxWeek?" (live)":""}`);
  const myPts = raws.map(r=>r.teams[mine]?.pts ?? null);
  const oppPts = raws.map(r=>{ const t = r.teams[mine]; if(!t) return null; const o = Object.entries(r.teams).find(([rid,x])=>rid!==mine && x.mid===t.mid); return o ? o[1].pts : null; });
  const lgAvg = raws.map(r=>mean(Object.values(r.teams).map(t=>t.pts)));
  const vol = rid => raws.map(r=>(r.teams[rid]?.st||[]).reduce((a,s)=>a+s.g.length,0));
  const myVol = vol(mine), lgVol = raws.map((r,i)=>mean(rids.map(rid=>vol(rid)[i])));
  // standings
  const st = S.rosters.map(r=>({ rid: r.roster_id, w: r.settings?.wins||0, l: r.settings?.losses||0, t: r.settings?.ties||0,
    pf: (r.settings?.fpts||0) + (r.settings?.fpts_decimal||0)/100, pa: (r.settings?.fpts_against||0) + (r.settings?.fpts_against_decimal||0)/100 }))
    .sort((a,b)=> b.w-a.w || b.pf-a.pf);
  // contributors: points that counted for you, by player
  const contrib = {};
  for(const r of raws){ for(const s of r.teams[mine]?.st||[]){ if(s.real!=null){ contrib[s.pid] = (contrib[s.pid]||0) + s.real; } } }
  const top = Object.entries(contrib).sort((a,b)=>b[1]-a[1]).slice(0,12);
  // next week volume
  const nw = S.maxWeek + 1, nextGames = S.schedule.filter(g=>Number(g.week)===nw);
  const teamCount = {}; for(const g of nextGames){ teamCount[g.home?.team]=(teamCount[g.home?.team]||0)+1; teamCount[g.away?.team]=(teamCount[g.away?.team]||0)+1; }
  const myR = S.rosters.find(r=>r.roster_id===myRid());
  const startersNow = (S.data?.mine?.starters||[]);
  const nextVol = startersNow.map(p=>({ p, n: teamCount[p.team]||0 }));
  const nextTot = nextVol.reduce((a,x)=>a+x.n,0);
  const lgNext = mean(S.rosters.map(r=>(r.starters||[]).filter(x=>x&&x!=="0").reduce((a,pid)=>a+(teamCount[S.info?.[pid]?.team]||0),0)));
  const record = st.find(x=>String(x.rid)===mine);
  const rank = st.findIndex(x=>String(x.rid)===mine)+1;
  const done = raws.filter(r=>r.w<S.maxWeek);
  const avgFor = mean(done.map(r=>r.teams[mine]?.pts).filter(v=>v!=null)), avgLg = mean(done.flatMap(r=>Object.values(r.teams).map(t=>t.pts)));
  el.innerHTML = `
    <div class="tabhead"><div><h2>Team</h2><p>${esc(P.teamLabel(myRid()).name)} across the season: results, scoring trend, schedule volume and who's carrying the load.</p></div></div>
    <section class="kpis">
      <div class="card kpi"><small>Record</small><b>${record?`${record.w}–${record.l}${record.t?`–${record.t}`:""}`:"–"}</b><span>${rank?`${rank}${["st","nd","rd"][rank-1]||"th"} of ${st.length}`:""}</span></div>
      <div class="card kpi"><small>Points per week</small><b>${f1(avgFor)}</b><span>league avg ${f1(avgLg)} · completed weeks</span></div>
      <div class="card kpi"><small>Next week's volume</small><b>${nextTot || "–"}</b><span>games for current starters · league avg ${f1(lgNext)}</span></div>
      <div class="card kpi"><small>Points for / against</small><b>${record?Math.round(record.pf):"–"}</b><span>against ${record?Math.round(record.pa):"–"}</span></div>
    </section>
    <section class="grid2">
      <article class="card"><div class="cardhead"><h2>Weekly points</h2><span class="sub">you vs your opponent vs league average</span></div><div id="chPts"></div></article>
      <article class="card"><div class="cardhead"><h2>Starter games per week</h2><span class="sub">more games = more chances to lock a big night</span></div><div id="chVol"></div></article>
    </section>
    <section class="grid2">
      <article class="card"><div class="cardhead"><h2>Who's carrying you</h2><span class="sub">points that counted, season to date</span></div><div id="chTop"></div></article>
      <article class="card"><div class="cardhead"><h2>Standings</h2><span class="sub">from Sleeper</span></div>
        <div class="tvwrap"><table class="stand"><thead><tr><th>#</th><th>Team</th><th class="r">W–L</th><th class="r">PF</th><th class="r">PA</th></tr></thead><tbody>
        ${st.map((x,i)=>`<tr class="${String(x.rid)===mine?"mine":""}"><td>${i+1}</td><td>${esc(P.teamLabel(x.rid).name)}</td><td class="r num">${x.w}–${x.l}${x.t?`–${x.t}`:""}</td><td class="r num">${Math.round(x.pf)}</td><td class="r num">${Math.round(x.pa)}</td></tr>`).join("")}
        </tbody></table></div></article>
    </section>
    <section class="card"><div class="cardhead"><h2>Week ${nw} outlook</h2><span class="sub">games per current starter next week</span></div>
      ${nextGames.length ? `<div class="volgrid">${nextVol.sort((a,b)=>b.n-a.n).map(x=>`<div class="volcell ${x.n<=2?"low":x.n>=4?"high":""}"><b>${x.n}</b><span>${esc(x.p.name)}</span><small>${esc(x.p.team||"")}</small></div>`).join("")}</div>` : `<div class="empty">Next week's schedule isn't posted yet.</div>`}</section>`;
  C.line($("chPts"), { labels: wkLabels, aria:"Weekly points", series:[
    {name:"You", color:ACC, values: myPts}, {name:"Opponent", color:MODEL, dash:"dot", values: oppPts}, {name:"League avg", color:REF, dash:"dash", values: lgAvg} ] });
  C.line($("chVol"), { labels: wkLabels, aria:"Starter games per week", fmt: v=>v==null?"–":String(Math.round(v)), series:[ {name:"You", color:ACC, values: myVol}, {name:"League avg", color:REF, dash:"dash", values: lgVol} ] });
  C.hbars($("chTop"), { items: top.map(([pid,v])=>({ label: nameOf(pid), sub: P.S.info?.[pid]?.team || "", value: v, color: ACC })) });
}

/* ================================================================= Players */
async function gameLog(pid){
  if(cache.logs[pid]) return cache.logs[pid];
  const fp = scoreFn();
  const d = await P.getJSON(`${API2}/stats/nba/player/${pid}?season_type=regular&season=${P.S.seasonYear}&grouping=week`);
  const games = [];
  for(const [w, arr] of Object.entries(d||{})) for(const e of arr||[]){ if(!e?.date) continue; const st = e.stats||{}; const played = Object.keys(st).length>0 && ((st.min||0)>0 || (st.sp||0)>0);
    games.push({ w:Number(w), date:e.date, opp:e.opponent, fp: played ? fp(st) : 0, played, min: st.min || (st.sp ? st.sp/60 : 0), fga: st.fga||0, fgm: st.fgm||0 }); }
  games.sort((a,b)=>a.date.localeCompare(b.date));
  return cache.logs[pid] = games;
}
async function projLog(pid){
  if(cache.proj[pid]) return cache.proj[pid];
  const fp = scoreFn();
  const d = await P.getJSON(`${API2}/projections/nba/player/${pid}?season_type=regular&season=${P.S.seasonYear}&grouping=week`);
  const m = {}; for(const arr of Object.values(d||{})) for(const e of arr||[]) if(e?.date) m[e.date] = fp(e.stats);
  return cache.proj[pid] = m;
}
async function research(w){
  if(cache.research[w]) return cache.research[w];
  try{ cache.research[w] = await P.getJSON(`https://api.sleeper.app/players/nba/research/regular/${P.S.seasonYear}/${w}`); }catch(e){ cache.research[w] = {}; }
  return cache.research[w];
}
async function news(pid){
  if(cache.news[pid]) return cache.news[pid];
  try{ cache.news[pid] = (await P.getJSON(`${API2}/players/nba/${pid}/news`)) || []; }catch(e){ cache.news[pid] = []; }
  return cache.news[pid];
}
function summarize(g){
  const pl = g.filter(x=>x.played), last5 = pl.slice(-5);
  const avg = mean(pl.map(x=>x.fp)), l5 = mean(last5.map(x=>x.fp));
  const sd = pl.length>2 ? Math.sqrt(pl.reduce((a,x)=>a+(x.fp-avg)**2,0)/(pl.length-1)) : null;
  return { gp: pl.length, avg, l5, trend: avg && l5!=null ? l5/avg-1 : null, cv: avg ? sd/avg : null, floor: quant(pl.map(x=>x.fp),0.1), ceil: quant(pl.map(x=>x.fp),0.9),
           min: mean(pl.map(x=>x.min)), min5: mean(last5.map(x=>x.min)) };
}
const ago = ms => { const h = (Date.now()-ms)/36e5; return h<1 ? "just now" : h<24 ? `${Math.round(h)}h ago` : `${Math.round(h/24)}d ago`; };
function newsHTML(items, n=3){
  if(!items?.length) return `<div class="note">No recent news from Sleeper.</div>`;
  return `<ul class="news">${items.slice(0,n).map(x=>{ const m = x.metadata||{}; const sum = (m.analysis || m.description || "").trim(); const short = sum.length > 220 ? sum.slice(0, sum.lastIndexOf(" ", 220)) + "…" : sum;
    return `<li><b>${esc(m.title || "Update")}</b><span>${esc(short)}</span><small>${esc((x.source||"").replace(/_/g," "))} · ${ago(x.published)}${m.url?` · <a href="${esc(m.url)}" target="_blank" rel="noopener">Read more</a>`:""}</small></li>`; }).join("")}</ul>`;
}
async function renderPlayers(){
  const el = $("view-players"), S = P.S;
  const rid = cache.playersTeam ?? myRid();
  const roster = S.rosters.find(r=>r.roster_id===rid);
  const pids = roster?.players || [];
  loading(el, "Loading game logs…");
  const [logs, res] = await Promise.all([pool(pids, 6, gameLog), research(S.maxWeek)]);
  const rows = pids.map((pid,i)=>({ pid, info: S.info?.[pid] || {name:nameOf(pid)}, s: summarize(logs[i]||[]), log: logs[i]||[], own: res?.[pid]?.owned }))
    .sort((a,b)=>(b.s.avg||0)-(a.s.avg||0));
  const sel = rows.find(r=>r.pid===cache.selPlayer) || rows[0];
  cache.selPlayer = sel?.pid;
  const starters = new Set((S.data?.teamModel?.(rid)?.starters||[]).map(p=>p.pid));
  el.innerHTML = `
    <div class="tabhead"><div><h2>Players</h2><p>Season and recent form for every player on a roster. Pick a player for his game log, consistency, minutes and news.</p></div>
      <select class="sel narrow" id="plTeam" aria-label="Team">${S.rosters.slice().sort((a,b)=>a.roster_id-b.roster_id).map(r=>`<option value="${r.roster_id}" ${r.roster_id===rid?"selected":""}>${esc(P.teamLabel(r.roster_id).name)}</option>`).join("")}</select></div>
    <section class="card"><div class="tvwrap"><table class="ptable"><thead><tr><th>Player</th><th class="r">Avg</th><th class="r">Last 5</th><th class="r">Trend</th><th class="r">Consistency</th><th class="r">Min L5</th><th class="r">GP</th><th class="r">Owned</th><th>Status</th></tr></thead><tbody>
      ${rows.map(r=>`<tr class="${r.pid===sel?.pid?"sel":""}" data-pid="${r.pid}" tabindex="0"><td><div class="n">${esc(r.info.name)}${starters.has(r.pid)?' <span class="chip-s">starter</span>':""}</div><div class="s">${esc(r.info.pos||"")} · ${esc(r.info.team||"FA")}</div></td>
        <td class="r num">${f1(r.s.avg)}</td><td class="r num">${f1(r.s.l5)}</td><td class="r num ${r.s.trend>0.08?"up":r.s.trend<-0.08?"down":""}">${r.s.trend==null?"–":`${r.s.trend>0?"▲":"▼"} ${Math.abs(Math.round(r.s.trend*100))}%`}</td>
        <td class="r num" title="Game-to-game swing as a share of his average. Lower is steadier.">${r.s.cv==null?"–":`±${Math.round(r.s.cv*100)}%`}</td><td class="r num">${f1(r.s.min5)}</td><td class="r num">${r.s.gp}</td><td class="r num">${r.own!=null?`${Math.round(r.own)}%`:"–"}</td>
        <td>${r.info.inj?`<span class="flag ${["Out","IR","Sus"].includes(r.info.inj)?"f-warn":"f-caution"}">${esc(r.info.inj)}</span>`:""}</td></tr>`).join("")}
    </tbody></table></div></section>
    <section class="card" id="plDetail"></section>`;
  $("plTeam").addEventListener("change", e=>{ cache.playersTeam = Number(e.target.value); cache.selPlayer = null; renderPlayers(); });
  el.querySelector(".ptable tbody").addEventListener("click", e=>{ const tr = e.target.closest("tr[data-pid]"); if(!tr) return; cache.selPlayer = tr.dataset.pid; el.querySelectorAll(".ptable tr").forEach(x=>x.classList.toggle("sel", x===tr)); renderDetail(rows.find(r=>r.pid===tr.dataset.pid)); $("plDetail").scrollIntoView({behavior:"smooth", block:"start"}); });
  el.querySelector(".ptable tbody").addEventListener("keydown", e=>{ if(e.key==="Enter") e.target.closest("tr[data-pid]")?.click(); });
  if(sel) renderDetail(sel);
}
async function renderDetail(r){
  const box = $("plDetail"); if(!r){ box.innerHTML = ""; return; }
  box.innerHTML = `<div class="cardhead"><h2>${esc(r.info.name)}</h2><span class="sub">${esc(r.info.pos||"")} · ${esc(r.info.team||"FA")}${r.own!=null?` · ${Math.round(r.own)}% owned`:""}</span></div><div class="muted">Loading game log…</div>`;
  const [proj, nws] = await Promise.all([projLog(r.pid).catch(()=>({})), news(r.pid)]);
  const g = r.log.slice(-20);
  const mine = String(myRid());
  const hist = Object.values(cache.raw).flatMap(w => (w.teams[mine]?.st||[]).filter(s=>s.pid===r.pid).map(s=>({w:w.w, a: analyze(s, P.etToday()), s}))).filter(x=>x.a).sort((a,b)=>a.w-b.w);
  box.innerHTML = `<div class="cardhead"><h2>${esc(r.info.name)}</h2><span class="sub">${esc(r.info.pos||"")} · ${esc(r.info.team||"FA")}${r.own!=null?` · ${Math.round(r.own)}% owned in Sleeper`:""}</span></div>
    <div class="kpis inner">
      <div class="kpi"><small>Season avg</small><b>${f1(r.s.avg)}</b><span>${r.s.gp} games</span></div>
      <div class="kpi"><small>Last 5</small><b>${f1(r.s.l5)}</b><span>${r.s.trend==null?"":`${r.s.trend>0?"up":"down"} ${Math.abs(Math.round(r.s.trend*100))}% vs season`}</span></div>
      <div class="kpi"><small>Floor / ceiling</small><b>${f1(r.s.floor)} / ${f1(r.s.ceil)}</b><span>his 10th / 90th percentile game</span></div>
      <div class="kpi"><small>Minutes</small><b>${f1(r.s.min5)}</b><span>last 5 · season ${f1(r.s.min)}</span></div>
    </div>
    <div class="grid2 inner"><div><h3 class="mini-h">Game log: points vs projection</h3><div id="chLog"></div></div>
      <div><h3 class="mini-h">Latest news</h3>${newsHTML(nws)}
      ${hist.length ? `<h3 class="mini-h" style="margin-top:14px">Lock history on your team</h3><div class="tvwrap"><table class="mini-t"><thead><tr><th>Week</th><th class="r">Kept</th><th class="r">Best game</th><th>Call</th></tr></thead><tbody>${hist.map(h=>`<tr><td>Wk ${h.w}</td><td class="r num">${f2(h.a.real)}</td><td class="r num">${f2(h.a.oracle)}</td><td>${h.a.win?`<span class="flag f-good">CourtVision win +${f1(h.a.win.gain)}</span>`:h.a.aligned?'<span class="flag f-info">Matched CourtVision</span>':h.a.miss?`<span class="flag f-caution">−${f1(h.a.miss.lost)} vs CourtVision</span>`:'<span class="flag f-info">Differed</span>'}</td></tr>`).join("")}</tbody></table></div>`:""}</div></div>`;
  C.line($("chLog"), { labels: g.map(x=>`${x.date.slice(5).replace("-","/")}`), xName:"Game", aria:"Game log", series:[
    {name:"Scored", color:ACC, values: g.map(x=>x.played?x.fp:0)},
    {name:"Projected", color:MODEL, dash:"dot", values: g.map(x=>proj[x.date] ?? null)},
    {name:"Season avg", color:REF, dash:"dash", marker:false, values: g.map(()=>r.s.avg)} ],
    note: i => `${g[i].played ? `${f1(g[i].min)} min` : "Did not play"}${g[i].opp?` · vs ${g[i].opp}`:""}` });
}

/* ================================================================= Trade Lab (beta) */
async function renderTrades(){
  const el = $("view-trades"), S = P.S, mine = myRid();
  loading(el, "Scanning the league for buy and sell signals…");
  const fp = scoreFn();
  const prevW = S.maxWeek - 1;
  const [prevStats, resNow, resPrev, trending] = await Promise.all([
    prevW >= 1 ? (cache.prevStats[prevW] || P.getJSON(`${API2}/stats/nba/${S.seasonYear}/${prevW}?season_type=regular`)) : Promise.resolve([]),
    research(S.maxWeek), prevW >= 1 ? research(prevW) : Promise.resolve({}),
    cache.trending || P.getJSON(`${API}/players/nba/trending/add?lookback_hours=48&limit=40`).catch(()=>[])
  ]);
  cache.prevStats[prevW] = prevStats; cache.trending = trending;
  const trendRank = Object.fromEntries((trending||[]).map((t,i)=>[t.player_id, {rank:i+1, count:t.count}]));
  // recent games from last two weekly files
  const recent = {};
  for(const e of [...(prevStats||[]), ...(S.raw?.stats||[])]){ if(!e.date || e.date >= P.etToday()) continue; const st = e.stats||{}; const played = Object.keys(st).length>0 && ((st.min||0)>0 || (st.sp||0)>0);
    (recent[e.player_id] ||= []).push({ date:e.date, fp: played?fp(st):0, played, min: st.min || (st.sp?st.sp/60:0), fga: st.fga||0, fgm: st.fgm||0, team:e.team }); }
  // starts in recent games from the schedule's lineups
  const starts = {}, teamGames = {};
  for(const g of S.schedule){ if(g.status!=="complete" || Number(g.week) < prevW || Number(g.week) > S.maxWeek) continue;
    for(const side of [g.home, g.away]){ if(!side) continue; teamGames[side.team] = (teamGames[side.team]||0)+1; for(const pid of side.starters||[]) starts[pid] = (starts[pid]||0)+1; } }
  const seasonBy = Object.fromEntries(S.season.map(e=>[e.player_id, e]));
  const rosterOf = {}; for(const r of S.rosters) for(const pid of r.players||[]) rosterOf[pid] = r.roster_id;
  const cands = [];
  for(const e of S.season){
    const pid = e.player_id, st = e.stats||{}, gp = st.gp||0; if(gp < 3) continue;
    const savg = fp(st)/gp, owner = rosterOf[pid] ?? null;
    if(owner==null && savg < 16) continue;
    if(owner!=null && savg < 12) continue;
    const rg = (recent[pid]||[]).sort((a,b)=>a.date.localeCompare(b.date)).slice(-8), rp = rg.filter(x=>x.played);
    if(rp.length < 2) continue;
    const ravg = mean(rp.map(x=>x.fp)), smin = (st.min || (st.sp? st.sp/60 : 0))/gp, rmin = mean(rp.map(x=>x.min));
    const sfg = st.fga ? st.fgm/st.fga : null, rfga = rp.reduce((a,x)=>a+x.fga,0), rfg = rfga ? rp.reduce((a,x)=>a+x.fgm,0)/rfga : null;
    const info = P.S.info?.[pid] || {}; const team = info.team || e.team;
    const sStartRate = st.gs!=null ? st.gs/gp : null, rStartRate = teamGames[team] ? (starts[pid]||0)/teamGames[team] : null;
    const x = { pid, name: info.name || nameOf(pid), team, pos: info.pos, inj: info.inj, owner, savg, ravg, form: ravg/savg-1, smin, rmin, minD: rmin-smin,
      fgD: sfg!=null && rfg!=null ? (rfg-sfg)*100 : 0, startD: sStartRate!=null && rStartRate!=null ? rStartRate-sStartRate : 0, rStarts: starts[pid]||0, rTeamGames: teamGames[team]||0,
      own: resNow?.[pid]?.owned, ownD: resNow?.[pid]?.owned!=null && resPrev?.[pid]?.owned!=null ? resNow[pid].owned - resPrev[pid].owned : null, trend: trendRank[pid], spark: rg.map(z=>z.played?z.fp:0), sigs: [] };
    const injured = ["Out","IR","Sus"].includes(x.inj);
    if(owner === mine){
      if(x.form >= 0.15 && (x.fgD >= 5 || x.minD < 2)) x.sigs.push({ k:"sell", s: x.form*100 + Math.max(0,x.fgD), t:"Sell high", why:`Up ${Math.round(x.form*100)}% over his last ${rp.length} games${x.fgD>=5?`, shooting ${Math.round(x.fgD)} pts above his norm`:""}, without a real jump in minutes (${f1(x.rmin)} vs ${f1(x.smin)}). His value may not get higher.` });
      if(x.minD <= -4 || x.startD <= -0.4) x.sigs.push({ k:"sell", s: -x.minD*4 + (x.startD<0?-x.startD*40:0), t:"Role shrinking", why:`Minutes down to ${f1(x.rmin)} from ${f1(x.smin)}${x.startD<=-0.4?`, and he started ${x.rStarts} of the last ${x.rTeamGames}`:""}. Check the depth chart before he loses more value.` });
    } else {
      if(x.form <= -0.15 && x.minD >= -3 && !injured) x.sigs.push({ k: owner==null ? "add" : "buy", s: -x.form*100 + Math.max(0,-x.fgD), t:"Buy low", why:`Down ${Math.round(-x.form*100)}% over his last ${rp.length} games, but his minutes held (${f1(x.rmin)} vs ${f1(x.smin)})${x.fgD<=-5?` and he's shooting ${Math.round(-x.fgD)} pts below his norm`:""}. Slumps like this usually bounce back.` });
      if((x.minD >= 4 || x.startD >= 0.4) && x.savg >= 14) x.sigs.push({ k: owner==null ? "add" : "buy", s: x.minD*4 + Math.max(0,x.startD)*40, t:"Rising role", why:`Minutes up to ${f1(x.rmin)} from ${f1(x.smin)}${x.startD>=0.4?`, and he started ${x.rStarts} of the last ${x.rTeamGames}`:""}. Something changed on his team; see the depth chart.` });
      if(injured && x.savg >= 30 && owner!=null) x.sigs.push({ k:"buy", s: x.savg, t:"Injury discount", why:`${x.inj} right now. A ${f1(x.savg)}-point player can sometimes be bought cheaply while he's out; check the news for a timeline first.` });
      if(owner==null && x.form >= 0.2 && !x.sigs.length) x.sigs.push({ k:"add", s: x.form*100, t:"Hot free agent", why:`Averaging ${f1(x.ravg)} over his last ${rp.length} games, ${Math.round(x.form*100)}% above his season mark.` });
    }
    if(x.trend && x.sigs.length) x.sigs.forEach(s=>{ s.s += Math.max(0, 20 - x.trend.rank); });
    if(x.sigs.length) cands.push(x);
  }
  const top = k => cands.filter(x=>x.sigs.some(s=>s.k===k)).map(x=>({x, s: x.sigs.filter(s=>s.k===k).sort((a,b)=>b.s-a.s)[0]})).sort((a,b)=>b.s.s-a.s.s).slice(0,8);
  const buy = top("buy"), sell = top("sell"), add = top("add");
  const ownerName = rid => rid==null ? "Free agent" : P.teamLabel(rid).name;
  const card = ({x,s}) => `<article class="tcard" data-pid="${x.pid}">
      <div class="tc-top"><div><div class="n">${esc(x.name)}</div><div class="s">${esc(x.pos||"")} · ${esc(x.team||"")} · ${esc(ownerName(x.owner))}</div></div><span class="sig sig-${s.k}">${esc(s.t)}</span></div>
      <div class="tc-mid">${C.spark(x.spark, {ref:x.savg})}<div class="tc-n"><span><b>${f1(x.ravg)}</b><small>recent</small></span><span><b>${f1(x.savg)}</b><small>season</small></span><span><b>${x.own!=null?Math.round(x.own)+"%":"–"}</b><small>owned${x.ownD!=null&&Math.abs(x.ownD)>=1?` ${x.ownD>0?"▲":"▼"}${Math.abs(Math.round(x.ownD))}`:""}</small></span></div></div>
      <p>${esc(s.why)}</p>
      <div class="flags">${x.inj?`<span class="flag ${["Out","IR","Sus"].includes(x.inj)?"f-warn":"f-caution"}">${esc(x.inj)}</span>`:""}${x.trend?`<span class="flag f-info">#${x.trend.rank} most-added in Sleeper (48h)</span>`:""}${x.sigs.length>1?x.sigs.filter(z=>z!==s).map(z=>`<span class="flag f-info">${esc(z.t)}</span>`).join(""):""}</div>
      <button class="linkbtn tc-more" aria-expanded="false">News &amp; depth chart</button><div class="tc-x" hidden></div></article>`;
  const sec = (title, sub, list, empty) => `<section class="card"><div class="cardhead"><h2>${title}</h2><span class="sub">${sub}</span></div>${list.length?`<div class="tcards">${list.map(card).join("")}</div>`:`<div class="empty">${empty}</div>`}</section>`;
  el.innerHTML = `
    <div class="tabhead"><div><h2>Trade Lab <span class="beta">Beta</span></h2><p>Buy and sell signals from recent form, minutes, shooting luck, starting role, Sleeper ownership trends and news. Each card opens the player's news and his NBA team's depth chart.</p></div></div>
    <div class="betabar"><b>Beta feature.</b> These signals are new and haven't been backtested like the lock model. Treat them as leads to research, not answers.</div>
    ${sec("Buy targets", "on other rosters: slumping without losing minutes, or gaining a bigger role", buy, "No strong buy signals right now.")}
    ${sec("Sell candidates", `on ${esc(P.teamLabel(mine).name)}: hot streaks driven by luck, or shrinking roles`, sell, "Nothing on your roster is flashing sell right now.")}
    ${sec("Waiver risers", "free agents whose role or production is jumping", add, "No free agents stand out right now.")}`;
  el.querySelectorAll(".tc-more").forEach(btn => btn.addEventListener("click", async () => {
    const card = btn.closest(".tcard"), box = card.querySelector(".tc-x"), pid = card.dataset.pid;
    const open = box.hidden; box.hidden = !open; btn.setAttribute("aria-expanded", open); btn.textContent = open ? "Hide news & depth chart" : "News & depth chart";
    if(!open || box.dataset.loaded) return;
    box.innerHTML = `<div class="note">Loading…</div>`;
    const x = cands.find(c=>c.pid===pid); const nws = await news(pid);
    const mates = S.season.filter(e=>(P.S.info?.[e.player_id]?.team || e.team)===x.team && (e.stats?.gp||0)>0).map(e=>{
      const st = e.stats, gp = st.gp, rg = (recent[e.player_id]||[]).filter(z=>z.played);
      return { pid:e.player_id, name: P.S.info?.[e.player_id]?.name || nameOf(e.player_id), inj: P.S.info?.[e.player_id]?.inj, min:(st.min || (st.sp?st.sp/60:0))/gp, rmin: rg.length?mean(rg.map(z=>z.min)):null, gs: st.gs ?? null, gp, rs: starts[e.player_id]||0, avg: fp(st)/gp };
    }).sort((a,b)=>(b.rmin ?? b.min)-(a.rmin ?? a.min)).slice(0,12);
    const outMates = mates.filter(m=>["Out","IR","Sus"].includes(m.inj) && m.pid!==pid);
    box.innerHTML = `<h4>News</h4>${newsHTML(nws, 2)}
      <h4>${esc(x.team)} depth chart <small>by recent minutes</small></h4>
      ${outMates.length?`<p class="note">Out: ${outMates.map(m=>esc(m.name)).join(", ")}. Their minutes have to go somewhere.</p>`:""}
      <div class="tvwrap"><table class="mini-t"><thead><tr><th>Player</th><th class="r">Min recent</th><th class="r">Min season</th><th class="r">Starts recent</th><th class="r">Fpts/g</th></tr></thead><tbody>
      ${mates.map(m=>`<tr class="${m.pid===pid?"mine":""}"><td>${esc(m.name)}${m.inj?` <span class="flag ${["Out","IR","Sus"].includes(m.inj)?"f-warn":"f-caution"}">${esc(m.inj)}</span>`:""}</td><td class="r num">${f1(m.rmin)}</td><td class="r num">${f1(m.min)}</td><td class="r num">${m.rs}/${x.rTeamGames}</td><td class="r num">${f1(m.avg)}</td></tr>`).join("")}</tbody></table></div>`;
    box.dataset.loaded = "1";
  }));
}

/* ================================================================= router */
const VIEWS = { performance: renderPerformance, team: renderTeam, players: renderPlayers, trades: renderTrades };
let busy = {};
async function render(name, opts={}){
  const fn = VIEWS[name]; if(!fn || !P.S.data) return;
  if(busy[name]) return; if(opts.refresh && name==="players" && cache.selPlayer) return;
  busy[name] = true;
  try{ await fn(); }catch(e){ console.error(e); $(`view-${name}`).innerHTML = `<div class="errbox">Couldn't build this tab (${esc(e.message)}). Tap refresh to try again.</div>`; }
  finally{ busy[name] = false; }
}
P.tabs = { render, reset };
if(P.S.data && P.current !== "console") render(P.current);
})();
