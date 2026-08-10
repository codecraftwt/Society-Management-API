const User = require("../models/User"); // Adjust path if your model is elsewhere

async function updateFCM() {
  try {
    const fcmToken = "dGuocr_ZQ4-SFxz-PK3eJA:APA91bGAZ_MgFCiU9k_Vx_BDVgVoGC0Tj8wKcR4P52WSi4a7P8ijmc1nX-LxVf-4qdihdgMiTS9-JCGDpCtL6XHm8_WygkyA4fAIuIA5aMFX8R09shdxrq0";
    
    const [updatedRows] = await User.update(
      { fcm_token: fcmToken },
      { where: { id: 25 } }
    );

    if (updatedRows > 0) {
      console.log("Successfully updated FCM token for User ID 25");
    } else {
      console.log("User with ID 25 not found or token is already the same.");
    }
  } catch (error) {
    console.error("Error updating token:", error);
  } 
}

updateFCM();