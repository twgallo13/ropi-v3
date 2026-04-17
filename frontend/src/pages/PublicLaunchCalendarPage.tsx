import { useEffect, useState } from "react";
import {
  fetchPublicLaunches,
  subscribeLaunchEmail,
  type PublicLaunchCard,
} from "../lib/api";

export default function PublicLaunchCalendarPage() {
  const [upcoming, setUpcoming] = useState<PublicLaunchCard[]>([]);
  const [past, setPast] = useState<PublicLaunchCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [showSub, setShowSub] = useState(false);

  useEffect(() => {
    fetchPublicLaunches()
      .then((d) => {
        setUpcoming(d.upcoming);
        setPast(d.past);
      })
      .catch((e) => setErr(e?.error || "Failed to load launches"))
      .finally(() => setLoading(false));
  }, []);

  const cards = tab === "upcoming" ? upcoming : past;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-black text-white">
        <div className="max-w-6xl mx-auto px-6 py-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Shiekh Launch Calendar</h1>
            <p className="text-gray-300 mt-1">
              Upcoming releases and drawings
            </p>
          </div>
          <button
            onClick={() => setShowSub(true)}
            className="px-4 py-2 bg-white text-black rounded hover:bg-gray-100"
          >
            Subscribe
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="mb-6 flex gap-2">
          <button
            onClick={() => setTab("upcoming")}
            className={`px-4 py-2 rounded ${
              tab === "upcoming"
                ? "bg-black text-white"
                : "bg-gray-200 hover:bg-gray-300"
            }`}
          >
            Upcoming ({upcoming.length})
          </button>
          <button
            onClick={() => setTab("past")}
            className={`px-4 py-2 rounded ${
              tab === "past"
                ? "bg-black text-white"
                : "bg-gray-200 hover:bg-gray-300"
            }`}
          >
            Past ({past.length})
          </button>
        </div>

        {loading && <div className="text-gray-500">Loading…</div>}
        {err && (
          <div className="p-3 bg-red-100 text-red-700 rounded">{err}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cards.map((c) => (
            <LaunchCard key={c.launch_id} card={c} />
          ))}
          {!loading && cards.length === 0 && (
            <div className="col-span-full text-center text-gray-500 py-12">
              No {tab} launches
            </div>
          )}
        </div>
      </div>

      {showSub && <SubscribeModal onClose={() => setShowSub(false)} />}
    </div>
  );
}

function LaunchCard({ card }: { card: PublicLaunchCard }) {
  const date = new Date(card.launch_date);
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const badgeActive =
    card.date_change_badge_expires_at &&
    new Date(card.date_change_badge_expires_at).getTime() > Date.now();

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden hover:shadow-lg transition">
      <div className="relative aspect-square bg-gray-100">
        {card.image_1_url ? (
          <img
            src={card.image_1_url}
            alt={card.product_name}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            No image
          </div>
        )}
        {card.is_high_priority && (
          <div className="absolute top-2 right-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded">
            🚀 SOON
          </div>
        )}
        {badgeActive && card.previous_launch_date && (
          <div className="absolute top-2 left-2 bg-yellow-400 text-black text-xs font-bold px-2 py-1 rounded">
            DATE CHANGED
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="text-xs text-gray-500 uppercase">{card.brand}</div>
        <h3 className="font-bold text-lg leading-tight">{card.product_name}</h3>
        <div className="mt-2 text-sm text-gray-700">{dateStr}</div>
        <div className="mt-1 text-xs text-gray-500">
          {card.sales_channel} · {card.drawing_fcfs}
        </div>
        {badgeActive && card.previous_launch_date && (
          <div className="mt-2 text-xs text-gray-600">
            Was:{" "}
            <span className="line-through">{card.previous_launch_date}</span>
          </div>
        )}
        {card.teaser_text && (
          <p className="mt-3 text-sm text-gray-600">{card.teaser_text}</p>
        )}
      </div>
    </div>
  );
}

function SubscribeModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      await subscribeLaunchEmail(email);
      setDone(true);
    } catch (e: any) {
      setErr(e?.error || "Failed to subscribe");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-2">Subscribe to Launch Updates</h2>
        <p className="text-sm text-gray-600 mb-4">
          Internal only — must be a <span className="font-mono">@shiekh.com</span>{" "}
          email address.
        </p>
        {done ? (
          <div className="p-3 bg-green-100 text-green-700 rounded">
            Subscribed! You'll receive notifications for new launches, date
            changes, and comments.
          </div>
        ) : (
          <>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@shiekh.com"
              className="w-full border rounded px-3 py-2"
            />
            {err && (
              <div className="mt-2 p-2 bg-red-100 text-red-700 rounded text-sm">
                {err}
              </div>
            )}
          </>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300"
          >
            {done ? "Close" : "Cancel"}
          </button>
          {!done && (
            <button
              onClick={submit}
              disabled={saving || !email}
              className="px-4 py-2 rounded bg-black text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? "Subscribing…" : "Subscribe"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
