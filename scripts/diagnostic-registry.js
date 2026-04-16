const admin = require("firebase-admin");
const key = JSON.parse(process.env.GCP_SA_KEY_DEV);
admin.initializeApp({ credential: admin.credential.cert(key), projectId: "ropi-aoss-dev" });
const db = admin.firestore();

async function diagnostic() {
  const snap = await db.collection("attribute_registry").get();
  console.log("Total docs:", snap.size);

  // Build map of display_name -> entries
  const byName = {};
  snap.docs.forEach(d => {
    const dn = (d.data().display_name || d.id);
    if (!(dn in byName)) byName[dn] = [];
    byName[dn].push({ id: d.id, group: d.data().group, sort: d.data().sort_order });
  });

  console.log("\n--- Duplicate display_names ---");
  let dupes = 0;
  for (const dn of Object.keys(byName)) {
    if (byName[dn].length > 1) {
      console.log(dn + ":", JSON.stringify(byName[dn]));
      dupes++;
    }
  }
  if (!dupes) console.log("(none by display_name)");

  // Semantic duplicates check
  const ids = snap.docs.map(d => d.id).sort();
  console.log("\n--- Semantic duplicates ---");
  const pairs = [["name", "product_name"], ["image_status", "media_count"]];
  for (const pair of pairs) {
    const a = pair[0], b = pair[1];
    if (ids.indexOf(a) >= 0 && ids.indexOf(b) >= 0) {
      const da = snap.docs.find(d => d.id === a).data();
      const db2 = snap.docs.find(d => d.id === b).data();
      console.log(a + " (" + da.display_name + ", group=" + da.group + ") vs " + b + " (" + db2.display_name + ", group=" + db2.group + ")");
    }
  }

  // The two I added last session that pushed 66->68
  console.log("\n--- Docs added for Smart Rules (should be removed if spec says 66) ---");
  for (const id of ["name", "image_status"]) {
    const doc = snap.docs.find(d => d.id === id);
    if (doc) {
      console.log(id + ":", JSON.stringify(doc.data()));
    }
  }

  console.log("\n--- All " + ids.length + " IDs ---");
  console.log(ids.join(", "));
}

diagnostic().then(() => process.exit(0));
