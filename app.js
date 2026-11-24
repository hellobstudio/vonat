'use strict';

// MÁV-Volán EMMA (OpenTripPlanner 2) GraphQL végpont. Vonat és Volánbusz is benne van.
// A MÁV szervere nem enged böngészőből hívást (nincs CORS), ezért a saját proxyn keresztül megy.
const MAV_API = 'https://mavplusz.hu/otp2-backend/otp/routers/default/index/graphql';
const DEFAULT_API = 'https://vonat-proxy.olajos-balazs.workers.dev/';
const STORAGE_KEY = 'vonat.settings.v1';
const REFRESH_MS = 60 * 1000;
const DAY_NAMES = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'];

const DEFAULTS = {
  from: { name: 'Monor', lat: 47.3513, lon: 19.4398, resolved: false },
  to: { name: 'Kőbánya-Kispest', lat: 47.4583, lon: 19.1489, resolved: false },
  start: '06:20',
  end: '07:30',
  modes: { rail: true, bus: true },
  days: [1, 2, 3, 4, 5],
  skipHolidays: true,
  directOnly: false,
  extraOff: '',
  extraWork: '',
  apiUrl: DEFAULT_API,
};

// ---------- beállítások ----------
function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = { ...DEFAULTS, ...JSON.parse(raw) };
      // Régi mentés a közvetlen MÁV címmel: az böngészőből nem működik, átállítjuk a proxyra.
      if (!s.apiUrl || s.apiUrl === MAV_API) s.apiUrl = DEFAULT_API;
      return s;
    }
  } catch (_) { /* privát mód stb. */ }
  return structuredClone(DEFAULTS);
}
function saveSettings(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (_) { /* ignore */ }
}
let settings = loadSettings();

// ---------- dátum segédek ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
function atTime(day, t) { const d = new Date(day); d.setHours(0, 0, 0, 0); d.setMinutes(toMin(t)); return d; }
const parseList = (s) => (s || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
const holidayCache = {};
function hungarianHolidays(y) {
  if (holidayCache[y]) return holidayCache[y];
  const fixed = ['01-01', '03-15', '05-01', '08-20', '10-23', '11-01', '12-24', '12-25', '12-26'].map((x) => `${y}-${x}`);
  const e = easterSunday(y);
  const rel = (n) => { const d = new Date(e); d.setDate(d.getDate() + n); return ymd(d); };
  // Nagypéntek, húsvéthétfő, pünkösdhétfő
  return (holidayCache[y] = new Set([...fixed, rel(-2), rel(1), rel(50)]));
}
function isServiceDay(d, s = settings) {
  const key = ymd(d);
  if (parseList(s.extraWork).includes(key)) return true;
  if (parseList(s.extraOff).includes(key)) return false;
  if (s.skipHolidays && hungarianHolidays(d.getFullYear()).has(key)) return false;
  return s.days.includes(d.getDay());
}
/** Ma, ha szolgálati nap és az ablak még nem ért véget; különben a következő ilyen nap. */
function targetDay(now = new Date(), s = settings) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  if (isServiceDay(d, s) && now <= atTime(d, s.end)) return d;
  for (let i = 1; i <= 21; i++) {
    const n = new Date(d); n.setDate(d.getDate() + i);
    if (isServiceDay(n, s)) return n;
  }
  return null;
}

// ---------- API ----------
async function gql(query, url = settings.apiUrl || DEFAULT_API) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors && json.errors.length && !json.data) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  return json.data;
}

async function searchStops(name) {
  const data = await gql(`{ stops(name: ${JSON.stringify(name)}) { gtfsId name lat lon vehicleMode parentStation { name lat lon } } }`);
  const seen = new Map();
  for (const s of data.stops || []) {
    const p = s.parentStation || s;
    const key = `${p.name}|${s.vehicleMode || ''}`;
    if (!seen.has(key)) seen.set(key, { name: p.name, lat: p.lat, lon: p.lon, mode: s.vehicleMode });
  }
  return [...seen.values()];
}

