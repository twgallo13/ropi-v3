"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

initApp();
const db = admin.firestore();

(async () => {
  const snap = await db.collection("attribute_registry").get();
  const unassigned = [];
  const all = [];
  snap.forEach((doc) => {
    const d = doc.data();
    all.push({ key: doc.id, label: d.display_label, tab: d.destination_tab, field_type: d.field_type, group: d.display_group });
    if (!d.display_group || d.display_group === "Other" || d.display_group === "") {
      unassigned.push({ key: doc.id, label: d.display_label, tab: d.destination_tab, field_type: d.field_type, group: d.display_group });
    }
  });
  console.log(`Total registry docs: ${all.length}`);
  console.log(`Unassigned fields: ${unassigned.length}\n`);
  unassigned.forEach((f) => {
    console.log(` - ${f.key} | label="${f.label || "(none)"}" | tab=${f.tab || "(none)"} | type=${f.field_type || "(none)"} | group="${f.group || "(none)"}"`);
  });
  process.exit(0);
})();
