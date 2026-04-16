/**
 * Shared helper for seed scripts.
 * Handles firebase-admin initialisation with GCP_SA_KEY_DEV or
 * GOOGLE_APPLICATION_CREDENTIALS.
 */

"use strict";

const admin = require("firebase-admin");
const PROJECT_ID = "ropi-aoss-dev";

function initApp() {
  // Prevent double-init when scripts are chained
  if (admin.apps.length) return admin.apps[0];

  // Option 1: JSON key content in env var (GCP_SA_KEY_DEV or SERVICE_ACCOUNT_JSON)
  const keyJson = process.env.GCP_SA_KEY_DEV || process.env.SERVICE_ACCOUNT_JSON;
  const keySource = process.env.GCP_SA_KEY_DEV ? "GCP_SA_KEY_DEV" : "SERVICE_ACCOUNT_JSON";
  if (keyJson) {
    const credential = admin.credential.cert(JSON.parse(keyJson));
    console.log(`🔑  Authenticating via ${keySource} env var → project ${PROJECT_ID}`);
    return admin.initializeApp({ credential, projectId: PROJECT_ID });
  }

  // Option 2: Path to key file via standard env var
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log(`🔑  Authenticating via GOOGLE_APPLICATION_CREDENTIALS → project ${PROJECT_ID}`);
    return admin.initializeApp({ projectId: PROJECT_ID });
  }

  // Option 3: Application Default Credentials (gcloud auth / emulator)
  console.log(`🔑  Authenticating via Application Default Credentials → project ${PROJECT_ID}`);
  return admin.initializeApp({ projectId: PROJECT_ID });
}

module.exports = { initApp, PROJECT_ID };
