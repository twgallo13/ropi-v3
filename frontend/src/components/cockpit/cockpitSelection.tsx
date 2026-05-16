/**
 * TALLY-146 PR 2 — Cockpit selection context.
 *
 * Per-tab selection state lifted into a single provider on the cockpit page.
 * - Selections do NOT cross tabs: each tab keeps its own selected MPN set.
 * - Switching tabs preserves the source tab's selection; destination tab
 *   resumes whatever was previously selected on it.
 * - Reset hook is exposed for post-bulk-action refresh paths.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type CockpitTabId = "cadence" | "map" | "pricing";

interface SelectionState {
  cadence: Set<string>;
  map: Set<string>;
  pricing: Set<string>;
}

interface CockpitSelectionApi {
  selectedFor: (tab: CockpitTabId) => string[];
  isSelected: (tab: CockpitTabId, mpn: string) => boolean;
  toggle: (tab: CockpitTabId, mpn: string) => void;
  setMany: (tab: CockpitTabId, mpns: string[], checked: boolean) => void;
  clear: (tab: CockpitTabId) => void;
  clearAll: () => void;
  countFor: (tab: CockpitTabId) => number;
}

const SelectionContext = createContext<CockpitSelectionApi | null>(null);

export function CockpitSelectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SelectionState>({
    cadence: new Set(),
    map: new Set(),
    pricing: new Set(),
  });

  const selectedFor = useCallback(
    (tab: CockpitTabId) => Array.from(state[tab]),
    [state],
  );

  const isSelected = useCallback(
    (tab: CockpitTabId, mpn: string) => state[tab].has(mpn),
    [state],
  );

  const toggle = useCallback((tab: CockpitTabId, mpn: string) => {
    setState((prev) => {
      const next = new Set(prev[tab]);
      if (next.has(mpn)) next.delete(mpn);
      else next.add(mpn);
      return { ...prev, [tab]: next };
    });
  }, []);

  const setMany = useCallback(
    (tab: CockpitTabId, mpns: string[], checked: boolean) => {
      setState((prev) => {
        const next = new Set(prev[tab]);
        if (checked) mpns.forEach((m) => next.add(m));
        else mpns.forEach((m) => next.delete(m));
        return { ...prev, [tab]: next };
      });
    },
    [],
  );

  const clear = useCallback((tab: CockpitTabId) => {
    setState((prev) => ({ ...prev, [tab]: new Set() }));
  }, []);

  const clearAll = useCallback(() => {
    setState({ cadence: new Set(), map: new Set(), pricing: new Set() });
  }, []);

  const countFor = useCallback(
    (tab: CockpitTabId) => state[tab].size,
    [state],
  );

  const api = useMemo<CockpitSelectionApi>(
    () => ({ selectedFor, isSelected, toggle, setMany, clear, clearAll, countFor }),
    [selectedFor, isSelected, toggle, setMany, clear, clearAll, countFor],
  );

  return (
    <SelectionContext.Provider value={api}>{children}</SelectionContext.Provider>
  );
}

export function useCockpitSelection(): CockpitSelectionApi {
  const ctx = useContext(SelectionContext);
  if (!ctx) {
    throw new Error("useCockpitSelection must be used inside <CockpitSelectionProvider>");
  }
  return ctx;
}
