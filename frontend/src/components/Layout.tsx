import { Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import NotificationBell from "./NotificationBell";
import TourLoader from "./TourLoader";
import Sidebar from "./Sidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import UserMenu from "./UserMenu";
import ThemeToggle from "./ThemeToggle";
import { fetchAdvisoryLatest } from "../lib/api";

const HUB_MAP: Record<string, string> = {
  "/queue/completion": "completion_queue",
  "/import-hub": "import_hub",
  "/cadence-review": "cadence_review",
  "/launch-admin": "launch_admin",
  "/export-center": "export_center",
};

export default function Layout() {
  const { user, role } = useAuth();
  const location = useLocation();
  const isExec = role === "admin" || role === "owner" || role === "head_buyer";
  const [, setAdvisoryUnread] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  function openCommandBar() {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
  }

  return (
    <div className="min-h-screen flex bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <Sidebar
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 flex items-center px-4 gap-3 sticky top-0 z-30">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="md:hidden text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white p-1"
            aria-label="Open navigation"
          >
            ☰
          </button>

          <button
            onClick={openCommandBar}
            className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <span>🔍</span>
            <span className="hidden sm:inline">Search</span>
            <kbd className="text-[10px] border border-gray-200 dark:border-gray-700 rounded px-1 hidden sm:inline">
              Ctrl+K
            </kbd>
          </button>

          <div className="flex-1" />

          {currentHub && (
            <button
              onClick={() => setReplayKey((k) => k + 1)}
              title="Replay tour for this page"
              className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-full w-7 h-7 flex items-center justify-center text-sm"
            >
              ?
            </button>
          )}

          <ThemeToggle />
          <NotificationBell />
          <UserMenu />
        </header>

        <main className="flex-1 pb-16 md:pb-0">
          {currentHub && (
            <TourLoader hub={currentHub} forceReplayKey={replayKey} />
          )}
          <Outlet />
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
}
