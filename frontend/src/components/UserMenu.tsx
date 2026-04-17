import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useAuth } from "../contexts/AuthContext";

export default function UserMenu() {
  const { user, role } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  async function handleSignOut() {
    setOpen(false);
    await signOut(auth);
    navigate("/login");
  }

  const initial = (user?.displayName || user?.email || "?")[0]?.toUpperCase();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg px-2 py-1"
      >
        <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
          {initial}
        </div>
        <span className="max-w-32 truncate hidden sm:inline">
          {user?.displayName || user?.email}
        </span>
        <span className="text-gray-400">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-20 w-56 bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-xl shadow-xl py-1">
            <div className="px-3 py-2 border-b dark:border-gray-700">
              <div className="text-xs font-medium text-gray-900 dark:text-white truncate">
                {user?.email}
              </div>
              <div className="text-xs text-gray-500 capitalize">{role || "—"}</div>
            </div>
            <NavLink
              to="/settings/notifications"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              ⚙️ Preferences
            </NavLink>
            {(role === "admin" || role === "owner") && (
              <NavLink
                to="/admin/settings"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                🔧 Admin Settings
              </NavLink>
            )}
            <button
              onClick={handleSignOut}
              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
