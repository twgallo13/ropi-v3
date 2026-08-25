// READ-ONLY Firestore helper for the overnight audit.
// Usage: node _tools/fs.js <subcommand> [args]
const admin = require('/workspaces/ropi-v3/backend/functions/node_modules/firebase-admin');
const key = JSON.parse(process.env.GCP_SA_KEY_DEV);
admin.initializeApp({ credential: admin.credential.cert(key), projectId: key.project_id });
const db = admin.firestore();
module.exports = { admin, db };
