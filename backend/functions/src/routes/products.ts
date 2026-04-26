import { Router, Response } from "express";
import admin from "firebase-admin";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { mpnToDocId, docIdToMpn } from "../services/mpnUtils";
import { queueForPricingExport } from "../services/pricingExportQueue";
import { checkHighPriorityFlag } from "../services/launchHighPriority";
import { getWeekKey } from "../services/executiveProjections";
import { deriveVerificationState, getStalenessThresholdDays, StalenessCache } from "../lib/staleness";
import { parseAdditionalImageUrls } from "../lib/parseAdditionalImageUrls";
import {
  loadDepartmentRegistry,
  isDepartmentValueAllowed,
} from "./departmentRegistry";
import {
  getRequiredFieldKeys,
  computeCompletionProgress,
  computeCompletion,
  stampCompletionOnProduct,
} from "../services/completionCompute";

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
// Transitional alias layer (REMOVE IN PHASE 3B once frontend migrates):
//   Frontend ProductListPage still emits legacy sort tokens
//   (first_received, last_modified, completion_pct) and pages via &cursor.
//   Without translation, Phase 3A's strict allowlist would 400 the very
//   first list call (default `sort=last_modified`) and break /products on
//   deploy. Aliases below translate legacy tokens before the allowlist
//   check; ?cursor is accepted-and-ignored with a deprecation log.

