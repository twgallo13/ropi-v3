import { NavLink, useLocation } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";

interface NavItem {
  label: string;
  path: string;
  roles?: string[];
}

interface NavNode {
  label: string;
  icon: string;
  path?: string;
  children?: NavItem[];
  roles?: string[];
}

const NAV_TREE: NavNode[] = [
  { label: "Dashboard", icon: "🏠", path: "/dashboard" },
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
      { label: "Overview", path: "/admin" },
      { label: "Settings", path: "/admin/settings" },
      { label: "Users", path: "/admin/settings?tab=users" },
      { label: "Smart Rules", path: "/admin/smart-rules" },
      { label: "Prompt Templates", path: "/admin/prompt-templates" },
      { label: "Cadence Rules", path: "/admin/cadence-rules" },
      { label: "Pricing Guardrails", path: "/admin/pricing-guardrails" },
      { label: "Export Profiles", path: "/admin/export-profiles" },
      { label: "Permissions", path: "/admin/permissions" },
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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
                    .map((child) => (
                      <NavLink
                        key={child.path}
                        to={child.path}
                        onClick={onNavClick}
                        end={child.path.includes("?")}
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
                    ))}
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
