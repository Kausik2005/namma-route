#!/usr/bin/env node
/*
 * Import Bengaluru's main roads and Namma Metro from OpenStreetMap (Overpass API)
 * and write data/osm-bengaluru.js, which index.html loads when it is present.
 *
 *   node tools/import-osm.mjs                       download from overpass-api.de and build
 *   node tools/import-osm.mjs --from-cache          rebuild from the last download in .osm-cache/
 *   node tools/import-osm.mjs --roads r.json --metro m.json
 *                                                   build from Overpass JSON saved elsewhere
 *                                                   (for example exported from overpass-turbo.eu)
 *   node tools/import-osm.mjs --print-queries       print the Overpass queries and exit
 *
 * Options: --endpoint URL (default https://overpass-api.de/api/interpreter),
 *          --bbox south,west,north,east, --no-secondary (skip secondary roads),
 *          --out PATH (default data/osm-bengaluru.js)
 *
 * Needs Node 18 or later and nothing else. Behind an HTTPS proxy, run with
 * NODE_USE_ENV_PROXY=1 (Node 22.21+) so fetch uses HTTPS_PROXY.
 *
 * Data © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt; };

const ENDPOINT = opt("--endpoint", "https://overpass-api.de/api/interpreter");
// Nelamangala and Bidadi in the west, Hoskote in the east, Anekal and Attibele in the south, the airport in the north.
const BBOX = opt("--bbox", "12.70,77.30,13.26,77.86").split(",").map(Number);
const OUT = resolve(ROOT, opt("--out", "data/osm-bengaluru.js"));
const CACHE = resolve(ROOT, ".osm-cache");
const WITH_SECONDARY = !flag("--no-secondary");

// Junctions closer than this along a road are merged into one (dual carriageways, slip roads, roundabouts).
const MERGE_M = 70, MERGE_SPAN_M = 60;
// Geometry kept for drawing: points closer than this to the simplified line are dropped.
const SIMPLIFY_M = 18;

if (BBOX.length !== 4 || BBOX.some(Number.isNaN)) throw new Error("--bbox needs south,west,north,east");
const bbox = BBOX.join(",");
const classes = ["motorway", "trunk", "primary", ...(WITH_SECONDARY ? ["secondary"] : [])];

const ROADS_QUERY = `[out:json][timeout:300][bbox:${bbox}];
way["highway"~"^(${classes.join("|")})(_link)?$"]["area"!="yes"]["access"!~"^(no|private)$"];
out body geom;`;

const METRO_QUERY = `[out:json][timeout:180][bbox:${bbox}];
relation["route"~"^(subway|light_rail|monorail)$"]->.routes;
.routes out body;
rel(br.routes)["type"="route_master"];
out body;
node(r.routes);
out body;
way(r.routes:"platform");
out body center;
nwr["railway"="station"]["station"~"^(subway|light_rail|monorail)$"];
out body center;
nwr["railway"="construction"]["construction"="station"];
out body center;`;

if (flag("--print-queries")) {
  console.log(`# Roads\n${ROADS_QUERY}\n\n# Metro\n${METRO_QUERY}`);
  process.exit(0);
}

/* ---------------- Download ---------------- */
async function overpass(query, label) {
  for (let attempt = 0; ; attempt++) {
    process.stderr.write(`Downloading ${label} from ${ENDPOINT} ...\n`);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "namma-route-osm-import/1.0" },
        body: "data=" + encodeURIComponent(query),
      });
      if ([429, 502, 503, 504].includes(res.status)) throw new Error(`Overpass is busy (HTTP ${res.status})`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`), { fatal: true });
      const json = await res.json();
      if (json.remark && /error|timed out|runtime/i.test(json.remark)) throw new Error(`Overpass: ${json.remark}`);
      return json;
    } catch (e) {
      const why = e.cause ? `${e.message} (${e.cause.code || e.cause.message})` : e.message;
      if (e.fatal || attempt >= 4) throw new Error(`Could not download ${label} from ${ENDPOINT}: ${why}`);
      const wait = 15 * 2 ** attempt;
      process.stderr.write(`  ${why}; retrying in ${wait} s\n`);
      await new Promise(r => setTimeout(r, wait * 1000));
    }
  }
}

async function load() {
  const roadsFile = opt("--roads"), metroFile = opt("--metro");
  if (roadsFile || metroFile) {
    if (!roadsFile || !metroFile) throw new Error("--roads and --metro go together");
    return [JSON.parse(await readFile(roadsFile, "utf8")), JSON.parse(await readFile(metroFile, "utf8"))];
  }
  const rp = resolve(CACHE, "roads.json"), mp = resolve(CACHE, "metro.json");
  if (flag("--from-cache")) return [JSON.parse(await readFile(rp, "utf8")), JSON.parse(await readFile(mp, "utf8"))];
  const roads = await overpass(ROADS_QUERY, "roads");
  const metro = await overpass(METRO_QUERY, "metro");
  await mkdir(CACHE, { recursive: true });
  await writeFile(rp, JSON.stringify(roads));
  await writeFile(mp, JSON.stringify(metro));
  return [roads, metro];
}

/* ---------------- Geometry ---------------- */
const RAD = Math.PI / 180;
function meters(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}
const pathLen = pts => pts.reduce((s, p, i) => i ? s + meters(pts[i - 1], p) : 0, 0);
// Douglas-Peucker on a local flat projection.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const k = Math.cos(pts[0].lat * RAD) * 111320, xy = pts.map(p => [p.lon * k, p.lat * 110540]);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [x1, y1] = xy[i], [x2, y2] = xy[j], dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
    let bi = -1, bd = tol;
    for (let m = i + 1; m < j; m++) { const d = Math.abs(dy * xy[m][0] - dx * xy[m][1] + x2 * y1 - y2 * x1) / L; if (d > bd) { bd = d; bi = m; } }
    if (bi > 0) { keep[bi] = 1; stack.push([i, bi], [bi, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* ---------------- Roads ---------------- */
const CLASS = { motorway: 0, trunk: 1, primary: 2, secondary: 3 }; // index.html: xway, arterial, main, city
function roadName(t) {
  const n = t["name:en"] || t.name || "";
  if (n && t.ref && !n.includes(t.ref) && /^(NH|SH)\s?\d/.test(t.ref)) return `${n} (${t.ref})`;
  return n || t.ref || ({ motorway: "Expressway", trunk: "Highway", primary: "Main road", secondary: "Road" }[t.highway.replace("_link", "")]) + (t.highway.endsWith("_link") ? " ramp" : "");
}
function onewayOf(t) {
  const o = t.oneway;
  if (o === "-1" || o === "reverse") return -1;
  if (o === "yes" || o === "true" || o === "1") return 1;
  if (o === "no") return 0;
  return t.junction === "roundabout" || t.junction === "circular" || t.highway === "motorway" ? 1 : 0;
}

function buildRoads(json) {
  const ways = json.elements.filter(e => e.type === "way" && e.geometry && e.nodes && e.nodes.length > 1);
  if (!ways.length) throw new Error("The roads download has no ways with geometry (use 'out body geom').");
  // A junction is any OSM node shared by two road ways, or the end of a way.
  const uses = new Map();
  for (const w of ways) w.nodes.forEach((id, i) => uses.set(id, (uses.get(id) || 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1)));
  const coord = new Map();
  for (const w of ways) w.nodes.forEach((id, i) => { const g = w.geometry[i]; if (g) coord.set(id, { lat: g.lat, lon: g.lon }); });

  // Split ways into segments between junctions.
  let segs = [];
  for (const w of ways) {
    const t = w.tags || {}, base = t.highway.replace("_link", "");
    if (!(base in CLASS)) continue;
    const ow = onewayOf(t), cls = CLASS[base], name = roadName(t), toll = t.toll === "yes";
    const ids = ow === -1 ? w.nodes.slice().reverse() : w.nodes;
    let start = 0;
    for (let i = 1; i < ids.length; i++) {
      if (uses.get(ids[i]) < 2 && i < ids.length - 1) continue;
      const pts = ids.slice(start, i + 1).map(id => coord.get(id)).filter(Boolean);
      if (pts.length > 1 && ids[start] !== ids[i]) segs.push({ a: ids[start], b: ids[i], pts, len: pathLen(pts), cls, name, oneway: ow !== 0, toll, link: t.highway.endsWith("_link") });
      start = i;
    }
  }

  // Merge junctions joined by very short segments into one junction (shortest first),
  // but never let one merged junction spread wider than MERGE_SPAN_M.
  const parent = new Map(), members = new Map();
  const find = x => { let r = x; while (parent.get(r) !== r) r = parent.get(r); let y = x; while (y !== r) { const n = parent.get(y); parent.set(y, r); y = n; } return r; };
  for (const s of segs) for (const v of [s.a, s.b]) if (!parent.has(v)) { parent.set(v, v); members.set(v, [v]); }
  for (const s of segs.filter(s => s.len < MERGE_M).sort((x, y) => x.len - y.len)) {
    const a = find(s.a), b = find(s.b);
    if (a === b) continue;
    const all = [...members.get(a), ...members.get(b)].map(id => coord.get(id));
    const c = { lat: all.reduce((t, p) => t + p.lat, 0) / all.length, lon: all.reduce((t, p) => t + p.lon, 0) / all.length };
    if (all.some(p => meters(p, c) > MERGE_SPAN_M)) continue;
    parent.set(a, b); members.set(b, [...members.get(b), ...members.get(a)]); members.delete(a);
  }
  const center = new Map();
  for (const [r, ids] of members) { const ps = ids.map(i => coord.get(i)); center.set(r, { lat: ps.reduce((t, p) => t + p.lat, 0) / ps.length, lon: ps.reduce((t, p) => t + p.lon, 0) / ps.length }); }
  segs = segs.map(s => ({ ...s, a: find(s.a), b: find(s.b) })).filter(s => s.a !== s.b);

  // Keep the largest strongly connected part, so every junction can reach every other one.
  segs = largestStronglyConnected(segs);

  // Join chains through junctions that only continue one road (same name, class, direction rules and toll).
  segs = joinChains(segs);

  // Opposite one-way carriageways between the same two junctions become one two-way road.
  segs = mergeParallel(segs);

  // Number the junctions and encode.
  const ids = [...new Set(segs.flatMap(s => [s.a, s.b]))];
  const num = new Map(ids.map((id, i) => [id, i]));
  const names = [], nameIdx = new Map();
  const nameOf = n => { if (!nameIdx.has(n)) { nameIdx.set(n, names.length); names.push(n); } return nameIdx.get(n); };
  const r5 = v => Math.round(v * 1e5);
  const nodes = ids.flatMap(id => { const c = center.get(id); return [r5(c.lat) / 1e5, r5(c.lon) / 1e5]; });
  const edges = segs.map(s => {
    const inner = simplify(s.pts, SIMPLIFY_M).slice(1, -1);
    const A = center.get(s.a), geom = [];
    let pLat = r5(A.lat), pLon = r5(A.lon);
    for (const p of inner) { const la = r5(p.lat), lo = r5(p.lon); geom.push(la - pLat, lo - pLon); pLat = la; pLon = lo; }
    const flags = (s.oneway ? 1 : 0) | (s.toll ? 2 : 0);
    return [num.get(s.a), num.get(s.b), s.cls, nameOf(s.name), flags, Math.round(s.len), geom];
  });
  return { nodes, edges, names, stats: { ways: ways.length, junctions: ids.length, segments: edges.length, km: Math.round(segs.reduce((t, s) => t + s.len, 0) / 1000) } };
}

function largestStronglyConnected(segs) {
  const out = new Map(), inn = new Map(), add = (m, a, b) => { if (!m.has(a)) m.set(a, []); m.get(a).push(b); };
  for (const s of segs) {
    add(out, s.a, s.b); add(inn, s.b, s.a);
    if (!s.oneway) { add(out, s.b, s.a); add(inn, s.a, s.b); }
  }
  const verts = [...new Set(segs.flatMap(s => [s.a, s.b]))];
  // Kosaraju, iterative.
  const seen = new Set(), order = [];
  for (const v of verts) {
    if (seen.has(v)) continue;
    const stack = [[v, 0]]; seen.add(v);
    while (stack.length) {
      const top = stack[stack.length - 1], nb = out.get(top[0]) || [];
      if (top[1] < nb.length) { const w = nb[top[1]++]; if (!seen.has(w)) { seen.add(w); stack.push([w, 0]); } }
      else { order.push(top[0]); stack.pop(); }
    }
  }
  const comp = new Map(); let best = -1, bestSize = 0, c = 0;
  for (let i = order.length - 1; i >= 0; i--) {
    const v = order[i]; if (comp.has(v)) continue;
    let size = 0; const stack = [v]; comp.set(v, c);
    while (stack.length) { const x = stack.pop(); size++; for (const w of inn.get(x) || []) if (!comp.has(w)) { comp.set(w, c); stack.push(w); } }
    if (size > bestSize) { bestSize = size; best = c; }
    c++;
  }
  return segs.filter(s => comp.get(s.a) === best && comp.get(s.b) === best);
}

function joinChains(segs) {
  const alive = new Set(segs.map((_, i) => i));
  const at = new Map(), add = (v, i) => { if (!at.has(v)) at.set(v, new Set()); at.get(v).add(i); };
  segs.forEach((s, i) => { add(s.a, i); add(s.b, i); });
  const same = (x, y) => x.name === y.name && x.cls === y.cls && x.toll === y.toll && x.oneway === y.oneway && x.link === y.link;
  for (const [v, set] of at) {
    if (set.size !== 2) continue;
    let [i, j] = [...set], X = segs[i], Y = segs[j];
    if (!same(X, Y)) continue;
    // Orient the pair as a chain X -> v -> Y.
    if (X.oneway) {
      if (X.b === v && Y.a === v) { /* already in order */ }
      else if (Y.b === v && X.a === v) { [i, j, X, Y] = [j, i, Y, X]; }
      else continue;
    } else {
      if (X.b !== v) X = rev(X);
      if (Y.a !== v) Y = rev(Y);
    }
    if (X.a === Y.b) continue; // would close a loop
    segs[i] = { ...X, b: Y.b, pts: [...X.pts, ...Y.pts.slice(1)], len: X.len + Y.len };
    alive.delete(j);
    const far = at.get(Y.b); far.delete(j); far.add(i);
    set.clear();
  }
  return [...alive].map(i => segs[i]);
}
const rev = s => ({ ...s, a: s.b, b: s.a, pts: s.pts.slice().reverse() });

function mergeParallel(segs) {
  const byPair = new Map();
  for (const s of segs) { const k = s.a < s.b ? `${s.a}|${s.b}|${s.name}` : `${s.b}|${s.a}|${s.name}`; if (!byPair.has(k)) byPair.set(k, []); byPair.get(k).push(s); }
  const out = [];
  for (const list of byPair.values()) {
    if (list.length === 1) { out.push(list[0]); continue; }
    const two = list.filter(s => !s.oneway), fwd = list.filter(s => s.oneway && s.a === list[0].a), bwd = list.filter(s => s.oneway && s.a !== list[0].a);
    const shortest = l => l.reduce((m, s) => s.len < m.len ? s : m);
    if (two.length) { out.push(shortest(two)); continue; }
    if (fwd.length && bwd.length) { const f = shortest(fwd), b = shortest(bwd); out.push({ ...f, oneway: false, len: (f.len + b.len) / 2 }); continue; }
    out.push(shortest(list));
  }
  return out;
}

/* ---------------- Metro ---------------- */
const LINE_COLOURS = { purple: "#8a4bbd", green: "#2f9a56", yellow: "#d9a514", pink: "#d6528f", blue: "#2f74c8", orange: "#e5822b", red: "#c8432b", grey: "#7a8086" };
function lineId(t) {
  const s = `${t["name:en"] || ""} ${t.name || ""} ${t.ref || ""} ${t.colour || ""}`.toLowerCase();
  for (const c of Object.keys(LINE_COLOURS)) if (s.includes(c)) return c;
  const hex = (t.colour || "").toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) {
    const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const [r, g, b] = rgb(hex);
    let best = null, bd = Infinity;
    for (const [id, c] of Object.entries(LINE_COLOURS)) { const [R, G, B] = rgb(c), d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; if (d < bd) { bd = d; best = id; } }
    if (bd < 9000) return best;
  }
  return (t.ref || t.name || "line").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
function cleanStation(n) {
  return n.replace(/\s*\((namma )?metro( station)?\)\s*$/i, "").replace(/\s+(namma\s+)?metro(\s+station)?$/i, "").replace(/\s+station$/i, "").trim();
}
const pointOf = e => e.type === "node" ? { lat: e.lat, lon: e.lon } : e.center ? { lat: e.center.lat, lon: e.center.lon } : null;
const isBuilt = t => !(t.state && /construction|proposed|planned/i.test(t.state)) && !/(under construction|proposed)/i.test(`${t.name || ""} ${t.note || ""}`) && !t.construction && !t["railway:construction"];

function buildMetro(json) {
  const els = json.elements, byKey = new Map(els.map(e => [`${e.type}/${e.id}`, e]));
  const routes = els.filter(e => e.type === "relation" && e.tags && /^(subway|light_rail|monorail)$/.test(e.tags.route));
  const stations = els.filter(e => e.tags && (e.tags.railway === "station" || (e.tags.railway === "construction" && e.tags.construction === "station")) && pointOf(e))
    .map(e => ({ name: cleanStation(e.tags["name:en"] || e.tags.name || ""), ...pointOf(e), open: e.tags.railway === "station" })).filter(s => s.name);
  const nearestStation = p => { let b = null, bd = 400; for (const s of stations) { const d = meters(p, s); if (d < bd) { bd = d; b = s; } } return b; };

  const lines = new Map();
  for (const r of routes) {
    const t = r.tags, id = lineId(t);
    const pick = role => r.members.filter(m => role.test(m.role || "")).map(m => byKey.get(`${m.type}/${m.ref}`)).filter(e => e && pointOf(e));
    let stops = pick(/^stop/);
    if (stops.length < 2) stops = pick(/^platform/);
    const seq = [];
    for (const e of stops) {
      const p = pointOf(e), st = nearestStation(p), name = st ? st.name : cleanStation(e.tags?.["name:en"] || e.tags?.name || "");
      if (!name) continue;
      const at = st ? { lat: st.lat, lon: st.lon } : p;
      if (seq.length && seq[seq.length - 1][0] === name) continue;
      seq.push([name, +at.lat.toFixed(5), +at.lon.toFixed(5)]);
    }
    if (seq.length < 2) continue;
    const prev = lines.get(id);
    // Each line has a relation per direction (sometimes per branch); keep the longest.
    if (!prev || seq.length > prev.stations.length) {
      lines.set(id, { id, name: t["name:en"] || t.name || id, ref: t.ref || "", colour: /^#[0-9a-f]{6}$/i.test(t.colour || "") ? t.colour : (LINE_COLOURS[id] || "#7a8086"), built: isBuilt(t), osm: r.id, stations: seq });
    }
  }
  // Order lines north/west first so the output is stable between runs.
  return { lines: [...lines.values()].sort((a, b) => a.id.localeCompare(b.id)), stats: { routes: routes.length, stations: stations.length } };
}

/* ---------------- Main ---------------- */
const [roadsJson, metroJson] = await load();
const roads = buildRoads(roadsJson);
const metro = buildMetro(metroJson);
const meta = {
  source: "OpenStreetMap via Overpass API",
  endpoint: ENDPOINT,
  attribution: "© OpenStreetMap contributors (ODbL 1.0)",
  license: "https://www.openstreetmap.org/copyright",
  osmTimestamp: roadsJson.osm3s?.timestamp_osm_base || null,
  imported: new Date().toISOString().slice(0, 10),
  bbox: BBOX,
  classes,
};
const payload = { meta, roads: { nodes: roads.nodes, edges: roads.edges, names: roads.names }, metro: { lines: metro.lines } };
const js = `/* Generated by tools/import-osm.mjs on ${meta.imported}. Do not edit by hand; rerun the importer.
 * Bengaluru roads (${classes.join(", ")}) and Namma Metro from OpenStreetMap${meta.osmTimestamp ? `, data as of ${meta.osmTimestamp}` : ""}.
 * ${meta.attribution}: ${meta.license}
 */
window.OSM_BENGALURU = ${JSON.stringify(payload)};
`;
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, js);
console.log(`Roads: ${roads.stats.ways} OSM ways -> ${roads.stats.junctions} junctions, ${roads.stats.segments} road segments, ${roads.stats.km} km`);
console.log(`Metro: ${metro.stats.routes} route relations, ${metro.stats.stations} stations -> ${metro.lines.map(l => `${l.name} (${l.stations.length} stations${l.built ? "" : ", being built"})`).join(", ") || "no lines"}`);
console.log(`Wrote ${OUT} (${(Buffer.byteLength(js) / 1024 / 1024).toFixed(2)} MB)`);
