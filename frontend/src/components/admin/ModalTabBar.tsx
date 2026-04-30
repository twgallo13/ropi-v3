// Phase 3.1 PR #2 — shared ModalTabBar primitive.
// Mirrors the page-level tab pattern used in AdminSettingsPage.tsx
// (Tailwind classes match border-blue-600 / text-blue-600 active style,
// includes dark-mode hover support).

export interface ModalTab {
  id: string;
  label: string;
}

export interface ModalTabBarProps {
  tabs: ModalTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  className?: string;
}

export function ModalTabBar({
  tabs,
  activeTab,
  onTabChange,
  className = "",
}: ModalTabBarProps) {
  return (
    <div
      role="tablist"
      className={`flex border-b border-gray-200 dark:border-gray-700 gap-2 ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.id)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              isActive
                ? "border-blue-600 text-blue-600 font-medium"
                : "border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export default ModalTabBar;
