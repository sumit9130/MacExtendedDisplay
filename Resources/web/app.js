/* MacDisplay app: layouts, themes, widgets. Keeps DOM work minimal: text is only
   written when it changes, charts only redraw when new data arrives, and polling
   is slow for layouts that don't need live numbers. */
(() => {
"use strict";

/* ------------------------------------------------------------------ helpers */
const $ = (s, r = document) => r.querySelector(s);
const p2 = n => String(n).padStart(2, "0");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/* Running inside the native app? Then settings live in the app (UserDefaults), not localStorage. */
const NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native);
const post = o => { try { if (NATIVE) window.webkit.messageHandlers.native.postMessage(o); } catch (e) {} };
const NS = NATIVE && window.__MD_STORE && typeof window.__MD_STORE === "object" ? window.__MD_STORE : null;
const store = {
  get(k, d) {
    if (NS) return Object.prototype.hasOwnProperty.call(NS, k) ? NS[k] : d;
    try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; }
  },
  set(k, v) {
    if (NS) { NS[k] = String(v); post({ cmd: "set", k, v: String(v) }); return; }
    try { localStorage.setItem(k, v); } catch (e) {}
  },
};
const jget = (k, d) => { try { const v = JSON.parse(store.get(k, "null")); return v == null ? d : v; } catch (e) { return d; } };
const setText = (el, v) => { if (el && el._v !== v) { el._v = v; el.textContent = v; } };
const setHTML = (el, v) => { if (el && el._h !== v) { el._h = v; el.innerHTML = v; } };
const refs = root => { const R = {}; root.querySelectorAll("[data-r]").forEach(el => { R[el.dataset.r] = el; }); return R; };
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmtB = b => b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(0) + " MB" : (b / 1e3).toFixed(0) + " KB";
const rate = b => b >= 1e6 ? [(b / 1e6).toFixed(1), "MB/s"] : [(b / 1e3).toFixed(0), "KB/s"];
const fmtUp = s => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
const weekNum = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / 864e5 + 1) / 7); };

/* ------------------------------------------------------------------ settings */
const DEFAULT_LOC = { name: "New Delhi, India", lat: 28.61, lon: 77.21 };   // placeholder until your location is found
const DEFAULT_ZONES = ["Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Asia/Dubai"];
const S = {
  theme: store.get("theme", "neon"), layout: store.get("layout", "dashboard"),
  h24: store.get("h24", "0") === "1", sec: store.get("sec", "1") === "1",
  anim: store.get("anim", "smooth"), scan: store.get("scan", "0") === "1",
  unit: store.get("unit", "c"), autoLoc: store.get("autoLoc", "1") === "1", loc: jget("loc", DEFAULT_LOC), zones: jget("zones", DEFAULT_ZONES),
  pomo: jget("pomo", [25, 5, 15]),
};
if (!["smooth", "eco", "off"].includes(S.anim)) S.anim = "smooth";

/* ------------------------------------------------------------------ themes */
const V = (bg1, bg2, fg, dim, a1, a2, glow, extra) => Object.assign({ bg1, bg2, fg, dim, a1, a2, card: "rgba(6,4,20,.32)", line: rgba(a1, .26), glow: glow || "none", gl: rgba(a1, .35) }, extra || {});
const THEMES = {
  neon:     { name: "Neon Night",    fx: "lava",    fxc: ["#ff2bd6", "#00f0ff", "#7a2bff"], v: V("#05010f", "#12002b", "#f4f0ff", "#8a7fb0", "#00f0ff", "#ff2bd6", "0 0 3vmin rgba(0,240,255,.1)") },
  aurora:   { name: "Aurora",        fx: "aurora",  fxc: ["#5dffb0", "#9b7bff"],            v: V("#020b0f", "#06222a", "#eafff6", "#6fa597", "#5dffb0", "#9b7bff") },
  synth:    { name: "Synthwave",     fx: "synth",   fxc: ["#ff3fa4", "#ffd166"],            v: V("#0d0221", "#2a0a4a", "#fff0fb", "#a98bc9", "#ff71ce", "#01cdfe") },
  terminal: { name: "Terminal",      fx: "matrix",  fxc: ["#2cff6b", "#c8ff2c"], mono: true, radius: "0.6vmin", v: V("#000000", "#001a06", "#b6ffc8", "#3f8f55", "#2cff6b", "#c8ff2c", "0 0 2vmin rgba(44,255,107,.12)", { card: "rgba(0,255,90,.04)", line: "rgba(44,255,107,.35)" }) },
  cosmos:   { name: "Cosmos",        fx: "stars",   fxc: ["#9ad1ff", "#c3a6ff"],            v: V("#02030a", "#0a1030", "#eef2ff", "#7f8ab8", "#9ad1ff", "#c3a6ff") },
  ocean:    { name: "Deep Ocean",    fx: "waves",   fxc: ["#4cc9ff", "#2a5bff"],            v: V("#020817", "#08294d", "#e6f3ff", "#7aa3c9", "#4cc9ff", "#7b8cff", "0 0 3vmin rgba(76,201,255,.1)") },
  sakura:   { name: "Sakura",        fx: "petals",  fxc: ["#ffb7d5", "#ff7eb6"],            v: V("#1a0b14", "#3a1530", "#fff0f6", "#c99ab3", "#ffb7d5", "#ff7eb6") },
  embers:   { name: "Embers",        fx: "embers",  fxc: ["#ffb347", "#ff4d2e"],            v: V("#0c0302", "#2a0a05", "#fff1e6", "#b98a78", "#ffb347", "#ff4d2e") },
  rain:     { name: "Rainfall",      fx: "rain",    fxc: ["#8fb8ff", "#bcd4ff"],            v: V("#070b12", "#121e30", "#e8f0ff", "#7f93b3", "#8fb8ff", "#6fd3c6") },
  snow:     { name: "Midnight Snow", fx: "snow",    fxc: ["#ffffff", "#cfe8ff"],            v: V("#050a14", "#0e1c33", "#f2f8ff", "#8aa3c4", "#cfe8ff", "#8fb8ff") },
  mono:     { name: "Mono",          fx: "none",    fxc: ["#ffffff", "#999999"],            v: V("#0b0b0c", "#0b0b0c", "#f2f2f2", "#777777", "#ffffff", "#9a9a9a", "none", { card: "rgba(255,255,255,.03)", line: "rgba(255,255,255,.14)" }) },
  paper:    { name: "Paper",         fx: "none",    fxc: ["#000000", "#555555"],            v: V("#f4efe6", "#ece4d4", "#1d1b18", "#8a8274", "#c2410c", "#1d1b18", "none", { card: "rgba(0,0,0,.035)", line: "rgba(0,0,0,.14)", gl: "rgba(0,0,0,0)" }) },
};
if (!THEMES[S.theme]) S.theme = "neon";
const SANS = "var(--sans)", MONO = "var(--mono)";
const col = n => THEMES[S.theme].v[n];

