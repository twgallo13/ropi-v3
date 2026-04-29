import { Link } from "react-router-dom";
import { AdminNavCard, RoleGate } from "../components/admin";

const SURFACES = [
  { title: "Guided Tour Management", description: "Per-Hub tour copy + reset states.", href: "/admin/experience/guided-tours", status: "live" as const },
  { title: "SOP Panel Content", description: "Per-Hub SOP copy.", href: "/admin/experience/sop-panels", status: "live" as const },
  { title: "Launch Settings", description: "Priority window + retention defaults.", href: "/admin/experience/launch-settings", status: "live" as const },
];

export default function ExperiencePillarPage() {
  return (
    <RoleGate>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-4">
          <Link to="/admin/overview" className="text-sm text-gray-500 hover:text-blue-600">
            ← Admin Overview
          </Link>
        </div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold">✨ App Experience</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The operator interface.
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
