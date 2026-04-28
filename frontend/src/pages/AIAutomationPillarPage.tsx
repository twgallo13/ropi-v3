import { Link } from "react-router-dom";
import { AdminNavCard, RoleGate } from "../components/admin";

const SURFACES = [
  { title: "AI Provider Registry", description: "Active API keys + workflow routing.", href: "/admin/ai-automation/providers", status: "coming" as const, comingLabel: "Coming in B.3" },
  { title: "Prompt Templates", description: "Configure AI prompts per workflow.", href: "/admin/ai-automation/prompt-templates", status: "live" as const },
  { title: "Smart Rule Engine", description: "Automated field population rules.", href: "/admin/ai-automation/smart-rules", status: "live" as const },
  { title: "Completion Rules", description: "Blocking vs warning rules for publishing.", href: "/admin/ai-automation/completion-rules", status: "coming" as const, comingLabel: "Coming in B.3" },
];

export default function AIAutomationPillarPage() {
  return (
    <RoleGate>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-4">
          <Link to="/admin/overview" className="text-sm text-gray-500 hover:text-blue-600">
            ← Admin Overview
          </Link>
        </div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold">🤖 AI & Automation</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The engine.
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