/* ------------------------------------------------------------------ shared data */
const D = { stats: null, np: null, wx: null, aqi: null, wxFail: false };
const HN = 90;
const H = { cpu: Array(HN).fill(0), down: Array(HN).fill(0), up: Array(HN).fill(0) };
const push = (a, v) => { a.push(v); a.shift(); };

/* ------------------------------------------------------------------ charts */
function spark(c, data, color, fixedMax) {
  if (!c) return;
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(devicePixelRatio || 1, 2), pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  const x = c.getContext("2d");
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  const n = data.length, max = fixedMax || Math.max(50e3, ...data), st = w / (n - 1);
  x.beginPath();
  for (let i = 0; i < n; i++) {
    const px = i * st, py = h - 2 - (data[i] / max) * (h - 5);
    if (i) x.lineTo(px, py); else x.moveTo(px, py);
  }
  x.strokeStyle = color; x.lineWidth = 2; x.lineJoin = "round"; x.stroke();
  x.lineTo(w, h); x.lineTo(0, h); x.closePath();
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, rgba(color, .35)); g.addColorStop(1, rgba(color, 0));
  x.fillStyle = g; x.fill();
}

const RC = 2 * Math.PI * 42;
function setRing(R, id, pct) {
  const el = R[id + "c"]; if (!el) return;
  const q = Math.round(Math.min(Math.max(pct, 0), 100));
  if (el._q === q) return;
  el._q = q;
  el.style.strokeDashoffset = RC * (1 - q / 100);
  setText(R[id + "n"], String(q));
}
function ringHTML(id, label) {
  return `<div class="card ring"><div class="rwrap"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="42"/><circle class="val" data-r="${id}c" cx="50" cy="50" r="42"/></svg><div class="num"><span data-r="${id}n">0</span><small>%</small></div></div><div class="label">${label}</div><div class="meta" data-r="${id}m">&nbsp;</div></div>`;
}
function setCoresV(el, arr) {
  if (!el) return;
  if (el.children.length !== arr.length) el.innerHTML = arr.map(() => "<i></i>").join("");
  for (let i = 0; i < arr.length; i++) {
    const c = el.children[i], q = Math.round(arr[i] / 2);
    if (c._q !== q) { c._q = q; c.style.transform = `scaleY(${Math.max(arr[i], 2) / 100})`; }
  }
}
function setCoresList(el, arr) {
  if (!el) return;
  if (el.children.length !== arr.length) el.innerHTML = arr.map((_, i) => `<div class="corerow"><span>C${i}</span><div class="tr"><i></i></div></div>`).join("");
  for (let i = 0; i < arr.length; i++) {
    const f = el.children[i].lastChild.firstChild, q = Math.round(arr[i] / 2);
    if (f._q !== q) { f._q = q; f.style.transform = `scaleX(${Math.max(arr[i], 2) / 100})`; }
  }
}
const procsHTML = list => (list || []).map(p => `<div class="proc"><span>${esc(p.name)}</span><span>${p.cpu}%</span><span>${p.mem}%</span></div>`).join("");
const batText = s => s.battery ? (s.battery.plugged ? "⚡ " : "🔋 ") + s.battery.percent + "%" + (!s.battery.plugged && s.battery.secs ? ` · ${Math.floor(s.battery.secs / 3600)}h ${p2(Math.floor(s.battery.secs % 3600 / 60))}m` : "") : "Power · AC";
const netText = s => s.wifi ? "Wi-Fi · " + s.wifi : s.ip ? "🌐 " + s.ip : "Offline";

function ringsFill(R, s) {
  setRing(R, "cpu", s.cpu); setRing(R, "ram", s.ram); setRing(R, "disk", s.disk); setRing(R, "swap", s.swap);
  setText(R.cpum, `${s.ncores} cores`);
  setText(R.ramm, `${fmtB(s.ram_used)} / ${fmtB(s.ram_total)}`);
  setText(R.diskm, `${fmtB(s.disk_free)} free`);
  setText(R.swapm, `${fmtB(s.swap_used)} used`);
}
function netFill(R, s) {
  const [dv, du] = rate(s.down), [uv, uu] = rate(s.up);
  setHTML(R.down, `${dv}<small>${du}</small>`); setHTML(R.up, `${uv}<small>${uu}</small>`);
  spark(R.sdown, H.down, col("a1")); spark(R.sup, H.up, col("a2"));
}
function footFill(R, s) {
  setHTML(R.host, `<b>${esc(s.host)}</b>`);
  setText(R.ip, netText(s)); setText(R.bat, batText(s));
  setHTML(R.uptime, `Up <b>${fmtUp(s.uptime)}</b>`);
  setText(R.nproc, `${s.nproc} processes`);
}

/* ------------------------------------------------------------------ clock bits */
const timeHTML = (cls = "lg") => `<div class="time ${cls}"><span class="hm" data-r="hm">--:--</span><span class="sec" data-r="ss"></span><span class="ampm" data-r="ap"></span></div>`;
function fmtClock(now) {
  let h = now.getHours(), ap = "";
  if (!S.h24) { ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; }
  return { hm: (S.h24 ? p2(h) : String(h)) + ":" + p2(now.getMinutes()), ss: S.sec ? p2(now.getSeconds()) : "", ap };
}
function clockTick(R, now) {
  const t = fmtClock(now);
  setText(R.hm, t.hm); setText(R.ss, t.ss); setText(R.ap, t.ap);
  setText(R.date, `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`);
  const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 864e5);
  setText(R.sub, `Week ${weekNum(now)} · Day ${doy}`);
  if (R.daybar) {
    const q = Math.round((now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86.4);
    if (R.daybar._q !== q) { R.daybar._q = q; R.daybar.style.transform = `scaleX(${q / 1000})`; }
  }
}
const hmText = iso => { const [h, m] = (iso.split("T")[1] || "0:0").split(":").map(Number); return S.h24 ? p2(h) + ":" + p2(m) : (h % 12 || 12) + ":" + p2(m) + (h >= 12 ? " PM" : " AM"); };

