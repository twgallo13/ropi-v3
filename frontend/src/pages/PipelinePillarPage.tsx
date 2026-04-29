import { Link } from "react-router-dom";
import { AdminNavCard, RoleGate } from "../components/admin";

const SURFACES = [
  { title: "Import Mapping Templates", description: "Audit, edit, and delete saved vendor mappings.", href: "/admin/pipeline/import-templates", status: "live" as const },
  { title: "Export Profiles", description: "Configure downstream payload formats.", href: "/admin/pipeline/export-profiles", status: "live" as const },
  { title: "Cadence Policies", description: "Review cadence configuration.", href: "/admin/pipeline/cadence", status: "live" as const },
];

export default function PipelinePillarPage() {
  return (
    <RoleGate>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-4">
          <Link to="/admin/overview" className="text-sm text-gray-500 hover:text-blue-600">
            ← Admin Overview
          </Link>
        </div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold">🔄 Data Pipeline & Workflow</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The data movers.
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
