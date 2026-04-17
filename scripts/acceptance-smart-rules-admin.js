/**
 * Step 3.1 — Smart Rules Admin API smoke test.
 * Produces acceptance artifacts by exercising the new endpoints live.
 */
"use strict";
const admin = require("./seed/node_modules/firebase-admin");
const fs = require("fs");
const path = require("path");

const API_BASE = "https://ropi-aoss-api-j4kyg7fb4a-uc.a.run.app";

const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) {
      const k = t.substring(0, eq).trim();
      const v = t.substring(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY || "AIzaSyCWxHKfmKzIh3PLXimA1DAEObwUinE2gIU";
const PROJECT = "ropi-aoss-dev";

const sa = JSON.parse(process.env.GCP_SA_KEY_DEV);
admin.initializeApp({
  credential: admin.credential.cert(sa),
  projectId: PROJECT,
});
const db = admin.firestore();

async function adminIdToken() {
  const usersSnap = await db.collection("users").where("role", "==", "admin").limit(1).get();
  if (usersSnap.empty) throw new Error("No admin users");
  const uid = usersSnap.docs[0].id;
  const ct = await admin.auth().createCustomToken(uid, { admin: true, role: "admin" });
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: ct, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error("token exchange fail: " + JSON.stringify(data));
  return data.idToken;
}

async function api(method, p, body, tok) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const res = await fetch(API_BASE + p, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let json;
  try { json = JSON.parse(txt); } catch { json = txt; }
  return { status: res.status, body: json };
}

function div(t) {
  console.log("\n" + "═".repeat(68) + "\n  " + t + "\n" + "═".repeat(68));
}

async function main() {
  const tok = await adminIdToken();

  div("1) GET /api/v1/admin/smart-rules — list");
  const list = await api("GET", "/api/v1/admin/smart-rules", null, tok);
  console.log("status:", list.status, "total:", list.body.total);
  console.log("rules:");
  for (const r of list.body.rules) {
    console.log(
      `  p=${String(r.priority).padEnd(3)} ${r.rule_id.padEnd(42)} ${r.is_active ? "active" : "inactive"}  ${r.rule_name}`
    );
  }

  div("2) POST /:id/test — dry-run Nike override on a real MPN");
  // Use an existing product; fall back to a Nike test one if available
  const nikeSnap = await db.collection("products").where("brand", "==", "Nike").limit(1).get();
  let testMpn = "1006302";
  if (!nikeSnap.empty) testMpn = nikeSnap.docs[0].id;
  console.log("testing against MPN:", testMpn);

  // Force launch=true on the product for dry-run to match
  await db.collection("products").doc(testMpn).set({ launch: true }, { merge: true });

  const test1 = await api("POST", "/api/v1/admin/smart-rules/dim_nike_launch_shipping_override/test", { mpn: testMpn }, tok);
  console.log("status:", test1.status);
  console.log(JSON.stringify(test1.body, null, 2));

  div("3) POST /:id/test — mens-footwear dims dry-run");
  const test2 = await api("POST", "/api/v1/admin/smart-rules/dim_footwear_mens_dimensions/test", { mpn: testMpn }, tok);
  console.log("status:", test2.status);
  console.log(JSON.stringify(test2.body, null, 2));

  div("4) POST /api/v1/admin/smart-rules — create dummy rule");
  const created = await api(
    "POST",
    "/api/v1/admin/smart-rules",
    {
      rule_name: "ACCEPTANCE TEST — delete me",
      priority: 999,
      is_active: false,
      always_overwrite: false,
      conditions: [
        { field: "department", operator: "equals", value: "Footwear", logic: "AND", case_sensitive: true },
      ],
      actions: [{ target_field: "dimension_height", value: 99 }],
    },
    tok
  );
  console.log("status:", created.status);
  console.log("rule_id:", created.body.rule_id, "version:", created.body.version);

  div("5) DELETE (soft) the dummy rule");
  const del = await api("DELETE", `/api/v1/admin/smart-rules/${created.body.rule_id}`, null, tok);
  console.log("status:", del.status, JSON.stringify(del.body));

  await admin.app().delete();
}

main().catch((e) => { console.error(e); process.exit(1); });