/* ------------------------------------------------------------------ weather */
function wmo(c, day = true) {
  if (c === 0) return [day ? "☀️" : "🌙", "Clear"];
  if (c === 1) return [day ? "🌤️" : "🌙", "Mostly clear"];
  if (c === 2) return [day ? "⛅" : "☁️", "Partly cloudy"];
  if (c === 3) return ["☁️", "Overcast"];
  if (c === 45 || c === 48) return ["🌫️", "Fog"];
  if (c >= 51 && c <= 57) return ["🌦️", "Drizzle"];
  if (c >= 61 && c <= 67) return ["🌧️", "Rain"];
  if (c >= 71 && c <= 77) return ["🌨️", "Snow"];
  if (c >= 80 && c <= 82) return ["🌦️", "Showers"];
  if (c === 85 || c === 86) return ["🌨️", "Snow showers"];
  if (c >= 95) return ["⛈️", "Thunderstorm"];
  return ["🌡️", "—"];
}
const tmp = c => (S.unit === "f" ? Math.round(c * 9 / 5 + 32) : Math.round(c)) + "°";
function aqiInfo(v) {
  if (v == null) return null;
  const L = [[50, "Good", "#3ecf6e"], [100, "Moderate", "#f2c94c"], [150, "Sensitive", "#f2994a"], [200, "Unhealthy", "#eb5757"], [300, "Very unhealthy", "#a259d9"], [1e9, "Hazardous", "#8b1e3f"]];
  const r = L.find(x => v <= x[0]);
  return { v: Math.round(v), label: r[1], color: r[2] };
}
function wxInfo() {
  const j = D.wx;
  if (!j || !j.current || !j.daily) return null;
  const c = j.current, d = j.daily, [icon, desc] = wmo(c.weather_code, c.is_day !== 0);
  const days = [];
  for (let i = 1; i < d.time.length && i < 4; i++) {
    days.push({ d: new Date(d.time[i] + "T12:00:00").toLocaleDateString("en", { weekday: "short" }), icon: wmo(d.weather_code[i], true)[0], hi: tmp(d.temperature_2m_max[i]), lo: tmp(d.temperature_2m_min[i]) });
  }
  return { icon, desc, temp: tmp(c.temperature_2m), feels: tmp(c.apparent_temperature), hum: Math.round(c.relative_humidity_2m), wind: Math.round(c.wind_speed_10m),
    hi: tmp(d.temperature_2m_max[0]), lo: tmp(d.temperature_2m_min[0]), rise: hmText(d.sunrise[0]), set: hmText(d.sunset[0]), days,
    aqi: aqiInfo(D.aqi && D.aqi.us_aqi) };
}
const wxCardHTML = () => `<div class="card wx"><div class="label">Weather · <span data-r="wxloc"></span></div><div class="wxmain"><span class="wxicon" data-r="wxicon">…</span><span class="wxtemp" data-r="wxtemp">--</span><span class="wxdesc" data-r="wxdesc"></span></div><div class="wxmeta" data-r="wxmeta"></div></div>`;
function wxFill(R) {
  const w = wxInfo();
  setText(R.wxloc, S.loc.name);
  if (!w) {
    setText(R.wxicon, "…"); setText(R.wxtemp, "--"); setText(R.wxdesc, D.wxFail ? "Weather unavailable (offline?)" : "Loading…");
    setHTML(R.wxmeta, ""); setText(R.chipwx, "Weather —"); setHTML(R.fc, "");
    return;
  }
  setText(R.wxicon, w.icon); setText(R.wxtemp, w.temp); setText(R.wxdesc, w.desc);
  const aq = w.aqi ? ` · <span class="aqi" style="background:${w.aqi.color}"></span>AQI ${w.aqi.v} ${w.aqi.label}` : "";
  setHTML(R.wxmeta, `Feels ${w.feels} · H ${w.hi} · L ${w.lo} · 💧 ${w.hum}% · 💨 ${w.wind} km/h<br>🌅 ${w.rise} · 🌇 ${w.set}${aq}`);
  setText(R.chipwx, `${w.icon} ${w.temp} · ${w.desc}`);
  setHTML(R.fc, w.days.map(d => `<div class="fcd"><div class="t">${d.d}</div><div class="ic">${d.icon}</div><div>${d.hi} <span class="t">${d.lo}</span></div></div>`).join(""));
}
let wxTimer = 0;
async function loadWx() {
  clearTimeout(wxTimer);
  const { lat, lon } = S.loc;
  let ok = false;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto&forecast_days=4`);
    if (!r.ok) throw new Error("wx");
    D.wx = await r.json(); ok = true; D.wxFail = false;
  } catch (e) { D.wxFail = !D.wx; }
  try {
    const r = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi`);
    if (r.ok) D.aqi = (await r.json()).current;
  } catch (e) {}
  if (cur && cur.wx) cur.wx();
  wxTimer = setTimeout(loadWx, ok ? 15 * 60e3 : 60e3);
}

/* ------------------------------------------------------------------ now playing */
const npCardHTML = () => `<div class="card np"><div class="label">Now playing</div><div class="npbody"><div class="eq" data-r="eq"><i></i><i></i><i></i><i></i></div><div class="nptxt"><div class="nptitle" data-r="nptitle">Nothing playing</div><div class="npartist" data-r="npartist"></div></div></div></div>`;
function npFill(R) {
  const n = D.np;
  setText(R.nptitle, n ? n.title : "Nothing playing");
  setText(R.npartist, n ? `${n.artist} · ${n.app}` : "Play something in Music or Spotify");
  if (R.eq) R.eq.classList.toggle("on", !!n);
}
let npTimer = 0;
async function pollNp() {
  clearTimeout(npTimer);
  if (cur && cur.np && !document.hidden) {
    try { const r = await fetch("/api/nowplaying", { cache: "no-store" }); D.np = await r.json(); cur.np(); } catch (e) {}
  }
  npTimer = setTimeout(pollNp, D.np ? 5000 : 10000);
}

/* ------------------------------------------------------------------ pomodoro (global so it keeps running) */
const PO = { phase: "focus", running: false, remain: S.pomo[0] * 60, endsAt: 0, count: 0 };
const poDur = ph => (ph === "focus" ? S.pomo[0] : ph === "short" ? S.pomo[1] : S.pomo[2]) * 60;
let AC = null;
function audioInit() { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume(); } catch (e) {} }
function chime() {
  if (!AC) return;
  [0, .28, .56].forEach((d, i) => {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = "sine"; o.frequency.value = i === 2 ? 1175 : 880;
    g.gain.setValueAtTime(0, AC.currentTime + d); g.gain.linearRampToValueAtTime(.18, AC.currentTime + d + .02); g.gain.exponentialRampToValueAtTime(.001, AC.currentTime + d + .25);
    o.connect(g); g.connect(AC.destination); o.start(AC.currentTime + d); o.stop(AC.currentTime + d + .3);
  });
}
function poNext(completed) {
  if (PO.phase === "focus") { if (completed) PO.count++; PO.phase = PO.count > 0 && PO.count % 4 === 0 && completed ? "long" : "short"; } else PO.phase = "focus";
  PO.running = false; PO.remain = poDur(PO.phase);
}
function poToggle() {
  if (PO.running) { PO.remain = Math.max(0, Math.ceil((PO.endsAt - Date.now()) / 1000)); PO.running = false; }
  else { audioInit(); PO.endsAt = Date.now() + PO.remain * 1000; PO.running = true; }
  poRender();
}
function poReset() { PO.running = false; PO.remain = poDur(PO.phase); poRender(); }
function poSkip() { poNext(false); poRender(); }
function poTick() {
  if (!PO.running) return;
  const r = Math.ceil((PO.endsAt - Date.now()) / 1000);
  PO.remain = Math.max(r, 0);
  if (r <= 0) {
    chime();
    const was = PO.phase;
    poNext(true);
    toast(was === "focus" ? "Focus session done. Time for a break." : "Break over. Ready to focus?");
  }
}
function poRender() { if (cur && cur.id === "focus") cur.poRender(cur.R); }

