const Notification = require("../models/Notification");
const User = require("../models/User");
const { getNotificationStore, getFirestore } = require("../config/firestore");
const { sendPushNotification } = require("../utils/pushNotification");

// Deduplication cache for transport emissions (10s window)
const transportDedupeMap = new Map();
const DEDUPE_TTL_MS = 10000;

const cleanDedupeMap = () => {
  const now = Date.now();
  for (const [key, ts] of transportDedupeMap.entries()) {
    if (now - ts > DEDUPE_TTL_MS) {
      transportDedupeMap.delete(key);
    }
  }
};

const isDuplicateTransport = (dedupeKey) => {
  if (!dedupeKey) return false;
  cleanDedupeMap();
  const now = Date.now();
  if (transportDedupeMap.has(dedupeKey)) {
    return true;
  }
  transportDedupeMap.set(dedupeKey, now);
  return false;
};

/**
 * Normalizes notification output format for consistent API consumption
 */
const normalizeNotification = (doc) => {
  if (!doc) return null;
  if (typeof doc.toJSON === "function") {
    return doc.toJSON();
  }
  return {
    id: doc.id || doc._id,
    title: doc.title,
    message: doc.message,
    type: doc.type,
    action_type: doc.action_type || null,
    action_route: doc.action_route || null,
    is_read: Boolean(doc.is_read),
    society_id: doc.society_id,
    user_id: doc.sender_user_id || doc.user_id || null,
    receiver_role: doc.receiver_role || null,
    receiver_user_id: doc.receiver_user_id,
    createdAt: doc.created_at ? (doc.created_at.toDate ? doc.created_at.toDate() : new Date(doc.created_at)) : doc.createdAt,
    updatedAt: doc.updated_at ? (doc.updated_at.toDate ? doc.updated_at.toDate() : new Date(doc.updated_at)) : doc.updatedAt,
  };
};

/**
 * Generates a deterministic document ID for Firestore when a sourceEventId is present.
 * Incorporates receiverUserId and notification type so multi-recipient or multi-type events
 * each have independent, deterministic keys.
 */
