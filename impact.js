/* ProjectIverson — Player impact (beta): does a player's availability move a fantasy team's weekly score?
   This season: his games played each week next to the team's points vs the league average.
   Last season: his weekly Lock-In score vs the team's margin, with and without his own points. */
(() => {
"use strict";
const P = window.PI, C = window.PI_CHART;
const { $, esc, f1 } = P;
const API = P.API, API2 = P.API2;
const NS = "http://www.w3.org/2000/svg";
const mem = { m:{}, ps:{}, prev:null };
const sgn = x => x==null || isNaN(x) ? "–" : (x>0?"+":x<0?"−":"") + f1(Math.abs(x));
const r2 = x => x==null || isNaN(x) ? "–" : (x<0?"−":"") + Math.abs(x).toFixed(2);
const mean = a => a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
const get = k => { try{ return JSON.parse(P.store.get(k) || "null"); }catch(e){ return null; } };
const put = (k,v) => { try{ P.store.set(k, JSON.stringify(v)); }catch(e){} };
const nameOf = pid => P.S.info?.[pid]?.name || `Player ${pid}`;
const svgEl = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for(const k in attrs) e.setAttribute(k, attrs[k]); if(parent) parent.appendChild(e); return e; };

const st = document.createElement("style");
st.textContent = `.imp-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px}
@media (max-width:640px){ .imp-controls{grid-template-columns:minmax(0,1fr)} }
.imp-controls label{display:grid;gap:4px;font-size:11.5px;color:var(--ink-3)}
.imp-verdict{border-left:3px solid var(--accent-text);padding:6px 12px;margin:4px 0 14px;display:grid;gap:6px}
.imp-verdict p{margin:0;line-height:1.5;color:var(--ink);max-width:76ch}
.imp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}
@media (max-width:900px){ .imp-grid{grid-template-columns:minmax(0,1fr)} }
.imp-grid h3{font-size:13px;font-weight:600;margin:0 0 4px}
.imp-chart{position:relative;width:100%;min-height:200px}
.imp-chart svg{display:block;width:100%;overflow:visible}
.imp-chart text{font-size:11px;fill:var(--ink-3);font-variant-numeric:tabular-nums}
.imp-stats{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
.imp-stat{border:1px solid var(--edge-soft);border-radius:10px;padding:6px 10px;font-size:11.5px;color:var(--ink-3)}
.imp-stat b{display:block;font:600 16px var(--mono);color:var(--ink)}
.imp-stat.on{border-color:var(--accent-text)}
.imp-toggle{display:inline-flex;gap:6px;margin:6px 0}`;
document.head.appendChild(st);

/* ---------------- data ---------------- */
async function weekMatchups(lid, w, final){
  const key = `pi:imp:m:${lid}:${w}`;
  if(mem.m[key]) return mem.m[key];
  if(final){ const c = get(key); if(c){ mem.m[key] = c; return c; } }
  const raw = await P.getJSON(`${API}/league/${lid}/matchups/${w}`) || [];
  const out = raw.map(m => ({ rid: m.roster_id, pts: m.points ?? null, st: (m.starters||[]).filter(x=>x && x!=="0"), pl: m.players||[], pp: m.players_points||{} }));
  mem.m[key] = out; if(final && out.length) put(key, out);
  return out;
}
async function seasonWeeks(lid, n, liveWeek){
  const ws = Array.from({length:n}, (_,i)=>i+1), out = [];
  let i = 0;
  await Promise.all([0,1,2].map(async () => { while(i < ws.length){ const w = ws[i++]; try{ out[w-1] = { w, m: await weekMatchups(lid, w, w !== liveWeek) }; }catch(e){ out[w-1] = { w, m: [] }; } } }));
  return out.filter(x => x && x.m.length && x.m.some(t => (t.pts||0) > 0));
}
async function playerWeeks(pid, season, final){
  const key = `pi:imp:ps:${season}:${pid}`;
  if(mem.ps[key]) return mem.ps[key];
  if(final){ const c = get(key); if(c){ mem.ps[key] = c; return c; } }
  const raw = await P.getJSON(`${API2}/stats/nba/player/${pid}?season_type=regular&season=${season}&grouping=week`) || {};
  const out = {};
  for(const [w, games] of Object.entries(raw)){ if(!Array.isArray(games)) continue;
    out[w] = { games: games.length, played: games.filter(g => { const s = g.stats||{}; return (s.min||0)>0 || (s.sp||0)>0 || (s.gp||0)>0; }).length }; }
  mem.ps[key] = out; if(final) put(key, out);
  return out;
}
async function prevLeague(){
  const id = P.S.league?.previous_league_id; if(!id || id === "0") return null;
  if(mem.prev && mem.prev.id === id) return mem.prev;
  const key = `pi:imp:prev:${id}`;
  let c = get(key);
  if(!c){
    const [lg, ro, us] = await Promise.all([P.getJSON(`${API}/league/${id}`), P.getJSON(`${API}/league/${id}/rosters`), P.getJSON(`${API}/league/${id}/users`)]);
    if(!lg) return null;
    const names = Object.fromEntries((us||[]).map(u => [u.user_id, (u.metadata?.team_name || u.display_name || "").trim()]));
    c = { id, season: lg.season, rosters: (ro||[]).map(r => ({ rid: r.roster_id, owner: r.owner_id, name: names[r.owner_id] || `Team ${r.roster_id}`, players: r.players||[] })) };
    put(key, c);
  }
  mem.prev = c; return c;
}

/* ---------------- stats ---------------- */
function corr(x, y){
  const n = x.length; if(n < 5) return null;
  const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0;
  for(let i=0;i<n;i++){ a += (x[i]-mx)*(y[i]-my); b += (x[i]-mx)**2; c += (y[i]-my)**2; }
  if(!b || !c) return null;
  const r = a/Math.sqrt(b*c), z = Math.atanh(Math.max(-0.999999, Math.min(0.999999, r))), se = 1/Math.sqrt(n-3);
  return { r, lo: Math.tanh(z-1.96*se), hi: Math.tanh(z+1.96*se), n };
}

/* ---------------- charts ---------------- */
function size(host){ return Math.max(280, host.clientWidth || 560); }
function weeklyChart(host, rows, teamName){
  host.innerHTML = "";
  if(!rows.length){ host.innerHTML = `<div class="note">No completed weeks yet.</div>`; return; }
  const W = size(host), H = 250, strip = 46, top = strip + 14, bot = H - 22;
  const lim = Math.max(10, ...rows.map(r => Math.abs(r.margin))) * 1.12;
  const y = v => top + (lim - v) / (2*lim) * (bot - top);
  const ml = 40, mr = 6, step = (W - ml - mr) / rows.length, bw = Math.min(46, step*0.55);
  const svg = svgEl("svg", { viewBox:`0 0 ${W} ${H}`, height:H, role:"img", "aria-label":`${teamName} points versus league average each week, with the player's games played` }, host);
  for(const t of [-lim*0.8, -lim*0.4, 0, lim*0.4, lim*0.8].map(v => Math.round(v/10)*10)){
    svgEl("line", { x1:ml, x2:W-mr, y1:y(t), y2:y(t), stroke: t===0 ? "rgba(243,245,248,.35)" : "rgba(243,245,248,.08)" }, svg);
    const tx = svgEl("text", { x:ml-6, y:y(t)+4, "text-anchor":"end" }, svg); tx.textContent = sgn(t).replace("+0.0","0").replace(".0","");
  }
  rows.forEach((r, i) => {
    const cx = ml + step*i + step/2;
    const gap = 12, x0 = cx - (r.games-1)*gap/2;
    for(let k=0; k<r.games; k++){
      const on = k < r.played;
      svgEl("circle", { cx: x0 + k*gap, cy: 14, r: 4.5, fill: on ? "var(--ink)" : "transparent", stroke: on ? "var(--ink)" : "var(--ink-3)", "stroke-width": 1.6 }, svg);
    }
    const lab = svgEl("text", { x: cx, y: 36, "text-anchor":"middle" }, svg); lab.textContent = `Wk ${r.w}${r.live ? "*" : ""}${r.onRoster ? "" : " · off"}`;
    const yv = y(r.margin), y0 = y(0);
    svgEl("rect", { x: cx - bw/2, y: Math.min(yv, y0), width: bw, height: Math.max(1, Math.abs(yv - y0)), rx: 4,
      fill: r.margin >= 0 ? "var(--accent-text)" : "rgba(243,245,248,.42)", opacity: r.live ? 0.5 : 1 }, svg);
    const hit = svgEl("rect", { x: ml + step*i, y: 0, width: step, height: H, fill: "transparent" }, svg);
    const show = e => C.showTip(`<b>Week ${r.w}${r.live ? " (in progress)" : ""}</b><div>He played<span>${r.played} of ${r.games}</span></div><div>${esc(teamName)} vs avg<span>${sgn(r.margin)}</span></div><div>On their roster<span>${r.onRoster ? (r.inLineup ? "yes, starting" : "yes, bench") : "no"}</span></div>`, e.clientX, e.clientY);
    hit.addEventListener("pointermove", show); hit.addEventListener("pointerdown", show); hit.addEventListener("pointerleave", C.hideTip);
  });
}
function scatter(host, pts, mode){
  host.innerHTML = "";
  const W = size(host), H = 250, ml = 40, mr = 10, mt = 8, mb = 30;
  const ys = pts.flatMap(p => [p.y, p.y2]), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), xmax = Math.max(10, ...pts.map(p=>p.x)) * 1.08;
  const pad = (hi - lo) * 0.08 || 5;
  const X = v => ml + v/xmax * (W - ml - mr), Y = v => mt + (hi + pad - v) / (hi - lo + 2*pad) * (H - mt - mb);
  const svg = svgEl("svg", { viewBox:`0 0 ${W} ${H}`, height:H, role:"img", "aria-label":"Player's weekly score against the team's margin over the league average, last season" }, host);
  const yt = [lo, (lo+hi)/2, hi].map(v => Math.round(v/10)*10);
  for(const t of [...new Set([...yt, 0])]){ svgEl("line", { x1:ml, x2:W-mr, y1:Y(t), y2:Y(t), stroke: t===0 ? "rgba(243,245,248,.35)" : "rgba(243,245,248,.08)" }, svg);
    const tx = svgEl("text", { x:ml-6, y:Y(t)+4, "text-anchor":"end" }, svg); tx.textContent = sgn(t).replace(".0",""); }
  for(let t=0; t<=xmax; t+= xmax > 40 ? 10 : 5){ const tx = svgEl("text", { x:X(t), y:H-12, "text-anchor":"middle" }, svg); tx.textContent = String(t); }
  const xl = svgEl("text", { x: W-mr, y: H, "text-anchor":"end" }, svg); xl.textContent = "his weekly score";
  const key = mode === "with" ? "y" : "y2";
  const xs = pts.map(p=>p.x), yv = pts.map(p=>p[key]), mx = mean(xs), my = mean(yv);
  const sxx = xs.reduce((a,x)=>a+(x-mx)**2,0);
  if(sxx > 0){ const b = xs.reduce((a,x,i)=>a+(x-mx)*(yv[i]-my),0)/sxx, x0 = Math.min(...xs), x1 = Math.max(...xs);
    svgEl("line", { x1:X(x0), x2:X(x1), y1:Y(my + b*(x0-mx)), y2:Y(my + b*(x1-mx)), stroke:"rgba(243,245,248,.5)", "stroke-width":2, "stroke-dasharray":"5 4" }, svg); }
  for(const p of pts){
    svgEl("circle", { cx:X(p.x), cy:Y(p[key]), r:5, fill: p.inLineup ? "var(--accent-text)" : "transparent", stroke:"var(--accent-text)", "stroke-width":1.8 }, svg);
    const hit = svgEl("circle", { cx:X(p.x), cy:Y(p[key]), r:13, fill:"transparent" }, svg);
    const show = e => C.showTip(`<b>Week ${p.w}</b><div>His score<span>${f1(p.x)}${p.inLineup ? "" : " (bench)"}</span></div><div>${mode === "with" ? "Team vs avg" : "Without his points"}<span>${sgn(p[key])}</span></div>`, e.clientX, e.clientY);
    hit.addEventListener("pointermove", show); hit.addEventListener("pointerdown", show); hit.addEventListener("pointerleave", C.hideTip);
  }
}