/* ------------------------------------------------------------------ layouts */
const LAYOUTS = {};
const ORDER = ["dashboard", "clock", "analog", "monitor", "focus", "world", "ambient"];
const def = (id, o) => { LAYOUTS[id] = Object.assign({ id, every: 15000, need: "" }, o); };

def("dashboard", {
  name: "Dashboard", every: 1000, need: "procs=5&cores=1", np: () => npFill(LAYOUTS.dashboard.R), wx: () => wxFill(LAYOUTS.dashboard.R),
  html: () => `
    <div class="col c1">
      <div class="card clock">${timeHTML("lg")}<div class="date" data-r="date"></div><div class="sub" data-r="sub"></div><div class="daybar"><i data-r="daybar"></i></div></div>
      <div class="row2">${wxCardHTML()}${npCardHTML()}</div>
      <div class="row2">
        <div class="card"><div class="label"><span class="arrow">↓</span> Download</div><div class="big" data-r="down">0<small>KB/s</small></div><canvas class="spark" data-r="sdown"></canvas></div>
        <div class="card"><div class="label"><span class="arrow up">↑</span> Upload</div><div class="big" data-r="up">0<small>KB/s</small></div><canvas class="spark" data-r="sup"></canvas></div>
      </div>
    </div>
    <div class="col c2">
      <div class="rings">${ringHTML("cpu", "CPU")}${ringHTML("ram", "Memory")}${ringHTML("disk", "Disk")}</div>
      <div class="card"><div class="label">CPU cores</div><div class="cores" data-r="cores"></div></div>
      <div class="card"><div class="hdr"><span>Top processes</span><span>CPU</span><span>MEM</span></div><div class="procs" data-r="procs"></div></div>
      <div class="card foot"><span data-r="host"></span><span class="pill" data-r="ip"></span><span class="pill" data-r="bat"></span><span data-r="uptime"></span></div>
    </div>`,
  tick(now) { clockTick(this.R, now); },
  stats(s) { const R = this.R; ringsFill(R, s); setCoresV(R.cores, s.cores || []); setHTML(R.procs, procsHTML(s.procs)); netFill(R, s); footFill(R, s); },
});

def("clock", {
  name: "Big clock", every: 5000, wx: () => wxFill(LAYOUTS.clock.R),
  html: () => `<div class="clockwrap">${timeHTML("xl")}<div class="date" data-r="date"></div>
    <div class="chips"><span class="chip" data-r="chipwx">Weather —</span><span class="chip" data-r="chipbat"></span><span class="chip" data-r="chipcpu"></span></div>
    <div class="chips"><div class="fc" data-r="fc"></div></div></div>`,
  tick(now) { clockTick(this.R, now); },
  stats(s) { setText(this.R.chipbat, batText(s)); setText(this.R.chipcpu, `CPU ${Math.round(s.cpu)}% · RAM ${Math.round(s.ram)}%`); },
});

function analogSVG() {
  let s = '<svg class="analog" viewBox="0 0 200 200"><circle class="face" cx="100" cy="100" r="98"/>';
  for (let i = 0; i < 60; i++) {
    const a = i * Math.PI / 30, maj = i % 5 === 0, r1 = maj ? 85 : 91, r2 = 95;
    s += `<line class="tick${maj ? " maj" : ""}" x1="${(100 + Math.sin(a) * r1).toFixed(2)}" y1="${(100 - Math.cos(a) * r1).toFixed(2)}" x2="${(100 + Math.sin(a) * r2).toFixed(2)}" y2="${(100 - Math.cos(a) * r2).toFixed(2)}"/>`;
  }
  for (let n = 1; n <= 12; n++) { const a = n * Math.PI / 6; s += `<text x="${(100 + Math.sin(a) * 71).toFixed(2)}" y="${(100 - Math.cos(a) * 71).toFixed(2)}">${n}</text>`; }
  return s + '<line class="hand h" data-r="hh" x1="100" y1="108" x2="100" y2="54"/><line class="hand m" data-r="mh" x1="100" y1="110" x2="100" y2="32"/><line class="hand s" data-r="sh" x1="100" y1="116" x2="100" y2="22"/><circle class="cap" cx="100" cy="100" r="3.6"/></svg>';
}
function calHTML(now) {
  const y = now.getFullYear(), m = now.getMonth(), first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  let h = ["S", "M", "T", "W", "T", "F", "S"].map(d => `<div class="h">${d}</div>`).join("");
  for (let i = 0; i < first; i++) h += "<div></div>";
  for (let d = 1; d <= days; d++) h += `<div class="d${d === now.getDate() ? " today" : ""}">${d}</div>`;
  return h;
}
def("analog", {
  name: "Analog + calendar", every: 15000, wx: () => wxFill(LAYOUTS.analog.R),
  html: () => `<div class="analogwrap">${analogSVG()}</div>
    <div class="col c2">
      <div class="card"><div class="date lg" data-r="date"></div><div class="sub" data-r="sub"></div></div>
      ${wxCardHTML()}
      <div class="card"><div class="label" data-r="calmonth"></div><div class="calgrid" data-r="cal"></div></div>
    </div>`,
  tick(now) {
    const R = this.R, h = now.getHours() % 12, m = now.getMinutes(), s = now.getSeconds();
    R.hh.setAttribute("transform", `rotate(${(h + m / 60) * 30} 100 100)`);
    R.mh.setAttribute("transform", `rotate(${(m + s / 60) * 6} 100 100)`);
    R.sh.setAttribute("transform", `rotate(${s * 6} 100 100)`);
    R.sh.style.display = S.sec ? "" : "none";
    clockTick(R, now);
    setText(R.calmonth, `${MONTHS[now.getMonth()]} ${now.getFullYear()}`);
    setHTML(R.cal, calHTML(now));
  },
});