const buildDeterministicDocId = (sourceEventId, receiverUserId, type) => {
  if (!sourceEventId) return null;
  const cleanSource = String(sourceEventId).trim().replace(/[\/\s#?]+/g, "_");
  return `notif_${cleanSource}_u${receiverUserId}_${type || "GENERAL"}`;
};

/**
 * Creates and persists a single notification, then delivers real-time and push alerts
 */
const sendNotification = async ({
  societyId,
  receiverUserId,
  title,
  message,
  type = "GENERAL",
  actionType = null,
  actionRoute = null,
  senderUserId = null,
  receiverRole = null,
  fcmToken = null,
  sourceEventId = null,
  extraData = {},
}) => {
  if (!receiverUserId) {
    console.warn("[NotificationService] Skipped notification with no receiverUserId:", title);
    return null;
  }

  const store = getNotificationStore();
  let createdRecord = null;
  let recordId = null;

  // 1. Persist notification to configured store
  if (store === "firestore") {
    const firestore = getFirestore();
    const deterministicId = buildDeterministicDocId(sourceEventId, receiverUserId, type);
    const docRef = deterministicId
      ? firestore.collection("notifications").doc(deterministicId)
      : firestore.collection("notifications").doc();

    const now = new Date();
    const data = {
      id: docRef.id,
      title,
      message,
      type,
      action_type: actionType,
      action_route: actionRoute,
      is_read: false,
      society_id: Number(societyId),
      receiver_user_id: Number(receiverUserId),
      receiver_role: receiverRole || null,
      sender_user_id: senderUserId ? Number(senderUserId) : null,
      source_event_id: sourceEventId || null,
      created_at: now,
      updated_at: now,
    };

    let alreadyExisted = false;
    if (deterministicId && typeof docRef.create === "function") {
      try {
        await docRef.create(data);
        createdRecord = data;
        recordId = docRef.id;
      } catch (createErr) {
        // gRPC code 6 is ALREADY_EXISTS
        if (
          createErr.code === 6 ||
          createErr.code === "already-exists" ||
          (createErr.message && createErr.message.includes("ALREADY_EXISTS"))
        ) {
          alreadyExisted = true;
          const existingSnap = await docRef.get();
          createdRecord = existingSnap.exists ? existingSnap.data() : data;
          recordId = docRef.id;
        } else {
          throw createErr;
        }
      }
    } else {
      await docRef.set(data);
      createdRecord = data;
      recordId = docRef.id;
    }

    if (alreadyExisted) {
      // Record was already created concurrently or in a prior attempt. Return without duplicate transports.
      return normalizeNotification(createdRecord);
    }
  } else {
    // MySQL store
    const row = await Notification.create({
      title,
      message,
      type,
      action_type: actionType,
      action_route: actionRoute,
      society_id: societyId,
      receiver_user_id: receiverUserId,
      receiver_role: receiverRole,
      user_id: senderUserId,
      is_read: false,
    });
    createdRecord = row.toJSON();
    recordId = row.id;
  }

  const normalized = normalizeNotification(createdRecord);

  // 2. Prevent duplicate transport emissions
  const dedupeKey = sourceEventId || `${type}:${recordId}:${receiverUserId}`;
  if (isDuplicateTransport(dedupeKey)) {
    return normalized;
  }

  // 3. Socket.IO Real-Time Delivery
  try {
    if (global.io) {
      const socketPayload = {
        ...normalized,
        ...extraData,
        id: String(recordId),
      };
      global.io.to(`user_${receiverUserId}`).emit("new_notification", socketPayload);
    }
  } catch (socketErr) {
    console.error("[NotificationService] Socket emission error:", socketErr.message);
  }

  // 4. FCM Push Delivery
  try {
    let token = fcmToken;
    if (!token) {
      const user = await User.findByPk(receiverUserId, { attributes: ["fcm_token"] });
      token = user?.fcm_token;
    }

    if (token) {
      const pushData = {
        ...extraData,
        notification_id: String(recordId),
        id: String(recordId),
        type: String(type),
        action_type: actionType ? String(actionType) : "",
        action_route: actionRoute ? String(actionRoute) : "",
        route: actionRoute ? String(actionRoute) : "",
      };
      sendPushNotification(token, title, message, pushData).catch((pushErr) => {
        console.warn("[NotificationService] FCM push delivery failed:", pushErr.message);
      });
    }
  } catch (fcmErr) {
    console.error("[NotificationService] Push lookup error:", fcmErr.message);
  }

  return normalized;
};

/**
 * Creates and persists multiple notifications in batch, then dispatches alerts
 */
const sendBulkNotifications = async (notifications = []) => {
  if (!Array.isArray(notifications) || notifications.length === 0) {
    return [];
  }

  const store = getNotificationStore();
  const results = [];

  if (store === "firestore") {
    const firestore = getFirestore();
    const batchSize = 400; // Keep well under Firestore 500 limit
    for (let i = 0; i < notifications.length; i += batchSize) {
      const chunk = notifications.slice(i, i + batchSize);
      const batch = firestore.batch();
      const chunkRecords = [];

      for (const item of chunk) {
        if (!item.receiverUserId) continue;
        const itemType = item.type || "GENERAL";
        const deterministicId = buildDeterministicDocId(item.sourceEventId, item.receiverUserId, itemType);
        const docRef = deterministicId
          ? firestore.collection("notifications").doc(deterministicId)
          : firestore.collection("notifications").doc();
        const now = new Date();
        const docData = {
          id: docRef.id,
          title: item.title,
          message: item.message,
          type: itemType,
          action_type: item.actionType || null,
          action_route: item.actionRoute || null,
          is_read: false,
          society_id: Number(item.societyId),
          receiver_user_id: Number(item.receiverUserId),
          receiver_role: item.receiverRole || null,
          sender_user_id: item.senderUserId ? Number(item.senderUserId) : null,
          source_event_id: item.sourceEventId || null,
          created_at: now,
          updated_at: now,
        };
        batch.set(docRef, docData);
        chunkRecords.push({ data: docData, item });
      }

      await batch.commit();

      // Dispatch transports for chunk
      for (const { data, item } of chunkRecords) {
        const normalized = normalizeNotification(data);
        results.push(normalized);
        const dedupeKey = item.sourceEventId || `${item.type}:${data.id}:${item.receiverUserId}`;
        if (!isDuplicateTransport(dedupeKey)) {
          if (global.io) {
            global.io.to(`user_${item.receiverUserId}`).emit("new_notification", {
              ...normalized,
              ...(item.extraData || {}),
              id: String(data.id),
            });
          }
          if (item.fcmToken) {
            sendPushNotification(item.fcmToken, item.title, item.message, {
              ...(item.extraData || {}),
              notification_id: String(data.id),
              id: String(data.id),
              route: item.actionRoute || "",
            }).catch(() => null);
          }
        }
      }
    }
  } else {
    // MySQL bulk create
    const validItems = notifications.filter((n) => n.receiverUserId);
    const rowsToCreate = validItems.map((n) => ({
      title: n.title,
      message: n.message,
      type: n.type || "GENERAL",
      action_type: n.actionType || null,
      action_route: n.actionRoute || null,
      society_id: n.societyId,
      receiver_user_id: n.receiverUserId,
      receiver_role: n.receiverRole || null,
      user_id: n.senderUserId || null,
      is_read: false,
    }));

    const createdRows = await Notification.bulkCreate(rowsToCreate);

    for (let i = 0; i < createdRows.length; i++) {
      const row = createdRows[i];
      const item = validItems[i];
      const normalized = normalizeNotification(row.toJSON());
      results.push(normalized);

      const dedupeKey = item.sourceEventId || `${item.type}:${row.id}:${item.receiverUserId}`;
      if (!isDuplicateTransport(dedupeKey)) {
        if (global.io) {
          global.io.to(`user_${item.receiverUserId}`).emit("new_notification", {
            ...normalized,
            ...(item.extraData || {}),
            id: String(row.id),
          });
        }
        if (item.fcmToken) {
          sendPushNotification(item.fcmToken, item.title, item.message, {
            ...(item.extraData || {}),
            notification_id: String(row.id),
            id: String(row.id),
            route: item.actionRoute || "",
          }).catch(() => null);
        }
      }
    }
  }

  return results;
};

/**
 * Retrieves unread notifications for a user in a given society
 */
const getUserNotifications = async (userId, societyId, options = {}) => {
  const store = getNotificationStore();
  const limit = options.limit ? Number(options.limit) : 50;

  if (store === "firestore") {
    const firestore = getFirestore();
    let query = firestore
      .collection("notifications")
      .where("receiver_user_id", "==", Number(userId))
      .where("society_id", "==", Number(societyId))
      .where("is_read", "==", false)
      .orderBy("created_at", "desc")
      .limit(limit);

    const snapshot = await query.get();
    return snapshot.docs.map((doc) => normalizeNotification(doc.data()));
  }

  // MySQL store
  const rows = await Notification.findAll({
    where: {
      receiver_user_id: userId,
      society_id: societyId,
      is_read: false,
    },
    order: [["createdAt", "DESC"]],
    limit,
  });

  return rows.map((r) => normalizeNotification(r.toJSON()));
};

/**
 * Marks a notification as read, enforcing user and society isolation
 */
const markAsRead = async (notificationId, userId, societyId) => {
  const store = getNotificationStore();

  if (store === "firestore") {
    const firestore = getFirestore();
    const docRef = firestore.collection("notifications").doc(String(notificationId));
    const doc = await docRef.get();

    if (!doc.exists) {
      return { found: false, modified: false };
    }

    const data = doc.data();
    if (data.receiver_user_id !== Number(userId) || data.society_id !== Number(societyId)) {
      return { found: true, authorized: false };
    }

    await docRef.update({
      is_read: true,
      updated_at: new Date(),
    });

    return { found: true, authorized: true, modified: true, notification: { ...data, is_read: true } };
  }

  // MySQL store
  const notification = await Notification.findOne({
    where: {
      id: notificationId,
      receiver_user_id: userId,
      society_id: societyId,
    },
  });

  if (!notification) {
    return { found: false, modified: false };
  }

  notification.is_read = true;
  await notification.save();

  return { found: true, authorized: true, modified: true, notification: normalizeNotification(notification.toJSON()) };
};

/**
 * Clears/deletes notifications for a user in a given society
 */
const clearUserNotifications = async (userId, societyId) => {
  const store = getNotificationStore();

  if (store === "firestore") {
    const firestore = getFirestore();
    const snapshot = await firestore
      .collection("notifications")
      .where("receiver_user_id", "==", Number(userId))
      .where("society_id", "==", Number(societyId))
      .get();

    if (snapshot.empty) {
      return 0;
    }

    const batch = firestore.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    return snapshot.size;
  }

  // MySQL store
  const deletedCount = await Notification.destroy({
    where: {
      receiver_user_id: userId,
      society_id: societyId,
    },
  });

  return deletedCount;
};

/**
 * Cleans up notifications when a user or society is removed
 */
const deleteUserNotifications = async (userIds) => {
  if (!userIds) return 0;
  const ids = Array.isArray(userIds) ? userIds.map(Number) : [Number(userIds)];
  if (ids.length === 0) return 0;

  const store = getNotificationStore();
  if (store === "firestore") {
    const firestore = getFirestore();
    let totalDeleted = 0;
    // Firestore 'in' query allows up to 30 elements
    const chunkSize = 30;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const snapshot = await firestore
        .collection("notifications")
        .where("receiver_user_id", "in", chunk)
        .get();

      if (!snapshot.empty) {
        const batch = firestore.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        totalDeleted += snapshot.size;
      }
    }
    return totalDeleted;
  }

  const { Op } = require("sequelize");
  return await Notification.destroy({
    where: {
      receiver_user_id: ids.length === 1 ? ids[0] : { [Op.in]: ids },
    },
  });
};

/**
 * Retrieves recipient user IDs whose EMERGENCY notifications for a given society and alert are read
 */
const getReadEmergencyUserIds = async ({ societyId, alertId = null, recipientIds = [] }) => {
  if (!societyId || !Array.isArray(recipientIds) || recipientIds.length === 0) {
    return [];
  }

  const numericRecipients = recipientIds.map(Number);
  const store = getNotificationStore();

  if (store === "firestore") {
    const firestore = getFirestore();
    const readUserSet = new Set();
    const chunkSize = 30; // Firestore 'in' query limit

    for (let i = 0; i < numericRecipients.length; i += chunkSize) {
      const chunk = numericRecipients.slice(i, i + chunkSize);
      const query = firestore
        .collection("notifications")
        .where("society_id", "==", Number(societyId))
        .where("type", "==", "EMERGENCY")
        .where("is_read", "==", true)
        .where("receiver_user_id", "in", chunk);

      const snapshot = await query.get();
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (alertId) {
          const route = data.action_route || "";
          if (route.includes(`alertId=${alertId}`) || route.includes(`id=${alertId}`)) {
            readUserSet.add(data.receiver_user_id);
          }
        } else {
          readUserSet.add(data.receiver_user_id);
        }
      });
    }

    return Array.from(readUserSet);
  }

  // MySQL store
  const { Op } = require("sequelize");
  const where = {
    society_id: societyId,
    receiver_user_id: { [Op.in]: numericRecipients },
    type: "EMERGENCY",
    is_read: true,
  };

  if (alertId) {
    where[Op.or] = [
      { action_route: { [Op.like]: `%alertId=${alertId}%` } },
      { action_route: { [Op.like]: `%id=${alertId}%` } },
    ];
  }

  const notifs = await Notification.findAll({
    where,
    attributes: ["receiver_user_id"],
  });

  return Array.from(new Set(notifs.map((n) => n.receiver_user_id)));
};

