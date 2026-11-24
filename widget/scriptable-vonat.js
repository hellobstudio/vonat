// Vonat widget – iOS kezdőképernyőre, a Scriptable appal (ingyenes, App Store).
// Telepítés: Scriptable → + → illeszd be ezt az egész fájlt → nevezd el „Vonat”-nak.
// Kezdőképernyő → hosszan nyomva → + → Scriptable → Közepes/Nagy widget → Script: Vonat.
// A beállításokat lent, a CONFIG részben tudod átírni.
// Alternatíva: a widget „Parameter” mezőjébe írhatsz JSON-t, pl.
//   {"from":"Kőbánya-Kispest","to":"Monor","start":"16:00","end":"18:00"}

const CONFIG = {
  from: 'Monor',
  to: 'Kőbánya-Kispest',
  start: '06:20',
  end: '07:30',
  rail: true,      // vonat
  bus: true,       // busz
  days: [1, 2, 3, 4, 5], // 0 = vasárnap, 1 = hétfő … 6 = szombat
  skipHolidays: true,
  directOnly: false,
  extraOff: [],    // pl. ['2026-12-24']
  extraWork: [],   // ledolgozós szombatok, pl. ['2026-01-10']
};
const API = 'https://mavplusz.hu/otp2-backend/otp/routers/default/index/graphql';

// ---------------------------------------------------------------------------
let cfg = { ...CONFIG };
if (args.widgetParameter) {
  try { cfg = { ...cfg, ...JSON.parse(args.widgetParameter) }; } catch (e) { /* hibás JSON – alapértelmezett */ }
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const atTime = (day, t) => { const d = new Date(day); d.setHours(0, 0, 0, 0); d.setMinutes(toMin(t)); return d; };

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
function holidays(y) {
  const e = easter(y);
  const rel = (n) => { const d = new Date(e); d.setDate(d.getDate() + n); return ymd(d); };
  return ['01-01', '03-15', '05-01', '08-20', '10-23', '11-01', '12-24', '12-25', '12-26']
    .map((x) => `${y}-${x}`).concat([rel(-2), rel(1), rel(50)]);
}
function isServiceDay(d) {
  const k = ymd(d);
  if (cfg.extraWork.includes(k)) return true;
  if (cfg.extraOff.includes(k)) return false;
  if (cfg.skipHolidays && holidays(d.getFullYear()).includes(k)) return false;
  return cfg.days.includes(d.getDay());
}
function targetDay(now) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  if (isServiceDay(d) && now <= atTime(d, cfg.end)) return d;
  for (let i = 1; i <= 21; i++) { const n = new Date(d); n.setDate(d.getDate() + i); if (isServiceDay(n)) return n; }
  return null;
}

async function gql(query) {
  const r = new Request(API);
  r.method = 'POST';
  r.headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  r.body = JSON.stringify({ query });
  r.timeoutInterval = 20;
  const json = await r.loadJSON();
  if (json.errors && !json.data) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data;
}

async function resolve(name) {
  const cacheKey = `vonat_stop_${name}`;
  if (Keychain.contains(cacheKey)) return JSON.parse(Keychain.get(cacheKey));
  const data = await gql(`{ stops(name: ${JSON.stringify(name)}) { name lat lon vehicleMode parentStation { name lat lon } } }`);
  const stops = data.stops || [];
  if (!stops.length) throw new Error(`Nincs ilyen megálló: ${name}`);
  const low = name.toLowerCase();
  const exact = stops.filter((s) => (s.parentStation || s).name.toLowerCase() === low);
  const pool = exact.length ? exact : stops;
  const s = pool.find((x) => x.vehicleMode === 'RAIL') || pool[0];
  const p = s.parentStation || s;
  const place = { name: p.name, lat: p.lat, lon: p.lon };
  Keychain.set(cacheKey, JSON.stringify(place));
  return place;
}

