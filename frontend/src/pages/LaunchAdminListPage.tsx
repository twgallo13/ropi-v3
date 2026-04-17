import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchLaunches,
  createLaunch,
  type LaunchRecord,
} from "../lib/api";

type StatusFilter = "all" | "draft" | "ready" | "published" | "archived";

export default function LaunchAdminListPage() {
  const [records, setRecords] = useState<LaunchRecord[]>([]);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (status !== "all") params.status = status;
      const data = await fetchLaunches(params);
      setRecords(data.records);
    } catch (e: any) {
      setError(e?.error || "Failed to load launches");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const daysUntil = (iso: string): number => {
    if (!iso) return 9999;
    const t = new Date(iso).getTime();
    const n = new Date().setHours(0, 0, 0, 0);
    return Math.round((t - n) / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Launch Calendar — Admin</h1>
          <p className="text-sm text-gray-500">
            Manage product launches and token status
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          + New Launch
        </button>
      </div>

      <div className="mb-4 flex gap-2">
        {(["all", "draft", "ready", "published", "archived"] as StatusFilter[]).map(
          (s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1 rounded text-sm ${
                status === s
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 hover:bg-gray-300"
              }`}
            >
              {s}
            </button>
          )
        )}
        <button
          onClick={load}
          className="ml-auto px-3 py-1 rounded text-sm bg-gray-200 hover:bg-gray-300"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">{error}</div>
      )}
      {loading && <div className="text-gray-500">Loading…</div>}

      <div className="overflow-x-auto bg-white rounded shadow">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-left">
            <tr>
              <th className="p-2">Launch Date</th>
              <th className="p-2">Days</th>
              <th className="p-2">Product</th>
              <th className="p-2">Brand</th>
              <th className="p-2">MPN</th>
              <th className="p-2">Channel</th>
              <th className="p-2">Token</th>
              <th className="p-2">Status</th>
              <th className="p-2">High Priority</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const d = daysUntil(r.launch_date);
              return (
                <tr key={r.launch_id} className="border-t hover:bg-gray-50">
                  <td className="p-2">{r.launch_date}</td>
                  <td className="p-2">
                    {d >= 0 ? (
                      <span className={d <= 7 ? "font-bold text-red-600" : ""}>
                        {d}d
                      </span>
                    ) : (
                      <span className="text-gray-400">{d}d</span>
                    )}
                  </td>
                  <td className="p-2">
                    <Link
                      to={`/launch-admin/${r.launch_id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {r.product_name}
                    </Link>
                  </td>
                  <td className="p-2">{r.brand}</td>
                  <td className="p-2 font-mono text-xs">
                    {r.mpn}
                    {r.mpn_is_placeholder && (
                      <span className="ml-1 text-yellow-600" title="Placeholder">
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="p-2">{r.sales_channel}</td>
                  <td className="p-2">
                    <span
                      className={
                        r.token_status === "Set"
                          ? "text-green-700"
                          : "text-gray-500"
                      }
                    >
                      {r.token_status}
                    </span>
                  </td>
                  <td className="p-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        r.launch_status === "published"
                          ? "bg-green-100 text-green-700"
                          : r.launch_status === "archived"
                          ? "bg-gray-200 text-gray-600"
                          : "bg-yellow-100 text-yellow-700"
                      }`}
                    >
                      {r.launch_status}
                    </span>
                  </td>
                  <td className="p-2">
                    {r.is_high_priority ? (
                      <span className="text-red-600 font-bold">🚀 Yes</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {records.length === 0 && !loading && (
              <tr>
                <td colSpan={9} className="p-4 text-center text-gray-500">
                  No launches found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewLaunchModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function NewLaunchModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    mpn: "",
    mpn_is_placeholder: false,
    product_name: "",
    brand: "",
    launch_date: "",
    sales_channel: "Online",
    drawing_fcfs: "FCFS",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      await createLaunch(form);
      onCreated();
    } catch (e: any) {
      setErr(e?.error || "Failed to create launch");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg">
        <h2 className="text-xl font-bold mb-4">New Launch</h2>
        {err && (
          <div className="mb-3 p-2 bg-red-100 text-red-700 rounded text-sm">
            {err}
          </div>
        )}
        <div className="space-y-3">
          <Field label="MPN">
            <input
              value={form.mpn}
              onChange={(e) => setForm({ ...form, mpn: e.target.value })}
              className="w-full border rounded px-2 py-1"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.mpn_is_placeholder}
              onChange={(e) =>
                setForm({ ...form, mpn_is_placeholder: e.target.checked })
              }
            />
            MPN is a placeholder (temp)
          </label>
          <Field label="Product Name">
            <input
              value={form.product_name}
              onChange={(e) =>
                setForm({ ...form, product_name: e.target.value })
              }
              className="w-full border rounded px-2 py-1"
            />
          </Field>
          <Field label="Brand">
            <input
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
              className="w-full border rounded px-2 py-1"
            />
          </Field>
          <Field label="Launch Date">
            <input
              type="date"
              value={form.launch_date}
              onChange={(e) =>
                setForm({ ...form, launch_date: e.target.value })
              }
              className="w-full border rounded px-2 py-1"
            />
          </Field>
          <Field label="Sales Channel">
            <select
              value={form.sales_channel}
              onChange={(e) =>
                setForm({ ...form, sales_channel: e.target.value })
              }
              className="w-full border rounded px-2 py-1"
            >
              <option>Online</option>
              <option>In-Store</option>
              <option>Both</option>
            </select>
          </Field>
          <Field label="Drawing / FCFS">
            <select
              value={form.drawing_fcfs}
              onChange={(e) =>
                setForm({ ...form, drawing_fcfs: e.target.value })
              }
              className="w-full border rounded px-2 py-1"
            >
              <option>FCFS</option>
              <option>Drawing</option>
            </select>
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <div className="font-medium mb-1">{label}</div>
      {children}
    </label>
  );
}