function watch(el, fn){ let w = el.clientWidth; const ro = new ResizeObserver(() => { if(!el.isConnected){ ro.disconnect(); return; } if(Math.abs(el.clientWidth - w) > 4){ w = el.clientWidth; fn(); } }); ro.observe(el); }

/* ---------------- card ---------------- */
let state = { rid: null, pid: null, mode: "with" };
function playerOptions(rid, prevRoster){
  const S = P.S, cur = S.rosters.find(r => r.roster_id === rid)?.players || [];
  const prev = (prevRoster?.players || []).filter(p => !cur.includes(p));
  const hurt = S.rosters.flatMap(r => r.players||[]).filter(p => !cur.includes(p) && !prev.includes(p) && ["Out","IR","Sus","Doubtful","Questionable"].includes(S.info?.[p]?.inj));
  const opt = p => `<option value="${esc(p)}">${esc(nameOf(p))}${S.info?.[p]?.inj ? ` · ${esc(S.info[p].inj)}` : ""}</option>`;
  const by = a => [...a].sort((x,y) => nameOf(x).localeCompare(nameOf(y)));
  return `${cur.length ? `<optgroup label="On this team now">${by(cur).map(opt).join("")}</optgroup>` : ""}${prev.length ? `<optgroup label="On this team last season">${by(prev).map(opt).join("")}</optgroup>` : ""}${hurt.length ? `<optgroup label="Injured, on other teams">${by(hurt).map(opt).join("")}</optgroup>` : ""}`;
}
function defaultPid(rid){
  const S = P.S, cur = S.rosters.find(r => r.roster_id === rid)?.players || [];
  return cur.find(p => ["Out","IR"].includes(S.info?.[p]?.inj)) || cur.find(p => S.info?.[p]?.inj) || cur[0] || null;
}

