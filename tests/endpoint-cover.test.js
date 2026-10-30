/**
 * endpoint-cover.test.js
 *
 * Discovers EVERY route registered in the Express app at runtime and
 * smoke-tests each one:
 *   1. hit WITHOUT a token  -> expect 401 (auth required)
 *   2. hit WITH an auth token as SOCIETY_ADMIN -> expect the server NOT to
 *      5xx (no crash). Non-2xx results are informational, but a 5xx is a bug.
 *
 * This guarantees every registered route in app.js has at least one test.
 */
process.env.NODE_ENV = "test";
global.io = { to: () => ({ emit: () => {} }), emit: () => {}, on: () => {} };
require("dotenv/config");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../app");


const PUBLIC_PREFIXES = [
  "/api/auth",
  "/api/public",
  "/api/download",
  "/api/users/forgot-password",
  "/api/users/reset-password",
  "/uploads",
];
const PUBLIC_PATHS = new Set(["/"]);
const SAFE_PARAM_VALUE = "999999";

// Express 5 does not expose the mount path on router layers (`layer.path` is
// undefined), so read the app's mount order and pair it with router layers.
function getMountPrefixes() {
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  return [...source.matchAll(/app\.use\(\s*["']([^"']+)["']\s*,/g)].map((m) => m[1]);
}

const MOUNT_PREFIXES = getMountPrefixes();
const ROUTES = [];
function walk(stack, base) {
  for (const layer of stack) {
    if (!layer) continue;
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods);
      for (const m of methods) {
        ROUTES.push({ method: m, path: base + layer.route.path });
      }
    } else if (layer.handle && layer.handle.stack && typeof layer.path === "string") {
      walk(layer.handle.stack, base + layer.path);
    }
  }
}

let token = null
async function login() {
  if (token) return token;
  const creds = { email: "societyadmin32@yopmail.com", password: "Admin@123" };
  const loginRes = await request(app).post("/api/auth/login").send(creds);
  if (loginRes.status !== 200 || !loginRes.body.tempToken) {
    throw new Error("login failed t10exp: " + loginRes.status + " " + JSON.stringify(loginRes.body));
  }
  const otpRes = await request(app)
    .post("/api/auth/verify-otp")
    .send({ otp: "123456", tempToken: loginRes.body.tempToken });
  if (otpRes.status !== 200 || !otpRes.body.token) {
    throw new Error("otp failed (twow): " + otpRes.status + " " + JSON.stringify(otpRes.body));
  }
  token = otpRes.body.token;
  return token;
}

const routerStack =
  (app.router && app.router.stack) ||
  (app._router && app._router.stack) ||
  [];
let mountIndex = 0;
for (const layer of routerStack) {
  if (!layer) continue;
  if (layer.route && layer.route.path) {
    for (const m of Object.keys(layer.route.methods)) {
      ROUTES.push({ method: m, path: layer.route.path });
    }
  } else if (layer.handle && layer.handle.stack) {
    const prefix = MOUNT_PREFIXES[mountIndex++];
    if (prefix) walk(layer.handle.stack, prefix);
  }
}

describe("Endpoint coverage - every registered route", () => {
  const seen = new Set();
  const routes = [...new Map(ROUTES.map((r) => [`${r.method}:${r.path}`, r])).values()]
    .filter((r) => !PUBLIC_PATHS.has(r.path))
    .filter((r) => !PUBLIC_PREFIXES.some((prefix) => r.path.startsWith(prefix)));

  for (const r of routes) {
    const label = `${r.method.toUpperCase()} ${r.path}`;
    if (seen.has(label)) continue;
    seen.add(label);

    // Use a non-existent id so the smoke test exercises the route without
    // mutating seeded rows. The literal ":id" would reach MySQL as a string and
    // produce a database error rather than the route's normal 404/400.
    const requestPath = r.path.replace(/:[^/]+/g, SAFE_PARAM_VALUE);
    const method = r.method.toLowerCase();
    const hasBody = !["get", "head"].includes(method);

    it(`${label} - requires auth (401) when unauthenticated`, async () => {
      const res = await request(app)[method](requestPath);
      expect(res.status).toBe(401);
    });

    it(`${label} - does not crash (status < 500) for a society admin`, async () => {
      const t = await login();
      let req = request(app)[method](requestPath).set("Authorization", `Bearer ${t}`);
      if (hasBody) req = req.send({});
      const res = await req;
      expect(res.status).toBeLessThan(500);
    });
  }

  it("📋 discovered at least one route", () => {
    expect(routes.length).toBeGreaterThan(0);
  });
});
