export interface WorkState {
  lastPath: string; // pathname + search combined
  lastLabel?: string;
  timestamp: number;
}

const KEY = "ropi-work-state";
const EIGHT_HOURS = 8 * 60 * 60 * 1000;

export function saveWorkState(pathname: string, search?: string): void {
  const fullPath = search ? `${pathname}${search}` : pathname;
  const state: WorkState = {
    lastPath: fullPath,
    lastLabel: pathname.replace(/^\//, "").replace(/-/g, " ") || "dashboard",
    timestamp: Date.now(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
}

export function getWorkState(): WorkState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as WorkState;
    if (!state?.lastPath || !state?.timestamp) return null;
    if (Date.now() - state.timestamp > EIGHT_HOURS) return null;
    return state;
  } catch {
    return null;
  }
}

export function clearWorkState(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
