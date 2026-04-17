import { useTheme, type Theme } from "../contexts/ThemeContext";

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 p-0.5">
      {(["light", "auto", "dark"] as Theme[]).map((t) => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          title={`Theme: ${t}`}
          className={
            "px-2 py-0.5 text-xs rounded " +
            (theme === t
              ? "bg-gray-200 dark:bg-gray-700 font-medium text-gray-900 dark:text-gray-100"
              : "text-gray-500 dark:text-gray-400")
          }
        >
          {t === "light" ? "☀️" : t === "dark" ? "🌙" : "⚡"}
        </button>
      ))}
    </div>
  );
}
