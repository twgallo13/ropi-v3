import { Link } from "react-router-dom";
import { AdminNavCard, RoleGate } from "../components/admin";

const SURFACES = [
  { title: "Site Registry", description: "Manage canonical e-commerce sites.", href: "/admin/registries/sites", status: "live" as const },
  { title: "Attribute Registry", description: "Manage 66+ active product fields.", href: "/admin/registries/attributes", status: "live" as const },
  { title: "Brand Registry", description: "Map brand aliases to canonical owners.", href: "/admin/registries/brands", status: "live" as const },
  { title: "Department Registry", description: "Manage category hierarchies.", href: "/admin/registries/departments", status: "live" as const },
];

export default function RegistriesPillarPage() {
  return (
    <RoleGate>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-4">
          <Link to="/admin/overview" className="text-sm text-gray-500 hover:text-blue-600">
            ← Admin Overview
          </Link>
        </div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold">🗂️ Data Registries</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The building blocks.
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
