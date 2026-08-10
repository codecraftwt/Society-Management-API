

const cron          = require("node-cron");
const { Op }        = require("sequelize");
const { AmenityBooking, Amenity, User, Notification } = require("../models");
const { sendPushNotification } = require("../utils/pushNotification");

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
        const notification = await Notification.create({
          title,
          message:          msg,
          type:             "AMENITY",
          action_type:      "VIEW_AMENITY",
          action_route:     "/resident/amenities",
          society_id:       booking.society_id,
          receiver_user_id: booking.user_id,
        });

        if (global.io) {
          global.io.to(`user_${booking.user_id}`).emit("new_notification", notification);
        }

        if (booking.User?.fcm_token) {
          sendPushNotification(
            booking.User.fcm_token,
            title,
            msg,
            { route: "/resident/amenities" }
          ).catch(console.error);
        }
      } catch (notifErr) {
        console.error("[paymentExpiryJob] Notification error:", notifErr.message);
      }
    }
  } catch (err) {
    console.error("[paymentExpiryJob] Error:", err.message);
  }
});

console.log("[paymentExpiryJob] Scheduled — runs every 2 minutes.");