/**
 * Marks EMERGENCY notifications as read for a specific user, society, and emergency alert
 */
const markEmergencyNotificationsAsRead = async ({ userId, societyId, alertId }) => {
  if (!userId || !societyId || !alertId) {
    return { modifiedCount: 0 };
  }

  const store = getNotificationStore();

  if (store === "firestore") {
    const firestore = getFirestore();
    const snapshot = await firestore
      .collection("notifications")
      .where("receiver_user_id", "==", Number(userId))
      .where("society_id", "==", Number(societyId))
      .where("type", "==", "EMERGENCY")
      .where("is_read", "==", false)
      .get();

    if (snapshot.empty) {
      return { modifiedCount: 0 };
    }

    const batch = firestore.batch();
    let modifiedCount = 0;
    const now = new Date();

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const route = data.action_route || "";
      if (route.includes(`alertId=${alertId}`) || route.includes(`id=${alertId}`)) {
        batch.update(doc.ref, {
          is_read: true,
          updated_at: now,
        });
        modifiedCount++;
      }
    });

    if (modifiedCount > 0) {
      await batch.commit();
    }

    return { modifiedCount };
  }

  // MySQL store
  const { Op } = require("sequelize");
  const [modifiedCount] = await Notification.update(
    { is_read: true, updatedAt: new Date() },
    {
      where: {
        receiver_user_id: userId,
        society_id: societyId,
        type: "EMERGENCY",
        [Op.or]: [
          { action_route: { [Op.like]: `%alertId=${alertId}%` } },
          { action_route: { [Op.like]: `%id=${alertId}%` } },
        ],
      },
    }
  );

  return { modifiedCount };
};

module.exports = {
  sendNotification,
  sendBulkNotifications,
  getUserNotifications,
  markAsRead,
  clearUserNotifications,
  deleteUserNotifications,
  normalizeNotification,
  getReadEmergencyUserIds,
  markEmergencyNotificationsAsRead,
};
