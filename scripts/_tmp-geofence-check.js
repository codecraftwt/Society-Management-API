/**
 * Temporary harness: exercises GET/PUT /api/societies/geofence against the
 * running dev API as a real SOCIETY_ADMIN, by minting a session token with the
 * API's own secret + models (the real login flow emails a random OTP that a
 * script cannot read).
 *
 * Run from the API directory:  node scripts/_tmp-geofence-check.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { User } = require("../models");

/* 127.0.0.1 rather than localhost: the dev server binds IPv4 only, and Node's
   fetch resolver can otherwise stall on ::1. */
const BASE = "http://127.0.0.1:5000/api";

const line = (s) => console.log(`\n${s}\n${"-".repeat(s.length)}`);

/* Nominatim requires an identifying User-Agent and at most ~1 req/sec, so the
   result is cached on disk to keep re-runs off their servers entirely. */
const CACHE = path.join(__dirname, "_tmp-geocode-cache.json");

async function geocode(query) {
  const cache = fs.existsSync(CACHE)
    ? JSON.parse(fs.readFileSync(CACHE, "utf8"))
    : {};
  if (cache[query]) {
    console.log(`(cached geocode for "${query}")`);
    return cache[query];
  }

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
        query
      )}&limit=1`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "SocietyManagementGeofenceCheck/1.0 (local dev verification script)",
        },
      }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) {
        cache[query] = data[0];
        fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
        return data[0];
      }
      throw new Error(`no results for "${query}"`);
    }
    const body = await res.text().catch(() => "");
    console.log(
      `  geocoder attempt ${attempt}: HTTP ${res.status} ${body
        .slice(0, 60)
        .replace(/\s+/g, " ")}`
    );
    await new Promise((r) => setTimeout(r, 4000 * attempt));
  }
  throw new Error("geocoder unavailable after retries");
}

async function api(method, path, { token, activeRole, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (activeRole) headers["x-active-role"] = activeRole;
  if (body) headers["Content-Type"] = "application/json";

  // Retry transport-level failures: the dev server occasionally refuses the
  // first connection while nodemon has it restarting.
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

(async () => {
  await User.sequelize.authenticate();

  const admin = await User.findOne({
    where: { email: "societyadmin32@yopmail.com" },
  });
  if (!admin) throw new Error("seeded society admin not found");
  const resident = await User.findOne({ where: { email: "resident1@yopmail.com" } });

  console.log(
    `SOCIETY_ADMIN  id=${admin.id}  role=${admin.role}  roles=${JSON.stringify(
      admin.roles
    )}  society_id=${admin.society_id}`
  );

  const tok = (u) =>
    jwt.sign(
      { id: u.id, email: u.email, activeRole: u.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

  const adminReq = { token: tok(admin), activeRole: "SOCIETY_ADMIN" };
  const residentReq = resident
    ? { token: tok(resident), activeRole: "RESIDENT" }
    : null;

  /* ── 1. GET on open ── */
  line("1. GET /societies/geofence  (load on open)");
  const before = await api("GET", "/societies/geofence", adminReq);
  console.log(`status=${before.status}`);
  console.log(JSON.stringify(before.body, null, 2));
  const orig = before.body?.geofence;

  /* ── 2. Address -> coordinates, then save ── */
  line("2. address -> lat/lng (Nominatim) then PUT (save)");
  const geo = await geocode("Andheri West, Mumbai");
  const lat = Number(geo.lat);
  const lng = Number(geo.lon);
  console.log(`geocoder "${String(geo.display_name).slice(0, 55)}..."`);
  console.log(`-> latitude=${lat}  longitude=${lng}`);

  const saved = await api("PUT", "/societies/geofence", {
    ...adminReq,
    body: { latitude: lat, longitude: lng, radius_meters: 75 },
  });
  console.log(`\nPUT status=${saved.status}`);
  console.log(JSON.stringify(saved.body, null, 2));

  /* ── 3. Reload ── */
  line("3. GET again  (save -> reload round trip)");
  const after = await api("GET", "/societies/geofence", adminReq);
  const g = after.body?.geofence;
  console.log(`status=${after.status}  configured=${after.body?.configured}`);
  console.log(
    `latitude : ${lat}  ->  ${g?.latitude}   ${
      Math.abs(lat - Number(g?.latitude)) < 1e-6 ? "MATCH" : "MISMATCH"
    }`
  );
  console.log(
    `longitude: ${lng}  ->  ${g?.longitude}  ${
      Math.abs(lng - Number(g?.longitude)) < 1e-6 ? "MATCH" : "MISMATCH"
    }`
  );
  console.log(
    `radius   : 75  ->  ${g?.radius_meters}      ${
      Number(g?.radius_meters) === 75 ? "MATCH" : "MISMATCH"
    }`
  );

  /* ── 4. Radius bounds (the circle the UI draws) ── */
  line("4. radius bounds (backend-supported limits 1..200)");
  for (const r of [0, 1, 50, 200, 201]) {
    const r1 = await api("PUT", "/societies/geofence", {
      ...adminReq,
      body: { latitude: lat, longitude: lng, radius_meters: r },
    });
    console.log(
      `radius ${String(r).padStart(3)}  -> ${r1.status}  ${
        r1.body.geofence
          ? `stored radius_meters=${r1.body.geofence.radius_meters}`
          : r1.body.message
      }`
    );
  }

  /* ── 5. Coordinate bounds (manual entry validation) ── */
  line("5. manual coordinate validation");
  for (const c of [
    { latitude: 19.076, longitude: 72.8777 },
    { latitude: 90, longitude: 180 },
    { latitude: -90, longitude: -180 },
    { latitude: 91, longitude: 10 },
    { latitude: -91, longitude: 10 },
    { latitude: 10, longitude: 181 },
    { latitude: 10, longitude: -181 },
    { longitude: 10 },
  ]) {
    const r2 = await api("PUT", "/societies/geofence", {
      ...adminReq,
      body: { ...c, radius_meters: 50 },
    });
    console.log(
      `lat=${String(c.latitude).padStart(7)} lng=${String(c.longitude).padEnd(
        8
      )} -> ${r2.status}  ${r2.body.geofence ? "accepted" : r2.body.message}`
    );
  }

  /* ── 6. Role scoping ── */
  line("6. role scoping");
  if (residentReq) {
    const rg = await api("GET", "/societies/geofence", residentReq);
    console.log(
      `RESIDENT  GET  -> ${rg.status}  ${rg.body.message || "allowed (view)"}`
    );
    const rp = await api("PUT", "/societies/geofence", {
      ...residentReq,
      body: { latitude: 1, longitude: 1, radius_meters: 50 },
    });
    console.log(`RESIDENT  PUT  -> ${rp.status}  ${rp.body.message || ""}`);
  }
  const na = await api("GET", "/societies/geofence");
  console.log(`NO TOKEN  GET  -> ${na.status}  ${na.body.message || ""}`);

  /* ── 7. Restore ── */
  line("7. restore original");
  if (orig?.latitude != null) {
    const rr = await api("PUT", "/societies/geofence", {
      ...adminReq,
      body: {
        latitude: orig.latitude,
        longitude: orig.longitude,
        radius_meters: orig.radius_meters,
      },
    });
    console.log(
      `restored -> ${rr.status}  ${JSON.stringify(rr.body.geofence || rr.body)}`
    );
  } else {
    console.log(
      "society had no geofence before this run; saved value left in place:"
    );
    console.log(`  ${JSON.stringify(g)}`);
  }

  await User.sequelize.close();
})().catch(async (e) => {
  console.error("HARNESS ERROR:", e.message);
  try {
    await User.sequelize.close();
  } catch {}
  process.exit(1);
});
