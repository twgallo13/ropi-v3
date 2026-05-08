/**
 * Track 3 Cockpit V1 — KPI Header (5 tiles).
 */
import type { CockpitKpis } from "../../lib/api";

interface Props {
  kpis: CockpitKpis;
}

export default function KpiHeader({ kpis }: Props) {
  const tiles = [
    { label: "Aged > 45d", value: kpis.aged_over_45d, bg: "bg-amber-50 text-amber-900 border-amber-200" },
    { label: "High GM%", value: kpis.high_gm_pct, bg: "bg-emerald-50 text-emerald-900 border-emerald-200" },
    { label: "Daily Goal", value: kpis.daily_approval_goal, bg: "bg-sky-50 text-sky-900 border-sky-200" },
    { label: "MAP Conflicts", value: kpis.map_violations, bg: "bg-rose-50 text-rose-900 border-rose-200" },
    { label: "Pricing Issues", value: kpis.pricing_discrepancies, bg: "bg-fuchsia-50 text-fuchsia-900 border-fuchsia-200" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
      {tiles.map((t) => (
        <div key={t.label} className={`rounded-lg border p-3 ${t.bg}`}>
          <div className="text-xs uppercase tracking-wide opacity-75">{t.label}</div>
          <div className="text-2xl font-bold mt-1">{t.value}</div>
        </div>
      ))}
    </div>
  );
}
