import { auth } from "../firebase";

const BASE = import.meta.env.VITE_API_BASE_URL;

async function headers(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export interface ProductListItem {
  mpn: string;
  doc_id: string;
  name: string;
  brand: string;
  department: string;
  class: string;
  site_owner: string;
  completion_state: string;
  image_status: string;
  primary_image_url: string | null;
  first_received_at: string | null;
  updated_at: string | null;
  is_high_priority: boolean;
  launch_days_remaining: number | null;
  map_conflict_active?: boolean;
  is_map_protected?: boolean;
  completion_progress: {
    total_required: number;
    completed: number;
    pct: number;
    blockers: string[];
  };
  // TALLY-P1 — 5 pre-computed completion fields (Blueprint 11.4-R01).
  // Optional during deploy/backfill window; populated by writer paths and
  // the one-time backfill script. Reader fallback in the API guarantees
  // numeric percent / blocker counts even when fields are absent.
  completion_percent?: number;
  blocker_count?: number;
  ai_blocker_count?: number;
  next_action_hint?: string;
  completion_last_computed_at?: string | null;
}

export interface ProductListResponse {
  items: ProductListItem[];
  // Phase 3B canonical pagination contract (3A alias layer removed):
  total_count: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface ProductDetail extends ProductListItem {
  sku: string;
  status: string;
  scom: number;
  scom_sale: number;
  rics_retail: number;
  rics_offer: number;
  inventory_store: number;
  inventory_warehouse: number;
  inventory_whs: number;
  pricing_domain_state: string;
  product_is_active: boolean;
  import_batch_id: string | null;
  is_map_protected: boolean;
  map_price: number | null;
  map_promo_price: number | null;
  map_start_date: string | null;
  map_end_date: string | null;
  map_is_always_on: boolean | null;
  map_conflict_active: boolean;
  map_conflict_reason: string | null;
  map_conflict_held: boolean;
  map_removal_proposed: boolean;
  needs_ai_review?: boolean;
  ai_review_reason?: string;
  attribute_values: Record<
    string,
    {
      value: unknown;
      origin_type: string | null;
      origin_detail: string | null;
      verification_state: string | null;
      written_at: string | null;
    }
  >;
  site_targets: Array<{
    site_id: string;
    domain: string;
    active: boolean;
  }>;
  source_inputs: Record<string, unknown>;
  primary_site_key: string | null;
  site_verification: SiteVerificationMap;
}

// ── Site Verification per-site entry (Task 2 GET /:mpn response shape) ──
export interface SiteVerificationEntry {
  site_key: string;
  site_display_name: string;
  site_domain: string | null;
  verification_state: string;
  product_url: string | null;
  image_url: string | null;
  additional_image_url_parsed: string[];
  last_verified_at: string | null;
  verification_date: string | null;
  mismatch_reason: string | null;
  reviewer_uid: string | null;
  reviewer_action_at: string | null;
}

export type SiteVerificationMap = Record<string, SiteVerificationEntry>;

export async function fetchProducts(params?: Record<string, string>): Promise<ProductListResponse> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(`${BASE}/api/v1/products${qs}`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

// Phase 4A — bulk-delete (admin/owner only). Server caps at 100 doc_ids per
// call; callers must chunk client-side.
export interface BulkDeleteResultItem {
  doc_id: string;
  ok: boolean;
  mpn?: string;
  subcollection_counts?: Record<string, number>;
  error?: string;
}

export interface BulkDeleteResponse {
  ok: boolean;
  bulk_operation_id: string;
  results: BulkDeleteResultItem[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
}

export async function bulkDeleteProducts(docIds: string[]): Promise<BulkDeleteResponse> {
  const res = await fetch(`${BASE}/api/v1/products/bulk-delete`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify({ doc_ids: docIds }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.error || JSON.stringify(j);
    } catch {
      // ignore
    }
    throw new Error(`API ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

export interface QueueStats {
  total_incomplete: number;
  completed_today: number;
  my_completions_today: number;
  my_edits_today: number;
  team_edits_today: number;
  leaderboard: { name: string; count: number }[];
  brands_added_today: string[];
  products_edited_today: number;
}

export async function fetchQueueStats(): Promise<QueueStats> {
  const res = await fetch(`${BASE}/api/v1/queue/stats`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function fetchProduct(mpn: string): Promise<ProductDetail> {
  const res = await fetch(`${BASE}/api/v1/products/${encodeURIComponent(mpn)}`, {
    headers: await headers(),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export interface AttributeRegistryEntry {
  field_key: string;
  display_label: string;
  field_type: string;
  destination_tab: string;
  required_for_completion: boolean;
  active: boolean;
  export_enabled: boolean;
  dropdown_options: string[];
  dropdown_source?: string;
  display_group?: string;
  display_order?: number;
  tab_group_order?: number;
  full_width?: boolean;
  is_editable?: boolean;
  depends_on?: { field: string; value: string } | null;
}

export async function fetchAttributeRegistry(): Promise<AttributeRegistryEntry[]> {
  const res = await fetch(`${BASE}/api/v1/attribute_registry`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return data.attributes as AttributeRegistryEntry[];
}

export async function completeProduct(mpn: string): Promise<{ completion_state: string; blockers?: string[] }> {
  const res = await fetch(`${BASE}/api/v1/products/${encodeURIComponent(mpn)}/complete`, {
    method: "POST",
    headers: await headers(),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export interface SaveFieldResponse {
  field_key: string;
  value: unknown;
  verification_state: string;
  completion_progress: {
    total_required: number;
    completed: number;
    pct: number;
    blockers: string[];
  };
  map_auto_populate?:
    | { triggered: true; rics_retail: number }
    | { triggered: false };
}

export async function saveField(mpn: string, fieldKey: string, value: unknown, action?: "verify"): Promise<SaveFieldResponse> {
  const body: Record<string, unknown> = { value };
  if (action) body.action = action;
  const res = await fetch(
    `${BASE}/api/v1/products/${encodeURIComponent(mpn)}/attributes/${encodeURIComponent(fieldKey)}`,
    {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ── Buyer Review types ──

export interface BuyerReviewRecommendation {
  type: string;
  pct: number;
  new_rics_offer: number;
  export_price: number;
  rule_name: string;
  rule_id: string | null;
}

export interface BuyerReviewItem {
  mpn: string;
  name: string;
  brand: string;
  department: string;
  class: string;
  site_owner: string;
  rics_retail: number;
  rics_offer: number;
  scom: number;
  scom_sale: number;
  is_map_protected: boolean;
  map_floor: number | null;
  map_conflict_active?: boolean;
  map_conflict_reason?: string | null;
  str_pct: number;
  wos: number | null;
  store_gm_pct: number | null;
  web_gm_pct: number | null;
  inventory_total: number;
  is_slow_moving: boolean;
  recommendation: BuyerReviewRecommendation;
  // TALLY-127 Task 2: real per-site verification map + primary key.
  // Replaces the prior synthetic single-element site_targets array.
  site_verification: SiteVerificationMap;
  primary_site_key: string | null;
  is_loss_leader: boolean;
  days_in_queue: number;
  pricing_domain_state: string;
}

export interface BuyerReviewResponse {
  items: BuyerReviewItem[];
  total: number;
  next_cursor: string | null;
}

export async function fetchBuyerReview(params?: Record<string, string>): Promise<BuyerReviewResponse> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(`${BASE}/api/v1/buyer-review${qs}`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export interface PriceProjectionStep {
  step: number;
  label: string;
  rics_offer: number;
  export_price: number;
  gm_pct: number;
  is_below_cost: boolean;
}

export interface PriceProjection {
  mpn: string;
  cost: number;
  cost_is_estimated: boolean;
  current_gm_pct: number;
  steps: PriceProjectionStep[];
  below_cost_threshold: number;
  map_floor: number | null;
}

export async function fetchPriceProjection(mpn: string): Promise<PriceProjection> {
  const res = await fetch(`${BASE}/api/v1/buyer-review/price-projection/${encodeURIComponent(mpn)}`, {
    headers: await headers(),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function postBuyerAction(body: {
  mpn: string;
  action_type: "approve" | "deny" | "adjust";
  adjustment?: { type: string; value: number; effective_date?: string };
}): Promise<any> {
  const res = await fetch(`${BASE}/api/v1/buyer-actions/markdown`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function postLossLeaderAcknowledge(body: { mpn: string; reason: string }): Promise<any> {
  const res = await fetch(`${BASE}/api/v1/buyer-actions/loss-leader-acknowledge`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ── Export Center types + API ──

export interface ExportPendingProduct {
  mpn: string;
  name: string;
  brand: string;
  pricing_domain_state: string;
  rics_offer: number;
  scom: number;
}

export interface ExportBlockedProduct {
  mpn: string;
  reasons: string[];
}

export interface ExportPendingResponse {
  pending: ExportPendingProduct[];
  blocked: ExportBlockedProduct[];
  pending_count: number;
  blocked_count: number;
}

export interface ExportTriggerResponse {
  job_id: string;
  status: string;
  serialized: number;
  blocked: number;
  blocked_products: ExportBlockedProduct[];
  errors: Array<{ mpn: string; error: string }>;
  output_file: string;
  download_url: string;
}

export interface ExportJob {
  id: string;
  status: string;
  triggered_by: string;
  triggered_at: string | null;
  completed_at: string | null;
  serialized_count: number;
  blocked_count: number;
  failed_count: number;
  output_file: string | null;
  download_url: string | null;
}

export async function fetchExportPending(): Promise<ExportPendingResponse> {
  const res = await fetch(`${BASE}/api/v1/exports/pending`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function triggerExport(): Promise<ExportTriggerResponse> {
  const res = await fetch(`${BASE}/api/v1/exports/daily/trigger`, {
    method: "POST",
    headers: await headers(),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function notifyBuyer(mpn: string): Promise<any> {
  const res = await fetch(`${BASE}/api/v1/exports/notify-buyer`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify({ mpn }),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function fetchExportJobs(): Promise<{ jobs: ExportJob[] }> {
  const res = await fetch(`${BASE}/api/v1/exports/jobs`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function promoteScheduled(): Promise<any> {
  const res = await fetch(`${BASE}/api/v1/exports/promote-scheduled`, {
    method: "POST",
    headers: await headers(),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ── Import Hub ──

export interface ImportUploadResponse {
  batch_id: string;
  row_count: number;
  warnings: string[];
  column_map?: Record<string, number>;
  error?: string;
  missing_columns?: string[];
  message?: string;
}

export interface ImportCommitResponse {
  batch_id: string;
  committed_rows: number;
  failed_rows: number;
  uuid_names_cleaned?: number;
  smart_rules_applied?: number;
  errors?: Array<{ row: number; mpn: string; error: string }>;
  [key: string]: unknown;
}

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

export async function uploadImport(family: "full-product" | "weekly-operations", file: File): Promise<ImportUploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/api/v1/imports/${family}/upload`, {
    method: "POST",
    headers: await authHeaders(),
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function commitImport(family: "full-product" | "weekly-operations", batchId: string): Promise<ImportCommitResponse> {
  const res = await fetch(`${BASE}/api/v1/imports/${family}/${encodeURIComponent(batchId)}/commit`, {
    method: "POST",
    headers: await headers(),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ── Sales Import (web + store) ──
export interface SalesUploadResponse {
  batch_id: string;
  import_type: "web" | "store";
  report_date: string;
  row_count: number;
  headers: string[];
  error?: string;
  missing_columns?: string[];
}

export interface SalesCommitResponse {
  batch_id: string;
  status: string;
  import_type: "web" | "store";
  report_date: string;
  total_rows: number;
  committed_rows: number;
  skipped_rows: number;
  failed_rows: number;
  product_not_found_count: number;
  metrics_calculated: number;
  errors?: Array<{ row: number; mpn: string; error: string }>;
}

export interface SalesStatusResponse {
  last_web: {
    batch_id: string;
    report_date: string;
    committed_rows: number;
    skipped_rows: number;
    failed_rows: number;
    completed_at: string | null;
  } | null;
  last_store: {
    batch_id: string;
    report_date: string;
    committed_rows: number;
    skipped_rows: number;
    failed_rows: number;
    completed_at: string | null;
  } | null;
  warning?: string;
}

export async function salesUpload(file: File): Promise<SalesUploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/api/v1/imports/sales/upload`, {
    method: "POST",
    headers: await authHeaders(),
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function salesCommit(batchId: string): Promise<SalesCommitResponse> {
  const res = await fetch(`${BASE}/api/v1/imports/sales/${encodeURIComponent(batchId)}/commit`, {
    method: "POST",
    headers: await headers(),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function fetchSalesStatus(): Promise<SalesStatusResponse> {
  const res = await fetch(`${BASE}/api/v1/imports/sales/status`, {
    headers: await headers(),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ── MAP Policy Import (Step 2.1 Part 1) ──
export interface MapUploadResponse {
  batch_id: string;
  raw_headers: string[];
  row_count: number;
}

export interface MapColumnMapping {
  mpn: string;
  brand: string;
  map_price: string;
  start_date: string | null;
  end_date: string | null;
  promo_price: string | null;
}

export interface MapTemplate {
  id: string;
  template_name: string;
  brand: string | null;
  column_mapping: MapColumnMapping;
}

export async function mapPolicyUpload(file: File): Promise<MapUploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/api/v1/imports/map-policy/upload`, {
    method: "POST",
    headers: await authHeaders(),
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function mapPolicyMapColumns(
  batchId: string,
  column_mapping: MapColumnMapping,
  save_template: boolean,
  template_name: string
): Promise<{ status: string; template_id: string | null }> {
  const res = await fetch(
    `${BASE}/api/v1/imports/map-policy/${encodeURIComponent(batchId)}/map-columns`,
    {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ column_mapping, save_template, template_name }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function mapPolicyCommit(batchId: string): Promise<{
  batch_id: string;
  status: string;
  total_rows: number;
  committed_rows: number;
  failed_rows: number;
  removal_proposed: number;
  errors: Array<{ row: number; mpn: string; error: string }>;
}> {
  const res = await fetch(
    `${BASE}/api/v1/imports/map-policy/${encodeURIComponent(batchId)}/commit`,
    {
      method: "POST",
      headers: await headers(),
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function fetchMapTemplates(): Promise<{ templates: MapTemplate[] }> {
  const res = await fetch(`${BASE}/api/v1/imports/map-policy/templates`, {
    headers: await headers(),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ── MAP Conflict / Removal Review (Step 2.1 Parts 4 & 5) ──
export interface MapConflictItem {
  mpn: string;
  name: string;
  brand: string;
  map_price: number;
  map_promo_price: number | null;
  scom: number;
  scom_sale: number;
  rics_offer: number;
  map_conflict_reason: string | null;
  map_conflict_flagged_at: string | null;
  map_conflict_held: boolean;
}

export async function fetchMapConflicts(): Promise<{ items: MapConflictItem[]; total: number }> {
  const res = await fetch(`${BASE}/api/v1/map-review/conflicts`, { headers: await headers() });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function resolveMapConflict(
  mpn: string,
  body: {
    action: "accept_map" | "request_buyer_map" | "flag_for_contact";
    note?: string;
    web_discount_cap?: string;
  }
): Promise<any> {
  const res = await fetch(
    `${BASE}/api/v1/map-review/conflict/${encodeURIComponent(mpn)}/resolve`,
    {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export interface MapRemovalItem {
  mpn: string;
  name: string;
  brand: string;
  map_price: number;
  map_removal_proposed_at: string | null;
  map_removal_source_batch: string | null;
  map_removal_review_after: string | null;
  rics_retail: number;
  rics_offer: number;
  scom: number;
  scom_sale: number;
  inventory_total: number;
  str_pct: number | null;
  wos: number | null;
  store_gm_pct: number | null;
  web_gm_pct: number | null;
}

export async function fetchMapRemovals(): Promise<{ items: MapRemovalItem[]; total: number }> {
  const res = await fetch(`${BASE}/api/v1/map-review/removals`, { headers: await headers() });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function resolveMapRemoval(
  mpn: string,
  body: {
    action: "approve_removal" | "keep_map" | "defer";
    note?: string;
    defer_days?: number;
    new_scom?: string;
    new_scom_sale?: string;
    new_rics_offer?: string;
    web_discount_cap?: string;
  }
): Promise<any> {
  const res = await fetch(
    `${BASE}/api/v1/map-review/removal/${encodeURIComponent(mpn)}/resolve`,
    {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ── Pricing Export (Step 2.1 Part 6 / TALLY-112) ──
export interface PricingExportQueueItem {
  id: string;
  mpn: string;
  sku: string | null;
  rics_retail: number;
  rics_offer: number;
  scom: number;
  scom_sale: number | null;
  effective_date: string | null;
  queued_reason: string | null;
  queued_at: string | null;
}

export async function fetchPricingExportQueue(): Promise<{
  items: PricingExportQueueItem[];
  total: number;
}> {
  const res = await fetch(`${BASE}/api/v1/exports/pricing/queue`, {
    headers: await headers(),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function triggerPricingExport(): Promise<{
  job_id: string;
  status: string;
  item_count: number;
  output_file: string;
  download_url: string;
}> {
  const res = await fetch(`${BASE}/api/v1/exports/pricing/trigger`, {
    method: "POST",
    headers: await headers(),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export interface PricingExportJob {
  id: string;
  status: string;
  triggered_at: string | null;
  completed_at: string | null;
  item_count: number;
  output_file: string | null;
  download_url: string | null;
}

export async function fetchPricingExportJobs(): Promise<{ jobs: PricingExportJob[] }> {
  const res = await fetch(`${BASE}/api/v1/exports/pricing/jobs`, {
    headers: await headers(),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

// ── Step 2.2 Cadence types ──

export interface CadenceTargetFilter {
  field: string;
  operator: "equals" | "not_equals" | "contains" | "starts_with";
  value: string;
  case_sensitive: boolean;
  logic: "AND" | "OR";
}

export interface CadenceTriggerCondition {
  field: string;
  operator:
    | "less_than"
    | "greater_than"
    | "less_than_or_equal"
    | "greater_than_or_equal"
    | "equals";
  value: number | boolean;
  logic: "AND" | "OR";
}

export interface CadenceMarkdownStep {
  step_number: number;
  day_threshold: number;
  action_type: "markdown_pct" | "custom_price" | "off_sale" | "set_in_cart_promo";
  markdown_scope: "store_and_web" | "store_only" | "web_only";
  value: number;
  apply_99_rounding: boolean;
}

export interface CadenceRule {
  rule_id: string;
  rule_name: string;
  version: number;
  is_active: boolean;
  owner_buyer_id: string;
  owner_site_owner: string;
  target_filters: CadenceTargetFilter[];
  trigger_conditions: CadenceTriggerCondition[];
  markdown_steps: CadenceMarkdownStep[];
  created_at: string | null;
  updated_at: string | null;
}

export interface CadenceRecommendation {
  action_type: string;
  markdown_scope: string;
  value: number;
  new_rics_offer: number;
  export_rics_offer: number;
  new_scom_sale?: number;
  export_scom_sale?: number;
  rule_name: string;
  rule_id: string;
  step_number: number;
  explanation: string[];
}

export interface CadenceReviewItem {
  mpn: string;
  name: string;
  brand: string;
  department: string;
  class: string;
  site_owner: string;
  rics_retail: number;
  rics_offer: number;
  scom: number;
  scom_sale: number;
  is_map_protected: boolean;
  map_price: number | null;
  map_conflict_active: boolean;
  str_pct: number | null;
  wos: number | null;
  store_gm_pct: number | null;
  web_gm_pct: number | null;
  inventory_total: number;
  is_slow_moving: boolean;
  recommendation: CadenceRecommendation;
  current_step: number;
  days_in_queue: number;
}

export interface CadenceUnassignedItem {
  mpn: string;
  name: string;
  brand: string;
  department: string;
  class: string;
  wos: number | null;
  str_pct: number | null;
  inventory_total: number;
  last_evaluated_at: string | null;
}

// ── Cadence Rules CRUD ──

export async function fetchCadenceRules(): Promise<{ rules: CadenceRule[]; total: number }> {
  const res = await fetch(`${BASE}/api/v1/cadence-rules`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function fetchCadenceRule(ruleId: string): Promise<CadenceRule> {
  const res = await fetch(`${BASE}/api/v1/cadence-rules/${encodeURIComponent(ruleId)}`, {
    headers: await headers(),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function createCadenceRule(
  rule: Omit<CadenceRule, "rule_id" | "version" | "created_at" | "updated_at">
): Promise<CadenceRule> {
  const res = await fetch(`${BASE}/api/v1/cadence-rules`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify(rule),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function updateCadenceRule(
  ruleId: string,
  rule: Omit<CadenceRule, "rule_id" | "version" | "created_at" | "updated_at">
): Promise<CadenceRule> {
  const res = await fetch(`${BASE}/api/v1/cadence-rules/${encodeURIComponent(ruleId)}`, {
    method: "PUT",
    headers: await headers(),
    body: JSON.stringify(rule),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function deactivateCadenceRule(ruleId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/cadence-rules/${encodeURIComponent(ruleId)}`, {
    method: "DELETE",
    headers: await headers(),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
}

// ── Cadence Review + Assignments ──

export async function fetchCadenceReview(): Promise<{ items: CadenceReviewItem[]; total: number }> {
  const res = await fetch(`${BASE}/api/v1/cadence-review`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function fetchCadenceUnassigned(): Promise<{
  items: CadenceUnassignedItem[];
  total: number;
}> {
  const res = await fetch(`${BASE}/api/v1/cadence-assignments/unassigned`, {
    headers: await headers(),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function assignCadenceRule(mpn: string, ruleId: string): Promise<any> {
  const res = await fetch(
    `${BASE}/api/v1/cadence-assignments/${encodeURIComponent(mpn)}/assign`,
    {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ rule_id: ruleId }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function excludeFromCadence(mpn: string, reason: string): Promise<any> {
  const res = await fetch(
    `${BASE}/api/v1/cadence-assignments/${encodeURIComponent(mpn)}/exclude`,
    {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ reason }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ── Extended buyer actions ──

export async function buyerAction(
  mpn: string,
  action_type: "approve" | "deny" | "adjust" | "off_sale",
  adjustment?: {
    type: "pct" | "dollar" | "price";
    value: number;
    effective_date?: string | null;
  }
): Promise<any> {
  const res = await fetch(`${BASE}/api/v1/buyer-actions/markdown`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify({ mpn, action_type, adjustment }),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function buyerHold(mpn: string, hold_reason?: string): Promise<any> {
  const res = await fetch(`${BASE}/api/v1/buyer-actions/hold`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify({ mpn, hold_reason }),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function buyerSaveForSeason(mpn: string, return_date: string): Promise<any> {
  const res = await fetch(`${BASE}/api/v1/buyer-actions/save-for-season`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify({ mpn, return_date }),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function buyerPostponeReview(mpn: string, snooze_days: number): Promise<any> {
  const res = await fetch(`${BASE}/api/v1/buyer-actions/postpone-review`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify({ mpn, snooze_days }),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ── AI Content Pipeline (Step 2.3) ──

export interface ContentSection {
  id: string;
  type: string;
  enabled: boolean;
  header: string;
  emoji_icon: string;
}

export interface ContentSchema {
  use_emojis: boolean;
  sections: ContentSection[];
}

export interface SeoStrategy {
  primary_keyword_template: string;
  include_faq_schema: boolean;
  keyword_density_target: string;
}

export interface PromptTemplate {
  template_id: string;
  template_name: string;
  is_active: boolean;
  priority: number;
  match_site_owner: string | null;
  match_department: string | null;
  match_class: string | null;
  match_brand: string | null;
  match_category: string | null;
  match_gender: string | null;
  tone_profile: string;
  tone_description: string;
  output_components: string[];
  content_schema: ContentSchema;
  seo_strategy: SeoStrategy;
  prompt_instructions: string;
  banned_words: string[];
  required_attribute_inclusions: string[];
  created_by: string;
  created_at: any;
  updated_at: any;
}

export interface ContentVersion {
  version_id: string;
  site_owner: string;
  template_id: string;
  template_name: string;
  tone_profile: string;
  generated_at: any;
  generated_by: string;
  inputs_used: Record<string, string>;
  raw_output: string;
  parsed_output: Record<string, string>;
  banned_words_found: string[];
  approval_state: "pending" | "approved" | "rejected" | "review_pending";
  approved_by: string | null;
  approved_at: any;
  rejected_by?: string;
  rejected_at?: any;
  rejection_reason?: string;
  operator_edited?: boolean;
  edited_by?: string;
  edited_at?: any;
  version_number: number;
  restored_from_version?: string;
}

export interface AIGenerationResult {
  version_id: string;
  site_owner: string;
  template_name: string;
  tone_profile: string;
  parsed_output: Record<string, string>;
  banned_words_found: string[];
  version_number: number;
}

// Prompt Templates CRUD
export async function fetchPromptTemplates(): Promise<PromptTemplate[]> {
  const res = await fetch(`${BASE}/api/v1/admin/prompt-templates`, {
    headers: await headers(),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data.templates;
}

export async function fetchPromptTemplate(templateId: string): Promise<PromptTemplate> {
  const res = await fetch(`${BASE}/api/v1/admin/prompt-templates/${templateId}`, {
    headers: await headers(),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function createPromptTemplate(template: Partial<PromptTemplate>): Promise<any> {
  const res = await fetch(`${BASE}/api/v1/admin/prompt-templates`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify(template),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function updatePromptTemplate(templateId: string, updates: Partial<PromptTemplate>): Promise<any> {
  const res = await fetch(`${BASE}/api/v1/admin/prompt-templates/${templateId}`, {
    method: "PUT",
    headers: await headers(),
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function deletePromptTemplate(templateId: string): Promise<any> {
  const res = await fetch(`${BASE}/api/v1/admin/prompt-templates/${templateId}`, {
    method: "DELETE",
    headers: await headers(),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// AI Describe — Correction 2: accepts site_owners array
export async function aiDescribe(
  mpn: string,
  siteOwners: string[],
  observationsNote?: string
): Promise<{ results: AIGenerationResult[] }> {
  const res = await fetch(`${BASE}/api/v1/products/${encodeURIComponent(mpn)}/ai-describe`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify({ site_owners: siteOwners, observations_note: observationsNote }),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// Content Versions
export async function fetchContentVersions(
  mpn: string,
  siteOwner?: string
): Promise<ContentVersion[]> {
  const params = siteOwner ? `?site_owner=${encodeURIComponent(siteOwner)}` : "";
  const res = await fetch(
    `${BASE}/api/v1/products/${encodeURIComponent(mpn)}/content-versions${params}`,
    { headers: await headers() }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data.versions;
}

export async function approveContentVersion(mpn: string, versionId: string): Promise<any> {
  const res = await fetch(
    `${BASE}/api/v1/products/${encodeURIComponent(mpn)}/content-versions/${versionId}/approve`,
    { method: "POST", headers: await headers() }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function rejectContentVersion(mpn: string, versionId: string, reason?: string): Promise<any> {
  const res = await fetch(
    `${BASE}/api/v1/products/${encodeURIComponent(mpn)}/content-versions/${versionId}/reject`,
    { method: "POST", headers: await headers(), body: JSON.stringify({ reason }) }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function editContentVersion(
  mpn: string,
  versionId: string,
  edits: { description?: string; meta_name?: string; meta_description?: string; keywords?: string }
): Promise<any> {
  const res = await fetch(
    `${BASE}/api/v1/products/${encodeURIComponent(mpn)}/content-versions/${versionId}/edit`,
    { method: "POST", headers: await headers(), body: JSON.stringify(edits) }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function restoreContentVersion(mpn: string, versionId: string): Promise<any> {
  const res = await fetch(
    `${BASE}/api/v1/products/${encodeURIComponent(mpn)}/content-versions/${versionId}/restore`,
    { method: "POST", headers: await headers() }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// TALLY-118: Regenerate with critique
export async function regenerateWithCritique(
  mpn: string,
  versionId: string,
  critique?: string,
  observationsNote?: string
): Promise<{ result: AIGenerationResult }> {
  const res = await fetch(
    `${BASE}/api/v1/products/${encodeURIComponent(mpn)}/content-versions/${versionId}/regenerate`,
    {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ critique, observations_note: observationsNote }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// AI Assistant
export async function aiAssistant(
  mpn: string,
  message: string,
  imageData?: string
): Promise<{ response: string }> {
  const res = await fetch(
    `${BASE}/api/v1/products/${encodeURIComponent(mpn)}/ai-assistant`,
    {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ message, image_data: imageData }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ──────────────────────────────────────────────────────────────
//  Launch Calendar (Step 2.4 — Section 9.13 / 10.8)
// ──────────────────────────────────────────────────────────────
export interface LaunchRecord {
  launch_id: string;
  mpn: string;
  mpn_is_placeholder: boolean;
  product_name: string;
  brand: string;
  launch_date: string;
  sales_channel: string;
  drawing_fcfs: string;
  token_status: string;
  launch_status: "draft" | "ready" | "published" | "archived";
  is_high_priority: boolean;
  gender: string | null;
  category: string | null;
  class: string | null;
  primary_color: string | null;
  teaser_text: string | null;
  image_1_url: string | null;
  image_2_url: string | null;
  image_3_url: string | null;
  previous_launch_date: string | null;
  date_changed_at: any;
  date_change_badge_expires_at: any;
  date_change_log: Array<{
    old_date: string;
    new_date: string;
    changed_by: string;
    changed_at: any;
    reason: string | null;
  }>;
  linked_product_mpn: string | null;
  is_launch_only: boolean;
  internal_comments_count: number;
  created_by: string;
  created_at: any;
  updated_at: any;
  published_at: any;
  archived_at: any;
}

export interface LaunchReadiness {
  ok: boolean;
  missing: string[];
  checks: {
    launch_date: boolean;
    sales_channel: boolean;
    drawing_fcfs: boolean;
    token_status_set: boolean;
    image_1_uploaded: boolean;
    mpn_confirmed: boolean;
  };
}

export interface LaunchComment {
  comment_id: string;
  launch_id: string;
  comment_text: string;
  author_uid: string;
  author_name: string;
  created_at: any;
}

export async function fetchLaunches(
  params?: Record<string, string>
): Promise<{ records: LaunchRecord[]; count: number }> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(`${BASE}/api/v1/launches${qs}`, {
    headers: await headers(),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function fetchLaunch(launchId: string): Promise<{
  launch: LaunchRecord;
  readiness: LaunchReadiness;
  comments: LaunchComment[];
}> {
  const res = await fetch(
    `${BASE}/api/v1/launches/${encodeURIComponent(launchId)}`,
    { headers: await headers() }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function createLaunch(
  body: Partial<LaunchRecord>
): Promise<{ launch: LaunchRecord }> {
  const res = await fetch(`${BASE}/api/v1/launches`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function patchLaunch(
  launchId: string,
  body: Partial<LaunchRecord> & { reason?: string }
): Promise<{ launch: LaunchRecord }> {
  const res = await fetch(
    `${BASE}/api/v1/launches/${encodeURIComponent(launchId)}`,
    {
      method: "PATCH",
      headers: await headers(),
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function uploadLaunchImage(
  launchId: string,
  slot: 1 | 2 | 3,
  file: File
): Promise<{ launch_id: string; slot: number; url: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("slot", String(slot));
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");
  const token = await user.getIdToken();
  const res = await fetch(
    `${BASE}/api/v1/launches/${encodeURIComponent(launchId)}/images`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function publishLaunch(launchId: string): Promise<{
  launch?: LaunchRecord;
  published?: boolean;
  blocked?: boolean;
  missing?: string[];
  checks?: Record<string, boolean>;
}> {
  const res = await fetch(
    `${BASE}/api/v1/launches/${encodeURIComponent(launchId)}/publish`,
    { method: "POST", headers: await headers() }
  );
  const data = await res.json();
  // Surface 400 blocked responses as return values (not throws)
  if (!res.ok && data?.blocked) return data;
  if (!res.ok) throw data;
  return data;
}

export async function setLaunchTokenStatus(
  launchId: string,
  tokenStatus: "Set" | "Not Set"
): Promise<{ launch_id: string; token_status: string }> {
  const res = await fetch(
    `${BASE}/api/v1/launches/${encodeURIComponent(launchId)}/token-status`,
    {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ token_status: tokenStatus }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function postLaunchComment(
  launchId: string,
  commentText: string
): Promise<LaunchComment> {
  const res = await fetch(
    `${BASE}/api/v1/launches/${encodeURIComponent(launchId)}/comments`,
    {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ comment_text: commentText }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function archiveLaunch(
  launchId: string
): Promise<{ launch_id: string; archived: boolean }> {
  const res = await fetch(
    `${BASE}/api/v1/launches/${encodeURIComponent(launchId)}`,
    { method: "DELETE", headers: await headers() }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// Public (unauthenticated) endpoints — no Authorization header
export interface PublicLaunchCard {
  launch_id: string;
  product_name: string;
  brand: string;
  launch_date: string;
  gender: string | null;
  category: string | null;
  class: string | null;
  primary_color: string | null;
  sales_channel: string;
  drawing_fcfs: string;
  image_1_url: string | null;
  image_2_url: string | null;
  image_3_url: string | null;
  teaser_text: string | null;
  is_high_priority: boolean;
  date_change_badge_expires_at: string | null;
  previous_launch_date: string | null;
}

export async function fetchPublicLaunches(): Promise<{
  upcoming: PublicLaunchCard[];
  past: PublicLaunchCard[];
  retention_days: number;
  generated_at: string;
}> {
  const res = await fetch(`${BASE}/api/v1/launches/public`);
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function subscribeLaunchEmail(
  email: string
): Promise<{ email: string; subscribed: boolean }> {
  const res = await fetch(`${BASE}/api/v1/launches/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}


// ───────────────────────────────────────────────────────────────────────────
// Step 3.1 — Smart Rules Admin
// ───────────────────────────────────────────────────────────────────────────

export interface SmartRuleCondition {
  field: string;
  operator: string;
  value: string | number | boolean;
  logic?: "AND" | "OR";
  case_sensitive?: boolean;
}

export interface SmartRuleAction {
  target_field: string;
  value: string | number | boolean;
}

export interface SmartRule {
  rule_id: string;
  rule_name: string;
  rule_type?: string;
  is_active: boolean;
  priority: number;
  always_overwrite: boolean;
  conditions: SmartRuleCondition[];
  actions: SmartRuleAction[];
  // Legacy-schema rules may also appear:
  source_field?: string;
  action?: { target_attribute: string; output_value: string };
  condition_logic?: "AND" | "OR";
  version?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function fetchSmartRules(): Promise<SmartRule[]> {
  const res = await fetch(`${BASE}/api/v1/admin/smart-rules`, {
    headers: await headers(),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return data.rules as SmartRule[];
}

export async function fetchSmartRule(ruleId: string): Promise<SmartRule> {
  const res = await fetch(
    `${BASE}/api/v1/admin/smart-rules/${encodeURIComponent(ruleId)}`,
    { headers: await headers() }
  );
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function createSmartRule(body: Partial<SmartRule>): Promise<SmartRule> {
  const res = await fetch(`${BASE}/api/v1/admin/smart-rules`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function updateSmartRule(
  ruleId: string,
  body: Partial<SmartRule>
): Promise<SmartRule> {
  const res = await fetch(
    `${BASE}/api/v1/admin/smart-rules/${encodeURIComponent(ruleId)}`,
    {
      method: "PUT",
      headers: await headers(),
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function deactivateSmartRule(
  ruleId: string
): Promise<{ ok: boolean; rule_id: string; is_active: boolean }> {
  const res = await fetch(
    `${BASE}/api/v1/admin/smart-rules/${encodeURIComponent(ruleId)}`,
    { method: "DELETE", headers: await headers() }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export interface SmartRuleDryRunResult {
  rule_id: string;
  mpn: string;
  would_match: boolean;
  would_write: Array<{
    target_field: string;
    value: unknown;
    blocked_reason: string | null;
  }>;
}

export async function testSmartRule(
  ruleId: string,
  mpn: string
): Promise<SmartRuleDryRunResult> {
  const res = await fetch(
    `${BASE}/api/v1/admin/smart-rules/${encodeURIComponent(ruleId)}/test`,
    {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ mpn }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ═══════════════════════════════════════════════════════════════
// Step 2.5 — Pricing Discrepancy, History, Site Verification,
//            Comments, Notifications, Dashboard, Users
// ═══════════════════════════════════════════════════════════════

// ── Users roster (Correction 2) ──
export interface UserRosterEntry {
  uid: string;
  display_name: string;
  email: string | null;
  role: string | null;
  avatar_initials: string;
  active: boolean;
}
export async function fetchUsers(): Promise<UserRosterEntry[]> {
  const res = await fetch(`${BASE}/api/v1/users`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return data.users as UserRosterEntry[];
}

// ── Pricing Discrepancy ──
export interface PricingDiscrepancyItem {
  mpn: string;
  name: string;
  brand: string;
  rics_retail: number;
  rics_offer: number;
  scom: number;
  scom_sale: number;
  effective_web_regular: number | null;
  effective_web_sale: number | null;
  web_gm_pct: number | null;
  discrepancy_reasons: string[];
  flagged_at: string | null;
  flagged_by: string;
  map_price: number | null;
  is_map_protected: boolean;
}
export async function fetchPricingDiscrepancy(): Promise<{ items: PricingDiscrepancyItem[]; total: number }> {
  const res = await fetch(`${BASE}/api/v1/pricing/discrepancy`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}
export async function resolvePricingDiscrepancy(
  mpn: string,
  body: {
    action: "correct_pricing" | "flag_for_review" | "override_to_export";
    note: string;
    corrected_rics_offer?: number;
    corrected_scom?: number;
    reviewer_uid?: string;
  }
): Promise<any> {
  const res = await fetch(
    `${BASE}/api/v1/pricing/discrepancy/${encodeURIComponent(mpn)}/resolve`,
    { method: "POST", headers: await headers(), body: JSON.stringify(body) }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ── Product History ──
export interface HistoryEntry {
  id: string;
  event_type: string;
  field_key: string | null;
  old_value: unknown;
  old_verification_state: string | null;
  new_value: unknown;
  new_verification_state: string | null;
  acting_user_id: string | null;
  origin_type: string | null;
  source_type: string | null;
  rule_id: string | null;
  rule_name: string | null;
  batch_id: string | null;
  note: string | null;
  reasons: string[] | null;
  pricing_status: string | null;
  created_at: string | null;
}
export async function fetchProductHistory(
  mpn: string,
  params?: Record<string, string>
): Promise<{ entries: HistoryEntry[]; total: number }> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(
    `${BASE}/api/v1/products/${encodeURIComponent(mpn)}/history${qs}`,
    { headers: await headers() }
  );
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

// ── Site Verification Import ──
export async function siteVerificationUpload(file: File): Promise<{
  batch_id: string;
  raw_headers: string[];
  row_count: number;
}> {
  const form = new FormData();
  form.append("file", file);
  const h = await headers();
  delete (h as any)["Content-Type"];
  const res = await fetch(`${BASE}/api/v1/imports/site-verification/upload`, {
    method: "POST",
    headers: h,
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}
export async function siteVerificationCommit(
  batchId: string,
  column_mapping: Record<string, string>,
  opts?: { global_site?: string; global_verification_date?: string }
): Promise<any> {
  const body: Record<string, unknown> = { column_mapping };
  if (opts?.global_site) body.global_site = opts.global_site;
  if (opts?.global_verification_date)
    body.global_verification_date = opts.global_verification_date;
  const res = await fetch(
    `${BASE}/api/v1/imports/site-verification/${encodeURIComponent(batchId)}/commit`,
    { method: "POST", headers: await headers(), body: JSON.stringify(body) }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// Phase 4.4 §3.1 canonical site registry entry.
export interface SiteRegistryEntry {
  site_key: string;
  display_name: string;
  domain: string | null;
  is_active: boolean;
  priority: number;
  badge_color: string | null;
  notes: string | null;
}
/**
 * Fetch site registry from the canonical Phase 4.4 §8 endpoint.
 *   activeOnly=true → only is_active === true entries (use for operator dropdowns).
 *   activeOnly=false → all entries (use for admin/registry UI).
 */
export async function fetchSiteRegistry(
  activeOnly = false
): Promise<SiteRegistryEntry[]> {
  const url = activeOnly
    ? `${BASE}/api/v1/site-registry?active=true`
    : `${BASE}/api/v1/site-registry`;
  const res = await fetch(url, { headers: await headers() });
  const data = await res.json();
  if (!res.ok) throw data;
  return data.sites || [];
}

// TALLY-DEPARTMENT-REGISTRY (PO Ruling A 2026-04-23) — canonical
// department registry entry. Mirrors SiteRegistryEntry shape pattern.
export interface DepartmentRegistryEntry {
  key: string;
  display_name: string;
  aliases: string[];
  is_active: boolean;
  priority: number;
  po_confirmed: boolean;
}
/**
 * Fetch department registry from the canonical TALLY-DEPARTMENT-REGISTRY endpoint.
 *   activeOnly=true  → only is_active === true entries (use for operator dropdowns).
 *   activeOnly=false → all entries (use for admin/registry UI).
 */
export async function fetchDepartmentRegistry(
  activeOnly = false
): Promise<DepartmentRegistryEntry[]> {
  const url = activeOnly
    ? `${BASE}/api/v1/department-registry?activeOnly=true`
    : `${BASE}/api/v1/department-registry`;
  const res = await fetch(url, { headers: await headers() });
  const data = await res.json();
  if (!res.ok) throw data;
  return data.departments || [];
}

// TALLY-PRODUCT-LIST-UX Phase 1 — canonical brand registry entry.
// Mirrors DepartmentRegistryEntry shape pattern. Backed by Phase A
// commit 198c256: GET /api/v1/brand-registry.
export interface BrandRegistryEntry {
  brand_key: string;
  display_name: string;
  aliases: string[];
  default_site_owner: string | null;
  is_active: boolean;
  po_confirmed: boolean;
  notes: string | null;
  logo_url: string | null;
}
/**
 * Fetch brand registry from the canonical TALLY-PRODUCT-LIST-UX endpoint.
 *   activeOnly=true  → only is_active === true entries (use for operator dropdowns).
 *   activeOnly=false → all entries (use for admin/registry UI).
 */
export async function fetchBrandRegistry(
  activeOnly = false
): Promise<BrandRegistryEntry[]> {
  const url = activeOnly
    ? `${BASE}/api/v1/brand-registry?activeOnly=true`
    : `${BASE}/api/v1/brand-registry`;
  const res = await fetch(url, { headers: await headers() });
  const data = await res.json();
  if (!res.ok) throw data;
  return data.brands || [];
}

// ── Site Verification Review ──
export interface SiteVerificationItem {
  mpn: string;
  name: string;
  brand: string;
  site_key: string;
  verification_state: string;
  product_url: string | null;
  image_url: string | null;
  mismatch_reason: string | null;
  last_verified_at: string | null;
}
export async function fetchSiteVerificationReview(): Promise<{ items: SiteVerificationItem[]; total: number }> {
  const res = await fetch(`${BASE}/api/v1/site-verification/review`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}
export async function siteVerificationMarkLive(mpn: string, site_key: string): Promise<any> {
  const res = await fetch(
    `${BASE}/api/v1/site-verification/${encodeURIComponent(mpn)}/mark-live`,
    { method: "POST", headers: await headers(), body: JSON.stringify({ site_key }) }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}
export async function siteVerificationFlag(
  mpn: string,
  site_key: string,
  reason: string
): Promise<any> {
  const res = await fetch(
    `${BASE}/api/v1/site-verification/${encodeURIComponent(mpn)}/flag`,
    { method: "POST", headers: await headers(), body: JSON.stringify({ site_key, reason }) }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}
export async function siteVerificationReverify(mpn: string, site_key: string): Promise<any> {
  const res = await fetch(
    `${BASE}/api/v1/site-verification/${encodeURIComponent(mpn)}/reverify`,
    { method: "POST", headers: await headers(), body: JSON.stringify({ site_key }) }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ── Comments ──
export interface ProductComment {
  comment_id: string;
  text: string;
  author_uid: string | null;
  author_name: string;
  mentions: string[];
  created_at: string | null;
  edited_at: string | null;
}
export async function fetchComments(mpn: string): Promise<{ comments: ProductComment[]; total: number }> {
  const res = await fetch(
    `${BASE}/api/v1/products/${encodeURIComponent(mpn)}/comments`,
    { headers: await headers() }
  );
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}
export async function postComment(
  mpn: string,
  text: string,
  mentions: string[]
): Promise<any> {
  const res = await fetch(
    `${BASE}/api/v1/products/${encodeURIComponent(mpn)}/comments`,
    { method: "POST", headers: await headers(), body: JSON.stringify({ text, mentions }) }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}
export async function deleteComment(mpn: string, comment_id: string): Promise<any> {
  const res = await fetch(
    `${BASE}/api/v1/products/${encodeURIComponent(mpn)}/comments/${encodeURIComponent(comment_id)}`,
    { method: "DELETE", headers: await headers() }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ── Notifications ──
export interface NotificationItem {
  notification_id: string;
  type: string;
  product_mpn: string | null;
  message: string;
  read: boolean;
  created_at: string | null;
  source_comment_id: string | null;
}
export async function fetchNotifications(includeRead = false): Promise<{
  items: NotificationItem[];
  unread_count: number;
  total: number;
}> {
  const qs = includeRead ? "?include_read=true" : "";
  const res = await fetch(`${BASE}/api/v1/notifications${qs}`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}
export async function markNotificationRead(id: string): Promise<any> {
  const res = await fetch(
    `${BASE}/api/v1/notifications/${encodeURIComponent(id)}/read`,
    { method: "PATCH", headers: await headers() }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}
export async function markAllNotificationsRead(): Promise<any> {
  const res = await fetch(`${BASE}/api/v1/notifications/read-all`, {
    method: "POST",
    headers: await headers(),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}
export interface NotificationPreferences {
  mention: boolean;
  pricing_discrepancy: boolean;
  high_priority_launch: boolean;
  loss_leader: boolean;
  map_conflict: boolean;
  export_complete: boolean;
}
export async function fetchNotificationPreferences(): Promise<{
  preferences: NotificationPreferences;
  always_on: string[];
}> {
  const res = await fetch(`${BASE}/api/v1/notifications/me/preferences`, {
    headers: await headers(),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}
export async function updateNotificationPreferences(
  prefs: Partial<NotificationPreferences>
): Promise<any> {
  const res = await fetch(`${BASE}/api/v1/notifications/me/preferences`, {
    method: "PUT",
    headers: await headers(),
    body: JSON.stringify(prefs),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ── Dashboard ──
export interface DashboardResponse {
  role: string;
  greeting_name: string;
  kpis: Partial<{
    incomplete_count: number;
    cadence_review_count: number;
    map_conflict_count: number;
    pricing_discrepancy_count: number;
    site_verification_count: number;
  }>;
  recent_imports: Array<{
    batch_id: string;
    family: string | null;
    status: string | null;
    committed_rows: number;
    created_at: string | null;
  }>;
  recent_exports: Array<{
    job_id: string;
    kind: string | null;
    status: string | null;
    product_count: number;
    created_at: string | null;
  }>;
  high_priority_launches?: Array<{
    launch_id: string;
    launch_name: string;
    launch_date: string | null;
    mpn: string;
    product_name: string;
    days_remaining: number;
  }>;
  system_health: {
    projections_stale: boolean;
    failed_jobs: number;
    last_projection_refresh: string | null;
  };
}
export async function fetchDashboard(): Promise<DashboardResponse> {
  const res = await fetch(`${BASE}/api/v1/dashboard`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

// ────────────────────────────────────────────────
// Step 3.2 — Executive endpoints
// ────────────────────────────────────────────────
export interface ExecutiveHealth {
  products_added_this_month: number;
  products_added_last_month: number;
  gm_trend: { date: string; value: number }[];
  gm_target_pct: number;
  str_heatmap: { department: string; str_pct: number }[];
  markdown_forecast: Array<{
    mpn: string;
    name: string | null;
    brand: string | null;
    effective_date: string;
    current_rics_offer: number | null;
    scheduled_rics_offer: number | null;
    gm_pct_current: number | null;
    gm_pct_projected: number | null;
  }>;
  snapshot_freshness: string | null;
}

export async function fetchExecutiveHealth(): Promise<ExecutiveHealth> {
  const res = await fetch(`${BASE}/api/v1/executive/health`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export interface NeglectedItem {
  mpn: string;
  name: string | null;
  brand: string | null;
  department: string;
  days_old: number;
  days_since_touch: number;
  inventory_total: number;
  str_pct: number | null;
  wos: number | null;
  store_gm_pct: number | null;
  neglect_score: number;
  buyer_id?: string | null;
}

export interface NeglectedResponse {
  computed_at: any;
  thresholds: { age_days: number; attention_days: number } | null;
  items: NeglectedItem[];
  total_count: number;
  scoped: boolean;
}

export async function fetchNeglectedInventory(scope?: string): Promise<NeglectedResponse> {
  const qs = scope ? `?scope=${encodeURIComponent(scope)}` : "";
  const res = await fetch(`${BASE}/api/v1/executive/neglected${qs}`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export interface ThroughputResponse {
  week_key: string;
  total_completions: number;
  operators: Array<{
    uid: string;
    name: string;
    count: number;
    departments: Record<string, number>;
  }>;
}

export async function fetchOperatorThroughput(weekKey?: string): Promise<ThroughputResponse> {
  const qs = weekKey ? `?week_key=${encodeURIComponent(weekKey)}` : "";
  const res = await fetch(`${BASE}/api/v1/executive/throughput${qs}`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export interface DisparityItem {
  id: string;
  mpn: string;
  name?: string;
  brand?: string;
  department?: string;
  rics_retail?: number;
  rics_offer?: number;
  scom?: number;
  scom_sale?: number;
  map_price?: number;
  web_discount_cap?: number;
  web_gm_pct?: number;
}

export interface ChannelDisparityResponse {
  store_sale_web_full: DisparityItem[];
  web_sale_store_full: DisparityItem[];
  map_promo_eligible: DisparityItem[];
  counts: {
    store_sale_web_full: number;
    web_sale_store_full: number;
    map_promo_eligible: number;
  };
  scoped: boolean;
}

export async function fetchChannelDisparity(): Promise<ChannelDisparityResponse> {
  const res = await fetch(`${BASE}/api/v1/executive/channel-disparity`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

// Step 3.3 — Buyer Performance Matrix
export interface BuyerPerformanceCategory {
  department: string;
  product_count: number;
  avg_gm_pct: number;
  gm_target: number;
  gm_vs_target: number;
  avg_str_pct: number;
  catalog_str_pct: number;
  str_vs_catalog: number;
  recent_action_count: number;
  attention_score: number;
}

export interface BuyerPerformance {
  buyer_uid: string;
  buyer_name: string;
  computed_at: string | { _seconds: number } | null;
  review_window_days: number;
  margin_health_score: number;
  inventory_velocity_score: number;
  attention_score: number;
  composite_score: number;
  composite_color: "green" | "amber" | "red";
  products_assigned: number;
  products_with_recent_action: number;
  avg_gm_pct: number;
  avg_str_pct: number;
  catalog_avg_str_pct: number;
  category_breakdown: BuyerPerformanceCategory[];
}

export interface BuyerPerformanceListResponse {
  items: BuyerPerformance[];
  total_count: number;
  scoped: boolean;
}

export async function fetchBuyerPerformanceList(): Promise<BuyerPerformanceListResponse> {
  const res = await fetch(`${BASE}/api/v1/executive/buyer-performance`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function fetchBuyerPerformance(buyerUid: string): Promise<BuyerPerformance> {
  const res = await fetch(`${BASE}/api/v1/executive/buyer-performance/${encodeURIComponent(buyerUid)}`, {
    headers: await headers(),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

// ═══════════════════════════════════════════════════════════════
// Step 3.4 — AI Weekly Advisory
// ═══════════════════════════════════════════════════════════════

export interface AdvisoryDeadWoodProduct {
  mpn: string;
  name: string;
  brand: string;
  department: string;
  days_old: number;
  inventory_total: number;
  str_pct: number;
  wos: number;
  store_gm_pct: number;
}

export interface AdvisoryWarningProduct {
  mpn: string;
  name: string;
  brand: string;
  department: string;
  wos: number;
  inventory_total: number;
  weekly_sales_rate: number;
}

export interface WeeklyAdvisoryReport {
  report_id: string;
  buyer_uid: string;
  buyer_name: string;
  generated_at: string | null;
  import_batch_id: string;
  week_label: string;
  dead_wood: {
    summary: string;
    products: AdvisoryDeadWoodProduct[];
  };
  markdown_optimizer: {
    summary: string;
    insights: string[];
  };
  inventory_warning: {
    summary: string;
    products: AdvisoryWarningProduct[];
  };
  global_health_summary: string | null;
  read_by_buyer: boolean;
  read_at: string | null;
  model_used?: string;
}

export interface AdvisoryLatestResponse {
  report: WeeklyAdvisoryReport | null;
  global_report: WeeklyAdvisoryReport | null;
  buyer_reports: WeeklyAdvisoryReport[];
  is_exec: boolean;
}

export async function fetchAdvisoryLatest(): Promise<AdvisoryLatestResponse> {
  const res = await fetch(`${BASE}/api/v1/advisory/latest`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function fetchAdvisoryHistory(limit = 4): Promise<{ reports: WeeklyAdvisoryReport[] }> {
  const res = await fetch(`${BASE}/api/v1/advisory/history?limit=${limit}`, { headers: await headers() });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function markAdvisoryRead(reportId: string): Promise<any> {
  const res = await fetch(
    `${BASE}/api/v1/advisory/mark-read/${encodeURIComponent(reportId)}`,
    { method: "POST", headers: await headers() }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function triggerWeeklyAdvisory(importBatchId?: string): Promise<{
  ok: boolean;
  import_batch_id: string;
  buyer_reports: number;
  global_reports: number;
}> {
  const res = await fetch(`${BASE}/api/v1/executive/jobs/weekly-advisory`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify(importBatchId ? { import_batch_id: importBatchId } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ── Advisory Preferences ──
export interface AdvisoryPreferences {
  focus_area: "balanced" | "margin_health" | "inventory_clearance";
  format_preference: "prose" | "bullet_points";
}

export async function fetchAdvisoryPreferences(): Promise<{ advisory_preferences: AdvisoryPreferences }> {
  const res = await fetch(`${BASE}/api/v1/users/me/advisory-preferences`, {
    headers: await headers(),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function updateAdvisoryPreferences(
  prefs: Partial<AdvisoryPreferences>
): Promise<{ advisory_preferences: AdvisoryPreferences }> {
  const res = await fetch(`${BASE}/api/v1/users/me/advisory-preferences`, {
    method: "PUT",
    headers: await headers(),
    body: JSON.stringify(prefs),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ── Step 3.5 — Guided Tours ──
export interface TourStepDoc {
  target_selector: string;
  title: string;
  content: string;
  position?: "top" | "bottom" | "left" | "right";
}
export interface TourDoc {
  tour_id: string;
  hub: string;
  title: string;
  steps: TourStepDoc[];
  is_active: boolean;
}
export async function fetchTourForHub(hub: string): Promise<TourDoc | null> {
  const res = await fetch(`${BASE}/api/v1/tours/${encodeURIComponent(hub)}`, {
    headers: await headers(),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.tour || null;
}

// ── Step 4.2 — Admin Control Center ──
export interface AdminUser {
  uid: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
  departments?: string[] | null;
  site_scope?: string[] | null;
  disabled?: boolean;
  created_at?: string | null;
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const res = await fetch(`${BASE}/api/v1/admin/users`, {
    headers: await headers(),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data.users || [];
}

export async function createAdminUser(body: {
  email: string;
  display_name: string;
  role: string;
  departments?: string[];
  site_scope?: string[];
}): Promise<{ uid: string; temp_password: string }> {
  const res = await fetch(`${BASE}/api/v1/admin/users`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function updateAdminUser(
  uid: string,
  body: Partial<{
    display_name: string;
    role: string;
    departments: string[];
    site_scope: string[];
  }>
): Promise<{ ok: boolean }> {
  const res = await fetch(
    `${BASE}/api/v1/admin/users/${encodeURIComponent(uid)}`,
    {
      method: "PUT",
      headers: await headers(),
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function disableAdminUser(uid: string): Promise<{ ok: boolean }> {
  const res = await fetch(
    `${BASE}/api/v1/admin/users/${encodeURIComponent(uid)}`,
    { method: "DELETE", headers: await headers() }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export interface AdminSetting {
  key: string;
  value: any;
  type: string;
  category: string;
  label: string;
  description?: string | null;
  updated_at?: string | null;
}

export async function fetchAdminSettings(): Promise<AdminSetting[]> {
  const res = await fetch(`${BASE}/api/v1/admin/settings`, {
    headers: await headers(),
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data.settings || [];
}

export async function updateAdminSetting(
  key: string,
  value: any,
  opts?: { type?: string; category?: string; label?: string }
): Promise<{ ok: boolean }> {
  const res = await fetch(
    `${BASE}/api/v1/admin/settings/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: await headers(),
      body: JSON.stringify({ value, ...opts }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

export async function testSmtp(): Promise<{
  ok: boolean;
  message?: string;
  error?: string;
}> {
  const res = await fetch(`${BASE}/api/v1/admin/smtp/test`, {
    method: "POST",
    headers: await headers(),
  });
  return res.json();
}

export async function testAI(): Promise<{
  ok: boolean;
  provider?: string;
  model?: string;
  error?: string;
}> {
  const res = await fetch(`${BASE}/api/v1/admin/ai/test`, {
    method: "POST",
    headers: await headers(),
  });
  return res.json();
}

// ── Step 4.2 Amendment B — Delete product ──
export async function deleteProduct(mpn: string): Promise<{ ok: boolean }> {
  const res = await fetch(
    `${BASE}/api/v1/products/${encodeURIComponent(mpn)}`,
    { method: "DELETE", headers: await headers() }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}

// ──────────────────────────────────────────────────────────────
//  Async import progress (shared across all five import families)
// ──────────────────────────────────────────────────────────────
export interface ImportStatus {
  batch_id: string;
  status: string;
  import_type: string | null;
  row_count: number;
  committed_rows: number;
  failed_rows: number;
  skipped_rows: number;
  progress_pct: number;
  completed_at: string | null;
  error_message: string | null;
}

export async function fetchImportStatus(batchId: string): Promise<ImportStatus> {
  const res = await fetch(
    `${BASE}/api/v1/imports/status/${encodeURIComponent(batchId)}`,
    { headers: await headers() }
  );
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function fetchActiveImportJobs(): Promise<{ jobs: ImportStatus[] }> {
  const res = await fetch(`${BASE}/api/v1/imports/active`, {
    headers: await headers(),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function cancelImportJob(
  batchId: string
): Promise<{ ok: boolean; batch_id: string; status: string }> {
  const res = await fetch(
    `${BASE}/api/v1/imports/cancel/${encodeURIComponent(batchId)}`,
    { method: "POST", headers: await headers() }
  );
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}