/** A beírt névhez legjobban illő megálló (vasútállomást preferálja, ha van vonat). */
async function resolvePlace(place) {
  const found = await searchStops(place.name);
  if (!found.length) throw new Error(`Nem található megálló: „${place.name}”`);
  const norm = (x) => x.toLocaleLowerCase('hu').trim();
  const exact = found.filter((f) => norm(f.name) === norm(place.name));
  const pool = exact.length ? exact : found;
  const pick = pool.find((f) => f.mode === 'RAIL') || pool[0];
  return { name: pick.name, lat: pick.lat, lon: pick.lon, resolved: true };
}

let coachSupported = true;
function modesLiteral(s) {
  const m = ['{mode: WALK}'];
  if (s.modes.rail) m.push('{mode: RAIL}');
  if (s.modes.bus) { m.push('{mode: BUS}'); if (coachSupported) m.push('{mode: COACH}'); }
  return `[${m.join(', ')}]`;
}

function planQuery(s, date, time, windowSec) {
  const c = (p) => `{lat: ${p.lat}, lon: ${p.lon}}`;
  return `{
    plan(from: ${c(s.from)}, to: ${c(s.to)}, date: "${date}", time: "${time}",
         transportModes: ${modesLiteral(s)}, numItineraries: 30, searchWindow: ${windowSec}) {
      itineraries {
        startTime endTime
        legs {
          mode transitLeg startTime endTime departureDelay arrivalDelay realTime realtimeState headsign
          from { name stop { platformCode } }
          to { name stop { platformCode } }
          route { shortName longName }
          trip { tripShortName tripHeadsign }
        }
      }
    }
  }`;
}

async function fetchDepartures(s, day) {
  const winStart = atTime(day, s.start);
  const winEnd = atTime(day, s.end);
  const results = new Map();
  let cursor = winStart;
  for (let page = 0; page < 5 && cursor <= winEnd; page++) {
    const windowSec = Math.max(60, Math.round((winEnd - cursor) / 1000) + 60);
    let data;
    try {
      data = await gql(planQuery(s, ymd(day), hm(cursor), windowSec));
    } catch (err) {
      if (coachSupported && /COACH/i.test(err.message)) { coachSupported = false; page--; continue; }
      throw err;
    }
    const its = (data.plan && data.plan.itineraries) || [];
    let latest = null;
    for (const it of its) {
      const dep = toDeparture(it, s);
      if (!dep) continue;
      const sched = new Date(dep.scheduled);
      if (sched < winStart || sched > winEnd) continue;
      const key = `${dep.name}|${dep.scheduled}`;
      if (!results.has(key) || results.get(key).arrival > dep.arrival) results.set(key, dep);
      if (!latest || sched > latest) latest = sched;
    }
    if (its.length < 30 || !latest) break; // elfogyott, nincs több lap
    cursor = new Date(latest.getTime() + 60000);
  }
  return [...results.values()].sort((a, b) => a.scheduled - b.scheduled);
}

function toDeparture(it, s) {
  const transit = it.legs.filter((l) => l.transitLeg);
  if (!transit.length) return null;
  if (s.directOnly && transit.length > 1) return null;
  const first = transit[0];
  const last = transit[transit.length - 1];
  const delayMin = Math.round((first.departureDelay || 0) / 60);
  const route = first.route || {};
  const trip = first.trip || {};
  const name = [route.shortName, trip.tripShortName].filter(Boolean).join(' ')
    || route.longName || (first.mode === 'RAIL' ? 'Vonat' : 'Busz');
  const walkBefore = it.legs.slice(0, it.legs.indexOf(first)).reduce((a, l) => a + (l.endTime - l.startTime), 0);
  return {
    mode: first.mode,
    name,
    headsign: first.headsign || trip.tripHeadsign || '',
    fromName: first.from.name,
    platform: first.from.stop && first.from.stop.platformCode,
    scheduled: first.startTime - (first.departureDelay || 0) * 1000,
    actual: first.startTime,
    arrival: last.endTime,
    delayMin,
    realTime: !!first.realTime,
    canceled: transit.some((l) => l.realtimeState === 'CANCELED'),
    transfers: transit.length - 1,
    walkMin: Math.round(walkBefore / 60000),
  };
}

