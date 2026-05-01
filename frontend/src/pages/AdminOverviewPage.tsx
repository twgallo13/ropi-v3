import { AdminNavCard, RoleGate } from "../components/admin";
import WelcomeTour from "../components/WelcomeTour";

const PILLARS: Array<{
  href: string;
  icon: string;
  title: string;
  description: string;
  dataTour: string;
}> = [
  {
    href: "/admin/registries",
    icon: "🗂️",
    title: "Data Registries",
    description: "The building blocks.",
    dataTour: "pillar-data-registries",
  },
  {
    href: "/admin/ai-automation",
    icon: "🤖",
    title: "AI & Automation",
    description: "The engine.",
    dataTour: "pillar-ai-automation",
  },
  {
    href: "/admin/pipeline",
    icon: "🔄",
    title: "Data Pipeline & Workflow",
    description: "The data movers.",
    dataTour: "pillar-data-pipeline",
  },
  {
    href: "/admin/governance",
    icon: "🛡️",
    title: "Access & Governance",
    description: "The people.",
    dataTour: "pillar-access-governance",
  },
  {
    href: "/admin/experience",
    icon: "✨",
    title: "App Experience",
    description: "The operator interface.",
    dataTour: "pillar-app-experience",
  },
  {
    href: "/admin/infrastructure",
    icon: "⚙️",
    title: "System & Infrastructure",
    description: "The plumbing.",
    dataTour: "pillar-system-infrastructure",
  },
];

export default function AdminOverviewPage() {
  return (
    <RoleGate>
      <WelcomeTour />
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
              dataTour={p.dataTour}
            />
          ))}
        </div>
      </div>
    </RoleGate>
  );
}
