// seed/testFCMStatus.js
const admin = require("firebase-admin");
const serviceAccount = require("../config/serviceAccountKey.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const checkFCM = async () => {
  console.log("=");
  console.log("🔍 FCM DIAGNOSTIC TEST");
  console.log("=");
  console.log("Project ID:", serviceAccount.project_id);
  console.log("Client Email:", serviceAccount.client_email);
  console.log("");

  // ✅ TEST 1: Send to INVALID token (checks if API is enabled)
  try {
    console.log("📤 TEST 1: Sending to INVALID token...");
    await admin.messaging().send({
      token: "INVALID_TOKEN_12345",
      notification: { title: "test", body: "test" },
    });
  } catch (error) {
    if (error.code === "messaging/invalid-argument" ||
        error.code === "messaging/invalid-registration-token" ||
        error.code === "messaging/registration-token-not-registered") {
      console.log("✅ FCM API IS ENABLED! (Error is about invalid token, not API)");
      console.log("   Error code:", error.code);
    } else if (error.message?.includes("403") ||
               error.message?.includes("PERMISSION_DENIED") ||
               error.message?.includes("not enabled")) {
      console.log("❌ FCM API IS DISABLED!");
      console.log("   Error:", error.message);
      console.log("");
      console.log("   👉 FIX: Open this URL in any browser:");
      console.log("   https://console.cloud.google.com/apis/library/fcm.googleapis.com?project=" + serviceAccount.project_id);
    } else {
      console.log("⚠️ UNKNOWN ERROR:", error.code, error.message);
    }
  }

  console.log("");

  // ✅ TEST 2: Send to REAL token
  const REAL_TOKEN = "cyE03kBXR02unJw6zUZFxg:APA91bFjIPYqEZMUKamo2tY5Wjazz4YlHKDYJSKquGtCh8Zof4OWXGteFPfdWcp0fln3UMeAhzF-aHH0pvHg047oo38KREGPQfx8KJQGT6urXTRuYlL6M_A";

  try {
    console.log("📤 TEST 2: Sending to REAL token...");
    const response = await admin.messaging().send({
      token: REAL_TOKEN,
      notification: {
        title: "🔔 Diagnostic Test",
        body: "Time: " + new Date().toLocaleTimeString(),
      },
      android: {
        priority: "high",
        notification: {
          channelId: "default_channel_id",
          sound: "default",
        },
      },
    });
    console.log("✅ SEND SUCCESS:", response);

    // Parse the response
    console.log("");
    console.log("🔍 ANALYZING RESPONSE...");
    console.log("   Message ID:", response);

    if (response.includes("fake_message") || response.includes("error")) {
      console.log("⚠️ Message might not be real");
    } else {
      console.log("✅ Message was accepted by FCM servers");
      console.log("");
      console.log("   If the app STILL doesn't receive it, the problem is:");
      console.log("   1. Device is not connected to Google Play Services");
      console.log("   2. App is not registering the listener properly");
      console.log("   3. Token is stale/expired");
    }
  } catch (error) {
    console.log("❌ SEND FAILED:", error.code, error.message);

    if (error.code === "messaging/registration-token-not-registered") {
      console.log("");
      console.log("🔴 TOKEN IS EXPIRED/INVALID!");
      console.log("   The app needs to generate a NEW token");
      console.log("   Delete old token → Get new one → Update in testPush.js");
    }
  }

  console.log("");
  console.log("=");
};

checkFCM();