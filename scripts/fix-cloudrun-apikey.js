#!/usr/bin/env node
/**
 * Fixes the ANTHROPIC _API_KEY (space typo) → ANTHROPIC_API_KEY in Cloud Run.
 * Reads the current value from the misnamed env var, then updates the service
 * with the corrected name — no key value is printed to the terminal.
 */
"use strict";
const { GoogleAuth } = require('google-auth-library');

const keyJson = JSON.parse(process.env.GCP_SA_KEY_DEV);
const auth = new GoogleAuth({ credentials: keyJson, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const BASE = 'https://run.googleapis.com/v2/projects/ropi-aoss-dev/locations/us-central1/services/ropi-aoss-api';

async function fix() {
  const client = await auth.getClient();

  // GET current service
  console.log('📋 Fetching current Cloud Run service spec...');
  const getRes = await client.request({ url: BASE, method: 'GET' });
  const svc = getRes.data;

  const containers = svc.template?.containers || [];
  const envVars = containers[0]?.env || [];

  console.log('Current env var names:', envVars.map(e => `"${e.name}"`).join(', '));

  // Find the typo'd key
  const typoEntry = envVars.find(e => e.name === 'ANTHROPIC _API_KEY');
  const correctEntry = envVars.find(e => e.name === 'ANTHROPIC_API_KEY');

  if (!typoEntry) {
    if (correctEntry) {
      console.log('✅ ANTHROPIC_API_KEY already has the correct name — no fix needed.');
    } else {
      console.log('❌ Neither ANTHROPIC_API_KEY nor "ANTHROPIC _API_KEY" found in env vars!');
    }
    return;
  }

  if (!typoEntry.value) {
    console.error('❌ Typo entry "ANTHROPIC _API_KEY" exists but has no value — cannot fix automatically.');
    return;
  }

  console.log('🔧 Found "ANTHROPIC _API_KEY" (with space) — correcting to "ANTHROPIC_API_KEY"...');

  // Build corrected env var list: remove typo, add correct name
  const fixedEnvVars = envVars
    .filter(e => e.name !== 'ANTHROPIC _API_KEY' && e.name !== 'ANTHROPIC_API_KEY')
    .concat([{ name: 'ANTHROPIC_API_KEY', value: typoEntry.value }]);

  // Build minimal update payload — only update the container env vars
  const updateBody = {
    template: {
      containers: [
        {
          ...containers[0],
          env: fixedEnvVars,
        }
      ]
    }
  };

  console.log('📤 Patching Cloud Run service...');
  const patchRes = await client.request({
    url: BASE,
    method: 'PATCH',
    params: { updateMask: 'template.containers' },
    data: updateBody,
    headers: { 'Content-Type': 'application/json' },
  });

  const op = patchRes.data;
  console.log('⏳ Operation:', op.name || op.metadata?.name || 'patch submitted');

  // Poll until ready
  console.log('Waiting for new revision to be ready...');
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const checkRes = await client.request({ url: BASE, method: 'GET' });
    const updated = checkRes.data;
    const latestReady = updated.latestReadyRevision || '';
    const latestCreated = updated.latestCreatedRevision || '';
    const conditions = updated.conditions || [];
    const routeReady = conditions.find(c => c.type === 'RoutesReady');
    process.stdout.write(`  ${i + 1} latest=${latestCreated.split('/').pop()} routes=${routeReady?.state || '?'}\n`);
    if (routeReady?.state === 'CONDITION_SUCCEEDED' && latestReady === latestCreated) {
      // Verify fix
      const finalEnvVars = updated.template?.containers?.[0]?.env || [];
      const nowCorrect = finalEnvVars.find(e => e.name === 'ANTHROPIC_API_KEY');
      const stillTypo = finalEnvVars.find(e => e.name === 'ANTHROPIC _API_KEY');
      console.log('\n✅ Ready!');
      console.log('  ANTHROPIC_API_KEY present:', !!nowCorrect);
      console.log('  Typo "ANTHROPIC _API_KEY" removed:', !stillTypo);
      console.log('  Revision:', latestReady.split('/').pop());
      return;
    }
  }
  console.log('⚠️  Timed out waiting — check GCP Console for status.');
}

fix().catch(e => { console.error('Error:', e.message); process.exit(1); });
