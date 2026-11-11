/* ProjectIverson — slot engine (v4): lock decisions per lineup slot, drawing on bench and free agents,
   plus live hold/swap calls. Backtested on the league's 2025 season (tools/backtest_slots.py). */
(() => {
"use strict";
const P = window.PI, M = window.PI_MODEL;
const { $, esc, f1, f2 } = P;
const ELIG = { PG:["PG"], SG:["SG"], G:["PG","SG"], SF:["SF"], PF:["PF"], F:["SF","PF"], C:["C"] };
const SPEC = { C:0, PG:0, SG:0, SF:0, PF:0, G:1, F:1, UTIL:2 };
const ESPN2SLP = { WSH:"WAS", GS:"GSW", NO:"NOP", NY:"NYK", SA:"SAS", UTAH:"UTA", PHO:"PHX" };
const posSet = pl => new Set(String(pl.pos||"").split("/").filter(Boolean));
const eligible = (pl, slot) => slot==="UTIL" || (ELIG[slot]||[]).some(x=>posSet(pl).has(x));
const drawValue = (mu, Mn, p) => p*Mn + (1-p)*P.eMax(mu, Mn);
function eMaxSd(mu, sd, c){ sd = Math.max(1, sd); const z = (c-mu)/sd, ph = Math.exp(-0.5*z*z)/Math.sqrt(2*Math.PI);
  const t = 1/(1+0.3275911*Math.abs(z)/Math.SQRT2), y = 1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-(z*z)/2), Ph = z>=0?0.5*(1+y):0.5*(1-y);
  return c*Ph + mu*(1-Ph) + sd*ph; }

// pills + styles for the new calls
P.PILL.sub = ["p-sub","Sub in"]; P.PILL.swap = ["p-swap","Swap"]; P.PILL.hold = ["p-roll","Hold"];
const st = document.createElement("style");
st.textContent = `.p-sub{background:var(--accent);color:var(--accent-ink)} .p-swap{background:var(--caution);color:#2b2200}
.moves{display:flex;flex-direction:column;gap:8px}
.move{display:grid;grid-template-columns:64px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 12px;border-radius:var(--r-md);background:rgba(255,255,255,.04);border:1px solid var(--edge-soft)}
.move.urgent{border-color:color-mix(in srgb,var(--accent-text) 55%,transparent);background:color-mix(in srgb,var(--accent) 12%,rgba(255,255,255,.03))}
.move .when{font:600 12px var(--mono);color:var(--ink-2)}
.move b{font-weight:600} .move .d{display:block;color:var(--ink-2);font-size:12.5px;margin-top:2px}
.slotchip{font:600 10.5px var(--mono);padding:1px 6px;border-radius:6px;background:rgba(255,255,255,.08);color:var(--ink-2);margin-right:6px}
.fa{font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;background:color-mix(in srgb,var(--roll) 20%,transparent);color:var(--roll);margin-left:6px}
.livebox{margin-top:6px;font-size:12px;color:var(--ink-2)} .livebox b{color:var(--ink)}
@media (max-width:760px){ .move{grid-template-columns:minmax(0,1fr) auto} .move .when{grid-column:1 / -1} }`;
document.head.appendChild(st);

/* ---------------- live game data (ESPN scoreboard: tip times, quarter, clock, margin) ---------------- */
async function fetchLive(){
  const d = P.etToday();
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d.replace(/-/g,"")}`, {cache:"no-store"});
  if(!r.ok) return;
  const j = await r.json(), teams = {};
  for(const e of j.events||[]){
    const c = e.competitions?.[0]; if(!c) continue; const s = e.status||{};
    const side = (c.competitors||[]).map(x=>({ ab: ESPN2SLP[x.team?.abbreviation] || x.team?.abbreviation, score: Number(x.score||0) }));
    for(const t of side){ const o = side.find(x=>x!==t);
      teams[t.ab] = { tip: new Date(e.date), state: s.type?.state, period: s.period||0, clock: s.displayClock||"", margin: o ? t.score-o.score : 0, detail: s.type?.shortDetail||"" }; }
  }
  P.S.espn = { date: d, teams, at: Date.now() };
}
const liveFor = (team, date) => (P.S.espn && P.S.espn.date === date) ? P.S.espn.teams[team] : null;
const tipLabel = (team, date) => { const t = liveFor(team, date); return t ? t.tip.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"}) : null; };
const tipMs = (team, date) => liveFor(team, date)?.tip?.getTime() ?? null;

/* ---------------- free-agent pool ---------------- */
function freeAgents(D){
  const budget = P.cfg.faAdds ?? 2; if(budget <= 0 || !D.projBy) return [];
  const rostered = new Set(P.S.rosters.flatMap(r=>r.players||[]));
  const best = [];
  for(const [pid, byDate] of Object.entries(D.projBy)){
    if(rostered.has(pid)) continue;
    const inj = P.S.info?.[pid]?.inj; if(["Out","IR","Sus"].includes(inj)) continue;
    const mx = Math.max(0, ...Object.entries(byDate).filter(([d])=>d>=D.today).map(([,v])=>v.fp||0));
    if(mx >= 15) best.push([pid, mx]);
  }
  return best.sort((a,b)=>b[1]-a[1]).slice(0,20).map(([pid])=>Object.assign(D.playerModel(pid,false,"FA",0), {isFA:true}));
}

/* ---------------- the slot engine ---------------- */
function liveProjection(pl){
  const g = pl.live; if(!g) return null;
  const S = P.S, base = S.season?.find?.(e=>e.player_id===pl.pid)?.stats || {};
  const gp = base.gp || 0, avgMin = (gp ? (base.min || (base.sp ? base.sp/60 : 0))/gp : 0) || 30;
  const rate = gp && avgMin ? (pl.avg||0)/avgMin : 0.9;
  const raw = (S.raw?.stats||[]).find(e=>e.player_id===pl.pid && e.date===g.date)?.stats || {};
  const minSoFar = raw.min || (raw.sp ? raw.sp/60 : 0), pf = raw.pf || 0;
  const L = liveFor(pl.team, g.date);
  let remFrac = null;
  if(L && L.state === "in"){ const [mm, ss] = String(L.clock).split(":").map(Number); const clk = (mm||0) + (ss||0)/60;
    remFrac = L.period <= 4 ? Math.max(0, ((4-L.period)*12 + clk)/48) : Math.max(0, clk/48); }
  let remMin = remFrac != null ? avgMin*remFrac : Math.max(0, avgMin - minSoFar);
  const notes = [];
  if(L && L.period >= 3 && Math.abs(L.margin) >= 20){ remMin *= L.period >= 4 ? 0.45 : 0.6; notes.push(`blowout (${L.margin>0?"+":""}${L.margin})`); }
  if(pf >= 5){ remMin *= 0.5; notes.push(`${pf} fouls`); } else if(pf >= 4 && (!L || L.period <= 3)){ remMin *= 0.75; notes.push(`${pf} fouls`); }
  const mu = (g.actual||0) + rate*remMin;
  return { mu, sd: Math.max(2.5, 0.4*rate*remMin), soFar: g.actual||0, minSoFar, remMin, notes, clock: L ? L.detail : null };
}

function planTeam(D, team, fa){
  if(!team) return null;
  const nights = D.days.filter(d=>d>=D.today);
  const slots = team.starters.map((p,k)=>({ k, pos: D.slotsAll[k] || "UTIL", occ: p, s: p.games.some(g=>g.st==="done") ? p.points : null, locked: p.lock==="locked", live: p.live || null }));
  // a starter stays with his own slot; bench players and free agents are shared by every open slot
  const occupied = new Set(slots.map(s=>s.occ.pid));
  const pool = [...team.starters, ...team.bench, ...fa];
  const now = Date.now();
  const gameOn = (pl,d) => { const g = pl.games.find(g=>g.date===d && g.st==="pre"); if(!g) return null;
    if(d===D.today){ const t = tipMs(pl.team, d); if(t!=null && t<=now) return null; } return g; };  // can't enter a slot after tip-off
  const open = slots.filter(s=>!s.locked);
  const plan = {}; let faLeft = P.cfg.faAdds ?? 2;
  for(const d of nights){
    const taken = new Set();
    const key = s => s.live ? 1e3 : (s.s ?? -1);
    for(const sl of [...open].sort((a,b)=> key(a)-key(b) || SPEC[a.pos]-SPEC[b.pos])){
      if(sl.live && d===D.today) continue;   // tonight is his live game (see hold/swap below)
      let best = null;
      for(const pl of pool){
        const g = gameOn(pl, d); if(!g || taken.has(pl.pid) || !eligible(pl, sl.pos)) continue;
        if(occupied.has(pl.pid) && pl.pid !== sl.occ.pid) continue;
        if(pl.isFA && faLeft <= 0) continue;
        const mu = g.proj ?? 0, p = g.p ?? M.scratch;
        if(!best || mu*(1-p) > best.mu*(1-best.p)) best = { pl, g, mu, p, d };
      }
      if(best){ (plan[sl.k] ||= {})[d] = best; taken.add(best.pl.pid); if(best.pl.isFA) faLeft--; }
    }
  }
  let ev = 0;
  for(const sl of slots){
    if(sl.locked){ sl.verdict = "locked"; sl.ev = sl.s ?? 0; ev += sl.ev; continue; }
    const pk = plan[sl.k] || {}; sl.plan = pk;
    const after = {}, D_ = {}; let Mn = 0;
    for(let i=nights.length-1;i>=0;i--){ const d = nights[i]; after[d] = Mn; const x = pk[d]; if(x){ D_[d] = drawValue(x.mu, Mn, x.p); Mn = Math.max(Mn, D_[d]); } }
    sl.after = after; sl.D = D_; sl.M = Mn;
    const occ = sl.occ, today = D.today;
    const occNext = occ.games.find(g=>g.st==="pre");
    const tonight = pk[today];
    if(sl.live){
      const lp = liveProjection(occ); sl.lp = lp;
      const Mafter = after[today] ?? 0;
      const hold = lp ? eMaxSd(lp.mu, lp.sd, Mafter) : Mafter;
      const startedOrDone = new Set(slots.filter(x=>x!==sl).map(x=>x.occ.pid));
      const plannedTonight = new Set(Object.entries(plan).filter(([k])=>Number(k)!==sl.k).map(([,v])=>v[today]?.pl.pid).filter(Boolean));
      let rep = null;
      for(const pl of pool){
        const g = gameOn(pl, today); if(!g || !eligible(pl, sl.pos) || pl.pid===occ.pid) continue;
        if(occupied.has(pl.pid) || startedOrDone.has(pl.pid) || plannedTonight.has(pl.pid) || (pl.isFA && faLeft <= 0)) continue;
        const tm = tipMs(pl.team, today); if(tm != null && tm <= Date.now()) continue;
        if(!rep || g.proj > rep.mu) rep = { pl, g, mu: g.proj ?? 0, p: g.p ?? M.scratch };
      }
      const swap = rep ? drawValue(rep.mu, Mafter, rep.p) : -1;
      sl.rep = rep; sl.holdEV = hold; sl.swapEV = swap; sl.lockAfter = Mafter;
      sl.verdict = rep && lp && lp.mu < Mafter && swap > hold + 0.25 ? "swap" : "live";   // swap only if he projects below the hold threshold and a later tip is better
      sl.ev = Math.max(hold, swap);
    } else if(sl.s == null){
      sl.verdict = tonight ? (tonight.pl.pid===occ.pid ? "wait" : "sub") : "wait";
      sl.ev = Mn; sl.next = Object.values(pk).sort((a,b)=>a.d.localeCompare(b.d))[0] || null;
      sl.lockAfter = sl.next ? after[sl.next.d] : null;
    } else {
      const s = sl.s;
      // holding a banked score is free until its player plays again; then lock it or draw
      const limit = occNext ? occNext.date : null;
      const allowed = nights.filter(d=>pk[d] && (!limit || d <= limit));
      const thr = allowed.length ? Math.max(...allowed.map(d=>D_[d])) : 0;
      sl.thr = thr;
      if(!allowed.length || s >= thr){ sl.verdict = allowed.length || occNext ? "lock" : "final"; sl.ev = s; sl.lockBy = occNext ? occNext.date : null; }
      else {
        const drawD = allowed.reduce((a,d)=> D_[d] > D_[a] ? d : a, allowed[0]);
        sl.next = pk[drawD]; sl.lockAfter = after[drawD];
        sl.verdict = drawD===today && pk[drawD].pl.pid!==occ.pid ? "sub" : "roll";
        sl.ev = Math.max(s, thr);
      }
    }
    ev += sl.ev;
  }
  return { slots, plan, ev, nights, fa };
}

function prepare(D){
  D.fa = freeAgents(D);
  D.plan = planTeam(D, D.mine, D.fa); D.mine.ev = D.plan.ev;
  if(D.opp){ D.oppPlan = planTeam(D, D.opp, D.fa); D.opp.ev = D.oppPlan.ev; }
  // map slot calls onto starters so tiles and banners stay consistent
  for(const sl of D.plan.slots){ const p = sl.occ; p.slot = sl.pos; p.slotCall = sl;
    if(["lock","roll","sub","swap","live","wait","final","locked"].includes(sl.verdict)) p.verdict = sl.verdict==="sub"||sl.verdict==="swap" ? "roll" : sl.verdict; }
  // planned use of every player (for the grid)
  D.uses = {};
  for(const sl of D.plan.slots) for(const [d,x] of Object.entries(sl.plan||{})) (D.uses[x.pl.pid] ||= {})[d] = { slot: sl.pos, k: sl.k, lockIf: sl.after?.[d] };
}

/* ---------------- copy ---------------- */
const who = x => `${esc(x.pl.name)}${x.pl.isFA?'<span class="fa">FA · add</span>':""}`;
const tipTxt = (pl, d) => { const t = tipLabel(pl.team, d); return t ? `tips ${t}` : P.dayName(d); };
function slotWhy(sl){
  const o = sl.occ, nm = esc(o.name);
  switch(sl.verdict){
    case "locked": return `Locked ${P.dayName(o.lockedOn)} at ${f2(sl.s)}.`;
    case "final": return `${f2(sl.s)} banked and no one eligible plays later this week. It stands.`;
    case "lock": return `Lock ${nm} ${sl.lockBy?`before his next tip-off (${P.dayName(sl.lockBy)})`:"now"}: ${f2(sl.s)} beats the ${f1(sl.thr)} this slot can expect from its remaining options${sl.lockBy?" before he'd overwrite it":""}.`;
    case "roll": if(sl.next && sl.next.pl.pid===o.pid) return `Let it ride: ${f2(sl.s)} banked, but his next game (${P.dayName(sl.next.d)}, proj ${f1(sl.next.mu)}) makes the slot worth about ${f1(sl.thr)}. Lock that one if it's ${Math.ceil(sl.lockAfter)}+.`;
      return sl.next ? `Keep the slot open: ${f2(sl.s)} banked, but putting ${who(sl.next)} in on ${P.dayName(sl.next.d)} (proj ${f1(sl.next.mu)}) makes the slot worth about ${f1(sl.thr)}. Keep ${nm} in until then, and lock the new score if it's ${Math.ceil(sl.lockAfter)}+.` : "";
    case "sub": return `Tonight, start ${who(sl.next)} here (proj ${f1(sl.next.mu)}, ${tipTxt(sl.next.pl, sl.next.d)}). That gives up ${sl.s!=null?`${nm}'s ${f2(sl.s)}`:"an empty slot"}; the slot is worth about ${f1(sl.ev)} this way. Lock his score if it's ${Math.ceil(sl.lockAfter)}+.`;
    case "wait": return sl.next ? `${sl.next.pl.pid===o.pid?`${nm} plays ${P.dayName(sl.next.d)}`:`Plan: ${who(sl.next)} on ${P.dayName(sl.next.d)}`} (proj ${f1(sl.next.mu)}). Lock him right after if he scores ${Math.ceil(sl.lockAfter)}+.` : "No eligible player has a game left this week.";
    case "live": { const lp = sl.lp; return lp ? `Live: ${f1(lp.soFar)} so far, on pace for about ${f1(lp.mu)}${lp.notes.length?` (${lp.notes.join(", ")})`:""}. Hold him${sl.rep?`; swapping to ${who(sl.rep)} is worth less (${f1(sl.swapEV)} vs ${f1(sl.holdEV)})`:""}. When it's final, lock if he has ${Math.ceil(sl.lockAfter)}+.` : "In progress."; }
    case "swap": { const lp = sl.lp; return `Swap now: ${nm} is on pace for only ${f1(lp?.mu)}${lp?.notes.length?` (${lp.notes.join(", ")})`:""}. Pull him and start ${who(sl.rep)} (proj ${f1(sl.rep.mu)}, ${tipTxt(sl.rep.pl, P.etToday())}). His points so far are thrown out.`; }
  }
  return "";
}
function tonightMoves(D){
  const moves = [], today = D.today;
  for(const sl of D.plan.slots){
    const o = sl.occ, tag = `<span class="slotchip">${esc(sl.pos)}</span>`;
    if(sl.verdict==="swap") moves.push({ t: 0, urgent: true, when: "Now", html: `${tag}<b>Swap ${esc(o.name)} → ${who(sl.rep)}</b><span class="d">${slotWhy(sl)}</span>` });
    else if(sl.verdict==="lock" && sl.lockBy===today) moves.push({ t: tipMs(o.team,today) ?? 1, urgent: true, when: tipLabel(o.team,today) || "Today", html: `${tag}<b>Lock ${esc(o.name)} before tip-off</b><span class="d">${slotWhy(sl)}</span>` });
    else if(sl.verdict==="lock") moves.push({ t: 2, urgent: false, when: sl.lockBy ? `By ${P.dayName(sl.lockBy)}` : "Anytime", html: `${tag}<b>Lock ${esc(o.name)}</b><span class="d">${slotWhy(sl)}</span>` });
    else if(sl.verdict==="sub") moves.push({ t: tipMs(sl.next.pl.team,today) ?? 3, urgent: true, when: tipLabel(sl.next.pl.team,today) || "Tonight", html: `${tag}<b>Start ${who(sl.next)}${sl.s!=null?` over ${esc(o.name)}`:""}</b><span class="d">${slotWhy(sl)}</span>` });
    else if((sl.verdict==="wait"||sl.verdict==="roll") && sl.plan?.[today]?.pl.pid===o.pid && (sl.s==null || sl.D[today] > sl.s)) moves.push({ t: tipMs(o.team,today) ?? 4, urgent: false, when: tipLabel(o.team,today) || "Tonight", html: `${tag}<b>Let ${esc(o.name)} play</b><span class="d">Proj ${f1(sl.plan[today].mu)}. Lock him after the game if he scores ${Math.ceil(sl.after[today])}+.${sl.s!=null?` This replaces his ${f2(sl.s)} banked${sl.D[today]-sl.s<2?`; close call, locking ${f2(sl.s)} now is nearly as good`:""}.`:""}</span>` });
    else if(sl.verdict==="live") moves.push({ t: 5, urgent: false, when: "Live", html: `${tag}<b>Hold ${esc(o.name)}</b><span class="d">${slotWhy(sl)}</span>` });
  }
  return moves.sort((a,b)=>a.t-b.t);
}

