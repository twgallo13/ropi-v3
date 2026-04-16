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
}

export async function saveField(mpn: string, fieldKey: string, value: unknown): Promise<SaveFieldResponse> {
  const res = await fetch(
    `${BASE}/api/v1/products/${encodeURIComponent(mpn)}/attributes/${encodeURIComponent(fieldKey)}`,
    {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ value }),
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
