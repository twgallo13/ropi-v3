import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationItem,
} from "../lib/api";

export default function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetchNotifications(false);
      setItems(res.items);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const unread = items.filter((i) => !i.read).length;

  async function handleMarkRead(id: string) {
    try {
      await markNotificationRead(id);
      setItems((prev) => prev.filter((i) => i.notification_id !== id));
    } catch {
      /* ignore */
    }
  }
  async function handleMarkAll() {
    try {
      await markAllNotificationsRead();
      setItems([]);
    } catch {
      /* ignore */
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-1 text-gray-600 hover:text-gray-900"
        aria-label="Notifications"
      >
        <span className="text-xl">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] leading-none rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-8 w-96 bg-white border rounded-md shadow-lg z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="font-semibold text-sm">
              Notifications {unread > 0 && `(${unread} unread)`}
            </span>
            <button
              onClick={handleMarkAll}
              className="text-xs text-blue-600 hover:underline"
              disabled={items.length === 0}
            >
              Mark All Read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <p className="p-3 text-sm text-gray-500">Loading…</p>
            ) : items.length === 0 ? (
              <p className="p-3 text-sm text-gray-500 italic">No unread notifications.</p>
            ) : (
              items.map((n) => (
                <div
                  key={n.notification_id}
                  className="px-3 py-2 border-b last:border-b-0 hover:bg-gray-50"
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1">
                      {n.product_mpn ? (
                        <Link
                          to={`/products/${encodeURIComponent(n.product_mpn)}`}
                          onClick={() => setOpen(false)}
                          className="text-sm text-gray-800 hover:underline block"
                        >
                          {n.message}
                        </Link>
                      ) : (
                        <span className="text-sm text-gray-800">{n.message}</span>
                      )}
                      <div className="text-xs text-gray-500 mt-0.5">
                        {n.type} · {n.created_at ? new Date(n.created_at).toLocaleString() : ""}
                      </div>
                    </div>
                    <button
                      onClick={() => handleMarkRead(n.notification_id)}
                      className="text-xs text-blue-600 hover:underline shrink-0"
                    >
                      Mark Read
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="px-3 py-2 border-t text-right">
            <Link
              to="/settings/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-gray-600 hover:text-gray-900"
            >
              Notification Settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
