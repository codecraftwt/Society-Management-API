
const admin = require("firebase-admin");
const User = require("../models/User");
const path = require("path");
const fs = require("fs");

const resolveServiceAccountPath = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return path.isAbsolute(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
      ? process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      : path.join(__dirname, "..", process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
  }
  return path.join(__dirname, "..", "config", "serviceAccountKey.json");
};

if (!admin.apps.length) {
  const serviceAccountPath = resolveServiceAccountPath();
  if (fs.existsSync(serviceAccountPath)) {
    try {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log("✅ Firebase Admin initialized");
    } catch (err) {
      console.error("❌ Failed to initialize Firebase Admin:", err.message);
    }
  } else {
    console.warn(
      "⚠️  Push notifications DISABLED — service account not found.\n" +
      `   Expected at: ${serviceAccountPath}\n` +
      "   Or set FIREBASE_SERVICE_ACCOUNT_PATH in .env\n" +
      "   Download the key from: Firebase Console → Project Settings → Service Accounts"
    );
  }
}

const isPushEnabled = () => admin.apps.length > 0;

const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  if (!fcmToken) return;
  if (!isPushEnabled()) {
    console.warn(`⚠️  Push skipped (no service account): "${title}"`);
    return;
  }

  const stringifiedData = {};
  for (const key in data) {
    if (data[key] !== null && data[key] !== undefined) {
      stringifiedData[key] = String(data[key]);
    }
  }

  // ✅ Add title and body directly into the DATA block
  stringifiedData.title = String(title);
  stringifiedData.body = String(body);

  const message = {
    // ❌ REMOVED the 'notification' block. 
    // This makes it a "Data-Only" message so Android doesn't auto-display it.
    data: stringifiedData, 
    token: fcmToken,
    android: {
      priority: 'high',
    },
    apns: {
      payload: {
        aps: {
          'content-available': 1,
          category: stringifiedData.type === 'GATE_APPROVAL' ? 'GATE_APPROVAL' : 'DEFAULT', 
        }
      }
    }
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("✅ Push Notification Sent:", response);
  } catch (error) {
    console.error("❌ Push Notification Error:", error.message);
    if (error.code === 'messaging/registration-token-not-registered' || error.code === 'messaging/invalid-registration-token') {
      try {
        await User.update({ fcm_token: null }, { where: { fcm_token: fcmToken } });
      } catch (dbError) {}
    }
  }
};

module.exports = { sendPushNotification, isPushEnabled };