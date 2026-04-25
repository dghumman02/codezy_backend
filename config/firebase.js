import admin from "firebase-admin";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

/**
 * Initialize Firebase Admin SDK.
 *
 * Looks for a service-account JSON file in order:
 *   1. FIREBASE_SERVICE_ACCOUNT_PATH env var (absolute path)
 *   2. config/serviceAccountKey.json (relative to backend/)
 *
 * If neither exists, initializes with Application Default Credentials
 * (works on GCP / Cloud Run, or when GOOGLE_APPLICATION_CREDENTIALS is set).
 */
const initFirebase = () => {
  if (admin.apps.length) return admin; // already initialized

  const envPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const localPath = resolve("config", "serviceAccountKey.json");

  let credential;

  if (envPath && existsSync(envPath)) {
    const sa = JSON.parse(readFileSync(envPath, "utf8"));
    credential = admin.credential.cert(sa);
    console.log("✅ Firebase Admin initialized with service account (env path)");
  } else if (existsSync(localPath)) {
    const sa = JSON.parse(readFileSync(localPath, "utf8"));
    credential = admin.credential.cert(sa);
    console.log("✅ Firebase Admin initialized with service account (local)");
  } else {
    credential = admin.credential.applicationDefault();
    console.log("⚠️  Firebase Admin initialized with application default credentials");
  }

  admin.initializeApp({ credential });
  return admin;
};

initFirebase();

export default admin;
