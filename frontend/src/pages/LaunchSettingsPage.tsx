/**
 * TALLY-SETTINGS-UX Phase 3 / A.3 PR4 — Launch Settings admin page.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  RoleGate, AdminCrudTable, AdminCrudColumn, ConfirmModal,
  ErrorBanner, SaveButton, showToast,
} from "../components/admin";
import {
  fetchLaunchSettings, createLaunchSetting, updateLaunchSetting,
  deactivateLaunchSetting, reactivateLaunchSetting, LaunchSettingEntry,
} from "../lib/api";
import { safeRenderValue } from "../lib/safeRenderValue";

function formatError(err: any): string {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  return err.error || err.message || JSON.stringify(err);
}
const isRowActive = (r: LaunchSettingEntry) => r.is_active === true;
function compareRows(a: LaunchSettingEntry, b: LaunchSettingEntry, s: { key: string; dir: "asc" | "desc" }): number {
  const av = (a as any)[s.key]; const bv = (b as any)[s.key];
  let cmp = 0;
  if (av == null && bv == null) cmp = 0;
  else if (av == null) cmp = -1;
  else if (bv == null) cmp = 1;
  else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  return s.dir === "asc" ? cmp : -cmp;
}

export default function LaunchSettingsPage() {
  const [rows, setRows] = useState<LaunchSettingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [sortState, setSortState] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "setting_key", dir: "asc" });
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editorKey, setEditorKey] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<LaunchSettingEntry | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<LaunchSettingEntry | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await fetchLaunchSettings(false)); }
    catch (e: any) { setError(formatError(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const visibleRows = useMemo(() => {
    let r = rows;
    if (!showInactive) r = r.filter(isRowActive);
    return [...r].sort((a, b) => compareRows(a, b, sortState));
  }, [rows, showInactive, sortState]);

  const baseColumns: AdminCrudColumn<LaunchSettingEntry>[] = [
    { key: "setting_key", header: "Key", sortable: true, render: (r) => <code className="text-xs">{r.setting_key}</code> },
    { key: "display_label", header: "Label", sortable: true, render: (r) => r.display_label },
    { key: "value_type", header: "Type", sortable: true, render: (r) => <span className="text-xs">{r.value_type}</span> },
    { key: "value", header: "Value", render: (r) => <code className="text-xs">{safeRenderValue(r.value)}</code> },
    {
      key: "is_active", header: "Active", sortable: true,
      render: (r) => r.is_active
        ? <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">active</span>
        : <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">inactive</span>,
    },
  ];
  const reactivateColumn: AdminCrudColumn<LaunchSettingEntry> = {
    key: "_reactivate", header: "",
    render: (row) => !isRowActive(row)
      ? <button type="button" onClick={() => setReactivateTarget(row)} className="text-blue-600 hover:underline text-sm">Reactivate</button>
      : null,
  };
  const columns = showInactive ? [...baseColumns, reactivateColumn] : baseColumns;

  return (
    <RoleGate>
      <div className="max-w-6xl mx-auto p-6">
        <Link to="/admin/experience" className="text-sm text-blue-600 hover:underline">← Experience</Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">🚀 Launch Settings</h1>
        <p className="text-gray-600 mb-6">Manage launch admin runtime settings.</p>

        <div className="flex items-center justify-between mb-4">
          <button type="button" onClick={() => { setEditorMode("create"); setEditorKey(null); }}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">+ New Setting</button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>
        <div className="mb-4"><ErrorBanner message={error} onDismiss={() => setError(null)} /></div>
        <AdminCrudTable
          rows={visibleRows} columns={columns} rowKey={(r) => r.setting_key}
          onEdit={(r) => { setEditorMode("edit"); setEditorKey(r.setting_key); }}
          onDeactivate={(r) => setDeactivateTarget(r)}
          isLoading={loading} emptyMessage="No launch settings."
          sortState={sortState} onSortChange={setSortState}
        />
        {editorMode !== null && (
          <LaunchSettingEditor mode={editorMode}
            initial={editorMode === "edit" ? rows.find((r) => r.setting_key === editorKey) ?? null : null}
            onSaved={async (savedKey, action) => {
              setEditorMode(null); setEditorKey(null);
              try { await load(); showToast(`Setting "${savedKey}" ${action}.`); }
              catch { showToast(`Setting "${savedKey}" ${action}. (Reload failed; refresh.)`);
                setError("Saved, but failed to reload table. Refresh to see latest."); }
            }}
            onCancel={() => { setEditorMode(null); setEditorKey(null); }}
          />
        )}
        <ConfirmModal
          open={deactivateTarget !== null}
          title={`Deactivate "${deactivateTarget?.display_label ?? ""}"?`}
          body={deactivateTarget ? `Deactivate setting '${deactivateTarget.setting_key}'? It can be reactivated later.` : ""}
          confirmLabel="Deactivate" confirmVariant="primary"
          onConfirm={async () => {
            if (!deactivateTarget) return;
            const justKey = deactivateTarget.setting_key;
            try {
              await deactivateLaunchSetting(justKey);
              setDeactivateTarget(null); setDeactivateError(null);
              try { await load(); showToast(`Setting "${justKey}" deactivated.`); }
              catch { showToast(`Setting "${justKey}" deactivated. (Reload failed; refresh.)`);
                setError("Deactivated, but failed to reload table. Refresh to see latest."); }
            } catch (e: any) { setDeactivateError(formatError(e)); }
          }}
          onCancel={() => { setDeactivateTarget(null); setDeactivateError(null); }}
          errorSlot={deactivateError}
        />
        <ConfirmModal
          open={reactivateTarget !== null}
          title={`Reactivate "${reactivateTarget?.display_label ?? ""}"?`}
          body={`This will reactivate the setting.`}
          confirmLabel="Reactivate" confirmVariant="primary"
          onConfirm={async () => {
            if (!reactivateTarget) return;
            const justKey = reactivateTarget.setting_key;
            try {
              await reactivateLaunchSetting(justKey);
              setReactivateTarget(null); setReactivateError(null);
              try { await load(); showToast(`Setting "${justKey}" reactivated.`); }
              catch { showToast(`Setting "${justKey}" reactivated. (Reload failed; refresh.)`);
                setError("Reactivated, but failed to reload table. Refresh to see latest."); }
            } catch (e: any) { setReactivateError(formatError(e)); }
          }}
          onCancel={() => { setReactivateTarget(null); setReactivateError(null); }}
          errorSlot={reactivateError}
        />
      </div>
    </RoleGate>
  );
}

interface EditorProps {
  mode: "create" | "edit";
  initial: LaunchSettingEntry | null | undefined;
  onSaved: (savedKey: string, action: "created" | "updated") => void | Promise<void>;
  onCancel: () => void;
}

function LaunchSettingEditor({ mode, initial, onSaved, onCancel }: EditorProps) {
  const [settingKey, setSettingKey] = useState(initial?.setting_key ?? "");
  const [displayLabel, setDisplayLabel] = useState(initial?.display_label ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [valueType, setValueType] = useState<"string" | "number" | "boolean">(initial?.value_type ?? "string");
  const [valueText, setValueText] = useState<string>(
    initial != null ? String(initial.value) : ""
  );
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  async function handleSave() {
    setEditorError(null);
    if (mode === "create" && !settingKey.trim()) { setEditorError("setting_key is required."); return; }
    if (!displayLabel.trim()) { setEditorError("display_label is required."); return; }
    let coercedValue: string | number | boolean;
    if (valueType === "number") {
      const n = Number(valueText);
      if (!Number.isFinite(n)) { setEditorError("value must be a number."); return; }
      coercedValue = n;
    } else if (valueType === "boolean") {
      const v = valueText.trim().toLowerCase();
      if (v !== "true" && v !== "false") { setEditorError("value must be 'true' or 'false'."); return; }
      coercedValue = v === "true";
    } else {
      coercedValue = valueText;
    }
    setIsSaving(true);
    try {
      const payload: Partial<LaunchSettingEntry> = {
        display_label: displayLabel.trim(),
        description: description.trim(),
        value: coercedValue,
        value_type: valueType,
        is_active: isActive,
      };
      if (mode === "create") {
        const created = await createLaunchSetting({ setting_key: settingKey.trim(), ...payload });
        await onSaved(created.setting_key, "created");
      } else {
        const updated = await updateLaunchSetting(initial!.setting_key, payload);
        await onSaved(updated.setting_key, "updated");
      }
    } catch (e: any) { setEditorError(formatError(e)); }
    finally { setIsSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !isSaving) onCancel(); }}>
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">
          {mode === "create" ? "New Launch Setting" : `Edit: ${initial?.setting_key ?? ""}`}
        </h2>
        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">setting_key *</label>
            <input type="text" value={settingKey}
              onChange={(e) => setSettingKey(e.target.value)} disabled={mode === "edit"}
              className="border rounded px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">display_label *</label>
            <input type="text" value={displayLabel}
              onChange={(e) => setDisplayLabel(e.target.value)} className="border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              rows={2} className="border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">value_type</label>
            <select value={valueType}
              onChange={(e) => setValueType(e.target.value as "string" | "number" | "boolean")}
              className="border rounded px-3 py-2 text-sm">
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">value</label>
            <input type="text" value={valueText}
              onChange={(e) => setValueText(e.target.value)}
              placeholder={valueType === "boolean" ? "true | false" : valueType === "number" ? "e.g. 42" : ""}
              className="border rounded px-3 py-2 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <input id="ls-is-active" type="checkbox" checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)} />
            <label htmlFor="ls-is-active" className="text-sm">is_active</label>
          </div>
          <ErrorBanner message={editorError} onDismiss={() => setEditorError(null)} />
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button type="button" onClick={onCancel} disabled={isSaving}
            className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded text-sm">Cancel</button>
          <SaveButton onClick={handleSave} isSaving={isSaving} />
        </div>
      </div>
    </div>
  );
}
