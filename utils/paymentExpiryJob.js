

const cron          = require("node-cron");
const { Op }        = require("sequelize");
const { AmenityBooking, Amenity, User } = require("../models");
const { sendPushNotification } = require("../utils/pushNotification");
const notificationService = require("../services/notificationService");

const JOB_INTERVAL = "*/2 * * * *"; // every 2 minutes

cron.schedule(JOB_INTERVAL, async () => {
  try {
    const expired = await AmenityBooking.findAll({
      where: {
        status:             "PAYMENT_PENDING",
        payment_expires_at: { [Op.lt]: new Date() },
      },
      include: [
        { model: Amenity, attributes: ["name"] },
        { model: User,    attributes: ["id", "fcm_token", "name"] },
      ],
    });

    if (expired.length === 0) return;

    console.log(`[paymentExpiryJob] Expiring ${expired.length} unpaid booking(s).`);

    for (const booking of expired) {
      await booking.update({
        status:             "CANCELLED",
        payment_status:     "FAILED",
        payment_expires_at: null,
      });

      /* Notify resident so they know the slot was released */
      const title = "Booking Expired";
      const msg   = `⏰ Your reservation for ${booking.Amenity?.name} on ${booking.date} was released because payment was not completed in time. You can book again.`;

      try {
        await notificationService.sendNotification({
          societyId: booking.society_id,
          receiverUserId: booking.user_id,
          title,
          message: msg,
          type: "AMENITY",
          actionType: "VIEW_AMENITY",
          actionRoute: "/resident/amenities",
          fcmToken: booking.User?.fcm_token,
          sourceEventId: `PAYMENT_EXPIRED:${booking.id}:${booking.user_id}`,
        });
      } catch (notifErr) {
        console.error("[paymentExpiryJob] Notification error:", notifErr.message);
      }
    }
  } catch (err) {
    console.error("[paymentExpiryJob] Error:", err.message);
  }
});

console.log("[paymentExpiryJob] Scheduled — runs every 2 minutes.");