def("monitor", {
  name: "System monitor", every: 1000, need: "procs=10&cores=1",
  html: () => `
    <div class="mon-top"><div class="l">${timeHTML("sm")}<div class="date" style="font-size:3vmin" data-r="date"></div></div>
      <div class="pills"><span class="pill" data-r="host"></span><span class="pill" data-r="ip"></span><span class="pill" data-r="bat"></span><span class="pill" data-r="uptime"></span><span class="pill" data-r="nproc"></span></div></div>
    <div class="mon-main">
      <div class="col mon-a">${ringHTML("cpu", "CPU")}${ringHTML("ram", "Memory")}${ringHTML("disk", "Disk")}${ringHTML("swap", "Swap")}</div>
      <div class="col mon-b">
        <div class="card"><div class="label">CPU cores</div><div class="corelist" data-r="corelist"></div></div>
        <div class="card"><div class="label">CPU history · load <span data-r="load"></span></div><div class="chartbox"><canvas class="spark tall" data-r="scpu"></canvas></div></div>
      </div>
      <div class="col mon-c">
        <div class="card"><div class="label"><span class="arrow">↓</span> Download <b style="color:var(--fg)" data-r="downl"></b></div><div class="chartbox"><canvas class="spark tall" data-r="sdown"></canvas></div></div>
        <div class="card"><div class="label"><span class="arrow up">↑</span> Upload <b style="color:var(--fg)" data-r="upl"></b></div><div class="chartbox"><canvas class="spark tall" data-r="sup"></canvas></div></div>
        <div class="card"><div class="hdr"><span>Top processes</span><span>CPU</span><span>MEM</span></div><div class="procs" data-r="procs"></div></div>
      </div>
    </div>`,
  tick(now) { clockTick(this.R, now); },
  stats(s) {
    const R = this.R;
    ringsFill(R, s); setCoresList(R.corelist, s.cores || []); setHTML(R.procs, procsHTML(s.procs));
    setText(R.load, s.load.join(" · "));
    spark(R.scpu, H.cpu, col("a1"), 100); spark(R.sdown, H.down, col("a1")); spark(R.sup, H.up, col("a2"));
    setText(R.downl, rate(s.down).join(" ")); setText(R.upl, rate(s.up).join(" "));
    setText(R.host, s.host); setText(R.ip, netText(s)); setText(R.bat, batText(s)); setText(R.uptime, "Up " + fmtUp(s.uptime)); setText(R.nproc, `${s.nproc} processes`);
  },
});

const FOC_C = 2 * Math.PI * 46;
def("focus", {
  name: "Focus timer", every: 15000, wx: () => wxFill(LAYOUTS.focus.R),
  html: () => `
    <div class="foc-top"><div>${timeHTML("sm")}<div class="date" data-r="date"></div></div><div class="chip" data-r="chipwx">Weather —</div></div>
    <div class="foc-main"><div class="pomo"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="46"/><circle class="val" data-r="pc" cx="50" cy="50" r="46"/></svg>
      <div class="pcenter"><div class="label" data-r="pphase"></div><div class="ptime" data-r="ptime"></div><div class="psub" data-r="psub"></div></div></div></div>
    <div class="foc-bottom"><button class="btn on" data-act="po-toggle" data-r="pbtn">Start</button><button class="btn" data-act="po-reset">Reset</button><button class="btn" data-act="po-skip">Skip</button><div class="dots" data-r="dots"></div>
      <div class="hint">Space start / pause · R reset · N skip · P set lengths</div></div>`,
  init(R) { R.pc.style.strokeDasharray = FOC_C; this.poRender(R); },
  poRender(R) {
    const dur = poDur(PO.phase), rem = PO.remain;
    setText(R.ptime, p2(Math.floor(rem / 60)) + ":" + p2(rem % 60));
    setText(R.pphase, PO.phase === "focus" ? "Focus" : PO.phase === "short" ? "Short break" : "Long break");
    const off = FOC_C * (1 - rem / dur);
    if (R.pc._o !== off) { R.pc._o = off; R.pc.style.strokeDashoffset = off; }
    setText(R.psub, PO.phase === "focus" ? `Session ${PO.count % 4 + 1} of 4 · ${PO.running ? "running" : "paused"}` : `Take a breather · ${PO.running ? "running" : "paused"}`);
    setText(R.pbtn, PO.running ? "Pause" : "Start");
    const n = PO.count % 4 || (PO.count > 0 && PO.phase === "long" ? 4 : 0);
    setHTML(R.dots, [0, 1, 2, 3].map(i => `<i class="${i < n ? "f" : ""}"></i>`).join(""));
  },
  tick(now) { clockTick(this.R, now); this.poRender(this.R); },
});

const cityOf = z => z.split("/").pop().replace(/_/g, " ");
def("world", {
  name: "World clocks", every: 15000,
  html: () => `<div class="world-top"><div class="label">World time</div>${timeHTML("sm")}</div>
    <div class="world-grid">${S.zones.map((z, i) => `<div class="card wc"><div class="city"><span>${esc(cityOf(z))}</span><span data-r="wi${i}">☀️</span></div>
      <div class="wt"><span data-r="wt${i}">--:--</span><small data-r="wa${i}"></small></div>
      <div><div class="meta"><span data-r="wd${i}"></span><span data-r="wo${i}"></span></div><div class="bar"><i data-r="wb${i}"></i></div></div></div>`).join("")}</div>`,
  init() {
    const mk = z => new Intl.DateTimeFormat("en-GB", { timeZone: z, hourCycle: "h23", hour: "numeric", minute: "numeric", year: "numeric", month: "numeric", day: "numeric" });
    const mo = z => new Intl.DateTimeFormat("en", { timeZone: z, timeZoneName: "shortOffset" });
    this.f = S.zones.map(mk); this.o = S.zones.map(mo);
  },
  tick(now) {
    const R = this.R, local = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    clockTick(R, now);
    this.f.forEach((f, i) => {
      const p = {}; for (const x of f.formatToParts(now)) p[x.type] = x.value;
      const h = +p.hour, m = +p.minute, key = (+p.year) * 10000 + (+p.month) * 100 + (+p.day);
      setText(R["wt" + i], S.h24 ? p2(h) + ":" + p2(m) : (h % 12 || 12) + ":" + p2(m));
      setText(R["wa" + i], S.h24 ? "" : (h >= 12 ? "PM" : "AM"));
      setText(R["wi" + i], h >= 6 && h < 18 ? "☀️" : "🌙");
      setText(R["wd" + i], key > local ? "Tomorrow" : key < local ? "Yesterday" : "Today");
      const off = (this.o[i].formatToParts(now).find(x => x.type === "timeZoneName") || {}).value || "";
      setText(R["wo" + i], off.replace("GMT", "UTC").replace(/^UTC$/, "UTC±0"));
      const b = R["wb" + i], pos = ((h + m / 60) / 24 * 100).toFixed(1) + "%";
      if (b._p !== pos) { b._p = pos; b.style.left = pos; }
    });
  },
});

