#!/usr/bin/env node
"use strict";
const admin = require("firebase-admin");
const keyJson = JSON.parse(process.env.GCP_SA_KEY_DEV);
const app = admin.initializeApp({ credential: admin.credential.cert(keyJson), projectId: "ropi-aoss-dev" });
const db = admin.firestore(app);

async function main() {
  const docId = "1006302";
  // Get ALL content_versions for this product
  const snap = await db.collection("products").doc(docId)
    .collection("content_versions").get();

  console.log(`Total content_versions for ${docId}: ${snap.size}\n`);

  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Sort newest first
  docs.sort((a, b) => (b.created_at?._seconds ?? 0) - (a.created_at?._seconds ?? 0));

  for (const d of docs) {
    console.log(`  ${d.id} | template=${d.template_name} | site_owner=${d.site_owner} | created=${new Date((d.created_at?._seconds ?? 0) * 1000).toISOString()}`);
  }

  // Find the Shiekh Men's Footwear version
  const mens = docs.find(d => d.template_name === "Shiekh Men's Footwear");
  if (!mens) {
    console.log("\nNo Shiekh Men's Footwear version found!");
    await app.delete();
    return;
  }

  console.log("\n\n════════════════════════════════════════════════════════════");
  console.log("SHIEKH MEN'S FOOTWEAR — FULL parsed_output.description");
  console.log("version_id:", mens.id);
  console.log("template_name:", mens.template_name);
  console.log("════════════════════════════════════════════════════════════\n");
  console.log(mens.parsed_output?.description ?? "(empty)");

  console.log("\n\n════════════════════════════════════════════════════════════");
  console.log("SHIEKH MEN'S FOOTWEAR — FAQ JSON-LD BLOCK");
  console.log("════════════════════════════════════════════════════════════\n");
  const desc = mens.parsed_output?.description ?? "";
  const ldStart = desc.indexOf('<script type="application/ld+json">');
  const ldEnd = desc.indexOf("</script>", ldStart);
  if (ldStart !== -1 && ldEnd !== -1) {
    console.log(desc.substring(ldStart, ldEnd + 9));
  } else {
    // Check all parsed_output fields for JSON-LD
    console.log("(not in description — checking all parsed_output fields...)");
    for (const [key, val] of Object.entries(mens.parsed_output || {})) {
      if (typeof val === "string" && val.includes("application/ld+json")) {
        console.log(`Found in parsed_output.${key}:`);
        const s = val.indexOf('<script type="application/ld+json">');
        const e = val.indexOf("</script>", s);
        console.log(val.substring(s, e + 9));
      }
    }
    // Also check if faq field has it
    if (mens.parsed_output?.faq) {
      console.log("\nparsed_output.faq field:");
      console.log(mens.parsed_output.faq);
    }
  }

  await app.delete();
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
