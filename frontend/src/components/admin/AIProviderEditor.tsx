/**
 * Phase 3.3 PR 3.3b — AIProviderEditor (metadata only, Option A).
 *
 * Modal editor for AI Provider Registry create/edit. Wires to BE:
 *   POST /api/v1/admin/ai/providers
 *   PUT  /api/v1/admin/ai/providers/:provider_key
 *
 * Models[] schema (verbatim from validateProviderModel @ aiPlane.ts L66-78):
 *   model_key (req), display_name (req), is_active?, sort_order?
 *
 * Hard scope (Option A):
 *   - NO API key value handling (keys live in GCP Secret Manager).
 *   - NO eye icon, NO password input, NO showPassword.
 *   - NO new dependencies.
 */
import { useState } from "react";
import {
  AdminSelect,
  ErrorBanner,
  SaveButton,
  type AdminSelectOption,
} from "./index";
import {
  createAIProvider,
  updateAIProvider,
  type AIProvider,
  type AIProviderModel,
  type AIProviderPayload,
} from "../../lib/api";

const KEY_SOURCE_OPTIONS: AdminSelectOption[] = [
  { value: "env_var", label: "Env Var (GCP Secret Manager)" },
  { value: "admin_settings", label: "Admin Settings" },
  { value: "vault", label: "Vault" },
];

const ENV_VAR_HELPER =
  "Env var must be configured in GCP Secret Manager + Cloud Run before " +
  "provider will function. Setting this name does not create the secret.";

function formatError(err: any): string {
  if (!err) return "Unknown error.";
  if (typeof err === "string") return err;
  return err.error || err.message || JSON.stringify(err);
}

export interface AIProviderEditorProps {
  mode: "create" | "edit";
  initial: AIProvider | null;
  onSaved: (provider: AIProvider, action: "created" | "updated") => void | Promise<void>;
  onCancel: () => void;
}

