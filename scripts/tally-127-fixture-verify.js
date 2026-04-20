"use strict";
const { execSync } = require("child_process");
const https = require("https");
const PROJECT = "ropi-aoss-dev";
const MPNS = [
  "STEP21-AON-001",
  "STEP21-WIN-002",
  "STEP21-PROMO-003",
  "STEP21-OLD-004",
  "206991-6SW",
  "341-921CRM",
  "STEP22-ADIDAS-003",
  "STEP22-NIKE-002",
];

function getToken() {
  return execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
}
function fsGet(path, token) {
  return new Promise(function (resolve, reject) {
    const opts = {
      hostname: "firestore.googleapis.com",
      path: "/v1/projects/" + PROJECT + "/databases/(default)/documents" + path,
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    };
    https.request(opts, function (res) {
      let d = "";
      res.on("data", function (c) { d += c; });
      res.on("end", function () {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(d));
        else reject(new Error("HTTP " + res.statusCode + ": " + d));
      });
    }).on("error", reject).end();
  });
}
function unwrap(v) {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(unwrap);
  if ("mapValue" in v) {
    const o = {};
    const f = v.mapValue.fields || {};
    for (const k of Object.keys(f)) o[k] = unwrap(f[k]);
    return o;
  }
  return null;
}

(async function () {
  const token = getToken();
  console.log("MPN | completion_state | site_verification keys | shiekh.state | karmaloop.state | mltd.state | shiekh.image_url | shiekh.product_url | shiekh.addl(count) | mismatch_reason");
  console.log("---|---|---|---|---|---|---|---|---|---");
  for (const mpn of MPNS) {
    let doc;
    try { doc = await fsGet("/products/" + encodeURIComponent(mpn), token); }
    catch (e) { console.log(mpn + " | NOT FOUND | - | - | - | - | - | - | - | -"); continue; }
    const fields = doc.fields || {};
    const completion = unwrap(fields.completion_state);
    const sv = unwrap(fields.site_verification) || {};
    const keys = Object.keys(sv);
    const sh = sv.shiekh || {};
    const km = sv.karmaloop || {};
    const ml = sv.mltd || {};
    const addl = sh.additional_image_url
      ? sh.additional_image_url.split(",").filter(function (s) { return s.trim(); }).length
      : 0;
    const mr = sh.mismatch_reason || km.mismatch_reason || ml.mismatch_reason || "-";
    console.log([
      mpn,
      completion || "-",
      keys.length ? keys.join("+") : "(none)",
      sh.verification_state || "-",
      km.verification_state || "-",
      ml.verification_state || "-",
      sh.image_url ? "set" : "null",
      sh.product_url ? "set" : "null",
      String(addl),
      mr,
    ].join(" | "));
  }
})().catch(function (e) { console.error("FATAL:", e.message); process.exit(1); });
