import { Link, Outlet, useNavigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { useEffect, useState } from "react";
import { auth } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { useTheme, type Theme } from "../contexts/ThemeContext";
import NotificationBell from "./NotificationBell";
import TourLoader from "./TourLoader";
import { fetchAdvisoryLatest } from "../lib/api";

// Maps pathnames to hub keys that have guided tours.
const HUB_MAP: Record<string, string> = {
  "/queue/completion": "completion_queue",
  "/import-hub": "import_hub",
  "/cadence-review": "cadence_review",
  "/launch-admin": "launch_admin",
  "/export-center": "export_center",
};

export default function Layout() {
  const { user, role } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isExec = role === "admin" || role === "owner" || role === "head_buyer";
  const [advisoryUnread, setAdvisoryUnread] = useState(false);
  const [replayKey, setReplayKey] = useState(0);

  const currentHub = HUB_MAP[location.pathname] || null;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const latest = await fetchAdvisoryLatest();
        if (cancelled) return;
        const own = latest.report && !latest.report.read_by_buyer;
        const global =
          isExec && latest.global_report && !latest.global_report.read_by_buyer;
        setAdvisoryUnread(Boolean(own || global));
      } catch {
        /* silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isExec]);

  async function handleLogout() {
    await signOut(auth);
    navigate("/login");
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-lg font-bold text-gray-900 dark:text-gray-100">
            ROPI
          </Link>
          <nav className="flex gap-4 text-sm flex-wrap">
            <Link
              to="/dashboard"
              className="text-gray-600 hover:text-gray-900"
            >
              Dashboard
            </Link>
            {isExec && (
              <Link
                to="/executive"
                className="text-gray-600 hover:text-gray-900"
              >
                Executive
              </Link>
            )}
            <Link
              to="/advisory"
              className="relative text-gray-600 hover:text-gray-900"
            >
              Advisory
              {advisoryUnread && (
                <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-600 text-white align-middle">
                  New
                </span>
              )}
            </Link>
            <Link
              to="/queue/completion"
              className="text-gray-600 hover:text-gray-900"
            >
              Completion Queue
            </Link>
            <Link
              to="/import-hub"
              className="text-gray-600 hover:text-gray-900"
            >
              Import Hub
            </Link>
            <Link
              to="/buyer-review"
              className="text-gray-600 hover:text-gray-900"
            >
              Buyer Review
            </Link>
            <Link
              to="/cadence-review"
              className="text-gray-600 hover:text-gray-900"
            >
              Cadence Review
            </Link>
            <Link
              to="/cadence-unassigned"
              className="text-gray-600 hover:text-gray-900"
            >
              Cadence Unassigned
            </Link>
            <Link
              to="/launch-admin"
              className="text-gray-600 hover:text-gray-900"
            >
              Launch Admin
            </Link>
            <Link
              to="/map-conflict-review"
              className="text-gray-600 hover:text-gray-900"
            >
              MAP Conflict
            </Link>
            <Link
              to="/map-removal-review"
              className="text-gray-600 hover:text-gray-900"
            >
              MAP Removal
            </Link>
            <Link
              to="/pricing-discrepancy"
              className="text-gray-600 hover:text-gray-900"
            >
              Pricing Discrepancy
            </Link>
            <Link
              to="/site-verification"
              className="text-gray-600 hover:text-gray-900"
            >
              Site Verification
            </Link>
            <Link
              to="/channel-disparity"
              className="text-gray-600 hover:text-gray-900"
            >
              Channel Disparity
            </Link>
            {isExec && (
              <Link
                to="/neglected-inventory"
                className="text-gray-600 hover:text-gray-900"
              >
                Neglected Inventory
              </Link>
            )}
            {(isExec || role === "buyer") && (
              <Link
                to="/buyer-performance"
                className="text-gray-600 hover:text-gray-900"
              >
                {isExec ? "Buyer Performance" : "My Performance"}
              </Link>
            )}
            <Link
              to="/export-center"
              className="text-gray-600 hover:text-gray-900"
            >
              Export Center
            </Link>
            <Link
              to="/admin/cadence-rules"
              className="text-gray-500 hover:text-gray-900 ml-2 border-l pl-3"
            >
              ⚙ Rules
            </Link>
            <Link
              to="/admin/prompt-templates"
              className="text-gray-500 hover:text-gray-900"
            >
              ⚙ Templates
            </Link>
            <Link
              to="/admin/smart-rules"
              className="text-gray-500 hover:text-gray-900"
            >
              ⚙ Smart Rules
            </Link>
          </nav>
        </div>
        {user && (
          <div className="flex items-center gap-3 text-sm">
            {/* Command bar hint */}
            <button
              onClick={() =>
                window.dispatchEvent(
                  new KeyboardEvent("keydown", { key: "k", ctrlKey: true })
                )
              }
              title="Open command bar (Ctrl+K)"
              className="hidden md:flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              🔍 <span>Search</span>
              <kbd className="ml-1 text-[10px] text-gray-400 border border-gray-200 dark:border-gray-700 rounded px-1">
                Ctrl+K
              </kbd>
            </button>

            {/* Theme toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 p-0.5">
              {(["light", "auto", "dark"] as Theme[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  title={`Theme: ${t}`}
                  className={
                    "px-2 py-0.5 text-xs rounded " +
                    (theme === t
                      ? "bg-gray-200 dark:bg-gray-700 font-medium text-gray-900 dark:text-gray-100"
                      : "text-gray-500 dark:text-gray-400")
                  }
                >
                  {t === "light" ? "☀️" : t === "dark" ? "🌙" : "⚡"}
                </button>
              ))}
            </div>

            {/* Help / replay tour */}
            {currentHub && (
              <button
                onClick={() => setReplayKey((k) => k + 1)}
                title="Replay tour for this page"
                className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-full w-7 h-7 flex items-center justify-center"
              >
                ?
              </button>
            )}

            <NotificationBell />
            <span className="text-gray-500 dark:text-gray-400">{user.email}</span>
            <button
              onClick={handleLogout}
              className="text-red-600 hover:underline"
            >
              Sign Out
            </button>
          </div>
        )}
      </header>
      <main className="flex-1">
        {currentHub && (
          <TourLoader hub={currentHub} forceReplayKey={replayKey} />
        )}
        <Outlet />
      </main>
    </div>
  );
}
