#!/usr/bin/env node
/**
 * List files in Firebase Storage bucket to find actual structure.
 */
"use strict";
const admin = require("firebase-admin");
const cred = JSON.parse(process.env.GCP_SA_KEY_DEV);
admin.initializeApp({ credential: admin.credential.cert(cred), projectId: "ropi-aoss-dev" });
var storage = admin.storage();

async function main() {
  // Try the .firebasestorage.app bucket
  var bucket = storage.bucket("ropi-aoss-dev.firebasestorage.app");
  
  // List files under imports/
  var [files] = await bucket.getFiles({ prefix: "imports/", maxResults: 20 });
  console.log("Files under imports/ (" + files.length + "):");
  files.forEach(function(f) { console.log("  " + f.name); });

  if (files.length === 0) {
    // Try root listing
    var [allFiles] = await bucket.getFiles({ maxResults: 20 });
    console.log("All files (" + allFiles.length + "):");
    allFiles.forEach(function(f) { console.log("  " + f.name); });
  }
}

main().catch(function(e) { console.error(e.message); process.exit(1); });
