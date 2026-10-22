const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

const VALID_STORES = ["mysql", "firestore"];
const configuredStore = (process.env.NOTIFICATION_STORE || "mysql").trim().toLowerCase();

if (!VALID_STORES.includes(configuredStore)) {
  throw new Error(
    `[NotificationConfig] Invalid NOTIFICATION_STORE="${configuredStore}". Must be one of: ${VALID_STORES.join(", ")}`
  );
}

let cachedFirestore = null;

const resolveServiceAccountPath = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return path.isAbsolute(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
      ? process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      : path.join(__dirname, "..", process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
  }
  return path.join(__dirname, "serviceAccountKey.json");
};

const getFirebaseApp = () => {
  if (admin.apps.length > 0) {
    return admin.app();
  }
  const saPath = resolveServiceAccountPath();
  if (!fs.existsSync(saPath)) {
    throw new Error(
      `[Firebase] Service account not found at: ${saPath}. Cannot initialize Firebase.`
    );
  }
  const serviceAccount = require(saPath);
  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
};

const getFirestore = () => {
  const currentStore = (process.env.NOTIFICATION_STORE || configuredStore || "mysql").trim().toLowerCase();
  if (currentStore !== "firestore") {
    return null;
  }
  if (cachedFirestore) {
    return cachedFirestore;
  }
  try {
    const app = getFirebaseApp();
    const db = app.firestore();
    db.settings({ ignoreUndefinedProperties: true });
    cachedFirestore = db;
    return cachedFirestore;
  } catch (err) {
    throw new Error(`[Firestore] Failed to initialize Firestore client: ${err.message}`);
  }
};

const _resetFirestoreCache = () => {
  cachedFirestore = null;
};

module.exports = {
  NOTIFICATION_STORE: configuredStore,
  getNotificationStore: () => (process.env.NOTIFICATION_STORE || configuredStore || "mysql").trim().toLowerCase(),
  getFirestore,
  _resetFirestoreCache,
};