def("ambient", {
  name: "Ambient", every: 15000, wx() { wxFill(this.R); },
  html: () => `<div class="amb" data-r="amb">${timeHTML("xl")}<div class="date" data-r="date"></div><div class="chips"><span class="chip" data-r="chipwx">Weather —</span></div></div>`,
  tick(now) {
    const R = this.R;
    clockTick(R, now);
    if (now.getSeconds() === 0 && now.getMinutes() % 2 === 0) {      // slow drift = no screen burn-in
      R.amb.style.transform = `translate(${(Math.random() * 24 - 12).toFixed(1)}vmin, ${(Math.random() * 16 - 8).toFixed(1)}vmin)`;
    }
  },
});

/* ------------------------------------------------------------------ app core */
const stage = $("#stage");
let cur = null;

function mount(L) {
  cur = L;
  stage.className = "lay lay-" + L.id;
  stage.innerHTML = L.html();
  L.R = refs(stage);
  stage.querySelectorAll(".ring .val").forEach(c => { c.style.strokeDasharray = RC; c.style.strokeDashoffset = RC; });
  if (L.init) L.init(L.R);
  if (L.tick) L.tick(new Date());
  if (D.stats && L.stats) L.stats(D.stats);
  if (L.wx) L.wx();
  if (L.np) { L.np(); pollNp(); }
  pollStats();
}
function setLayout(id, announce) {
  if (!LAYOUTS[id]) id = "dashboard";
  S.layout = id; store.set("layout", id);
  mount(LAYOUTS[id]);
  if (announce) toast(LAYOUTS[id].name);
}
function applyTheme(id, announce) {
  if (!THEMES[id]) id = "neon";
  S.theme = id; store.set("theme", id);
  const T = THEMES[id], st = document.documentElement.style;
  for (const k in T.v) st.setProperty("--" + k, T.v[k]);
  st.setProperty("--font", T.mono ? MONO : SANS);
  st.setProperty("--radius", T.radius || "2.2vmin");
  document.documentElement.dataset.theme = id;
  FX.set(T.fx, T.fxc, effLevel());
  if (announce) toast(T.name);
  if (cur && D.stats && cur.stats) cur.stats(D.stats);
}
function effLevel() {
  const b = D.stats && D.stats.battery;
  return S.anim === "smooth" && b && !b.plugged ? "eco" : S.anim;   // calmer on battery
}

/* stats polling: slow for layouts that don't need live numbers */
let sT = 0, fails = 0;
async function pollStats() {
  clearTimeout(sT);
  const L = cur;
  if (document.hidden) { sT = setTimeout(pollStats, 2000); return; }
  try {
    const r = await fetch("/api/stats?" + (L.need || ""), { cache: "no-store" });
    const s = await r.json();
    fails = 0; $("#offline").classList.remove("show");
    D.stats = s; push(H.cpu, s.cpu); push(H.down, s.down); push(H.up, s.up);
    if (L === cur && L.stats) L.stats(s);
    FX.setLevel(effLevel());
  } catch (e) { if (++fails >= 3) $("#offline").classList.add("show"); }
  if (L === cur) sT = setTimeout(pollStats, L.every);
}

/* one tick per second, aligned to the second boundary */
let lastMin = "";
function tickLoop() {
  const now = new Date();
  poTick();
  if (!document.hidden) {
    cur.tick && cur.tick(now);
    const t = fmtClock(now), mn = t.hm + t.ap;
    if (mn !== lastMin || PO.running) {
      lastMin = mn;
      document.title = PO.running ? `⏱ ${p2(Math.floor(PO.remain / 60))}:${p2(PO.remain % 60)}` : `${t.hm} ${t.ap}`.trim();
    }
  }
  setTimeout(tickLoop, 1000 - now.getMilliseconds() + 4);
}

/* ------------------------------------------------------------------ ui chrome */
let toastT = 0;
function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 1600);
}
let idleT = 0;
function wake() { document.body.classList.remove("idle"); clearTimeout(idleT); idleT = setTimeout(() => document.body.classList.add("idle"), 3000); }

const menu = $("#menu"), panel = $("#panel");
function buildMenu() {
  const lays = ORDER.map((id, i) => `<button class="mb ${id === S.layout ? "on" : ""}" data-lay="${id}">${i + 1} · ${LAYOUTS[id].name}</button>`).join("");
  const themes = Object.entries(THEMES).map(([id, t]) => `<button class="mb tchip ${id === S.theme ? "on" : ""}" data-theme="${id}"><span class="sw" style="background:linear-gradient(135deg,${t.v.a1},${t.v.a2})"></span>${t.name}</button>`).join("");
  const anim = [["smooth", "Smooth (12–20 fps)"], ["eco", "Eco (half the frames)"], ["off", "Still (no animation)"]].map(([k, n]) => `<button class="mb ${S.anim === k ? "on" : ""}" data-anim="${k}">${n}</button>`).join("");
  const on = v => (v ? "on" : "");
  panel.innerHTML = `<h3>Display layout</h3><div class="mrow">${lays}</div>
    <h3>Theme</h3><div class="mrow">${themes}</div>
    <h3>Animation · CPU use</h3><div class="mrow">${anim}</div>
    <h3>Options</h3><div class="mrow">
      <button class="mb ${on(S.h24)}" data-opt="h24">24-hour clock</button><button class="mb ${on(S.sec)}" data-opt="sec">Seconds</button>
      <button class="mb ${on(S.scan)}" data-opt="scan">Scanlines</button><button class="mb" data-opt="unit">Temperature: ${S.unit === "c" ? "°C" : "°F"}</button></div>
    <h3>Set up</h3><div class="mrow"><button class="mb ${on(S.autoLoc)}" data-act="loc">📍 Use my location</button><button class="mb" data-act="city">Weather city…</button><button class="mb" data-act="zones">World clock cities…</button><button class="mb" data-act="plen">Focus timer lengths…</button><button class="mb" data-act="fs">Fullscreen</button></div>
    <p class="mhint">Keys: T or ← → theme · D or ↑ ↓ or 1–7 layout · F fullscreen · H 12/24 h · S seconds · E animation · U °C/°F · C city · W world cities · P timer lengths · Space / R / N control the focus timer · L scanlines · Esc close.<br>Animation pauses on its own when this window is hidden or covered, and drops to Eco while your Mac runs on battery.</p>`;
}
const menuOpen = () => menu.classList.contains("open");
function openMenu() { buildMenu(); menu.classList.add("open"); }
function closeMenu() { menu.classList.remove("open"); }

