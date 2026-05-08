/**
 * Track 3 Dispatch 7 — Cockpit tab nav.
 *
 * Reusable tabbed navigation for the Buyer Cockpit. Replaces the vertically
 * stacked CockpitCadenceSection / CockpitMapSection / CockpitPricingSection
 * layout with a single active-tab view.
 */
interface TabDef<T extends string> {
  id: T;
  label: string;
  count: number;
}

interface CockpitTabsProps<T extends string> {
  tabs: TabDef<T>[];
  active: T;
  onChange: (id: T) => void;
}

export default function CockpitTabs<T extends string>({
  tabs,
  active,
  onChange,
}: CockpitTabsProps<T>) {
  return (
    <div className="border-b border-gray-200 mb-6">
      <nav className="-mb-px flex gap-6" role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              role="tab"
              aria-selected={isActive}
              className={`pb-3 px-1 border-b-2 text-sm font-medium transition ${
                isActive
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`ml-2 inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs ${
                  isActive ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
