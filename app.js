/* ProjectIverson — live Lock-In console for Sleeper fantasy basketball. */
(() => {
"use strict";

// ---------------------------------------------------------------- config
const DEFAULTS = { leagueId: "1411462896273084416", rosterId: 3 };          // Kash Patel's Legacy · Missouri Mighty Marfans
const DEFAULT_LABEL = { league: "Kash Patel's Legacy", team: "Missouri Mighty Marfans" };
const NEUTRAL = ["#F4B23E", "#2B3A55", "#C4CED4"];
const API = "https://api.sleeper.app/v1", API2 = "https://api.sleeper.com";
const REFRESH_MS = 120000, CV = 0.30, MIN_SD = 4;
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const TEAMS = window.PI_TEAMS || [];
const teamBy = abbr => TEAMS.find(t => t.abbr === abbr) || null;

const $ = id => document.getElementById(id);
const store = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  set(k,v){ try{ v===null ? localStorage.removeItem(k) : localStorage.setItem(k,v); }catch(e){} }
};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const f1 = x => (x==null || isNaN(x)) ? "–" : (Math.round(x*10)/10).toFixed(1);
const f2 = x => (x==null || isNaN(x)) ? "–" : String(Math.round(x*100)/100);

let cfg = Object.assign({ leagueId: DEFAULTS.leagueId, rosterId: DEFAULTS.rosterId, team: null, scheme: 0, onboarded: false, toured: false },
  (() => { try { return JSON.parse(store.get("pi:cfg") || "{}"); } catch(e){ return {}; } })());
// shareable links: ?league=<id>&team=<rosterId>
(() => {
  const q = new URLSearchParams(location.search);
  if (q.get("league") && /^\d+$/.test(q.get("league"))) { cfg.leagueId = q.get("league"); cfg.rosterId = Number(q.get("team")) || 1; }
})();
const saveCfg = () => store.set("pi:cfg", JSON.stringify(cfg));

// ---------------------------------------------------------------- color
const hex2rgb = h => { const n = parseInt(h.slice(1),16); return [(n>>16)&255,(n>>8)&255,n&255]; };
const rgb2hex = a => "#" + a.map(v => Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,"0")).join("");
const mix = (a,b,t) => { const x=hex2rgb(a), y=hex2rgb(b); return rgb2hex(x.map((v,i)=>v+(y[i]-v)*t)); };
const lum = h => { const c = hex2rgb(h).map(v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }); return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; };
const contrast = (a,b) => { const l1=lum(a), l2=lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); };
function readable(h, bg="#1b212b"){ for(let t=0;t<=1.0001;t+=0.06){ const c = mix(h,"#ffffff",t); if(contrast(c,bg)>=4.5) return c; } return "#ffffff"; }
function visibleFill(h){ return lum(h) < 0.035 ? mix(h,"#ffffff",0.32) : h; }

function themeColors(){
  const t = teamBy(cfg.team); const base = t ? t.colors : NEUTRAL; const s = cfg.scheme % 3;
  return [base[s], base[(s+1)%3], base[(s+2)%3]];
}
function applyTheme(){
  const [c1,c2,c3] = themeColors(); const root = document.documentElement.style;
  const fill = visibleFill(c1);
  root.setProperty("--accent", fill);
  root.setProperty("--accent-text", readable(c1));
  root.setProperty("--accent-ink", lum(fill) > 0.42 ? "#0b0e13" : "#ffffff");
  root.setProperty("--accent-2", readable(c2));
  root.setProperty("--accent-3", readable(c3));
  const b = $("teamBadge"); const t = teamBy(cfg.team);
  b.style.setProperty("--team-1", c1); b.style.setProperty("--team-2", c2); b.style.setProperty("--team-3", c3);
  b.textContent = t ? t.abbr : "PI"; b.title = t ? `${t.city} ${t.name}` : "No team picked";
  drawCourt();
}

// ---------------------------------------------------------------- court (drawn, generic)
function rng(seed){ return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function drawCourt(){
  const cv = $("court"); if(!cv.getContext) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0);
  const portrait = H > W * 1.05;
  let Wd = W, Hd = H;
  if(portrait){ ctx.translate(W,0); ctx.rotate(Math.PI/2); Wd = H; Hd = W; }
  const [paint, apron] = themeColors();
  const s = Math.max(Wd/104, Hd/60);              // px per foot, cover with apron
  const x0 = (Wd - 94*s)/2, y0 = (Hd - 50*s)/2;
  const X = ft => x0 + ft*s, Y = ft => y0 + ft*s;
  // apron
  ctx.fillStyle = apron; ctx.fillRect(0,0,Wd,Hd);
  // maple planks running the length of the floor
  const r = rng(1984);
  const plank = Math.max(3, s*0.55);
  for(let y=y0; y<y0+50*s; y+=plank){
    let x = x0;
    while(x < x0+94*s){
      const len = (7 + r()*10) * s;
      const L = 60 + (r()-0.5)*9, S = 46 + (r()-0.5)*8, Hh = 32 + (r()-0.5)*5;
      ctx.fillStyle = `hsl(${Hh} ${S}% ${L}%)`;
      ctx.fillRect(x, y, Math.min(len, x0+94*s-x), Math.min(plank, y0+50*s-y));
      x += len;
    }
    ctx.fillStyle = "rgba(60,35,10,.10)"; ctx.fillRect(x0, y, 94*s, Math.max(0.6, s*0.03));
  }
  // painted areas
  const lineDark = lum(paint) > 0.55;
  ctx.globalAlpha = 0.94; ctx.fillStyle = paint;
  ctx.fillRect(X(0), Y(17), 19*s, 16*s);
  ctx.fillRect(X(75), Y(17), 19*s, 16*s);
  ctx.beginPath(); ctx.arc(X(47), Y(25), 6*s, 0, Math.PI*2); ctx.fill();
  ctx.globalAlpha = 1;
  // lines
  ctx.strokeStyle = lineDark ? "rgba(20,20,20,.9)" : "rgba(255,255,255,.95)";
  ctx.lineWidth = Math.max(1.5, s*0.17);
  const line = (...p) => { ctx.beginPath(); ctx.moveTo(X(p[0]),Y(p[1])); for(let i=2;i<p.length;i+=2) ctx.lineTo(X(p[i]),Y(p[i+1])); ctx.stroke(); };
  const arc = (cx,cy,rad,a0,a1) => { ctx.beginPath(); ctx.arc(X(cx),Y(cy),rad*s,a0,a1); ctx.stroke(); };
  ctx.strokeRect(X(0), Y(0), 94*s, 50*s);
  line(47,0,47,50);
  arc(47,25,6,0,Math.PI*2); arc(47,25,2,0,Math.PI*2);
  const a3 = Math.asin(22/23.75);
  for(const side of [0,1]){
    const bx = side ? 94-5.25 : 5.25, dir = side ? -1 : 1, base = side ? 94 : 0, ft = side ? 94-19 : 19;
    ctx.strokeRect(side ? X(75) : X(0), Y(17), 19*s, 16*s);
    arc(ft,25,6, side ? Math.PI/2 : -Math.PI/2, side ? Math.PI*1.5 : Math.PI/2);
    arc(bx,25,4, side ? Math.PI/2 : -Math.PI/2, side ? Math.PI*1.5 : Math.PI/2);
    line(base+dir*4, 22, base+dir*4, 28);
    arc(bx,25,0.75,0,Math.PI*2);
    const kx = base + dir*14;
    line(base,3,kx,3); line(base,47,kx,47);
    if(side) arc(bx,25,23.75, Math.PI - a3, Math.PI + a3); else arc(bx,25,23.75, -a3, a3);
  }
}
let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(drawCourt, 150); });

