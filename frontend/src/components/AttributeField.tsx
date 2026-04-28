import { useEffect, useState } from "react";
import { useAttributeField } from "../hooks/useAttributeField";
import {
  saveField,
  fetchSiteRegistry,
  fetchBrandRegistry,
  fetchDepartmentRegistry,
} from "../lib/api";
import type {
  SaveFieldResponse,
  SiteRegistryEntry,
  BrandRegistryEntry,
  DepartmentRegistryEntry,
} from "../lib/api";

/** Resolved option for dropdowns — label shown to user, value submitted on save. */
interface ResolvedOption {
  label: string;
  value: string;
}

export interface AttributeFieldProps {
  mpn: string;
  fieldKey: string;
  label: string;
  initialValue: string;
  isVerified?: boolean;
  verificationState?: string;
  fieldType?: "text" | "textarea" | "select" | "dropdown" | "multi_select" | "number" | "toggle" | "date";
  options?: string[];
  dropdownSource?: string;
  tabIndex?: number;
  fullWidth?: boolean;
  onSaved?: (fieldKey: string, resp: SaveFieldResponse) => void;
}

export function AttributeField({
  mpn,
  fieldKey,
  label,
  initialValue,
  isVerified,
  verificationState,
  fieldType = "text",
  options,
  dropdownSource,
  tabIndex,
  fullWidth,
  onSaved,
}: AttributeFieldProps) {
  const { value, setValue, saveState, error, handleBlur } = useAttributeField(
    mpn,
    fieldKey,
    initialValue,
    onSaved
  );

  // ── Registry-driven dropdown support ──
  // TALLY-PRODUCT-EDITOR-REGISTRY-DROPDOWNS: extended from 1 → 3 sources.
  //   - dropdown_source === "site_registry"       → fetchSiteRegistry       (TALLY-123 Task 7, original)
  //   - dropdown_source === "brand_registry"      → fetchBrandRegistry      (NEW)
  //   - dropdown_source === "department_registry" → fetchDepartmentRegistry (NEW)
  // Three failure contracts from TALLY-123 Task 7 apply identically across all three:
  //   1. fetch-fails  → disabled + red border
  //   2. empty-registry → disabled + amber border
  //   3. orphaned-value → preserved with "(inactive)" suffix
  // Three explicit branches by design — no generic dispatcher abstraction.
  const [registryOptions, setRegistryOptions] = useState<ResolvedOption[] | null>(null);
  const [registryError, setRegistryError] = useState<"fetch-fail" | "empty" | null>(null);

  useEffect(() => {
    let cancelled = false;
    let p: Promise<ResolvedOption[]> | null = null;
    if (dropdownSource === "site_registry") {
      p = fetchSiteRegistry(true).then((sites: SiteRegistryEntry[]) =>
        sites.map((s) => ({ label: s.display_name, value: s.site_key }))
      );
    } else if (dropdownSource === "brand_registry") {
      p = fetchBrandRegistry(true).then((brands: BrandRegistryEntry[]) =>
        brands.map((b) => ({ label: b.display_name, value: b.brand_key }))
      );
    } else if (dropdownSource === "department_registry") {
      p = fetchDepartmentRegistry(true).then((depts: DepartmentRegistryEntry[]) =>
        depts.map((d) => ({ label: d.display_name, value: d.key }))
      );
    } else {
      return;
    }
    p.then((resolved) => {
        if (cancelled) return;
        if (resolved.length === 0) {
          setRegistryError("empty");
          setRegistryOptions([]);
        } else {
          setRegistryOptions(resolved);
          setRegistryError(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setRegistryError("fetch-fail");
        setRegistryOptions(null);
      });
    return () => { cancelled = true; };
  }, [dropdownSource]);

  // If the parent-provided initialValue changes (e.g. after a save from
  // elsewhere or a refetch), sync it in — but only while idle.
  useEffect(() => {
    if (saveState === "idle") setValue(initialValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue]);

  // ── Resolve effective options ──
  // Registry-driven fields override the static options prop.
  // TALLY-PRODUCT-EDITOR-REGISTRY-DROPDOWNS: extended from 1 → 3 sources.
  const isRegistryDriven =
    dropdownSource === "site_registry" ||
    dropdownSource === "brand_registry" ||
    dropdownSource === "department_registry";
  let resolvedOptions: ResolvedOption[] = [];
  const registryDisabled = isRegistryDriven && (registryError === "fetch-fail" || registryError === "empty");

  if (isRegistryDriven && registryOptions) {
    resolvedOptions = [...registryOptions];
    // Orphaned-value contract: if current value(s) not in registry, preserve with "(inactive)" marker
    const knownValues = new Set(resolvedOptions.map((o) => o.value));
    const currentValues = value ? value.split(",").map((v) => v.trim()).filter(Boolean) : [];
    for (const cv of currentValues) {
      if (cv && !knownValues.has(cv)) {
        resolvedOptions.push({ label: `${cv} (inactive)`, value: cv });
      }
    }
  } else if (!isRegistryDriven && options) {
    resolvedOptions = options.map((o) => ({ label: o, value: o }));
  }

  const hasOptions = resolvedOptions.length > 0;
  const isMultiSelect = fieldType === "multi_select";
  const effectiveType: string = hasOptions
    ? isMultiSelect
      ? "multi_select"
      : "select"
    : fieldType === "dropdown"
      ? "select"
      : fieldType || "text";

  const inputClass = [
    "w-full border rounded-lg px-3 py-2 text-sm",
    "focus:outline-none focus:ring-2 focus:ring-blue-500",
    "dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100",
    registryError === "fetch-fail"
      ? "border-red-400 bg-red-50 dark:border-red-600 dark:bg-red-900/10"
      : registryError === "empty"
        ? "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/10"
        : isVerified
          ? "border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/10"
          : "border-gray-200 dark:border-gray-700",
    saveState === "error" ? "border-red-400" : "",
  ].join(" ");

  const wrapperClass = fullWidth
    ? "flex flex-col gap-1 col-span-2"
    : "flex flex-col gap-1";

  return (
    <div className={wrapperClass}>
      <div className="flex items-center justify-between">
        <label
          htmlFor={`attr-${fieldKey}`}
          className="text-xs font-medium text-gray-600 dark:text-gray-400"
        >
          {label}
        </label>
        <span className="text-xs">
          {saveState === "saving" && (
            <span className="text-blue-500 animate-pulse">Saving…</span>
          )}
          {saveState === "saved" && (
            <span className="text-green-600">✓ Saved</span>
          )}
          {saveState === "error" && (
            <span className="text-red-500" title={error || ""}>
              ✕ Error
            </span>
          )}
          {saveState === "idle" && isVerified && verificationState === "Human-Verified" && (
            <span
              className="text-green-600"
              title="Human Verified"
              aria-label="Human Verified"
            >
              🔒
            </span>
          )}
          {saveState === "idle" && verificationState === "Rule-Verified" && (
            <span
              className="text-blue-500"
              title="Auto-filled by Smart Rule"
              aria-label="Auto-filled by Smart Rule"
            >
              ⚡
            </span>
          )}
          {saveState === "idle" && !isVerified && verificationState !== "Rule-Verified" && (
            <span
              className="text-gray-300"
              title="Needs verification"
              aria-label="Needs verification"
            >
              ○
            </span>
          )}
        </span>
      </div>

      {effectiveType === "textarea" ? (
        <textarea
          id={`attr-${fieldKey}`}
          name={fieldKey}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          tabIndex={tabIndex}
          rows={3}
          className={inputClass}
          disabled={saveState === "saving"}
        />
      ) : effectiveType === "toggle" ? (
        <div className="flex items-center gap-3 py-2">
          <input
            type="checkbox"
            id={`attr-${fieldKey}`}
            name={fieldKey}
            checked={value === "true" || (value as unknown) === true || value === "TRUE"}
            onChange={(e) => {
              const newVal = e.target.checked ? "true" : "false";
              setValue(newVal);
              // Toggle saves immediately — don't wait for blur
              saveField(mpn, fieldKey, newVal).then((resp) => {
                onSaved?.(fieldKey, resp);
              }).catch(() => {});
            }}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
            disabled={saveState === "saving"}
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            {value === "true" || (value as unknown) === true || value === "TRUE" ? "Enabled" : "Not enabled"}
          </span>
        </div>
      ) : effectiveType === "multi_select" && hasOptions ? (
        <select
          id={`attr-${fieldKey}`}
          name={fieldKey}
          multiple
          value={value ? value.split(",").map((v) => v.trim()) : []}
          onChange={(e) => {
            const selected = Array.from(e.target.selectedOptions, (o) => o.value);
            setValue(selected.join(", "));
          }}
          onBlur={handleBlur}
          tabIndex={tabIndex}
          className={inputClass + " min-h-[80px]"}
          disabled={saveState === "saving" || registryDisabled}
        >
          {resolvedOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : effectiveType === "select" && hasOptions ? (
        <select
          id={`attr-${fieldKey}`}
          name={fieldKey}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          tabIndex={tabIndex}
          className={inputClass}
          disabled={saveState === "saving" || registryDisabled}
        >
          <option value="">— Select —</option>
          {resolvedOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={`attr-${fieldKey}`}
          name={fieldKey}
          type={effectiveType === "number" ? "number" : effectiveType === "date" ? "date" : "text"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          tabIndex={tabIndex}
          className={inputClass}
          disabled={saveState === "saving"}
        />
      )}

      {saveState === "error" && error && (
        <p className="text-xs text-red-500 mt-0.5">{error}</p>
      )}

      {registryError === "fetch-fail" && (
        <p className="text-xs text-red-500 mt-0.5">⚠ Could not load registry — field disabled</p>
      )}
      {registryError === "empty" && (
        <p className="text-xs text-amber-600 mt-0.5">⚠ No active entries in registry — field disabled</p>
      )}
    </div>
  );
}
