import { useEffect, useMemo, useState } from "react";
import {
  fetchProduct,
  saveField,
  type ProductDetail,
  type BrandRegistryEntry,
  type DepartmentRegistryEntry,
  type SiteRegistryEntry,
} from "../lib/api";

// TALLY-PRODUCT-LIST-UX Phase 4B — Quick Edit per-row side panel.
//
// Six fields, in order:
//   1. product_name    (text)
//   2. brand           (dropdown: brand_registry active)
//   3. department      (dropdown: department_registry active)
//   4. site_owner      (dropdown: site_registry active)
//   5. short_description (textarea ~3 rows)
//   6. long_description  (textarea ~8 rows)
//
// Pre-populates from a single GET /api/v1/products/:mpn — the response's
// attribute_values map already contains every field's current value.
//
// Save semantics (Frink defect 4): SEQUENTIAL await per dirty field, NOT
// Promise.all. The backend's per-field POST writes attribute_values +
// root mirror + audit_log; running concurrently would race the audit log
// and could double-fire the search_tokens reindex.

const FIELDS: Array<{
  key: "product_name" | "brand" | "department" | "site_owner" | "short_description" | "long_description";
  label: string;
  kind: "text" | "brand" | "department" | "site" | "textarea-short" | "textarea-long";
}> = [
  { key: "product_name", label: "Name", kind: "text" },
  { key: "brand", label: "Brand", kind: "brand" },
  { key: "department", label: "Department", kind: "department" },
  { key: "site_owner", label: "Site Owner", kind: "site" },
  { key: "short_description", label: "Short Description", kind: "textarea-short" },
  { key: "long_description", label: "Long Description", kind: "textarea-long" },
];

type FieldKey = (typeof FIELDS)[number]["key"];

type Values = Record<FieldKey, string>;

const EMPTY_VALUES: Values = {
  product_name: "",
  brand: "",
  department: "",
  site_owner: "",
  short_description: "",
  long_description: "",
};

function readAttrValue(detail: ProductDetail, key: FieldKey): string {
  const av = detail.attribute_values?.[key];
  if (!av) return "";
  const v = av.value;
  if (v === null || v === undefined) return "";
  return String(v);
}

interface Props {
  mpn: string;
  brandRegistry: BrandRegistryEntry[];
  departmentRegistry: DepartmentRegistryEntry[];
  siteRegistry: SiteRegistryEntry[];
  onClose: () => void;
  onSaved: (mpn: string) => void;
}

