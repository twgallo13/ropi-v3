/**
 * Phase 3.12 Track 1B — PortfolioExclusionsEditor.
 *
 * Nested editor for `portfolio_exclusions` map. Renders 6 RegistryMultiSelect
 * (one per dimension D7 + Track 1C gender: brand, department, class, site,
 * age_group, gender).
 *
 * Default-collapsed since exclusions are uncommon. Brand / dept / site /
 * age_group / gender option lists come from the parent (UserPortfolioEditor)
 * to avoid double-fetching. Class options are fetched here.
 */
import { useEffect, useState } from "react";
import { RegistryMultiSelect, type RegistryMultiSelectOption } from "./RegistryMultiSelect";
import { fetchClassOptions } from "../../lib/api";

export type ExclusionsMap = { [dimension: string]: string[] };

export interface PortfolioExclusionsEditorProps {
  value: ExclusionsMap;
  onChange: (next: ExclusionsMap) => void;
  brandOptions: RegistryMultiSelectOption[];
  deptOptions: RegistryMultiSelectOption[];
  siteOptions: RegistryMultiSelectOption[];
  ageGroupOptions: RegistryMultiSelectOption[];
  genderOptions: RegistryMultiSelectOption[];
  brandLoading?: boolean;
  deptLoading?: boolean;
  siteLoading?: boolean;
  ageGroupLoading?: boolean;
  genderLoading?: boolean;
  brandError?: string | null;
  deptError?: string | null;
  siteError?: string | null;
  ageGroupError?: string | null;
  genderError?: string | null;
}

export function PortfolioExclusionsEditor({
  value,
  onChange,
  brandOptions,
  deptOptions,
  siteOptions,
  ageGroupOptions,
  genderOptions,
  brandLoading,
  deptLoading,
  siteLoading,
  ageGroupLoading,
  genderLoading,
  brandError,
  deptError,
  siteError,
  ageGroupError,
  genderError,
}: PortfolioExclusionsEditorProps) {
  // Default-collapsed unless any dimension already has a value (so existing
  // exclusions are visible on open).
  const hasAny = Object.values(value || {}).some((arr) => Array.isArray(arr) && arr.length > 0);
  const [open, setOpen] = useState<boolean>(hasAny);

  const [classOptions, setClassOptions] = useState<RegistryMultiSelectOption[]>([]);
  const [classLoading, setClassLoading] = useState<boolean>(true);
  const [classError, setClassError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setClassLoading(true);
    fetchClassOptions()
      .then((opts) => {
        if (!cancelled) setClassOptions(opts);
      })
      .catch((e) => {
        if (!cancelled) setClassError(e?.error || e?.message || "Failed to load class registry");
      })
      .finally(() => {
        if (!cancelled) setClassLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function patch(dimension: string, next: string[]) {
    const m: ExclusionsMap = { ...(value || {}) };
    if (next.length === 0) {
      delete m[dimension];
    } else {
      m[dimension] = next;
    }
    onChange(m);
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded p-3 space-y-3">
      <button
        type="button"
        className="flex items-center gap-1 text-sm font-medium text-gray-800 dark:text-gray-100"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-xs text-gray-500">{open ? "▾" : "▸"}</span>
        Exclusions
        {hasAny && (
          <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
            ({Object.values(value).reduce((n, arr) => n + (arr?.length || 0), 0)} active)
          </span>
        )}
      </button>
      {open && (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Products matching these dimensions will be excluded from
            auto-assignment regardless of inclusion matches.
          </p>
          <RegistryMultiSelect
            label="Exclude Brands"
            value={value?.brand || []}
            onChange={(next) => patch("brand", next)}
            options={brandOptions}
            loading={brandLoading}
            error={brandError ?? null}
          />
          <RegistryMultiSelect
            label="Exclude Departments"
            value={value?.department || []}
            onChange={(next) => patch("department", next)}
            options={deptOptions}
            loading={deptLoading}
            error={deptError ?? null}
          />
          <RegistryMultiSelect
            label="Exclude Classes"
            value={value?.class || []}
            onChange={(next) => patch("class", next)}
            options={classOptions}
            loading={classLoading}
            error={classError}
          />
          <RegistryMultiSelect
            label="Exclude Sites"
            value={value?.site || []}
            onChange={(next) => patch("site", next)}
            options={siteOptions}
            loading={siteLoading}
            error={siteError ?? null}
          />
          <RegistryMultiSelect
            label="Exclude Age Groups"
            value={value?.age_group || []}
            onChange={(next) => patch("age_group", next)}
            options={ageGroupOptions}
            loading={ageGroupLoading}
            error={ageGroupError ?? null}
          />
          <RegistryMultiSelect
            label="Exclude Genders"
            value={value?.gender || []}
            onChange={(next) => patch("gender", next)}
            options={genderOptions}
            loading={genderLoading}
            error={genderError ?? null}
          />
        </>
      )}
    </div>
  );
}
