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

