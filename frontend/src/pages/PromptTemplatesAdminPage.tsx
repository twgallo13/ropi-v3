import { useEffect, useState, useCallback } from "react";
import {
  fetchPromptTemplates,
  createPromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
  PromptTemplate,
} from "../lib/api";

const TONE_OPTIONS = ["standard_retail", "streetwear", "contemporary", "luxury", "casual"];

function TagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");
  return (
    <div className="flex flex-wrap gap-1 border rounded p-2 bg-white min-h-[38px]">
      {tags.map((t, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded"
        >
          {t}
          <button
            type="button"
            onClick={() => onChange(tags.filter((_, j) => j !== i))}
            className="text-blue-600 hover:text-blue-900"
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="flex-1 min-w-[100px] text-sm outline-none"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === ",") && input.trim()) {
            e.preventDefault();
            if (!tags.includes(input.trim())) {
              onChange([...tags, input.trim()]);
            }
            setInput("");
          }
        }}
        placeholder={placeholder}
      />
    </div>
  );
}

interface TemplateFormData {
  template_name: string;
  priority: number;
  match_site_owner: string;
  match_department: string;
  match_class: string;
  match_brand: string;
  match_category: string;
  tone_profile: string;
  tone_description: string;
  output_components: string[];
  prompt_instructions: string;
  banned_words: string[];
  required_attribute_inclusions: string[];
}

const emptyForm: TemplateFormData = {
  template_name: "",
  priority: 1,
  match_site_owner: "",
  match_department: "",
  match_class: "",
  match_brand: "",
  match_category: "",
  tone_profile: "standard_retail",
  tone_description: "",
  output_components: ["description", "meta_name", "meta_description", "keywords"],
  prompt_instructions: "",
  banned_words: [],
  required_attribute_inclusions: [],
};

export default function PromptTemplatesAdminPage() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null); // template_id or "new"
  const [form, setForm] = useState<TemplateFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchPromptTemplates();
      setTemplates(data);
    } catch (err: any) {
      setError(err.error || "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startNew() {
    setForm(emptyForm);
    setEditing("new");
    setError("");
  }

  function startEdit(t: PromptTemplate) {
    setForm({
      template_name: t.template_name,
      priority: t.priority,
      match_site_owner: t.match_site_owner || "",
      match_department: t.match_department || "",
      match_class: t.match_class || "",
      match_brand: t.match_brand || "",
      match_category: t.match_category || "",
      tone_profile: t.tone_profile,
      tone_description: t.tone_description,
      output_components: t.output_components || [],
      prompt_instructions: t.prompt_instructions,
      banned_words: t.banned_words || [],
      required_attribute_inclusions: t.required_attribute_inclusions || [],
    });
    setEditing(t.template_id);
    setError("");
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        match_site_owner: form.match_site_owner || null,
        match_department: form.match_department || null,
        match_class: form.match_class || null,
        match_brand: form.match_brand || null,
        match_category: form.match_category || null,
      };
      if (editing === "new") {
        await createPromptTemplate(payload);
      } else {
        await updatePromptTemplate(editing!, payload);
      }
      setEditing(null);
      await load();
    } catch (err: any) {
      setError(err.error || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Deactivate this template?")) return;
    try {
      await deletePromptTemplate(id);
      await load();
    } catch (err: any) {
      setError(err.error || "Delete failed");
    }
  }

  if (editing) {
    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">
          {editing === "new" ? "New Template" : "Edit Template"}
        </h1>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-4">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Template Name
            </label>
            <input
              className="w-full border rounded px-3 py-2 text-sm"
              value={form.template_name}
              onChange={(e) => setForm({ ...form, template_name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Priority
              </label>
              <input
                type="number"
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.priority}
                onChange={(e) =>
                  setForm({ ...form, priority: parseInt(e.target.value) || 1 })
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tone Profile
              </label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.tone_profile}
                onChange={(e) => setForm({ ...form, tone_profile: e.target.value })}
              >
                {TONE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tone Description
            </label>
            <input
              className="w-full border rounded px-3 py-2 text-sm"
              value={form.tone_description}
              onChange={(e) => setForm({ ...form, tone_description: e.target.value })}
            />
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              Matching Conditions (leave blank for wildcard)
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {(
                [
                  ["match_site_owner", "Site Owner"],
                  ["match_department", "Department"],
                  ["match_class", "Class"],
                  ["match_brand", "Brand"],
                  ["match_category", "Category"],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 mb-1">{label}</label>
                  <input
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    placeholder="Any"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Prompt Instructions
            </label>
            <textarea
              className="w-full border rounded px-3 py-2 text-sm font-mono"
              rows={12}
              value={form.prompt_instructions}
              onChange={(e) =>
                setForm({ ...form, prompt_instructions: e.target.value })
              }
            />
            <p className="text-xs text-gray-400 mt-1">
              Use {"{{placeholders}}"}: name, brand, department, class, category,
              primary_color, gender, observations
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Banned Words
            </label>
            <TagInput
              tags={form.banned_words}
              onChange={(tags) => setForm({ ...form, banned_words: tags })}
              placeholder="Type and press Enter"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Required Attribute Inclusions
            </label>
            <TagInput
              tags={form.required_attribute_inclusions}
              onChange={(tags) =>
                setForm({ ...form, required_attribute_inclusions: tags })
              }
              placeholder="Type and press Enter"
            />
          </div>

          <div className="flex gap-3 pt-4 border-t">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-blue-600 text-white px-6 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="border px-6 py-2 rounded text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Prompt Templates</h1>
        <button
          onClick={startNew}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
        >
          + New Template
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm">Loading templates…</p>
      ) : templates.length === 0 ? (
        <p className="text-gray-500 text-sm">No templates found. Create one to get started.</p>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div
              key={t.template_id}
              className="flex items-center justify-between border rounded px-4 py-3 bg-white"
            >
              <div>
                <span className="font-medium text-sm">{t.template_name}</span>
                <span className="ml-3 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">
                  Active
                </span>
                <span className="ml-2 text-xs text-gray-400">
                  Priority: {t.priority}
                </span>
                {t.match_site_owner && (
                  <span className="ml-2 text-xs text-gray-400">
                    Site: {t.match_site_owner}
                  </span>
                )}
                <span className="ml-2 text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded">
                  {t.tone_profile}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => startEdit(t)}
                  className="text-blue-600 text-sm hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(t.template_id)}
                  className="text-red-500 text-sm hover:underline"
                >
                  Deactivate
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
