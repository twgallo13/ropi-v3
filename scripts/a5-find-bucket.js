#!/usr/bin/env node
/**
 * Try multiple bucket name patterns to find the correct one.
 */
"use strict";
const admin = require("firebase-admin");
const cred = JSON.parse(process.env.GCP_SA_KEY_DEV);

const FILE_PATH = "imports/weekly-operations/8616a4e1-4805-4abc-8f91-3db5d19a79aa/weekend426.csv";
const buckets = [
  "ropi-aoss-dev.appspot.com",
  "ropi-aoss-dev.firebasestorage.app",
  "gs://ropi-aoss-dev.appspot.com",
];

admin.initializeApp({
  credential: admin.credential.cert(cred),
  projectId: "ropi-aoss-dev",
});

var storage = admin.storage();

async function tryBucket(name) {
  try {
    var bucket = storage.bucket(name);
    var file = bucket.file(FILE_PATH);
    var [buf] = await file.download();
    console.log("SUCCESS with bucket:", name, "bytes:", buf.length);
    // Print first 200 chars
    console.log(buf.toString("utf-8").substring(0, 300));
    return buf;
  } catch (e) {
    console.log("FAIL with bucket:", name, "—", e.message);
    return null;
  }
}

async function main() {
  for (var b of buckets) {
    var buf = await tryBucket(b);
    if (buf) break;
  }
}

main().catch(function(e) { console.error(e.message); process.exit(1); });
