/**
 * AI Weekly Advisory — Step 3.4
 *
 * Generates per-buyer weekly portfolio health advisories (Dead Wood,
 * Markdown Optimizer, Inventory Warning) + a global roll-up for
 * head_buyer / owner. Fires after the Weekly Operations Import commit
 * chain, uses the TALLY-116 adapter pattern (getActiveAdapter) — never a
 * direct Anthropic fetch — and reads its prompt text from the
 * `prompt_templates` collection (template_type === "advisory").
 */
import admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { mpnToDocId } from "./mpnUtils";
import { resolveAdapter, getAiConfigForWorkflow } from "../lib/aiConfig";

const db = () => admin.firestore();

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * "Week of Apr 14, 2026" — Monday of the given date's ISO week.
 */
export function getWeekLabel(d: Date): string {
  const day = d.getDay(); // 0=Sun .. 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  return `Week of ${monday.toLocaleDateString("en-US", opts)}`;
}

async function loadAdvisoryTemplate(templateName: string): Promise<string> {
  const snap = await db()
    .collection("prompt_templates")
    .where("template_name", "==", templateName)
    .where("is_active", "==", true)
    .limit(1)
    .get();

  if (snap.empty) {
    throw new Error(
      `Advisory template "${templateName}" not found — check prompt_templates collection`
    );
  }
  return snap.docs[0].data().prompt_instructions as string;
}

function interpolateTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] !== undefined ? vars[key] : ""
  );
}

function safeParseJson<T = any>(raw: string, fallback: T): T {
  try {
    const clean = (raw || "")
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    return JSON.parse(clean) as T;
  } catch {
    return fallback;
  }
}

/**
 * Resolve the product MPNs a buyer "owns" using the same three signals
 * the Buyer Performance Matrix uses (explicit buyer_assignments,
 * cadence_rules → cadence_assignments, products.buyer_id).
 */
async function resolveBuyerMpns(buyerUid: string): Promise<Set<string>> {
  const assigned = new Set<string>();

  // A) Explicit buyer_assignments
  try {
    const s = await db()
      .collection("buyer_assignments")
      .where("buyer_uid", "==", buyerUid)
      .get();
    s.forEach((d) => {
      const mpn = d.data()?.mpn;
      if (mpn) assigned.add(mpn);
    });
  } catch {
    /* non-fatal */
  }

  // B) Cadence rules → cadence_assignments (chunked `in` of rule ids)
  try {
    const rulesSnap = await db()
      .collection("cadence_rules")
      .where("owner_buyer_id", "==", buyerUid)
      .where("is_active", "==", true)
      .get();
    const ruleIds = rulesSnap.docs.map((r) => r.id);
    if (ruleIds.length > 0) {
      const chunks = chunkArray(ruleIds, 10);
      const snaps = await Promise.all(
        chunks.map((c) =>
          db()
            .collection("cadence_assignments")
            .where("matched_rule_id", "in", c)
            .get()
        )
      );
      for (const snap of snaps) {
        snap.forEach((d) => {
          const mpn = d.data()?.mpn;
          if (mpn) assigned.add(mpn);
        });
      }
    }
  } catch {
    /* non-fatal */
  }

  // C) Direct products.buyer_id
  try {
    const s = await db()
      .collection("products")
      .where("buyer_id", "==", buyerUid)
      .select("mpn")
      .get();
    s.forEach((d) => {
      const mpn = d.data()?.mpn;
      if (mpn) assigned.add(mpn);
    });
  } catch {
    /* non-fatal — buyer_id may be absent */
  }

  return assigned;
}

async function loadCompleteProducts(
  mpns: string[]
): Promise<FirebaseFirestore.DocumentData[]> {
  if (mpns.length === 0) return [];
  const refs = mpns.map((m) => db().collection("products").doc(mpnToDocId(m)));
  const refChunks = chunkArray(refs, 100);
  const out: FirebaseFirestore.DocumentData[] = [];
  for (const chunk of refChunks) {
    const docs = await db().getAll(...chunk);
    docs.forEach((d) => {
      if (d.exists) {
        const data = d.data()!;
        if (data.completion_state === "complete") out.push(data);
      }
    });
  }
  return out;
}

