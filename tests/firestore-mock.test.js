const { sendPushNotification } = require("../utils/pushNotification");

// Mock pushNotification and User model
jest.mock("../utils/pushNotification", () => ({
  sendPushNotification: jest.fn().mockResolvedValue({ success: true }),
  isPushEnabled: jest.fn().mockReturnValue(true),
}));

jest.mock("../models/User", () => ({
  findByPk: jest.fn().mockResolvedValue({ id: 101, fcm_token: "mock-fcm-token-101" }),
}));

describe("Firestore Configuration Singleton & Settings Behavior", () => {
  let originalStore;

  beforeEach(() => {
    originalStore = process.env.NOTIFICATION_STORE;
  });

  afterEach(() => {
    process.env.NOTIFICATION_STORE = originalStore;
    jest.resetModules();
  });

  it("caches Firestore instance and calls settings() only once across repeated getFirestore calls", () => {
    process.env.NOTIFICATION_STORE = "firestore";

    const settingsSpy = jest.fn();
    const mockDb = { settings: settingsSpy };
    const mockApp = { firestore: jest.fn().mockReturnValue(mockDb) };

    let firestoreConfig;
    jest.isolateModules(() => {
      jest.doMock("firebase-admin", () => ({
        apps: [mockApp],
        app: () => mockApp,
      }));
      firestoreConfig = require("../config/firestore");
    });

    // 1st call initializes and sets settings
    const db1 = firestoreConfig.getFirestore();
    expect(db1).toBe(mockDb);
    expect(settingsSpy).toHaveBeenCalledTimes(1);

    // 2nd call returns cached instance without re-calling settings()
    const db2 = firestoreConfig.getFirestore();
    expect(db2).toBe(mockDb);
    expect(settingsSpy).toHaveBeenCalledTimes(1); // Still 1!
  });

  it("returns null in MySQL mode without initializing or configuring Firestore", () => {
    process.env.NOTIFICATION_STORE = "mysql";

    const settingsSpy = jest.fn();
    const mockDb = { settings: settingsSpy };
    const mockApp = { firestore: jest.fn().mockReturnValue(mockDb) };

    let firestoreConfig;
    jest.isolateModules(() => {
      jest.doMock("firebase-admin", () => ({
        apps: [mockApp],
        app: () => mockApp,
      }));
      firestoreConfig = require("../config/firestore");
    });

    const db = firestoreConfig.getFirestore();
    expect(db).toBeNull();
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(mockApp.firestore).not.toHaveBeenCalled();
  });
});

