import { NavLink, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";

interface NavItem {
  label: string;
  path?: string;          // optional: absent for pillar group parents (expandable, non-clickable header)
  icon?: string;          // optional: pillar group emoji
  roles?: string[];
  children?: NavItem[];   // optional: presence indicates 2nd-level expandable group
  comingLabel?: string;   // optional: short suffix like "B.2" rendered as "(B.2)" muted
}

interface NavNode {
  label: string;
  icon: string;
  path?: string;
  children?: NavItem[];
  roles?: string[];
}

const SIDEBAR_STORAGE_KEY = "ropi-sidebar-collapsed";

const NAV_TREE: NavNode[] = [
  { label: "Dashboard", icon: "🏠", path: "/dashboard" },
  { label: "Products", icon: "📦", path: "/products" },
  { label: "Advisory", icon: "📋", path: "/advisory" },
  {
    label: "Inventory Workspace",
    icon: "📦",
    children: [
      { label: "Completion Queue", path: "/queue/completion" },
      { label: "Buyer Review", path: "/buyer-review" },
      { label: "Cadence Review", path: "/cadence-review" },
      { label: "Cadence Unassigned", path: "/cadence-unassigned" },
      {
        label: "Neglected Inventory",
        path: "/neglected-inventory",
        roles: ["admin", "owner", "head_buyer"],
      },
      { label: "Channel Disparity", path: "/channel-disparity" },
    ],
  },
  {
    label: "Product Operations",
    icon: "⚙️",
    children: [
      { label: "Import Hub", path: "/import-hub" },
      { label: "Export Center", path: "/export-center" },
      { label: "Launch Admin", path: "/launch-admin" },
      { label: "MAP Conflict", path: "/map-conflict-review" },
      { label: "MAP Removal", path: "/map-removal-review" },
      { label: "Pricing Discrepancy", path: "/pricing-discrepancy" },
      { label: "Site Verification", path: "/site-verification" },
    ],
  },
  {
    label: "Intelligence",
    icon: "📊",
    roles: ["admin", "owner", "head_buyer", "buyer"],
    children: [
      {
        label: "Executive Dashboard",
        path: "/executive",
        roles: ["admin", "owner", "head_buyer"],
      },
      {
        label: "Buyer Performance",
        path: "/buyer-performance",
        roles: ["admin", "owner", "head_buyer", "buyer"],
      },
    ],
  },
  {
    label: "Admin",
    icon: "🔧",
    roles: ["admin", "owner"],
    children: [
      { label: "Overview", path: "/admin/overview" },
      {
        label: "Data Registries",
        icon: "🗂️",
        children: [
          { label: "Site Registry", path: "/admin/registries/sites" },
          { label: "Attribute Registry", path: "/admin/registries/attributes" },
          { label: "Brand Registry", path: "/admin/registries/brands" },
          { label: "Department Registry", path: "/admin/registries/departments" },
        ],
      },
      {
        label: "AI & Automation",
        icon: "🤖",
        children: [
          { label: "AI Provider Registry", path: "/admin/ai-automation/providers" },
          { label: "Prompt Templates", path: "/admin/ai-automation/prompt-templates" },
          { label: "Smart Rule Engine", path: "/admin/ai-automation/smart-rules" },
          { label: "Completion Rules", comingLabel: "B.3" },
        ],
      },
      {
        label: "Data Pipeline & Workflow",
        icon: "🔄",
        children: [
          { label: "Import Mapping Templates", path: "/admin/pipeline/import-templates" },
          { label: "Export Profiles", path: "/admin/pipeline/export-profiles" },
          { label: "Cadence Policies", path: "/admin/pipeline/cadence" },
        ],
      },
      {
        label: "Access & Governance",
        icon: "🛡️",
        children: [
          { label: "User Management", path: "/admin/governance/users" },
          { label: "Permissions Matrix", path: "/admin/governance/permissions" },
          { label: "Comment Thread Settings", path: "/admin/governance/comment-threads" },
          { label: "Feature Toggles", path: "/admin/governance/feature-toggles" },
        ],
      },
      {
        label: "App Experience",
        icon: "✨",
        children: [
          { label: "Guided Tour Management", path: "/admin/experience/guided-tours" },
          { label: "SOP Panel Content", path: "/admin/experience/sop-panels" },
          { label: "Launch Settings", path: "/admin/experience/launch-settings" },
        ],
      },
      {
        label: "System & Infrastructure",
        icon: "⚙️",
        children: [
          { label: "SMTP", path: "/admin/infrastructure/smtp" },
          { label: "Pricing Guardrails", path: "/admin/infrastructure/pricing-guardrails" },
          { label: "System Variables", path: "/admin/infrastructure/system-variables" },
          { label: "Search Settings", path: "/admin/infrastructure/search" },
        ],
      },
    ],
  },
];

interface SidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export default function Sidebar({ mobileOpen, onCloseMobile }: SidebarProps) {
  const { role } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const raw = sessionStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // corrupt JSON, private browsing, quota exceeded — fall through to default
    }
    // Default seed (Ruling L Option 2): Admin expanded, all 6 pillar groups collapsed.
    // Admin's expand state is keyed by "Admin" (top-level NavNode.label) — absent from seed → defaults expanded.
    // Pillar groups keyed by "Admin > {pillar.label}" — seeded true (collapsed).
    return {
      "Admin > Data Registries": true,
      "Admin > AI & Automation": true,
      "Admin > Data Pipeline & Workflow": true,
      "Admin > Access & Governance": true,
      "Admin > App Experience": true,
      "Admin > System & Infrastructure": true,
    };
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(collapsed));
    } catch {
      // ignore: quota exceeded or private browsing
    }
  }, [collapsed]);

  const canSee = (roles?: string[]) => !roles || (role ? roles.includes(role) : false);

  const onNavClick = () => {
    if (onCloseMobile) onCloseMobile();
  };

  const classes =
    "w-60 shrink-0 bg-gray-900 text-gray-100 flex flex-col border-r border-gray-800 overflow-y-auto";

  const content = (
    <>
      {/* Brand */}
      <div className="px-4 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <span className="text-lg font-bold tracking-tight text-white">ROPI</span>
          <span className="ml-2 text-xs text-gray-500">AOSS V3</span>
        </div>
        {onCloseMobile && (
          <button
            onClick={onCloseMobile}
            className="md:hidden text-gray-400 hover:text-white text-lg"
            aria-label="Close sidebar"
          >
            ✕
          </button>
        )}
      </div>

      {/* Nav tree */}
      <nav className="flex-1 px-2 py-3 space-y-1">
        {NAV_TREE.filter((n) => canSee(n.roles)).map((node) => {
          if (node.path) {
            return (
              <NavLink
                key={node.path}
                to={node.path}
                onClick={onNavClick}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "text-gray-300 hover:bg-gray-800 hover:text-white"
                  }`
                }
              >
                <span>{node.icon}</span>
                <span>{node.label}</span>
              </NavLink>
            );
          }

          const isOpen = !collapsed[node.label];
          const hasActiveChild = node.children?.some(
            (c) => c.path && location.pathname.startsWith(c.path.split("?")[0])
          );

          return (
            <div key={node.label}>
              <button
                onClick={() =>
                  setCollapsed((p) => ({ ...p, [node.label]: !p[node.label] }))
                }
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                  hasActiveChild
                    ? "text-white bg-gray-800"
                    : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span>{node.icon}</span>
                  <span className="font-medium">{node.label}</span>
                </span>
                <span className="text-xs text-gray-500">{isOpen ? "▾" : "▸"}</span>
              </button>
              {isOpen && (
                <div className="ml-4 mt-1 space-y-0.5 border-l border-gray-700 pl-2">
                  {node.children
                    ?.filter((c) => canSee(c.roles))
                    .map((child) => {
                      // Pillar group (NavItem with children)
                      if (child.children) {
                        const pillarKey = `${node.label} > ${child.label}`;
                        const isPillarOpen = !collapsed[pillarKey];
                        const hasSurfaceActive = child.children.some(
                          (s) => s.path && location.pathname.startsWith(s.path)
                        );
                        return (
                          <div key={child.path ?? child.label}>
                            <button
                              onClick={() =>
                                setCollapsed((p) => ({ ...p, [pillarKey]: !p[pillarKey] }))
                              }
                              className={`w-full flex items-center justify-between px-3 py-1.5 rounded text-sm ${
                                hasSurfaceActive
                                  ? "text-white bg-gray-800/60"
                                  : "text-gray-400 hover:text-white hover:bg-gray-800"
                              }`}
                            >
                              <span>
                                {child.icon ? <span className="mr-2">{child.icon}</span> : null}
                                {child.label}
                              </span>
                              <span className="text-xs text-gray-600">{isPillarOpen ? "▾" : "▸"}</span>
                            </button>
                            {isPillarOpen && (
                              <div className="ml-4 mt-1 space-y-0.5 border-l border-gray-700 pl-2">
                                {child.children
                                  .filter((s) => canSee(s.roles))
                                  .map((surface) => {
                                    if (!surface.path) {
                                      // Coming surface — non-clickable
                                      return (
                                        <span
                                          key={surface.path ?? surface.label}
                                          className="block px-3 py-1.5 rounded text-sm text-gray-500 opacity-60 cursor-default select-none"
                                        >
                                          {surface.label}
                                          {surface.comingLabel && (
                                            <span className="ml-1 text-xs text-gray-600">
                                              ({surface.comingLabel})
                                            </span>
                                          )}
                                        </span>
                                      );
                                    }
                                    // Live surface — NavLink
                                    return (
                                      <NavLink
                                        key={surface.path}
                                        to={surface.path}
                                        onClick={onNavClick}
                                        className={({ isActive }) =>
                                          `block px-3 py-1.5 rounded text-sm ${
                                            isActive
                                              ? "text-blue-400 font-medium bg-gray-800/60"
                                              : "text-gray-400 hover:text-white hover:bg-gray-800"
                                          }`
                                        }
                                      >
                                        {surface.label}
                                      </NavLink>
                                    );
                                  })}
                              </div>
                            )}
                          </div>
                        );
                      }
                      // Leaf NavItem (e.g., Overview link, plus all children of non-Admin top-level groups)
                      return (
                        <NavLink
                          key={child.path ?? child.label}
                          to={child.path!}
                          onClick={onNavClick}
                          className={({ isActive }) =>
                            `block px-3 py-1.5 rounded text-sm ${
                              isActive
                                ? "text-blue-400 font-medium bg-gray-800/60"
                                : "text-gray-400 hover:text-white hover:bg-gray-800"
                            }`
                          }
                        >
                          {child.label}
                        </NavLink>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-500">
        Logged in as <span className="text-gray-300 capitalize">{role || "…"}</span>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className={`hidden md:flex sticky top-0 h-screen ${classes}`}>
        {content}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <aside className={`${classes} h-full`}>{content}</aside>
          <div
            className="flex-1 bg-black/50"
            onClick={onCloseMobile}
            aria-label="Close sidebar"
          />
        </div>
      )}
    </>
  );
}
