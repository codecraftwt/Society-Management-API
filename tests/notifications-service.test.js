const notificationService = require("../services/notificationService");
const Notification = require("../models/Notification");
const { getNotificationStore } = require("../config/firestore");
const { login } = require("./helpers/api");

describe("Centralized Notification Service (notificationService.js)", () => {
  let testSocietyId;
  let testUserId;
  let testSenderId;

  beforeAll(async () => {
    const residentSession = await login("resident");
    const adminSession = await login("admin");
    testUserId = residentSession.user.id;
    testSocietyId = residentSession.user.society_id;
    testSenderId = adminSession.user.id;
  });

  afterEach(async () => {
    // Clean up test notifications created in MySQL
    if (getNotificationStore() === "mysql" && testSocietyId) {
      await Notification.destroy({
        where: { society_id: testSocietyId, type: "NOTICE" },
      });
    }
  });

  it("sendNotification creates and returns a normalized notification record", async () => {
    const notif = await notificationService.sendNotification({
      societyId: testSocietyId,
      receiverUserId: testUserId,
      senderUserId: testSenderId,
      receiverRole: "RESIDENT",
      title: "Test Unit Title",
      message: "Test message body content",
      type: "NOTICE",
      actionType: "VIEW_NOTICE",
      actionRoute: "/resident/notices",
      sourceEventId: `UNIT_TEST:${Date.now()}:${testUserId}`,
    });

    expect(notif).toBeDefined();
    expect(notif.title).toBe("Test Unit Title");
    expect(notif.message).toBe("Test message body content");
    expect(notif.type).toBe("NOTICE");
    expect(notif.receiver_user_id).toBe(testUserId);
    expect(notif.is_read).toBe(false);
    expect(notif.id).toBeDefined();
  });

  it("deduplication prevents duplicate transport calls for the same sourceEventId", async () => {
    const eventId = `IDEMPOTENT_EVENT:${Date.now()}`;
    const emitSpy = jest.fn();
    global.io = {
      to: jest.fn().mockReturnValue({ emit: emitSpy }),
    };

    // First call - should emit
    await notificationService.sendNotification({
      societyId: testSocietyId,
      receiverUserId: testUserId,
      title: "Original",
      message: "First dispatch",
      type: "NOTICE",
      sourceEventId: eventId,
    });
    expect(emitSpy).toHaveBeenCalledTimes(1);

    // Second call with same sourceEventId - dedupe gate must skip emit
    await notificationService.sendNotification({
      societyId: testSocietyId,
      receiverUserId: testUserId,
      title: "Duplicate",
      message: "Second dispatch",
      type: "NOTICE",
      sourceEventId: eventId,
    });
    expect(emitSpy).toHaveBeenCalledTimes(1); // Still 1!
  });

  it("sendBulkNotifications creates multiple records cleanly", async () => {
    const batch = [
      {
        societyId: testSocietyId,
        receiverUserId: testUserId,
        title: "Bulk 1",
        message: "Message 1",
        type: "NOTICE",
        sourceEventId: `BULK_1:${Date.now()}`,
      },
      {
        societyId: testSocietyId,
        receiverUserId: testSenderId,
        title: "Bulk 2",
        message: "Message 2",
        type: "NOTICE",
        sourceEventId: `BULK_2:${Date.now()}`,
      },
    ];

    const results = await notificationService.sendBulkNotifications(batch);
    expect(results.length).toBe(2);
    expect(results[0].title).toBe("Bulk 1");
    expect(results[1].title).toBe("Bulk 2");
  });

  it("getUserNotifications retrieves unread items for authorized user and society", async () => {
    await notificationService.sendNotification({
      societyId: testSocietyId,
      receiverUserId: testUserId,
      title: "Unread 1",
      message: "Content",
      type: "NOTICE",
      sourceEventId: `USER_NOTIF:${Date.now()}`,
    });

    const list = await notificationService.getUserNotifications(testUserId, testSocietyId);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((n) => n.title === "Unread 1")).toBe(true);
  });

  it("markAsRead marks notification as read with ownership isolation", async () => {
    const created = await notificationService.sendNotification({
      societyId: testSocietyId,
      receiverUserId: testUserId,
      title: "To Be Read",
      message: "Content",
      type: "NOTICE",
      sourceEventId: `READ_TEST:${Date.now()}`,
    });

    // Attempt to mark as read from another user (unauthorized)
    const unauthorizedAttempt = await notificationService.markAsRead(
      created.id,
      999999, // non-owner
      testSocietyId
    );
    expect(unauthorizedAttempt.found).toBe(false);

    // Mark as read by proper owner
    const authorizedResult = await notificationService.markAsRead(
      created.id,
      testUserId,
      testSocietyId
    );
    expect(authorizedResult.authorized).toBe(true);
    expect(authorizedResult.modified).toBe(true);
  });

  it("clearUserNotifications removes all notifications for user in society", async () => {
    await notificationService.sendNotification({
      societyId: testSocietyId,
      receiverUserId: testUserId,
      title: "Clear Me",
      message: "Content",
      type: "NOTICE",
      sourceEventId: `CLEAR_TEST:${Date.now()}`,
    });

    await notificationService.clearUserNotifications(testUserId, testSocietyId);
    const list = await notificationService.getUserNotifications(testUserId, testSocietyId);
    expect(list.length).toBe(0);
  });
});
