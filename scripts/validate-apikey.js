#!/usr/bin/env node
/**
 * Validates the ANTHROPIC_API_KEY value in Cloud Run WITHOUT printing it.
 * Checks format (starts with sk-ant-, length, no whitespace).
 */
"use strict";
const { GoogleAuth } = require('google-auth-library');

const keyJson = JSON.parse(process.env.GCP_SA_KEY_DEV);
const auth = new GoogleAuth({ credentials: keyJson, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const BASE = 'https://run.googleapis.com/v2/projects/ropi-aoss-dev/locations/us-central1/services/ropi-aoss-api';

async function validate() {
  const client = await auth.getClient();
  const res = await client.request({ url: BASE, method: 'GET' });
  const svc = res.data;

  const containers = svc.template?.containers || [];
  const envVars = containers[0]?.env || [];

  // Check both possible name variants
  const correctEntry = envVars.find(e => e.name === 'ANTHROPIC_API_KEY');
  const typoEntry = envVars.find(e => e.name === 'ANTHROPIC _API_KEY');

  console.log('\n══════ ANTHROPIC_API_KEY Validation ══════');
  console.log(`Current revision: ${svc.latestReadyRevision?.split('/').pop()}`);
  console.log(`Env var "ANTHROPIC_API_KEY" present: ${!!correctEntry}`);
  console.log(`Env var "ANTHROPIC _API_KEY" (typo) present: ${!!typoEntry}`);

  const entry = correctEntry || typoEntry;
  if (!entry) {
    console.log('\n❌ Key not found in Cloud Run env vars at all!');
    return;
  }

  const val = entry.value || '';
  if (!val) {
    console.log('\n❌ Key entry exists but value is EMPTY!');
    return;
  }

  // Validate format without printing
  const hasPrefix = val.startsWith('sk-ant-api03-');
  const hasAnyWhitespace = /\s/.test(val);
  const hasLeadingTrailingSpace = val !== val.trim();
  const length = val.length;
  const firstFour = val.substring(0, 4);
  const lastFour = val.substring(val.length - 4);

  console.log(`\nKey analysis:`);
  console.log(`  Length: ${length} chars`);
  console.log(`  Starts with "sk-ant-api03-": ${hasPrefix ? '✅' : '❌'} (actual prefix: "${firstFour}...")`);
  console.log(`  Has whitespace/newline: ${hasAnyWhitespace ? '❌ YES — this is the problem!' : '✅ none'}`);
  console.log(`  Has leading/trailing space: ${hasLeadingTrailingSpace ? '❌ YES — this is the problem!' : '✅ none'}`);
  console.log(`  Last 4 chars: "...${lastFour}"`);

  if (hasAnyWhitespace || hasLeadingTrailingSpace) {
    console.log('\n🔧 ACTION NEEDED: The key value has whitespace characters that must be removed.');
  } else if (!hasPrefix) {
    console.log('\n❌ Key does not start with the expected Anthropic prefix "sk-ant-api03-".');
    console.log('   This is likely the wrong key or it was entered incorrectly.');
  } else if (length < 80) {
    console.log('\n⚠️  Key seems shorter than expected for an Anthropic key. May be truncated.');
  } else {
    console.log('\n✅ Key format looks valid. The 401 may indicate the key was revoked on Anthropic\'s side,');
    console.log('   or the key needs a few minutes to activate.');
  }
}

validate().catch(e => { console.error('Error:', e.message); process.exit(1); });
