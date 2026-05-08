#!/usr/bin/env node
/**
 * A.5 Full product dump — root doc + attribute_values + site_targets
 * for 3 MPNs confirmed in batch 8616a4e1-4805-4abc-8f91-3db5d19a79aa.
 */
"use strict";
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.GCP_SA_KEY_DEV)), projectId: "ropi-aoss-dev" });
var db = admin.firestore();

var MPNS = ["1003868", "110307-1001", "110307-1702"];

function fmt(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  return v;
}

function fmtDoc(data) {
  var out = {};
  Object.keys(data).forEach(function(k) {
    var v = data[k];
    if (v && typeof v.toDate === "function") out[k] = v.toDate().toISOString();
    else if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) out[k] = v;
    else out[k] = v;
  });
  return out;
}

async function dumpMpn(mpn) {
  var docId = mpn.replace(/\//g, "__");
  var ref = db.collection("products").doc(docId);

  // Root
  var snap = await ref.get();
  var root = snap.exists ? fmtDoc(snap.data()) : null;

  // attribute_values
  var avSnap = await ref.collection("attribute_values").get();
  var attrValues = {};
  avSnap.docs.forEach(function(d) { attrValues[d.id] = fmtDoc(d.data()); });

  // site_targets
  var stSnap = await ref.collection("site_targets").get();
  var siteTargets = {};
  stSnap.docs.forEach(function(d) { siteTargets[d.id] = fmtDoc(d.data()); });

  // pricing_snapshots (just the target batch entry)
  var psSnap = await ref.collection("pricing_snapshots")
    .where("import_batch_id", "==", "8616a4e1-4805-4abc-8f91-3db5d19a79aa")
    .limit(1).get();
  var batchSnapshot = psSnap.empty ? null : fmtDoc(psSnap.docs[0].data());

  return { mpn, docId, root, attrValues, siteTargets, batchSnapshot };
}

async function main() {
  for (var mpn of MPNS) {
    var r = await dumpMpn(mpn);
    var SEP = "=".repeat(72);
    var sep = "-".repeat(72);

    console.log("\n" + SEP);
    console.log("MPN: " + r.mpn + "  |  docId: " + r.docId);
    console.log(SEP);

    console.log("\n── ROOT DOC ──");
    console.log(JSON.stringify(r.root, null, 2));

    console.log("\n── ATTRIBUTE_VALUES subcollection ──");
    var avKeys = Object.keys(r.attrValues).sort();
    console.log("Keys (" + avKeys.length + "): " + avKeys.join(", "));
    var shippingKeys = avKeys.filter(function(k) { return k.includes("shipping"); });
    if (shippingKeys.length > 0) {
      console.log("\n  ── SHIPPING keys (ALL) ──");
      shippingKeys.forEach(function(k) {
        console.log("  [" + k + "]: " + JSON.stringify(r.attrValues[k]));
      });
    } else {
      console.log("  shipping_override keys: NONE");
    }
    console.log("\n  ── Full attribute_values ──");
    console.log(JSON.stringify(r.attrValues, null, 2));

    console.log("\n── SITE_TARGETS subcollection ──");
    console.log(JSON.stringify(r.siteTargets, null, 2));

    console.log("\n── BATCH PRICING_SNAPSHOT (8616a4e1) ──");
    console.log(JSON.stringify(r.batchSnapshot, null, 2));
  }
  console.log("\n== Done ==\n");
}

main().catch(function(e) { console.error(e); process.exit(1); });
