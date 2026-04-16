const { GoogleAuth } = require('./seed/node_modules/google-auth-library');
const fs = require('fs');

async function download() {
  const keyJson = JSON.parse(process.env.GCP_SA_KEY_DEV);
  const auth = new GoogleAuth({
    credentials: keyJson,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  const client = await auth.getClient();

  // Export Google Sheet as CSV
  const fileId = '1GWhRF_tVGSoLFbWwDNaNHH31-KyjOXbq1zPF6Z_FZIg';
  const url = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv&gid=0`;

  const res = await client.request({
    url,
    responseType: 'arraybuffer'
  });

  fs.writeFileSync('/workspaces/ropi-v3/scripts/shiekh-real-ro.csv',
    Buffer.from(res.data));
  console.log('Downloaded to scripts/shiekh-real-ro.csv');

  // Quick stats
  const content = Buffer.from(res.data).toString('utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  console.log('Lines (incl header):', lines.length);
  console.log('Header columns:', lines[0].split(',').length);
}

download().catch(e => { console.error(e.message); process.exit(1); });