function applyOpt(k) {
  if (k === "h24") { S.h24 = !S.h24; store.set("h24", S.h24 ? "1" : "0"); toast(S.h24 ? "24-hour" : "12-hour"); }
  else if (k === "sec") { S.sec = !S.sec; store.set("sec", S.sec ? "1" : "0"); }
  else if (k === "scan") { S.scan = !S.scan; store.set("scan", S.scan ? "1" : "0"); document.body.classList.toggle("scan", S.scan); toast(S.scan ? "Scanlines on" : "Scanlines off"); }
  else if (k === "unit") { S.unit = S.unit === "c" ? "f" : "c"; store.set("unit", S.unit); toast(S.unit === "c" ? "Celsius" : "Fahrenheit"); }
  mount(cur);
}
function setAnim(lv, announce) {
  S.anim = lv; store.set("anim", lv); FX.setLevel(effLevel());
  if (announce) toast({ smooth: "Animation: smooth", eco: "Animation: eco", off: "Animation: still" }[lv]);
}
/* ---- in-page dialog (window.prompt is blocked in fullscreen and in some browsers) ---- */
const dlg = $("#dlg"), dlgp = $("#dlgp");
const dlgOpen = () => dlg.classList.contains("open");
function closeDlg() { dlg.classList.remove("open"); dlgp.innerHTML = ""; }
function dialog(o) {
  dlgp.innerHTML = `<h3>${esc(o.title)}</h3><form id="dform" autocomplete="off"><input id="din" class="din" type="text" value="${esc(o.value || "")}" spellcheck="false" placeholder="${esc(o.placeholder || "")}">
    <div class="derr" id="derr"></div><div class="dres" id="dres"></div>
    <div class="mrow" style="margin-top:14px"><button class="mb on" type="submit">${esc(o.button || "Save")}</button>${o.extra ? `<button class="mb" type="button" id="dextra">${esc(o.extra.label)}</button>` : ""}<button class="mb" type="button" id="dcancel">Cancel</button></div></form>
    <p class="mhint">${o.hint || ""}</p>`;
  dlg.classList.add("open");
  const inp = $("#din"), err = m => { $("#derr").textContent = m || ""; };
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
  $("#dcancel").onclick = closeDlg;
  if (o.extra) $("#dextra").onclick = async () => {
    err("Locating…");
    const ok = await o.extra.fn();
    if (ok) closeDlg(); else if (ok === false) err("Couldn't get your location. Check Location Services permission, or search for a city.");
  };
  $("#dform").onsubmit = async e => {
    e.preventDefault(); err(""); $("#dres").innerHTML = "";
    const r = await o.submit(inp.value.trim(), err, $("#dres"));
    if (r === true) closeDlg();
  };
}
/* ---- automatic location: Location Services (app) or browser geolocation, then IP lookup ---- */
let locWait = null, locBusy = false;
function nativeLocate() {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { locWait = null; rej(new Error("timeout")); }, 25000);
    locWait = { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } };
    post({ cmd: "locate" });
  });
}
function browserLocate() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) { rej(new Error("unsupported")); return; }
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lon: p.coords.longitude, name: null }),
      e => rej(new Error((e && e.message) || "denied")), { timeout: 15000, maximumAge: 3600e3 });
  });
}
async function ipLocate() {
  const nm = j => [j.city, j.region || j.country].filter(Boolean).join(", ");
  try {
    const j = await (await fetch("https://ipwho.is/")).json();
    if (j && j.success !== false && j.latitude != null) return { lat: +j.latitude, lon: +j.longitude, name: nm(j) };
  } catch (e) {}
  const j = await (await fetch("https://get.geojs.io/v1/ip/geo.json")).json();
  if (j && j.latitude != null) return { lat: +j.latitude, lon: +j.longitude, name: nm(j) };
  throw new Error("no ip location");
}
async function reverseName(lat, lon) {
  try {
    const j = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`)).json();
    const n = [j.city || j.locality, j.principalSubdivision || j.countryName].filter(Boolean).join(", ");
    if (n) return n;
  } catch (e) {}
  return "Current location";
}
async function useMyLocation(announce) {
  if (locBusy) return undefined;
  locBusy = true;
  S.autoLoc = true; store.set("autoLoc", "1");
  let got = null, via = "";
  try { got = await (NATIVE ? nativeLocate() : browserLocate()); via = NATIVE ? "Location Services" : "browser location"; } catch (e) {}
  if (!got) { try { got = await ipLocate(); via = "IP address (approximate)"; } catch (e) {} }
  locBusy = false;
  if (!got) { if (announce) toast("Couldn't find your location. Check Location Services, or choose a city."); return false; }
  if (!got.name) got.name = await reverseName(got.lat, got.lon);
  const moved = Math.abs(got.lat - S.loc.lat) > 0.02 || Math.abs(got.lon - S.loc.lon) > 0.02 || got.name !== S.loc.name;
  S.loc = { name: got.name, lat: +(+got.lat).toFixed(4), lon: +(+got.lon).toFixed(4) };
  store.set("loc", JSON.stringify(S.loc));
  if (moved) { D.wx = null; D.aqi = null; if (cur && cur.R) wxFill(cur.R); loadWx(); }
  if (announce || moved) toast("Weather: " + S.loc.name + (announce ? " · via " + via : ""));
  return true;
}
function setCity(c) {
  S.autoLoc = false; store.set("autoLoc", "0");
  const region = c.admin1 && c.admin1 !== c.name ? c.admin1 : c.country;
  S.loc = { name: [c.name, region].filter(Boolean).join(", "), lat: c.latitude, lon: c.longitude };
  store.set("loc", JSON.stringify(S.loc)); D.wx = null; D.aqi = null;
  if (cur && cur.R) wxFill(cur.R);
  loadWx(); toast("Weather: " + S.loc.name);
}
function actCity() {
  dialog({
    title: "Weather city", value: "", placeholder: "Type a city, e.g. Delhi", button: "Search",
    extra: { label: "📍 Use my location", fn: () => useMyLocation(true) },
    hint: "Now showing: " + esc(S.loc.name) + (S.autoLoc ? " (automatic)" : "") + ". Type just the city name; add a state or country after a comma to narrow it (Delhi, India).",
    async submit(v, err, box) {
      if (!v) { err("Type a city name."); return false; }
      const parts = v.split(",").map(s => s.trim()).filter(Boolean), name = parts[0], rest = parts.slice(1).join(" ").toLowerCase();
      err("Searching…");
      let g;
      try {
        const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`);
        if (!r.ok) throw new Error("HTTP " + r.status);
        g = (await r.json()).results || [];
      } catch (e) { err("Can't reach the weather service. Check your internet connection and try again."); return false; }
      if (rest) { const f = g.filter(c => (`${c.admin1 || ""} ${c.country || ""} ${c.country_code || ""}`).toLowerCase().includes(rest)); if (f.length) g = f; }
      if (!g.length) { err(`No city found for "${name}". Try a nearby bigger city or check the spelling.`); return false; }
      if (g.length === 1) { setCity(g[0]); return true; }
      err("Pick one:");
      box.innerHTML = g.slice(0, 6).map((c, i) => `<button type="button" class="mb" data-i="${i}">${esc([c.name, c.admin1 !== c.name ? c.admin1 : "", c.country].filter(Boolean).join(", "))}</button>`).join("");
      box.onclick = e => { const b = e.target.closest("button"); if (b) { setCity(g[+b.dataset.i]); closeDlg(); } };
      return false;
    },
  });
}
function actZones() {
  dialog({
    title: "World clock cities", value: S.zones.join(", "), button: "Save",
    hint: "Time-zone names separated by commas, up to 9. Examples: Asia/Kolkata, Europe/Paris, America/Chicago, Australia/Sydney, Asia/Singapore.",
    submit(v, err) {
      const all = v.split(",").map(s => s.trim()).filter(Boolean), bad = [], ok = [];
      for (const z of all) { try { new Intl.DateTimeFormat("en", { timeZone: z }); ok.push(z); } catch (e) { bad.push(z); } }
      if (bad.length) { err("Not a valid time zone: " + bad.join(", ") + ". Use the Region/City form, like Asia/Tokyo."); return false; }
      if (!ok.length) { err("Enter at least one time zone."); return false; }
      S.zones = ok.slice(0, 9); store.set("zones", JSON.stringify(S.zones));
      if (cur.id === "world") mount(cur); else toast("Saved. Open layout 6 to see them.");
      return true;
    },
  });
}
function actPlen() {
  dialog({
    title: "Focus timer lengths (minutes)", value: S.pomo.join(", "), button: "Save",
    hint: "Focus, short break, long break. Default: 25, 5, 15.",
    submit(v, err) {
      const a = v.split(",").map(s => Math.round(parseFloat(s)));
      if (a.length !== 3 || a.some(n => !(n > 0 && n < 300))) { err("Enter three numbers between 1 and 299, like 25, 5, 15."); return false; }
      S.pomo = a; store.set("pomo", JSON.stringify(a)); poReset();
      return true;
    },
  });
}
const toggleFS = () => { if (NATIVE) { post({ cmd: "fullscreen" }); return; } document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}); };
function action(a) {
  if (a === "loc") useMyLocation(true); else if (a === "city") actCity(); else if (a === "zones") actZones(); else if (a === "plen") actPlen(); else if (a === "fs") toggleFS();
  else if (a === "po-toggle") poToggle(); else if (a === "po-reset") poReset(); else if (a === "po-skip") poSkip();
}
const cycle = (list, key, d) => list[(list.indexOf(key) + d + list.length) % list.length];

