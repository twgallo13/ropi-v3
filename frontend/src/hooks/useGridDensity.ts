import { useState } from "react";

export type Density = "comfortable" | "compact";

export function useGridDensity(gridKey: string) {
  const [density, setDensity] = useState<Density>(() => {
    const v = localStorage.getItem(`ropi-density-${gridKey}`);
    return v === "compact" ? "compact" : "comfortable";
  });

  const toggle = () => {
    const next: Density = density === "comfortable" ? "compact" : "comfortable";
    setDensity(next);
    localStorage.setItem(`ropi-density-${gridKey}`, next);
  };

  return { density, toggle, isCompact: density === "compact" };
}
