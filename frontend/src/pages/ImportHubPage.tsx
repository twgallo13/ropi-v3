import { useEffect, useState } from "react";
import {
  uploadImport,
  commitImport,
  mapPolicyUpload,
  mapPolicyMapColumns,
  mapPolicyCommit,
  fetchMapTemplates,
  siteVerificationUpload,
  siteVerificationCommit,
  fetchSiteRegistry,
  type SiteRegistryEntry,
  type ImportUploadResponse,
  type ImportCommitResponse,
  type MapUploadResponse,
  type MapColumnMapping,
  type MapTemplate,
} from "../lib/api";

type Family = "full-product" | "weekly-operations";

interface UploadState {
  file: File | null;
  uploading: boolean;
  uploadResult: ImportUploadResponse | null;
  uploadError: string;
  committing: boolean;
  commitResult: ImportCommitResponse | null;
  commitError: string;
}

const INITIAL: UploadState = {
  file: null,
  uploading: false,
  uploadResult: null,
  uploadError: "",
  committing: false,
  commitResult: null,
  commitError: "",
};

function ImportCard({
  title,
  family,
}: {
  title: string;
  family: Family;
}) {
  const [state, setState] = useState<UploadState>({ ...INITIAL });

  async function handleUpload() {
    if (!state.file) return;
    setState((s) => ({ ...s, uploading: true, uploadError: "", uploadResult: null, commitResult: null, commitError: "" }));
    try {
      const result = await uploadImport(family, state.file);
      setState((s) => ({ ...s, uploading: false, uploadResult: result }));
    } catch (err: any) {
      setState((s) => ({
        ...s,
        uploading: false,
        uploadError: err?.message || err?.error || "Upload failed",
      }));
    }
  }

  async function handleCommit() {
    if (!state.uploadResult?.batch_id) return;
    setState((s) => ({ ...s, committing: true, commitError: "", commitResult: null }));
    try {
      const result = await commitImport(family, state.uploadResult.batch_id);
      setState((s) => ({ ...s, committing: false, commitResult: result }));
    } catch (err: any) {
      setState((s) => ({
        ...s,
        committing: false,
        commitError: err?.message || err?.error || "Commit failed",
      }));
    }
  }

  function handleReset() {
    setState({ ...INITIAL });
  }

  return (
    <div className="bg-white rounded-lg border p-6">
      <h2 className="text-lg font-semibold mb-4">{title}</h2>

      {/* File picker */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setState(() => ({ ...INITIAL, file: e.target.files?.[0] || null }))}
          className="text-sm"
        />
        <button
          onClick={handleUpload}
          disabled={!state.file || state.uploading}
          className="px-4 py-2 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state.uploading ? "Uploading…" : "Upload & Validate"}
        </button>
      </div>

      {/* Upload error */}
      {state.uploadError && (
        <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-sm text-red-700">
          {state.uploadError}
        </div>
      )}

      {/* Upload result */}
      {state.uploadResult && (
        <div className="mb-4 p-4 rounded bg-green-50 border border-green-200">
          <div className="flex items-center gap-4 text-sm">
            <span>
              <strong>Batch ID:</strong>{" "}
              <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{state.uploadResult.batch_id}</code>
            </span>
            <span><strong>Rows:</strong> {state.uploadResult.row_count}</span>
          </div>
          {state.uploadResult.warnings.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-yellow-700">Warnings:</p>
              <ul className="text-xs text-yellow-700 list-disc ml-4">
                {state.uploadResult.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Commit controls */}
          {!state.commitResult && (
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={handleCommit}
                disabled={state.committing}
                className="px-4 py-2 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {state.committing ? "Committing…" : "Commit Import"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Commit error */}
      {state.commitError && (
        <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-sm text-red-700">
          {state.commitError}
        </div>
      )}

      {/* Commit result */}
      {state.commitResult && (
        <div className="p-4 rounded bg-blue-50 border border-blue-200">
          <p className="text-sm font-medium text-blue-800 mb-2">Import Complete</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Committed:</span>{" "}
              <strong className="text-green-700">{state.commitResult.committed_rows}</strong>
            </div>
            <div>
              <span className="text-gray-500">Failed:</span>{" "}
              <strong className={state.commitResult.failed_rows > 0 ? "text-red-700" : "text-gray-700"}>
                {state.commitResult.failed_rows}
              </strong>
            </div>
            {state.commitResult.uuid_names_cleaned !== undefined && (
              <div>
                <span className="text-gray-500">UUID Names Cleaned:</span>{" "}
                <strong>{state.commitResult.uuid_names_cleaned}</strong>
              </div>
            )}
            {state.commitResult.smart_rules_applied !== undefined && (
              <div>
                <span className="text-gray-500">Smart Rules Applied:</span>{" "}
                <strong>{state.commitResult.smart_rules_applied}</strong>
              </div>
            )}
          </div>
          {state.commitResult.errors && state.commitResult.errors.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-red-700">Errors:</p>
              <ul className="text-xs text-red-600 list-disc ml-4 max-h-40 overflow-y-auto">
                {state.commitResult.errors.map((e, i) => (
                  <li key={i}>
                    {typeof e === "string" ? e : `Row ${e.row}${e.mpn ? ` (${e.mpn})` : ""}: ${e.error}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={handleReset}
            className="mt-3 px-3 py-1 text-xs text-gray-500 hover:text-gray-700 border rounded"
          >
            Upload Another
          </button>
        </div>
      )}
    </div>
  );
}

export default function ImportHubPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Import Hub</h1>
      <div className="space-y-6">
        <div data-tour="full-product-import">
          <ImportCard title="Full Product Import" family="full-product" />
        </div>
        <div data-tour="weekly-ops-import">
          <ImportCard title="Weekly Operations Import" family="weekly-operations" />
        </div>
        <div data-tour="map-policy-import">
          <MapPolicyImportCard />
        </div>
        <div data-tour="site-verification-import">
          <SiteVerificationImportCard />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  MAP Policy Import — 3-stage flow (upload → map columns → commit)
// ─────────────────────────────────────────────────────────────
type MapStage = "upload" | "map" | "done";

interface MapResultState {
  batch_id: string;
  status: string;
  total_rows: number;
  committed_rows: number;
  failed_rows: number;
  removal_proposed: number;
  errors: Array<{ row: number; mpn: string; error: string }>;
}

function MapPolicyImportCard() {
  const [stage, setStage] = useState<MapStage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [upload, setUpload] = useState<MapUploadResponse | null>(null);
  const [mapping, setMapping] = useState<MapColumnMapping>({
    mpn: "",
    brand: "",
    map_price: "",
    start_date: null,
    end_date: null,
    promo_price: null,
  });
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templates, setTemplates] = useState<MapTemplate[]>([]);
  const [result, setResult] = useState<MapResultState | null>(null);

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const resp = await mapPolicyUpload(file);
      setUpload(resp);

      // Preselect using the first header that matches each required field name
      const h = resp.raw_headers;
      const match = (keywords: string[]): string => {
        for (const kw of keywords) {
          const hit = h.find((x) => x.toLowerCase().includes(kw));
          if (hit) return hit;
        }
        return "";
      };
      setMapping({
        mpn: match(["mpn", "item", "sku"]),
        brand: match(["brand"]),
        map_price: match(["map price", "map"]),
        start_date: match(["start"]) || null,
        end_date: match(["end"]) || null,
        promo_price: match(["promo"]) || null,
      });

      try {
        const { templates } = await fetchMapTemplates();
        setTemplates(templates);
      } catch {
        /* non-fatal */
      }
      setStage("map");
    } catch (err: any) {
      setError(err?.error || err?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setMapping(t.column_mapping);
    setTemplateName(t.template_name);
  }

  async function handleCommit() {
    if (!upload) return;
    if (!mapping.mpn || !mapping.brand || !mapping.map_price) {
      setError("MPN, Brand, and MAP Price columns are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await mapPolicyMapColumns(
        upload.batch_id,
        mapping,
        saveTemplate && !!templateName,
        templateName
      );
      const commitResult = await mapPolicyCommit(upload.batch_id);
      setResult(commitResult);
      setStage("done");
    } catch (err: any) {
      setError(err?.error || err?.message || "Commit failed");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStage("upload");
    setFile(null);
    setUpload(null);
    setResult(null);
    setError("");
    setMapping({
      mpn: "",
      brand: "",
      map_price: "",
      start_date: null,
      end_date: null,
      promo_price: null,
    });
    setSaveTemplate(false);
    setTemplateName("");
  }

  return (
    <div className="bg-white rounded-lg border p-6">
      <h2 className="text-lg font-semibold mb-4">MAP Policy Import</h2>

      {error && (
        <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Stage 1 — Upload */}
      {stage === "upload" && (
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-sm"
          />
          <button
            onClick={handleUpload}
            disabled={!file || busy}
            className="px-4 py-2 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Upload File"}
          </button>
        </div>
      )}

      {/* Stage 2 — Column Mapping */}
      {stage === "map" && upload && (
        <div>
          <p className="text-xs text-gray-500 mb-3">
            Batch <code className="bg-gray-100 px-1 rounded">{upload.batch_id}</code>{" "}
            — {upload.row_count} rows detected
          </p>

          {templates.length > 0 && (
            <div className="mb-4">
              <label className="text-xs font-semibold text-gray-500 block mb-1">
                Templates
              </label>
              <select
                onChange={(e) => applyTemplate(e.target.value)}
                className="border rounded px-2 py-1 text-sm"
                defaultValue=""
              >
                <option value="">Select saved template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.template_name}
                    {t.brand ? ` (${t.brand})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <MapRow label="MPN column" required value={mapping.mpn} headers={upload.raw_headers}
              onChange={(v) => setMapping({ ...mapping, mpn: v })} />
            <MapRow label="Brand" required value={mapping.brand} headers={upload.raw_headers}
              onChange={(v) => setMapping({ ...mapping, brand: v })} />
            <MapRow label="MAP Price" required value={mapping.map_price} headers={upload.raw_headers}
              onChange={(v) => setMapping({ ...mapping, map_price: v })} />
            <MapRow label="Start Date (optional)" value={mapping.start_date || ""} headers={upload.raw_headers}
              onChange={(v) => setMapping({ ...mapping, start_date: v || null })} />
            <MapRow label="End Date (optional)" value={mapping.end_date || ""} headers={upload.raw_headers}
              onChange={(v) => setMapping({ ...mapping, end_date: v || null })} />
            <MapRow label="Promo Price (optional)" value={mapping.promo_price || ""} headers={upload.raw_headers}
              onChange={(v) => setMapping({ ...mapping, promo_price: v || null })} />
          </div>

          <div className="mt-4 flex items-center gap-2">
            <input
              type="checkbox"
              checked={saveTemplate}
              onChange={(e) => setSaveTemplate(e.target.checked)}
              id="save-template"
            />
            <label htmlFor="save-template" className="text-sm text-gray-700">
              Save as template
            </label>
            {saveTemplate && (
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Template name"
                className="border rounded px-2 py-1 text-sm ml-2"
              />
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={handleCommit}
              disabled={busy}
              className="px-4 py-2 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {busy ? "Committing…" : "Confirm Mapping & Commit"}
            </button>
            <button
              onClick={reset}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border rounded"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Stage 3 — Results */}
      {stage === "done" && result && (
        <div>
          <p className="text-sm font-medium text-blue-800 mb-3">Complete</p>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Committed:</span>{" "}
              <strong className="text-green-700">{result.committed_rows}</strong>
            </div>
            <div>
              <span className="text-gray-500">Failed:</span>{" "}
              <strong className={result.failed_rows > 0 ? "text-red-700" : "text-gray-700"}>
                {result.failed_rows}
              </strong>
            </div>
            <div>
              <span className="text-gray-500">MAP Removal Proposed:</span>{" "}
              <strong className="text-amber-700">{result.removal_proposed}</strong>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-red-700">Failed rows:</p>
              <ul className="text-xs text-red-600 list-disc ml-4 max-h-40 overflow-y-auto">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    Row {e.row}
                    {e.mpn ? ` (${e.mpn})` : ""}: {e.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={reset}
            className="mt-3 px-3 py-1 text-xs text-gray-500 hover:text-gray-700 border rounded"
          >
            Upload Another
          </button>
        </div>
      )}
    </div>
  );
}

function MapRow({
  label,
  required,
  value,
  headers,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: string;
  headers: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-44 text-gray-600">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </span>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 border rounded px-2 py-1 text-sm"
      >
        <option value="">—</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────
//  Site Verification Import — upload CSV + map columns + commit
// ─────────────────────────────────────────────────────────────
function SiteVerificationImportCard() {
  const [stage, setStage] = useState<"upload" | "map" | "done">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [batchId, setBatchId] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<{
    mpn: string;
    product_url: string;
    image_url: string;
    additional_image_url: string;
  }>({ mpn: "", product_url: "", image_url: "", additional_image_url: "" });
  const [globalSite, setGlobalSite] = useState("");
  const [globalVerificationDate, setGlobalVerificationDate] = useState(
    () => new Date().toISOString().split("T")[0]
  );
  const [siteRegistry, setSiteRegistry] = useState<SiteRegistryEntry[]>([]);
  const [result, setResult] = useState<{
    total_rows: number;
    committed_rows: number;
    failed_rows: number;
    mismatches: number;
  } | null>(null);

  useEffect(() => {
    fetchSiteRegistry()
      .then(setSiteRegistry)
      .catch(() => {
        /* non-fatal — dropdown will be empty */
      });
  }, []);

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const res = await siteVerificationUpload(file);
      setBatchId(res.batch_id);
      setHeaders(res.raw_headers || []);
      // Auto-map known column names from the ecomm platform CSV.
      const AUTO_MAPPINGS: Record<string, keyof typeof mapping> = {
        mpn: "mpn",
        link: "product_url",
        product_url: "product_url",
        url: "product_url",
        image_link: "image_url",
        image_url: "image_url",
        image: "image_url",
        additional_image_link: "additional_image_url",
        additional_image_url: "additional_image_url",
      };
      const next = {
        mpn: "",
        product_url: "",
        image_url: "",
        additional_image_url: "",
      };
      for (const header of res.raw_headers || []) {
        const key = header.toLowerCase().trim();
        const target = AUTO_MAPPINGS[key];
        if (target && !next[target]) next[target] = header;
      }
      setMapping(next);
      setStage("map");
    } catch (e: any) {
      setError(e?.error || e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    if (!mapping.mpn || !mapping.product_url) {
      setError("mpn and product_url mappings are required");
      return;
    }
    if (!globalSite) {
      setError("Site is required");
      return;
    }
    if (!globalVerificationDate) {
      setError("Verification Date is required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const cm: Record<string, string> = {
        mpn: mapping.mpn,
        product_url: mapping.product_url,
      };
      if (mapping.image_url) cm.image_url = mapping.image_url;
      if (mapping.additional_image_url)
        cm.additional_image_url = mapping.additional_image_url;
      const res = await siteVerificationCommit(batchId, cm, {
        global_site: globalSite,
        global_verification_date: globalVerificationDate,
      });
      setResult({
        total_rows: res.total_rows ?? res.committed + (res.failed || 0),
        committed_rows: res.committed_rows ?? res.committed ?? 0,
        failed_rows: res.failed_rows ?? res.failed ?? 0,
        mismatches: res.mismatches || 0,
      });
      setStage("done");
    } catch (e: any) {
      setError(e?.error || e?.message || "Commit failed");
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    setStage("upload");
    setFile(null);
    setBatchId("");
    setHeaders([]);
    setMapping({ mpn: "", product_url: "", image_url: "", additional_image_url: "" });
    setResult(null);
    setError("");
  }

  const commitDisabled =
    busy ||
    !mapping.mpn ||
    !mapping.product_url ||
    !globalSite ||
    !globalVerificationDate;

  return (
    <div className="bg-white rounded-lg border p-6">
      <h2 className="text-lg font-semibold mb-4">Site Verification Import</h2>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-2 rounded text-sm mb-3">
          {error}
        </div>
      )}

      {stage === "upload" && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="text-sm"
            />
            <button
              onClick={handleUpload}
              disabled={!file || busy}
              className="px-4 py-2 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Uploading…" : "Upload & Parse"}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Ecomm-platform CSV with columns <code>mpn</code>,{" "}
            <code>link</code>, <code>image_link</code>, and optional{" "}
            <code>additional_image_link</code>. Site and verification date are
            set globally on the next step.
          </p>
        </div>
      )}

      {stage === "map" && (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Batch <span className="font-mono">{batchId}</span> parsed with{" "}
            <span className="font-medium">{headers.length}</span> columns.
          </p>

          {/* Global settings — applied to all rows */}
          <div className="p-3 bg-gray-50 border rounded">
            <p className="text-sm font-medium text-gray-700 mb-2">
              Global settings — applied to all rows in this import
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-600">
                  Site <span className="text-red-600">*</span>
                </label>
                <select
                  value={globalSite}
                  onChange={(e) => setGlobalSite(e.target.value)}
                  className="w-full border rounded p-1 text-sm mt-1"
                >
                  <option value="">Select site…</option>
                  {siteRegistry.map((s) => (
                    <option key={s.site_id} value={s.domain}>
                      {s.label || s.domain}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600">
                  Verification Date <span className="text-red-600">*</span>
                </label>
                <input
                  type="date"
                  value={globalVerificationDate}
                  onChange={(e) => setGlobalVerificationDate(e.target.value)}
                  className="w-full border rounded p-1 text-sm mt-1"
                />
              </div>
            </div>
          </div>

          {/* Column mapping */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">
              Column mapping
            </p>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { key: "mpn", required: true },
                  { key: "product_url", required: true },
                  { key: "image_url", required: false },
                  { key: "additional_image_url", required: false },
                ] as const
              ).map(({ key, required }) => (
                <label key={key} className="text-sm">
                  <span className="block font-medium mb-1">
                    {key} {required && <span className="text-red-600">*</span>}
                  </span>
                  <select
                    value={mapping[key]}
                    onChange={(e) =>
                      setMapping({ ...mapping, [key]: e.target.value })
                    }
                    className="w-full border rounded px-2 py-1"
                  >
                    <option value="">— select —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleCommit}
              disabled={commitDisabled}
              className="px-4 py-2 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {busy ? "Committing…" : "Commit"}
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 rounded text-sm font-medium border hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage === "done" && result && (
        <div className="space-y-2">
          <div className="bg-green-50 border border-green-200 text-green-800 p-3 rounded text-sm">
            Imported <strong>{result.committed_rows}</strong> of {result.total_rows} rows.
            {result.mismatches > 0 && (
              <>
                {" "}
                <strong>{result.mismatches}</strong> flagged as mismatch.
              </>
            )}
            {result.failed_rows > 0 && (
              <>
                {" "}
                {result.failed_rows} failed.
              </>
            )}
          </div>
          <button
            onClick={handleReset}
            className="px-4 py-2 rounded text-sm font-medium border hover:bg-gray-50"
          >
            Upload Another
          </button>
        </div>
      )}
    </div>
  );
}
