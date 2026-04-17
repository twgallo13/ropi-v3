import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "auto";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "auto",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("ropi-theme") as Theme | null;
    return saved || "auto";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      return;
    }
    if (theme === "light") {
      root.classList.remove("dark");
      return;
    }
    // auto — follow system
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    root.classList.toggle("dark", mq.matches);
    const listener = (e: MediaQueryListEvent) =>
      root.classList.toggle("dark", e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [theme]);

  const setAndPersist = (t: Theme) => {
    setTheme(t);
    localStorage.setItem("ropi-theme", t);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setAndPersist }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
