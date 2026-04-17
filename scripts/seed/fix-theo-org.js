"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

(async () => {
  initApp();
  let user;
  try {
    user = await admin.auth().getUserByEmail("theo@shiekhshoes.org");
    console.log("Found existing:", user.uid);
  } catch {
    console.log("Account not found for theo@shiekhshoes.org");
    process.exit(1);
  }

  await admin.auth().setCustomUserClaims(user.uid, { role: "admin" });

  await admin
    .firestore()
    .collection("users")
    .doc(user.uid)
    .set(
      {
        uid: user.uid,
        email: "theo@shiekhshoes.org",
        display_name: "Theo",
        role: "admin",
        requires_review: false,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  console.log(
    "✅ Admin claim + users doc set for theo@shiekhshoes.org:",
    user.uid
  );

  // Also refresh active_model admin_setting
  await admin
    .firestore()
    .collection("admin_settings")
    .doc("active_model")
    .set(
      {
        value: "claude-3-5-sonnet-20241022",
        type: "string",
        category: "ai",
        label: "Active AI Model",
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  console.log("✅ admin_settings/active_model → claude-3-5-sonnet-20241022");

  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
