/**
 * TALLY-SETTINGS-UX Phase 3 / B.0 — AdminCrudTable
 *
 * Shared CRUD table per Master Vision Dev Note Pillar 1.
 * Visual reference: ProductListPage.tsx ~L732 (min-w-full text-sm, sticky thead, divide-y).
 */
export interface AdminCrudColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  sortable?: boolean;
  sortKey?: string;
}

export interface AdminCrudTableProps<T> {
  rows: T[];
  columns: AdminCrudColumn<T>[];
  rowKey: (row: T) => string;
  onEdit?: (row: T) => void;
  onDeactivate?: (row: T) => void;
  isLoading?: boolean;
  emptyMessage?: string;
  sortState?: { key: string; dir: "asc" | "desc" };
  onSortChange?: (state: { key: string; dir: "asc" | "desc" }) => void;
}

export function AdminCrudTable<T>({
  rows,
  columns,
  rowKey,
  onEdit,
  onDeactivate,
  isLoading,
  emptyMessage = "No rows.",
  sortState,
  onSortChange,
}: AdminCrudTableProps<T>) {
  const hasActions = !!onEdit || !!onDeactivate;

  const handleHeaderClick = (col: AdminCrudColumn<T>) => {
    if (!col.sortable || !onSortChange) return;
    const sortKey = col.sortKey ?? col.key;
    if (sortState?.key === sortKey) {
      onSortChange({ key: sortKey, dir: sortState.dir === "asc" ? "desc" : "asc" });
    } else {
      onSortChange({ key: sortKey, dir: "asc" });
    }
  };

  return (
    <div className="overflow-auto">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase tracking-wide text-gray-600 dark:text-gray-300">
          <tr>
            {columns.map((col) => {
              const sortKey = col.sortKey ?? col.key;
              const isActive = sortState?.key === sortKey;
              return (
                <th
                  key={col.key}
                  className={`px-3 py-2 ${col.sortable ? "cursor-pointer select-none" : ""}`}
                  onClick={() => handleHeaderClick(col)}
                >
                  {col.header}
                  {col.sortable && (
                    <span className="ml-1 text-gray-400">
                      {isActive ? (sortState!.dir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  )}
                </th>
              );
            })}
            {hasActions && <th className="px-3 py-2 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {isLoading ? (
            <tr>
              <td
                colSpan={columns.length + (hasActions ? 1 : 0)}
                className="px-3 py-4 text-center text-gray-500"
              >
                Loading…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (hasActions ? 1 : 0)}
                className="px-3 py-4 text-center text-gray-500"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-3 py-2">
                    {col.render(row)}
                  </td>
                ))}
                {hasActions && (
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {onEdit && (
                      <button
                        type="button"
                        onClick={() => onEdit(row)}
                        className="text-xs text-blue-600 hover:underline mr-3"
                      >
                        Edit
                      </button>
                    )}
                    {onDeactivate && (
                      <button
                        type="button"
                        onClick={() => onDeactivate(row)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default AdminCrudTable;
