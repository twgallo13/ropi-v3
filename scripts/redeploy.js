const { GoogleAuth } = require("../scripts/seed/node_modules/google-auth-library");

async function redeploy() {
  const tag = process.argv[2] || "v4";
  const keyJson = JSON.parse(process.env.GCP_SA_KEY_DEV);
  const auth = new GoogleAuth({ credentials: keyJson, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const r = "us-central1", p = "ropi-aoss-dev", s = "ropi-aoss-api";
  const base = `https://${r}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${p}/services`;
  
  await client.request({ url: `${base}/${s}`, method: "PUT", data: {
    apiVersion: "serving.knative.dev/v1", kind: "Service",
    metadata: { name: s, namespace: p, annotations: { "run.googleapis.com/ingress": "all" } },
    spec: { template: {
      metadata: { annotations: { "autoscaling.knative.dev/maxScale": "3", "run.googleapis.com/startup-cpu-boost": "true" } },
      spec: { containerConcurrency: 80, timeoutSeconds: 300, containers: [{
        image: `${r}-docker.pkg.dev/${p}/ropi-api/${s}:${tag}`,
        ports: [{ containerPort: 8080 }],
        env: [{ name: "NODE_ENV", value: "development" }, { name: "FIREBASE_PROJECT_ID", value: p }],
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
