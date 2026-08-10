
const admin = require("firebase-admin");
const serviceAccount = require("../config/serviceAccountKey.json");
const User = require("../models/User");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  if (!fcmToken) return;

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

module.exports = { sendPushNotification };