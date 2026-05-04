import { Router, Response } from "express";
import admin from "firebase-admin";
import { randomUUID } from "crypto";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { mpnToDocId, docIdToMpn } from "../services/mpnUtils";
import { queueForPricingExport } from "../services/pricingExportQueue";
import { deriveVerificationState, getStalenessThresholdDays, StalenessCache } from "../lib/staleness";
import { parseAdditionalImageUrls } from "../lib/parseAdditionalImageUrls";
import {
  loadDepartmentRegistry,
  isDepartmentValueAllowed,
  normalizeDepartment,
  type DepartmentRegistryEntry,
} from "./departmentRegistry";
import {
  loadBrandRegistry,
  matchBrand,
  type BrandRegistryEntry,
} from "../lib/brandRegistry";
import { buildSearchTokens } from "../services/searchTokens";
import {
  getRequiredFieldKeys,
  computeCompletionProgress,
  computeCompletion,
  stampCompletionOnProduct,
} from "../services/completionCompute";
import {
  cascadeDeleteProduct,
  PRODUCT_SUBCOLLECTIONS,
} from "../services/productCascadeDelete";

const router = Router();
const db = admin.firestore;

// ────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────
// NOTE — getRequiredFieldKeys + computeCompletionProgress moved to
// services/completionCompute.ts (TALLY-P1, Ruling M 2026-04-23). The
// signatures are preserved so existing in-file call sites work unchanged.

/** Compute high-priority launch fields. */
function computeLaunchPriority(
  productData: any,
  launchWindowDays: number
): { is_high_priority: boolean; launch_days_remaining: number | null } {
  // Check linked_launch_date on the product
  const launchDate = productData.linked_launch_date;
  if (!launchDate) {
    return { is_high_priority: false, launch_days_remaining: null };
  }

  let launchMs: number;
  if (launchDate.toDate) {
    launchMs = launchDate.toDate().getTime();
  } else if (launchDate instanceof Date) {
    launchMs = launchDate.getTime();
  } else {
    launchMs = new Date(launchDate).getTime();
  }

  const now = Date.now();
  const daysRemaining = Math.ceil((launchMs - now) / (1000 * 60 * 60 * 24));

  if (daysRemaining <= launchWindowDays && daysRemaining >= 0) {
    return { is_high_priority: true, launch_days_remaining: daysRemaining };
  }

  return { is_high_priority: false, launch_days_remaining: null };
}

/** Get the launch_priority_window_days from admin_settings. */
async function getLaunchWindowDays(
  firestore: admin.firestore.Firestore
): Promise<number> {
  const doc = await firestore
    .collection("admin_settings")
    .doc("launch_priority_window_days")
    .get();
  return doc.exists ? (doc.data()!.value as number) : 7;
}

/** Build the site_owner value — first site_target's site_id, or top-level data.site_owner. */
async function getSiteOwner(
  firestore: admin.firestore.Firestore,
  docId: string,
  data?: FirebaseFirestore.DocumentData | null
): Promise<string | null> {
  const snap = await firestore
    .collection("products")
    .doc(docId)
    .collection("site_targets")
    .limit(1)
    .get();
  if (!snap.empty) {
    return snap.docs[0].data().site_id || snap.docs[0].id;
  }
  // Fallback: top-level site_owner (normalized to lowercase for filter comparison)
  if (data && typeof data.site_owner === "string" && data.site_owner.trim()) {
    return data.site_owner.trim();
  }
  return null;
}

// ────────────────────────────────────────────────
//  GET /api/v1/products
// ────────────────────────────────────────────────
//
// TALLY-PRODUCT-LIST-UX Phase 3A — dynamic sort + offset pagination.
//   - Replaces hardcoded orderBy("first_received_at","asc") with allowlisted
//     ?sort + ?dir params (see SORT_ALLOWLIST / DIR_ALLOWLIST below).
//   - Replaces ?cursor (Firestore startAfter) with ?page + ?limit offset
//     pagination. Response now includes total_count + page + limit +
//     total_pages from a parallel .count() aggregation (1 read regardless
//     of result set size — cheaper than scanning).
//   - Removes legacy in-memory re-sorts (priority / first_received /
//     last_modified / completion_pct). All sorting is now server-side.
//
// TALLY-PRODUCT-LIST-UX Phase 3B (2026-04-26) — the transitional alias
// layer that translated legacy FE tokens (last_modified / first_received /
// completion_pct) and accepted-and-ignored ?cursor has been removed. FE
// (ProductListPage + CompletionQueuePage) now emits canonical sort fields
// (updated_at / first_received_at / completion_percent) and pages via
// ?page= offsets.

const SORT_ALLOWLIST = new Set([
  "mpn",
  "brand_key",
  "department_key",
  "site_owner",
  "first_received_at",
  "updated_at",
  "completion_percent",
]);
const DIR_ALLOWLIST = new Set(["asc", "desc"]);

