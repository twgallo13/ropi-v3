/**
 * Phase 3.12 Track 1B — RegistryMultiSelect.
 *
 * Locked-options chip-style multi-select. Reusable 9× across the
 * UserPortfolioEditor and PortfolioExclusionsEditor surfaces. NO free text;
 * users may only select from `options`.
 *
 * Visual conventions mirror frontend/src/components/AttributeField.tsx:
 *   - error truthy            → border-red-400 bg-red-50
 *   - empty registry & !error → border-amber-400 bg-amber-50 (data flag)
 *   - loading                 → disabled + spinner
 *   - disabled                → grayed, no interactions
 */
import { useEffect, useMemo, useRef, useState } from "react";

export interface RegistryMultiSelectOption {
  value: string;
  label: string;
}

export interface RegistryMultiSelectProps {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  options: RegistryMultiSelectOption[];
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  placeholder?: string;
  helperText?: string;
}

export function RegistryMultiSelect({
  label,
  value,
  onChange,
  options,
  loading = false,
  error = null,
  disabled = false,
  placeholder = "Select…",
  helperText,
}: RegistryMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Hide already-selected values from the dropdown list.
  const available = useMemo(
    () => options.filter((opt) => !value.includes(opt.value)),
    [options, value]
  );

  useEffect(() => {
    if (highlight >= available.length) setHighlight(Math.max(0, available.length - 1));
  }, [available.length, highlight]);

  const isEmpty = !loading && !error && options.length === 0;

  // Visual state class: error → red, empty → amber, else neutral.
  const stateClass = error
    ? "border-red-400 bg-red-50 dark:border-red-600 dark:bg-red-900/10"
    : isEmpty
    ? "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/10"
    : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900";

  const interactionDisabled = disabled || loading || !!error;

  function addValue(v: string) {
    if (value.includes(v)) return;
    onChange([...value, v]);
    setOpen(true);
    inputRef.current?.focus();
  }

  function removeValue(v: string) {
    onChange(value.filter((x) => x !== v));
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (interactionDisabled) return;
    if (e.key === "Backspace" && value.length > 0) {
      // Backspace on empty input removes last chip.
      e.preventDefault();
      removeValue(value[value.length - 1]);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(available.length - 1, h + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && available[highlight]) {
        addValue(available[highlight].value);
      } else {
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    // Block all other character input — locked options, no free text.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
    }
  }

  return (
    <div className="space-y-1" ref={wrapperRef}>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div
        className={`relative w-full rounded border px-2 py-1 text-sm ${stateClass} ${
          interactionDisabled ? "opacity-60 pointer-events-none" : ""
        }`}
        onClick={() => {
          if (interactionDisabled) return;
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        <div className="flex flex-wrap items-center gap-1 min-h-[1.5rem]">
          {value.map((v) => {
            const opt = options.find((o) => o.value === v);
            const labelText = opt?.label ?? v;
            return (
              <span
                key={v}
                className="inline-flex items-center gap-1 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-900 dark:text-blue-100 text-xs px-1.5 py-0.5"
              >
                {labelText}
                {!opt && (
                  <span className="text-amber-700 dark:text-amber-400" title="Not in current registry">
                    (inactive)
                  </span>
                )}
                <button
                  type="button"
                  className="hover:text-red-700 text-sm leading-none"
                  aria-label={`Remove ${labelText}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeValue(v);
                  }}
                >
                  ×
                </button>
              </span>
            );
          })}
          <input
            ref={inputRef}
            className="flex-1 min-w-[6rem] bg-transparent outline-none text-sm"
            placeholder={value.length === 0 ? placeholder : ""}
            value=""
            readOnly
            onChange={() => {
              /* locked — no free text */
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            disabled={interactionDisabled}
          />
          {loading ? (
            <span className="text-xs text-gray-400 animate-pulse">…</span>
          ) : (
            <span className="text-xs text-gray-400">▾</span>
          )}
        </div>
        {open && !interactionDisabled && available.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-48 overflow-auto rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow">
            {available.map((opt, idx) => (
              <button
                key={opt.value}
                type="button"
                className={`w-full text-left text-sm px-2 py-1 ${
                  idx === highlight
                    ? "bg-blue-50 dark:bg-blue-900/30"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
                onMouseEnter={() => setHighlight(idx)}
                onClick={(e) => {
                  e.stopPropagation();
                  addValue(opt.value);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!error && isEmpty && (
        <p className="text-xs text-amber-600">⚠ No options available</p>
      )}
      {!error && !isEmpty && helperText && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{helperText}</p>
      )}
    </div>
  );
}
