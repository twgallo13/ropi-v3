import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Navigate } from "react-router-dom";

export default function AdminOverviewPage() {
  const { role } = useAuth();
  if (role !== "admin" && role !== "owner") return <Navigate to="/dashboard" replace />;

  const sections = [
    { to: "/admin/settings", label: "Settings", desc: "Users, variables, SMTP, AI providers" },
    { to: "/admin/smart-rules", label: "Smart Rules", desc: "Automated field population rules" },
    { to: "/admin/prompt-templates", label: "Prompt Templates", desc: "AI prompt configuration" },
    { to: "/admin/cadence-rules", label: "Cadence Rules", desc: "Review cadence configuration" },
    { to: "/admin/pricing-guardrails", label: "Pricing Guardrails", desc: "Price validation rules" },
    { to: "/admin/export-profiles", label: "Export Profiles", desc: "Export format configuration" },
    { to: "/admin/permissions", label: "Permissions", desc: "Role-based access control" },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">Admin</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="block p-4 bg-white dark:bg-gray-800 border rounded-lg hover:border-blue-400 transition-colors"
          >
            <h3 className="font-semibold text-sm">{s.label}</h3>
            <p className="text-xs text-gray-500 mt-1">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