router.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const firestore = admin.firestore();
    const {
      completion_state,
      site_owner,
      brand,
      department,
      image_status,
      search,
      sort: sortRaw = "first_received_at",
      dir: dirRaw,
      limit: limitStr = "25",
      page: pageStr = "1",
    } = req.query as Record<string, string | undefined>;

    // ── Sort + dir resolution (Phase 3B — strict allowlist, no aliases) ─
    const sortField = sortRaw;
    const sortDir: string = dirRaw || "asc";

    if (!SORT_ALLOWLIST.has(sortField)) {
      res.status(400).json({
        error: `Invalid sort field "${sortRaw}". Allowed: ${[...SORT_ALLOWLIST].join(", ")}`,
      });
      return;
    }
    if (!DIR_ALLOWLIST.has(sortDir)) {
      res.status(400).json({
        error: `Invalid sort dir "${sortDir}". Allowed: asc, desc`,
      });
      return;
    }

    // ── Pagination params ───────────────────────────────────────────────
    const limitNum = Math.min(Math.max(parseInt(limitStr || "25", 10) || 25, 1), 100);
    const pageNum = Math.max(parseInt(pageStr || "1", 10) || 1, 1);
    const offset = (pageNum - 1) * limitNum;

    const searchTerm = (search || "").toLowerCase().trim();
    const useSearch = searchTerm.length >= 2;

    // ── Build the Firestore query ───────────────────────────────────────
    //
    // All filters are applied database-side via where() clauses against
    // pre-stamped fields (search_tokens, brand_key, department_key,
    // completion_state, site_owner). When search is active, brand/dept/
    // site_owner equality filters run in-memory because the array-contains
    // + equality combinatoric explosion would require unbounded indexes;
    // search narrows the candidate set enough that this is bounded.
    let query: admin.firestore.Query = firestore.collection("products");

    if (useSearch) {
      query = query.where("search_tokens", "array-contains", searchTerm);
    }
    if (completion_state && completion_state !== "all") {
      query = query.where("completion_state", "==", completion_state);
    }
    if (!useSearch) {
      // TALLY-PRODUCT-LIST-UX Phase 0.5 — filter on registry-resolved
      // brand_key / department_key (frontend now passes brand_key values).
      if (brand) query = query.where("brand_key", "==", brand);
      if (department) query = query.where("department_key", "==", department);
      if (site_owner) query = query.where("site_owner", "==", site_owner);
    }

    // Phase 3A — dynamic server-side sort. Indexes covering every
    // (filter set × sort field) combination shipped in commit c0ae5e4.
    query = query.orderBy(sortField, sortDir as "asc" | "desc");

    // Phase 3A — offset pagination. Search path still oversamples because
    // in-memory brand/dept/site filters can drop items post-fetch; a single
    // page may return fewer than limitNum items when search + filters
    // combine. (Inherited behavior; not worse than pre-3A cursor path.)
    const fetchLimit = useSearch ? limitNum * 2 + 25 : limitNum;
    const snap = await query.offset(offset).limit(fetchLimit).get();

    // Load required fields + launch window in parallel
    const [requiredFields, launchWindowDays] = await Promise.all([
      getRequiredFieldKeys(firestore),
      getLaunchWindowDays(firestore),
    ]);

    // ── Build response items ────────────────────────────────────────────
    const items: any[] = [];

    for (const doc of snap.docs) {
      const data = doc.data();
      const docId = doc.id;

      // In-memory filters: only the ones we couldn't push down.
      // (When search is active, brand/dept/site still need in-memory check
      // because Firestore won't index every combo with array-contains.)
      if (useSearch) {
        // TALLY-PRODUCT-LIST-UX Phase 0.5 — compare against pre-stamped
        // brand_key / department_key (frontend params are brand_key values).
        if (brand && (data.brand_key || "") !== brand) continue;
        if (department && (data.department_key || "") !== department) continue;
      }

      // site_owner & image_status are still in-memory because they live in
      // subcollections. These should be migrated to top-level fields if they
      // become hot filters.
      const productSiteOwner = await getSiteOwner(firestore, docId, data);
      if (useSearch && site_owner) {
        if ((productSiteOwner || "").toLowerCase() !== site_owner.toLowerCase()) continue;
      }
      if (image_status) {
        const imgAttr = await firestore
          .collection("products").doc(docId)
          .collection("attribute_values").doc("image_status").get();
        const imgVal = imgAttr.exists ? imgAttr.data()?.value : null;
        if (!imgVal || String(imgVal).toUpperCase() !== image_status.toUpperCase()) continue;
      }

      const completion_progress = await computeCompletionProgress(
        firestore, docId, requiredFields
      );

      const { is_high_priority, launch_days_remaining } = computeLaunchPriority(
        data, launchWindowDays
      );

      // TALLY-PRODUCT-LIST-UX Phase 2A — fetch image_status and primary_image_url
      // in parallel from the attribute_values subcollection (single logical read
      // step; no added serial round-trip / no read amplification). Frink pre-audit
      // 2026-04-25 + PO Ruling 2A 2026-04-25.
      const attrValuesRef = firestore
        .collection("products").doc(docId)
        .collection("attribute_values");
      const [imgSnap, primaryImageSnap] = await Promise.all([
        attrValuesRef.doc("image_status").get(),
        attrValuesRef.doc("primary_image_url").get(),
      ]);
      const imageStatusVal = imgSnap.exists ? imgSnap.data()?.value || "NO" : "NO";
      const primaryImageUrlRaw = primaryImageSnap.exists
        ? primaryImageSnap.data()?.value
        : null;
      // Normalize empty string → null at the backend (cleaner contract for FE).
      const primaryImageUrlVal: string | null =
        typeof primaryImageUrlRaw === "string" && primaryImageUrlRaw.trim().length > 0
          ? primaryImageUrlRaw
          : null;

      let deptVal = typeof data.department === "string" && data.department ? data.department : "";
      if (!deptVal) {
        const deptSnap = await firestore
          .collection("products").doc(docId)
          .collection("attribute_values").doc("department").get();
        deptVal = deptSnap.exists ? deptSnap.data()?.value || "" : "";
      }

      const classSnap = await firestore
        .collection("products").doc(docId)
        .collection("attribute_values").doc("class").get();
      const classVal = classSnap.exists ? classSnap.data()?.value || "" : "";

      items.push({
        mpn: data.mpn || docIdToMpn(docId),
        doc_id: docId,
        name: data.name || "",
        brand: data.brand || "",
        department: deptVal,
        class: classVal,
        site_owner: productSiteOwner || "",
        completion_state: data.completion_state || "incomplete",
        image_status: imageStatusVal,
        primary_image_url: primaryImageUrlVal,
        pricing_domain_state: data.pricing_domain_state || "pending",
        map_conflict_active: !!data.map_conflict_active,
        is_map_protected: !!data.is_map_protected,
        first_received_at: data.first_received_at?.toDate?.()?.toISOString() || null,
        updated_at: data.updated_at?.toDate?.()?.toISOString() || null,
        is_high_priority,
        launch_days_remaining,
        completion_progress,
        // TALLY-P1 — 5 pre-computed completion fields. Stored-or-fallback
        // (PO Ruling N3 2026-04-23): use stamped value when present; fall
        // back to inline-computed values from completion_progress so the
        // payload is regression-safe during the deploy/backfill window.
        completion_percent: data.completion_percent !== undefined
          ? data.completion_percent
          : completion_progress.pct,
        blocker_count: data.blocker_count !== undefined
          ? data.blocker_count
          : (completion_progress.total_required - completion_progress.completed),
        ai_blocker_count: data.ai_blocker_count !== undefined
          ? data.ai_blocker_count
          : 0,
        next_action_hint: data.next_action_hint !== undefined
          ? data.next_action_hint
          : "",
        completion_last_computed_at:
          data.completion_last_computed_at?.toDate?.()?.toISOString() || null,
      });

      if (items.length >= limitNum) break;
    }

    // Phase 3A — in-memory re-sorts removed. Sort is now applied
    // server-side via query.orderBy(sortField, sortDir) above. Legacy
    // priority/first_received/last_modified/completion_pct branches
    // deleted.

    // ── Total count for the same filter set ────────────────────────────
    // Firestore .count() aggregation: 1 read regardless of result-set
    // size, dramatically cheaper than scanning. Mirrors the page query's
    // filter set exactly so total_count and items align (search-path
    // in-memory filters are NOT mirrored — see search-path note below).
    let countQuery: admin.firestore.Query = firestore.collection("products");
    if (useSearch) {
      countQuery = countQuery.where("search_tokens", "array-contains", searchTerm);
    }
    if (completion_state && completion_state !== "all") {
      countQuery = countQuery.where("completion_state", "==", completion_state);
    }
    if (!useSearch) {
      // TALLY-PRODUCT-LIST-UX Phase 0.5 — count must mirror the page query
      // filter set (brand_key / department_key) or page-vs-total diverges.
      if (brand) countQuery = countQuery.where("brand_key", "==", brand);
      if (department) countQuery = countQuery.where("department_key", "==", department);
      if (site_owner) countQuery = countQuery.where("site_owner", "==", site_owner);
    }

    let total = items.length;
    try {
      const countSnap = await countQuery.count().get();
      total = countSnap.data().count;
    } catch (countErr) {
      // Aggregation failure should not break the list response.
      console.warn("count() failed, falling back to items.length:", countErr);
    }

    const totalPages = limitNum > 0 ? Math.ceil(total / limitNum) : 0;

    res.status(200).json({
      items,
      // Phase 3A canonical pagination contract.
      total_count: total,
      page: pageNum,
      limit: limitNum,
      total_pages: totalPages,
    });
  } catch (err: any) {
    console.error("GET /products error:", err);
    res.status(500).json({ error: "Failed to fetch products." });
  }
});