async function departures(day, from, to) {
  const ws = atTime(day, cfg.start), we = atTime(day, cfg.end);
  const modes = ['{mode: WALK}'];
  if (cfg.rail) modes.push('{mode: RAIL}');
  if (cfg.bus) modes.push('{mode: BUS}', '{mode: COACH}');
  const q = (withCoach) => `{ plan(from: {lat: ${from.lat}, lon: ${from.lon}}, to: {lat: ${to.lat}, lon: ${to.lon}},
      date: "${ymd(day)}", time: "${cfg.start}", numItineraries: 30,
      searchWindow: ${Math.round((we - ws) / 1000) + 60},
      transportModes: [${modes.filter((m) => withCoach || !m.includes('COACH')).join(', ')}]) {
    itineraries { legs { mode transitLeg startTime endTime departureDelay realTime realtimeState
      from { stop { platformCode } } route { shortName } trip { tripShortName } } } } }`;
  let data;
  try { data = await gql(q(true)); } catch (e) { if (/COACH/i.test(e.message)) data = await gql(q(false)); else throw e; }
  const out = new Map();
  for (const it of (data.plan && data.plan.itineraries) || []) {
    const t = it.legs.filter((l) => l.transitLeg);
    if (!t.length || (cfg.directOnly && t.length > 1)) continue;
    const f = t[0], last = t[t.length - 1];
    const sched = f.startTime - (f.departureDelay || 0) * 1000;
    if (sched < ws.getTime() || sched > we.getTime()) continue;
    const name = [f.route && f.route.shortName, f.trip && f.trip.tripShortName].filter(Boolean).join(' ');
    const key = `${name}|${sched}`;
    const dep = {
      mode: f.mode, name, sched, actual: f.startTime, arrival: last.endTime,
      delay: Math.round((f.departureDelay || 0) / 60), realTime: f.realTime,
      canceled: t.some((l) => l.realtimeState === 'CANCELED'),
      platform: f.from.stop && f.from.stop.platformCode, transfers: t.length - 1,
    };
    if (!out.has(key) || out.get(key).arrival > dep.arrival) out.set(key, dep);
  }
  return [...out.values()].sort((a, b) => a.sched - b.sched);
}

// ---------------------------------------------------------------------------
const now = new Date();
const w = new ListWidget();
w.backgroundColor = Color.dynamic(new Color('#ffffff'), new Color('#15171c'));
w.setPadding(12, 14, 12, 14);
const textColor = Color.dynamic(new Color('#111827'), new Color('#e5e7eb'));
const muted = Color.dynamic(new Color('#6b7280'), new Color('#9ca3af'));

function line(txt, font, color) { const t = w.addText(txt); t.font = font; t.textColor = color || textColor; t.lineLimit = 1; return t; }

try {
  const day = targetDay(now);
  const [from, to] = await Promise.all([resolve(cfg.from), resolve(cfg.to)]);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const label = !day ? '' : day.getTime() === today.getTime() ? 'Ma'
    : day.getTime() === today.getTime() + 864e5 ? 'Holnap'
      : day.toLocaleDateString('hu-HU', { weekday: 'short', month: 'short', day: 'numeric' });
  line(`${cfg.from} → ${cfg.to}`, Font.boldSystemFont(13));
  line(`${label} ${cfg.start}–${cfg.end}`, Font.systemFont(11), muted);
  w.addSpacer(6);

  const deps = day ? await departures(day, from, to) : [];
  const max = config.widgetFamily === 'large' ? 12 : config.widgetFamily === 'small' ? 4 : 6;
  const upcoming = deps.filter((d) => d.actual >= now.getTime() - 30000);
  const shown = (upcoming.length ? upcoming : deps).slice(0, max);
  if (!shown.length) line('Nincs járat ebben az idősávban', Font.systemFont(12), muted);

  for (const d of shown) {
    const row = w.addStack();
    row.centerAlignContent();
    const gone = d.actual < now.getTime();
    const t = row.addText(`${d.mode === 'RAIL' ? '🚆' : '🚌'} ${hm(new Date(d.sched))}`);
    t.font = Font.boldMonospacedSystemFont(14);
    t.textColor = gone ? muted : textColor;
    row.addSpacer(6);
    let status = d.canceled ? 'törölve' : d.delay > 0 ? `+${d.delay}′` : d.realTime ? 'pontos' : '';
    const st = row.addText(status);
    st.font = Font.semiboldSystemFont(12);
    st.textColor = d.canceled || d.delay >= 5 ? new Color('#dc2626') : d.delay > 0 ? new Color('#d97706') : new Color('#16a34a');
    if (config.widgetFamily !== 'small') {
      row.addSpacer(6);
      const extra = [d.name, `érk. ${hm(new Date(d.arrival))}`, d.platform ? `${d.platform}. vg` : '', d.transfers ? `${d.transfers} átsz.` : '']
        .filter(Boolean).join(' · ');
      const ex = row.addText(extra);
      ex.font = Font.systemFont(11); ex.textColor = muted; ex.lineLimit = 1;
    }
    row.addSpacer();
    w.addSpacer(3);
  }
} catch (e) {
  line('Hiba a lekérdezésnél', Font.boldSystemFont(13));
  line(String(e.message || e), Font.systemFont(11), muted);
}

w.addSpacer();
line(`Frissítve ${hm(now)}`, Font.systemFont(9), muted);
// Kérjük az 1 perces frissítést – az iOS ezt általában 5–15 percre ritkítja.
w.refreshAfterDate = new Date(Date.now() + 60 * 1000);

if (config.runsInWidget) Script.setWidget(w);
else await w.presentLarge();
Script.complete();