panel.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const d = b.dataset;
  if (d.lay) setLayout(d.lay, false);
  else if (d.theme) applyTheme(d.theme, false);
  else if (d.anim) setAnim(d.anim, false);
  else if (d.opt) applyOpt(d.opt);
  else if (d.act) { closeMenu(); setTimeout(() => action(d.act), 60); return; }
  buildMenu();
});
menu.addEventListener("click", e => { if (e.target === menu) closeMenu(); });
dlg.addEventListener("click", e => { if (e.target === dlg) closeDlg(); });
$("#gear").addEventListener("click", () => (menuOpen() ? closeMenu() : openMenu()));
stage.addEventListener("click", e => { const b = e.target.closest("[data-act]"); if (b) { action(b.dataset.act); b.blur(); } });
addEventListener("dblclick", e => { if (!e.target.closest("button") && !menuOpen()) toggleFS(); });
addEventListener("mousemove", wake);

addEventListener("keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  wake();
  const k = e.key.toLowerCase();
  if (k === "escape") { if (dlgOpen()) closeDlg(); else closeMenu(); return; }
  if (dlgOpen() || (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName))) return;
  if (k === "m") { menuOpen() ? closeMenu() : openMenu(); return; }
  if (menuOpen()) return;
  if (NATIVE && (k.length === 1 || k.startsWith("arrow"))) e.preventDefault();   // stop the system "beep" on unhandled keys
  const themeIds = Object.keys(THEMES);
  if (k === "t" || k === "arrowright") applyTheme(cycle(themeIds, S.theme, 1), true);
  else if (k === "arrowleft") applyTheme(cycle(themeIds, S.theme, -1), true);
  else if (k === "d" || k === "arrowdown") setLayout(cycle(ORDER, S.layout, 1), true);
  else if (k === "arrowup") setLayout(cycle(ORDER, S.layout, -1), true);
  else if (/^[1-7]$/.test(k)) setLayout(ORDER[+k - 1], true);
  else if (k === "f") toggleFS();
  else if (k === "h") applyOpt("h24");
  else if (k === "s") applyOpt("sec");
  else if (k === "l") applyOpt("scan");
  else if (k === "u") applyOpt("unit");
  else if (k === "e") setAnim(cycle(["smooth", "eco", "off"], S.anim, 1), true);
  else if (k === "c") actCity();
  else if (k === "w") actZones();
  else if (k === "p") actPlen();
  else if (k === " " && S.layout === "focus") { e.preventDefault(); poToggle(); }
  else if (k === "r" && S.layout === "focus") poReset();
  else if (k === "n" && S.layout === "focus") poSkip();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { cur.tick && cur.tick(new Date()); pollStats(); pollNp(); }
});

/* ------------------------------------------------------------------ boot */
document.body.classList.toggle("scan", S.scan);
applyTheme(S.theme, false);
setLayout(LAYOUTS[S.layout] ? S.layout : "dashboard", false);
tickLoop();
loadWx();
wake();
if (NATIVE) $("#offline").textContent = "System stats unavailable.";
if (S.autoLoc) setTimeout(() => useMyLocation(false), 700);
setInterval(() => { if (S.autoLoc && !document.hidden) useMyLocation(false); }, 3 * 3600e3);
if (store.get("hint1", "") !== "1") { store.set("hint1", "1"); setTimeout(() => toast("Press M for the menu · weather follows your location"), 1200); }
window.__md = { S, THEMES, LAYOUTS, setLayout, applyTheme, D };
/* called by the native menu bar */
window.MacDisplay = {
  setLayout: id => setLayout(id, true), applyTheme: id => applyTheme(id, true), setAnim: lv => setAnim(lv, true),
  nextTheme: d => applyTheme(cycle(Object.keys(THEMES), S.theme, d), true), nextLayout: d => setLayout(cycle(ORDER, S.layout, d), true),
  opt: k => applyOpt(k), useLocation: () => useMyLocation(true), chooseCity: () => actCity(), zones: () => actZones(), timer: () => actPlen(),
  menu: () => (menuOpen() ? closeMenu() : openMenu()),
  locResult: r => {
    if (!locWait) return;
    const w = locWait; locWait = null;
    if (r && r.ok) w.res({ lat: r.lat, lon: r.lon, name: r.name || null }); else w.rej(new Error((r && r.error) || "failed"));
  },
};
})();
