"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

(async () => {
  initApp();
  await admin
    .firestore()
    .collection("admin_settings")
    .doc("active_model")
    .set(
      {
        value: "claude-sonnet-4-5-20250929",
        type: "string",
        category: "ai",
        label: "Active AI Model",
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  console.log("✅ admin_settings/active_model → claude-sonnet-4-5-20250929");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
