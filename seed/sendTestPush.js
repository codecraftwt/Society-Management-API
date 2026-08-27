/**
 * One-shot FCM test: send a real push to a user's registered device.
 * Usage:
 *   node seed/sendTestPush.js <userId> [title] [body]
 * Example:
 *   node seed/sendTestPush.js 9 "Test Push" "Hello from SocietyApp"
 *
 * If no token / no service account key, it prints exactly what is missing.
 */
require("dotenv").config();

const { sendPushNotification } = require("../utils/pushNotification");
const sequelize = require("../config/db");

(async () => {
  const userId = process.argv[2];
  const title = process.argv[3] || "SocietyApp Test";
  const body = process.argv[4] || "If you can read this, pushes work!";

  if (!userId) {
    console.log("Usage: node seed/sendTestPush.js <userId> [title] [body]");
    await sequelize.close();
    process.exit(1);
  }

  try {
    const [rows] = await sequelize.query(
      "SELECT id, name, role, fcm_token FROM users WHERE id = :id",
      { replacements: { id: Number(userId) } }
    );

    if (!rows.length) {
      console.log(`❌ No user with id=${userId}`);
    } else {
      const u = rows[0];
      console.log(`👤 ${u.name} (role=${u.role})`);
      if (!u.fcm_token) {
        console.log("❌ User has NO fcm_token. Open the mobile app logged-in as this user so it registers.");
      } else {
        console.log(`📤 Sending push to token ${u.fcm_token.slice(0, 20)}...`);
        await sendPushNotification(u.fcm_token, title, body, { type: "TEST" });
        // sendPushNotification logs success/error itself
      }
    }
  } catch (e) {
    console.error("❌ Error:", e.message);
  } finally {
    await sequelize.close();
  }
})();
