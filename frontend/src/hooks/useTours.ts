const KEY = "ropi-tours-seen";

export function hasTourBeenSeen(tourId: string): boolean {
  try {
    const seen = JSON.parse(localStorage.getItem(KEY) || "{}");
    return !!seen[tourId];
  } catch {
    return false;
  }
}

export function markTourSeen(tourId: string): void {
  try {
    const seen = JSON.parse(localStorage.getItem(KEY) || "{}");
    seen[tourId] = true;
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    /* ignore */
  }
}

export function resetTourSeen(tourId: string): void {
  try {
    const seen = JSON.parse(localStorage.getItem(KEY) || "{}");
    delete seen[tourId];
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    /* ignore */
  }
}
