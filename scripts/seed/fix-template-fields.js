const admin = require("firebase-admin");
const { initApp } = require("./utils");
initApp();
const db = admin.firestore();

(async () => {
  const snap = await db.collection("prompt_templates").get();
  let fixed = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const updates = {};
    if (d.tone_profile === undefined) updates.tone_profile = null;
    if (d.match_gender === undefined) updates.match_gender = null;
    if (d.sections === undefined) updates.sections = [];
    if (d.use_emojis === undefined) updates.use_emojis = false;
    if (d.is_active === undefined) updates.is_active = true;
    if (d.priority === undefined) updates.priority = 1;
    if (Object.keys(updates).length > 0) {
      await doc.ref.set(updates, { merge: true });
      console.log(`Fixed ${doc.id} (${d.template_name}):`, Object.keys(updates).join(", "));
      fixed++;
    }
  }
  console.log(`\nDone. ${fixed} templates fixed, ${snap.size - fixed} already clean.`);
  process.exit(0);
})();
