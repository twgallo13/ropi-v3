import { Link, Outlet, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useAuth } from "../contexts/AuthContext";

export default function Layout() {
  const { user } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await signOut(auth);
    navigate("/login");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-lg font-bold text-gray-900">
            ROPI
          </Link>
          <nav className="flex gap-4 text-sm">
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
          </nav>
        </div>
        {user && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500">{user.email}</span>
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
        <Outlet />
      </main>
    </div>
  );
}