// REMOVE IN PHASE 3B — legacy frontend sort tokens and their default
// directions. FE will be migrated to send canonical fields directly.
const SORT_ALIASES: Record<string, { sort: string; defaultDir: "asc" | "desc" }> = {
  // REMOVE IN PHASE 3B
  last_modified:  { sort: "updated_at",         defaultDir: "desc" },
  // REMOVE IN PHASE 3B
  first_received: { sort: "first_received_at",  defaultDir: "asc"  },
  // REMOVE IN PHASE 3B
  completion_pct: { sort: "completion_percent", defaultDir: "asc"  },
};

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
      cursor,
    } = req.query as Record<string, string | undefined>;

    // ── Sort + dir resolution (with REMOVE-IN-PHASE-3B alias layer) ─────
    let sortField = sortRaw;
    let sortDir: string | undefined = dirRaw;
    if (SORT_ALIASES[sortRaw]) {
      // REMOVE IN PHASE 3B — translate legacy token, FE-supplied dir wins
      const alias = SORT_ALIASES[sortRaw];
      sortField = alias.sort;
      if (!sortDir) sortDir = alias.defaultDir;
    }
    if (!sortDir) sortDir = "asc";

    if (!SORT_ALLOWLIST.has(sortField)) {
      res.status(400).json({
        error: `Invalid sort field "${sortRaw}". Allowed: ${[...SORT_ALLOWLIST].join(", ")} (or legacy aliases: ${Object.keys(SORT_ALIASES).join(", ")})`,
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

    // REMOVE IN PHASE 3B — accept ?cursor for FE back-compat, ignore it,
    // log once per request. Response always returns next_cursor: null so
    // FE's hasMore evaluates false → "Load more" hides itself cleanly.
    if (cursor) {
      console.warn(
        `[products] DEPRECATED: ?cursor=${cursor} ignored — use ?page= instead. (Phase 3A alias layer; remove in 3B.)`
      );
    }

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
      // REMOVE IN PHASE 3B — `total` mirrors total_count for FE
      // back-compat (ProductListPage reads data.total). next_cursor is
      // always null now (offset pagination); FE's hasMore evaluates false
      // → "Load more" hides itself cleanly during the alias window.
      total,
      next_cursor: null,
    });
  } catch (err: any) {
    console.error("GET /products error:", err);
    res.status(500).json({ error: "Failed to fetch products." });
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
//  POST /api/v1/products/:mpn/complete
// ────────────────────────────────────────────────
router.post("/:mpn/complete", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const firestore = admin.firestore();
    const { mpn } = req.params;
    const docId = mpnToDocId(mpn);

    // Verify product exists
    const productRef = firestore.collection("products").doc(docId);
    const productSnap = await productRef.get();

    if (!productSnap.exists) {
      res.status(404).json({ error: `Product with MPN "${mpn}" not found.` });
      return;
    }

    // Compute completion progress — server-side enforcement
    const requiredFields = await getRequiredFieldKeys(firestore);

    // For completion gate: check that all required fields have Human-Verified value
    const avSnap = await productRef.collection("attribute_values").get();
    const attrMap = new Map<string, any>();
    avSnap.docs.forEach((d) => {
      if (d.id !== "source_inputs") {
        attrMap.set(d.id, d.data());
      }
    });

    const blockers: string[] = [];
    for (const rf of requiredFields) {
      const attr = attrMap.get(rf.field_key);
      if (!attr || attr.value === undefined || attr.value === null || attr.value === "") {
        blockers.push(`${rf.display_label} is required`);
      } else {
        const isVerified = attr.verification_state === "Human-Verified"
          || attr.verification_state === "Rule-Verified";
        if (!isVerified) {
          blockers.push(`${rf.display_label} must be verified`);
        }
      }
    }

    if (blockers.length > 0) {
      res.status(400).json({
        error: "Product cannot be completed",
        blockers,
      });
      return;
    }

    // TALLY-107 — lightweight pricing discrepancy check before flipping state.
    // Only block for genuine data errors (e.g. sale price > regular price).
    const product = productSnap.data() || {};
    const scom = Number(product.scom) || 0;
    const scom_sale = Number(product.scom_sale) || 0;
    const discrepancyReasons: string[] = [];
    if (scom_sale > 0 && scom > 0 && scom_sale > scom) {
      discrepancyReasons.push(
        `Web sale price ($${scom_sale}) exceeds web regular price ($${scom})`
      );
    }

    if (discrepancyReasons.length > 0) {
      // Block with discrepancy — Joey re-imports corrected data
      await productRef.set(
        {
          completion_state: "complete",
          product_is_active: true,
          pricing_domain_state: "discrepancy",
          discrepancy_reasons: discrepancyReasons,
          completed_at: db.FieldValue.serverTimestamp(),
          completed_by: req.user?.uid || "unknown",
        },
        { merge: true }
      );

      // Auto-set product_is_active attribute_value for consistency
      await productRef.collection("attribute_values").doc("product_is_active").set({
        field_name: "product_is_active",
        value: "true",
        origin_type: "System",
        origin_rule: "Mark Complete",
        verification_state: "Rule-Verified",
        updated_at: db.FieldValue.serverTimestamp()
      }, { merge: true });

      // Step 2.4 — clear High Priority flag now that the product is complete
      try {
        await checkHighPriorityFlag(mpn);
      } catch (hpErr: any) {
        console.error("checkHighPriorityFlag (discrepancy) failed:", hpErr.message);
      }

      // Step 3.2 — operator throughput event (fire-and-forget)
      try {
        await firestore.collection("operator_throughput").add({
          operator_uid: req.user?.uid || "unknown",
          operator_name: (req.user as any)?.display_name || req.user?.email || "unknown",
          mpn,
          department: product.department || "Unknown",
          category: product.category || null,
          outcome: "discrepancy",
          completed_at: db.FieldValue.serverTimestamp(),
          week_key: getWeekKey(new Date()),
        });
      } catch (tErr: any) {
        console.error("operator_throughput write (discrepancy) failed:", tErr.message);
      }

      // TALLY-P1 — stamp 5-field completion projection (best-effort).
      try {
        const result = await computeCompletion(mpn);
        await stampCompletionOnProduct(productRef, result);
      } catch (stampErr: any) {
        console.warn("completion_stamp_failed", { mpn, err: stampErr?.message });
      }

      res.status(200).json({
        mpn,
        doc_id: docId,
        completion_state: "complete",
        pricing_domain_state: "discrepancy",
        discrepancy_reasons: discrepancyReasons,
        completed_at: new Date().toISOString(),
        completed_by: req.user?.uid || "unknown",
        message:
          "Product completed but blocked by pricing discrepancy. Flag for re-import.",
      });
      return;
    }

    // No discrepancy — go straight to export_ready
    await productRef.set(
      {
        completion_state: "complete",
        product_is_active: true,
        pricing_domain_state: "export_ready",
        completed_at: db.FieldValue.serverTimestamp(),
        completed_by: req.user?.uid || "unknown",
      },
      { merge: true }
    );

    // Auto-set product_is_active attribute_value for consistency
    await productRef.collection("attribute_values").doc("product_is_active").set({
      field_name: "product_is_active",
      value: "true",
      origin_type: "System",
      origin_rule: "Mark Complete",
      verification_state: "Rule-Verified",
      updated_at: db.FieldValue.serverTimestamp()
    }, { merge: true });

    // Step 2.4 — clear High Priority flag now that the product is complete
    try {
      await checkHighPriorityFlag(mpn);
    } catch (hpErr: any) {
      console.error("checkHighPriorityFlag (complete) failed:", hpErr.message);
    }

    // Step 3.2 — operator throughput event (fire-and-forget)
    try {
      await firestore.collection("operator_throughput").add({
        operator_uid: req.user?.uid || "unknown",
        operator_name: (req.user as any)?.display_name || req.user?.email || "unknown",
        mpn,
        department: product.department || "Unknown",
        category: product.category || null,
        outcome: "export_ready",
        completed_at: db.FieldValue.serverTimestamp(),
        week_key: getWeekKey(new Date()),
      });
    } catch (tErr: any) {
      console.error("operator_throughput write (export_ready) failed:", tErr.message);
    }

    // TALLY-P1 — stamp 5-field completion projection (best-effort).
    try {
      const result = await computeCompletion(mpn);
      await stampCompletionOnProduct(productRef, result);
    } catch (stampErr: any) {
      console.warn("completion_stamp_failed", { mpn, err: stampErr?.message });
    }

    res.status(200).json({
      mpn,
      doc_id: docId,
      completion_state: "complete",
      pricing_domain_state: "export_ready",
      completed_at: new Date().toISOString(),
      completed_by: req.user?.uid || "unknown",
      message: "Product complete and queued for export.",
    });
  } catch (err: any) {
    console.error("POST /products/:mpn/complete error:", err);
    res.status(500).json({ error: "Failed to complete product." });
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
    try {
      const result = await computeCompletion(mpn);
      await stampCompletionOnProduct(productRef, result);
    } catch (stampErr: any) {
      console.warn("completion_stamp_failed", { mpn, err: stampErr?.message });
    }

    res.status(200).json({
      field_key: fieldKey,
      value: finalValue,
      verification_state: "Human-Verified",
      completion_progress,
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
//  DELETE /:mpn — Step 4.2 Amendment B
//  Cascade-delete a product and all its subcollections.
//  admin / owner only.
// ────────────────────────────────────────────────
const PRODUCT_SUBCOLLECTIONS = [
  "attribute_values",
  "pricing_snapshots",
  "site_targets",
  "comments",
  "site_verification",
  "content_versions",
  "audit_log",
];

router.delete(
  "/:mpn",
  requireAuth,
  requireRole(["admin", "owner"]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { mpn } = req.params;
      const docId = mpnToDocId(mpn);
      const productRef = admin.firestore().collection("products").doc(docId);
      const snap = await productRef.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Product not found" });
        return;
      }

      for (const subcol of PRODUCT_SUBCOLLECTIONS) {
        const subSnap = await productRef.collection(subcol).get();
        if (!subSnap.empty) {
          // Firestore batch limit is 500 writes
          const chunks: FirebaseFirestore.QueryDocumentSnapshot[][] = [];
          for (let i = 0; i < subSnap.docs.length; i += 400) {
            chunks.push(subSnap.docs.slice(i, i + 400));
          }
          for (const chunk of chunks) {
            const batch = admin.firestore().batch();
            chunk.forEach((d) => batch.delete(d.ref));
            await batch.commit();
          }
          console.log(
            `[product-delete] purged ${subSnap.size} from ${docId}/${subcol}`
          );
        }
      }

      await productRef.delete();

      await admin
        .firestore()
        .collection("audit_log")
        .add({
          event_type: "product_deleted",
          product_mpn: mpn,
          product_doc_id: docId,
          acting_user: req.user?.uid || null,
          acting_role: (req.user as any)?.role || null,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          note: "Hard delete — all subcollections purged",
        });

      res.json({
        ok: true,
        mpn,
        deleted_subcollections: PRODUCT_SUBCOLLECTIONS,
      });
    } catch (err: any) {
      console.error("DELETE /products/:mpn error:", err);
      res.status(500).json({ error: err.message || "Failed to delete product" });
    }
  }
);

export default router;
