import express from 'express';

/**
 * Mosque finder backed by OpenStreetMap.
 *
 * Data comes from the live Overpass API — nothing is invented. If every mirror
 * fails the response says so and returns an empty list rather than a
 * plausible-looking placeholder mosque.
 */

export const mosquesRouter = express.Router();

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'RifqMuslim/1.0 (mosque finder; contact: rifqmuslim@gmail.com)';

/** Small in-process cache: Overpass is rate limited, coordinates rarely change. */
const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;

function cached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function remember(key, value) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}

export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
}

function pickName(tags = {}) {
  return (
    tags['name:en'] ||
    tags.name ||
    tags['name:ar'] ||
    tags['name:so'] ||
    tags.official_name ||
    ''
  );
}

function addressOf(tags = {}) {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:city'] || tags['addr:town'] || tags['addr:village'],
    tags['addr:district'],
  ].filter(Boolean);
  return parts.join(', ');
}

/** Map raw Overpass elements to a stable shape with real distance. */
export function normalizeMosques(elements, lat, lon, limit = 60) {
  const seen = new Set();
  const out = [];
  for (const el of elements || []) {
    const c = el.center || el;
    const plat = Number(c.lat ?? el.lat);
    const plon = Number(c.lon ?? el.lon);
    if (!Number.isFinite(plat) || !Number.isFinite(plon)) continue;
    const key = `${plat.toFixed(5)},${plon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tags = el.tags || {};
    const name = pickName(tags);
    const distance = distanceMeters(lat, lon, plat, plon);
    out.push({
      id: `${el.type || 'node'}/${el.id ?? key}`,
      name: name || 'Unnamed mosque',
      named: Boolean(name),
      lat: plat,
      lon: plon,
      distance,
      address: addressOf(tags),
      phone: tags.phone || tags['contact:phone'] || '',
      website: tags.website || tags['contact:website'] || '',
      denomination: tags.denomination || '',
      directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${plat},${plon}&travelmode=driving`,
      osmUrl: el.type && el.id ? `https://www.openstreetmap.org/${el.type}/${el.id}` : '',
    });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, limit);
}

async function overpass(radius, lat, lon) {
  const query = `[out:json][timeout:25];(
node(around:${radius},${lat},${lon})[amenity=place_of_worship][religion=muslim];
way(around:${radius},${lat},${lon})[amenity=place_of_worship][religion=muslim];
relation(around:${radius},${lat},${lon})[amenity=place_of_worship][religion=muslim];
);out center tags 80;`;

  let lastError = null;
  const started = Date.now();
  for (const url of OVERPASS) {
    // Keep the whole search responsive: a mobile page must not wait on a slow
    // mirror. Each mirror gets 8s and the loop gives up after 12s total.
    const left = 8000 - (Date.now() - started);
    if (left < 1500) break;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(5000, left));
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'application/json' },
        body: `data=${encodeURIComponent(query)}`,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        lastError = `overpass_${res.status}`;
        continue;
      }
      const json = await res.json();
      return { elements: json.elements || [], source: url };
    } catch (err) {
      lastError = err?.name === 'AbortError' ? 'overpass_timeout' : 'overpass_unreachable';
    }
  }
  throw new Error(lastError || 'overpass_unreachable');
}

/** City search for the "search by city" box, using Nominatim. */
mosquesRouter.get('/mosques/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q.length < 2) return res.json({ ok: true, places: [] });

  const key = `geo:${q.toLowerCase()}`;
  const hit = cached(key);
  if (hit) return res.json(hit);

  try {
    const url = `${NOMINATIM}?format=jsonv2&limit=8&addressdetails=1&accept-language=en&q=${encodeURIComponent(q)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const upstream = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!upstream.ok) return res.json({ ok: false, error: 'geocode_unavailable', places: [] });
    const rows = await upstream.json();
    const payload = {
      ok: true,
      places: (Array.isArray(rows) ? rows : []).map((r) => ({
        id: String(r.place_id),
        name: r.name || String(r.display_name || '').split(',')[0],
        label: r.display_name,
        lat: Number(r.lat),
        lon: Number(r.lon),
        type: r.type,
        country: r.address?.country || '',
      })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)),
    };
    return res.json(remember(key, payload));
  } catch {
    return res.json({ ok: false, error: 'geocode_unavailable', places: [] });
  }
});

mosquesRouter.get('/mosques', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const radius = Math.min(50000, Math.max(500, Number(req.query.radius) || 5000));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ ok: false, error: 'coords_required', mosques: [] });
  }

  const key = `mosques:${lat.toFixed(3)},${lon.toFixed(3)},${radius}`;
  const hit = cached(key);
  if (hit) return res.json({ ...hit, cached: true });

  try {
    const { elements, source } = await overpass(radius, lat, lon);
    const mosques = normalizeMosques(elements, lat, lon);
    const payload = {
      ok: true,
      source: 'openstreetmap',
      attribution: '© OpenStreetMap contributors',
      endpoint: source,
      center: { lat, lon },
      radius,
      count: mosques.length,
      mosques,
      note: mosques.length
        ? ''
        : 'No mosques mapped in OpenStreetMap within this radius. Try a wider distance or search another city.',
    };
    return res.json(remember(key, payload));
  } catch (err) {
    return res.json({
      ok: false,
      error: String(err?.message || 'overpass_unreachable'),
      source: 'openstreetmap',
      center: { lat, lon },
      radius,
      count: 0,
      mosques: [],
      note: 'The OpenStreetMap service could not be reached. This is not an empty result — please retry.',
    });
  }
});