async function mount(host){
  if(!host) return;
  const S = P.S;
  const saved = get(`pi:imp:sel:${P.cfg.leagueId}`) || {};
  state.rid = S.rosters.some(r => r.roster_id === saved.rid) ? saved.rid : P.cfg.rosterId;
  state.pid = saved.pid || defaultPid(state.rid);
  host.innerHTML = `<div class="cardhead"><h2>Player impact <span class="beta">Beta</span></h2><span class="sub">Does a player's availability move a team's weekly score?</span></div>
    <div class="imp-controls">
      <label>Fantasy team<select class="sel" id="impTeam">${S.rosters.slice().sort((a,b)=>a.roster_id-b.roster_id).map(r=>`<option value="${r.roster_id}">${esc(P.teamLabel(r.roster_id).name)}</option>`).join("")}</select></label>
      <label>Player<select class="sel" id="impPlayer"></select></label>
    </div>
    <div id="impBody"><div class="note">Loading…</div></div>`;
  const teamSel = host.querySelector("#impTeam"), plSel = host.querySelector("#impPlayer");
  teamSel.value = String(state.rid);
  let prev = null; try{ prev = await prevLeague(); }catch(e){}
  const prevRosterFor = rid => { if(!prev) return null; const own = S.rosters.find(r => r.roster_id === rid)?.owner_id; return prev.rosters.find(r => own && r.owner === own) || prev.rosters.find(r => r.rid === rid) || null; };
  const fillPlayers = () => { plSel.innerHTML = playerOptions(state.rid, prevRosterFor(state.rid)); if(![...plSel.options].some(o => o.value === state.pid)) state.pid = defaultPid(state.rid) || plSel.options[0]?.value || null; plSel.value = state.pid || ""; };
  fillPlayers();
  const go = () => { put(`pi:imp:sel:${P.cfg.leagueId}`, { rid: state.rid, pid: state.pid }); P.track?.("act", "impact"); draw(host, prevRosterFor(state.rid), prev); };
  teamSel.addEventListener("change", () => { state.rid = Number(teamSel.value); fillPlayers(); go(); });
  plSel.addEventListener("change", () => { state.pid = plSel.value; go(); });
  await draw(host, prevRosterFor(state.rid), prev);
}

