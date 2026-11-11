/* Small SVG chart kit for ProjectIverson: line, bars, horizontal bars, sparkline.
   2px lines, 8px markers with a surface ring, 4px rounded bar ends on the baseline,
   recessive grid, legend + direct labels, hover tooltips, and a table view. */
(() => {
"use strict";
const NS = "http://www.w3.org/2000/svg";
const mounted = new Map();
let tip;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function tipEl(){ if(!tip){ tip = document.createElement("div"); tip.className = "ptip"; tip.hidden = true; tip.setAttribute("role","status"); document.body.appendChild(tip); } return tip; }
function showTip(html, x, y){
  const t = tipEl(); t.innerHTML = html; t.hidden = false;
  const r = t.getBoundingClientRect();
  let left = x + 14, top = y - r.height - 12;
  if(left + r.width > innerWidth - 8) left = x - r.width - 14;
  if(top < 8) top = y + 18;
  t.style.left = `${Math.max(8,left)}px`; t.style.top = `${top}px`;
}
function hideTip(){ if(tip) tip.hidden = true; }
window.addEventListener("scroll", hideTip, {passive:true});

function nice(v){ if(v<=0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v/p; return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p; }
function scaleTicks(min, max, n=4){
  if(max === min){ max = min + 1; }
  const step = nice((max-min)/n); const lo = Math.floor(min/step)*step, hi = Math.ceil(max/step)*step;
  const out = []; for(let v=lo; v<=hi+1e-9; v+=step) out.push(+v.toFixed(6)); return out;
}
const el = (tag, attrs={}, parent) => { const e = document.createElementNS(NS, tag); for(const k in attrs) e.setAttribute(k, attrs[k]); if(parent) parent.appendChild(e); return e; };
function mount(host, fn){ mounted.set(host, fn); fn(); }
let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { for(const [h,fn] of mounted){ if(!h.isConnected) mounted.delete(h); else fn(); } }, 160); });