/* ---------------- rendering ---------------- */
function ring(sl){
  const R = 14, C = 2*Math.PI*R, color = {lock:"var(--lock)", roll:"var(--roll)", sub:"var(--accent-text)", swap:"var(--caution)", live:"var(--warn)"}[sl.verdict] || "var(--ink-3)";
  const frac = sl.verdict==="lock" ? 1 : sl.s!=null && sl.ev ? Math.min(1, sl.s/sl.ev) : 0;
  return `<svg class="ring" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="${R}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="3"/><circle cx="17" cy="17" r="${R}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${frac*C} ${C}"/></svg>`;
}
function renderAct(D){
  const today = D.today;
  if(P.S.focusDay) return renderDay(D, P.S.focusDay);
  $("actTitle").textContent = "Tonight's moves";
  const moves = tonightMoves(D);
  const slots = D.plan.slots.filter(s=>!["locked","final"].includes(s.verdict));
  const order = { swap:0, sub:1, lock:2, live:3, roll:4, wait:5 };
  slots.sort((a,b)=> (order[a.verdict]??9)-(order[b.verdict]??9) || (b.s??0)-(a.s??0));
  $("actSub").textContent = `${moves.filter(m=>m.urgent).length} to do before tip-off · slot plan uses your bench${(P.cfg.faAdds??2)>0?` and up to ${P.cfg.faAdds??2} free-agent adds`:""}`;
  $("alist").innerHTML = (moves.length ? `<div class="moves">${moves.map(m=>`<div class="move ${m.urgent?"urgent":""}"><span class="when">${esc(m.when)}</span><div>${m.html}</div></div>`).join("")}</div>` : `<div class="empty">No moves needed tonight.</div>`)
    + `<h3 class="mini-h" style="margin:16px 0 4px">Every open slot</h3>`
    + (slots.length ? slots.map(sl=>{ const o = sl.occ;
      return `<div class="arow">${ring(sl)}
        <div class="who"><div class="n"><span class="slotchip">${esc(sl.pos)}</span>${esc(o.name)}</div><div class="m">${esc(o.team||"FA")}${o.inj?` · ${esc(o.inj)}`:""}</div><div class="why">${slotWhy(sl)}</div>${sl.lp?`<div class="livebox">Projected final <b>${f1(sl.lp.mu)}</b> · ${f1(sl.lp.minSoFar)} min played${sl.lp.clock?` · ${esc(sl.lp.clock)}`:""}</div>`:""}</div>
        <div class="nbs"><div class="nb"><b>${sl.s!=null?f2(sl.s):"–"}</b><small>banked</small></div><div class="nb"><b>${f1(sl.ev)}</b><small>slot worth</small></div><div class="nb"><b>${sl.next?f1(sl.next.mu):"–"}</b><small>next draw</small></div></div>${P.pill(sl.verdict)}</div>`; }).join("") : `<div class="empty">Every slot is locked or final.</div>`);
}
function renderDay(D, d){
  $("actTitle").textContent = `${P.dayLong(d)}, ${P.shortDate(d)}`;
  const rows = D.plan.slots.map(sl=>{
    const o = sl.occ, x = sl.plan?.[d], g = o.games.find(z=>z.date===d);
    if(sl.verdict==="locked" || (o.lock==="locked" && o.lockedOn < d)) return { sl, tone:"locked", head:`Locked (${f2(sl.s ?? o.points)})`, body:`Nothing to do in this slot.` };
    if(g && g.st==="done") return { sl, tone: g.counts?"counts":"past", head:`${esc(o.name)} scored ${f2(g.actual)}${g.counts?" · counting":""}`, body: g.counts ? slotWhy(sl) : "Replaced by a later game." };
    if(x) return { sl, tone:"plan", head:`${who(x)} · proj ${f1(x.mu)}${tipLabel(x.pl.team,d)?` · ${tipLabel(x.pl.team,d)}`:""}`, body: sl.after?.[d] > 0 ? `Planned for this slot. Lock him after the game if he scores ${Math.ceil(sl.after[d])}+; below that, keep the slot open.` : `Planned for this slot. It's the slot's last chance this week, so his score stands.` };
    return { sl, tone:"past", head:`No game planned`, body: sl.s!=null ? `Keep ${esc(o.name)}'s ${f2(sl.s)} (he doesn't play).` : "No eligible player plays." };
  });
  $("actSub").textContent = `Slot-by-slot plan for ${P.dayLong(d)}`;
  $("alist").innerHTML = rows.map(r=>`<div class="arow dp tone-${r.tone}"><span class="dpic"></span><div class="who"><div class="n"><span class="slotchip">${esc(r.sl.pos)}</span>${esc(r.sl.occ.name)}</div></div><div class="dpb"><b>${r.head}</b><span class="d">${r.body}</span></div>${d===D.today?P.pill(r.sl.verdict):""}</div>`).join("");
}
function cell(p, g, D){
  const val = g.st==="pre" ? f1(g.proj) : f2(g.actual);
  const use = D.uses?.[p.pid]?.[g.date];
  let tag = "", title = "";
  if(g.lockedHere){ tag = "locked ✓"; title = `Scored ${val} and locked.`; }
  else if(g.counts && p.isStarter){ tag = g.st==="live" ? "live" : "counting"; title = `Scored ${val}; this is the slot's score right now.`; }
  else if(g.st==="live"){ tag = "live"; }
  else if(g.st==="done"){ tag = p.isStarter ? "replaced" : "bench"; title = p.isStarter ? "A later game counts instead." : "Didn't count (on the bench)."; }
  else if(use){ tag = use.lockIf > 0 ? `${use.slot} · lock if ${Math.ceil(use.lockIf)}+` : `${use.slot} · counts`; title = `Planned for the ${use.slot} slot. ${use.lockIf>0?`If he scores ${Math.ceil(use.lockIf)}+, lock him right after.`:"Last chance for that slot this week."}`; }
  else if(g.outAdj){ tag = "likely out"; }
  else { tag = "not used"; title = "Not in the current slot plan (another player is a better use of that night)."; }
  const cls = ["g", g.st==="pre"?"proj":"done", g.st==="live"?"live":"", g.counts&&p.isStarter?"counts":"", g.lockedHere?"lockedg":"", (tag==="replaced"||tag==="bench"||tag==="not used")?"faded":""].join(" ");
  return `<div class="${cls}" title="${esc(title)}"><span class="o">${g.home?"vs":"@"} ${esc(g.opp||"")}</span><span class="v">${val}</span><span class="tag">${tag}</span></div>`;
}
function renderGrid(D){
  const t = D.mine, cols = D.days.length + 6, fd = P.S.focusDay;
  $("grid").querySelector("thead").innerHTML = `<tr><th>Slot</th><th>Player</th><th class="r">Avg</th>${D.days.map(d=>`<th class="dayh ${d===D.today?"today":""} ${fd===d?"focus":""}">${P.dayName(d)} ${P.dayNum(d)}</th>`).join("")}<th class="r">Banked</th><th>Call</th><th>Flags</th></tr>`;
  const row = (p, sl) => {
    const cells = D.days.map(d=>{ const g = p.games.find(x=>x.date===d); const td = `td class="day ${d===D.today?"today":""} ${fd===d?"focus":""} ${fd && fd!==d?"dim":""}"`; return g ? `<${td}>${cell(p,g,D)}</td>` : `<${td}><span class="nog">·</span></td>`; }).join("");
    const mark = (p.isStarter && p.lock==="rolling" && p.latest?.st==="done") ? `<button class="mini" data-mark="${p.pid}" data-date="${p.latest.date}">I locked this</button>` : (p.marked && p.lock==="locked" && p.lockedOn===p.marked) ? `<button class="mini" data-unmark="${p.pid}">Undo mark</button>` : "";
    const uses = Object.entries(D.uses?.[p.pid]||{}).filter(([d])=>!sl || d>=D.today);
    const sub = sl ? (sl.verdict==="roll" && sl.next ? `slot worth ${f1(sl.ev)} open` : sl.verdict==="lock" ? `beats ${f1(sl.thr)} left` : sl.verdict==="sub" ? `start ${sl.next.pl.name.split(" ").slice(-1)[0]} tonight` : sl.verdict==="swap" ? `swap to ${sl.rep.pl.name.split(" ").slice(-1)[0]}` : "")
              : uses.length ? `planned: ${uses.map(([d,u])=>`${P.dayName(d)} ${u.slot}`).join(", ")}` : "";
    return `<tr class="${p.isStarter?"":"bench"}"><td class="slot">${esc(sl?sl.pos:"BN")}</td>
      <td class="player"><div class="n">${esc(p.name)}</div><div class="s">${esc(p.pos)} · ${esc(p.team||"FA")}</div>${mark}</td>
      <td class="r num">${f1(p.avg)}</td>${cells}
      <td class="r num">${sl && sl.s!=null ? f2(sl.s) : "–"}</td><td>${sl?P.pill(sl.verdict):(uses.length?'<span class="pill p-wait">Planned</span>':'<span class="nog">bench</span>')}${sub?`<div class="callsub">${esc(sub)}</div>`:""}</td>
      <td>${P.flagHTML((p.flags||[]).filter(f=>f[1]!=="FINAL GAME"))}</td></tr>`;
  };
  let starters = D.plan.slots, bench = t.bench, hidden = 0;
  if(fd && !P.S.showAllRows){ const keep = p => p.games.some(g=>g.date===fd); hidden = starters.filter(s=>!keep(s.occ)).length + bench.filter(p=>!keep(p)).length; starters = starters.filter(s=>keep(s.occ)); bench = bench.filter(keep); }
  $("grid").querySelector("tbody").innerHTML =
    `<tr class="sep"><td colspan="${cols}">Lineup slots · ${f1(t.points)} banked · ${f1(D.plan.ev)} projected with subs</td></tr>` + starters.map(sl=>row(sl.occ, sl)).join("") +
    (bench.length ? `<tr class="sep"><td colspan="${cols}">Bench · available to sub into an open slot before his tip-off</td></tr>` + bench.map(p=>row(p,null)).join("") : "") +
    (hidden ? `<tr><td colspan="${cols}"><button class="linkbtn" data-showall>Show ${hidden} player${hidden>1?"s":""} not playing ${P.dayLong(fd)}</button></td></tr>` : "");
}

window.PI_CONSOLE = { ready: true, fetchLive, prepare, renderAct, renderGrid, planTeam };
})();
