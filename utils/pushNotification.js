
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

  // Determine notification type and channel
  const type = String(stringifiedData.type || stringifiedData.alert_type || '').toUpperCase();
  const actionType = String(stringifiedData.action_type || '').toUpperCase();
  const isEmergencyResolved = type === 'EMERGENCY_RESOLVED' || type === 'RESOLVED';
  const isEmergency =
    !isEmergencyResolved &&
    (type === 'EMERGENCY' ||
    type === 'SOS' ||
    type === 'EMERGENCY_ALERT' ||
    type === 'FIRE' ||
    type === 'MEDICAL' ||
    type === 'SECURITY' ||
    type === 'GATE_PANIC' ||
    actionType === 'VIEW_EMERGENCY');

  const channelId = isEmergency ? 'emergency_channel_v3' : 'default_channel_id';

  // Ensure title & body are inside stringifiedData
  stringifiedData.title = String(title);
  stringifiedData.body = String(body);

  const message = {
    // For EMERGENCY SOS alerts, omit top-level notification payload so Android delivers it as a high-priority data message directly to CustomFirebaseMessagingReceiver to trigger native buzzer & screen wake.
    // For standard notifications (notices, bills), include top-level notification for default system tray presentation.
    ...(isEmergency
      ? {}
      : {
          notification: {
            title: String(title),
            body: String(body),
          },
        }),
    data: stringifiedData,
    token: fcmToken,
    android: {
      priority: 'high',
      ...(isEmergency
        ? {}
        : {
            notification: {
              channelId: channelId,
              sound: 'default',
              priority: 'high',
              visibility: 'public',
              defaultSound: true,
              defaultVibrateTimings: true,
            },
          }),
    },
    apns: {
      payload: {
        aps: {
          'content-available': 1,
          sound: isEmergency ? 'sos_buzzer.wav' : 'default',
          category: stringifiedData.type === 'GATE_APPROVAL' ? 'GATE_APPROVAL' : 'DEFAULT',
        },
      },
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("✅ Push Notification Sent:", response);
  } catch (error) {
    console.error("❌ Push Notification Error:", error.message);
    const isInvalidToken =
      error.code === 'messaging/registration-token-not-registered' ||
      error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/mismatched-credential' ||
      (error.code === 'messaging/invalid-argument' && /registration token/i.test(error.message));
    if (isInvalidToken) {
      try {
        await User.update({ fcm_token: null }, { where: { fcm_token: fcmToken } });
      } catch (dbError) {}
    }
  }
};

module.exports = { sendPushNotification, isPushEnabled };