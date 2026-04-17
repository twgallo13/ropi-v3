#!/usr/bin/env node
"use strict";
const admin = require('firebase-admin');
const keyJson = JSON.parse(process.env.GCP_SA_KEY_DEV);
const app = admin.initializeApp({ credential: admin.credential.cert(keyJson), projectId: 'ropi-aoss-dev' });
const db = admin.firestore(app);
async function go() {
  const snap = await db.collection('prompt_templates').get();
  console.log('Active templates:', snap.size);
  for (const doc of snap.docs) {
    const d = doc.data();
    console.log('\n---', d.name);
    console.log('  ALL FIELDS:', JSON.stringify(d, null, 2));
    console.log('  docId:', doc.id);
  }
  await app.delete();
}
go().catch(e => { console.error(e.message); process.exit(1); });
