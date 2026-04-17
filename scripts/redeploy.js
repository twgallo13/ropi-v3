const { GoogleAuth } = require("../scripts/seed/node_modules/google-auth-library");
const fs = require("fs");
const path = require("path");

// Load secrets from .env file — never pass secrets as CLI arguments
function loadEnvFile() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        const key = trimmed.substring(0, eq).trim();
        const val = trimmed.substring(eq + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
    }
    console.log("📄 Loaded .env file");
  }
}

async function redeploy() {
  loadEnvFile();
  const tag = process.argv[2] || "v4";
  const keyJson = JSON.parse(process.env.GCP_SA_KEY_DEV);
  const auth = new GoogleAuth({ credentials: keyJson, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const r = "us-central1", p = "ropi-aoss-dev", s = "ropi-aoss-api";
  const base = `https://${r}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${p}/services`;

  // Build env vars — secrets come from .env file or existing env, never from CLI args
  const envVars = [
    { name: "NODE_ENV", value: "development" },
    { name: "FIREBASE_PROJECT_ID", value: p },
    { name: "FIREBASE_STORAGE_BUCKET", value: p + "-imports" },
  ];
  if (process.env.ANTHROPIC_API_KEY) {
    envVars.push({ name: "ANTHROPIC_API_KEY", value: process.env.ANTHROPIC_API_KEY });
    console.log("🔑 ANTHROPIC_API_KEY included (from env/file)");
  }

  await client.request({ url: `${base}/${s}`, method: "PUT", data: {
    apiVersion: "serving.knative.dev/v1", kind: "Service",
    metadata: { name: s, namespace: p, annotations: { "run.googleapis.com/ingress": "all" } },
    spec: { template: {
      metadata: { annotations: { "autoscaling.knative.dev/maxScale": "3", "run.googleapis.com/startup-cpu-boost": "true" } },
      spec: { containerConcurrency: 80, timeoutSeconds: 300, containers: [{
        image: `${r}-docker.pkg.dev/${p}/ropi-api/${s}:${tag}`,
        ports: [{ containerPort: 8080 }],
        env: envVars,
        resources: { limits: { cpu: "1", memory: "512Mi" } }
      }] }
    }}
  }});
  
  console.log(`Updated to :${tag}, waiting for Ready...`);
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const g = await client.request({ url: `${base}/${s}`, method: "GET" });
    const ready = (g.data.status?.conditions || []).find(c => c.type === "Ready");
    if (ready?.status === "True") { console.log("✅ Ready"); return; }
    console.log(`... ${i + 1}`);
  }
  console.error("Timed out");
  process.exit(1);
}

redeploy().catch(e => { console.error(e.response ? JSON.stringify(e.response.data).substring(0, 300) : e.message); process.exit(1); });
