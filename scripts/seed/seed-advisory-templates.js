#!/usr/bin/env node
/**
 * Seed: prompt_templates — advisory templates (Step 3.4)
 * Seeds 2 documents with template_type === "advisory":
 *   - "Default Buyer Advisory"
 *   - "Default Global Advisory"
 * Idempotent — never touches non-advisory templates.
 */
"use strict";
const admin = require("firebase-admin");
const { initApp } = require("./utils");

const COLLECTION = "prompt_templates";

const BUYER_PROMPT = `You are writing a weekly portfolio health advisory for {{buyer_name}} at Shiekh Shoes.
{{week_label}}. Portfolio: {{total_products}} products, avg GM% {{avg_gm}}%, avg STR% {{avg_str}}%.
{{slow_movers}} slow movers flagged. {{in_cadence_queue}} products in cadence review queue.
Focus area: {{focus_area}}. Format preference: {{format_preference}}.

DEAD WOOD (high inventory, low velocity, 60+ days old):
{{dead_wood_list}}

INVENTORY WARNINGS (WOS < 2 weeks):
{{inventory_warning_list}}

Generate a weekly advisory report. Be direct, specific, and commercial. Reference actual products by name.
Adjust your tone and emphasis based on the buyer's focus area:
- balanced: equal weight across all three sections
- margin_health: lead with margin analysis and GM% observations
- inventory_clearance: lead with dead wood and velocity urgency

Format preference:
- prose: write flowing paragraphs
- bullet_points: use concise bullet lists for each section

Respond ONLY with valid JSON:
{
  "dead_wood": {
    "summary": "2-3 sentences about the dead wood situation. Name specific products and recommend actions."
  },
  "markdown_optimizer": {
    "summary": "2-3 sentences identifying the most important pricing pattern to address this week.",
    "insights": ["specific insight 1", "specific insight 2", "specific insight 3"]
  },
  "inventory_warning": {
    "summary": "2-3 sentences about reorder or sell-through urgency. Name specific products if any."
  }
}`;

const GLOBAL_PROMPT = `You are writing a weekly global portfolio health summary for {{recipient_name}} (Head Buyer) at Shiekh Shoes.
{{week_label}}.

Buyer summaries this week:
{{buyer_summaries}}

Top dead wood across all buyers ({{dead_wood_count}} products flagged):
{{dead_wood_sample}}

Inventory warnings across all buyers ({{warning_count}} products):
{{warning_sample}}

Write a 3-4 sentence global health summary covering the most important commercial risks and opportunities across the full buying team this week. Be direct and specific.

Respond ONLY with a JSON string: {"global_health_summary": "..."}`;

const TEMPLATES = [
  {
    template_name: "Default Buyer Advisory",
    template_type: "advisory",
    is_active: true,
    priority: 1,
    prompt_instructions: BUYER_PROMPT,
  },
  {
    template_name: "Default Global Advisory",
    template_type: "advisory",
    is_active: true,
    priority: 1,
    prompt_instructions: GLOBAL_PROMPT,
  },
];

async function main() {
  const app = initApp();
  const db = admin.firestore(app);
  const ts = () => admin.firestore.FieldValue.serverTimestamp();

  console.log(`\n🌱  Seeding advisory templates (${TEMPLATES.length}) …`);

  let created = 0, updated = 0;
  for (const t of TEMPLATES) {
    const docId = t.template_name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    const ref = db.collection(COLLECTION).doc(docId);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.set({ ...t, updated_at: ts() }, { merge: true });
      updated++;
    } else {
      await ref.set({
        ...t,
        created_by: "seed-script",
        created_at: ts(),
        updated_at: ts(),
      });
      created++;
    }
    console.log(`  ✅  ${t.template_name}  (${docId})`);
  }

  console.log(
    `\n✅  Done — ${created} created, ${updated} updated (${TEMPLATES.length} total)\n`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("❌  Seed failed:", err);
  process.exit(1);
});