function totalInventory(p: any): number {
  return (p.inventory_store || 0) + (p.inventory_warehouse || 0);
}

function daysSince(ts: any): number {
  if (!ts || typeof ts.toMillis !== "function") return 0;
  return Math.floor((Date.now() - ts.toMillis()) / 86400000);
}

// ─────────────────────────────────────────────────────────────
// Per-buyer report
// ─────────────────────────────────────────────────────────────

async function generateBuyerReport(
  buyerUid: string,
  buyer: any,
  importBatchId: string,
  weekLabel: string
): Promise<void> {
  const buyerName: string =
    buyer.display_name || buyer.email || buyerUid;

  // Resolve the buyer's products
  const assignedMpns = await resolveBuyerMpns(buyerUid);
  if (assignedMpns.size === 0) {
    console.log(
      `[advisory] skipping ${buyerName} — no assigned products`
    );
    return;
  }
  const assignedProducts = await loadCompleteProducts(
    Array.from(assignedMpns)
  );
  if (assignedProducts.length === 0) {
    console.log(
      `[advisory] skipping ${buyerName} — no complete products`
    );
    return;
  }

  // ── Dead Wood: > 60 days, inv > 10, STR% < 5 — top 10 by inventory ──
  const deadWoodProducts = assignedProducts
    .filter((p) => {
      const dAge = daysSince(p.first_received_at);
      return dAge > 60 && totalInventory(p) > 10 && (p.str_pct || 0) < 5;
    })
    .sort((a, b) => totalInventory(b) - totalInventory(a))
    .slice(0, 10);

  // ── Inventory Warning: WOS < 2 weeks — top 10 by lowest WOS ──
  const inventoryWarnings = assignedProducts
    .filter((p) => p.wos !== null && p.wos !== undefined && p.wos < 2)
    .sort((a, b) => (a.wos || 99) - (b.wos || 99))
    .slice(0, 10);

  // ── Portfolio signals ──
  const avgGm =
    assignedProducts.length > 0
      ? assignedProducts.reduce((s, p) => s + (p.store_gm_pct || 0), 0) /
        assignedProducts.length
      : 0;
  const avgStr =
    assignedProducts.length > 0
      ? assignedProducts.reduce((s, p) => s + (p.str_pct || 0), 0) /
        assignedProducts.length
      : 0;
  const slowMovers = assignedProducts.filter((p) => p.is_slow_moving).length;
  const inCadenceQueue = assignedProducts.filter(
    (p) => p.cadence_state === "assigned"
  ).length;

  // ── Build prompt from template ──
  const deadWoodList =
    deadWoodProducts
      .map((p) => {
        const dAge = daysSince(p.first_received_at);
        const inv = totalInventory(p);
        return `- ${p.name || p.mpn} (${p.brand}): ${dAge} days old, ${inv} units, STR% ${(
          p.str_pct || 0
        ).toFixed(1)}%, WOS ${p.wos !== null && p.wos !== undefined ? p.wos.toFixed(1) : "?"}`;
      })
      .join("\n") || "None this week.";

  const warningList =
    inventoryWarnings
      .map((p) => {
        const inv = totalInventory(p);
        return `- ${p.name || p.mpn} (${p.brand}): ${
          (p.wos || 0).toFixed(1)
        } weeks of supply remaining, ${inv} units total`;
      })
      .join("\n") || "None this week.";

  const prefs = buyer.advisory_preferences || {};
  const focusArea: string = prefs.focus_area || "balanced";
  const formatPreference: string = prefs.format_preference || "prose";

  const templateInstructions = await loadAdvisoryTemplate(
    "Default Buyer Advisory"
  );
  const prompt = interpolateTemplate(templateInstructions, {
    buyer_name: buyerName,
    week_label: weekLabel,
    total_products: String(assignedProducts.length),
    avg_gm: String(round1(avgGm)),
    avg_str: String(round1(avgStr)),
    slow_movers: String(slowMovers),
    in_cadence_queue: String(inCadenceQueue),
    focus_area: focusArea,
    format_preference: formatPreference,
    dead_wood_list: deadWoodList,
    inventory_warning_list: warningList,
  });

  // ── AI call via aiConfig helper (TALLY-SETTINGS-UX Phase 3 / A.1) ──
  const advisoryConfig = await getAiConfigForWorkflow("weekly_advisory_report");
  const adapter = await resolveAdapter(
    advisoryConfig.provider_key,
    advisoryConfig.model_key,
    advisoryConfig.api_key_env_var_name
  );
  const systemPrompt = `You are a retail buying advisor for Shiekh Shoes. Be direct, specific, and actionable. Use exact product names and numbers. No filler language.`;
  let rawResponse = "";
  try {
    rawResponse = await adapter.complete(prompt, systemPrompt);
  } catch (err: any) {
    console.error(
      `[advisory] AI call failed for ${buyerName}:`,
      err?.message || err
    );
    rawResponse = "";
  }

  const parsed = safeParseJson<any>(rawResponse, {
    dead_wood: { summary: rawResponse || "" },
    markdown_optimizer: { summary: "", insights: [] },
    inventory_warning: { summary: "" },
  });

  const modelUsed = advisoryConfig.model_key;

  // ── Write report ──
  const reportRef = db().collection("weekly_advisory_reports").doc();
  await reportRef.set({
    report_id: reportRef.id,
    buyer_uid: buyerUid,
    buyer_name: buyerName,
    generated_at: FieldValue.serverTimestamp(),
    import_batch_id: importBatchId,
    week_label: weekLabel,
    dead_wood: {
      summary: parsed.dead_wood?.summary || "",
      products: deadWoodProducts.map((p) => ({
        mpn: p.mpn,
        name: p.name || "",
        brand: p.brand || "",
        department: p.department || "",
        days_old: daysSince(p.first_received_at),
        inventory_total: totalInventory(p),
        str_pct: p.str_pct || 0,
        wos: p.wos || 0,
        store_gm_pct: p.store_gm_pct || 0,
      })),
    },
    markdown_optimizer: {
      summary: parsed.markdown_optimizer?.summary || "",
      insights: Array.isArray(parsed.markdown_optimizer?.insights)
        ? parsed.markdown_optimizer.insights
        : [],
    },
    inventory_warning: {
      summary: parsed.inventory_warning?.summary || "",
      products: inventoryWarnings.map((p) => ({
        mpn: p.mpn,
        name: p.name || "",
        brand: p.brand || "",
        department: p.department || "",
        wos: p.wos || 0,
        inventory_total: totalInventory(p),
        weekly_sales_rate: p.weekly_sales_rate || 0,
      })),
    },
    global_health_summary: null,
    raw_prompt: prompt,
    model_used: modelUsed,
    read_by_buyer: false,
    read_at: null,
  });

  // ── Notification ──
  try {
    await db().collection("notifications").add({
      uid: buyerUid,
      type: "weekly_advisory",
      product_mpn: null,
      message: `Your weekly advisory for ${weekLabel} is ready`,
      read: false,
      created_at: FieldValue.serverTimestamp(),
    });
  } catch (err: any) {
    console.error(
      `[advisory] notification write failed for ${buyerName}:`,
      err?.message || err
    );
  }

  console.log(
    `[advisory] wrote report for ${buyerName} (report_id=${reportRef.id})`
  );
}

