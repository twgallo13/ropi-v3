import { Link } from "react-router-dom";
import { AdminNavCard, RoleGate } from "../components/admin";

const SURFACES = [
  { title: "User Management", description: "Manage admin users.", href: "/admin/governance/users", status: "live" as const },
  { title: "Permissions Matrix", description: "Role-based access control + approval workflows.", href: "/admin/governance/permissions", status: "live" as const },
  { title: "Comment Thread Settings", description: "Org-wide @mention + visibility rules.", href: "/admin/governance/comment-threads", status: "live" as const },
  { title: "Feature Toggles", description: "Global kill-switches for WIP features.", href: "/admin/governance/feature-toggles", status: "live" as const },
];

export default function GovernancePillarPage() {
  return (
    <RoleGate>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-4">
          <Link to="/admin/overview" className="text-sm text-gray-500 hover:text-blue-600">
            ← Admin Overview
          </Link>
        </div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold">🛡️ Access & Governance</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The people.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {SURFACES.map((s) => (
            <AdminNavCard key={s.href} {...s} />
          ))}
        </div>
      </div>
    </RoleGate>
  );
}