// ---------------------------------------------------------------- data
let S = { league:null, users:[], rosters:[], nbaState:null, schedule:null, schedAt:0, season:null, seasonAt:0,
          week:null, maxWeek:null, data:null, lastOk:0, loading:false, focusDay:null, leagueLoaded:null };

async function getJSON(url){
  const r = await fetch(url, {cache:"no-store"});
  if(!r.ok) throw new Error(`Sleeper returned ${r.status}`);
  return r.json();
}
function phi(z){ return Math.exp(-0.5*z*z)/Math.sqrt(2*Math.PI); }
function Phi(z){ const t=1/(1+0.3275911*Math.abs(z)/Math.SQRT2); const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-(z*z)/2); return z>=0?0.5*(1+y):0.5*(1-y); }
const sdOf = mu => Math.max(MIN_SD, CV*Math.max(mu,0));
function eMax(mu,c){ const sd=sdOf(mu), z=(c-mu)/sd; return c*Phi(z)+mu*(1-Phi(z))+sd*phi(z); }
function contValue(projs){ if(!projs.length) return null; let v=Math.max(0,projs[projs.length-1]); for(let i=projs.length-2;i>=0;i--) v=eMax(projs[i],v); return v; }

const etToday = () => new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const addDays = (iso,n) => { const d=new Date(iso+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
const mondayOf = iso => addDays(iso, -((new Date(iso+"T12:00:00Z").getUTCDay()+6)%7));
const shortDate = iso => new Date(iso+"T12:00:00Z").toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"});
const dayName = iso => DAYS[(new Date(iso+"T12:00:00Z").getUTCDay()+6)%7];
const dayNum = iso => Number(iso.slice(8,10));
const gameState = st => st==="complete" ? "done" : (st==="pre_game"||!st) ? "pre" : "live";
const scorer = sc => stats => { let t=0; for(const k in sc){ const v=stats&&stats[k]; if(v) t+=v*sc[k]; } return Math.round(t*100)/100; };

function teamLabel(rid){
  const r = S.rosters.find(x=>x.roster_id===rid); if(!r) return {name:`Team ${rid}`, owners:""};
  const byId = Object.fromEntries(S.users.map(u=>[u.user_id,u]));
  const owner = byId[r.owner_id];
  let name = owner?.metadata?.team_name?.trim() || owner?.display_name || `Team ${rid}`;
  if(cfg.leagueId===DEFAULTS.leagueId && rid===DEFAULTS.rosterId && /^marfans$/i.test(name)) name = DEFAULT_LABEL.team;
  const owners = [owner, ...(r.co_owners||[]).map(id=>byId[id])].filter(Boolean).map(u=>u.display_name).join(" & ");
  return {name, owners};
}

async function loadAll(manual){
  if(S.loading) return; S.loading = true; setStatus("busy");
  try{
    const now = Date.now();
    if(S.leagueLoaded !== cfg.leagueId){ S.week = null; S.leagueLoaded = cfg.leagueId; }
    const [st, lg, us, ro] = await Promise.all([
      getJSON(`${API}/state/nba`), getJSON(`${API}/league/${cfg.leagueId}`),
      getJSON(`${API}/league/${cfg.leagueId}/users`), getJSON(`${API}/league/${cfg.leagueId}/rosters`)
    ]);
    if(!lg) throw new Error("that league wasn't found");
    S.nbaState = st; S.league = lg; S.users = us || []; S.rosters = ro || [];
    if(!S.rosters.some(r=>r.roster_id===cfg.rosterId) && S.rosters.length){ cfg.rosterId = S.rosters[0].roster_id; saveCfg(); }
    const season = lg.season || st.season;
    S.maxWeek = Number(st.week) || 1;
    if(S.week==null) S.week = S.maxWeek;
    const wk = S.week;
    const needSeason = !S.season || now-S.seasonAt > 30*60e3 || manual;
    const needSched = !S.schedule || now-S.schedAt > 30*60e3 || manual || wk===S.maxWeek;
    const [matchups, stats, projs, sched, seasonStats] = await Promise.all([
      getJSON(`${API}/league/${cfg.leagueId}/matchups/${wk}`),
      getJSON(`${API2}/stats/nba/${season}/${wk}?season_type=regular`),
      getJSON(`${API2}/projections/nba/${season}/${wk}?season_type=regular`),
      needSched ? getJSON(`${API2}/schedule/nba/regular/${season}`) : Promise.resolve(S.schedule),
      needSeason ? getJSON(`${API2}/stats/nba/${season}?season_type=regular`) : Promise.resolve(S.season)
    ]);
    if(needSched){ S.schedule = sched || []; S.schedAt = now; }
    if(needSeason){ S.season = seasonStats || []; S.seasonAt = now; }
    S.data = build(wk, matchups || [], stats || [], projs || []);
    S.lastOk = Date.now();
    $("err").hidden = true;
    render(); setStatus("ok");
  }catch(e){
    console.error(e);
    const box = $("err"); box.hidden = false;
    box.textContent = `Couldn't load from Sleeper (${e.message}). Trying again in 2 minutes, or tap refresh.`;
    setStatus("err");
  }finally{ S.loading = false; }
}

function build(wk, matchups, stats, projs){
  const fp = scorer(S.league.scoring_settings || {});
  const today = etToday();
  const games = S.schedule.filter(g=>Number(g.week)===Number(wk));
  const dates = games.map(g=>g.date).sort();
  const monday = mondayOf(dates[0] || today);
  const days = Array.from({length:7},(_,i)=>addDays(monday,i));
  const gameStatus = {}, teamGames = {};
  for(const g of games){
    gameStatus[g.game_id] = gameState(g.status);
    const h=g.home?.team, a=g.away?.team;
    (teamGames[h] ||= []).push({date:g.date, game_id:g.game_id, opp:a, home:true, st:gameState(g.status)});
    (teamGames[a] ||= []).push({date:g.date, game_id:g.game_id, opp:h, home:false, st:gameState(g.status)});
  }
  const info = {}, statBy = {}, projBy = {}, avg = {};
  const absorb = e => { if(e.player && e.player_id){ const p=e.player; info[e.player_id] = {
      name:`${p.first_name||""} ${p.last_name||""}`.trim(), pos:(p.fantasy_positions||[p.position]).filter(Boolean).join("/"),
      team:p.team || e.team, inj:p.injury_status || null }; } };
  for(const e of S.season){ absorb(e); const gp=e.stats?.gp; if(gp>0) avg[e.player_id] = fp(e.stats)/gp; }
  for(const e of projs){ absorb(e); if(e.date) (projBy[e.player_id] ||= {})[e.date] = {fp:fp(e.stats), opp:e.opponent, game_id:e.game_id}; }
  for(const e of stats){ absorb(e); if(e.date) (statBy[e.player_id] ||= {})[e.date] = {fp:fp(e.stats), opp:e.opponent, game_id:e.game_id}; }

  const mByRoster = Object.fromEntries(matchups.map(m=>[m.roster_id,m]));
  const slotsAll = (S.league.roster_positions||[]).filter(p=>p!=="BN" && p!=="IR");
  const weekKey = `pi:lk:${cfg.leagueId}:${wk}`;
  const marks = (() => { try { return JSON.parse(store.get(weekKey) || "{}"); } catch(e){ return {}; } })();
  const near = (a,b)=> a!=null && Math.abs(a-b) < 0.011;

  function playerModel(pid, isStarter, slot, points){
    const pi = info[pid] || {name:`Player ${pid}`, pos:"", team:null, inj:null};
    const sb = statBy[pid]||{}, pb = projBy[pid]||{}, base = avg[pid] ?? null;
    const byDate = {};
    for(const g of (teamGames[pi.team]||[])) byDate[g.date] = {...g};
    for(const [d,s] of Object.entries(sb)) if(!byDate[d]) byDate[d] = {date:d, opp:s.opp, st:gameStatus[s.game_id]||"done", game_id:s.game_id};
    for(const [d,p] of Object.entries(pb)) if(!byDate[d]) byDate[d] = {date:d, opp:p.opp, st:gameStatus[p.game_id]||(d<today?"done":"pre"), game_id:p.game_id};
    const gl = Object.values(byDate).filter(g=>days.includes(g.date)).sort((a,b)=>a.date.localeCompare(b.date));
    let outApplied = false;
    for(const g of gl){
      const s = sb[g.date], p = pb[g.date];
      g.actual = g.st==="pre" ? null : (s ? s.fp : 0);
      g.proj = p ? p.fp : (base!=null ? base*0.95 : null);
      if(g.st==="pre" && !outApplied && ["Out","IR","Sus"].includes(pi.inj)){ g.proj = 0; g.outAdj = true; outApplied = true; }
    }
    const done = gl.filter(g=>g.st==="done"), live = gl.find(g=>g.st==="live"), rem = gl.filter(g=>g.st==="pre");
    const P = Number(points ?? 0);
    let lock = "open", lockedOn = null;
    const latest = live || done[done.length-1];
    if(latest && near(latest.actual, P)) lock = "rolling";
    else { const hit = [...done].reverse().find(g=>near(g.actual,P)); if(hit){ lock="locked"; lockedOn=hit.date; } else if(latest) lock = "unknown"; }
    const marked = marks[pid];
    if(lock==="rolling" && marked && latest && marked===latest.date){ lock="locked"; lockedOn=marked; }
    for(const g of gl){ g.counts = lock!=="locked" && latest && g===latest; g.lockedHere = lock==="locked" && g.date===lockedOn; }
    const remProj = rem.map(g=>g.proj ?? 0);
    const V = contValue(remProj);
    rem.forEach((g,i)=>{ g.thr = contValue(remProj.slice(i+1)); });
    let verdict, ev, why = "", margin = null;
    const deadline = rem[0]?.date || null;
    if(!gl.length){ verdict="none"; ev=0; why="No games this week."; }
    else if(lock==="locked"){ verdict="locked"; ev=P; why=`Locked ${dayName(lockedOn)} at ${f2(P)}.`; }
    else if(live){
      const mu = Math.max(live.actual||0, live.proj||0);
      ev = V==null ? mu : eMax(mu, V); verdict="live"; margin = V;
      why = V==null ? "His last game this week is in progress. Whatever he finishes with counts." : `In progress with ${f1(live.actual)}. When it ends, lock if he finishes at ${f1(V)} or more.`;
    }
    else if(done.length && !rem.length){ verdict="final"; ev=P; why=`No games left. ${f2(P)} from ${dayName(latest.date)} counts.`; }
    else if(done.length){
      ev = Math.max(P,V); margin = P-V; verdict = P>=V ? "lock" : "roll";
      why = P>=V ? `${f2(P)} banked beats the ${f1(V)} you'd expect from rolling ${rem.length} more game${rem.length>1?"s":""}.`
                 : `Rolling is worth about ${f1(V)} vs ${f2(P)} banked. Let it ride.`;
    } else { verdict="wait"; ev=V ?? 0; why = rem.length ? `First game ${dayName(rem[0].date)}. Lock it if he scores ${rem[0].thr==null ? "anything (only game)" : f1(rem[0].thr)+" or more"}.` : ""; }
    const flags = [];
    if(["Out","IR","Sus"].includes(pi.inj)) flags.push(["warn", pi.inj==="IR" ? "IR" : "OUT next game"]);
    else if(pi.inj) flags.push(["caution", pi.inj]);
    if((verdict==="roll"||verdict==="wait") && rem.length===1) flags.push(["caution","FINAL GAME"]);
    if(gl.length && gl.length<=2) flags.push(["info","LOW VOLUME"]);
    if(isStarter && verdict==="final" && P===0) flags.push(["warn","Zero on the board"]);
    if(lock==="unknown") flags.push(["info","Score doesn't match a game yet"]);
    return {pid, name:pi.name, pos:pi.pos, team:pi.team, inj:pi.inj, slot, isStarter, avg:base, points:P, games:gl, done, rem, live,
            lock, lockedOn, verdict, ev, why, margin, deadline, flags, latest, V, marked};
  }
  function teamModel(rid){
    const m = mByRoster[rid], r = S.rosters.find(x=>x.roster_id===rid); if(!r) return null;
    const starters = (m?.starters || r.starters || []).filter(x=>x && x!=="0");
    const all = m?.players || r.players || [], pts = m?.players_points || {};
    const st = starters.map((pid,i)=>playerModel(pid,true,slotsAll[i]||"UTIL",pts[pid]));
    const bn = all.filter(p=>!starters.includes(p)).map(pid=>playerModel(pid,false,"BN",pts[pid]));
    return {rid, label:teamLabel(rid), starters:st, bench:bn, points: m?.points ?? st.reduce((a,p)=>a+p.points,0),
            ev: st.reduce((a,p)=>a+(p.ev||0),0), matchup_id:m?.matchup_id};
  }
  const mine = teamModel(cfg.rosterId);
  const oppRid = mine && matchups.find(x=>x.matchup_id===mine.matchup_id && x.roster_id!==cfg.rosterId)?.roster_id;
  return {wk, days, today, mine, opp: oppRid ? teamModel(oppRid) : null, weekKey};
}

// ---------------------------------------------------------------- render
const PILL = {lock:["p-lock","Lock"], roll:["p-roll","Roll"], locked:["p-locked","Locked"], wait:["p-wait","Wait"],
              live:["p-live","Live"], final:["p-final","Final"], none:["p-none","No games"]};
const pill = v => { const [c,t] = PILL[v] || ["p-none",v]; return `<span class="pill ${c}">${t}</span>`; };
const flagHTML = fl => fl.length ? `<div class="flags">${fl.map(([k,t])=>`<span class="flag f-${k}">${esc(t)}</span>`).join("")}</div>` : "";
const VCOLOR = {lock:"var(--lock)", roll:"var(--roll)", live:"var(--warn)", wait:"var(--ink-3)"};

function render(){
  const D = S.data; if(!D || !D.mine) return;
  $("leagueLine").textContent = `${(S.league.name||"").trim()} · ${D.mine.label.name}`;
  $("wkLabel").textContent = `Week ${D.wk}`;
  $("prevWk").disabled = D.wk<=1; $("nextWk").disabled = D.wk>=S.maxWeek;
  renderMatchup(D); renderTiles(D); renderWeek(D); renderAct(D); renderGrid(D);
}

function renderMatchup(D){
  const a = D.mine, b = D.opp, el = $("matchup").querySelector(".mu");
  const tot = (a?.ev||0) + (b?.ev||0), share = tot>0 ? a.ev/tot : 0.5;
  const R = 62, C = 2*Math.PI*R, gap = 6;
  const youLen = Math.max(0, share*C - gap), oppLen = Math.max(0, (1-share)*C - gap);
  const line = (t, color, you) => `
    <div class="sideline"><i style="background:${color}"></i>
      <div class="t"><div>${esc(t?.label.name || "No opponent")}</div><small>${esc(t?.label.owners || "")}${you?" · you":""}</small></div>
      <div class="s"><b>${t?f1(t.points):"–"}</b><small>proj ${t?f1(t.ev):"–"}</small></div></div>`;
  const diff = (a?.ev||0) - (b?.ev||0);
  el.innerHTML = `
    <div class="donut" role="img" aria-label="${Math.round(share*100)} percent of projected points">
      <svg viewBox="0 0 150 150">
        <circle cx="75" cy="75" r="${R}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="14"/>
        <circle cx="75" cy="75" r="${R}" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="14" stroke-linecap="round"
          stroke-dasharray="${oppLen} ${C}" stroke-dashoffset="${-(share*C)}"/>
        <circle cx="75" cy="75" r="${R}" fill="none" stroke="var(--accent-text)" stroke-width="14" stroke-linecap="round"
          stroke-dasharray="${youLen} ${C}"/>
      </svg>
      <div class="c"><b>${Math.round(share*100)}%</b><small>projected share</small></div>
    </div>
    <div class="sides">
      ${line(a,"var(--accent-text)",true)}
      ${line(b,"rgba(255,255,255,.45)",false)}
      <div class="margin">${b ? `Projected to ${diff>=0?"win":"lose"} by <b class="num">${f1(Math.abs(diff))}</b>` : "No opponent this week"}</div>
    </div>`;
}

const ICON = {
  lock:`<svg viewBox="0 0 24 24" fill="none" stroke="var(--lock)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>`,
  bolt:`<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-text)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>`,
  cal:`<svg viewBox="0 0 24 24" fill="none" stroke="var(--roll)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`
};
function renderTiles(D){
  const st = D.mine.starters;
  const locked = st.filter(p=>p.verdict==="locked").length;
  const pending = st.filter(p=>["lock","roll","live"].includes(p.verdict)).length;
  const left = st.reduce((a,p)=>a+(p.lock==="locked"?0:p.rem.length),0);
  const tiles = [[ICON.lock, `${locked}<span class="muted" style="font-size:13px">/${st.length}</span>`, "Starters locked"],
                 [ICON.bolt, pending, "Decisions pending"], [ICON.cal, left, "Live games left"]];
  $("tiles").innerHTML = tiles.map(([i,v,l])=>`<div class="card tile"><div class="ic">${i}</div><div><b>${v}</b><small>${l}</small></div></div>`).join("");
}

function renderWeek(D){
  $("weekTitle").textContent = `Week ${D.wk}`;
  $("weekSub").textContent = `${shortDate(D.days[0])} – ${shortDate(D.days[6])}`;
  $("days").innerHTML = D.days.map(d=>{
    const playing = D.mine.starters.filter(p=>p.games.some(g=>g.date===d));
    const dots = playing.map(p=>`<i class="${p.lock==="locked"?"":"a"}"></i>`).join("");
    const cls = ["day", d===D.today?"today":"", d<D.today?"past":"", S.focusDay===d?"focus":""].join(" ");
    return `<button class="${cls}" data-day="${d}" aria-pressed="${S.focusDay===d}"><span class="dn">${dayName(d)}</span><span class="dd">${dayNum(d)}</span><span class="dots">${dots}</span><span class="cnt">${playing.length} g</span></button>`;
  }).join("");
  $("focusNote").textContent = S.focusDay ? `${dayName(S.focusDay)} highlighted · tap again to clear` : "Tap a day to highlight it in the grid";
}

function ring(p){
  const R = 14, C = 2*Math.PI*R;
  let frac = 0;
  if(p.verdict==="lock") frac = 1;
  else if(p.verdict==="roll" && p.V) frac = Math.min(1, p.points/p.V);
  else if(p.verdict==="live" && p.V) frac = Math.min(1, (p.live?.actual||0)/p.V);
  return `<svg class="ring" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="${R}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="3"/>
    <circle cx="17" cy="17" r="${R}" fill="none" stroke="${VCOLOR[p.verdict]||"var(--ink-3)"}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${frac*C} ${C}"/></svg>`;
}
function renderAct(D){
  const ps = D.mine.starters;
  const act = ps.filter(p=>["lock","roll","live"].includes(p.verdict) || (p.verdict==="wait" && p.deadline===D.today));
  const order = {lock:0, live:1, roll:2, wait:3};
  act.sort((x,y)=> (x.deadline||"9").localeCompare(y.deadline||"9") || order[x.verdict]-order[y.verdict] || (y.margin??0)-(x.margin??0));
  const lockN = act.filter(p=>p.verdict==="lock").length, todayN = act.filter(p=>p.deadline===D.today).length;
  $("actSub").textContent = act.length ? `${lockN} to lock · ${todayN} play today (ET) · sorted by next tip-off` : "Starters with a decision before their next tip-off";
  if(!act.length){ $("alist").innerHTML = `<div class="empty">Nothing to decide for ${esc(D.mine.label.name)} right now. Everyone is locked, final, or hasn't played yet.</div>`; return; }
  $("alist").innerHTML = act.map(p=>{
    const n = p.rem[0];
    const next = n ? `${dayName(n.date)} ${n.home?"vs":"@"} ${esc(n.opp||"")}${n.date===D.today?" · today":""}` : (p.live ? "in progress" : "–");
    const banked = p.verdict==="wait" ? "–" : f2(p.live ? p.live.actual : p.points);
    const brk = p.verdict==="wait" ? (n?.thr==null ? "any" : f1(n.thr)) : f1(p.V);
    return `<div class="arow">${ring(p)}
      <div class="who"><div class="n">${esc(p.name)}</div><div class="m">${esc(p.slot)} · ${esc(p.team||"FA")} · next ${next}</div><div class="why">${esc(p.why)}</div>${flagHTML(p.flags)}</div>
      <div class="nbs">
        <div class="nb"><b>${banked}</b><small>${p.live?"live":"banked"}</small></div>
        <div class="nb"><b>${brk}</b><small>${p.verdict==="wait"?"lock if ≥":"roll value"}</small></div>
        <div class="nb"><b>${f1(p.avg)}</b><small>season avg</small></div>
      </div>${pill(p.verdict)}</div>`;
  }).join("");
}

function renderGrid(D){
  const t = D.mine, cols = D.days.length + 6;
  $("grid").querySelector("thead").innerHTML = `<tr><th>Slot</th><th>Player</th><th class="r">Avg</th>${D.days.map(d=>`<th class="${d===D.today?"today":""}" style="text-align:center">${dayName(d)} ${dayNum(d)}</th>`).join("")}<th class="r">Counts</th><th>Call</th><th>Flags</th></tr>`;
  const row = p => {
    const cells = D.days.map(d=>{
      const g = p.games.find(x=>x.date===d);
      const td = `td class="day ${d===D.today?"today":""} ${S.focusDay===d?"focus":""}"`;
      if(!g) return `<${td}><span class="nog">·</span></td>`;
      const cls = ["g", g.st==="pre"?"proj":"done", g.st==="live"?"live":"", g.counts?"counts":"", g.lockedHere?"lockedg":""].join(" ");
      const val = g.st==="pre" ? f1(g.proj) : f2(g.actual);
      const tag = g.lockedHere ? "locked" : g.counts ? (g.st==="live"?"live":"counts") : g.st==="live" ? "live"
                : (g.st==="pre" && g.thr!=null && p.lock!=="locked" && p.isStarter) ? `lock ≥${Math.round(g.thr)}` : g.outAdj ? "out" : "";
      return `<${td}><div class="${cls}" title="${g.st==="pre"?"Projected":"Actual"} ${val}"><span class="o">${g.home?"vs":"@"} ${esc(g.opp||"")}</span><span class="v">${val}</span>${tag?`<span class="tag">${tag}</span>`:""}</div></td>`;
    }).join("");
    const mark = (p.isStarter && p.lock==="rolling" && p.latest?.st==="done" && p.rem.length) ? `<button class="mini" data-mark="${p.pid}" data-date="${p.latest.date}">I locked this</button>`
               : (p.marked && p.lock==="locked" && p.lockedOn===p.marked) ? `<button class="mini" data-unmark="${p.pid}">Undo mark</button>` : "";
    return `<tr class="${p.isStarter?"":"bench"}"><td class="slot">${esc(p.slot)}</td>
      <td class="player"><div class="n">${esc(p.name)}</div><div class="s">${esc(p.pos)} · ${esc(p.team||"FA")}</div>${mark}</td>
      <td class="r num">${f1(p.avg)}</td>${cells}
      <td class="r num">${f2(p.points)}</td><td>${p.isStarter?pill(p.verdict):'<span class="nog">bench</span>'}</td>
      <td>${flagHTML(p.isStarter?p.flags:p.flags.filter(f=>f[0]!=="info"))}</td></tr>`;
  };
  $("grid").querySelector("tbody").innerHTML =
    `<tr class="sep"><td colspan="${cols}">Starters · ${f1(t.points)} on the board · ${f1(t.ev)} projected</td></tr>` + t.starters.map(row).join("") +
    (t.bench.length ? `<tr class="sep"><td colspan="${cols}">Bench · doesn't score</td></tr>` + t.bench.map(row).join("") : "");
}

function setStatus(mode){
  const dot = $("liveDot");
  dot.className = "live" + (mode==="busy"?" busy":"") + (mode==="err"?" err":"");
  if(mode==="busy" && !S.lastOk){ $("statusTxt").textContent = "Connecting to Sleeper…"; return; }
  if(mode==="err" && !S.lastOk){ $("statusTxt").textContent = "Offline"; return; }
  tick();
}
function tick(){
  if(!S.lastOk) return;
  const s = Math.round((Date.now()-S.lastOk)/1000);
  if(!S.loading && !$("liveDot").classList.contains("err")) $("liveDot").className = "live" + (s>300?" stale":"");
  $("statusTxt").textContent = `Live · ${s<60 ? s+"s" : Math.floor(s/60)+" min"} ago`;
}

// ---------------------------------------------------------------- league finder (shared by setup + settings)
function leagueFinder(el, onPick){
  el.innerHTML = `<div class="finder"><input class="search" id="lfUser" placeholder="Sleeper username" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Sleeper username"><button class="btn" id="lfGo">Find leagues</button></div><div class="list" id="lfOut" style="margin-top:10px"></div>`;
  const out = el.querySelector("#lfOut"), inp = el.querySelector("#lfUser");
  const go = async () => {
    const u = inp.value.trim(); if(!u) return;
    out.innerHTML = `<div class="note">Looking up ${esc(u)}…</div>`;
    try{
      const st = S.nbaState || await getJSON(`${API}/state/nba`);
      const user = await getJSON(`${API}/user/${encodeURIComponent(u)}`);
      if(!user){ out.innerHTML = `<div class="errline">No Sleeper user named "${esc(u)}". Check the spelling in the Sleeper app.</div>`; return; }
      const leagues = await getJSON(`${API}/user/${user.user_id}/leagues/nba/${st.league_season || st.season}`) || [];
      if(!leagues.length){ out.innerHTML = `<div class="errline">${esc(u)} has no NBA leagues this season.</div>`; return; }
      out.innerHTML = `<div class="note">Pick a league</div>` + leagues.map(l=>`<button class="opt" data-lid="${l.league_id}"><span class="dot"></span><span><b>${esc(l.name.trim())}</b><small>${l.total_rosters} teams · ${esc(l.status.replace("_"," "))}</small></span></button>`).join("");
      out.querySelectorAll("[data-lid]").forEach(b=>b.addEventListener("click", async () => {
        out.querySelectorAll(".opt").forEach(x=>x.classList.toggle("sel", x===b));
        const lid = b.dataset.lid;
        const [us, ro] = await Promise.all([getJSON(`${API}/league/${lid}/users`), getJSON(`${API}/league/${lid}/rosters`)]);
        const byId = Object.fromEntries((us||[]).map(x=>[x.user_id,x]));
        const mineR = (ro||[]).find(r=>r.owner_id===user.user_id || (r.co_owners||[]).includes(user.user_id));
        const opts = (ro||[]).map(r=>{ const o=byId[r.owner_id]; const nm=o?.metadata?.team_name?.trim()||o?.display_name||`Team ${r.roster_id}`;
          return `<option value="${r.roster_id}" ${mineR&&mineR.roster_id===r.roster_id?"selected":""}>${esc(nm)}${mineR&&mineR.roster_id===r.roster_id?" (yours)":""}</option>`; }).join("");
        let pickEl = out.querySelector(".teampick");
        if(!pickEl){ pickEl = document.createElement("div"); pickEl.className = "teampick"; out.appendChild(pickEl); }
        pickEl.innerHTML = `<div class="note" style="margin-top:6px">Your team in this league</div><select id="lfTeam" style="height:42px;width:100%;border-radius:12px;border:1px solid var(--edge);background:rgba(20,24,32,.9);padding:0 10px">${opts}</select>`;
        const sel = pickEl.querySelector("select");
        const fire = () => onPick({leagueId: lid, rosterId: Number(sel.value)});
        sel.addEventListener("change", fire); fire();
      }));
    }catch(e){ out.innerHTML = `<div class="errline">Couldn't reach Sleeper (${esc(e.message)}). Try again.</div>`; }
  };
  el.querySelector("#lfGo").addEventListener("click", go);
  inp.addEventListener("keydown", e=>{ if(e.key==="Enter") go(); });
}

// ---------------------------------------------------------------- onboarding
const root = $("overlayRoot");
function closeOverlay(){ root.innerHTML = ""; document.body.style.overflow = ""; }
function openSetup(step=0){
  const draft = { team: cfg.team, leagueId: cfg.leagueId, rosterId: cfg.rosterId, useDefault: cfg.leagueId===DEFAULTS.leagueId };
  const prevTheme = { team: cfg.team, scheme: cfg.scheme };
  document.body.style.overflow = "hidden";
  const paint = () => {
    root.innerHTML = `<div class="scrim" role="dialog" aria-modal="true" aria-labelledby="setupTitle"><div class="modal glass" id="setupModal"></div></div>`;
    const m = $("setupModal");
    const bar = `<div class="steps"><i class="on"></i><i class="${step>=1?"on":""}"></i></div>`;
    if(step===0){
      m.innerHTML = `${bar}<div><h2 id="setupTitle">Who's your team?</h2><p>Their colors theme the console and the court behind it. You can switch to their secondary or tertiary colors in Settings.</p></div>
        <input class="search" id="tSearch" placeholder="Search teams" aria-label="Search teams" autocomplete="off">
        <div class="teamgrid" id="tGrid"></div>
        <div class="mfoot"><button class="btn link" id="skipTeam">Skip, use neutral colors</button><button class="btn primary" id="nextBtn" ${draft.team?"":"disabled"}>Next</button></div>`;
      const grid = $("tGrid");
      const draw = q => { grid.innerHTML = TEAMS.filter(t=>!q || `${t.city} ${t.name} ${t.abbr}`.toLowerCase().includes(q)).map(t=>
        `<button class="tbtn ${draft.team===t.abbr?"sel":""}" data-team="${t.abbr}" aria-pressed="${draft.team===t.abbr}"><span class="sw3">${t.colors.map(c=>`<i style="background:${c}"></i>`).join("")}</span><span><small>${esc(t.city)}</small><b>${esc(t.name)}</b></span></button>`).join(""); };
      draw("");
      $("tSearch").addEventListener("input", e=>draw(e.target.value.trim().toLowerCase()));
      grid.addEventListener("click", e=>{ const b=e.target.closest("[data-team]"); if(!b) return;
        draft.team = b.dataset.team; cfg.team = draft.team; cfg.scheme = 0; applyTheme();
        grid.querySelectorAll(".tbtn").forEach(x=>{ x.classList.toggle("sel", x===b); x.setAttribute("aria-pressed", x===b); });
        $("nextBtn").disabled = false; });
      $("skipTeam").addEventListener("click", ()=>{ draft.team = null; cfg.team = null; applyTheme(); step = 1; paint(); });
      $("nextBtn").addEventListener("click", ()=>{ step = 1; paint(); });
      setTimeout(()=>$("tSearch")?.focus({preventScroll:true}), 30);
    } else {
      m.innerHTML = `${bar}<div><h2 id="setupTitle">Which league?</h2><p>ProjectIverson reads your league straight from Sleeper. No sign-in needed.</p></div>
        <div class="list">
          <button class="opt ${draft.useDefault?"sel":""}" id="optDefault"><span class="dot"></span><span><b>${esc(DEFAULT_LABEL.league)}</b><small>${esc(DEFAULT_LABEL.team)}</small></span></button>
          <button class="opt ${draft.useDefault?"":"sel"}" id="optOther"><span class="dot"></span><span><b>Another Sleeper league</b><small>Look it up by Sleeper username</small></span></button>
        </div>
        <div id="finderBox" ${draft.useDefault?"hidden":""}></div>
        <div class="mfoot"><button class="btn" id="backBtn">Back</button><button class="btn primary" id="doneBtn">Open my console</button></div>`;
      const fb = $("finderBox");
      leagueFinder(fb, pick => { draft.leagueId = pick.leagueId; draft.rosterId = pick.rosterId; });
      $("optDefault").addEventListener("click", ()=>{ draft.useDefault = true; $("optDefault").classList.add("sel"); $("optOther").classList.remove("sel"); fb.hidden = true; });
      $("optOther").addEventListener("click", ()=>{ draft.useDefault = false; $("optOther").classList.add("sel"); $("optDefault").classList.remove("sel"); fb.hidden = false; fb.querySelector("input")?.focus(); });
      $("backBtn").addEventListener("click", ()=>{ step = 0; paint(); });
      $("doneBtn").addEventListener("click", ()=>{
        if(draft.useDefault){ draft.leagueId = DEFAULTS.leagueId; draft.rosterId = DEFAULTS.rosterId; }
        const changed = draft.leagueId !== cfg.leagueId || draft.rosterId !== cfg.rosterId;
        Object.assign(cfg, { team: draft.team, leagueId: draft.leagueId, rosterId: draft.rosterId, onboarded: true });
        saveCfg(); closeOverlay(); applyTheme();
        const after = () => { if(!cfg.toured) startTour(); };
        if(changed){ S.week = null; S.data = null; loadAll(true).then(after); } else after();
      });
    }
  };
  paint();
  root._cancel = () => { if(!cfg.onboarded){ return; } cfg.team = prevTheme.team; cfg.scheme = prevTheme.scheme; applyTheme(); closeOverlay(); };
}

// ---------------------------------------------------------------- settings drawer
function openSettings(){
  const t = teamBy(cfg.team);
  const base = t ? t.colors : NEUTRAL;
  const schemes = ["Primary","Secondary","Tertiary"].map((label,i)=>{ const order=[base[i],base[(i+1)%3],base[(i+2)%3]];
    return `<button class="scheme ${cfg.scheme===i?"sel":""}" data-scheme="${i}" aria-pressed="${cfg.scheme===i}"><span class="bar">${order.map(c=>`<i style="background:${c}"></i>`).join("")}</span><span>${label}</span></button>`; }).join("");
  const rosterOpts = S.rosters.slice().sort((a,b)=>a.roster_id-b.roster_id).map(r=>`<option value="${r.roster_id}" ${r.roster_id===cfg.rosterId?"selected":""}>${esc(teamLabel(r.roster_id).name)}</option>`).join("");
  const share = `${location.origin}${location.pathname}?league=${cfg.leagueId}&team=${cfg.rosterId}`;
  root.innerHTML = `<div class="scrim" style="place-items:stretch end;padding:0" id="drawScrim"><aside class="drawer glass" role="dialog" aria-modal="true" aria-labelledby="setTitle">
    <div class="drawhead"><h2 id="setTitle">Settings</h2><button class="iconbtn" id="closeSet" aria-label="Close settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <section><h3>Favorite team</h3><select id="setTeam" aria-label="Favorite team"><option value="">No team (neutral colors)</option>${TEAMS.map(x=>`<option value="${x.abbr}" ${x.abbr===cfg.team?"selected":""}>${esc(x.city)} ${esc(x.name)}</option>`).join("")}</select></section>
    <section><h3>Color scheme</h3><div class="schemes" id="schemes">${schemes}</div><p class="note" style="margin:8px 0 0">The first color leads: it sets the accent and the painted lane on the court.</p></section>
    <section><h3>Your team in ${esc((S.league?.name||"this league").trim())}</h3><select id="setRoster" aria-label="Your fantasy team">${rosterOpts}</select></section>
    <section><h3>Switch league</h3><div id="setFinder"></div><button class="btn" id="useDefault" style="margin-top:10px">Back to ${esc(DEFAULT_LABEL.league)}</button></section>
    <section><h3>Share</h3><p class="note" style="margin:0 0 8px">This link opens straight to this league and team. Everyone picks their own colors.</p>
      <div class="finder"><input class="search" id="shareUrl" readonly value="${esc(share)}" aria-label="Share link"><button class="btn" id="copyShare">Copy</button></div></section>
    <section><h3>Help</h3><div class="finder"><button class="btn" id="replayTour">Replay the tour</button><button class="btn" id="rerunSetup">Run setup again</button></div>
      <p class="note" style="margin:10px 0 0">Settings are saved on this device.</p></section>
  </aside></div>`;
  document.body.style.overflow = "hidden";
  const close = () => closeOverlay();
  root._cancel = close;
  $("closeSet").addEventListener("click", close);
  $("drawScrim").addEventListener("click", e=>{ if(e.target.id==="drawScrim") close(); });
  $("setTeam").addEventListener("change", e=>{ cfg.team = e.target.value || null; cfg.scheme = 0; saveCfg(); applyTheme(); openSettings(); });
  $("schemes").addEventListener("click", e=>{ const b=e.target.closest("[data-scheme]"); if(!b) return; cfg.scheme = Number(b.dataset.scheme); saveCfg(); applyTheme(); openSettings(); });
  $("setRoster").addEventListener("change", e=>{ cfg.rosterId = Number(e.target.value); saveCfg(); loadAll(); openSettings(); });
  leagueFinder($("setFinder"), pick => { cfg.leagueId = pick.leagueId; cfg.rosterId = pick.rosterId; saveCfg(); S.data=null; loadAll(true); });
  $("useDefault").addEventListener("click", ()=>{ cfg.leagueId = DEFAULTS.leagueId; cfg.rosterId = DEFAULTS.rosterId; saveCfg(); S.data=null; loadAll(true).then(openSettings); });
  $("copyShare").addEventListener("click", async ()=>{ const b=$("copyShare"); try{ await navigator.clipboard.writeText(share); b.textContent="Copied"; }catch(e){ $("shareUrl").select(); b.textContent="Selected"; } setTimeout(()=>{ if(b.isConnected) b.textContent="Copy"; },1600); });
  $("replayTour").addEventListener("click", ()=>{ close(); startTour(); });
  $("rerunSetup").addEventListener("click", ()=>{ close(); openSetup(0); });
  $("closeSet").focus();
}

// ---------------------------------------------------------------- tour
const TOUR = [
  { sel:"#matchup", k:"Matchup", t:"Where your week stands",
    p:"Live points from Sleeper on the left, projected finish on the right. Projections assume you keep making the best lock calls for the rest of the week." },
  { sel:"#tiles", k:"At a glance", t:"Three numbers that matter",
    p:"How many starters are locked, how many need a decision, and how many games your unlocked starters have left." },
  { sel:"#weekCard", k:"The week", t:"Today is highlighted",
    p:"Each dot is one of your starters playing that day. Lit dots are still in play; dim ones are already locked. Tap a day to highlight it in the grid." },
  { sel:"#actNow", k:"Act now", t:"Your to-do list before tip-off",
    p:"LOCK means bank his score now in Sleeper. ROLL means his remaining games are worth more on average, so let it ride. WAIT means he hasn't played yet; the number shown is what he needs to score to be worth locking." },
  { sel:"#gridCard", k:"Lock grid", t:"Every game, every starter",
    p:"Italic numbers are projections, bold are actual points. A team-colored outline marks the game currently counting, green marks a locked game, and 'lock ≥ 28' is the break-even for that game." },
  { sel:"[data-mark], #gridCard", k:"One quirk", t:"\"I locked this\"",
    p:"Right after a game, Sleeper's data can't tell a lock from a rolling score until his next game. If you locked him, tap \"I locked this\" so this device knows. It sorts itself out after his next game." },
  { sel:"#settingsBtn", k:"Make it yours", t:"Settings",
    p:"Switch your favorite team, flip to their secondary or tertiary colors, change fantasy team or league, copy a share link, or replay this tour. Refresh is next to it, and the page also updates itself every 2 minutes." }
];
function startTour(){
  let i = 0;
  root.innerHTML = `<div class="tour" id="tour" role="dialog" aria-modal="true" aria-labelledby="tipTitle"><div class="spot" id="spot"></div><div class="tip glass" id="tip"></div></div>`;
  const spot = $("spot"), tip = $("tip");
  const finish = () => { cfg.toured = true; saveCfg(); closeOverlay(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  root._cancel = finish;
  function target(){ return TOUR[i].sel.split(",").map(s=>document.querySelector(s.trim())).find(Boolean) || $("overview"); }
  function place(){
    const el = target(); if(!el) return;
    const r = el.getBoundingClientRect(), pad = 8;
    Object.assign(spot.style, { left:`${r.left-pad}px`, top:`${r.top-pad}px`, width:`${r.width+pad*2}px`, height:`${r.height+pad*2}px` });
    const tw = tip.offsetWidth, th = tip.offsetHeight, vw = innerWidth, vh = innerHeight;
    let top = r.bottom + 16; if(top + th > vh - 12) top = r.top - th - 16; if(top < 12) top = Math.max(12, vh - th - 12);
    let left = Math.min(Math.max(12, r.left), vw - tw - 12);
    Object.assign(tip.style, { top:`${top}px`, left:`${left}px` });
  }
  function show(){
    const s = TOUR[i];
    tip.innerHTML = `<span class="k">${s.k} · ${i+1} of ${TOUR.length}</span><h3 id="tipTitle">${esc(s.t)}</h3><p>${esc(s.p)}</p>
      <div class="row"><button class="btn link" id="tSkip">Skip tour</button><span style="display:flex;gap:8px">${i?'<button class="btn" id="tBack">Back</button>':""}<button class="btn primary" id="tNext">${i===TOUR.length-1?"Done":"Next"}</button></span></div>`;
    $("tSkip").onclick = finish;
    if($("tBack")) $("tBack").onclick = () => { i--; show(); };
    $("tNext").onclick = () => { if(i===TOUR.length-1) finish(); else { i++; show(); } };
    const el = target();
    el.scrollIntoView({block: el.offsetHeight > innerHeight*0.6 ? "start" : "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
    setTimeout(place, 380); place();
    $("tNext").focus({preventScroll:true});
  }
  window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
  show();
}

// ---------------------------------------------------------------- events
$("refreshBtn").addEventListener("click", ()=>loadAll(true));
$("prevWk").addEventListener("click", ()=>{ if(S.week>1){ S.week--; S.focusDay=null; loadAll(); } });
$("nextWk").addEventListener("click", ()=>{ if(S.week<S.maxWeek){ S.week++; S.focusDay=null; loadAll(); } });
$("settingsBtn").addEventListener("click", openSettings);
$("helpBtn").addEventListener("click", startTour);
$("days").addEventListener("click", e=>{ const b=e.target.closest("[data-day]"); if(!b||!S.data) return; S.focusDay = S.focusDay===b.dataset.day ? null : b.dataset.day; renderWeek(S.data); renderGrid(S.data); });
$("grid").addEventListener("click", e=>{
  const b = e.target.closest("button"); if(!b || !S.data) return;
  let marks = {}; try { marks = JSON.parse(store.get(S.data.weekKey) || "{}"); } catch(_){}
  if(b.dataset.mark) marks[b.dataset.mark] = b.dataset.date;
  if(b.dataset.unmark) delete marks[b.dataset.unmark];
  store.set(S.data.weekKey, JSON.stringify(marks)); loadAll();
});
document.querySelectorAll(".rail [data-jump]").forEach(b=>b.addEventListener("click", ()=>{
  $(b.dataset.jump).scrollIntoView({behavior:"smooth", block:"start"});
  document.querySelectorAll(".rail button").forEach(x=>x.classList.toggle("on", x===b));
}));
document.querySelector('.rail [data-act="settings"]').addEventListener("click", openSettings);
document.querySelector('.rail [data-act="tour"]').addEventListener("click", startTour);
document.addEventListener("keydown", e=>{
  if(e.key==="Escape" && root.innerHTML && root._cancel) root._cancel();
  if(document.getElementById("tour") && (e.key==="ArrowRight"||e.key==="ArrowLeft")){ const b = $(e.key==="ArrowRight"?"tNext":"tBack"); b && b.click(); }
});
setInterval(()=>{ if(document.visibilityState==="visible") loadAll(); }, REFRESH_MS);
setInterval(tick, 5000);
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible" && Date.now()-S.lastOk > REFRESH_MS) loadAll(); });

// ---------------------------------------------------------------- boot
applyTheme();
loadAll();
if(!cfg.onboarded) openSetup(0);
window.__pi = { contValue, eMax, cfg: () => cfg };
})();
