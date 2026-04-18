import { useEffect } from "react";
import { useAttributeField } from "../hooks/useAttributeField";
import { saveField } from "../lib/api";
import type { SaveFieldResponse } from "../lib/api";

export interface AttributeFieldProps {
  mpn: string;
  fieldKey: string;
  label: string;
  initialValue: string;
  isVerified?: boolean;
  verificationState?: string;
  fieldType?: "text" | "textarea" | "select" | "dropdown" | "multi_select" | "number" | "toggle" | "date";
  options?: string[];
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

  // If the parent-provided initialValue changes (e.g. after a save from
  // elsewhere or a refetch), sync it in — but only while idle.
  useEffect(() => {
    if (saveState === "idle") setValue(initialValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue]);

  // Derive effective field type: if dropdown_options exist, render as select
  // (or multi_select). This handles field_type "dropdown" from the registry.
  const hasOptions = options && options.length > 0;
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
    isVerified
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
            checked={value === "true" || (value as unknown) === true}
            onChange={(e) => {
              const newVal = e.target.checked ? "true" : "false";
              setValue(newVal);
              // Toggle saves immediately — don't wait for blur
              saveField(mpn, fieldKey, newVal).then((resp) => {
                onSaved?.(fieldKey, resp);
              }).catch(() => {});
            }}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            disabled={saveState === "saving"}
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            {value === "true" ? "Enabled" : "Disabled"}
          </span>
        </div>
      ) : effectiveType === "multi_select" && hasOptions ? (
        <select
          id={`attr-${fieldKey}`}
          multiple
          value={value ? value.split(",").map((v) => v.trim()) : []}
          onChange={(e) => {
            const selected = Array.from(e.target.selectedOptions, (o) => o.value);
            setValue(selected.join(", "));
          }}
          onBlur={handleBlur}
          tabIndex={tabIndex}
          className={inputClass + " min-h-[80px]"}
          disabled={saveState === "saving"}
        >
          {options!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : effectiveType === "select" && hasOptions ? (
        <select
          id={`attr-${fieldKey}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          tabIndex={tabIndex}
          className={inputClass}
          disabled={saveState === "saving"}
        >
          <option value="">— Select —</option>
          {options!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={`attr-${fieldKey}`}
          type={effectiveType === "number" ? "number" : "text"}
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
    </div>
  );
}
