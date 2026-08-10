
const admin = require("firebase-admin");
const serviceAccount = require("../config/serviceAccountKey.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// ⚠️ PASTE YOUR DEVICE'S FCM TOKEN HERE
const MY_PHONE_TOKEN = "ctp8VlrfRrybxOOxO1lvpf:APA91bHkamqZAq3xSTsTzAZZaCAcZC2fsagh9w5UxeK7m1go8GG9wRLXasRVEyfVrrChOLnyhGN8ryIfoZtjVsQHNKkls7U7_VIBg8wNtNxkcxa497m0JSw";

async function runTest() {
  console.log("Sending STRICTLY DATA-ONLY push...");

  const message = {
    token: MY_PHONE_TOKEN,
    // ❌ ABSOLUTELY NO 'notification: {}' BLOCK!
    // Everything goes into 'data'.
    data: {
      title: "Gate Alert",
      body: "Zomato Delivery is waiting for your approval.",
      type: "GATE_APPROVAL",
      visitorId: "169",
    },
    android: {
      priority: "high" // Forces device to wake up
    }
  };

  try {
    await admin.messaging().send(message);
    console.log("✅ Data-only push sent! Check phone.");
    process.exit();
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

runTest();