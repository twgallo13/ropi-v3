import { Link } from "react-router-dom";

export interface AdminNavCardProps {
  title: string;
  description?: string;
  icon?: string;
  href: string;
  status?: "live" | "coming";
  comingLabel?: string;
  /** Phase 3.1 PR #10 — optional `data-tour` selector for GuidedTour targeting. */
  dataTour?: string;
}

export function AdminNavCard({
  title,
  description,
  icon,
  href,
  status = "live",
  comingLabel,
  dataTour,
}: AdminNavCardProps) {
  if (status === "coming") {
    return (
      <div
        data-tour={dataTour}
        className="block p-4 bg-white dark:bg-gray-800 border rounded-lg opacity-60 cursor-default"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm">
            {icon ? <span className="mr-2">{icon}</span> : null}
            {title}
          </h3>
          {comingLabel ? (
            <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 px-2 py-0.5 rounded-full whitespace-nowrap">
              {comingLabel}
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>
        ) : null}
      </div>
    );
  }

  return (
    <Link
      to={href}
      data-tour={dataTour}
      className="block p-4 bg-white dark:bg-gray-800 border rounded-lg hover:border-blue-400 transition-colors"
    >
      <h3 className="font-semibold text-sm">
        {icon ? <span className="mr-2">{icon}</span> : null}
        {title}
      </h3>
      {description ? (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{description}</p>
      ) : null}
    </Link>
  );
}

export default AdminNavCard;
