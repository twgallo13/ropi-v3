/**
 * Track 3 Cockpit V1 — View As bar.
 *
 * - Plain buyer callers see only buyer-role targets in the dropdown.
 * - Privileged callers (head_buyer / admin / owner) see all users.
 * - Selection persisted via localStorage (lib/api.ts setViewAsUid).
 * - Banner shows read-only state (canWrite=false) or write-authority retained
 *   (when privileged user views-as another user).
 */
import { setViewAsUid } from "../../lib/api";
import type { CockpitMeta } from "../../lib/api";

interface Props {
  meta: CockpitMeta;
  onChange: () => void;
}

// TALLY-D3-F — actors whose Self option carries an "Admin Global" suffix.
// Mirrors backend isAdminGlobal inference (buyerReview.ts L42:
// ["head_buyer", "admin"].includes(role)). Must stay in sync with backend.
const ADMIN_GLOBAL_ROLES = new Set(["head_buyer", "admin"]);

export default function ViewAsBar({ meta, onChange }: Props) {
  // TALLY-D3-F — backend pre-filters viewable_users to cadence buyer roles;
  // FE only excludes self.
  const options = meta.viewable_users.filter((u) => u.uid !== meta.acting_user_id);

  const selfLabel = ADMIN_GLOBAL_ROLES.has(meta.acting_role)
    ? `— Self (${meta.acting_role} — Admin Global) —`
    : `— Self (${meta.acting_role}) —`;

  const currentSelection = meta.is_view_as ? meta.effective_user_id : "";

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    setViewAsUid(v || null);
    onChange();
  }

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <label className="text-sm font-medium text-slate-700">
          View As
          <select
            className="ml-2 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            value={currentSelection}
            onChange={handleChange}
          >
            <option value="">{selfLabel}</option>
            {options.map((u) => (
              <option key={u.uid} value={u.uid}>
                {u.display_name} ({u.role})
              </option>
            ))}
          </select>
        </label>

        {meta.is_view_as && (
          <div
            className={`text-sm rounded px-2 py-1 ${
              meta.can_write
                ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                : "bg-amber-100 text-amber-800 border border-amber-200"
            }`}
          >
            {meta.can_write
              ? `Acting as ${meta.acting_role} — write authority retained`
              : "Read-only view — write actions disabled"}
          </div>
        )}
      </div>
    </div>
  );
}
