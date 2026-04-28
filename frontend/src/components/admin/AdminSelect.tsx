/**
 * TALLY-SETTINGS-UX Phase 3 / B.0 — AdminSelect
 *
 * Strict prop-based dropdown (PO Ruling 4) enforcing Master Vision UX Directive 1.
 * Caller owns fetch + state; component does NOT fetch internally.
 */
export interface AdminSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface AdminSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: AdminSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function AdminSelect({
  value,
  onChange,
  options,
  placeholder = "— Select —",
  disabled,
  className,
}: AdminSelectProps) {
  const base =
    "bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 " +
    "text-gray-900 dark:text-gray-100 rounded px-3 py-2 text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-blue-500 " +
    "disabled:opacity-50 disabled:cursor-not-allowed";

  if (options.length === 0) {
    return (
      <select className={[base, className].filter(Boolean).join(" ")} disabled>
        <option>No options available</option>
      </select>
    );
  }

  const currentMatches = options.some((o) => o.value === value);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={[base, className].filter(Boolean).join(" ")}
    >
      {!currentMatches && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default AdminSelect;
