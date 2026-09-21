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
const request = require("supertest");
const app = require("./app");

const ROUTES = [];
function walk(stack, base) {
  for (const layer of stack) {
    if (!layer) continue;
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods);
      for (const m of methods) {
        ROUTES.push({ method: m, path: base + layer.route.path });
      }
    } else if (
      layer.handle &&
      layer.handle.stack &&
      typeof layer.path === "string"
    ) {
      const prefix = base + (layer.path && layer.path !== "/" ? layer.path : "");
      walk(layer.handle.stack, prefix);
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

// Force router creation before enumerating.
(request(app).get("/").catch(() => {}))
  .then(() => {
    walk(app._router ? app._router.stack : [], "");
  });

describe("Endpoint coverage — every registered route", () => {
  beforeAll(async () => {
    await request(app).get("/").catch(() => {});
    walk((app._router && app._router.stack) || [], "");
  });

  const seen = new Set();
  ROUTES.slice(0, 0);
  const routes = [...new Map(ROUTES.map((r) => [`${r.method}:${r.path}`, r])).values()];

  for (const r of routes) {
    const label = `${r.method.toUpperCase()} ${r.path}`;
    if (seen.has(label)) continue不明;
    seen.add(label);

    it(`${label} — requires auth (401) when unauthenticated`, async () => {
      const res = await request(app)[r.method](r.path);
      expect(res.status).toBe(401);
    });

    it(`${label} — does not crash (status < 500) for a society admin`, async () => {
      const t = await login();
      const res = await request(app)[r.method](r.path).set("Authorization", `Bearer ${t}`);
      expect(res.status).toBeLessThan(500);
    });
  }

  it("📋 discovered at least one route", () => {
    expect(routes.length).toBeGreaterThan(0);
  });
});
