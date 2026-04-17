#!/usr/bin/env node
"use strict";
const { GoogleAuth } = require('google-auth-library');

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

async function check() {
  const client = await auth.getClient();
  const url = 'https://run.googleapis.com/v2/projects/ropi-aoss-dev/locations/us-central1/services/ropi-aoss-api';
  const res = await client.request({ url, method: 'GET' });
  const svc = res.data;
  
  console.log('Service URI:', svc.uri);
  console.log('Latest ready revision:', svc.latestReadyRevision);
  console.log('Latest created revision:', svc.latestCreatedRevision);
  
  const traffic = svc.traffic || [];
  console.log('\nTraffic config:');
  traffic.forEach(t => console.log(' ', JSON.stringify(t)));
  
  const containers = svc.template?.containers || [];
  const envVars = containers[0]?.env || [];
  console.log('\nEnv vars in template:');
  envVars.forEach(e => {
    const hasVal = !!e.value;
    const isSecret = !!e.valueSource;
    console.log(`  ${e.name}: ${isSecret ? '[secret-ref]' : hasVal ? '[value set]' : '[empty]'}`);
  });
  
  console.log('\nService conditions:');
  (svc.conditions || []).forEach(c => {
    console.log(`  ${c.type}: ${c.state} — ${c.message || 'ok'}`);
  });
}

check().catch(e => { console.error('Error:', e.message); process.exit(1); });