function legend(series){
  if(series.length < 2) return "";
  return `<div class="clegend">${series.map(s=>`<span><i style="${s.dash?`background:none;border-top:2px ${s.dash==="dot"?"dotted":"dashed"} ${s.color}`:`background:${s.color}`}"></i>${esc(s.name)}</span>`).join("")}</div>`;
}
function tableView(head, rows){
  return `<details class="tview"><summary>Show as table</summary><div class="tvwrap"><table><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
}

/* ---------- line chart ---------- */
function line(host, o){
  const fmt = o.fmt || (v => v==null ? "–" : (Math.round(v*10)/10).toString());
  host.innerHTML = `${legend(o.series)}<div class="cbox"></div>${o.table===false?"":tableView([o.xName||"Week", ...o.series.map(s=>s.name)], o.labels.map((l,i)=>[l, ...o.series.map(s=>fmt(s.values[i]))]))}`;
  const box = host.querySelector(".cbox");
  mount(host, () => {
    box.innerHTML = "";
    const W = Math.max(280, box.clientWidth || 600), H = o.height || 220;
    const directLabels = o.series.length <= 4 && W > 420;
    const m = {l: 40, r: directLabels ? 92 : 14, t: 12, b: 26};
    const vals = o.series.flatMap(s => s.values.filter(v => v!=null));
    let lo = o.yMin != null ? o.yMin : Math.min(0, ...vals), hi = o.yMax != null ? o.yMax : Math.max(...vals, lo + 1);
    const tk = scaleTicks(lo, hi, 4); lo = tk[0]; hi = tk[tk.length-1];
    const X = i => m.l + (o.labels.length===1 ? (W-m.l-m.r)/2 : i*(W-m.l-m.r)/(o.labels.length-1));
    const Y = v => m.t + (1-(v-lo)/(hi-lo))*(H-m.t-m.b);
    const svg = el("svg", {width:W, height:H, viewBox:`0 0 ${W} ${H}`, role:"img", "aria-label": o.aria || "Line chart"}, box);
    for(const t of tk){ el("line", {x1:m.l, x2:W-m.r, y1:Y(t), y2:Y(t), class: t===0 ? "zero" : "grid"}, svg); const tx = el("text", {x:m.l-8, y:Y(t)+4, class:"ytk", "text-anchor":"end"}, svg); tx.textContent = o.yTick ? o.yTick(t) : fmt(t); }
    const every = Math.ceil(o.labels.length / Math.max(2, Math.floor((W-m.l-m.r)/56)));
    o.labels.forEach((l,i)=>{ if(i%every && i!==o.labels.length-1) return; const tx = el("text", {x:X(i), y:H-6, class:"xtk", "text-anchor":"middle"}, svg); tx.textContent = l; });
    const lastPts = [];
    o.series.forEach(s => {
      let d = "", pen = false;
      s.values.forEach((v,i)=>{ if(v==null){ pen=false; return; } d += `${pen?"L":"M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; });
      el("path", {d, fill:"none", stroke:s.color, "stroke-width":s.width||2, "stroke-linecap":"round", "stroke-linejoin":"round", "stroke-dasharray": s.dash==="dot" ? "1 5" : s.dash ? "6 5" : ""}, svg);
      if(s.marker !== false) s.values.forEach((v,i)=>{ if(v!=null) el("circle", {cx:X(i), cy:Y(v), r:4, fill:s.color, class:"mk"}, svg); });
      const li = s.values.map((v,i)=>v==null?-1:i).filter(i=>i>=0).pop();
      if(li != null && li >= 0) lastPts.push({s, y:Y(s.values[li]), x:X(li), v:s.values[li]});
    });
    if(directLabels){
      lastPts.sort((a,b)=>a.y-b.y);
      for(let i=1;i<lastPts.length;i++) if(lastPts[i].y - lastPts[i-1].y < 14) lastPts[i].y = lastPts[i-1].y + 14;
      for(const p of lastPts){ const tx = el("text", {x:W-m.r+8, y:p.y+4, class:"dlab"}, svg); tx.textContent = p.s.name.length > 13 ? p.s.name.slice(0,12)+"…" : p.s.name; }
    }
    const cross = el("line", {y1:m.t, y2:H-m.b, class:"cross", visibility:"hidden"}, svg);
    const hit = el("rect", {x:m.l, y:0, width:W-m.l-m.r, height:H, fill:"transparent"}, svg);
    const move = e => {
      const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left);
      const i = Math.max(0, Math.min(o.labels.length-1, Math.round((px-m.l)/((W-m.l-m.r)/Math.max(1,o.labels.length-1)))));
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("visibility","visible");
      showTip(`<b>${esc(o.labels[i])}</b>${o.series.map(s=>`<div><i style="background:${s.color}"></i>${esc(s.name)}<span>${fmt(s.values[i])}</span></div>`).join("")}${o.note?`<small>${esc(o.note(i))}</small>`:""}`, e.clientX, e.clientY);
    };
    hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility","hidden"); hideTip(); });
  });
}