// ────────────────────────────────────────────────
//  GET /api/v1/products/export.csv — Phase 5B
//
//  Filter-respecting bulk CSV export (PO Rulings 5B.1–5B.4 2026-04-25).
//  - Reuses the same query-param contract as GET / (sort, dir,
//    completion_state, site_owner, brand, department, image_status, search).
//    Filter parser is DUPLICATED INLINE here (PO Ruling 5B.1 + Frink C1):
//    duplication keeps blast radius zero on the live list endpoint; a
//    future refactor can dedupe once both routes are stable.
//  - 5000-row hard cap (PO 5B.3). On overflow → HTTP 413
//    {"error":"Result exceeds 5000 rows. Narrow your filter and re-export.",
//     "matched": <count>}.
//  - count() failure aborts with HTTP 500 (Frink D1) — does NOT mirror the
//    list endpoint's items.length fallback (that pattern is correct for
//    paginated display, but for unbounded bulk export it would silently
//    uncap the fetch).
//  - 15 columns, RFC-4180 inline-quoted (Frink C2 — json2csv is alpha-pinned
//    in package.json and stays unused; csv-parse is read-side only).
//  - Mounted BEFORE /:mpn so the path is not shadowed (Phase 4A precedent).
//  - requireAuth only; FE narrows via existing isExport role gate.
//  - No firestore.indexes.json change; reuses Phase 3A indexes verbatim.
// ────────────────────────────────────────────────

const EXPORT_ROW_CAP = 5000;
const EXPORT_PAGE_SIZE = 100;

const EXPORT_COLUMNS = [
  "mpn",
  "brand",
  "name",
  "department",
  "site_owner",
  "completion_state",
  "completion_percent",
  "scom",
  "scom_sale",
  "standard_shipping_override",
  "expedited_shipping_override",
  "first_received_at",
  "updated_at",
  "rics_offer",
  "rics_retail",
] as const;

/**
 * RFC-4180 CSV cell escape. Wraps in double quotes only when the value
 * contains a comma, double quote, CR, or LF; doubles internal quotes.
 * null / undefined / empty → empty string (no "null" / "undefined" tokens).
 */
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  if (s === "") return "";
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