export default function QuickEditPanel({
  mpn,
  brandRegistry,
  departmentRegistry,
  siteRegistry,
  onClose,
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [productName, setProductName] = useState<string>("");
  const [original, setOriginal] = useState<Values>(EMPTY_VALUES);
  const [values, setValues] = useState<Values>(EMPTY_VALUES);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ idx: number; of: number } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [saveBanner, setSaveBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [productGone, setProductGone] = useState(false);

  // ── Pre-populate (single GET) ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setProductGone(false);
    fetchProduct(mpn)
      .then((detail) => {
        if (cancelled) return;
        const next: Values = {
          product_name: readAttrValue(detail, "product_name") || detail.name || "",
          brand: readAttrValue(detail, "brand"),
          department: readAttrValue(detail, "department"),
          site_owner: readAttrValue(detail, "site_owner"),
          short_description: readAttrValue(detail, "short_description"),
          long_description: readAttrValue(detail, "long_description"),
        };
        setOriginal(next);
        setValues(next);
        setProductName(detail.name || mpn);
      })
      .catch((err: any) => {
        if (cancelled) return;
        const msg = err?.error || err?.message || "Failed to load product.";
        setLoadError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [mpn]);

  // ── Dirty tracking (trimmed-string-equal) ──
  const dirtyKeys = useMemo<FieldKey[]>(() => {
    const out: FieldKey[] = [];
    for (const f of FIELDS) {
      if ((values[f.key] || "").trim() !== (original[f.key] || "").trim()) {
        out.push(f.key);
      }
    }
    return out;
  }, [values, original]);

  const isDirty = dirtyKeys.length > 0;

  function setField(key: FieldKey, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleSave() {
    if (saving || dirtyKeys.length === 0) return;
    setSaving(true);
    setFieldErrors({});
    setSaveBanner(null);
    const failed: Partial<Record<FieldKey, string>> = {};
    let succeeded = 0;
    // Sequential — see Frink defect 4. Any partial failure leaves the
    // panel open with the failed field marked + backend error inline.
    for (let i = 0; i < dirtyKeys.length; i++) {
      const key = dirtyKeys[i];
      setSaveProgress({ idx: i + 1, of: dirtyKeys.length });
      try {
        await saveField(mpn, key, values[key]);
        succeeded += 1;
      } catch (err: any) {
        if (err?.status === 404 || /not found/i.test(err?.error || "")) {
          setProductGone(true);
          setSaving(false);
          setSaveProgress(null);
          return;
        }
        failed[key] = err?.error || err?.message || "Save failed.";
      }
    }
    setSaveProgress(null);
    setSaving(false);

    if (Object.keys(failed).length === 0) {
      setSaveBanner({
        kind: "success",
        text: `Saved ${succeeded} field${succeeded === 1 ? "" : "s"}.`,
      });
      onSaved(mpn);
      onClose();
    } else {
      setFieldErrors(failed);
      setSaveBanner({
        kind: "error",
        text: `Saved ${succeeded} of ${dirtyKeys.length}; ${Object.keys(failed).length} failed.`,
      });
      // Refresh original for fields that did succeed so dirty state shrinks.
      setOriginal((prev) => {
        const next = { ...prev };
        for (const k of dirtyKeys) {
          if (!failed[k]) next[k] = values[k];
        }
        return next;
      });
    }
  }

  function renderInput(field: (typeof FIELDS)[number]) {
    const v = values[field.key];
    const dirty = (v || "").trim() !== (original[field.key] || "").trim();
    const fieldErr = fieldErrors[field.key];
    const baseCls = `w-full rounded border px-2 py-1 text-sm bg-white dark:bg-gray-900 ${
      fieldErr
        ? "border-red-500"
        : dirty
        ? "border-yellow-500"
        : "border-gray-300 dark:border-gray-600"
    }`;
    if (field.kind === "text") {
      return (
        <input
          type="text"
          className={baseCls}
          value={v}
          onChange={(e) => setField(field.key, e.target.value)}
          disabled={saving}
        />
      );
    }
    if (field.kind === "textarea-short") {
      return (
        <textarea
          className={baseCls}
          rows={3}
          value={v}
          onChange={(e) => setField(field.key, e.target.value)}
          disabled={saving}
        />
      );
    }
    if (field.kind === "textarea-long") {
      return (
        <textarea
          className={baseCls}
          rows={8}
          value={v}
          onChange={(e) => setField(field.key, e.target.value)}
          disabled={saving}
        />
      );
    }
    if (field.kind === "brand") {
      const inOptions = brandRegistry.some(
        (b) => b.display_name.toLowerCase() === (v || "").toLowerCase()
      );
      return (
        <select
          className={baseCls}
          value={v}
          onChange={(e) => setField(field.key, e.target.value)}
          disabled={saving || brandRegistry.length === 0}
        >
          <option value="">— Select brand —</option>
          {!inOptions && v && (
            <option value={v}>{v} (inactive)</option>
          )}
          {brandRegistry.map((b) => (
            <option key={b.brand_key} value={b.display_name}>{b.display_name}</option>
          ))}
        </select>
      );
    }
    if (field.kind === "department") {
      const inOptions = departmentRegistry.some(
        (d) => d.display_name.toLowerCase() === (v || "").toLowerCase()
          || d.key.toLowerCase() === (v || "").toLowerCase()
      );
      return (
        <select
          className={baseCls}
          value={v}
          onChange={(e) => setField(field.key, e.target.value)}
          disabled={saving || departmentRegistry.length === 0}
        >
          <option value="">— Select department —</option>
          {!inOptions && v && (
            <option value={v}>{v} (inactive)</option>
          )}
          {departmentRegistry.map((d) => (
            <option key={d.key} value={d.display_name}>{d.display_name}</option>
          ))}
        </select>
      );
    }
    // site
    const inOptions = siteRegistry.some(
      (s) => s.site_key.toLowerCase() === (v || "").toLowerCase()
    );
    return (
      <select
        className={baseCls}
        value={v}
        onChange={(e) => setField(field.key, e.target.value)}
        disabled={saving || siteRegistry.length === 0}
      >
        <option value="">— Select site owner —</option>
        {!inOptions && v && (
          <option value={v}>{v} (inactive)</option>
        )}
        {siteRegistry.map((s) => (
          <option key={s.site_key} value={s.site_key}>{s.display_name}</option>
        ))}
      </select>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-[60]"
        onClick={() => { if (!saving) onClose(); }}
        aria-hidden
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Quick edit ${mpn}`}
        className="fixed top-0 right-0 h-full w-full sm:w-[520px] bg-white dark:bg-gray-900 shadow-xl z-[60] flex flex-col border-l border-gray-200 dark:border-gray-700"
      >
        <header className="flex items-start justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0">
            <div className="text-xs uppercase text-gray-500">Quick edit</div>
            <h2 className="font-semibold truncate">
              {mpn}
              {productName && productName !== mpn && (
                <span className="text-gray-500 font-normal"> — {productName}</span>
              )}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => { if (!saving) onClose(); }}
            className="text-gray-500 hover:text-gray-900 dark:hover:text-white text-xl leading-none px-2"
            aria-label="Close"
            disabled={saving}
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {loading && <div className="text-sm text-gray-500">Loading…</div>}
          {loadError && !loading && (
            <div className="text-sm text-red-600">{loadError}</div>
          )}
          {productGone && (
            <div className="text-sm text-red-600">Product no longer exists.</div>
          )}
          {!loading && !loadError && !productGone && (
            <>
              {FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {f.label}
                    {dirtyKeys.includes(f.key) && (
                      <span className="ml-2 text-yellow-600">• unsaved</span>
                    )}
                  </span>
                  {renderInput(f)}
                  {fieldErrors[f.key] && (
                    <span className="block text-xs text-red-600 mt-1">{fieldErrors[f.key]}</span>
                  )}
                </label>
              ))}
            </>
          )}
        </div>

        <footer className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2">
          <div className="text-xs text-gray-500">
            {saveBanner && (
              <span className={saveBanner.kind === "success" ? "text-green-600" : "text-red-600"}>
                {saveBanner.text}
              </span>
            )}
            {saveProgress && (
              <span>Saving {saveProgress.idx} of {saveProgress.of}…</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-3 py-1.5 border rounded text-sm disabled:opacity-50"
              onClick={() => { if (!saving) onClose(); }}
              disabled={saving}
            >
              Close
            </button>
            <button
              type="button"
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
              onClick={handleSave}
              disabled={saving || !isDirty || loading || !!loadError || productGone}
            >
              {saving ? "Saving…" : `Save${dirtyKeys.length ? ` (${dirtyKeys.length})` : ""}`}
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}