describe("Firestore-Mode Notification Service (tests/firestore-mock.test.js)", () => {
  let inMemoryDocs;
  let mockFirestore;
  let notificationService;
  let originalEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = process.env.NOTIFICATION_STORE;
    process.env.NOTIFICATION_STORE = "firestore";

    // In-memory document storage representing Firestore 'notifications' collection
    inMemoryDocs = new Map();

    const createDocRef = (id) => {
      const docId = id || `mock_fs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      return {
        id: docId,
        create: jest.fn(async (data) => {
          if (inMemoryDocs.has(docId)) {
            const err = new Error("6 ALREADY_EXISTS: Document already exists");
            err.code = 6;
            throw err;
          }
          inMemoryDocs.set(docId, { ...data, id: docId });
          return { writeTime: new Date() };
        }),
        set: jest.fn(async (data) => {
          inMemoryDocs.set(docId, { ...data, id: docId });
          return { writeTime: new Date() };
        }),
        get: jest.fn(async () => {
          if (!inMemoryDocs.has(docId)) {
            return { exists: false, data: () => null };
          }
          return { exists: true, id: docId, data: () => inMemoryDocs.get(docId) };
        }),
        update: jest.fn(async (updateFields) => {
          if (!inMemoryDocs.has(docId)) {
            const err = new Error("NOT_FOUND");
            err.code = 5;
            throw err;
          }
          const existing = inMemoryDocs.get(docId);
          inMemoryDocs.set(docId, { ...existing, ...updateFields });
          return { writeTime: new Date() };
        }),
        delete: jest.fn(async () => {
          inMemoryDocs.delete(docId);
          return { writeTime: new Date() };
        }),
      };
    };

    const createQuery = (filters = []) => {
      return {
        where: jest.fn((field, op, value) => {
          return createQuery([...filters, { field, op, value }]);
        }),
        orderBy: jest.fn(() => createQuery(filters)),
        limit: jest.fn((limitNum) => createQuery([...filters, { limit: limitNum }])),
        get: jest.fn(async () => {
          let matched = Array.from(inMemoryDocs.values());
          for (const f of filters) {
            if (f.limit) {
              matched = matched.slice(0, f.limit);
              continue;
            }
            if (f.op === "==") {
              matched = matched.filter((d) => d[f.field] === f.value);
            } else if (f.op === "in") {
              matched = matched.filter((d) => Array.isArray(f.value) && f.value.includes(d[f.field]));
            }
          }
          return {
            empty: matched.length === 0,
            size: matched.length,
            docs: matched.map((d) => ({
              id: d.id,
              ref: createDocRef(d.id),
              data: () => d,
            })),
          };
        }),
      };
    };

    mockFirestore = {
      collection: jest.fn((collName) => {
        if (collName !== "notifications") {
          throw new Error(`Unexpected collection: ${collName}`);
        }
        return {
          doc: jest.fn((id) => createDocRef(id)),
          where: (f, o, v) => createQuery([{ field: f, op: o, value: v }]),
          limit: (n) => createQuery([{ limit: n }]),
          get: () => createQuery().get(),
        };
      }),
      batch: jest.fn(() => {
        const operations = [];
        return {
          set: (ref, data) => operations.push(() => ref.set(data)),
          update: (ref, data) => operations.push(() => ref.update(data)),
          delete: (ref) => operations.push(() => ref.delete()),
          commit: async () => {
            for (const op of operations) {
              await op();
            }
          },
        };
      }),
    };

    // Mock config/firestore
    jest.isolateModules(() => {
      jest.doMock("../config/firestore", () => ({
        NOTIFICATION_STORE: "firestore",
        getNotificationStore: () => "firestore",
        getFirestore: () => mockFirestore,
      }));
      notificationService = require("../services/notificationService");
    });

    global.io = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };
  });

  afterEach(() => {
    process.env.NOTIFICATION_STORE = originalEnv;
    jest.resetModules();
  });

  it("creates notification in Firestore with normalized return values and deterministic ID", async () => {
    const result = await notificationService.sendNotification({
      societyId: 10,
      receiverUserId: 101,
      senderUserId: 1,
      receiverRole: "RESIDENT",
      title: "Notice Test",
      message: "Notice body content",
      type: "NOTICE",
      actionType: "VIEW",
      actionRoute: "/resident/notices",
      sourceEventId: "EVENT_FS_1",
    });

    expect(result).toBeDefined();
    expect(typeof result.id).toBe("string");
    expect(result.id).toBe("notif_EVENT_FS_1_u101_NOTICE");
    expect(result.title).toBe("Notice Test");
    expect(result.receiver_user_id).toBe(101);
    expect(result.society_id).toBe(10);
    expect(result.is_read).toBe(false);

    // Verify it exists in Firestore mock storage
    const stored = inMemoryDocs.get(result.id);
    expect(stored).toBeDefined();
    expect(stored.receiver_user_id).toBe(101);
  });

  it("enforces durable persistence idempotency for identical sourceEventId and recipient", async () => {
    const emitSpy = jest.fn();
    global.io.to.mockReturnValue({ emit: emitSpy });

    const params = {
      societyId: 10,
      receiverUserId: 101,
      title: "Idempotent Notice",
      message: "First attempt",
      type: "NOTICE",
      sourceEventId: "SOURCE_EVT_DUP",
    };

    // 1st call creates document
    const res1 = await notificationService.sendNotification(params);
    expect(res1.id).toBe("notif_SOURCE_EVT_DUP_u101_NOTICE");
    expect(inMemoryDocs.size).toBe(1);
    expect(emitSpy).toHaveBeenCalledTimes(1);

    // 2nd call (concurrent / retry) detects ALREADY_EXISTS, returns existing, does NOT create 2nd doc or re-emit
    const res2 = await notificationService.sendNotification({
      ...params,
      message: "Retry attempt with same event and user",
    });
    expect(res2.id).toBe(res1.id);
    expect(inMemoryDocs.size).toBe(1); // Document count remains 1!
    expect(emitSpy).toHaveBeenCalledTimes(1); // Transports suppressed!
  });

  it("distinguishes recipients and types under the same sourceEventId", async () => {
    const eventId = "GLOBAL_BROADCAST_100";

    // Recipient A
    const resA = await notificationService.sendNotification({
      societyId: 10,
      receiverUserId: 101,
      title: "Notice to A",
      message: "Msg",
      type: "NOTICE",
      sourceEventId: eventId,
    });

    // Recipient B (different user, same event)
    const resB = await notificationService.sendNotification({
      societyId: 10,
      receiverUserId: 102,
      title: "Notice to B",
      message: "Msg",
      type: "NOTICE",
      sourceEventId: eventId,
    });

    // Recipient A with different type (same event)
    const resAltType = await notificationService.sendNotification({
      societyId: 10,
      receiverUserId: 101,
      title: "Alert to A",
      message: "Msg",
      type: "EMERGENCY",
      sourceEventId: eventId,
    });

    expect(resA.id).toBe("notif_GLOBAL_BROADCAST_100_u101_NOTICE");
    expect(resB.id).toBe("notif_GLOBAL_BROADCAST_100_u102_NOTICE");
    expect(resAltType.id).toBe("notif_GLOBAL_BROADCAST_100_u101_EMERGENCY");
    expect(inMemoryDocs.size).toBe(3);
  });

  it("retrieves unread notifications with strict user and society isolation", async () => {
    // Insert for user 101 in society 10
    await notificationService.sendNotification({
      societyId: 10,
      receiverUserId: 101,
      title: "User 101 Notif",
      message: "Msg",
    });

    // Insert for user 102 in society 10 (different user)
    await notificationService.sendNotification({
      societyId: 10,
      receiverUserId: 102,
      title: "User 102 Notif",
      message: "Msg",
    });

    // Insert for user 101 in society 20 (different society)
    await notificationService.sendNotification({
      societyId: 20,
      receiverUserId: 101,
      title: "User 101 Other Society",
      message: "Msg",
    });

    const user101Notifs = await notificationService.getUserNotifications(101, 10);
    expect(user101Notifs.length).toBe(1);
    expect(user101Notifs[0].title).toBe("User 101 Notif");
    expect(user101Notifs[0].receiver_user_id).toBe(101);
    expect(user101Notifs[0].society_id).toBe(10);
  });

  it("markAsRead updates is_read for the authorized recipient only", async () => {
    const created = await notificationService.sendNotification({
      societyId: 10,
      receiverUserId: 101,
      title: "Mark Read Test",
      message: "Msg",
    });

    // Attempt markAsRead by unauthorized user 999
    const unauthorized = await notificationService.markAsRead(created.id, 999, 10);
    expect(unauthorized.authorized).toBe(false);
    expect(inMemoryDocs.get(created.id).is_read).toBe(false);

    // Attempt markAsRead with mismatched society 99
    const wrongSociety = await notificationService.markAsRead(created.id, 101, 99);
    expect(wrongSociety.authorized).toBe(false);
    expect(inMemoryDocs.get(created.id).is_read).toBe(false);

    // Authorized recipient markAsRead
    const authorized = await notificationService.markAsRead(created.id, 101, 10);
    expect(authorized.authorized).toBe(true);
    expect(authorized.modified).toBe(true);
    expect(inMemoryDocs.get(created.id).is_read).toBe(true);
  });

  it("markAsRead handles non-existent / missing documents gracefully", async () => {
    const result = await notificationService.markAsRead("non_existent_doc_id", 101, 10);
    expect(result.found).toBe(false);
    expect(result.modified).toBe(false);
  });

  it("clearUserNotifications clears only target user notifications in the specified society", async () => {
    await notificationService.sendNotification({ societyId: 10, receiverUserId: 101, title: "N1", message: "M1" });
    await notificationService.sendNotification({ societyId: 10, receiverUserId: 101, title: "N2", message: "M2" });
    await notificationService.sendNotification({ societyId: 10, receiverUserId: 202, title: "N3", message: "M3" });

    const deleted = await notificationService.clearUserNotifications(101, 10);
    expect(deleted).toBe(2);

    const remaining101 = await notificationService.getUserNotifications(101, 10);
    expect(remaining101.length).toBe(0);

    const remaining202 = await notificationService.getUserNotifications(202, 10);
    expect(remaining202.length).toBe(1);
  });

  it("throws explicitly and does NOT fall back to MySQL if Firestore write fails", async () => {
    // Force collection doc.set to reject with Firestore error
    mockFirestore.collection = jest.fn(() => ({
      doc: () => ({
        id: "mock_fail_id",
        create: jest.fn().mockRejectedValue(new Error("7 PERMISSION_DENIED: Mocked Firestore permission denied")),
        set: jest.fn().mockRejectedValue(new Error("7 PERMISSION_DENIED: Mocked Firestore permission denied")),
      }),
    }));

    await expect(
      notificationService.sendNotification({
        societyId: 10,
        receiverUserId: 101,
        title: "Will Fail",
        message: "Fail",
        sourceEventId: "FAIL_EVT",
      })
    ).rejects.toThrow("PERMISSION_DENIED");

    // Socket.IO and FCM must NOT have been called
    expect(global.io.to).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("transports deliver after persistence; transport errors do not rollback persisted document", async () => {
    // Make FCM fail
    sendPushNotification.mockRejectedValueOnce(new Error("FCM transport network timeout"));

    const created = await notificationService.sendNotification({
      societyId: 10,
      receiverUserId: 101,
      title: "Transport Test",
      message: "Persisted even if FCM fails",
    });

    expect(created).toBeDefined();
    expect(inMemoryDocs.has(created.id)).toBe(true);
    // Socket was attempted
    expect(global.io.to).toHaveBeenCalledWith("user_101");
  });

  it("getReadEmergencyUserIds and markEmergencyNotificationsAsRead operate accurately in Firestore mode", async () => {
    const alertId = 555;
    // User 101 receives alert 555
    await notificationService.sendNotification({
      societyId: 10,
      receiverUserId: 101,
      title: "SOS Alert",
      message: "Emergency reported",
      type: "EMERGENCY",
      actionRoute: `/resident/emergency?alertId=${alertId}`,
    });

    // User 102 receives alert 555
    await notificationService.sendNotification({
      societyId: 10,
      receiverUserId: 102,
      title: "SOS Alert",
      message: "Emergency reported",
      type: "EMERGENCY",
      actionRoute: `/resident/emergency?alertId=${alertId}`,
    });

    // Before reading: neither is read
    let readUsers = await notificationService.getReadEmergencyUserIds({
      societyId: 10,
      alertId,
      recipientIds: [101, 102],
    });
    expect(readUsers).toEqual([]);

    // User 101 marks emergency as read
    const markRes = await notificationService.markEmergencyNotificationsAsRead({
      userId: 101,
      societyId: 10,
      alertId,
    });
    expect(markRes.modifiedCount).toBe(1);

    // After reading: user 101 is read, user 102 is unread
    readUsers = await notificationService.getReadEmergencyUserIds({
      societyId: 10,
      alertId,
      recipientIds: [101, 102],
    });
    expect(readUsers).toContain(101);
    expect(readUsers).not.toContain(102);
  });
});
