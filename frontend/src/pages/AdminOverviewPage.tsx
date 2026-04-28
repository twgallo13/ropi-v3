import { AdminNavCard, RoleGate } from "../components/admin";

const PILLARS: Array<{
  href: string;
  icon: string;
  title: string;
  description: string;
}> = [
  {
    href: "/admin/registries",
    icon: "🗂️",
    title: "Data Registries",
    description: "The building blocks.",
  },
  {
    href: "/admin/ai-automation",
    icon: "🤖",
    title: "AI & Automation",
    description: "The engine.",
  },
  {
    href: "/admin/pipeline",
    icon: "🔄",
    title: "Data Pipeline & Workflow",
    description: "The data movers.",
  },
  {
    href: "/admin/governance",
    icon: "🛡️",
    title: "Access & Governance",
    description: "The people.",
  },
  {
    href: "/admin/experience",
    icon: "✨",
    title: "App Experience",
    description: "The operator interface.",
  },
  {
    href: "/admin/infrastructure",
    icon: "⚙️",
    title: "System & Infrastructure",
    description: "The plumbing.",
  },
];

export default function AdminOverviewPage() {
  return (
    <RoleGate>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Admin Overview</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Configure ROPI V3 across 6 operational pillars.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PILLARS.map((p) => (
            <AdminNavCard
              key={p.href}
              href={p.href}
              icon={p.icon}
              title={p.title}
              description={p.description}
              status="live"
            />
          ))}
        </div>
      </div>
    </RoleGate>
  );
}