router.get("/export.csv", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const firestore = admin.firestore();
    const {
      completion_state,
      site_owner,
      brand,
      department,
      image_status,
      search,
      sort: sortRaw = "first_received_at",
      dir: dirRaw,
    } = req.query as Record<string, string | undefined>;

    // ── Sort + dir resolution (mirror list endpoint discipline) ─────────
    const sortField = sortRaw;
    const sortDir: string = dirRaw || "asc";
    if (!SORT_ALLOWLIST.has(sortField)) {
      res.status(400).json({
        error: `Invalid sort field "${sortRaw}". Allowed: ${[...SORT_ALLOWLIST].join(", ")}`,
      });
      return;
    }
    if (!DIR_ALLOWLIST.has(sortDir)) {
      res.status(400).json({
        error: `Invalid sort dir "${sortDir}". Allowed: asc, desc`,
      });
      return;
    }

    const searchTerm = (search || "").toLowerCase().trim();
    const useSearch = searchTerm.length >= 2;

    // ── Build filtered query (DUPLICATED INLINE — see header note) ──────
    let query: admin.firestore.Query = firestore.collection("products");
    if (useSearch) {
      query = query.where("search_tokens", "array-contains", searchTerm);
    }
    if (completion_state && completion_state !== "all") {
      query = query.where("completion_state", "==", completion_state);
    }
    if (!useSearch) {
      if (brand) query = query.where("brand_key", "==", brand);
      if (department) query = query.where("department_key", "==", department);
      if (site_owner) query = query.where("site_owner", "==", site_owner);
    }
    query = query.orderBy(sortField, sortDir as "asc" | "desc");

    // ── count() — Frink D1: failure ABORTS, does NOT fall back. ─────────
    let matched: number;
    try {
      const countSnap = await query.count().get();
      matched = countSnap.data().count;
    } catch (countErr) {
      console.error("export.csv count() failed:", countErr);
      res.status(500).json({ error: "Could not estimate result size; export aborted." });
      return;
    }

    if (matched > EXPORT_ROW_CAP) {
      res.status(413).json({
        error: `Result exceeds ${EXPORT_ROW_CAP} rows. Narrow your filter and re-export.`,
        matched,
      });
      return;
    }

    // ── Fetch rows in EXPORT_PAGE_SIZE pages, cap-bounded ───────────────
    const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    let offset = 0;
    while (offset < matched && docs.length < EXPORT_ROW_CAP) {
      const pageSnap = await query.offset(offset).limit(EXPORT_PAGE_SIZE).get();
      if (pageSnap.empty) break;
      docs.push(...pageSnap.docs);
      if (pageSnap.size < EXPORT_PAGE_SIZE) break;
      offset += EXPORT_PAGE_SIZE;
    }

    // ── In-memory filters (mirror list endpoint, sans pagination cap) ───
    const requiredFields = await getRequiredFieldKeys(firestore);
    const rows: string[] = [];

    for (const doc of docs) {
      const data = doc.data();
      const docId = doc.id;

      if (useSearch) {
        if (brand && (data.brand_key || "") !== brand) continue;
        if (department && (data.department_key || "") !== department) continue;
      }

      const productSiteOwner = await getSiteOwner(firestore, docId, data);
      if (useSearch && site_owner) {
        if ((productSiteOwner || "").toLowerCase() !== site_owner.toLowerCase()) continue;
      }
      if (image_status) {
        const imgAttr = await firestore
          .collection("products").doc(docId)
          .collection("attribute_values").doc("image_status").get();
        const imgVal = imgAttr.exists ? imgAttr.data()?.value : null;
        if (!imgVal || String(imgVal).toUpperCase() !== image_status.toUpperCase()) continue;
      }

      // department fallback (mirror list endpoint)
      let deptVal = typeof data.department === "string" && data.department ? data.department : "";
      if (!deptVal) {
        const deptSnap = await firestore
          .collection("products").doc(docId)
          .collection("attribute_values").doc("department").get();
        deptVal = deptSnap.exists ? deptSnap.data()?.value || "" : "";
      }

      // 4 attribute_values reads in parallel (mirror list endpoint pattern)
      const attrRef = firestore.collection("products").doc(docId).collection("attribute_values");
      const [scomSnap, scomSaleSnap, stdShipSnap, expShipSnap] = await Promise.all([
        attrRef.doc("scom").get(),
        attrRef.doc("scom_sale").get(),
        attrRef.doc("standard_shipping_override").get(),
        attrRef.doc("expedited_shipping_override").get(),
      ]);
      const scomVal = scomSnap.exists ? scomSnap.data()?.value : null;
      const scomSaleVal = scomSaleSnap.exists ? scomSaleSnap.data()?.value : null;
      const stdShipVal = stdShipSnap.exists ? stdShipSnap.data()?.value : null;
      const expShipVal = expShipSnap.exists ? expShipSnap.data()?.value : null;

      // completion_percent — stamped-then-computed (Frink C3, parity with list)
      let completionPct: number;
      if (data.completion_percent !== undefined) {
        completionPct = data.completion_percent;
      } else {
        const progress = await computeCompletionProgress(firestore, docId, requiredFields);
        completionPct = progress.pct;
      }

      const cells = [
        csvEscape(data.mpn || docIdToMpn(docId)),
        csvEscape(data.brand || ""),
        csvEscape(data.name || ""),
        csvEscape(deptVal),
        csvEscape(productSiteOwner || ""),
        csvEscape(data.completion_state || "incomplete"),
        csvEscape(String(completionPct)),
        csvEscape(scomVal === null || scomVal === undefined ? "" : String(scomVal)),
        csvEscape(scomSaleVal === null || scomSaleVal === undefined ? "" : String(scomSaleVal)),
        csvEscape(stdShipVal === null || stdShipVal === undefined ? "" : String(stdShipVal)),
        csvEscape(expShipVal === null || expShipVal === undefined ? "" : String(expShipVal)),
        csvEscape(data.first_received_at?.toDate?.()?.toISOString() || ""),
        csvEscape(data.updated_at?.toDate?.()?.toISOString() || ""),
        csvEscape(data.rics_offer === null || data.rics_offer === undefined ? "" : String(data.rics_offer)),
        csvEscape(data.rics_retail === null || data.rics_retail === undefined ? "" : String(data.rics_retail)),
      ];
      rows.push(cells.join(","));
    }

    // Header row — column names contain no special chars; no escape needed.
    const header = EXPORT_COLUMNS.join(",");
    const body = [header, ...rows].join("\r\n") + "\r\n";

    // Filename — server (UTC) date. Content-Disposition wins over the
    // browser's <a download="…"> string (cosmetic UTC skew documented in PR).
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="products-${today}.csv"`);
    res.status(200).send(body);
  } catch (err: any) {
    console.error("GET /products/export.csv error:", err);
    res.status(500).json({ error: "Export failed." });
  }
});

// ────────────────────────────────────────────────
//  GET /api/v1/products/:mpn
// ────────────────────────────────────────────────
router.get("/:mpn", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const firestore = admin.firestore();
    const { mpn } = req.params;
    const docId = mpnToDocId(mpn);

    // Fetch product document
    const productRef = firestore.collection("products").doc(docId);
    const productSnap = await productRef.get();

    if (!productSnap.exists) {
      res.status(404).json({ error: `Product with MPN "${mpn}" not found.` });
      return;
    }

    const data = productSnap.data()!;

    // Fetch subcollections in parallel
    const stalenessCache: StalenessCache = {};
    const [avSnap, stSnap, requiredFields, launchWindowDays, activeRegistrySnap, stalenessThreshold] = await Promise.all([
      productRef.collection("attribute_values").get(),
      productRef.collection("site_targets").get(),
      getRequiredFieldKeys(firestore),
      getLaunchWindowDays(firestore),
      firestore.collection("site_registry").where("is_active", "==", true).get(),
      getStalenessThresholdDays(stalenessCache),
    ]);

    // Build attribute_values map
    const attribute_values: Record<string, any> = {};
    const source_inputs: Record<string, any> = {};
    avSnap.docs.forEach((d) => {
      if (d.id === "source_inputs") {
        const siData = d.data();
        Object.assign(source_inputs, siData);
        // Convert timestamps
        for (const key of Object.keys(source_inputs)) {
          if (source_inputs[key]?.toDate) {
            source_inputs[key] = source_inputs[key].toDate().toISOString();
          }
        }
      } else {
        const attrData = d.data();
        attribute_values[d.id] = {
          value: attrData.value,
          origin_type: attrData.origin_type || null,
          origin_detail: attrData.origin_detail || null,
          verification_state: attrData.verification_state || null,
          written_at: attrData.written_at?.toDate?.()?.toISOString() || null,
        };
      }
    });

    // Build site_targets array
    const site_targets = stSnap.docs.map((d) => ({
      site_id: d.data().site_id || d.id,
      domain: d.data().domain || "",
      active: d.data().active ?? true,
    }));

    // Compute completion progress
    const completion_progress = await computeCompletionProgress(
      firestore, docId, requiredFields
    );

    // Compute launch priority
    const { is_high_priority, launch_days_remaining } = computeLaunchPriority(
      data, launchWindowDays
    );

    // Serialize timestamps
    const serializeTs = (ts: any) => ts?.toDate?.()?.toISOString() || null;

    // ── Build site_verification response map (§7.1.6) ──────────────────
    const storedSv: Record<string, any> = data.site_verification || {};
    const productSiteOwner: string | null =
      typeof data.site_owner === "string" && data.site_owner.trim()
        ? data.site_owner.trim()
        : null;

    // Build registry lookup indexed by site_key
    const registryBySiteKey: Record<string, { display_name: string; domain: string; priority: number }> = {};
    activeRegistrySnap.docs.forEach((rDoc) => {
      const rd = rDoc.data();
      registryBySiteKey[rDoc.id] = {
        display_name: rd.display_name || rDoc.id,
        domain: rd.domain || "",
        priority: typeof rd.priority === "number" ? rd.priority : 999,
      };
    });

    // Build per-site entries: real data where present, unverified stubs otherwise
    const svEntries: Array<{ key: string; entry: Record<string, any> }> = [];
    for (const siteKey of Object.keys(registryBySiteKey)) {
      const reg = registryBySiteKey[siteKey];
      const stored = storedSv[siteKey];

      if (stored) {
        // Real entry — derive state with staleness helper
        const derivedState = deriveVerificationState(
          stored.verification_state,
          stored.last_verified_at,
          stalenessThreshold,
        );
        svEntries.push({
          key: siteKey,
          entry: {
            site_key: siteKey,
            site_display_name: reg.display_name,
            site_domain: reg.domain,
            verification_state: derivedState,
            product_url: stored.product_url || null,
            image_url: stored.image_url || null,
            additional_image_url_parsed: parseAdditionalImageUrls(stored.additional_image_url),
            last_verified_at: serializeTs(stored.last_verified_at),
            verification_date: stored.verification_date || null,
            mismatch_reason: stored.mismatch_reason || null,
            reviewer_uid: stored.reviewer_uid || null,
            reviewer_action_at: serializeTs(stored.reviewer_action_at),
          },
        });
      } else {
        // Unverified stub
        svEntries.push({
          key: siteKey,
          entry: {
            site_key: siteKey,
            site_display_name: reg.display_name,
            site_domain: reg.domain,
            verification_state: "unverified",
            product_url: null,
            image_url: null,
            additional_image_url_parsed: [],
            last_verified_at: null,
            verification_date: null,
            mismatch_reason: null,
            reviewer_uid: null,
            reviewer_action_at: null,
          },
        });
      }
    }

    // Sort: primary site first (matches site_owner), then by registry priority asc
    svEntries.sort((a, b) => {
      const aIsPrimary = a.key === productSiteOwner ? 0 : 1;
      const bIsPrimary = b.key === productSiteOwner ? 0 : 1;
      if (aIsPrimary !== bIsPrimary) return aIsPrimary - bIsPrimary;
      return (registryBySiteKey[a.key]?.priority ?? 999) - (registryBySiteKey[b.key]?.priority ?? 999);
    });

    // Convert sorted array to ordered map
    const site_verification: Record<string, any> = {};
    for (const { key, entry } of svEntries) {
      site_verification[key] = entry;
    }

    res.status(200).json({
      mpn: data.mpn || docIdToMpn(docId),
      doc_id: docId,
      name: data.name || "",
      brand: data.brand || "",
      sku: data.sku || "",
      status: data.status || "",
      scom: data.scom ?? 0,
      scom_sale: data.scom_sale ?? 0,
      rics_retail: data.rics_retail ?? 0,
      rics_offer: data.rics_offer ?? 0,
      inventory_store: data.inventory_store ?? 0,
      inventory_warehouse: data.inventory_warehouse ?? 0,
      inventory_whs: data.inventory_whs ?? 0,
      completion_state: data.completion_state || "incomplete",
      pricing_domain_state: data.pricing_domain_state || "pending",
      product_is_active: data.product_is_active ?? true,
      site_owner: site_targets.length > 0 ? site_targets[0].site_id : "",
      primary_site_key: data.site_owner || null,
      import_batch_id: data.import_batch_id || null,
      is_map_protected: !!data.is_map_protected,
      map_price: data.map_price ?? null,
      map_promo_price: data.map_promo_price ?? null,
      map_start_date: data.map_start_date ?? null,
      map_end_date: data.map_end_date ?? null,
      map_is_always_on: data.map_is_always_on ?? null,
      map_conflict_active: !!data.map_conflict_active,
      map_conflict_reason: data.map_conflict_reason ?? null,
      map_conflict_held: !!data.map_conflict_held,
      map_removal_proposed: !!data.map_removal_proposed,
      first_received_at: serializeTs(data.first_received_at),
      updated_at: serializeTs(data.updated_at),
      is_high_priority,
      launch_days_remaining,
      completion_progress,
      // TALLY-P1 — 5 pre-computed completion fields. Stored-or-fallback
      // (PO Ruling N3 2026-04-23). See list handler for rationale.
      completion_percent: data.completion_percent !== undefined
        ? data.completion_percent
        : completion_progress.pct,
      blocker_count: data.blocker_count !== undefined
        ? data.blocker_count
        : (completion_progress.total_required - completion_progress.completed),
      ai_blocker_count: data.ai_blocker_count !== undefined
        ? data.ai_blocker_count
        : 0,
      next_action_hint: data.next_action_hint !== undefined
        ? data.next_action_hint
        : "",
      completion_last_computed_at:
        data.completion_last_computed_at?.toDate?.()?.toISOString() || null,
      attribute_values,
      site_targets,
      source_inputs,
      site_verification,
    });
  } catch (err: any) {
    console.error("GET /products/:mpn error:", err);
    res.status(500).json({ error: "Failed to fetch product." });
  }
});

// ────────────────────────────────────────────────
//  POST /api/v1/products/:mpn/attributes/:field_key
//  Save a single attribute with full provenance (TALLY-044)
// ────────────────────────────────────────────────
router.post("/:mpn/attributes/:field_key", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const firestore = admin.firestore();
    const { mpn, field_key: fieldKey } = req.params;
    const { value, action } = req.body;
    const userId = req.user?.uid;

    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // 1. Validate field_key exists in attribute_registry and is active
    const regDoc = await firestore.collection("attribute_registry").doc(fieldKey).get();
    if (!regDoc.exists || !regDoc.data()!.active) {
      res.status(400).json({ error: `Field "${fieldKey}" not found in attribute registry` });
      return;
    }
    const regData = regDoc.data()!;

    // 1b. TALLY-DEPARTMENT-REGISTRY (PO Ruling A + Ruling G):
    //     Enum-source validation. When attribute_registry doc has
    //     enum_source set, validate the incoming value against the named
    //     registry's ACTIVE entries (is_active: true only). Soft-deactivated
    //     entries reject NEW writes; existing product values are NOT
    //     re-validated (no batch invocation surface). Fallback to
    //     dropdown_options array is preserved for forward compatibility but
    //     is NOT enforced here today (only enum_source path is gated, to
    //     bound blast radius — other dropdown fields keep prior behavior).
    //     Skipped for the "verify" action (no value change being introduced).
    // 4B captures the matched registry entries here so they can be reused
    // for canonicalization + root mirroring below without re-loading the
    // registries. Stays null for fields whose attribute_registry doc has no
    // enum_source set (e.g., short_description / long_description).
    let matchedBrandEntry: BrandRegistryEntry | null = null;
    let matchedDeptEntry: DepartmentRegistryEntry | null = null;
    let matchedSiteOwnerKey: string | null = null;
    if (
      action !== "verify" &&
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      const enumSource =
        typeof regData.enum_source === "string" ? regData.enum_source : null;
      if (enumSource === "department_registry") {
        const entries = await loadDepartmentRegistry();
        if (!isDepartmentValueAllowed(value, entries)) {
          res.status(400).json({
            error: `Value "${value}" is not an active "${fieldKey}" — must match an active entry in ${enumSource}.`,
          });
          return;
        }
        // 4B — locate the matched active entry so we can mirror display_name
        // + canonical key to the root product doc. Match logic mirrors
        // resolveAllowedDepartmentValues: key | display_name | aliases,
        // case-insensitive, whitespace-trimmed.
        const v = normalizeDepartment(String(value));
        matchedDeptEntry = entries.find((e) => {
          if (!e.is_active) return false;
          if (normalizeDepartment(e.key) === v) return true;
          if (normalizeDepartment(e.display_name) === v) return true;
          for (const a of e.aliases || []) {
            if (normalizeDepartment(a) === v) return true;
          }
          return false;
        }) || null;
      } else if (enumSource === "brand_registry") {
        const registry = await loadBrandRegistry();
        const entry = matchBrand(String(value), registry);
        if (!entry) {
          res.status(400).json({
            error: `Value "${value}" is not an active "${fieldKey}" — must match an active entry in ${enumSource}.`,
          });
          return;
        }
        matchedBrandEntry = entry;
      } else if (enumSource === "site_registry") {
        // Match against active site_registry doc IDs (case-insensitive,
        // whitespace-trimmed). Doc ID IS the canonical site_owner key.
        const norm = String(value).trim().toLowerCase();
        if (!norm) {
          res.status(400).json({
            error: `Value "${value}" is not an active "${fieldKey}" — must match an active entry in ${enumSource}.`,
          });
          return;
        }
        const sitesSnap = await firestore
          .collection("site_registry")
          .where("is_active", "==", true)
          .get();
        const activeIds = sitesSnap.docs.map((d) => d.id);
        const matched = activeIds.find((id) => id.toLowerCase() === norm) || null;
        if (!matched) {
          res.status(400).json({
            error: `Value "${value}" is not an active "${fieldKey}" — must match an active entry in ${enumSource}.`,
          });
          return;
        }
        matchedSiteOwnerKey = matched;
      }
    }

    const docId = mpnToDocId(mpn);

    // Verify product exists
    const productRef = firestore.collection("products").doc(docId);
    const productSnap = await productRef.get();
    if (!productSnap.exists) {
      res.status(404).json({ error: `Product with MPN "${mpn}" not found.` });
      return;
    }

    // Correction 1 (Step 2.5) — capture existing value BEFORE writing.
    // This is read once here and re-used so history shows old_value → new_value.
    const preWriteSnap = await productRef
      .collection("attribute_values")
      .doc(fieldKey)
      .get();
    const oldValue = preWriteSnap.exists ? preWriteSnap.data()?.value ?? null : null;
    const oldVerificationState = preWriteSnap.exists
      ? preWriteSnap.data()?.verification_state ?? null
      : null;

    // Determine the final value to write
    let finalValue = value;
    if (action === "verify") {
      // Verify action: keep existing value, just stamp Human-Verified
      if (!preWriteSnap.exists || preWriteSnap.data()?.value === undefined) {
        res.status(400).json({ error: `Cannot verify field "${fieldKey}" — no existing value` });
        return;
      }
      finalValue = value !== undefined ? value : preWriteSnap.data()!.value;
    } else {
      if (value === undefined) {
        res.status(400).json({ error: "value is required in request body" });
        return;
      }
      // 4B — canonicalize finalValue when enum_source matched. Brand persists
      // entry.display_name (display-cased). Site_owner persists matched doc
      // ID. Department leaves attribute_values value as user-input (root
      // mirror still uses entry.display_name).
      if (matchedBrandEntry) {
        finalValue = matchedBrandEntry.display_name;
      } else if (matchedSiteOwnerKey) {
        finalValue = matchedSiteOwnerKey;
      }
    }

    // 3. Write to attribute_values with full provenance stamp (TALLY-044)
    await productRef
      .collection("attribute_values")
      .doc(fieldKey)
      .set(
        {
          value: finalValue,
          origin_type: "Human",
          origin_detail: `User: ${userId}`,
          verification_state: "Human-Verified",
          written_at: db.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    // 4. If field_key is the name field — also update the top-level product document
    if (fieldKey === "name" || fieldKey === "product_name") {
      await productRef.set(
        {
          name: finalValue,
          updated_at: db.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    // 4a. TALLY-PRODUCT-LIST-UX Phase 4B — root mirroring extensions.
    //     List filters and sorts read root.<key> fields, so any field that
    //     contributes to filter/search/display must be mirrored here.
    //     - brand: mirror display_name to root.brand AND brand_key to
    //       root.brand_key. Both are required because list filters use
    //       brand_key, while UI cells display root.brand.
    //     - department: mirror display_name to root.department AND key to
    //       root.department_key. Same reason.
    //     - sku: mirror to root.sku.
    //     - site_owner: mirror canonical doc ID to root.site_owner.
    if (fieldKey === "brand" && matchedBrandEntry) {
      await productRef.set(
        {
          brand: matchedBrandEntry.display_name,
          brand_key: matchedBrandEntry.brand_key,
          updated_at: db.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } else if (fieldKey === "department" && matchedDeptEntry) {
      await productRef.set(
        {
          department: matchedDeptEntry.display_name,
          department_key: matchedDeptEntry.key,
          updated_at: db.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } else if (fieldKey === "sku") {
      await productRef.set(
        {
          sku: finalValue,
          updated_at: db.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } else if (fieldKey === "site_owner") {
      await productRef.set(
        {
          site_owner: finalValue,
          updated_at: db.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    // 4b. TALLY-107 — scom / scom_sale also mirror to top-level product document
    //     so downstream reads (ProductDetailPage, exportSerializer) see the new value.
    if (fieldKey === "scom" || fieldKey === "scom_sale") {
      const numericValue =
        typeof finalValue === "number"
          ? finalValue
          : Number(finalValue) || 0;
      await productRef.set(
        {
          [fieldKey]: numericValue,
          updated_at: db.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      // Step 2.1 / TALLY-112 — any SCOM edit feeds the Pricing Export queue
      try {
        await queueForPricingExport(mpn, "scom_edit", userId, null);
      } catch (qerr: any) {
        console.error("queueForPricingExport (scom_edit) failed:", qerr);
      }
    }

    // 4d. TALLY-SHIPPING-OVERRIDE-CLEANUP — shipping override mirror.
    //     standard_shipping_override / expedited_shipping_override mirror to
    //     the top-level product document so list filters, exporters, and
    //     downstream reads see the new value. Unlike Block 4b (scom/scom_sale),
    //     null / "" / undefined preserves null at the root — clearing an
    //     override is a valid operation, NOT a coercion to 0.
    if (
      fieldKey === "standard_shipping_override" ||
      fieldKey === "expedited_shipping_override"
    ) {
      let numericValue: number | null;
      if (finalValue === null || finalValue === undefined || finalValue === "") {
        numericValue = null;
      } else if (typeof finalValue === "number") {
        numericValue = finalValue;
      } else {
        const parsed = Number(finalValue);
        numericValue = Number.isFinite(parsed) ? parsed : null;
      }
      await productRef.set(
        {
          [fieldKey]: numericValue,
          updated_at: db.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      // PR 1.2 — shipping override edits feed the Pricing Export queue with
      // a distinct reason so RetailOps export pipeline can route correctly.
      try {
        await queueForPricingExport(mpn, "shipping_override_edit", userId, null);
      } catch (qerr: any) {
        console.error("queueForPricingExport (shipping_override_edit) failed:", qerr);
      }
    }

    // 4c. TALLY-107 — MAP auto-populate:
    //     When `map` is set to a MAP-active value, auto-populate scom / scom_sale
    //     from rics_retail so the product is immediately priced at MAP.
    let mapAutoPopulate:
      | { triggered: true; rics_retail: number }
      | { triggered: false }
      = { triggered: false };
    if (fieldKey === "map") {
      const mapValStr =
        finalValue === null || finalValue === undefined
          ? ""
          : String(finalValue).trim();
      const upper = mapValStr.toUpperCase();
      const isMapActive =
        mapValStr !== "" && upper !== "NO" && upper !== "DISALLOWED";

      if (isMapActive) {
        const freshSnap = await productRef.get();
        const pdata = freshSnap.data() || {};
        const ricsRetail = Number(pdata.rics_retail) || 0;
        if (ricsRetail > 0) {
          const provenance = {
            value: ricsRetail,
            origin_type: "Human",
            origin_detail: `MAP auto-populate — User: ${userId}`,
            verification_state: "Human-Verified",
            written_at: db.FieldValue.serverTimestamp(),
          };
          await productRef
            .collection("attribute_values")
            .doc("scom")
            .set(provenance, { merge: true });
          await productRef
            .collection("attribute_values")
            .doc("scom_sale")
            .set(provenance, { merge: true });
          await productRef.set(
            {
              scom: ricsRetail,
              scom_sale: ricsRetail,
              updated_at: db.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          mapAutoPopulate = { triggered: true, rics_retail: ricsRetail };
        }
      }
    }

    // 4d. TALLY-PRODUCT-LIST-UX Phase 4B — search_tokens reindex.
    //     buildSearchTokens reads {mpn, name, brand, sku, department} from
    //     the product root. After mirroring above, refresh the post-write
    //     root doc and rebuild the token set so list search picks up the
    //     edit immediately. Skip for fields that don't contribute to tokens
    //     (short_description / long_description / site_owner).
    const SEARCH_TOKEN_FIELDS = new Set([
      "mpn",
      "name",
      "product_name",
      "brand",
      "sku",
      "department",
    ]);
    if (SEARCH_TOKEN_FIELDS.has(fieldKey)) {
      try {
        const refreshed = await productRef.get();
        const rdata = refreshed.data() || {};
        await productRef.set(
          {
            search_tokens: buildSearchTokens({
              mpn: rdata.mpn || mpn,
              name: rdata.name || null,
              brand: rdata.brand || null,
              sku: rdata.sku || null,
              department: rdata.department || null,
            }),
          },
          { merge: true }
        );
      } catch (tokErr: any) {
        console.warn("search_tokens_reindex_failed", { mpn, err: tokErr?.message });
      }
    }

    // 5. Write audit_log entry
    await firestore.collection("audit_log").add({
      product_mpn: mpn,
      event_type: action === "verify" ? "field_verified" : "field_edited",
      field_key: fieldKey,
      old_value: oldValue,
      old_verification_state: oldVerificationState,
      new_value: finalValue,
      new_verification_state: "Human-Verified",
      acting_user_id: userId,
      origin_type: "Human",
      source_type: "human_edit",
      created_at: db.FieldValue.serverTimestamp(),
    });

    // 6. Return updated completion_progress
    const requiredFields = await getRequiredFieldKeys(firestore);
    const completion_progress = await computeCompletionProgress(
      firestore, docId, requiredFields
    );

    // TALLY-P1 — stamp 5-field completion projection (best-effort).
    // TALLY-NEXT-ACTION-HINT-HOTFIX (Path 1): capture computeCompletion result so
    // the freshly-computed next_action_hint can be returned in the response payload
    // (avoids a second read; falls back to "" if the stamp path failed).
    let nextActionHint = "";
    try {
      const result = await computeCompletion(mpn);
      nextActionHint = result.next_action_hint;
      await stampCompletionOnProduct(productRef, result);
    } catch (stampErr: any) {
      console.warn("completion_stamp_failed", { mpn, err: stampErr?.message });
    }

    res.status(200).json({
      field_key: fieldKey,
      value: finalValue,
      verification_state: "Human-Verified",
      completion_progress,
      next_action_hint: nextActionHint,
      map_auto_populate: mapAutoPopulate,
    });
  } catch (err: any) {
    console.error("POST /products/:mpn/attributes/:field_key error:", err);
    res.status(500).json({ error: "Failed to save field." });
  }
});

// ────────────────────────────────────────────────
//  GET /api/v1/products/:mpn/history — Step 2.5 Part 2
//  Returns audit_log entries for this product, newest first.
//  Query params: start_date, end_date, field, acting_user_id, source_type
// ────────────────────────────────────────────────
router.get(
  "/:mpn/history",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const firestore = admin.firestore();
      const { mpn } = req.params;
      const {
        start_date,
        end_date,
        field,
        acting_user_id,
        source_type,
      } = req.query as Record<string, string | undefined>;

      let q: FirebaseFirestore.Query = firestore
        .collection("audit_log")
        .where("product_mpn", "==", mpn);

      if (start_date) {
        q = q.where("created_at", ">=", new Date(start_date));
      }
      if (end_date) {
        q = q.where("created_at", "<=", new Date(end_date));
      }

      // Firestore can't compose arbitrary equality with ranges without indexes —
      // do remaining filters client-side.
      const snap = await q.orderBy("created_at", "desc").limit(500).get();
      let entries = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          event_type: data.event_type || "unknown",
          field_key: data.field_key || data.target_field || null,
          old_value: data.old_value ?? null,
          old_verification_state: data.old_verification_state ?? null,
          new_value: data.new_value ?? data.value ?? null,
          new_verification_state: data.new_verification_state ?? null,
          acting_user_id: data.acting_user_id || null,
          origin_type: data.origin_type || null,
          source_type: data.source_type || null,
          rule_id: data.rule_id || null,
          rule_name: data.rule_name || null,
          batch_id: data.batch_id || null,
          note: data.note || null,
          reasons: data.reasons || null,
          pricing_status: data.pricing_status || null,
          created_at: data.created_at?.toDate?.()?.toISOString() || null,
        };
      });

      if (field) {
        entries = entries.filter((e) => e.field_key === field);
      }
      if (acting_user_id) {
        entries = entries.filter((e) => e.acting_user_id === acting_user_id);
      }
      if (source_type) {
        entries = entries.filter((e) => e.source_type === source_type);
      }

      res.json({ entries, total: entries.length });
    } catch (err: any) {
      console.error("GET /products/:mpn/history error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ────────────────────────────────────────────────
//  Comments subcollection — Step 2.5 Part 4
//  GET    /:mpn/comments
//  POST   /:mpn/comments           body: { text, mentions[] }
//  DELETE /:mpn/comments/:comment_id   (author or admin only)
// ────────────────────────────────────────────────
router.get(
  "/:mpn/comments",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const firestore = admin.firestore();
      const { mpn } = req.params;
      const docId = mpnToDocId(mpn);
      const snap = await firestore
        .collection("products")
        .doc(docId)
        .collection("comments")
        .orderBy("created_at", "desc")
        .limit(200)
        .get();

      const comments = snap.docs.map((d) => {
        const data = d.data();
        return {
          comment_id: d.id,
          text: data.text || "",
          author_uid: data.author_uid || null,
          author_name: data.author_name || "User",
          mentions: data.mentions || [],
          created_at: data.created_at?.toDate?.()?.toISOString() || null,
          edited_at: data.edited_at?.toDate?.()?.toISOString() || null,
        };
      });

      res.json({ comments, total: comments.length });
    } catch (err: any) {
      console.error("GET /products/:mpn/comments error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.post(
  "/:mpn/comments",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const firestore = admin.firestore();
      const { mpn } = req.params;
      const { text, mentions } = req.body || {};
      const userId = req.user?.uid;
      if (!userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      if (!text || String(text).trim() === "") {
        res.status(400).json({ error: "text is required" });
        return;
      }

      const docId = mpnToDocId(mpn);
      const productRef = firestore.collection("products").doc(docId);
      if (!(await productRef.get()).exists) {
        res.status(404).json({ error: "Product not found" });
        return;
      }

      // Resolve author display name
      let authorName = req.user?.name || req.user?.email || "User";
      try {
        const uDoc = await firestore.collection("users").doc(userId).get();
        if (uDoc.exists) {
          authorName = uDoc.data()?.display_name || authorName;
        }
      } catch (_e) {
        /* ignore */
      }

      const mentionUids: string[] = Array.isArray(mentions) ? mentions.filter(Boolean) : [];

      const commentRef = await productRef.collection("comments").add({
        text: String(text),
        author_uid: userId,
        author_name: authorName,
        mentions: mentionUids,
        created_at: db.FieldValue.serverTimestamp(),
        edited_at: null,
      });

      // Step 2.5 Part 5 — write a notification for each mentioned user.
      // @mention notifications are always-on (Section 15.2).
      for (const uid of mentionUids) {
        if (uid === userId) continue;
        await firestore.collection("notifications").add({
          uid,
          type: "mention",
          product_mpn: mpn,
          message: `${authorName} mentioned you on ${mpn}`,
          source_comment_id: commentRef.id,
          read: false,
          created_at: db.FieldValue.serverTimestamp(),
        });
      }

      res.status(201).json({
        comment_id: commentRef.id,
        mpn,
        text,
        mentions: mentionUids,
      });
    } catch (err: any) {
      console.error("POST /products/:mpn/comments error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.delete(
  "/:mpn/comments/:comment_id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const firestore = admin.firestore();
      const { mpn, comment_id } = req.params;
      const userId = req.user?.uid;
      if (!userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const docId = mpnToDocId(mpn);
      const ref = firestore
        .collection("products")
        .doc(docId)
        .collection("comments")
        .doc(comment_id);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }

      const isAuthor = snap.data()?.author_uid === userId;
      let isAdmin = (req.user as any)?.role === "admin";
      if (!isAdmin) {
        const uDoc = await firestore.collection("users").doc(userId).get();
        isAdmin = uDoc.data()?.role === "admin";
      }
      if (!isAuthor && !isAdmin) {
        res.status(403).json({ error: "Only the author or an admin may delete this comment" });
        return;
      }

      await ref.delete();
      res.json({ comment_id, deleted: true });
    } catch (err: any) {
      console.error("DELETE /products/:mpn/comments/:comment_id error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ────────────────────────────────────────────────
//  DELETE /:mpn — Step 4.2 Amendment B (4A: delegates to shared helper).
//  Cascade-delete a product and all its subcollections.
//  admin / owner only.
//  Wire shape preserved verbatim: { ok, mpn, deleted_subcollections }.
//  PRODUCT_SUBCOLLECTIONS now lives in services/productCascadeDelete.
// ────────────────────────────────────────────────

// ────────────────────────────────────────────────
//  POST /bulk-delete — Phase 4A.
//  Cascade-delete up to 100 products in a single request. Each per-doc
//  delete reuses the shared cascadeDeleteProduct helper and stamps
//  bulk_operation_id on its audit_log entry.
//  Mounted BEFORE /:mpn so the path does not get shadowed.
//  admin / owner only.
// ────────────────────────────────────────────────
router.post(
  "/bulk-delete",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = req.body as { doc_ids?: unknown };
      const docIds = body?.doc_ids;

      if (!Array.isArray(docIds) || docIds.length === 0) {
        res.status(400).json({
          error: "doc_ids must be a non-empty array of strings",
        });
        return;
      }
      if (docIds.length > 100) {
        res.status(400).json({
          error: "bulk-delete cap is 100 doc_ids; chunk the request client-side",
        });
        return;
      }
      for (const id of docIds) {
        if (typeof id !== "string" || id.length === 0) {
          res.status(400).json({
            error: "each doc_id must be a non-empty string",
          });
          return;
        }
        // Phase 4A.1 hotfix: only '/' is rejected. The Phase 4A whitespace
        // rejection was overly strict — Firestore doc IDs legitimately
        // permit whitespace, and real catalog MPNs in dev contain spaces
        // (e.g. "IB3937 485"). The actual Firestore restrictions are:
        // '/', exact '.' / '..', /^__.*__$/, and >1500 bytes. We enforce
        // only '/' here; the others are not in the PO-observed symptom
        // and out of scope for this hotfix.
        if (id.includes("/")) {
          res.status(400).json({
            error: `invalid doc_id "${id}": must not contain '/'`,
          });
          return;
        }
      }

      const bulkOperationId = randomUUID();
      const actingUser = req.user?.uid || "";
      const actingRole = (req.user as any)?.role || "";

      const results: Array<{
        doc_id: string;
        ok: boolean;
        mpn?: string;
        subcollection_counts?: Record<string, number>;
        error?: string;
      }> = [];
      let succeeded = 0;
      let failed = 0;

      for (const docId of docIds as string[]) {
        try {
          const r = await cascadeDeleteProduct(
            docId,
            actingUser,
            actingRole,
            bulkOperationId
          );
          if (r.ok) {
            succeeded++;
            results.push({
              doc_id: docId,
              ok: true,
              mpn: r.mpn,
              subcollection_counts: r.subcollection_counts,
            });
          } else {
            failed++;
            results.push({
              doc_id: docId,
              ok: false,
              error: "product not found",
            });
          }
        } catch (e: any) {
          failed++;
          console.error(
            `[bulk-delete] error on docId=${docId} bulk=${bulkOperationId}:`,
            e
          );
          results.push({
            doc_id: docId,
            ok: false,
            error: e?.message || "cascade delete failed",
          });
        }
      }

      res.status(200).json({
        ok: true,
        bulk_operation_id: bulkOperationId,
        results,
        summary: {
          total: docIds.length,
          succeeded,
          failed,
        },
      });
    } catch (err: any) {
      console.error("POST /products/bulk-delete error:", err);
      res.status(500).json({ error: err?.message || "bulk-delete failed" });
    }
  }
);

router.delete(
  "/:mpn",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { mpn } = req.params;
      const docId = mpnToDocId(mpn);
      const actingUser = req.user?.uid || "";
      const actingRole = (req.user as any)?.role || "";

      const result = await cascadeDeleteProduct(docId, actingUser, actingRole);
      if (!result.ok) {
        res.status(404).json({ error: "Product not found" });
        return;
      }

      // Wire shape preserved verbatim from pre-4A:
      //   { ok: true, mpn, deleted_subcollections: string[] }
      res.json({
        ok: true,
        mpn,
        deleted_subcollections: PRODUCT_SUBCOLLECTIONS as unknown as string[],
      });
    } catch (err: any) {
      console.error("DELETE /products/:mpn error:", err);
      res.status(500).json({ error: err.message || "Failed to delete product" });
    }
  }
);

export default router;
