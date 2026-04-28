import { Link } from "react-router-dom";
import { AdminNavCard, RoleGate } from "../components/admin";

const SURFACES = [
  { title: "SMTP", description: "Email transport configuration.", href: "/admin/infrastructure/smtp", status: "coming" as const, comingLabel: "Coming in B.7" },
  { title: "Pricing Guardrails", description: "Max markdowns + cost estimates.", href: "/admin/infrastructure/pricing-guardrails", status: "coming" as const, comingLabel: "Coming in B.7" },
  { title: "Launch Settings", description: "Priority window + retention defaults.", href: "/admin/infrastructure/launch-settings", status: "coming" as const, comingLabel: "Coming in B.7" },
  { title: "Search Settings", description: "Scope and fuzzy-match toggles.", href: "/admin/infrastructure/search-settings", status: "coming" as const, comingLabel: "Coming in B.7" },
  { title: "Feature Toggles", description: "Global kill-switches for WIP features.", href: "/admin/infrastructure/feature-toggles", status: "coming" as const, comingLabel: "Coming in B.7" },
];

export default function InfrastructurePillarPage() {
  return (
    <RoleGate>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-4">
          <Link to="/admin/overview" className="text-sm text-gray-500 hover:text-blue-600">
            ← Admin Overview
          </Link>
        </div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold">⚙️ System & Infrastructure</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The plumbing.
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
