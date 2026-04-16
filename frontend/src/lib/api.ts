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