export function AIProviderEditor({
  mode,
  initial,
  onSaved,
  onCancel,
}: AIProviderEditorProps) {
  const [providerKey, setProviderKey] = useState<string>(initial?.provider_key ?? "");
  const [displayName, setDisplayName] = useState<string>(initial?.display_name ?? "");
  const [apiKeySource, setApiKeySource] = useState<string>(
    initial?.api_key_source ?? "env_var"
  );
  const [envVarName, setEnvVarName] = useState<string>(
    initial?.api_key_env_var_name ?? ""
  );
  const [sortOrder, setSortOrder] = useState<number>(initial?.sort_order ?? 10);
  const [isActive, setIsActive] = useState<boolean>(initial?.is_active ?? true);
  const [models, setModels] = useState<AIProviderModel[]>(
    initial?.models ? [...initial.models] : []
  );

  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  function updateModel(idx: number, patch: Partial<AIProviderModel>) {
    setModels((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  }
  function removeModel(idx: number) {
    setModels((prev) => prev.filter((_, i) => i !== idx));
  }
  function addModel() {
    setModels((prev) => [
      ...prev,
      { model_key: "", display_name: "", is_active: true, sort_order: prev.length + 1 },
    ]);
  }

  async function handleSave() {
    setEditorError(null);

    const trimmedKey = providerKey.trim();
    const trimmedName = displayName.trim();
    const trimmedEnvVar = envVarName.trim();

    if (mode === "create" && !trimmedKey) {
      setEditorError("Provider Key is required.");
      return;
    }
    if (!trimmedName) {
      setEditorError("Display Name is required.");
      return;
    }
    if (apiKeySource === "env_var" && !trimmedEnvVar) {
      setEditorError("Env Var Name is required when Key Source = 'env_var'.");
      return;
    }
    // Validate inline models[] entries (mirror BE validateProviderModel).
    for (let i = 0; i < models.length; i++) {
      const m = models[i];
      if (!m.model_key.trim()) {
        setEditorError(`Model row ${i + 1}: model_key is required.`);
        return;
      }
      if (!m.display_name.trim()) {
        setEditorError(`Model row ${i + 1}: display_name is required.`);
        return;
      }
    }

    const cleanModels: AIProviderModel[] = models.map((m) => ({
      model_key: m.model_key.trim(),
      display_name: m.display_name.trim(),
      is_active: m.is_active !== false,
      sort_order: typeof m.sort_order === "number" ? m.sort_order : 0,
    }));

    setIsSaving(true);
    try {
      if (mode === "create") {
        const payload: AIProviderPayload = {
          provider_key: trimmedKey,
          display_name: trimmedName,
          api_key_source: apiKeySource as AIProviderPayload["api_key_source"],
          api_key_env_var_name:
            apiKeySource === "env_var" ? trimmedEnvVar : trimmedEnvVar || null,
          is_active: isActive,
          sort_order: Number.isFinite(sortOrder) ? sortOrder : 10,
          models: cleanModels,
        };
        const created = await createAIProvider(payload);
        await onSaved(created, "created");
      } else {
        const patch: Partial<Omit<AIProviderPayload, "provider_key">> = {
          display_name: trimmedName,
          api_key_source: apiKeySource as AIProviderPayload["api_key_source"],
          api_key_env_var_name:
            apiKeySource === "env_var" ? trimmedEnvVar : trimmedEnvVar || null,
          is_active: isActive,
          sort_order: Number.isFinite(sortOrder) ? sortOrder : 10,
          models: cleanModels,
        };
        const updated = await updateAIProvider(initial!.provider_key, patch);
        await onSaved(updated, "updated");
      }
    } catch (e: any) {
      setEditorError(formatError(e));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onCancel();
      }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">
          {mode === "create"
            ? "New AI Provider"
            : `Edit Provider: ${initial?.display_name ?? initial?.provider_key ?? ""}`}
        </h2>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Display Name *</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="border rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">
                Provider Key {mode === "create" ? "*" : ""}
              </label>
              <input
                type="text"
                value={providerKey}
                onChange={(e) => setProviderKey(e.target.value)}
                disabled={mode === "edit"}
                className="border rounded px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
              />
              <span className="text-xs text-gray-500">
                Unique identifier; immutable after creation.
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Key Source *</label>
              <AdminSelect
                value={apiKeySource}
                onChange={setApiKeySource}
                options={KEY_SOURCE_OPTIONS}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Sort Order</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 0)}
                className="border rounded px-3 py-2 text-sm"
              />
            </div>
          </div>

          {apiKeySource === "env_var" && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Env Var Name *</label>
              <input
                type="text"
                value={envVarName}
                onChange={(e) => setEnvVarName(e.target.value)}
                placeholder="e.g. ANTHROPIC_API_KEY"
                className="border rounded px-3 py-2 text-sm font-mono"
              />
              <span className="text-xs text-gray-500">{ENV_VAR_HELPER}</span>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Active
          </label>

          {/* Models inline editor — schema verified at aiPlane.ts L66-78 */}
          <div className="flex flex-col gap-2 pt-2 border-t">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Models</label>
              <button
                type="button"
                onClick={addModel}
                className="text-xs text-blue-600 hover:underline"
              >
                + Add model
              </button>
            </div>
            {models.length === 0 ? (
              <p className="text-xs text-gray-500">No models. Add one above.</p>
            ) : (
              <div className="space-y-2">
                {models.map((m, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-12 gap-2 items-center border rounded p-2 bg-gray-50 dark:bg-gray-800"
                  >
                    <input
                      type="text"
                      value={m.model_key}
                      onChange={(e) => updateModel(i, { model_key: e.target.value })}
                      placeholder="model_key"
                      className="col-span-4 border rounded px-2 py-1 text-xs font-mono"
                    />
                    <input
                      type="text"
                      value={m.display_name}
                      onChange={(e) => updateModel(i, { display_name: e.target.value })}
                      placeholder="Display Name"
                      className="col-span-4 border rounded px-2 py-1 text-xs"
                    />
                    <input
                      type="number"
                      value={m.sort_order ?? 0}
                      onChange={(e) =>
                        updateModel(i, { sort_order: parseInt(e.target.value, 10) || 0 })
                      }
                      placeholder="Order"
                      className="col-span-2 border rounded px-2 py-1 text-xs"
                    />
                    <label className="col-span-1 flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={m.is_active !== false}
                        onChange={(e) => updateModel(i, { is_active: e.target.checked })}
                      />
                      On
                    </label>
                    <button
                      type="button"
                      onClick={() => removeModel(i)}
                      className="col-span-1 text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <ErrorBanner message={editorError} onDismiss={() => setEditorError(null)} />
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded text-sm"
          >
            Cancel
          </button>
          <SaveButton onClick={handleSave} isSaving={isSaving} />
        </div>
      </div>
    </div>
  );
}

export default AIProviderEditor;
