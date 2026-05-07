/**
 * Phase 3.12 Track 1B — UserPortfolioEditor.
 *
 * Domain composition. Renders all 5 portfolio_* RegistryMultiSelect plus
 * nested PortfolioExclusionsEditor. Single Promise.all fetches all 5
 * registry option lists on mount; lists are passed through to the
 * exclusions editor to avoid double-fetching.
 *
 * D1 fields: portfolio_brands, portfolio_depts, portfolio_sites,
 * portfolio_age_groups, portfolio_gender (arrays); portfolio_exclusions (map).
 */
import { useEffect, useState } from "react";
import { RegistryMultiSelect, type RegistryMultiSelectOption } from "./RegistryMultiSelect";
import { PortfolioExclusionsEditor, type ExclusionsMap } from "./PortfolioExclusionsEditor";
import {
  fetchBrandRegistry,
  fetchDepartmentRegistry,
  fetchSiteRegistry,
  fetchAgeGroupOptions,
  fetchGenderOptions,
} from "../../lib/api";

export interface UserPortfolioEditorPatch {
  portfolio_brands?: string[];
  portfolio_depts?: string[];
  portfolio_sites?: string[];
  portfolio_age_groups?: string[];
  portfolio_gender?: string[];
  portfolio_exclusions?: ExclusionsMap;
}

export interface UserPortfolioEditorProps {
  portfolioBrands: string[];
  portfolioDepts: string[];
  portfolioSites: string[];
  portfolioAgeGroups: string[];
  portfolioGender: string[];
  portfolioExclusions: ExclusionsMap;
  onChange: (patch: UserPortfolioEditorPatch) => void;
}

interface RegistryState {
  options: RegistryMultiSelectOption[];
  loading: boolean;
  error: string | null;
}

const initialState: RegistryState = { options: [], loading: true, error: null };

export function UserPortfolioEditor({
  portfolioBrands,
  portfolioDepts,
  portfolioSites,
  portfolioAgeGroups,
  portfolioGender,
  portfolioExclusions,
  onChange,
}: UserPortfolioEditorProps) {
  const [brands, setBrands] = useState<RegistryState>(initialState);
  const [depts, setDepts] = useState<RegistryState>(initialState);
  const [sites, setSites] = useState<RegistryState>(initialState);
  const [ageGroups, setAgeGroups] = useState<RegistryState>(initialState);
  const [gender, setGender] = useState<RegistryState>(initialState);

  useEffect(() => {
    let cancelled = false;

    function setOK(setter: (s: RegistryState) => void, opts: RegistryMultiSelectOption[]) {
      if (!cancelled) setter({ options: opts, loading: false, error: null });
    }
    function setErr(setter: (s: RegistryState) => void, e: any) {
      if (!cancelled)
        setter({
          options: [],
          loading: false,
          error: e?.error || e?.message || "Failed to load registry",
        });
    }

    fetchBrandRegistry(true)
      .then((rows) =>
        setOK(setBrands, rows.map((r) => ({ value: r.brand_key, label: r.display_name })))
      )
      .catch((e) => setErr(setBrands, e));

    fetchDepartmentRegistry(true)
      .then((rows) =>
        setOK(setDepts, rows.map((r) => ({ value: r.key, label: r.display_name })))
      )
      .catch((e) => setErr(setDepts, e));

    fetchSiteRegistry(true)
      .then((rows) =>
        setOK(setSites, rows.map((r) => ({ value: r.site_key, label: r.display_name })))
      )
      .catch((e) => setErr(setSites, e));

    fetchAgeGroupOptions()
      .then((opts) => setOK(setAgeGroups, opts))
      .catch((e) => setErr(setAgeGroups, e));

    fetchGenderOptions()
      .then((opts) => setOK(setGender, opts))
      .catch((e) => setErr(setGender, e));

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-3 border-t border-gray-200 dark:border-gray-700 pt-3">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Portfolio</h3>
      <RegistryMultiSelect
        label="Brands"
        value={portfolioBrands}
        onChange={(next) => onChange({ portfolio_brands: next })}
        options={brands.options}
        loading={brands.loading}
        error={brands.error}
      />
      <RegistryMultiSelect
        label="Departments"
        value={portfolioDepts}
        onChange={(next) => onChange({ portfolio_depts: next })}
        options={depts.options}
        loading={depts.loading}
        error={depts.error}
      />
      <RegistryMultiSelect
        label="Sites"
        value={portfolioSites}
        onChange={(next) => onChange({ portfolio_sites: next })}
        options={sites.options}
        loading={sites.loading}
        error={sites.error}
      />
      <RegistryMultiSelect
        label="Age Groups"
        value={portfolioAgeGroups}
        onChange={(next) => onChange({ portfolio_age_groups: next })}
        options={ageGroups.options}
        loading={ageGroups.loading}
        error={ageGroups.error}
      />
      <RegistryMultiSelect
        label="Gender"
        value={portfolioGender}
        onChange={(next) => onChange({ portfolio_gender: next })}
        options={gender.options}
        loading={gender.loading}
        error={gender.error}
      />
      <PortfolioExclusionsEditor
        value={portfolioExclusions}
        onChange={(next) => onChange({ portfolio_exclusions: next })}
        brandOptions={brands.options}
        deptOptions={depts.options}
        siteOptions={sites.options}
        ageGroupOptions={ageGroups.options}
        genderOptions={gender.options}
        brandLoading={brands.loading}
        deptLoading={depts.loading}
        siteLoading={sites.loading}
        ageGroupLoading={ageGroups.loading}
        genderLoading={gender.loading}
        brandError={brands.error}
        deptError={depts.error}
        siteError={sites.error}
        ageGroupError={ageGroups.error}
        genderError={gender.error}
      />
    </div>
  );
}
