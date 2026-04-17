import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchProducts, triggerWeeklyAdvisory } from "../lib/api";

interface CommandItem {
  type: "product" | "navigation" | "action";
  label: string;
  sublabel?: string;
  icon?: string;
  action: () => void | Promise<void>;
}

interface CommandBarProps {
  open: boolean;
  onClose: () => void;
}

export default function CommandBar({ open, onClose }: CommandBarProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [productResults, setProductResults] = useState<CommandItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const go = (path: string) => {
    navigate(path);
    onClose();
  };

  const NAV_COMMANDS: CommandItem[] = useMemo(
    () => [
      { type: "navigation", label: "Dashboard", sublabel: "/dashboard", icon: "🏠", action: () => go("/dashboard") },
      { type: "navigation", label: "Executive Dashboard", sublabel: "/executive", icon: "📈", action: () => go("/executive") },
      { type: "navigation", label: "Advisory", sublabel: "/advisory", icon: "🤖", action: () => go("/advisory") },
      { type: "navigation", label: "Completion Queue", sublabel: "/queue/completion", icon: "📋", action: () => go("/queue/completion") },
      { type: "navigation", label: "Import Hub", sublabel: "/import-hub", icon: "📥", action: () => go("/import-hub") },
      { type: "navigation", label: "Export Center", sublabel: "/export-center", icon: "📤", action: () => go("/export-center") },
      { type: "navigation", label: "Cadence Review", sublabel: "/cadence-review", icon: "📊", action: () => go("/cadence-review") },
      { type: "navigation", label: "Cadence Unassigned", sublabel: "/cadence-unassigned", icon: "❓", action: () => go("/cadence-unassigned") },
      { type: "navigation", label: "Buyer Review", sublabel: "/buyer-review", icon: "🛒", action: () => go("/buyer-review") },
      { type: "navigation", label: "Buyer Performance", sublabel: "/buyer-performance", icon: "📉", action: () => go("/buyer-performance") },
      { type: "navigation", label: "Launch Admin", sublabel: "/launch-admin", icon: "🚀", action: () => go("/launch-admin") },
      { type: "navigation", label: "MAP Conflict", sublabel: "/map-conflict-review", icon: "⚠️", action: () => go("/map-conflict-review") },
      { type: "navigation", label: "MAP Removal", sublabel: "/map-removal-review", icon: "🗑️", action: () => go("/map-removal-review") },
      { type: "navigation", label: "Pricing Discrepancy", sublabel: "/pricing-discrepancy", icon: "💲", action: () => go("/pricing-discrepancy") },
      { type: "navigation", label: "Site Verification", sublabel: "/site-verification", icon: "🔗", action: () => go("/site-verification") },
      { type: "navigation", label: "Channel Disparity", sublabel: "/channel-disparity", icon: "🔀", action: () => go("/channel-disparity") },
      { type: "navigation", label: "Neglected Inventory", sublabel: "/neglected-inventory", icon: "🕸️", action: () => go("/neglected-inventory") },
      { type: "navigation", label: "Cadence Rules", sublabel: "/admin/cadence-rules", icon: "⚙️", action: () => go("/admin/cadence-rules") },
      { type: "navigation", label: "Prompt Templates", sublabel: "/admin/prompt-templates", icon: "⚙️", action: () => go("/admin/prompt-templates") },
      { type: "navigation", label: "Smart Rules", sublabel: "/admin/smart-rules", icon: "⚙️", action: () => go("/admin/smart-rules") },
      { type: "navigation", label: "Notification Settings", sublabel: "/settings/notifications", icon: "🔔", action: () => go("/settings/notifications") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const ACTION_COMMANDS: CommandItem[] = useMemo(
    () => [
      {
        type: "action",
        label: "Trigger Daily Export",
        icon: "▶️",
        action: () => go("/export-center"),
      },
      {
        type: "action",
        label: "New Launch Record",
        icon: "➕",
        action: () => go("/launch-admin?new=true"),
      },
      {
        type: "action",
        label: "Run Weekly Advisory",
        icon: "🤖",
        action: async () => {
          try {
            await triggerWeeklyAdvisory();
          } catch {
            /* silent */
          }
          go("/advisory");
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setProductResults([]);
      setHighlightedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Product search (debounced)
  useEffect(() => {
    if (!open) return;
    if (query.length < 3) {
      setProductResults([]);
      return;
    }
    const q = query;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetchProducts({ search: q, limit: "8" });
        const items: CommandItem[] = (res.items || []).map((p: any) => ({
          type: "product",
          label: p.name || p.mpn,
          sublabel: `${p.mpn} · ${p.brand || "—"} · ${p.completion_pct ?? 0}%`,
          icon: "🏷️",
          action: () => go(`/products/${encodeURIComponent(p.mpn)}`),
        }));
        setProductResults(items);
      } catch {
        setProductResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, open]);

  // Filter nav/action by query
  const filteredNav = useMemo(() => {
    if (!query) return NAV_COMMANDS;
    const q = query.toLowerCase();
    return NAV_COMMANDS.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.sublabel || "").toLowerCase().includes(q)
    );
  }, [query, NAV_COMMANDS]);

  const filteredActions = useMemo(() => {
    if (!query) return ACTION_COMMANDS;
    const q = query.toLowerCase();
    return ACTION_COMMANDS.filter((c) => c.label.toLowerCase().includes(q));
  }, [query, ACTION_COMMANDS]);

  // Flat index of all visible commands (for keyboard)
  const flatItems = useMemo(() => {
    const out: CommandItem[] = [];
    if (productResults.length) out.push(...productResults);
    out.push(...filteredNav);
    out.push(...filteredActions);
    return out;
  }, [productResults, filteredNav, filteredActions]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query, productResults.length]);

  // Keyboard handling
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((i) =>
          Math.min(flatItems.length - 1, i + 1)
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = flatItems[highlightedIndex];
        if (item) {
          void item.action();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, flatItems, highlightedIndex, onClose]);

  if (!open) return null;

  const renderGroup = (
    label: string,
    items: CommandItem[],
    startIndex: number
  ) => {
    if (!items.length) return null;
    return (
      <div>
        <div className="px-4 py-1 text-xs text-gray-400 uppercase tracking-wide">
          {label}
        </div>
        {items.map((item, i) => {
          const globalIdx = startIndex + i;
          return (
            <button
              key={`${label}-${i}`}
              onMouseEnter={() => setHighlightedIndex(globalIdx)}
              onClick={() => void item.action()}
              className={
                "w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-gray-800 " +
                (highlightedIndex === globalIdx
                  ? "bg-blue-50 dark:bg-blue-900/20"
                  : "")
              }
            >
              <span className="text-lg">{item.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {item.label}
                </div>
                {item.sublabel && (
                  <div className="text-xs text-gray-400 truncate">
                    {item.sublabel}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  let cursor = 0;
  const productGroup = renderGroup("Products", productResults, cursor);
  cursor += productResults.length;
  const navGroup = renderGroup("Navigate", filteredNav, cursor);
  cursor += filteredNav.length;
  const actionGroup = renderGroup("Quick Actions", filteredActions, cursor);

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-20 px-4"
      onClick={(e) => {
        if (!modalRef.current?.contains(e.target as Node)) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden border border-gray-200 dark:border-gray-700"
      >
        <div className="flex items-center px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <span className="text-gray-400 mr-2">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products, navigate, or run actions…"
            className="flex-1 outline-none text-sm bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400"
          />
          {searching && (
            <span className="text-xs text-gray-400 mr-2">searching…</span>
          )}
          <kbd className="text-xs text-gray-400 border border-gray-200 dark:border-gray-700 rounded px-1">
            ESC
          </kbd>
        </div>

        <div className="max-h-96 overflow-y-auto py-2">
          {flatItems.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-500 text-center">
              {query ? "No results." : "Type to search."}
            </div>
          ) : (
            <>
              {productGroup}
              {navGroup}
              {actionGroup}
            </>
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 flex gap-4">
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>ESC Close</span>
        </div>
      </div>
    </div>
  );
}
