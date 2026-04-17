/**
 * aiEnrichment.ts — Import Intelligence Layer AI hooks.
 *
 * Non-blocking post-import enrichment:
 *   POST /api/v1/ai-enrich/name/:mpn    — generate consumer-facing name
 *                                         when name_source === "rics_short_desc"
 *   POST /api/v1/ai-enrich/color/:mpn   — fill descriptive_color when blank
 *   POST /api/v1/ai-enrich/run-pending  — sweep products flagged
 *                                         needs_ai_name / needs_ai_color
 */

import { Router, Request, Response } from "express";
import admin from "firebase-admin";
import { mpnToDocId } from "../services/mpnUtils";
import { getActiveAdapter } from "../services/aiDescribe";
import { getNikeIndustryMpn } from "../services/ricsParser";

const router = Router();
const db = admin.firestore;

interface ProductCtx {
  mpn?: string;
  brand?: string;
  rics_short_desc?: string;
  rics_color?: string;
  rics_long_desc?: string;
  department?: string;
  gender?: string;
  class?: string;
  category?: string;
  name?: string;
}

async function loadProductCtx(mpn: string): Promise<ProductCtx | null> {
  const firestore = admin.firestore();
  const ref = firestore.collection("products").doc(mpnToDocId(mpn));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const src = await ref
    .collection("attribute_values")
    .doc("source_inputs")
    .get();
  const sd = src.exists ? src.data() || {} : {};
  return {
    mpn: data.mpn,
    brand: data.brand,
    name: data.name,
    department: data.department,
    gender: data.gender,
    class: data.class,
    category: data.category,
    rics_short_desc: sd.rics_short_desc || sd.rics_short_description,
    rics_long_desc: sd.rics_long_desc || sd.rics_long_description,
    rics_color: sd.rics_color,
  };
}

async function writeAttr(
  mpn: string,
  key: string,
  value: any,
  origin: string
) {
  const firestore = admin.firestore();
  const ref = firestore
    .collection("products")
    .doc(mpnToDocId(mpn))
    .collection("attribute_values")
    .doc(key);
  const existing = await ref.get();
  if (existing.exists && existing.data()?.verification_state === "Human-Verified") {
    return { skipped: true, reason: "Human-Verified" };
  }
  await ref.set(
    {
      value,
      origin_type: "AI",
      origin_detail: origin,
      verification_state: "System-Applied",
      written_at: db.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { skipped: false };
}

async function enrichName(mpn: string): Promise<any> {
  const ctx = await loadProductCtx(mpn);
  if (!ctx) return { error: "not_found" };

  // Nike/Jordan MPN normalization for the prompt
  const industryMpn = getNikeIndustryMpn(mpn, ctx.brand || "");
  const mpnLine = industryMpn ? `${mpn} (industry: ${industryMpn})` : mpn;

  const prompt = `You are a product naming specialist for Shiekh Shoes.
Given this product information, generate a clean, SEO-friendly product name
following brand and industry standards.

MPN: ${mpnLine}
Brand: ${ctx.brand || "?"}
RICS Short Description: ${ctx.rics_short_desc || ""}
Department: ${ctx.department || "?"}
Gender: ${ctx.gender || "?"}
Class: ${ctx.class || "?"}
Category: ${ctx.category || "?"}

Rules:
- Use Title Case
- Include brand name first if not already present
- Include key identifying details (colorway, edition, model number where relevant)
- Keep under 80 characters
- Do not include "Men's", "Women's" etc. — those are handled by product attributes
- For Nike: the MPN uses a space where industry standard uses a dash
  (e.g. store MPN "HV5060 800" corresponds to industry "HV5060-800").
  Use the dashed version when searching for product information.

Respond with ONLY the product name, nothing else.`;

  const adapter = await getActiveAdapter();
  const raw = await adapter.complete(prompt);
  const cleaned = raw.trim().replace(/^["']|["']$/g, "");

  // Update top-level name + attribute
  const firestore = admin.firestore();
  const ref = firestore.collection("products").doc(mpnToDocId(mpn));
  await ref.set(
    { name: cleaned, name_source: "ai_generated", needs_ai_name: false },
    { merge: true }
  );
  const result = await writeAttr(mpn, "name", cleaned, "AI Name Enrichment");
  return { mpn, name: cleaned, ...result };
}

async function enrichColor(mpn: string): Promise<any> {
  const ctx = await loadProductCtx(mpn);
  if (!ctx) return { error: "not_found" };
  const prompt = `Given the RICS color code '${ctx.rics_color || ""}' for product '${mpn}' from brand '${ctx.brand || ""}', what is the correct consumer-facing color name? Respond with ONLY the color name.`;

  const adapter = await getActiveAdapter();
  const raw = await adapter.complete(prompt);
  const cleaned = raw.trim().replace(/^["']|["']$/g, "");

  const firestore = admin.firestore();
  const ref = firestore.collection("products").doc(mpnToDocId(mpn));
  await ref.set({ needs_ai_color: false }, { merge: true });
  const result = await writeAttr(
    mpn,
    "descriptive_color",
    cleaned,
    "AI Color Enrichment"
  );
  return { mpn, descriptive_color: cleaned, ...result };
}

router.post("/name/:mpn", async (req: Request, res: Response) => {
  try {
    const out = await enrichName(req.params.mpn);
    if (out.error) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.status(200).json(out);
  } catch (err: any) {
    console.error("AI name enrichment error:", err);
    res.status(500).json({ error: err?.message || "AI enrichment failed" });
  }
});

router.post("/color/:mpn", async (req: Request, res: Response) => {
  try {
    const out = await enrichColor(req.params.mpn);
    if (out.error) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.status(200).json(out);
  } catch (err: any) {
    console.error("AI color enrichment error:", err);
    res.status(500).json({ error: err?.message || "AI enrichment failed" });
  }
});

router.post("/run-pending", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.body?.limit) || 25, 100);
    const firestore = admin.firestore();
    const [nameSnap, colorSnap] = await Promise.all([
      firestore
        .collection("products")
        .where("needs_ai_name", "==", true)
        .limit(limit)
        .get(),
      firestore
        .collection("products")
        .where("needs_ai_color", "==", true)
        .limit(limit)
        .get(),
    ]);
    const nameResults = [];
    for (const d of nameSnap.docs) {
      const mpn = d.data().mpn;
      if (!mpn) continue;
      try {
        nameResults.push(await enrichName(mpn));
      } catch (e: any) {
        nameResults.push({ mpn, error: e?.message });
      }
    }
    const colorResults = [];
    for (const d of colorSnap.docs) {
      const mpn = d.data().mpn;
      if (!mpn) continue;
      try {
        colorResults.push(await enrichColor(mpn));
      } catch (e: any) {
        colorResults.push({ mpn, error: e?.message });
      }
    }
    res.status(200).json({
      names_processed: nameResults.length,
      colors_processed: colorResults.length,
      names: nameResults,
      colors: colorResults,
    });
  } catch (err: any) {
    console.error("AI run-pending error:", err);
    res.status(500).json({ error: err?.message || "AI sweep failed" });
  }
});

export default router;
