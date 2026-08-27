// seed/checkPushSetup.js
// One-command diagnosis of the push notification pipeline.
// Run:  node seed/checkPushSetup.js
const fs = require("fs");
const path = require("path");

const main = async () => {
  console.log("═══════════════════════════════════════════════");
  console.log("🔍 PUSH NOTIFICATION PIPELINE CHECK");
  console.log("═══════════════════════════════════════════════\n");

  // ── STEP 1: Service account key ──
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ? path.join(__dirname, "..", process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
    : path.join(__dirname, "..", "config", "serviceAccountKey.json");

  if (!fs.existsSync(keyPath)) {
    console.log("❌ STEP 1 FAILED: serviceAccountKey.json NOT FOUND");
    console.log(`   Expected at: ${keyPath}`);
    console.log("   👉 Firebase Console → Project Settings → Service Accounts");
    console.log("      → Generate New Private Key → save as the file above\n");
    console.log("   ⛔ Without this key, ZERO pushes can ever be sent.");
    process.exit(1);
  }
  console.log("✅ STEP 1 OK: service account key found");
  const serviceAccount = require(keyPath);
  console.log(`   Project ID : ${serviceAccount.project_id}`);

  // ── STEP 2: Firebase Admin init + FCM API reachable ──
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  try {
    await admin.messaging().send({ token: "__probe_invalid_token__" });
  } catch (error) {
    if (
      error.code === "messaging/invalid-argument" ||
      error.code === "messaging/invalid-registration-token" ||
      error.code === "messaging/registration-token-not-registered"
    ) {
      console.log("✅ STEP 2 OK: FCM API is enabled and reachable");
    } else if (
      (error.message || "").includes("403") ||
      (error.message || "").includes("PERMISSION_DENIED") ||
      (error.message || "").includes("not been used") ||
      (error.message || "").includes("disabled")
    ) {
      console.log("❌ STEP 2 FAILED: FCM API DISABLED for this project");
      console.log(`   👉 Enable it: https://console.cloud.google.com/apis/library/fcm.googleapis.com?project=${serviceAccount.project_id}`);
      console.log(`   Error: ${error.message}\n`);
      process.exit(1);
    } else {
      console.log(`⚠️  STEP 2 WARNING: unexpected probe result → ${error.code || error.message}`);
    }
  }

  // ── STEP 3: Database tokens ──
  const sequelize = require("../config/db");
  const [rows] = await sequelize.query(
    `SELECT role, status,
            COUNT(*) AS total,
            SUM(CASE WHEN fcm_token IS NOT NULL AND fcm_token <> '' THEN 1 ELSE 0 END) AS with_token
     FROM users
     GROUP BY role, status
     ORDER BY role`
  );

  console.log("\n📋 STEP 3: Registered devices per role");
  console.log("   ROLE              STATUS       TOTAL   WITH FCM TOKEN");
  let anyToken = false;
  for (const r of rows) {
    if (r.with_token > 0) anyToken = true;
    console.log(
      `   ${(r.role || "?").padEnd(17)} ${(r.status || "?").padEnd(12)} ${String(r.total).padEnd(7)} ${r.with_token}`
    );
  }

  if (!anyToken) {
    console.log("\n❌ NO DEVICE HAS A TOKEN YET.");
    console.log("   👉 On the phone: rebuild app (npx react-native run-android), login,");
    console.log("      allow the notification permission. Token saves automatically.");
    console.log("   👉 Verify in logcat: filter 'FCM TOKEN'");
  } else {
    console.log("\n✅ At least one device token registered — pushes can be delivered.");
  }

  await sequelize.close();
  console.log("\n═══════════════════════════════════════════════");
};

main().catch((err) => {
  console.error("Diagnostic failed:", err.message);
  process.exit(1);
});
