#!/usr/bin/env node
"use strict";
const admin = require("firebase-admin");
const keyJson = JSON.parse(process.env.GCP_SA_KEY_DEV);
const app = admin.initializeApp({ credential: admin.credential.cert(keyJson), projectId: "ropi-aoss-dev" });
const db = admin.firestore(app);

async function getLatestVersion(mpn, siteOwner) {
  const docId = mpn.replace(/[/.#$[\]]/g, "_");
  const snap = await db.collection("products").doc(docId)
    .collection("content_versions")
    .where("site_owner", "==", siteOwner)
    .get();
  if (snap.empty) return null;
  const sorted = snap.docs.sort((a, b) => {
    const ta = a.data().created_at?._seconds ?? 0;
    const tb = b.data().created_at?._seconds ?? 0;
    return tb - ta;
  });
  return { id: sorted[0].id, ...sorted[0].data() };
}

async function main() {
  // Shiekh Men's — MPN 1006302, site_owner shiekh (seeded Male+Footwear during test)
  const mens = await getLatestVersion("1006302", "shiekh");
  // Karmaloop — MPN 1006302, site_owner karmaloop
  const karmaloop = await getLatestVersion("1006302", "karmaloop");
  // MLTD — MPN 1006302, site_owner mltd
  const mltd = await getLatestVersion("1006302", "mltd");

  console.log("════════════════════════════════════════════════════════════");
  console.log("ARTIFACT 1 — SHIEKH MEN'S FOOTWEAR");
  console.log("template_name:", mens?.template_name);
  console.log("version_id:", mens?.id);
  console.log("════════════════════════════════════════════════════════════");
  console.log("FULL parsed_output.description:");
  console.log(mens?.parsed_output?.description ?? "(not found)");

  console.log("\n\n════════════════════════════════════════════════════════════");
  console.log("ARTIFACT 1 — FAQ JSON-LD SCHEMA BLOCK");
  console.log("════════════════════════════════════════════════════════════");
  const desc = mens?.parsed_output?.description ?? "";
  const ldStart = desc.indexOf('<script type="application/ld+json">');
  const ldEnd = desc.indexOf("</script>", ldStart);
  if (ldStart !== -1 && ldEnd !== -1) {
    console.log(desc.substring(ldStart, ldEnd + 9));
  } else {
    console.log("(no JSON-LD block found in description)");
  }

  console.log("\n\n════════════════════════════════════════════════════════════");
  console.log("ARTIFACT 4 — KARMALOOP STREETWEAR");
  console.log("template_name:", karmaloop?.template_name);
  console.log("version_id:", karmaloop?.id);
  console.log("════════════════════════════════════════════════════════════");
  console.log("FULL parsed_output.description:");
  console.log(karmaloop?.parsed_output?.description ?? "(not found)");

  console.log("\n\n════════════════════════════════════════════════════════════");
  console.log("ARTIFACT 5 — MLTD CONTEMPORARY");
  console.log("template_name:", mltd?.template_name);
  console.log("version_id:", mltd?.id);
  console.log("════════════════════════════════════════════════════════════");
  console.log("FULL parsed_output.description:");
  console.log(mltd?.parsed_output?.description ?? "(not found)");

  await app.delete();
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
