import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  fetchLaunch,
  patchLaunch,
  uploadLaunchImage,
  publishLaunch,
  setLaunchTokenStatus,
  postLaunchComment,
  archiveLaunch,
  type LaunchRecord,
  type LaunchReadiness,
  type LaunchComment,
} from "../lib/api";

export default function LaunchAdminDetailPage() {
  const { launchId } = useParams<{ launchId: string }>();
  const [launch, setLaunch] = useState<LaunchRecord | null>(null);
  const [readiness, setReadiness] = useState<LaunchReadiness | null>(null);
  const [comments, setComments] = useState<LaunchComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<LaunchRecord> & { reason?: string }>({});
  const [comment, setComment] = useState("");
  const [blocked, setBlocked] = useState<string[] | null>(null);

  async function load() {
    if (!launchId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLaunch(launchId);
      setLaunch(data.launch);
      setReadiness(data.readiness);
      setComments(data.comments);
      setEditing({});
    } catch (e: any) {
      setError(e?.error || "Failed to load launch");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchId]);

  if (!launchId) return <div className="p-6">Missing launch id</div>;
  if (loading && !launch) return <div className="p-6">Loading…</div>;
  if (!launch) return <div className="p-6 text-red-600">{error || "Not found"}</div>;

  async function saveEdits() {
    if (!launchId) return;
    setMsg(null);
    setError(null);
    try {
      await patchLaunch(launchId, editing);
      setMsg("Saved");
      await load();
    } catch (e: any) {
      setError(e?.error || "Save failed");
    }
  }

  async function onUpload(slot: 1 | 2 | 3, file: File) {
    if (!launchId) return;
    setMsg(null);
    try {
      await uploadLaunchImage(launchId, slot, file);
      setMsg(`Image ${slot} uploaded`);
      await load();
    } catch (e: any) {
      setError(e?.error || "Upload failed");
    }
  }

  async function onPublish() {
    if (!launchId) return;
    setBlocked(null);
    setError(null);
    setMsg(null);
    try {
      const r = await publishLaunch(launchId);
      if (r.blocked) {
        setBlocked(r.missing || []);
      } else {
        setMsg("Published");
        await load();
      }
    } catch (e: any) {
      setError(e?.error || "Publish failed");
    }
  }

  async function onToggleToken() {
    if (!launchId || !launch) return;
    try {
      const next = launch.token_status === "Set" ? "Not Set" : "Set";
      await setLaunchTokenStatus(launchId, next);
      await load();
    } catch (e: any) {
      setError(e?.error || "Token update failed");
    }
  }

  async function onComment() {
    if (!launchId || !comment.trim()) return;
    try {
      await postLaunchComment(launchId, comment.trim());
      setComment("");
      await load();
    } catch (e: any) {
      setError(e?.error || "Comment failed");
    }
  }

  async function onArchive() {
    if (!launchId) return;
    if (!confirm("Archive this launch?")) return;
    try {
      await archiveLaunch(launchId);
      setMsg("Archived");
      await load();
    } catch (e: any) {
      setError(e?.error || "Archive failed");
    }
  }

  const get = <K extends keyof LaunchRecord>(k: K): LaunchRecord[K] =>
    (editing as any)[k] !== undefined ? (editing as any)[k] : launch[k];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <Link to="/launch-admin" className="text-sm text-blue-600 hover:underline">
          ← Back to Launch Calendar
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{launch.product_name}</h1>
          <p className="text-gray-600">
            {launch.brand} · MPN:{" "}
            <span className="font-mono">{launch.mpn}</span>
            {launch.mpn_is_placeholder && (
              <span className="ml-2 text-yellow-600">⚠ Placeholder</span>
            )}
          </p>
          <p className="text-gray-500 text-sm mt-1">
            Status:{" "}
            <span className="font-semibold">{launch.launch_status}</span>
            {launch.is_high_priority && (
              <span className="ml-3 text-red-600 font-bold">🚀 HIGH PRIORITY</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {launch.launch_status !== "published" && (
            <button
              onClick={onPublish}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Publish
            </button>
          )}
          {launch.launch_status !== "archived" && (
            <button
              onClick={onArchive}
              className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
            >
              Archive
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className="p-3 bg-green-100 text-green-700 rounded">{msg}</div>
      )}
      {error && (
        <div className="p-3 bg-red-100 text-red-700 rounded">{error}</div>
      )}
      {blocked && (
        <div className="p-3 bg-red-100 text-red-800 rounded">
          <div className="font-bold">Cannot publish — missing:</div>
          <ul className="list-disc list-inside">
            {blocked.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Readiness Checklist */}
      {readiness && (
        <div className="bg-white p-4 rounded shadow">
          <h2 className="font-bold mb-3">Readiness Checklist</h2>
          <ul className="space-y-1 text-sm">
            {Object.entries(readiness.checks).map(([k, v]) => (
              <li key={k}>
                {v ? "✅" : "⬜"} {k}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Core Fields */}
      <div className="bg-white p-4 rounded shadow grid grid-cols-2 gap-4">
        <Field label="Launch Date">
          <input
            type="date"
            value={(get("launch_date") as string) || ""}
            onChange={(e) =>
              setEditing({ ...editing, launch_date: e.target.value })
            }
            className="w-full border rounded px-2 py-1"
          />
        </Field>
        <Field label="Sales Channel">
          <select
            value={(get("sales_channel") as string) || ""}
            onChange={(e) =>
              setEditing({ ...editing, sales_channel: e.target.value })
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
            value={(get("drawing_fcfs") as string) || ""}
            onChange={(e) =>
              setEditing({ ...editing, drawing_fcfs: e.target.value })
            }
            className="w-full border rounded px-2 py-1"
          >
            <option>FCFS</option>
            <option>Drawing</option>
          </select>
        </Field>
        <Field label="Token Status">
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-1 rounded text-sm ${
                launch.token_status === "Set"
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-200"
              }`}
            >
              {launch.token_status}
            </span>
            <button
              onClick={onToggleToken}
              className="px-3 py-1 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
            >
              Toggle
            </button>
          </div>
        </Field>
        <Field label="Gender">
          <input
            value={(get("gender") as string) || ""}
            onChange={(e) => setEditing({ ...editing, gender: e.target.value })}
            className="w-full border rounded px-2 py-1"
          />
        </Field>
        <Field label="Category">
          <input
            value={(get("category") as string) || ""}
            onChange={(e) =>
              setEditing({ ...editing, category: e.target.value })
            }
            className="w-full border rounded px-2 py-1"
          />
        </Field>
        <Field label="Class">
          <input
            value={(get("class") as string) || ""}
            onChange={(e) => setEditing({ ...editing, class: e.target.value })}
            className="w-full border rounded px-2 py-1"
          />
        </Field>
        <Field label="Primary Color">
          <input
            value={(get("primary_color") as string) || ""}
            onChange={(e) =>
              setEditing({ ...editing, primary_color: e.target.value })
            }
            className="w-full border rounded px-2 py-1"
          />
        </Field>
        <div className="col-span-2">
          <Field label="Teaser Text">
            <textarea
              rows={2}
              value={(get("teaser_text") as string) || ""}
              onChange={(e) =>
                setEditing({ ...editing, teaser_text: e.target.value })
              }
              className="w-full border rounded px-2 py-1"
            />
          </Field>
        </div>
        {editing.launch_date && editing.launch_date !== launch.launch_date && (
          <div className="col-span-2">
            <Field label="Reason for date change (required if already published)">
              <input
                value={editing.reason || ""}
                onChange={(e) =>
                  setEditing({ ...editing, reason: e.target.value })
                }
                className="w-full border rounded px-2 py-1"
              />
            </Field>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={saveEdits}
          disabled={Object.keys(editing).length === 0}
          className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Save Changes
        </button>
      </div>

      {/* Images */}
      <div className="bg-white p-4 rounded shadow">
        <h2 className="font-bold mb-3">Images</h2>
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((n) => {
            const url = (launch as any)[`image_${n}_url`] as string | null;
            return (
              <div key={n} className="border rounded p-2">
                <div className="text-sm font-medium mb-2">Image {n}</div>
                {url ? (
                  <img
                    src={url}
                    alt={`Image ${n}`}
                    className="w-full h-32 object-contain bg-gray-50"
                  />
                ) : (
                  <div className="h-32 bg-gray-100 flex items-center justify-center text-gray-400 text-sm">
                    None
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUpload(n as 1 | 2 | 3, f);
                  }}
                  className="mt-2 text-xs w-full"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Date Change Log */}
      {launch.date_change_log && launch.date_change_log.length > 0 && (
        <div className="bg-white p-4 rounded shadow">
          <h2 className="font-bold mb-3">Date Change Log</h2>
          <ul className="space-y-1 text-sm">
            {launch.date_change_log.map((e, i) => (
              <li key={i}>
                <span className="line-through text-gray-500">{e.old_date}</span>{" "}
                → <span className="font-semibold">{e.new_date}</span>
                {e.reason && <span className="ml-2 text-gray-600">({e.reason})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Comments */}
      <div className="bg-white p-4 rounded shadow">
        <h2 className="font-bold mb-3">
          Internal Comments ({comments.length})
        </h2>
        <div className="space-y-2 mb-3">
          {comments.map((c) => (
            <div key={c.comment_id} className="border-b pb-2">
              <div className="text-sm font-medium">{c.author_name}</div>
              <div className="text-sm">{c.comment_text}</div>
            </div>
          ))}
          {comments.length === 0 && (
            <div className="text-gray-500 text-sm">No comments yet</div>
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment…"
            className="flex-1 border rounded px-2 py-1"
          />
          <button
            onClick={onComment}
            disabled={!comment.trim()}
            className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Post
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
