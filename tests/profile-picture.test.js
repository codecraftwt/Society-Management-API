const {
  request,
  app,
  login,
  unique,
  expectUnauthorized,
  expectOk,
  expectClientError,
} = require("./helpers/api");
const { isProfilePictureOwnedBy } = require("../utils/profilePicture");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

describe("Profile picture API", () => {
  it("rejects unauthenticated upload", async () => {
    const res = await request(app)
      .put("/api/users/me/profile-picture")
      .attach("photo", ONE_PIXEL_PNG, { filename: "me.png", contentType: "image/png" });
    expectUnauthorized(res);
  });

  it("rejects unauthenticated remove", async () => {
    const res = await request(app).delete("/api/users/me/profile-picture");
    expectUnauthorized(res);
  });

  it("GET /api/users/me exposes a profile_picture field", async () => {
    const { headers } = await login("resident");
    const res = await request(app).get("/api/users/me").set(headers);
    expectOk(res);
    expect(res.body).toHaveProperty("profile_picture");
  });

  it("PUT /api/users/me/profile-picture rejects a non-image type", async () => {
    const { headers } = await login("resident");
    const res = await request(app)
      .put("/api/users/me/profile-picture")
      .set(headers)
      .attach("photo", Buffer.from("%PDF-1.4"), { filename: "doc.pdf", contentType: "application/pdf" });
    expectClientError(res);
  });

  it("PUT /api/users/me/profile-picture rejects SVG", async () => {
    const { headers } = await login("resident");
    const res = await request(app)
      .put("/api/users/me/profile-picture")
      .set(headers)
      .attach("photo", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), {
        filename: "x.svg",
        contentType: "image/svg+xml",
      });
    expectClientError(res);
  });

  it("PUT /api/users/me/profile-picture rejects an oversized file", async () => {
    const { headers } = await login("resident");
    const res = await request(app)
      .put("/api/users/me/profile-picture")
      .set(headers)
      .attach("photo", Buffer.alloc(6 * 1024 * 1024, 1), {
        filename: "big.png",
        contentType: "image/png",
      });
    expectClientError(res);
  });

  it("PUT /api/users/me/profile-picture rejects a request with no file", async () => {
    const { headers } = await login("resident");
    const res = await request(app).put("/api/users/me/profile-picture").set(headers);
    expectClientError(res);
  });

  it("POST /api/users/resident still accepts plain JSON", async () => {
    const { headers } = await login("admin");
    const res = await request(app)
      .post("/api/users/resident")
      .set(headers)
      .send({
        name: "Json Resident",
        email: `json.resident.${unique()}@yopmail.com`,
        phone: "9876543210",
        password: "Admin@123",
        flat_id: 1,
      });
    expectOk(res);
    expect(res.body.profile_picture).toBeFalsy();
  });

  it("POST /api/users/guard still accepts plain JSON", async () => {
    const { headers } = await login("admin");
    const res = await request(app)
      .post("/api/users/guard")
      .set(headers)
      .send({ name: "Json Guard", email: `json.guard.${unique()}@yopmail.com`, password: "Admin@123" });
    expectOk(res);
    expect(res.body.profile_picture).toBeFalsy();
  });

  it("treats a folder-prefixed public_id as owned by the right user", () => {
    // Cloudinary echoes back public_id WITH its folder, so req.file.filename is
    // "society/avatars/user-42-...". Ownership must be judged on the last segment.
    const foldered = "society/avatars/user-42-1700000000000-a1b2c3";
    expect(isProfilePictureOwnedBy(foldered, 42)).toBe(true);
    expect(isProfilePictureOwnedBy(foldered, 99)).toBe(false);
    expect(isProfilePictureOwnedBy("user-42-1700000000000-a1b2c3", 42)).toBe(true);
    // A sibling folder must not let a user claim another user's asset.
    expect(isProfilePictureOwnedBy("society/others/user-42-x", 42)).toBe(true);
    expect(isProfilePictureOwnedBy("user-4242-1700000000000-a1b2c3", 42)).toBe(false);
    expect(isProfilePictureOwnedBy("", 42)).toBe(false);
    expect(isProfilePictureOwnedBy("user-42-1", null)).toBe(false);
  });

  it("GET /api/users/guard includes profile_picture in each row", async () => {
    const { headers } = await login("admin");
    const res = await request(app).get("/api/users/guard").set(headers);
    expectOk(res);
    expect(Array.isArray(res.body)).toBe(true);
    res.body.forEach((g) => expect(g).toHaveProperty("profile_picture"));
  });
});