async function draw(host, prevRoster, prev){
  const body = host.querySelector("#impBody"), S = P.S, pid = state.pid, rid = state.rid;
  if(!pid){ body.innerHTML = `<div class="note">Pick a player.</div>`; return; }
  body.innerHTML = `<div class="note">Loading ${esc(nameOf(pid))}'s weeks…</div>`;
  const team = P.teamLabel(rid).name, name = nameOf(pid);
  try{
    const [weeks, ps] = await Promise.all([ seasonWeeks(P.cfg.leagueId, S.maxWeek, S.maxWeek), playerWeeks(pid, S.seasonYear, false) ]);
    if(state.pid !== pid || state.rid !== rid) return;
    const rows = weeks.map(({ w, m }) => {
      const t = m.find(x => x.rid === rid), avg = mean(m.map(x => x.pts || 0)), g = ps[w] || { games: 0, played: 0 };
      return { w, live: w === S.maxWeek, games: g.games, played: g.played, margin: (t?.pts || 0) - avg, onRoster: !!t?.pl.includes(pid), inLineup: !!t?.st.includes(pid) };
    });
    const fin = rows.filter(r => !r.live);
    const onAny = rows.some(r => r.onRoster);
    const played = rows.reduce((a,r)=>a+r.played,0), games = rows.reduce((a,r)=>a+r.games,0);
    const withW = fin.filter(r => r.onRoster && r.played > 0), withoutW = fin.filter(r => r.onRoster && r.played === 0 && r.games > 0);
    let now;
    if(!onAny) now = `<b>${esc(name)} isn't on ${esc(team)}'s roster this season</b>, so his games can't change their score. He has played ${played} of ${games} games so far.`;
    else if(withW.length && withoutW.length) now = `This season ${esc(team)} averaged <b>${sgn(mean(withW.map(r=>r.margin)))}</b> against the league in weeks he played (${withW.length}) and <b>${sgn(mean(withoutW.map(r=>r.margin)))}</b> in weeks he missed (${withoutW.length}).${Math.min(withW.length, withoutW.length) < 3 ? " That's too few weeks to tell anything apart." : ""}`;
    else now = `He has played ${played} of ${games} games for ${esc(team)} this season${withoutW.length ? "" : ", with no full week missed"}, so there's nothing to compare yet.`;

    let last = "", pts = [];
    if(prev && prevRoster){
      const n = 25;
      const [pw, pps] = await Promise.all([ seasonWeeks(prev.id, n, -1), playerWeeks(pid, prev.season, true) ]);
      if(state.pid !== pid || state.rid !== rid) return;
      pts = pw.map(({ w, m }) => { const t = m.find(x => x.rid === prevRoster.rid); if(!t || !t.pl.includes(pid)) return null;
        const avg = mean(m.map(x => x.pts || 0)), x = Number(t.pp[pid] ?? 0), inl = t.st.includes(pid);
        return { w, x, inLineup: inl, y: t.pts - avg, y2: t.pts - (inl ? x : 0) - avg, g: pps[w] || { games:0, played:0 } }; }).filter(Boolean);
      if(pts.length >= 5){
        const a = corr(pts.map(p=>p.x), pts.map(p=>p.y)), b = corr(pts.map(p=>p.x), pts.map(p=>p.y2));
        const gp = pts.reduce((s,p)=>s+p.g.played,0), gg = pts.reduce((s,p)=>s+p.g.games,0);
        const sig = c => c && (c.lo > 0 || c.hi < 0);
        last = `In ${esc(prev.season)} he was on ${esc(prevRoster.name)} for ${pts.length} weeks and played ${gp} of ${gg} games. His weekly score tracked their margin at r = <b>${r2(a?.r)}</b> (95% range ${r2(a?.lo)} to ${r2(a?.hi)}); with his own points taken out, r = <b>${r2(b?.r)}</b> (${r2(b?.lo)} to ${r2(b?.hi)}). ${sig(b) ? "That remaining link is stronger than chance." : "That range includes zero, so beyond his own points there's no evidence of a link."}`;
      } else last = prevRoster ? `${esc(name)} wasn't on this team for at least 5 weeks last season, so there's no history to test.` : "";
    }
    body.innerHTML = `<div class="imp-verdict"><p>${now}</p>${last ? `<p>${last}</p>` : ""}</div>
      <div class="imp-grid">
        <div><h3>This season</h3><p class="note">Dots: his NBA team's games each week, filled if he played. Bars: ${esc(team)}'s points above or below the league average. * = in progress; "off" = he wasn't on their roster that week.</p><div class="imp-chart" id="impWeekly"></div></div>
        <div><h3>Last season${prev ? ` (${esc(prev.season)})` : ""}</h3>${pts.length >= 5 ? `<p class="note">Each dot is a week he was on ${esc(prevRoster.name)}. Filled = in their lineup.</p>
          <div class="imp-toggle" role="group" aria-label="Team score"><button type="button" class="tbtn ${state.mode==="with"?"sel":""}" data-impmode="with" aria-pressed="${state.mode==="with"}">Full team score</button><button type="button" class="tbtn ${state.mode==="without"?"sel":""}" data-impmode="without" aria-pressed="${state.mode==="without"}">Without his points</button></div>
          <div class="imp-chart" id="impScatter"></div>` : `<p class="note">${prev ? "Not enough weeks together last season to chart." : "No previous season found for this league."}</p>`}</div>
      </div>`;
    const wk = body.querySelector("#impWeekly"); const fw = () => weeklyChart(wk, rows, team); fw(); watch(wk, fw);
    const sc = body.querySelector("#impScatter");
    if(sc){ const f = () => scatter(sc, pts, state.mode); f(); watch(sc, f);
      body.querySelectorAll("[data-impmode]").forEach(b => b.addEventListener("click", () => { state.mode = b.dataset.impmode; body.querySelectorAll("[data-impmode]").forEach(o => { const on = o === b; o.classList.toggle("sel", on); o.setAttribute("aria-pressed", on); }); f(); })); }
  }catch(e){ console.error(e); body.innerHTML = `<div class="note">Couldn't load this from Sleeper (${esc(e.message)}). Try again in a minute.</div>`; }
}

window.PI_IMPACT = { mount };
})();