// ---------- megjelenítés ----------
const $ = (id) => document.getElementById(id);
let lastDeps = [];
let lastDay = null;
let lastUpdated = null;

function setStatus(msg, kind) {
  const el = $('status');
  el.hidden = !msg;
  el.textContent = msg || '';
  el.className = `status ${kind || ''}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render() {
  const now = Date.now();
  $('title').textContent = `${settings.from.name} → ${settings.to.name}`;
  if (!lastDay) { $('subtitle').textContent = 'Nincs megfelelő nap a következő 3 hétben'; return; }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayLabel = lastDay.getTime() === today.getTime() ? 'Ma'
    : lastDay.getTime() === today.getTime() + 864e5 ? 'Holnap'
      : lastDay.toLocaleDateString('hu-HU', { weekday: 'long', month: 'long', day: 'numeric' });
  $('subtitle').textContent = `${dayLabel} · ${settings.start}–${settings.end}`;

  const list = $('list');
  if (!lastDeps.length) {
    list.innerHTML = '<li class="empty">Ebben az idősávban nincs járat.</li>';
  } else {
    let nextMarked = false;
    list.innerHTML = lastDeps.map((d) => {
      const gone = d.actual < now - 30000;
      const isNext = !gone && !d.canceled && !nextMarked;
      if (isNext) nextMarked = true;
      const sched = hm(new Date(d.scheduled));
      const actual = hm(new Date(d.actual));
      const timeHtml = d.delayMin > 0 ? `<s>${sched}</s>${actual}` : sched;
      let badge = '';
      if (d.canceled) badge = '<span class="badge cancel">Törölve</span>';
      else if (d.delayMin >= 5) badge = `<span class="badge verylate">+${d.delayMin} perc</span>`;
      else if (d.delayMin > 0) badge = `<span class="badge late">+${d.delayMin} perc</span>`;
      else if (d.realTime) badge = '<span class="badge ok">Pontos</span>';
      const mins = Math.round((d.actual - now) / 60000);
      const countdown = gone ? 'elment' : mins <= 0 ? 'most' : mins < 60 ? `${mins} perc` : '';
      const icon = d.mode === 'RAIL' ? '🚆' : '🚌';
      const sub = [
        `érk. ${hm(new Date(d.arrival))}`,
        d.platform ? `${d.platform}. vágány` : '',
        d.transfers ? `${d.transfers} átszállás` : '',
        d.walkMin ? `${d.walkMin} perc séta: ${d.fromName}` : '',
      ].filter(Boolean).join(' · ');
      return `<li class="item${gone ? ' gone' : ''}${isNext ? ' next' : ''}">
        <div class="time">${timeHtml}</div>
        <div class="info">
          <div class="name">${icon} ${escapeHtml(d.name)}${d.headsign ? ` <span class="muted">→ ${escapeHtml(d.headsign)}</span>` : ''}</div>
          <div class="sub">${escapeHtml(sub)}</div>
        </div>
        <div class="right"><div class="countdown">${countdown}</div>${badge}</div>
      </li>`;
    }).join('');
  }
  $('updated').textContent = lastUpdated ? `Frissítve: ${lastUpdated.toLocaleTimeString('hu-HU')} · percenként frissül` : '';
}

async function ensureResolved() {
  let changed = false;
  for (const k of ['from', 'to']) {
    if (!settings[k].resolved) {
      try { settings[k] = await resolvePlace(settings[k]); changed = true; } catch (e) { console.warn(e); }
    }
  }
  if (changed) saveSettings(settings);
}

let loading = false;
async function refresh() {
  if (loading) return;
  loading = true;
  try {
    if (!settings.modes.rail && !settings.modes.bus) throw new Error('Válassz legalább egy közlekedési eszközt a beállításokban.');
    await ensureResolved();
    lastDay = targetDay();
    lastDeps = lastDay ? await fetchDepartures(settings, lastDay) : [];
    lastUpdated = new Date();
    setStatus('');
  } catch (err) {
    console.error(err);
    const hint = err instanceof TypeError
      ? ' (hálózati vagy CORS hiba – nézd meg a README „Proxy” részét)' : '';
    setStatus(`Nem sikerült frissíteni: ${err.message}${hint}`, 'error');
  } finally {
    loading = false;
    render();
  }
}

// ---------- beállítások párbeszéd ----------
function fillForm() {
  $('fromInput').value = settings.from.name;
  $('toInput').value = settings.to.name;
  $('startInput').value = settings.start;
  $('endInput').value = settings.end;
  $('modeRail').checked = settings.modes.rail;
  $('modeBus').checked = settings.modes.bus;
  $('skipHolidays').checked = settings.skipHolidays;
  $('directOnly').checked = settings.directOnly;
  $('extraOff').value = settings.extraOff;
  $('extraWork').value = settings.extraWork;
  $('apiUrl').value = settings.apiUrl;
  $('days').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) =>
    `<label><input type="checkbox" data-day="${d}" ${settings.days.includes(d) ? 'checked' : ''}> ${DAY_NAMES[d]}</label>`).join('');
}

const suggestions = { from: [], to: [] };
function attachAutocomplete(inputId, listId, key) {
  let timer;
  $(inputId).addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (q.length < 3) return;
    timer = setTimeout(async () => {
      try {
        suggestions[key] = await searchStops(q);
        $(listId).innerHTML = suggestions[key].slice(0, 15)
          .map((s) => `<option value="${escapeHtml(s.name)}">`).join('');
      } catch (_) { /* csendben */ }
    }, 300);
  });
}

async function placeFromInput(key, value) {
  const current = settings[key];
  if (current.resolved && current.name === value) return current;
  const hit = suggestions[key].find((s) => s.name === value && s.mode === 'RAIL')
    || suggestions[key].find((s) => s.name === value);
  if (hit) return { name: hit.name, lat: hit.lat, lon: hit.lon, resolved: true };
  return resolvePlace({ name: value });
}

function setupSettings() {
  const dlg = $('settings');
  $('settingsBtn').addEventListener('click', () => { fillForm(); dlg.showModal(); });
  $('cancelBtn').addEventListener('click', () => dlg.close());
  $('swapBtn').addEventListener('click', () => {
    const a = $('fromInput').value; $('fromInput').value = $('toInput').value; $('toInput').value = a;
    [suggestions.from, suggestions.to] = [suggestions.to, suggestions.from];
  });
  attachAutocomplete('fromInput', 'fromList', 'from');
  attachAutocomplete('toInput', 'toList', 'to');

  $('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('saveBtn');
    btn.disabled = true; btn.textContent = 'Mentés…';
    try {
      const fromVal = $('fromInput').value.trim();
      const toVal = $('toInput').value.trim();
      const swapped = fromVal === settings.to.name && toVal === settings.from.name;
      const next = {
        ...settings,
        from: swapped ? settings.to : await placeFromInput('from', fromVal),
        to: swapped ? settings.from : await placeFromInput('to', toVal),
        start: $('startInput').value,
        end: $('endInput').value,
        modes: { rail: $('modeRail').checked, bus: $('modeBus').checked },
        days: [...document.querySelectorAll('#days input:checked')].map((i) => Number(i.dataset.day)),
        skipHolidays: $('skipHolidays').checked,
        directOnly: $('directOnly').checked,
        extraOff: $('extraOff').value.trim(),
        extraWork: $('extraWork').value.trim(),
        apiUrl: $('apiUrl').value.trim() || DEFAULT_API,
      };
      if (toMin(next.end) <= toMin(next.start)) throw new Error('A „Meddig” legyen később, mint a „Mettől”.');
      settings = next;
      saveSettings(settings);
      dlg.close();
      lastDeps = [];
      refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Mentés';
    }
  });
}

// ---------- indulás ----------
if (typeof document !== 'undefined' && document.getElementById('list')) {
  setupSettings();
  render();
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  setInterval(render, 15000); // visszaszámláló
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