// ─────────────────────────────────────────────────────────────
// Global roll-up
// ─────────────────────────────────────────────────────────────

async function generateGlobalReport(
  importBatchId: string,
  weekLabel: string,
  recipientName: string
): Promise<void> {
  // Aggregate across the per-buyer reports we just wrote
  const reportsSnap = await db()
    .collection("weekly_advisory_reports")
    .where("import_batch_id", "==", importBatchId)
    .where("buyer_uid", "!=", "global")
    .get();

  const allDeadWood: any[] = [];
  const allWarnings: any[] = [];
  const buyerSummaries: string[] = [];

  reportsSnap.forEach((doc) => {
    const r = doc.data() as any;
    if (Array.isArray(r.dead_wood?.products))
      allDeadWood.push(...r.dead_wood.products);
    if (Array.isArray(r.inventory_warning?.products))
      allWarnings.push(...r.inventory_warning.products);
    if (r.buyer_name && r.dead_wood?.summary)
      buyerSummaries.push(`${r.buyer_name}: ${r.dead_wood.summary}`);
  });

  const dwSample = allDeadWood
    .slice(0, 5)
    .map(
      (p) =>
        `- ${p.name || p.mpn} (${p.brand}): ${p.inventory_total} units, ${p.str_pct}% STR`
    )
    .join("\n");

  const warnSample = allWarnings
    .slice(0, 5)
    .map((p) => `- ${p.name || p.mpn}: ${p.wos} weeks remaining`)
    .join("\n");

  const templateInstructions = await loadAdvisoryTemplate(
    "Default Global Advisory"
  );
  const prompt = interpolateTemplate(templateInstructions, {
    recipient_name: recipientName,
    week_label: weekLabel,
    buyer_summaries: buyerSummaries.join("\n") || "No buyer summaries this week.",
    dead_wood_count: String(allDeadWood.length),
    dead_wood_sample: dwSample || "None.",
    warning_count: String(allWarnings.length),
    warning_sample: warnSample || "None.",
  });

  const globalConfig = await getAiConfigForWorkflow("weekly_advisory_report");
  const adapter = await resolveAdapter(
    globalConfig.provider_key,
    globalConfig.model_key,
    globalConfig.api_key_env_var_name
  );
  let raw = "";
  try {
    raw = await adapter.complete(prompt);
  } catch (err: any) {
    console.error(
      "[advisory] global AI call failed:",
      err?.message || err
    );
  }
  const parsed = safeParseJson<any>(raw, {
    global_health_summary: raw || "",
  });

  const globalModelUsed = globalConfig.model_key;

  const reportRef = db().collection("weekly_advisory_reports").doc();
  await reportRef.set({
    report_id: reportRef.id,
    buyer_uid: "global",
    buyer_name: "Global Roll-Up",
    generated_at: FieldValue.serverTimestamp(),
    import_batch_id: importBatchId,
    week_label: weekLabel,
    dead_wood: { summary: "", products: allDeadWood.slice(0, 20) },
    markdown_optimizer: { summary: "", insights: [] },
    inventory_warning: { summary: "", products: allWarnings.slice(0, 20) },
    global_health_summary: parsed.global_health_summary || "",
    raw_prompt: prompt,
    model_used: globalModelUsed,
    read_by_buyer: false,
    read_at: null,
  });

  console.log(`[advisory] wrote global roll-up (report_id=${reportRef.id})`);
}

// ─────────────────────────────────────────────────────────────
// Public entry
// ─────────────────────────────────────────────────────────────

export async function generateWeeklyAdvisories(
  importBatchId: string
): Promise<{ buyer_reports: number; global_reports: number }> {
  const weekLabel = getWeekLabel(new Date());

  // Per-buyer reports (buyers + head_buyer)
  const buyersSnap = await db()
    .collection("users")
    .where("role", "in", ["buyer", "head_buyer"])
    .get();

  let buyerReports = 0;
  for (const doc of buyersSnap.docs) {
    const buyer = doc.data() || {};
    try {
      await generateBuyerReport(doc.id, buyer, importBatchId, weekLabel);
      buyerReports++;
    } catch (err: any) {
      console.error(
        `[advisory] buyer report failed for ${doc.id}:`,
        err?.message || err
      );
    }
  }

  // Global roll-up (consumed by head_buyer + owner + admin)
  let globalReports = 0;
  try {
    await generateGlobalReport(importBatchId, weekLabel, "Mike");
    globalReports = 1;
  } catch (err: any) {
    console.error(
      "[advisory] global roll-up failed:",
      err?.message || err
    );
  }

  return { buyer_reports: buyerReports, global_reports: globalReports };
}