/* ---------- vertical bars (supports negatives) ---------- */
function bars(host, o){
  const fmt = o.fmt || (v => (Math.round(v*10)/10).toString());
  host.innerHTML = `${o.legend ? `<div class="clegend">${o.legend.map(l=>`<span><i style="background:${l.color}"></i>${esc(l.name)}</span>`).join("")}</div>` : ""}<div class="cbox"></div>${o.table===false?"":tableView([o.xName||"Week", o.yName||"Value"], o.labels.map((l,i)=>[l, fmt(o.values[i])]))}`;
  const box = host.querySelector(".cbox");
  mount(host, () => {
    box.innerHTML = "";
    const W = Math.max(260, box.clientWidth || 600), H = o.height || 200, m = {l:40, r:10, t:12, b:26};
    const vals = o.values.map(v => v ?? 0);
    const tk = scaleTicks(Math.min(0, ...vals), Math.max(0.001, ...vals), 4); const lo = tk[0], hi = tk[tk.length-1];
    const Y = v => m.t + (1-(v-lo)/(hi-lo))*(H-m.t-m.b);
    const n = vals.length, slot = (W-m.l-m.r)/n, bw = Math.max(4, Math.min(42, slot - Math.max(2, slot*0.35)));
    const svg = el("svg", {width:W, height:H, viewBox:`0 0 ${W} ${H}`, role:"img", "aria-label": o.aria || "Bar chart"}, box);
    for(const t of tk){ el("line", {x1:m.l, x2:W-m.r, y1:Y(t), y2:Y(t), class: t===0?"zero":"grid"}, svg); const tx = el("text", {x:m.l-8, y:Y(t)+4, class:"ytk", "text-anchor":"end"}, svg); tx.textContent = fmt(t); }
    const every = Math.ceil(n / Math.max(2, Math.floor((W-m.l-m.r)/40)));
    vals.forEach((v,i)=>{
      const x = m.l + i*slot + (slot-bw)/2, y0 = Y(0), y1 = Y(v), h = Math.abs(y1-y0), top = Math.min(y0,y1), r = Math.min(4, bw/2, h);
      const color = typeof o.color === "function" ? o.color(v,i) : (o.colors?.[i] || o.color || "var(--accent-text)");
      const d = v >= 0
        ? `M${x},${y0} V${top+r} Q${x},${top} ${x+r},${top} H${x+bw-r} Q${x+bw},${top} ${x+bw},${top+r} V${y0} Z`
        : `M${x},${y0} V${top+h-r} Q${x},${top+h} ${x+r},${top+h} H${x+bw-r} Q${x+bw},${top+h} ${x+bw},${top+h-r} V${y0} Z`;
      if(h > 0.5) el("path", {d, fill:color, class: o.highlight===i ? "bar hi" : "bar"}, svg);
      if(!(i%every) || i===n-1){ const tx = el("text", {x:x+bw/2, y:H-6, class:"xtk", "text-anchor":"middle"}, svg); tx.textContent = o.labels[i]; }
      const hit = el("rect", {x:m.l+i*slot, y:m.t, width:slot, height:H-m.t-m.b, fill:"transparent"}, svg);
      const show = e => showTip(`<b>${esc(o.labels[i])}</b><div>${esc(o.yName||"Value")}<span>${fmt(o.values[i])}</span></div>${o.note?`<small>${esc(o.note(i))}</small>`:""}`, e.clientX, e.clientY);
      hit.addEventListener("pointermove", show); hit.addEventListener("pointerdown", show); hit.addEventListener("pointerleave", hideTip);
    });
  });
}

/* ---------- horizontal bars (HTML) ---------- */
function hbars(host, o){
  const fmt = o.fmt || (v => (Math.round(v*10)/10).toString());
  const max = Math.max(...o.items.map(i=>Math.abs(i.value)), 0.001);
  host.innerHTML = `<div class="hbars">${o.items.map((it,i)=>`<div class="hb ${it.mine?"mine":""}" data-i="${i}"><span class="hl">${esc(it.label)}${it.sub?`<small>${esc(it.sub)}</small>`:""}</span><span class="ht"><i style="width:${Math.max(1.5,Math.abs(it.value)/max*100).toFixed(1)}%;background:${it.color||"var(--ink-3)"}"></i></span><span class="hv num">${fmt(it.value)}</span></div>`).join("")}</div>`;
  host.querySelectorAll(".hb").forEach(row => {
    const it = o.items[row.dataset.i]; if(!it.tip) return;
    row.addEventListener("pointermove", e => showTip(it.tip, e.clientX, e.clientY)); row.addEventListener("pointerleave", hideTip);
  });
}

/* ---------- sparkline ---------- */
function spark(values, o={}){
  const w = o.w || 96, h = o.h || 28, v = values.filter(x=>x!=null); if(v.length < 2) return "";
  const lo = Math.min(...v, o.ref ?? Infinity), hi = Math.max(...v, o.ref ?? -Infinity, lo+1);
  const X = i => 2 + i*(w-4)/(values.length-1), Y = x => 3 + (1-(x-lo)/(hi-lo))*(h-6);
  let d = ""; values.forEach((x,i)=>{ if(x!=null) d += `${d?"L":"M"}${X(i).toFixed(1)},${Y(x).toFixed(1)}`; });
  const li = values.length-1;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${o.ref!=null?`<line x1="2" x2="${w-2}" y1="${Y(o.ref)}" y2="${Y(o.ref)}" class="sref"/>`:""}<path d="${d}" fill="none" stroke="${o.color||"var(--accent-text)"}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>${values[li]!=null?`<circle cx="${X(li)}" cy="${Y(values[li])}" r="2.6" fill="${o.color||"var(--accent-text)"}"/>`:""}</svg>`;
}

window.PI_CHART = { line, bars, hbars, spark, showTip, hideTip, tableView };
})();
