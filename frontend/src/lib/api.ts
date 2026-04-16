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
}

export interface ProductListResponse {
  items: ProductListItem[];
  total: number;
  next_cursor: string | null;
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
}

export async function fetchProducts(params?: Record<string, string>): Promise<ProductListResponse> {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(`${BASE}/api/v1/products${qs}`, { headers: await headers() });
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

export interface SiteTarget {
  site_id: string;
  domain: string;
  verification_state: string;
  product_link: string | null;
  image_link: string | null;
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
  site_targets: SiteTarget[];
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
